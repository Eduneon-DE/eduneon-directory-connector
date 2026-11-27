import * as fs from "fs";
import * as tls from "tls";

import * as ldapts from "ldapts";

import { I18nService } from "@/libs/abstractions/i18n.service";
import { LogService } from "@/libs/abstractions/log.service";
import { StateService } from "@/libs/abstractions/state.service";
import { normalizeDn } from "@/libs/utils/dn";
import { isPortEmpty, normalizeLdapHost } from "@/libs/utils/ldapHost";
import { Utils } from "@/libs/utils/utils";

import { DirectoryType } from "../../enums/directoryType";
import { GroupEntry } from "../../models/groupEntry";
import { LdapConfiguration } from "../../models/ldapConfiguration";
import { ldapUnusedFilters, SyncConfiguration } from "../../models/syncConfiguration";
import { UserEntry } from "../../models/userEntry";

import { DirectorySnapshot, IDirectoryService } from "./directory.service";
import { fromLdapEntry, MAX_VALUE_LENGTH, ReadLimits } from "./raw-entry";

const UserControlAccountDisabled = 2;

/**
 * The attribute name for the unique identifier used by Active Directory.
 */
const ActiveDirectoryExternalId = "objectGUID";

/**
 * Binary attributes, read as bytes and sent to Cockpit as base64: the same ids Cockpit reads as
 * binary (BINARY_ATTRIBUTES in its directory-sync.profiles.ts). ldapts matches these names exactly,
 * so the spellings servers use are all listed; a GUID that happens to be valid UTF-8 would otherwise
 * arrive as text, with a NUL byte Cockpit cannot store.
 */
const BinaryAttributes = [
  ActiveDirectoryExternalId,
  "objectGuid",
  "objectguid",
  "objectSid",
  "objectSID",
  "objectsid",
  "mS-DS-ConsistencyGuid",
  "ms-DS-ConsistencyGuid",
  "ms-ds-consistencyguid",
  "GUID",
  "guid",
];

/**
 * Attributes requested on every search: all user attributes, plus the operational ones Cockpit's
 * mappings commonly use (OpenLDAP keeps memberOf and entryUUID operational; AD returns them anyway),
 * and the operational ids Cockpit offers as stable ids (nsUniqueId on 389 DS, orclGUID on Oracle,
 * GUID on eDirectory): "*" never returns them. A server without one simply leaves it out.
 */
const RequestedAttributes = [
  "*",
  "memberOf",
  "entryUUID",
  // What an entry is (OpenLDAP, 389 DS): Cockpit types entries by it.
  "structuralObjectClass",
  "nsUniqueId",
  "orclGUID",
  "GUID",
  "modifyTimestamp",
  "createTimestamp",
];

/**
 * Active Directory answers a search of the domain root with referrals to its own DNS and
 * configuration partitions. Nobody lives there, so they do not make the read incomplete. Windows
 * names the DNS partitions in the host (ldap://DomainDnsZones.corp/…), Samba only in the DN. The
 * same rule as Cockpit's own LDAP read (directory-sync.ldap.ts).
 */
const AD_PARTITION_REFERRAL =
  /\/\/(DomainDnsZones|ForestDnsZones)\.|\/(DC=(DomainDnsZones|ForestDnsZones)|CN=Configuration),/i;

/**
 * ldapts defaults a search's server-side time limit to 10 seconds, which the server enforces
 * and which is too short for expensive but legitimate filters (e.g. LDAP_MATCHING_RULE_IN_CHAIN
 * over nested groups). We override it to a much more generous 5 minutes so slow-but-valid
 * queries can complete, while still bounding a truly runaway query rather than waiting forever.
 */
export const LdapSearchTimeLimitSeconds = 5 * 60;

/** How long to wait for the TCP/TLS connection to the server. */
export const LdapConnectTimeoutMs = 15 * 1000;

/**
 * How long to wait for the answer to one LDAP request (bind, StartTLS, one page of a search).
 * Longer than the server-side search limit, so a slow but valid search is not cut; a server that
 * accepts the connection and never answers fails after this instead of hanging the sync forever.
 */
