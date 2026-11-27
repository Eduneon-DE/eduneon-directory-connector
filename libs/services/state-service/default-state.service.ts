import { LogService } from "@/libs/abstractions/log.service";
import { SecureStorageService, StorageService } from "@/libs/abstractions/storage.service";
import { DEFAULT_API_URL, DEFAULT_IDENTITY_URL } from "@/libs/constants";
import { DirectoryType } from "@/libs/enums/directoryType";
import { IConfiguration } from "@/libs/models/IConfiguration";
import { EnvironmentUrls } from "@/libs/models/domain/environmentUrls";
import { EntraIdConfiguration } from "@/libs/models/entraIdConfiguration";
import { GSuiteConfiguration } from "@/libs/models/gsuiteConfiguration";
import { LdapConfiguration } from "@/libs/models/ldapConfiguration";
import { OktaConfiguration } from "@/libs/models/oktaConfiguration";
import { OneLoginConfiguration } from "@/libs/models/oneLoginConfiguration";
import {
  SecureStorageKey,
  SecureStorageKeys,
  StorageKeys,
  StoredSecurely,
} from "@/libs/models/state.model";
import { SyncConfiguration } from "@/libs/models/syncConfiguration";

import { StateService } from "./default-state.service";
import {
  entraConfigsShareIdentity,
  generateConfigId,
  gsuiteConfigsShareIdentity,
  ldapConfigsShareIdentity,
  oktaConfigsShareIdentity,
  oneLoginConfigsShareIdentity,
} from "./secret-storage-key.util";
/**
 * Minimal interface for state migration required by {@link DefaultStateService}.
 *
 * Decoupled from the concrete {@link StateMigrationService} so the renderer process
 * can satisfy it with a no-op without pulling in `dc-native` (a Node-only native module, doesn't work with nodeIntegration: false).
 */
export interface StateMigrator {
  needsMigration(): Promise<boolean>;
  migrate(): Promise<void>;
  stampVersion(): Promise<void>;
}

/**
 * Where each directory keeps its secret: the field of its configuration, and its secure storage
 * key (with the configuration's id appended, see scopedSecretKey). Entra ID also has the key it had
 * as Azure AD.
 */
const DIRECTORY_SECRETS: Record<DirectoryType, { field: string; keys: SecureStorageKey[] }> = {
  [DirectoryType.Ldap]: { field: "password", keys: [SecureStorageKeys.ldap] },
  [DirectoryType.EntraID]: {
    field: "key",
    keys: [SecureStorageKeys.entra, SecureStorageKeys.azure],
  },
  [DirectoryType.GSuite]: { field: "privateKey", keys: [SecureStorageKeys.gsuite] },
  [DirectoryType.Okta]: { field: "token", keys: [SecureStorageKeys.okta] },
  [DirectoryType.OneLogin]: { field: "clientSecret", keys: [SecureStorageKeys.oneLogin] },
};

const DIRECTORY_TYPES = [
  DirectoryType.Ldap,
  DirectoryType.EntraID,
  DirectoryType.GSuite,
  DirectoryType.Okta,
  DirectoryType.OneLogin,
];

export class DefaultStateService implements StateService {
  constructor(
    protected storageService: StorageService,
    protected secureStorageService: SecureStorageService,
    protected logService: LogService,
    protected stateMigrationService: StateMigrator,
    protected useSecureStorageForSecrets = true,
  ) {}

  async init(): Promise<void> {
    if (await this.stateMigrationService.needsMigration()) {
      await this.stateMigrationService.migrate();
    }
    await this.stateMigrationService.stampVersion();
  }

  // ===================================================================
  // Directory Configuration Methods
  // ===================================================================

