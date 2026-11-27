import * as fs from "fs";

import * as program from "commander";

import { EnvironmentService, EnvironmentUrls } from "@/libs/abstractions/environment.service";
import { I18nService } from "@/libs/abstractions/i18n.service";
import { StateService } from "@/libs/abstractions/state.service";
import { DEFAULT_SERVER_URL } from "@/libs/constants";
import { DirectoryType } from "@/libs/enums/directoryType";
import { EntraIdConfiguration } from "@/libs/models/entraIdConfiguration";
import { GSuiteConfiguration } from "@/libs/models/gsuiteConfiguration";
import { LdapConfiguration } from "@/libs/models/ldapConfiguration";
import { OktaConfiguration } from "@/libs/models/oktaConfiguration";
import { OneLoginConfiguration } from "@/libs/models/oneLoginConfiguration";
import { ldapUnusedFilters, SyncConfiguration } from "@/libs/models/syncConfiguration";
import { ConnectorUtils } from "@/libs/utils";
import { applyLdapHostInput } from "@/libs/utils/ldapHost";
import { NodeUtils } from "@/libs/utils/nodeUtils";
import { MIN_SYNC_INTERVAL_MINUTES } from "@/libs/utils/syncInterval";

import { Response } from "@/src-cli/models/response";
import { MessageResponse } from "@/src-cli/models/response/messageResponse";
import { StringResponse } from "@/src-cli/models/response/stringResponse";

type Section = "ldap" | "entra" | "gsuite" | "okta" | "onelogin" | "sync";
type Kind = "text" | "number" | "boolean" | "secret";

/** One setting `eduneon-dc config <section>.<name> <value>` can change. */
export type Setting = { section: Section; field: string; kind: Kind; help: string };

const s = (section: Section, field: string, kind: Kind, help: string): Setting => ({
  section,
  field,
  kind,
  help,
});

/**
 * Everything a directory needs to be read, settable from a terminal: a server has no desktop app to
 * configure it with. Keys are matched case-insensitively; aliases point at the same field.
 */
