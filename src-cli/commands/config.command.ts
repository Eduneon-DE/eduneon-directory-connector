import * as fs from "fs";

import * as program from "commander";

import { EnvironmentService, EnvironmentUrls } from "@/libs/abstractions/environment.service";
import { I18nService } from "@/libs/abstractions/i18n.service";
import { StateService } from "@/libs/abstractions/state.service";
import { DirectoryType } from "@/libs/enums/directoryType";
import { EntraIdConfiguration } from "@/libs/models/entraIdConfiguration";
import { GSuiteConfiguration } from "@/libs/models/gsuiteConfiguration";
import { LdapConfiguration } from "@/libs/models/ldapConfiguration";
import { OktaConfiguration } from "@/libs/models/oktaConfiguration";
import { OneLoginConfiguration } from "@/libs/models/oneLoginConfiguration";
import { SyncConfiguration } from "@/libs/models/syncConfiguration";
import { ConnectorUtils } from "@/libs/utils";
import { isPortEmpty, normalizeLdapHost } from "@/libs/utils/ldapHost";
import { NodeUtils } from "@/libs/utils/nodeUtils";

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
    "Which users to read (directory-specific filter)",
  ),
  "sync.groupfilter": s(
    "sync",
    "groupFilter",
    "text",
    "Which groups to read (directory-specific filter)",
  ),
  "sync.interval": s("sync", "interval", "number", "Minutes between syncs in the desktop app"),
  "sync.removedisabled": s("sync", "removeDisabled", "boolean", "Leave out disabled users"),
  "sync.overwriteexisting": s(
    "sync",
    "overwriteExisting",
    "boolean",
    "Replace what an earlier sync sent",
  ),
  "sync.largeimport": s("sync", "largeImport", "boolean", "The directory is very large"),
  "sync.userpath": s(
    "sync",
    "userPath",
    "text",
    "Where users are, below the base DN (e.g. ou=people)",
  ),
  "sync.grouppath": s("sync", "groupPath", "text", "Where groups are, below the base DN"),
  "sync.userobjectclass": s(
    "sync",
    "userObjectClass",
    "text",
    "Object class of a user (e.g. inetOrgPerson)",
  ),
  "sync.groupobjectclass": s(
    "sync",
    "groupObjectClass",
    "text",
    "Object class of a group (e.g. groupOfNames)",
  ),
  "sync.useremailattribute": s(
    "sync",
    "userEmailAttribute",
    "text",
    "Attribute holding a user's e-mail",
  ),
  "sync.groupnameattribute": s(
    "sync",
    "groupNameAttribute",
    "text",
    "Attribute holding a group's name",
  ),
  "sync.memberattribute": s(
    "sync",
    "memberAttribute",
    "text",
    "Attribute listing a group's members",
  ),
  "sync.useemailprefixsuffix": s(
    "sync",
    "useEmailPrefixSuffix",
    "boolean",
    "Build e-mails from an attribute and a suffix",
  ),
  "sync.emailprefixattribute": s(
    "sync",
    "emailPrefixAttribute",
    "text",
    "Attribute for the e-mail's local part",
  ),
  "sync.emailsuffix": s("sync", "emailSuffix", "text", "E-mail domain, e.g. @school.org"),
  "sync.creationdateattribute": s(
    "sync",
    "creationDateAttribute",
    "text",
    "Attribute with the creation date",
  ),
  "sync.revisiondateattribute": s(
    "sync",
    "revisionDateAttribute",
    "text",
    "Attribute with the last change date",
  ),
  "sync.inviteusersafterprovisioning": s(
    "sync",
    "inviteUsersAfterProvisioning",
    "boolean",
    "Send invitation emails to synced users",
  ),
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

export class ConfigCommand {
  private directory: DirectoryType;
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
  ) {}

  async run(setting: string, value: string, options: program.OptionValues): Promise<Response> {
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

      const definition = SETTINGS[key];
      if (definition == null) {
        return Response.badRequest(
          `Unknown setting "${setting}". Run "eduneon-dc config --help" to see all settings.`,
        );
      }
      const raw = await this.readValue(value, options, definition);
      await this.loadConfig();
      this.config(definition.section)[definition.field] = this.parse(raw, definition, setting);
      if (definition.section === "ldap" && definition.field === "hostname") {
        this.cleanLdapHostname();
      }
      await this.saveConfig();
      return this.saved(setting);
    } catch (e) {
      return Response.error(e);
    }
  }

  private saved(what: string) {
    return Response.success(new MessageResponse(this.i18nService.t("savedSetting", what), null));
  }

  /**
   * The value itself, or for a secret from --secretenv / --secretfile, so it never has to be typed on a
   * command line (where it would land in the shell history and the process list).
   */
  private async readValue(value: string, options: program.OptionValues, definition: Setting) {
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
      return definition.field === "privateKey"
        ? fs.readFileSync(options.secretfile, "utf8")
        : await NodeUtils.readFirstLine(options.secretfile);
    }
    if (definition.kind === "secret") {
      throw new Error("Give the value, or --secretenv <variable> or --secretfile <file>.");
    }
    return null;
  }

  private parse(raw: string, definition: Setting, name: string): unknown {
    if (raw == null || raw === "" || raw.toLowerCase() === "null") {
      return null;
    }
    switch (definition.kind) {
      case "number": {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) {
          throw new Error(`${name} must be a whole number.`);
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

  /** "ldaps://dc1:636/" → hostname "dc1"; the port goes to ldap.port when that is empty. */
  private cleanLdapHostname() {
    if (this.ldap.hostname == null) {
      return;
    }
    const { hostname, port } = normalizeLdapHost(this.ldap.hostname);
    if (hostname === "") {
      throw new Error(this.i18nService.t("ldapHostnameMissing"));
    }
    this.ldap.hostname = hostname;
    if (port != null && isPortEmpty(this.ldap.port)) {
      this.ldap.port = port;
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
    url = url === "null" || url === "default" ? null : url;
    const urls = new EnvironmentUrls();
    urls.base = url;
    await this.environmentService.setUrls(urls);
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
      shown.add(id);
      const value = this.config(definition.section)[definition.field];
      let text = value == null || value === "" ? "-" : String(value);
      if (definition.kind === "secret") {
        text = value ? "(set)" : "(not set)";
      }
      lines.push(`${name}: ${text}`);
    }
    return Response.success(new StringResponse(lines.join("\n")));
  }

  /** Every non-secret setting as JSON, to set up another server with `config import`. */
  private async export(path: string) {
    await this.loadConfig();
    const withoutSecrets = (section: Section) => {
      const copy: Record<string, unknown> = { ...this.config(section) };
      delete copy.id;
      for (const definition of Object.values(SETTINGS)) {
        if (definition.section === section && definition.kind === "secret") {
          delete copy[definition.field];
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
      for (const definition of Object.values(SETTINGS)) {
        if (
          definition.section === section &&
          definition.kind !== "secret" &&
          definition.field in values
        ) {
          target[definition.field] = values[definition.field];
        }
      }
    }
    await this.saveConfig();
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
    ConnectorUtils.adjustConfigForSave(this.ldap, this.sync);
    await this.stateService.setDirectoryType(this.directory);
    await this.stateService.setDirectory(DirectoryType.Ldap, this.ldap);
    await this.stateService.setDirectory(DirectoryType.GSuite, this.gsuite);
    await this.stateService.setDirectory(DirectoryType.EntraID, this.entra);
    await this.stateService.setDirectory(DirectoryType.Okta, this.okta);
    await this.stateService.setDirectory(DirectoryType.OneLogin, this.oneLogin);
    await this.stateService.setSync(this.sync);
  }
}