  async getDirectory<T extends IConfiguration>(type: DirectoryType): Promise<T> {
    const config = await this.getConfiguration(type);
    if (config == null) {
      return config as T;
    }

    if (this.useSecureStorageForSecrets) {
      // Do not introduce secrets into the in-memory account object
      const configWithSecrets = Object.assign({}, config);

      switch (type) {
        case DirectoryType.Ldap:
          (configWithSecrets as any).password = await this.getLdapSecret(
            config as LdapConfiguration,
          );
          break;
        case DirectoryType.EntraID:
          (configWithSecrets as any).key = await this.getEntraSecret(
            config as EntraIdConfiguration,
          );
          break;
        case DirectoryType.Okta:
          (configWithSecrets as any).token = await this.getOktaSecret(config as OktaConfiguration);
          break;
        case DirectoryType.GSuite:
          (configWithSecrets as any).privateKey = await this.getGsuiteSecret(
            config as GSuiteConfiguration,
          );
          break;
        case DirectoryType.OneLogin:
          (configWithSecrets as any).clientSecret = await this.getOneLoginSecret(
            config as OneLoginConfiguration,
          );
          break;
      }

      return configWithSecrets as T;
    }

    return config as T;
  }

  async setDirectory(
    type: DirectoryType,
    config:
      | LdapConfiguration
      | GSuiteConfiguration
      | EntraIdConfiguration
      | OktaConfiguration
      | OneLoginConfiguration,
  ): Promise<any> {
    // A copy: the caller's object (the settings page's form) keeps the secret it shows. Writing the
    // placeholder into it made the next save store "[STORED SECURELY]" as the password.
    const next = { ...config } as Record<string, any>;
    const secretField = DIRECTORY_SECRETS[type].field;
    const inUse = await this.getDirectoryType();
    if (inUse != null && inUse !== type) {
      // Only the directory in use keeps a secret: the settings of the others are saved along
      // with it, and their secrets would come back with every save (see setDirectoryType).
      next[secretField] = null;
    }

    if (!this.useSecureStorageForSecrets) {
      await this.saveConfiguration(type, next as IConfiguration);
      return;
    }

    const previous = (await this.getConfiguration(type)) as { id?: string } | null;
    next.id = this.resolveConfigId(previous, this.sharesIdentity(type, previous, next));
    if (previous?.id != null && previous.id !== next.id) {
      // Another server or account: the secret saved for the previous one is not used any more.
      await this.removeSecretSlot(type, previous.id);
    }

    let secret = next[secretField] as string | null | undefined;
    if (type === DirectoryType.GSuite && secret != null) {
      secret = secret.replace(/\\n/g, "\n");
    }
    await this.setDirectorySecret(type, next, secret);
    if (type !== DirectoryType.GSuite || secret != null) {
      next[secretField] = StoredSecurely;
    }
    await this.saveConfiguration(type, next as IConfiguration);
  }

  private sharesIdentity(type: DirectoryType, previous: unknown, next: unknown): boolean {
    switch (type) {
      case DirectoryType.Ldap:
        return ldapConfigsShareIdentity(previous as LdapConfiguration, next as LdapConfiguration);
      case DirectoryType.EntraID:
        return entraConfigsShareIdentity(
          previous as EntraIdConfiguration,
          next as EntraIdConfiguration,
        );
      case DirectoryType.Okta:
        return oktaConfigsShareIdentity(previous as OktaConfiguration, next as OktaConfiguration);
      case DirectoryType.GSuite:
        return gsuiteConfigsShareIdentity(
          previous as GSuiteConfiguration,
          next as GSuiteConfiguration,
        );
      case DirectoryType.OneLogin:
        return oneLoginConfigsShareIdentity(
          previous as OneLoginConfiguration,
          next as OneLoginConfiguration,
        );
    }
  }

  private async setDirectorySecret(
    type: DirectoryType,
    config: Record<string, any>,
    value: string,
  ): Promise<void> {
    switch (type) {
      case DirectoryType.Ldap:
        return await this.setLdapSecret(config as LdapConfiguration, value);
      case DirectoryType.EntraID:
        return await this.setEntraSecret(config as EntraIdConfiguration, value);
      case DirectoryType.Okta:
        return await this.setOktaSecret(config as OktaConfiguration, value);
      case DirectoryType.GSuite:
        return await this.setGsuiteSecret(config as GSuiteConfiguration, value);
      case DirectoryType.OneLogin:
        return await this.setOneLoginSecret(config as OneLoginConfiguration, value);
    }
  }