export const SETTINGS: Record<string, Setting> = {
  "ldap.hostname": s(
    "ldap",
    "hostname",
    "text",
    "Directory server host name or IP (ldap://, ldaps:// and :port are taken off)",
  ),
  "ldap.port": s("ldap", "port", "number", "Port: 389 (LDAP, StartTLS) or 636 (LDAPS)"),
  "ldap.ssl": s(
    "ldap",
    "ssl",
    "boolean",
    "Encrypt the connection: LDAPS, or StartTLS with ldap.starttls",
  ),
  "ldap.starttls": s(
    "ldap",
    "startTls",
    "boolean",
    "Encrypt with StartTLS on the plain port instead of LDAPS (the connection fails without it)",
  ),
  "ldap.tlscapath": s("ldap", "tlsCaPath", "text", "CA certificate file for StartTLS"),
  "ldap.sslcapath": s("ldap", "sslCaPath", "text", "CA certificate file for LDAPS"),
  "ldap.sslcertpath": s("ldap", "sslCertPath", "text", "Client certificate file (LDAPS)"),
  "ldap.sslkeypath": s("ldap", "sslKeyPath", "text", "Client key file (LDAPS)"),
  "ldap.sslallowunauthorized": s(
    "ldap",
    "sslAllowUnauthorized",
    "boolean",
    "Accept a certificate that cannot be verified (testing only)",
  ),
  "ldap.rootpath": s("ldap", "rootPath", "text", "Base DN to read, e.g. dc=school,dc=local"),
  "ldap.basedn": s("ldap", "rootPath", "text", "Same as ldap.rootPath"),
  "ldap.username": s("ldap", "username", "text", "Bind DN or user name"),
  "ldap.password": s("ldap", "password", "secret", "Bind password"),
  "ldap.ad": s("ldap", "ad", "boolean", "The server is Active Directory"),
  "ldap.pagedsearch": s(
    "ldap",
    "pagedSearch",
    "boolean",
    "Read in pages (AD returns at most 1000 otherwise)",
  ),
  "ldap.currentuser": s(
    "ldap",
    "currentUser",
    "boolean",
    "Bind as the Windows user running the connector",
  ),
  "ldap.domain": s("ldap", "domain", "text", "Domain of that Windows user"),
  "entra.tenant": s("entra", "tenant", "text", "Tenant ID or domain"),
  "entra.applicationid": s("entra", "applicationId", "text", "Application (client) ID"),
  "entra.key": s("entra", "key", "secret", "Client secret"),
  "azure.key": s("entra", "key", "secret", "Same as entra.key"),
  "entra.identityauthority": s(
    "entra",
    "identityAuthority",
    "text",
    "Login host, default login.microsoftonline.com",
  ),
  "gsuite.domain": s("gsuite", "domain", "text", "Google Workspace domain"),
  "gsuite.adminuser": s("gsuite", "adminUser", "text", "Admin user the service account acts as"),
  "gsuite.clientemail": s("gsuite", "clientEmail", "text", "Service account e-mail"),
  "gsuite.customer": s("gsuite", "customer", "text", "Customer ID (optional)"),
  "gsuite.key": s("gsuite", "privateKey", "secret", "Service account private key (PEM)"),
  "okta.orgurl": s("okta", "orgUrl", "text", "Okta organization URL"),
  "okta.token": s("okta", "token", "secret", "Okta API token"),
  "onelogin.clientid": s("onelogin", "clientId", "text", "OneLogin client ID"),
  "onelogin.secret": s("onelogin", "clientSecret", "secret", "OneLogin client secret"),
  "onelogin.region": s("onelogin", "region", "text", "OneLogin region: us or eu"),
  "sync.users": s("sync", "users", "boolean", "Read users (Entra ID, Google, Okta, OneLogin)"),
  "sync.groups": s("sync", "groups", "boolean", "Read groups (Entra ID, Google, Okta, OneLogin)"),
  "sync.userfilter": s(
    "sync",
    "userFilter",
    "text",
    "Which users to read (Entra ID, Google, Okta, OneLogin)",
  ),
  "sync.groupfilter": s(
    "sync",
    "groupFilter",
    "text",
    "Which groups to read (Entra ID, Google, Okta, OneLogin)",
  ),
  "sync.interval": s(
    "sync",
    "interval",
    "number",
    "Minutes between syncs in the desktop app (at least 5; 0 switches it off)",
  ),
  "sync.removedisabled": s(
    "sync",
    "removeDisabled",
    "boolean",
    "Leave out disabled users (Entra ID, Google, Okta, OneLogin)",
  ),
  "sync.useemailprefixsuffix": s(
    "sync",
    "useEmailPrefixSuffix",
    "boolean",
    "OneLogin: give a user without an e-mail the user name and sync.emailSuffix",
  ),
  "sync.emailsuffix": s("sync", "emailSuffix", "text", "OneLogin: e-mail domain, e.g. @school.org"),
};

/** Directory names `config directory` accepts, besides the numbers. */
const DIRECTORY_NAMES: Record<string, DirectoryType> = {
  ldap: DirectoryType.Ldap,
  ad: DirectoryType.Ldap,
  activedirectory: DirectoryType.Ldap,
  entra: DirectoryType.EntraID,
  entraid: DirectoryType.EntraID,
  azure: DirectoryType.EntraID,
  gsuite: DirectoryType.GSuite,
  google: DirectoryType.GSuite,
  googleworkspace: DirectoryType.GSuite,
  okta: DirectoryType.Okta,
  onelogin: DirectoryType.OneLogin,
};

const SECTION_OF_DIRECTORY: Record<DirectoryType, Section> = {
  [DirectoryType.Ldap]: "ldap",
  [DirectoryType.EntraID]: "entra",
  [DirectoryType.GSuite]: "gsuite",
  [DirectoryType.Okta]: "okta",
  [DirectoryType.OneLogin]: "onelogin",
};

const SECTIONS: Section[] = ["ldap", "entra", "gsuite", "okta", "onelogin", "sync"];

/** Why no LDAP setting chooses what is sent. */
const LDAP_SENDS_EVERYTHING =
  "an LDAP sync sends everything under ldap.rootPath, and Cockpit's mappings choose what is imported";

/**
 * Settings taken over from Bitwarden's connector that no sync here uses, kept to answer an old
 * script clearly. The LDAP ones only shaped a user and group search that a sync no longer makes; the
 * others were options of Bitwarden's import. An export from an earlier version may still hold them:
 * `config import` passes over them.
 */