export const LdapOperationTimeoutMs = (LdapSearchTimeLimitSeconds + 30) * 1000;

/**
 * A short hint about which setting to check, for the errors an admin meets while setting up the
 * connection. Other errors keep their own message.
 */
export function describeLdapError(e: unknown, i18nService: I18nService): Error {
  if (!(e instanceof Error)) {
    return new Error(String(e));
  }
  const code = (e as { code?: unknown }).code;
  const text = `${e.message} ${(e as { cause?: unknown }).cause ?? ""}`;
  let key: string = null;
  // The result code is also read from the text ("… Code: 0x31"): an error that crossed a process
  // boundary keeps only its message.
  if (code === 49 || e.name === "InvalidCredentialsError" || /Code: 0x31\b/.test(text)) {
    key = "ldapErrorInvalidCredentials";
  } else if (code === 32 || e.name === "NoSuchObjectError" || /Code: 0x20\b/.test(text)) {
    key = "ldapErrorNoSuchObject";
  } else if (code === 34 || e.name === "InvalidDNSyntaxError" || /Code: 0x22\b/.test(text)) {
    key = "ldapErrorInvalidDn";
  } else if (code === 4 || e.name === "SizeLimitExceededError" || /Code: 0x4\b/.test(text)) {
    key = "ldapErrorSizeLimit";
  } else if (code === 50 || e.name === "InsufficientAccessError" || /Code: 0x32\b/.test(text)) {
    key = "ldapErrorInsufficientAccess";
  } else if (
    code === 8 ||
    code === 13 ||
    e.name === "StrongAuthRequiredError" ||
    e.name === "ConfidentialityRequiredError" ||
    /Code: 0x(8|d)\b/.test(text)
  ) {
    key = "ldapErrorEncryptionRequired";
  } else if (code === 3 || e.name === "TimeLimitExceededError" || /Code: 0x3\b/.test(text)) {
    key = "ldapErrorTimeLimit";
  } else if (code === "ENOTFOUND" || code === "EAI_AGAIN" || /ENOTFOUND|EAI_AGAIN/.test(text)) {
    key = "ldapErrorHostNotFound";
  } else if (code === "ECONNREFUSED" || /ECONNREFUSED/.test(text)) {
    key = "ldapErrorConnectionRefused";
  } else if (
    code === "ETIMEDOUT" ||
    /ETIMEDOUT|Connection timeout|Operation timed out/.test(text)
  ) {
    key = "ldapErrorTimeout";
  }
  if (key == null) {
    return e;
  }
  // The server's own words, when it gave any, and the result code stay with the hint: they are what
  // a directory admin looks up.
  const detail = e.message.replace(/\s*Code: 0x[0-9a-f]+\s*$/i, "").trim();
  const resultCode = typeof code === "number" ? ` (LDAP result code ${code})` : "";
  return new Error(
    i18nService.t(key) + (detail !== "" && resultCode !== "" ? ` ${detail}` : "") + resultCode,
  );
}

/**
 * A certificate or key file named in the settings. A path that is set but cannot be read is an
 * error: going on without the file fails later with a TLS message that does not name the file.
 */
function readTlsFile(path: string | null | undefined, what: string): Buffer | null {
  if (path == null || path.trim() === "") {
    return null;
  }
  try {
    return fs.readFileSync(path.trim());
  } catch {
    throw new Error(`The ${what} file "${path}" was not found or is not readable.`);
  }
}

export class LdapDirectoryService implements IDirectoryService {
  private client: ldapts.Client;
  private dirConfig: LdapConfiguration;
  private syncConfig: SyncConfiguration;

  constructor(
    private logService: LogService,
    private i18nService: I18nService,
    private stateService: StateService,
  ) {}