  private async saveConfiguration(type: DirectoryType, config: IConfiguration): Promise<void> {
    switch (type) {
      case DirectoryType.Ldap:
        return await this.setLdapConfiguration(config as LdapConfiguration);
      case DirectoryType.EntraID:
        return await this.setEntraConfiguration(config as EntraIdConfiguration);
      case DirectoryType.Okta:
        return await this.setOktaConfiguration(config as OktaConfiguration);
      case DirectoryType.GSuite:
        return await this.setGsuiteConfiguration(config as GSuiteConfiguration);
      case DirectoryType.OneLogin:
        return await this.setOneLoginConfiguration(config as OneLoginConfiguration);
    }
  }

  /**
   * Removes the secret a configuration with this id kept. Not the legacy unscoped key: copies of
   * data.json from before ids may still need it (clearDirectorySecrets removes that one). A
   * failure is logged, not thrown: the settings are saved either way.
   */
  private async removeSecretSlot(type: DirectoryType, id: string): Promise<void> {
    for (const legacyKey of DIRECTORY_SECRETS[type].keys) {
      const key = this.scopedSecretKey(legacyKey, id);
      try {
        await this.secureStorageService.remove(key);
      } catch (e) {
        this.logService.error(
          `Failed to remove secure storage key "${key}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  async getConfiguration(type: DirectoryType): Promise<IConfiguration> {
    switch (type) {
      case DirectoryType.Ldap:
        return await this.getLdapConfiguration();
      case DirectoryType.GSuite:
        return await this.getGsuiteConfiguration();
      case DirectoryType.EntraID:
        return await this.getEntraConfiguration();
      case DirectoryType.Okta:
        return await this.getOktaConfiguration();
      case DirectoryType.OneLogin:
        return await this.getOneLoginConfiguration();
    }
  }

  // ===================================================================
  // Secret Storage Methods (Secure Storage)
  // ===================================================================

  /**
   * Decides the `id` a configuration should be saved with: the previous configuration's id is
   * reused when the new configuration represents the same account/identity (e.g. a password
   * rotation), otherwise a fresh id is generated (e.g. switching to a different AD service
   * account). Keeping the id stable across identity-preserving saves means the secure-storage
   * slot is updated in place rather than accumulating a new orphaned entry on every save.
   */
  private resolveConfigId(
    previous: { id?: string } | null | undefined,
    sameIdentity: boolean,
  ): string {
    if (sameIdentity && previous?.id != null) {
      return previous.id;
    }
    return generateConfigId();
  }

  /**
   * Builds a secure storage key scoped to a specific configuration's `id`, falling back to the
   * given legacy/unscoped key when no id is available. This keeps secrets for distinct
   * configurations (e.g. two AD service accounts) from colliding in OS secure storage. See
   * secret-storage-key.util.ts for details.
   */
  private scopedSecretKey(legacyKey: SecureStorageKey, id: string): SecureStorageKey {
    return `${legacyKey}:${id}` as SecureStorageKey;
  }

  private async getScopedSecret(
    legacyKey: SecureStorageKey,
    id: string | null | undefined,
  ): Promise<string | null> {
    const get = (key: SecureStorageKey) => this.secureStorageService.get<string>(key);

    if (id != null) {
      const scoped = await get(this.scopedSecretKey(legacyKey, id));
      if (scoped != null) {
        return scoped;
      }
    }
    // Fall back to the legacy, unscoped key for installs upgrading from a version that stored
    // a single shared secret per directory type, regardless of which configuration was active.
    return await get(legacyKey);
  }

  private async setScopedSecret(
    legacyKey: SecureStorageKey,
    id: string | null | undefined,
    value: string,
  ): Promise<void> {
    const key = id != null ? this.scopedSecretKey(legacyKey, id) : legacyKey;
    if (value == null) {
      await this.secureStorageService.remove(key);
      // Also clear the legacy unscoped key so clearing a secret always fully clears it,
      // even if it hadn't been migrated to a scoped key yet.
      if (id != null) {
        await this.secureStorageService.remove(legacyKey);
      }
    } else {
      await this.secureStorageService.save(key, value);
    }
  }

  private async getLdapSecret(config: LdapConfiguration): Promise<string> {
    return await this.getScopedSecret(SecureStorageKeys.ldap, config?.id);
  }

  private async setLdapSecret(config: LdapConfiguration, value: string): Promise<void> {
    await this.setScopedSecret(SecureStorageKeys.ldap, config.id, value);
  }

  private async getGsuiteSecret(config: GSuiteConfiguration): Promise<string> {
    return await this.getScopedSecret(SecureStorageKeys.gsuite, config?.id);
  }

  private async setGsuiteSecret(config: GSuiteConfiguration, value: string): Promise<void> {
    await this.setScopedSecret(SecureStorageKeys.gsuite, config.id, value);
  }

  private async getEntraSecret(config: EntraIdConfiguration): Promise<string> {
    const entraKey = await this.getScopedSecret(SecureStorageKeys.entra, config?.id);
    if (entraKey != null) {
      return entraKey;
    }
    // Try new key first, fall back to old azure key for backwards compatibility
    return await this.getScopedSecret(SecureStorageKeys.azure, config?.id);
  }

  private async setEntraSecret(config: EntraIdConfiguration, value: string): Promise<void> {
    if (value == null) {
      await this.setScopedSecret(SecureStorageKeys.entra, config.id, null);
      await this.setScopedSecret(SecureStorageKeys.azure, config.id, null);
    } else {
      await this.setScopedSecret(SecureStorageKeys.entra, config.id, value);
    }
  }

  private async getOktaSecret(config: OktaConfiguration): Promise<string> {
    return await this.getScopedSecret(SecureStorageKeys.okta, config?.id);
  }

  private async setOktaSecret(config: OktaConfiguration, value: string): Promise<void> {
    await this.setScopedSecret(SecureStorageKeys.okta, config.id, value);
  }

  private async getOneLoginSecret(config: OneLoginConfiguration): Promise<string> {
    return await this.getScopedSecret(SecureStorageKeys.oneLogin, config?.id);
  }

  private async setOneLoginSecret(config: OneLoginConfiguration, value: string): Promise<void> {
    await this.setScopedSecret(SecureStorageKeys.oneLogin, config.id, value);
  }

  // ===================================================================
  // Directory-Specific Configuration Methods
  // ===================================================================

  async getLdapConfiguration(): Promise<LdapConfiguration> {
    return await this.storageService.get<LdapConfiguration>(StorageKeys.directoryLdap);
  }

  async setLdapConfiguration(value: LdapConfiguration): Promise<void> {
    await this.storageService.save(StorageKeys.directoryLdap, value);
  }

  async getGsuiteConfiguration(): Promise<GSuiteConfiguration> {
    return await this.storageService.get<GSuiteConfiguration>(StorageKeys.directoryGsuite);
  }

  async setGsuiteConfiguration(value: GSuiteConfiguration): Promise<void> {
    await this.storageService.save(StorageKeys.directoryGsuite, value);
  }

  async getEntraConfiguration(): Promise<EntraIdConfiguration> {
    return await this.storageService.get<EntraIdConfiguration>(StorageKeys.directoryEntra);
  }

  async setEntraConfiguration(value: EntraIdConfiguration): Promise<void> {
    await this.storageService.save(StorageKeys.directoryEntra, value);
  }

  async getOktaConfiguration(): Promise<OktaConfiguration> {
    return await this.storageService.get<OktaConfiguration>(StorageKeys.directoryOkta);
  }

  async setOktaConfiguration(value: OktaConfiguration): Promise<void> {
    await this.storageService.save(StorageKeys.directoryOkta, value);
  }

  async getOneLoginConfiguration(): Promise<OneLoginConfiguration> {
    return await this.storageService.get<OneLoginConfiguration>(StorageKeys.directoryOnelogin);
  }

  async setOneLoginConfiguration(value: OneLoginConfiguration): Promise<void> {
    await this.storageService.save(StorageKeys.directoryOnelogin, value);
  }

  // ===================================================================
  // Directory Settings Methods
  // ===================================================================

  async getOrganizationId(): Promise<string> {
    return await this.storageService.get<string>(StorageKeys.organizationId);
  }

  async setOrganizationId(value: string): Promise<void> {
    const currentId = await this.getOrganizationId();
    if (currentId !== value) {
      await this.clearSyncSettings();
    }
    await this.storageService.save(StorageKeys.organizationId, value);
  }

  async getCockpitOrganizationId(): Promise<number | null> {
    const value = Number(await this.storageService.get<number>(StorageKeys.cockpitOrganizationId));
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  async setCockpitOrganizationId(value: number | null): Promise<void> {
    if (value == null) {
      await this.storageService.remove(StorageKeys.cockpitOrganizationId);
    } else {
      await this.storageService.save(StorageKeys.cockpitOrganizationId, value);
    }
  }

  async getSync(): Promise<SyncConfiguration> {
    return await this.storageService.get<SyncConfiguration>(StorageKeys.sync);
  }

  async setSync(value: SyncConfiguration): Promise<void> {
    await this.storageService.save(StorageKeys.sync, value);
  }

  async getDirectoryType(): Promise<DirectoryType> {
    return await this.storageService.get<DirectoryType>(StorageKeys.directoryType);
  }

  async setDirectoryType(value: DirectoryType): Promise<void> {
    const currentType = await this.getDirectoryType();
    if (value !== currentType) {
      await this.clearSyncSettings();
    }
    await this.storageService.save(StorageKeys.directoryType, value);
    if (value != null && currentType != null && value !== currentType) {
      // Another directory: the secrets of the one given up are not needed any more. The type is
      // saved either way; a secret that could not be removed is logged, and logout removes it.
      try {
        await this.clearDirectorySecrets(value);
      } catch (e) {
        this.logService.error(e instanceof Error ? e.message : String(e));
      }
    }
  }

  async getLastUserSync(): Promise<Date> {
    const dateString = await this.storageService.get<string>(StorageKeys.lastUserSync);
    return dateString ? new Date(dateString) : null;
  }

  async setLastUserSync(value: Date): Promise<void> {
    await this.storageService.save(StorageKeys.lastUserSync, value);
  }

  async getLastGroupSync(): Promise<Date> {
    const dateString = await this.storageService.get<string>(StorageKeys.lastGroupSync);
    return dateString ? new Date(dateString) : null;
  }

  async setLastGroupSync(value: Date): Promise<void> {
    await this.storageService.save(StorageKeys.lastGroupSync, value);
  }

  async getLastSyncHash(): Promise<string> {
    return await this.storageService.get<string>(StorageKeys.lastSyncHash);
  }

  async setLastSyncHash(value: string): Promise<void> {
    await this.storageService.save(StorageKeys.lastSyncHash, value);
  }

  async getSyncingDir(): Promise<boolean> {
    return await this.storageService.get<boolean>(StorageKeys.syncingDir);
  }

  async setSyncingDir(value: boolean): Promise<void> {
    await this.storageService.save(StorageKeys.syncingDir, value);
  }

  async getUserDelta(): Promise<string> {
    return await this.storageService.get<string>(StorageKeys.userDelta);
  }

  async setUserDelta(value: string): Promise<void> {
    await this.storageService.save(StorageKeys.userDelta, value);
  }

  async getGroupDelta(): Promise<string> {
    return await this.storageService.get<string>(StorageKeys.groupDelta);
  }

  async setGroupDelta(value: string): Promise<void> {
    await this.storageService.save(StorageKeys.groupDelta, value);
  }

  async clearSyncSettings(hashToo = false): Promise<void> {
    await this.setUserDelta(null);
    await this.setGroupDelta(null);
    await this.setLastGroupSync(null);
    await this.setLastUserSync(null);
    if (hashToo) {
      await this.setLastSyncHash(null);
    }
  }

  // ===================================================================
  // Environment URLs
  // ===================================================================

  async getEnvironmentUrls(): Promise<EnvironmentUrls> {
    return await this.storageService.get<EnvironmentUrls>(StorageKeys.environmentUrls);
  }

  async setEnvironmentUrls(value: EnvironmentUrls): Promise<void> {
    await this.storageService.save(StorageKeys.environmentUrls, value);
  }

  async getApiUrl(): Promise<string> {
    const urls = await this.getEnvironmentUrls();
    if (urls?.api) {
      return urls.api;
    }
    if (urls?.base) {
      return urls.base + "/api";
    }
    return DEFAULT_API_URL;
  }

  async getIdentityUrl(): Promise<string> {
    const urls = await this.getEnvironmentUrls();
    if (urls?.identity) {
      return urls.identity;
    }
    if (urls?.base) {
      return urls.base + "/identity";
    }
    return DEFAULT_IDENTITY_URL;
  }

  // ===================================================================
  // Additional State Methods
  // ===================================================================

  async getLocale(): Promise<string> {
    return await this.storageService.get<string>(StorageKeys.locale);
  }

  async setLocale(value: string): Promise<void> {
    await this.storageService.save(StorageKeys.locale, value);
  }

  async getInstalledVersion(): Promise<string> {
    return await this.storageService.get<string>(StorageKeys.installedVersion);
  }

  async setInstalledVersion(value: string): Promise<void> {
    await this.storageService.save(StorageKeys.installedVersion, value);
  }

  // ===================================================================
  // Window Settings (for WindowMain)
  // ===================================================================

  async getWindow(): Promise<any> {
    return await this.storageService.get(StorageKeys.window);
  }

  async setWindow(value: any): Promise<void> {
    await this.storageService.save(StorageKeys.window, value);
  }

  async getEnableAlwaysOnTop(): Promise<boolean> {
    return (await this.storageService.get<boolean>(StorageKeys.enableAlwaysOnTop)) ?? false;
  }

  async setEnableAlwaysOnTop(value: boolean): Promise<void> {
    await this.storageService.save(StorageKeys.enableAlwaysOnTop, value);
  }

  // ===================================================================
  // Tray Settings (for TrayMain)
  // ===================================================================

  async getEnableTray(): Promise<boolean> {
    return (await this.storageService.get<boolean>(StorageKeys.enableTray)) ?? false;
  }

  async setEnableTray(value: boolean): Promise<void> {
    await this.storageService.save(StorageKeys.enableTray, value);
  }

  async getEnableMinimizeToTray(): Promise<boolean> {
    return (await this.storageService.get<boolean>(StorageKeys.enableMinimizeToTray)) ?? false;
  }

  async setEnableMinimizeToTray(value: boolean): Promise<void> {
    await this.storageService.save(StorageKeys.enableMinimizeToTray, value);
  }

  async getEnableCloseToTray(): Promise<boolean> {
    return (await this.storageService.get<boolean>(StorageKeys.enableCloseToTray)) ?? false;
  }

  async setEnableCloseToTray(value: boolean): Promise<void> {
    await this.storageService.save(StorageKeys.enableCloseToTray, value);
  }

  async getAlwaysShowDock(): Promise<boolean> {
    return (await this.storageService.get<boolean>(StorageKeys.alwaysShowDock)) ?? false;
  }

  async setAlwaysShowDock(value: boolean): Promise<void> {
    await this.storageService.save(StorageKeys.alwaysShowDock, value);
  }

  /**
   * Removes every auth token from secure storage.
   *
   * Each removal is attempted on its own: a single failing key (for example a macOS keychain item
   * whose ACL no longer trusts this process) must not prevent the remaining tokens from being
   * cleared, which would leave credentials behind and make a partially-completed logout look like a
   * successful one. The removals run one after another, not at once: in plaintext mode the secure
   * store is the locked data file, and parallel removals fought over its lock.
   *
   * Failures are logged by key name and then rethrown as one aggregate error so callers can tell
   * an incomplete logout from a clean one. Token values are never logged.
   */
  async clearAuthTokens(): Promise<void> {
    const keys: SecureStorageKey[] = [
      SecureStorageKeys.accessToken,
      SecureStorageKeys.refreshToken,
      SecureStorageKeys.apiKeyClientId,
      SecureStorageKeys.apiKeyClientSecret,
      SecureStorageKeys.twoFactorToken,
    ];

    const failures: string[] = [];
    for (const key of keys) {
      try {
        await this.secureStorageService.remove(key);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        this.logService.error(`Failed to remove secure storage key "${key}": ${reason}`);
        failures.push(`${key} (${reason})`);
      }
    }
    // The organization chosen at login belongs to that login.
    try {
      await this.storageService.remove(StorageKeys.cockpitOrganizationId);
    } catch (e) {
      this.logService.error(
        `Failed to remove the Cockpit organization: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (failures.length > 0) {
      throw new Error(`Failed to clear ${failures.length} auth token(s): ${failures.join("; ")}`);
    }
  }

  /**
   * Removes the secret (bind password, client secret, Okta token, private key) of every directory but
   * `except`, from the keychain or, with plaintext secrets, from data.json. The keychain entries are
   * the ones the current configurations name and the legacy unscoped ones; an entry left by a
   * configuration data.json no longer holds cannot be found by name.
   *
   * Like clearAuthTokens, every removal is attempted on its own, and the failures are rethrown
   * together by key name. Secret values are never logged.
   */
  async clearDirectorySecrets(except: DirectoryType = null): Promise<void> {
    const failures: string[] = [];
    for (const type of DIRECTORY_TYPES.filter((t) => t !== except)) {
      const { field, keys } = DIRECTORY_SECRETS[type];
      let config: Record<string, any> = null;
      try {
        config = (await this.getConfiguration(type)) as Record<string, any>;
        if (!this.useSecureStorageForSecrets) {
          if (config?.[field] != null) {
            await this.saveConfiguration(type, { ...config, [field]: null } as IConfiguration);
          }
          continue;
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        this.logService.error(`Failed to remove the ${field} of ${DirectoryType[type]}: ${reason}`);
        failures.push(`${DirectoryType[type]} ${field} (${reason})`);
        continue;
      }
      for (const legacyKey of keys) {
        const scoped = config?.id != null ? [this.scopedSecretKey(legacyKey, config.id)] : [];
        for (const key of [...scoped, legacyKey]) {
          try {
            await this.secureStorageService.remove(key);
          } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            this.logService.error(`Failed to remove secure storage key "${key}": ${reason}`);
            failures.push(`${key} (${reason})`);
          }
        }
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `Failed to clear ${failures.length} directory secret(s): ${failures.join("; ")}`,
      );
    }
  }

  /**
   * Everything this connector keeps in the keychain for its data folder: the auth tokens and the
   * directory secrets. For a logout and `eduneon-dc forget`. Both are attempted even when one fails.
   */
  async clearAllSecrets(): Promise<void> {
    const errors: string[] = [];
    for (const clear of [() => this.clearAuthTokens(), () => this.clearDirectorySecrets()]) {
      try {
        await clear();
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (errors.length > 0) {
      throw new Error(errors.join(" "));
    }
  }

  async getAccessToken(): Promise<string> {
    return await this.secureStorageService.get<string>(SecureStorageKeys.accessToken);
  }

  async setAccessToken(value: string): Promise<void> {
    if (value == null) {
      await this.secureStorageService.remove(SecureStorageKeys.accessToken);
    } else {
      await this.secureStorageService.save(SecureStorageKeys.accessToken, value);
    }
  }

  async getRefreshToken(): Promise<string> {
    return await this.secureStorageService.get<string>(SecureStorageKeys.refreshToken);
  }

  async setRefreshToken(value: string): Promise<void> {
    if (value == null) {
      await this.secureStorageService.remove(SecureStorageKeys.refreshToken);
    } else {
      await this.secureStorageService.save(SecureStorageKeys.refreshToken, value);
    }
  }

  async getApiKeyClientId(): Promise<string> {
    return await this.secureStorageService.get<string>(SecureStorageKeys.apiKeyClientId);
  }

  async setApiKeyClientId(value: string): Promise<void> {
    if (value == null) {
      await this.secureStorageService.remove(SecureStorageKeys.apiKeyClientId);
    } else {
      await this.secureStorageService.save(SecureStorageKeys.apiKeyClientId, value);
    }
  }

  async getApiKeyClientSecret(): Promise<string> {
    return await this.secureStorageService.get<string>(SecureStorageKeys.apiKeyClientSecret);
  }

  async setApiKeyClientSecret(value: string): Promise<void> {
    if (value == null) {
      await this.secureStorageService.remove(SecureStorageKeys.apiKeyClientSecret);
    } else {
      await this.secureStorageService.save(SecureStorageKeys.apiKeyClientSecret, value);
    }
  }

  async getIsAuthenticated(): Promise<boolean> {
    // Check if access token exists
    const token = await this.getAccessToken();
    return token != null;
  }

  async getEntityId(): Promise<string> {
    return await this.storageService.get<string>(StorageKeys.entityId);
  }

  async setEntityId(value: string): Promise<void> {
    if (value == null) {
      await this.storageService.remove(StorageKeys.entityId);
    } else {
      await this.storageService.save(StorageKeys.entityId, value);
    }
  }
}

// Re-export the abstraction for convenience
export { StateService } from "@/libs/abstractions/state.service";
export { DefaultStateService as StateServiceImplementation };