const REMOVED_SETTINGS: Record<string, string> = {
  "sync.userpath": LDAP_SENDS_EVERYTHING,
  "sync.grouppath": LDAP_SENDS_EVERYTHING,
  "sync.userobjectclass": LDAP_SENDS_EVERYTHING,
  "sync.groupobjectclass": LDAP_SENDS_EVERYTHING,
  "sync.useremailattribute": LDAP_SENDS_EVERYTHING,
  "sync.groupnameattribute": LDAP_SENDS_EVERYTHING,
  "sync.memberattribute": LDAP_SENDS_EVERYTHING,
  "sync.emailprefixattribute": LDAP_SENDS_EVERYTHING,
  "sync.creationdateattribute": LDAP_SENDS_EVERYTHING,
  "sync.revisiondateattribute": LDAP_SENDS_EVERYTHING,
  "sync.overwriteexisting":
    "every sync sends the whole directory, and Cockpit decides what to do with it",
  "sync.largeimport": "every sync sends the whole directory, in parts, whatever its size",
  "sync.inviteusersafterprovisioning": "Cockpit decides what to do with the accounts it imports",
};

/**
 * sync.* settings of the other directories, which mean nothing to an LDAP sync: with LDAP chosen, a
 * value is refused (clearing one is not) and `config show` leaves them out.
 */
const NOT_FOR_LDAP = new Set([
  "users",
  "groups",
  "userFilter",
  "groupFilter",
  "removeDisabled",
  "useEmailPrefixSuffix",
  "emailSuffix",
]);

/** A value that does something: not empty, not off. */
function holdsValue(value: unknown): boolean {
  return value != null && value !== false && !(typeof value === "string" && value.trim() === "");
}

/** Holds a lock across one whole read-change-write of the settings (see run). */
export type ConfigLock = <T>(action: () => Promise<T>) => Promise<T>;

export class ConfigCommand {
  private directory: DirectoryType;
  /** sync.* settings this command did not keep because an LDAP sync does not use them. */
  private notKeptForLdap: string[] = [];
  private ldap = new LdapConfiguration();
  private gsuite = new GSuiteConfiguration();
  private entra = new EntraIdConfiguration();
  private okta = new OktaConfiguration();
  private oneLogin = new OneLoginConfiguration();
  private sync = new SyncConfiguration();

  constructor(
    private i18nService: I18nService,
    private stateService: StateService,
    private environmentService: EnvironmentService,
    /**
     * Every command reads all settings, changes one and writes all of them back: two at once (a
     * setup script) would each write the other's change away. The CLI passes a file lock.
     */
    private lockConfig: ConfigLock = (action) => action(),
  ) {}

  async run(setting: string, value: string, options: program.OptionValues): Promise<Response> {
    try {
      return await this.lockConfig(() => this.runLocked(setting, value, options));
    } catch (e) {
      return Response.error(e);
    }
  }

  private async runLocked(
    setting: string,
    value: string,
    options: program.OptionValues,
  ): Promise<Response> {
    const key = setting.toLowerCase();
    try {
      switch (key) {
        case "show":
          return await this.show();
        case "export":
          return await this.export(value);
        case "import":
          await this.import(value);
          return this.saved(`settings from ${value}`);
        case "server":
          await this.setServer(value);
          return this.saved(setting);
        case "directory":
          await this.setDirectory(value);
          return this.saved(setting);
        case "gsuite.keyfile":
          await this.setGSuiteKeyFile(value || options.secretfile);
          return this.saved(setting);
      }

      if (key in REMOVED_SETTINGS) {
        return Response.badRequest(`${setting} is no longer a setting: ${REMOVED_SETTINGS[key]}.`);
      }
      const definition = SETTINGS[key];
      if (definition == null) {
        return Response.badRequest(
          `Unknown setting "${setting}". Run "eduneon-dc config --help" to see all settings.`,
        );
      }
      const raw = await this.readValue(value, options, definition, setting);
      await this.loadConfig();
      const parsed = this.parse(raw, definition, setting);
      if (this.notForLdap(definition) && holdsValue(parsed)) {
        throw new Error(
          `${setting} is not used with LDAP: ${LDAP_SENDS_EVERYTHING}. ("null" clears it.)`,
        );
      }
      this.config(definition.section)[definition.field] = parsed;
      if (definition.section === "ldap" && definition.field === "hostname") {
        this.cleanLdapHostname();
      }
      await this.saveConfig();
      return this.saved(setting, this.noteAbout(definition));
    } catch (e) {
      return Response.error(e);
    }
  }