  async getEntries(force: boolean, test: boolean): Promise<[GroupEntry[], UserEntry[]]> {
    const type = await this.stateService.getDirectoryType();
    if (type !== DirectoryType.Ldap) {
      return;
    }

    this.dirConfig = await this.stateService.getDirectory<LdapConfiguration>(DirectoryType.Ldap);
    if (this.dirConfig == null) {
      return;
    }

    this.syncConfig = await this.stateService.getSync();
    if (this.syncConfig == null) {
      return;
    }

    await this.bind();

    let users: UserEntry[];
    let groups: GroupEntry[];

    try {
      if (this.syncConfig.users) {
        users = await this.getUsers(force, test);
      }

      if (this.syncConfig.groups) {
        let groupForce = force;
        if (!groupForce && users != null) {
          const activeUsers = users.filter((u) => !u.deleted && !u.disabled);
          groupForce = activeUsers.length > 0;
        }
        groups = await this.getGroups(groupForce);
      }
    } catch (e) {
      await this.client.unbind();
      throw this.friendlyError(e);
    }

    await this.client.unbind();
    return [groups, users];
  }

  async readSnapshot(): Promise<DirectorySnapshot> {
    this.dirConfig = await this.stateService.getDirectory<LdapConfiguration>(DirectoryType.Ldap);
    if (this.dirConfig == null) {
      throw new Error(this.i18nService.t("dirConfigIncomplete"));
    }
    const baseDn = this.dirConfig.rootPath?.trim() ?? "";
    if (baseDn === "") {
      throw new Error("Set the root path (base DN) of the directory before syncing.");
    }
    // Filters an earlier version saved: they never applied to this read, which an admin who set
    // one may not know.
    const unused = ldapUnusedFilters(await this.stateService.getSync());
    if (unused.length > 0) {
      this.logService.warning(
        `Not used by an LDAP sync: ${unused.map((f) => `sync.${f}`).join(", ")}. ` +
          `Everything under "${baseDn}" is read; Cockpit's mappings choose what is imported. ` +
          "Saving the settings removes them.",
      );
    }

    await this.bind();
    try {
      const objectClasses = await this.readObjectClasses();
      this.logService.info("Directory snapshot search: " + baseDn + " => (objectClass=*)");
      const { searchEntries, searchReferences = [] } = await this.searchAll(baseDn);
      await this.readRemainingRanges(searchEntries);
      const unfollowedReferrals = searchReferences.filter((r) => !AD_PARTITION_REFERRAL.test(r));
      if (unfollowedReferrals.length > 0) {
        this.logService.warning(
          `The directory referred ${unfollowedReferrals.length} part(s) of "${baseDn}" to other servers; ` +
            `entries there were not read: ${unfollowedReferrals.join(", ")}`,
        );
      }
      const limits: ReadLimits = { binaryDropped: 0, truncated: 0 };
      const entries = searchEntries.map((e) => fromLdapEntry(e, limits));
      if (limits.binaryDropped > 0) {
        this.logService.info(
          `Left out ${limits.binaryDropped} binary value(s) (photos, certificates); they are not sent to Cockpit.`,
        );
      }
      if (limits.truncated > 0) {
        this.logService.warning(
          `Cut ${limits.truncated} text value(s) longer than ${MAX_VALUE_LENGTH} characters.`,
        );
      }
      return {
        baseDn,
        objectClasses,
        entries,
        ...(unfollowedReferrals.length > 0 ? { unfollowedReferrals } : {}),
      };
    } catch (e) {
      throw this.friendlyError(e);
    } finally {
      await this.client.unbind();
    }
  }

  /**
   * Everything under the base DN, and the referrals the server answered with instead of entries.
   * Paged, because servers cap unpaged results (Active Directory at 1000); a server without the
   * paging control is read unpaged, and so is one where "Paged search" is switched off. Paging does
   * not lift a size limit the server sets for the bind account (OpenLDAP's limits for non-admins).
   */
  private async searchAll(
    baseDn: string,
  ): Promise<{ searchEntries: ldapts.Entry[]; searchReferences: string[] }> {
    const options: ldapts.SearchOptions = {
      filter: "(objectClass=*)",
      scope: "sub",
      timeLimit: LdapSearchTimeLimitSeconds,
      explicitBufferAttributes: BinaryAttributes,
      attributes: RequestedAttributes,
    };
    if (this.dirConfig.pagedSearch === false) {
      return await this.client.search(baseDn, options);
    }
    try {
      return await this.client.search(baseDn, {
        ...options,
        paged: { pageSize: 500 },
      });
    } catch (e) {
      if (!(e instanceof ldapts.UnavailableCriticalExtensionError)) {
        throw e;
      }
      this.logService.warning("The directory does not support paged searches; reading unpaged.");
      return await this.client.search(baseDn, options);
    }
  }

