import { DirectoryFactoryService } from "@/libs/abstractions/directory-factory.service";
import { EnvironmentService } from "@/libs/abstractions/environment.service";
import { SecureStorageService } from "@/libs/abstractions/storage.service";
import { TokenService } from "@/libs/abstractions/token.service";
import { ClientType } from "@/libs/enums/clientType";
import { LogLevelType } from "@/libs/enums/logLevelType";
import { AppIdService } from "@/libs/services/appId.service";
import { AuthService } from "@/libs/services/auth.service";
import { DefaultDirectoryFactoryService } from "@/libs/services/directory-factory.service";
import { DefaultEnvironmentService as EnvironmentServiceImplementation } from "@/libs/services/environment/environment.service";
import { applyServerOverride } from "@/libs/services/environment/server-override";
import { I18nService } from "@/libs/services/i18n.service";
import { LowdbStorageService } from "@/libs/services/lowdbStorage.service";
import { NativeSecureStorageService } from "@/libs/services/nativeSecureStorage.service";
import { NoopMessagingService } from "@/libs/services/noopMessaging.service";
import {
  DefaultStateService,
  StateService,
} from "@/libs/services/state-service/default-state.service";
import { StateMigrationService } from "@/libs/services/state-service/stateMigration.service";
import { SyncService } from "@/libs/services/sync.service";
import { TokenService as TokenServiceImplementation } from "@/libs/services/token/token.service";
import { secureStorageServiceName } from "@/libs/utils/secureStorageName";

import { CliPlatformUtilsService } from "@/src-cli/services/cliPlatformUtils.service";
import { ConsoleLogService } from "@/src-cli/services/consoleLog.service";
import { cliDataFolder } from "@/src-cli/services/node/dataFolder";
import { NodeApiService } from "@/src-cli/services/node/nodeApi.service";
import { trustSystemCaCertificates } from "@/src-cli/services/node/trustSystemCaCertificates";

import packageJson from "../package.json";

import { Program } from "./program";

export class Main {
  dataFilePath: string;
  /** The name of this data folder's keychain entries (see secureStorageServiceName). */
  secureStorageServiceName: string;
  /** Secrets are kept in data.json (EDUNEON_DC_PLAINTEXT_SECRETS), not in the keychain. */
  plaintextSecrets: boolean;
  logService: ConsoleLogService;
  program: Program;

  messagingService: NoopMessagingService;
  storageService: LowdbStorageService;
  secureStorageService: SecureStorageService;
  i18nService: I18nService;
  platformUtilsService: CliPlatformUtilsService;
  tokenService: TokenService;
  appIdService: AppIdService;
  apiService: NodeApiService;
  environmentService: EnvironmentService;
  authService: AuthService;
  syncService: SyncService;
  stateService: StateService;
  stateMigrationService: StateMigrationService;
  directoryFactoryService: DirectoryFactoryService;

  constructor() {
    const { dataFolder, defaultDataFolder } = cliDataFolder();
    this.dataFilePath = dataFolder;
    // A data folder other than the default one has keychain entries of its own; the default
    // folder, which the desktop app uses too, keeps the name it always had.
    this.secureStorageServiceName = secureStorageServiceName(dataFolder, defaultDataFolder);

    const plaintextSecrets = process.env.EDUNEON_DC_PLAINTEXT_SECRETS === "true";
    this.plaintextSecrets = plaintextSecrets;
    this.i18nService = new I18nService("en", "./locales");
    this.platformUtilsService = new CliPlatformUtilsService(
      ClientType.DirectoryConnector,
      packageJson,
    );
    this.logService = new ConsoleLogService(
      this.platformUtilsService.isDev(),
      (level) => process.env.EDUNEON_DC_DEBUG !== "true" && level <= LogLevelType.Info,
    );
    this.storageService = new LowdbStorageService(
      this.logService,
      null,
      this.dataFilePath,
      false,
      true,
    );
    this.secureStorageService = plaintextSecrets
      ? this.storageService
      : new NativeSecureStorageService(this.secureStorageServiceName, this.logService);

    this.stateMigrationService = new StateMigrationService(
      this.storageService,
      this.secureStorageService,
      this.logService,
      !plaintextSecrets,
      this.secureStorageServiceName,
    );

    this.stateService = new DefaultStateService(
      this.storageService,
      this.secureStorageService,
      this.logService,
      this.stateMigrationService,
      process.env.EDUNEON_DC_PLAINTEXT_SECRETS !== "true",
    );

    this.appIdService = new AppIdService(this.storageService);
    this.tokenService = new TokenServiceImplementation(this.secureStorageService);
    this.messagingService = new NoopMessagingService();
    this.environmentService = new EnvironmentServiceImplementation(this.stateService);

    const customUserAgent =
      "Eduneon_DC/" +
      this.platformUtilsService.getApplicationVersion() +
      " (" +
      this.platformUtilsService.getDeviceString().toUpperCase() +
      ")";
    this.apiService = new NodeApiService(
      this.tokenService,
      this.platformUtilsService,
      this.stateService,
      this.appIdService,
      async (expired: boolean) => await this.logout(),
      customUserAgent,
    );

    this.authService = new AuthService(this.apiService, this.messagingService, this.stateService);

    this.directoryFactoryService = new DefaultDirectoryFactoryService(
      this.logService,
      this.i18nService,
      this.stateService,
    );

    this.syncService = new SyncService(
      this.apiService,
      this.messagingService,
      this.stateService,
      this.directoryFactoryService,
    );

    this.program = new Program(this);
  }

  async run() {
    await this.init();
    this.program.run();
  }

  async logout() {
    await this.stateService.clearAuthTokens();
  }

  private async init() {
    await this.storageService.init();
    await this.stateService.init();
    await applyServerOverride(this.stateService);
    await this.environmentService.setUrlsFromStorage();
    if (!this.environmentService.isCloud()) {
      trustSystemCaCertificates(this.logService);
    }
    // Dev Server URLs. Comment out the line above.
    // this.apiService.setUrls({
    //     base: null,
    //     api: 'http://localhost:4000',
    //     identity: 'http://localhost:33656',
    // });
    const locale = await this.stateService.getLocale();
    await this.i18nService.init(locale);

    const installedVersion = await this.stateService.getInstalledVersion();
    const currentVersion = await this.platformUtilsService.getApplicationVersion();
    if (installedVersion == null || installedVersion !== currentVersion) {
      await this.stateService.setInstalledVersion(currentVersion);
    }
  }
}

const main = new Main();
await main.run();