  private saved(what: string, note: string = null) {
    const notes = [note];
    if (this.notKeptForLdap.length > 0) {
      // Values an earlier version saved, or an imported file held.
      notes.push(
        `Not kept, as an LDAP sync does not use them: ${[...new Set(this.notKeptForLdap)].join(", ")}. ` +
          `A sync sends everything under ldap.rootPath; choose what is imported in Cockpit's mappings.`,
      );
    }
    const message = notes.filter((n) => n != null).join("\n");
    return Response.success(
      new MessageResponse(
        this.i18nService.t("savedSetting", what),
        message === "" ? null : message,
      ),
    );
  }

  /** What the saved value means, when it is not what the admin may expect. */
  private noteAbout(definition: Setting): string {
    if (
      definition.section === "sync" &&
      definition.field === "interval" &&
      this.sync.interval == null
    ) {
      return "The desktop app's automatic sync is off.";
    }
    return null;
  }

  /** A setting of the other directories, while LDAP is the directory in use. */
  private notForLdap(definition: Setting): boolean {
    return (
      this.directory === DirectoryType.Ldap &&
      definition.section === "sync" &&
      NOT_FOR_LDAP.has(definition.field)
    );
  }

  /**
   * The value itself, or for a secret from --secretenv / --secretfile, so it never has to be typed on a
   * command line (where it would land in the shell history and the process list).
   */
  private async readValue(
    value: string,
    options: program.OptionValues,
    definition: Setting,
    name: string,
  ) {
    if (value != null && value !== "") {
      return value;
    }
    if (options.secretenv) {
      const fromEnv = process.env[options.secretenv];
      if (fromEnv == null || fromEnv === "") {
        throw new Error(`The environment variable ${options.secretenv} is not set.`);
      }
      return fromEnv;
    }
    if (options.secretfile) {
      // A PEM key spans several lines; every other secret is the file's first line.
      const fromFile =
        definition.field === "privateKey"
          ? fs.readFileSync(options.secretfile, "utf8")
          : await NodeUtils.readFirstLine(options.secretfile);
      if (fromFile == null || fromFile.trim() === "") {
        throw new Error(`The file ${options.secretfile} is empty.`);
      }
      return fromFile;
    }
    if (definition.kind === "secret") {
      throw new Error("Give the value, or --secretenv <variable> or --secretfile <file>.");
    }
    if (value === "") {
      // An explicit "" clears the setting, like "null".
      return "";
    }
    // A missing value is a mistake (an unset variable in a script), not a way to clear the setting.
    throw new Error(`Give a value for ${name}, or "null" to clear it.`);
  }

  private parse(raw: string, definition: Setting, name: string): unknown {
    if (raw == null || raw === "" || raw.toLowerCase() === "null") {
      return null;
    }
    switch (definition.kind) {
      case "number": {
        const n = Number(raw.trim());
        if (!Number.isInteger(n)) {
          throw new Error(`${name} must be a whole number.`);
        }
        if (definition.section === "ldap" && definition.field === "port") {
          if (n < 1 || n > 65535) {
            throw new Error(`${name} must be a port number from 1 to 65535.`);
          }
          return n;
        }
        if (n < 0) {
          throw new Error(`${name} must be 0 or more.`);
        }
        if (
          definition.section === "sync" &&
          definition.field === "interval" &&
          n > 0 &&
          n < MIN_SYNC_INTERVAL_MINUTES
        ) {
          throw new Error(
            `${name} must be at least ${MIN_SYNC_INTERVAL_MINUTES} minutes (0 switches the automatic sync off).`,
          );
        }
        return n;
      }
      case "boolean": {
        const v = raw.toLowerCase();
        if (["true", "yes", "1", "on"].includes(v)) {
          return true;
        }
        if (["false", "no", "0", "off"].includes(v)) {
          return false;
        }
        throw new Error(`${name} must be true or false.`);
      }
      case "secret":
        return definition.field === "privateKey" ? raw.trimStart() : raw;
      default:
        return raw.trim();
    }
  }