  /**
   * Active Directory sends a long multi-valued attribute (a group's member list over 1500) in
   * slices: "member;range=0-1499", and the rest only when asked for "member;range=1500-*". Ask until
   * the last slice ("…-*") and put the whole list back under the plain name, so Cockpit gets every
   * member instead of the first slice.
   */
  private async readRemainingRanges(entries: ldapts.Entry[]): Promise<void> {
    for (const entry of entries) {
      for (const key of Object.keys(entry)) {
        const ranged = key.match(/^(.+);range=(\d+)-(\d+|\*)$/i);
        if (ranged == null) {
          continue;
        }
        const name = ranged[1];
        const values = [entry[key]].flat();
        let end = ranged[3];
        while (end !== "*") {
          const next = `${name};range=${Number(end) + 1}-*`;
          const { searchEntries } = await this.client.search(entry.dn, {
            scope: "base",
            filter: "(objectClass=*)",
            timeLimit: LdapSearchTimeLimitSeconds,
            explicitBufferAttributes: BinaryAttributes,
            attributes: [next],
          });
          const slice = Object.entries(searchEntries[0] ?? {}).find(([k]) =>
            new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};range=`, "i").test(k),
          );
          if (slice == null) {
            break;
          }
          values.push(...[slice[1]].flat());
          end = slice[0].match(/-(\d+|\*)$/)[1];
        }
        delete entry[key];
        if (end !== "*") {
          // The rest did not come: keep the range in the name, so Cockpit reports the list as incomplete.
          this.logService.warning(`Could not read all values of "${name}" of ${entry.dn}.`);
          entry[`${name};range=${ranged[2]}-${end}`] = values as ldapts.Entry[string];
          continue;
        }
        entry[name] = [...[entry[name] ?? []].flat(), ...values] as ldapts.Entry[string];
      }
    }
  }

  /**
   * The directory's published objectClass definitions, from the schema entry its RootDSE names.
   * Cockpit uses them to tell what each entry is (its structural class) and to label each type.
   * Best effort: without them Cockpit still groups entries, by their last objectClass.
   */
  private async readObjectClasses(): Promise<string[]> {
    try {
      const root = await this.client.search("", {
        scope: "base",
        filter: "(objectClass=*)",
        attributes: ["subschemaSubentry"],
      });
      const schemaDn = [root.searchEntries[0]?.subschemaSubentry].flat()[0];
      if (schemaDn == null || String(schemaDn) === "") {
        return [];
      }
      const schema = await this.client.search(String(schemaDn), {
        scope: "base",
        filter: "(objectClass=*)",
        attributes: ["objectClasses"],
      });
      return [schema.searchEntries[0]?.objectClasses ?? []].flat().map(String);
    } catch (e) {
      this.logService.warning(
        "Could not read the directory schema: " + (e instanceof Error ? e.message : String(e)),
      );
      return [];
    }
  }

  private async getUsers(force: boolean, test: boolean): Promise<UserEntry[]> {
    const lastSync = await this.stateService.getLastUserSync();
    let filter = this.buildBaseFilter(this.syncConfig.userObjectClass, this.syncConfig.userFilter);
    filter = this.buildRevisionFilter(filter, force, lastSync);

    const path = this.makeSearchPath(this.syncConfig.userPath);
    this.logService.info("User search: " + path + " => " + filter);

    const regularUsers = await this.search<UserEntry>(path, filter, (se: any) =>
      this.buildUser(se, false),
    );

    // Active Directory has a special way of managing deleted users that
    // standard LDAP does not. Users can be "tombstoned", where they cease to
    // exist, or they can be "recycled" where they exist in a quarantined
    // state for a period of time before being tombstoned.
    //
    // Essentially, recycled users are soft deleted but tombstoned users are
    // hard deleted. In standard LDAP deleted users are only ever hard
    // deleted.
    //
    // We check for recycled Active Directory users below, but only if the
    // sync is a test sync or the "Overwrite existing users" flag is checked.
    const ignoreDeletedUsers = !this.dirConfig.ad || (!force && !test);
    if (ignoreDeletedUsers) {
      return regularUsers;
    }

    try {
      let deletedFilter = this.buildBaseFilter(this.syncConfig.userObjectClass, "(isDeleted=TRUE)");
      deletedFilter = this.buildRevisionFilter(deletedFilter, force, lastSync);

      const deletedPath = this.makeSearchPath("CN=Deleted Objects");
      this.logService.info("Deleted user search: " + deletedPath + " => " + deletedFilter);

      const delControl = new ldapts.Control("1.2.840.113556.1.4.417", { critical: true });
      const deletedUsers = await this.search<UserEntry>(
        deletedPath,
        deletedFilter,
        (se: any) => this.buildUser(se, true),
        [delControl],
      );
      return regularUsers.concat(deletedUsers);
    } catch {
      this.logService.warning("Cannot query deleted users.");
      return regularUsers;
    }
  }

  private buildUser(searchEntry: any, deleted: boolean): UserEntry {
    const user = new UserEntry();
    user.referenceId = this.getReferenceId(searchEntry);
    user.deleted = deleted;

    if (user.referenceId == null) {
      return null;
    }

    user.externalId = this.getExternalId(searchEntry, user.referenceId);
    user.disabled = this.entryDisabled(searchEntry);
    user.email = this.getAttr(searchEntry, this.syncConfig.userEmailAttribute);
    if (
      user.email == null &&
      this.syncConfig.useEmailPrefixSuffix &&
      this.syncConfig.emailPrefixAttribute != null &&
      this.syncConfig.emailSuffix != null
    ) {
      const prefixAttr = this.getAttr(searchEntry, this.syncConfig.emailPrefixAttribute);
      if (prefixAttr != null) {
        user.email = prefixAttr + this.syncConfig.emailSuffix;
      }
    }

    if (user.email != null) {
      user.email = user.email.trim().toLowerCase();
    }

    if (!user.deleted && (user.email == null || user.email.trim() === "")) {
      return null;
    }

    return user;
  }

  private async getGroups(force: boolean): Promise<GroupEntry[]> {
    const entries: GroupEntry[] = [];

    const lastSync = await this.stateService.getLastUserSync();
    const originalFilter = this.buildBaseFilter(
      this.syncConfig.groupObjectClass,
      this.syncConfig.groupFilter,
    );
    let filter = originalFilter;
    const revisionFilter = this.buildRevisionFilter(filter, force, lastSync);
    const searchSinceRevision = filter !== revisionFilter;
    filter = revisionFilter;

    const path = this.makeSearchPath(this.syncConfig.groupPath);
    this.logService.info("Group search: " + path + " => " + filter);

    let groupSearchEntries: any[] = [];
    const initialSearchGroupIds = await this.search<string>(path, filter, (se: any) => {
      groupSearchEntries.push(se);
      return this.getReferenceId(se);
    });

    if (searchSinceRevision && initialSearchGroupIds.length === 0) {
      return [];
    } else if (searchSinceRevision) {
      groupSearchEntries = await this.search<string>(path, originalFilter, (se: any) => se);
    }

    const userFilter = this.buildBaseFilter(
      this.syncConfig.userObjectClass,
      this.syncConfig.userFilter,
    );
    const userPath = this.makeSearchPath(this.syncConfig.userPath);
    const userDnMap = new Map<string, string>();
    const userUidMap = new Map<string, string>();
    await this.search<string>(userPath, userFilter, (se: any) => {
      const dn = this.getReferenceId(se);
      const uid = this.getAttr<string>(se, "uid");
      const externalId = this.getExternalId(se, dn);
      // LDAP compares DNs without case: a group may list "UID=U1,OU=People,…" for uid=u1,ou=people,….
      userDnMap.set(normalizeDn(dn), externalId);
      if (uid != null) {
        userUidMap.set(uid.toLowerCase(), externalId);
      }
      return se;
    });

    for (const se of groupSearchEntries) {
      const group = this.buildGroup(se, userDnMap, userUidMap);
      if (group != null) {
        entries.push(group);
      }
    }

    return entries;
  }

  /**
   * Builds a GroupEntry from LDAP search results, including membership.
   * Supports user membership by DN or UID and nested group membership by DN.
   *
   * @param searchEntry - The LDAP search entry containing group data
   * @param userDnMap - Map of user DNs to their external IDs
   * @param userUidMap - Map of user UIDs to their external IDs
   * @returns A populated GroupEntry object, or null if the group lacks required properties
   */
  private buildGroup(
    searchEntry: any,
    userDnMap: Map<string, string>,
    userUidMap: Map<string, string>,
  ) {
    const group = new GroupEntry();
    group.referenceId = this.getReferenceId(searchEntry);
    if (group.referenceId == null) {
      return null;
    }

    group.externalId = this.getExternalId(searchEntry, group.referenceId);

    group.name = this.getAttr(searchEntry, this.syncConfig.groupNameAttribute);
    if (group.name == null) {
      group.name = this.getAttr(searchEntry, "cn");
    }

    if (group.name == null) {
      return null;
    }

    const members = this.getAttrVals<string>(searchEntry, this.syncConfig.memberAttribute);
    if (members != null) {
      // Parses a group member attribute and identifies it as a member DN, member Uid, or a group Dn
      const getMemberAttributeType = (member: string): "memberDn" | "memberUid" | "groupDn" => {
        const isDnLike = member.includes("=") && member.includes(",");
        if (isDnLike) {
          return userDnMap.has(normalizeDn(member)) ? "memberDn" : "groupDn";
        }
        return "memberUid";
      };

      for (const member of members) {
        switch (getMemberAttributeType(member)) {
          case "memberDn": {
            const externalId = userDnMap.get(normalizeDn(member));
            if (externalId != null) {
              group.userMemberExternalIds.add(externalId);
            }
            break;
          }
          case "memberUid": {
            const externalId = userUidMap.get(member.toLowerCase());
            if (externalId != null) {
              group.userMemberExternalIds.add(externalId);
            }
            break;
          }
          case "groupDn":
            group.groupMemberReferenceIds.add(member);
            break;
        }
      }
    }

    return group;
  }

  /**
   * The externalId is the "objectGUID" property if present (a unique identifier used by Active Directory),
   * otherwise it falls back to the provided referenceId.
   */
  private getExternalId(searchEntry: ldapts.Entry, referenceId: string) {
    const attr = this.getAttr<Buffer>(searchEntry, ActiveDirectoryExternalId);
    if (attr != null) {
      return this.bufToGuid(attr);
    } else {
      return referenceId;
    }
  }

  /**
   * Gets the object's reference id (dn)
   */
  private getReferenceId(entry: ldapts.Entry): string {
    return entry.dn;
  }

  private buildBaseFilter(objectClass: string, subFilter: string): string {
    let filter = this.buildObjectClassFilter(objectClass);
    if (subFilter != null && subFilter.trim() !== "") {
      filter = "(&" + filter + subFilter + ")";
    }
    return filter;
  }

  private buildObjectClassFilter(objectClass: string): string {
    return "(&(objectClass=" + objectClass + "))";
  }

  private buildRevisionFilter(baseFilter: string, force: boolean, lastRevisionDate: Date) {
    const revisionAttr = this.syncConfig.revisionDateAttribute;
    if (!force && lastRevisionDate != null && revisionAttr != null && revisionAttr.trim() !== "") {
      const dateString = lastRevisionDate.toISOString().replace(/[-:T]/g, "").substr(0, 16) + "Z";
      baseFilter = "(&" + baseFilter + "(" + revisionAttr + ">=" + dateString + "))";
    }

    return baseFilter;
  }

  private makeSearchPath(pathPrefix: string) {
    if (this.dirConfig.rootPath.toLowerCase().indexOf("dc=") === -1) {
      return pathPrefix;
    }
    if (this.dirConfig.rootPath != null && this.dirConfig.rootPath.trim() !== "") {
      const trimmedRootPath = this.dirConfig.rootPath.trim().toLowerCase();
      let path = trimmedRootPath.substr(trimmedRootPath.indexOf("dc="));
      if (pathPrefix != null && pathPrefix.trim() !== "") {
        path = pathPrefix.trim() + "," + path;
      }
      return path;
    }

    return null;
  }

  /**
   */

  /**
   * Get all values for an ldap attribute
   * @param searchEntry The ldap entry
   * @param attr An attribute name on the ldap entry
   * @returns An array containing all values of the attribute, or null if there are no values
   */
  private getAttrVals<T extends string | Buffer>(
    searchEntry: ldapts.Entry,
    attr: string,
  ): T[] | null {
    if (searchEntry == null || searchEntry[attr] == null) {
      return null;
    }

    const vals = searchEntry[attr];
    if (!Array.isArray(vals)) {
      return [vals] as T[];
    }

    return vals as T[];
  }

  /**
   * Get the first value for an ldap attribute
   * @param searchEntry The ldap entry
   * @param attr An attribute name on the ldap entry
   * @returns The first value of the attribute, or null if there is not at least 1 value
   */
  private getAttr<T extends string | Buffer>(searchEntry: ldapts.Entry, attr: string): T {
    const vals = this.getAttrVals(searchEntry, attr);
    if (vals == null || vals.length < 1) {
      return null;
    }

    return vals[0] as T;
  }

  private entryDisabled(searchEntry: any): boolean {
    const c = this.getAttr<string>(searchEntry, "userAccountControl");
    if (c != null) {
      try {
        const control = parseInt(c, null);
        // tslint:disable-next-line
        return (control & UserControlAccountDisabled) === UserControlAccountDisabled;
      } catch (e) {
        this.logService.error(e);
      }
    }

    return false;
  }

  private async search<T>(
    path: string,
    filter: string,
    processEntry: (searchEntry: ldapts.Entry) => T,
    controls: ldapts.Control[] = [],
  ): Promise<T[]> {
    const options: ldapts.SearchOptions = {
      filter: filter,
      scope: "sub",
      paged: this.dirConfig.pagedSearch,
      timeLimit: LdapSearchTimeLimitSeconds,
      // We need to expressly tell ldapts what attributes to return as Buffer objects,
      // otherwise they are returned as strings
      explicitBufferAttributes: BinaryAttributes,
      attributes: RequestedAttributes,
    };
    const { searchEntries } = await this.client.search(path, options, controls);
    return searchEntries.map((e) => processEntry(e)).filter((e) => e != null);
  }

  private async bind(): Promise<any> {
    // A hostname saved as a URL ("ldaps://dc1:636/") still works: only the host is used.
    const { hostname, port: portInHostname } = normalizeLdapHost(this.dirConfig.hostname);
    if (hostname === "") {
      throw new Error(this.i18nService.t("ldapHostnameMissing"));
    }
    const port = isPortEmpty(this.dirConfig.port) ? portInHostname : this.dirConfig.port;
    if (port == null) {
      throw new Error(this.i18nService.t("dirConfigIncomplete"));
    }

    const protocol = this.dirConfig.ssl && !this.dirConfig.startTls ? "ldaps" : "ldap";

    // An IPv6 address goes in brackets in a URL.
    const host = hostname.includes(":") ? `[${hostname}]` : hostname;
    const url = protocol + "://" + host + ":" + port;
    const options: ldapts.ClientOptions = {
      url: url.trim().toLowerCase(),
      connectTimeout: LdapConnectTimeoutMs,
      timeout: LdapOperationTimeoutMs,
    };

    // If using ldaps, TLS options are given to the client constructor
    if (protocol === "ldaps") {
      options.tlsOptions = this.buildTlsOptions();
    }

    this.client = new ldapts.Client(options);

    const user =
      this.dirConfig.username == null || this.dirConfig.username.trim() === ""
        ? null
        : this.dirConfig.username;
    const pass =
      this.dirConfig.password == null || this.dirConfig.password.trim() === ""
        ? null
        : this.dirConfig.password;

    if (user == null || pass == null) {
      throw new Error(this.i18nService.t("usernamePasswordNotConfigured"));
    }

    try {
      // If using StartTLS, TLS options are given to the StartTLS call. StartTLS is asked for on its
      // own (the CLI sets it without ssl): never fall back to a plain bind that sends the password
      // in clear text.
      if (this.dirConfig.startTls) {
        await this.client.startTLS(this.buildTlsOptions());
      }
      await this.client.bind(user, pass);
    } catch (error) {
      await this.client.unbind();
      throw this.friendlyError(error);
    }
  }

  /** The error with a hint about which setting to check; the original text goes to the log. */
  private friendlyError(e: unknown): Error {
    const friendly = describeLdapError(e, this.i18nService);
    if (friendly !== e) {
      this.logService.error("LDAP error: " + (e instanceof Error ? e.message : String(e)));
    }
    return friendly;
  }

  private buildTlsOptions(): tls.ConnectionOptions {
    const tlsOptions: tls.ConnectionOptions = {};

    if (this.dirConfig.sslAllowUnauthorized) {
      tlsOptions.rejectUnauthorized = !this.dirConfig.sslAllowUnauthorized;
    }
    if (!this.dirConfig.startTls) {
      const ca = readTlsFile(this.dirConfig.sslCaPath, "CA certificate");
      if (ca != null) {
        tlsOptions.ca = [ca];
      }
      const cert = readTlsFile(this.dirConfig.sslCertPath, "client certificate");
      if (cert != null) {
        tlsOptions.cert = cert;
      }
      const key = readTlsFile(this.dirConfig.sslKeyPath, "client key");
      if (key != null) {
        tlsOptions.key = key;
      }
    } else {
      const ca = readTlsFile(this.dirConfig.tlsCaPath, "CA certificate");
      if (ca != null) {
        tlsOptions.ca = [ca];
      }
    }

    tlsOptions.checkServerIdentity = this.checkServerIdentityAltNames;

    return tlsOptions;
  }

  private bufToGuid(buf: Buffer) {
    const arr = new Uint8Array(buf);
    const p1 = arr.slice(0, 4).reverse().buffer;
    const p2 = arr.slice(4, 6).reverse().buffer;
    const p3 = arr.slice(6, 8).reverse().buffer;
    const p4 = arr.slice(8, 10).buffer;
    const p5 = arr.slice(10).buffer;
    const guid =
      Utils.fromBufferToHex(p1) +
      "-" +
      Utils.fromBufferToHex(p2) +
      "-" +
      Utils.fromBufferToHex(p3) +
      "-" +
      Utils.fromBufferToHex(p4) +
      "-" +
      Utils.fromBufferToHex(p5);
    return guid.toLowerCase();
  }

  private checkServerIdentityAltNames(host: string, cert: tls.PeerCertificate) {
    // Fixes the cert representation when subject is empty and altNames are present
    // Required for node versions < 12.14.1 (which could be used for the CLI)
    // Adapted from: https://github.com/auth0/ad-ldap-connector/commit/1f4dd2be6ed93dda591dd31ed5483a9b452a8d2a
    // See https://github.com/nodejs/node/issues/11771 for details
    if (cert && cert.subject == null && /(IP|DNS|URL)/.test(cert.subjectaltname)) {
      cert.subject = {
        C: null,
        ST: null,
        L: null,
        O: null,
        OU: null,
        CN: null,
      };
    }

    return tls.checkServerIdentity(host, cert);
  }
}