  /** "ldaps://dc1:636/" → hostname "dc1", port 636, LDAPS. */
  private cleanLdapHostname() {
    if (this.ldap.hostname == null) {
      return;
    }
    applyLdapHostInput(this.ldap);
    if (this.ldap.hostname === "") {
      throw new Error(this.i18nService.t("ldapHostnameMissing"));
    }
  }

  private config(section: Section): Record<string, unknown> {
    const configs: Record<Section, object> = {
      ldap: this.ldap,
      entra: this.entra,
      gsuite: this.gsuite,
      okta: this.okta,
      onelogin: this.oneLogin,
      sync: this.sync,
    };
    return configs[section] as Record<string, unknown>;
  }

  private async setServer(url: string) {
    if (url == null || url.trim() === "") {
      throw new Error('Give the server URL, or "default" for the Eduneon cloud.');
    }
    url = url === "null" || url === "default" ? null : url;
    // The API token and the directory belong to the server they were given for: never send them
    // to another one. Logging out first is what `login` asks for too.
    if (
      ConfigCommand.serverKey(url ?? DEFAULT_SERVER_URL) !==
        ConfigCommand.serverKey(this.environmentService.getWebVaultUrl()) &&
      (await this.stateService.getIsAuthenticated())
    ) {
      throw new Error(
        `You are logged in to ${this.environmentService.getWebVaultUrl()}. ` +
          'Run "eduneon-dc logout" before changing the server: the API token is only for that server.',
      );
    }
    const urls = new EnvironmentUrls();
    urls.base = url;
    await this.environmentService.setUrls(urls);
  }

  /** A server URL in one spelling, the way EnvironmentService saves it. */
  private static serverKey(url: string): string {
    let key = url
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/api$/i, "");
    if (!/^https?:\/\//i.test(key)) {
      key = "https://" + key;
    }
    return key.toLowerCase();
  }

  private async setDirectory(type: string) {
    const name = (type ?? "").toLowerCase().replace(/[\s_-]/g, "");
    const dir = name in DIRECTORY_NAMES ? DIRECTORY_NAMES[name] : parseInt(type, 10);
    if (!Number.isInteger(dir) || dir < DirectoryType.Ldap || dir > DirectoryType.OneLogin) {
      throw new Error("Directory must be one of: ldap, entra, gsuite, okta, onelogin (or 0-4).");
    }
    await this.loadConfig();
    this.directory = dir;
    await this.saveConfig();
  }

  /** A Google service account's JSON key file: its e-mail and private key in one step. */
  private async setGSuiteKeyFile(path: string) {
    if (!path) {
      throw new Error("Give the path of the service account's JSON key file.");
    }
    const key = JSON.parse(fs.readFileSync(path, "utf8"));
    if (!key.client_email || !key.private_key) {
      throw new Error(`${path} is not a service account key (no client_email / private_key).`);
    }
    await this.loadConfig();
    this.gsuite.clientEmail = key.client_email;
    this.gsuite.privateKey = key.private_key;
    await this.saveConfig();
  }

  /** The current settings of the chosen directory, secrets shown only as set or not set. */
  private async show() {
    await this.loadConfig();
    const section = this.directory != null ? SECTION_OF_DIRECTORY[this.directory] : null;
    const lines = [
      `server: ${this.environmentService.getWebVaultUrl()}`,
      `directory: ${section ?? "(not set)"}`,
    ];
    const shown = new Set<string>();
    for (const [name, definition] of Object.entries(SETTINGS)) {
      const id = `${definition.section}.${definition.field}`;
      if ((definition.section !== section && definition.section !== "sync") || shown.has(id)) {
        continue;
      }
      if (this.notForLdap(definition)) {
        continue;
      }
      shown.add(id);
      const value = this.config(definition.section)[definition.field];
      let text = value == null || value === "" ? "-" : String(value);
      if (definition.kind === "secret") {
        text = value ? "(set)" : "(not set)";
      }
      lines.push(`${name}: ${text}`);
    }
    const unused = this.directory === DirectoryType.Ldap ? ldapUnusedFilters(this.sync) : [];
    if (unused.length > 0) {
      lines.push(
        `Not used by an LDAP sync, and removed on the next save: ${unused.map((f) => `sync.${f}`).join(", ")}` +
          ` (${LDAP_SENDS_EVERYTHING}).`,
      );
    }
    return Response.success(new StringResponse(lines.join("\n")));
  }

  /** Every non-secret setting as JSON, to set up another server with `config import`. */
  private async export(path: string) {
    await this.loadConfig();
    // The settings `config` has, so no secret, no id, and none of the REMOVED_SETTINGS.
    const withoutSecrets = (section: Section) => {
      const config = this.config(section);
      const copy: Record<string, unknown> = {};
      for (const definition of Object.values(SETTINGS)) {
        if (
          definition.section === section &&
          definition.kind !== "secret" &&
          definition.field in config
        ) {
          copy[definition.field] = config[definition.field];
        }
      }
      return copy;
    };
    const data: Record<string, unknown> = {
      server: this.environmentService.getWebVaultUrl(),
      directory: this.directory != null ? SECTION_OF_DIRECTORY[this.directory] : null,
    };
    for (const section of SECTIONS) {
      data[section] = withoutSecrets(section);
    }
    const json = JSON.stringify(data, null, 2);
    if (path) {
      fs.writeFileSync(path, json + "\n", { mode: 0o600 });
      return this.saved(`settings to ${path}`);
    }
    return Response.success(new StringResponse(json));
  }

  /** Settings from a file written by `config export`. Secrets are set separately. */
  private async import(path: string) {
    if (!path) {
      throw new Error("Give the path of a file written by `eduneon-dc config export`.");
    }
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    if (data.server) {
      await this.setServer(data.server);
    }
    await this.loadConfig();
    if (data.directory != null) {
      const name = String(data.directory).toLowerCase();
      this.directory = name in DIRECTORY_NAMES ? DIRECTORY_NAMES[name] : Number(data.directory);
    }
    for (const section of SECTIONS) {
      const values = data[section];
      if (values == null) {
        continue;
      }
      const target = this.config(section);
      for (const [name, definition] of Object.entries(SETTINGS)) {
        if (
          definition.section === section &&
          definition.kind !== "secret" &&
          definition.field in values
        ) {
          // The same rules as `config <setting> <value>`: a file is no way around them.
          const value = this.parseImported(values[definition.field], definition, name);
          if (this.notForLdap(definition) && holdsValue(value)) {
            // An export from another directory, or from an earlier version: left out, and said.
            this.notKeptForLdap.push(`sync.${definition.field}`);
            continue;
          }
          target[definition.field] = value;
        }
      }
    }
    await this.saveConfig();
  }

  private parseImported(value: unknown, definition: Setting, name: string): unknown {
    if (value == null) {
      return null;
    }
    if (typeof value === "object") {
      throw new Error(`${name} in the file must be a single value.`);
    }
    if (definition.kind === "text") {
      // Text is kept as written ("" clears it, as an export writes an unset value).
      return String(value).trim() === "" ? null : String(value).trim();
    }
    return this.parse(String(value), definition, name);
  }

  private async loadConfig() {
    this.directory = await this.stateService.getDirectoryType();
    this.ldap =
      (await this.stateService.getDirectory<LdapConfiguration>(DirectoryType.Ldap)) || this.ldap;
    this.gsuite =
      (await this.stateService.getDirectory<GSuiteConfiguration>(DirectoryType.GSuite)) ||
      this.gsuite;
    this.entra =
      (await this.stateService.getDirectory<EntraIdConfiguration>(DirectoryType.EntraID)) ||
      this.entra;
    this.okta =
      (await this.stateService.getDirectory<OktaConfiguration>(DirectoryType.Okta)) || this.okta;
    this.oneLogin =
      (await this.stateService.getDirectory<OneLoginConfiguration>(DirectoryType.OneLogin)) ||
      this.oneLogin;
    this.sync = (await this.stateService.getSync()) || this.sync;
  }

  private async saveConfig() {
    const removed = ConnectorUtils.adjustConfigForSave(this.ldap, this.sync, this.directory);
    this.notKeptForLdap.push(...removed.map((field) => `sync.${field}`));
    await this.stateService.setDirectoryType(this.directory);
    await this.stateService.setDirectory(DirectoryType.Ldap, this.ldap);
    await this.stateService.setDirectory(DirectoryType.GSuite, this.gsuite);
    await this.stateService.setDirectory(DirectoryType.EntraID, this.entra);
    await this.stateService.setDirectory(DirectoryType.Okta, this.okta);
    await this.stateService.setDirectory(DirectoryType.OneLogin, this.oneLogin);
    await this.stateService.setSync(this.sync);
  }
}
