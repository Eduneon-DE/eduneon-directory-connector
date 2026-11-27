import { mock, MockProxy } from "jest-mock-extended";

// Every search goes through this stub instead of a socket, so a test decides what the server answers.
const searchMock = jest.fn();
const bindMock = jest.fn();

jest.mock("ldapts", () => {
  class UnavailableCriticalExtensionError extends Error {}
  return {
    Client: jest.fn().mockImplementation(() => ({
      bind: bindMock,
      unbind: jest.fn().mockResolvedValue(undefined),
      search: searchMock,
      startTLS: jest.fn(),
    })),
    Control: jest.fn(),
    UnavailableCriticalExtensionError,
  };
});

import { I18nService } from "@/libs/abstractions/i18n.service";
import { LogService } from "@/libs/abstractions/log.service";
import { StateService } from "@/libs/abstractions/state.service";
import { DirectoryType } from "@/libs/enums/directoryType";

import {
  getLdapConfiguration,
  getSyncConfiguration,
} from "../../../utils/openldap/config-fixtures";

import { LdapDirectoryService } from "./ldap-directory.service";

describe("LdapDirectoryService reads", () => {
  let logService: MockProxy<LogService>;
  let stateService: MockProxy<StateService>;
  let service: LdapDirectoryService;

  const useConfig = (config: Parameters<typeof getLdapConfiguration>[0]) =>
    stateService.getDirectory
      .calledWith(DirectoryType.Ldap)
      .mockResolvedValue(getLdapConfiguration(config));

  /** The options of every search under the base DN (the schema lookups search elsewhere). */
  const baseSearches = () =>
    searchMock.mock.calls.filter(([base]) => base === "dc=example,dc=com").map(([, o]) => o);

  beforeEach(() => {
    jest.clearAllMocks();
    bindMock.mockResolvedValue(undefined);
    searchMock.mockResolvedValue({ searchEntries: [], searchReferences: [] });
    logService = mock();
    stateService = mock();
    const i18nService = mock<I18nService>();
    i18nService.t.mockImplementation((id) => id);
    stateService.getDirectoryType.mockResolvedValue(DirectoryType.Ldap);
    stateService.getLastUserSync.mockResolvedValue(null);
    useConfig({ pagedSearch: true });
    service = new LdapDirectoryService(logService, i18nService, stateService);
  });

  // conn-6
  it("matches a group member DN to its user whatever the case of the DN", async () => {
    stateService.getSync.mockResolvedValue(
      getSyncConfiguration({
        groups: true,
        groupObjectClass: "groupOfNames",
        userObjectClass: "inetOrgPerson",
        memberAttribute: "member",
      }),
    );
    searchMock.mockImplementation(async (_base: string, options: { filter: string }) => ({
      searchEntries: options.filter.includes("groupOfNames")
        ? [
            {
              dn: "cn=class1,ou=groups,dc=example,dc=com",
              cn: "class1",
              member: ["UID=U1, OU=people,dc=example,dc=com", "uid=u2,ou=people,dc=example,dc=com"],
            },
          ]
        : [
            { dn: "uid=u1,ou=people,dc=example,dc=com", uid: "u1" },
            { dn: "uid=u2,ou=people,dc=example,dc=com", uid: "u2" },
          ],
      searchReferences: [],
    }));

    const [groups] = await service.getEntries(true, true);

    expect([...groups[0].userMemberExternalIds].sort()).toEqual([
      "uid=u1,ou=people,dc=example,dc=com",
      "uid=u2,ou=people,dc=example,dc=com",
    ]);
    expect([...groups[0].groupMemberReferenceIds]).toEqual([]);
  });

  // conn-11
  it("reports referrals it did not follow, but not Active Directory's own partitions", async () => {
    searchMock.mockImplementation(async (base: string) =>
      base === "dc=example,dc=com"
        ? {
            searchEntries: [{ dn: "dc=example,dc=com", dc: "example" }],
            searchReferences: [
              "ldap://other.example.test/ou=elsewhere,dc=example,dc=com",
              "ldap://DomainDnsZones.example.com/DC=DomainDnsZones,DC=example,DC=com",
              "ldap://example.com/CN=Configuration,DC=example,DC=com",
            ],
          }
        : { searchEntries: [], searchReferences: [] },
    );

    const snapshot = await service.readSnapshot();

    expect(snapshot.unfollowedReferrals).toEqual([
      "ldap://other.example.test/ou=elsewhere,dc=example,dc=com",
    ]);
    expect(logService.warning).toHaveBeenCalledWith(
      expect.stringContaining("ou=elsewhere,dc=example,dc=com"),
    );
  });

  it("says nothing about referrals when there are none", async () => {
    const snapshot = await service.readSnapshot();

    expect(snapshot.unfollowedReferrals).toBeUndefined();
  });

  // #102: Cockpit's mappings choose what is imported; the snapshot is everything under the base DN.
  it("reads everything under the base DN whatever user or group filter an earlier version saved", async () => {
    stateService.getSync.mockResolvedValue(
      getSyncConfiguration({
        userFilter: "(uid=alice)",
        groupFilter: "(cn=staff)",
        removeDisabled: true,
        userPath: "ou=people",
      }),
    );

    await service.readSnapshot();

    expect(baseSearches()).not.toHaveLength(0);
    for (const options of baseSearches()) {
      expect(options.filter).toBe("(objectClass=*)");
      expect(options.scope).toBe("sub");
    }
    expect(searchMock.mock.calls.map(([base]) => base)).not.toContain(
      "ou=people,dc=example,dc=com",
    );
    expect(logService.warning).toHaveBeenCalledWith(
      expect.stringContaining("sync.userFilter, sync.groupFilter, sync.removeDisabled"),
    );
  });

  it("warns about no filter when none is set", async () => {
    stateService.getSync.mockResolvedValue(getSyncConfiguration());

    await service.readSnapshot();

    expect(logService.warning).not.toHaveBeenCalled();
  });

  // conn-20 and conn-21
  it("asks for the operational ids Cockpit offers and reads every binary id as bytes", async () => {
    await service.readSnapshot();

    const [options] = baseSearches();
    expect(options.attributes).toEqual(
      expect.arrayContaining(["nsUniqueId", "orclGUID", "GUID", "structuralObjectClass"]),
    );
    expect(options.explicitBufferAttributes).toEqual(
      expect.arrayContaining(["objectGUID", "objectSid", "mS-DS-ConsistencyGuid", "GUID"]),
    );
  });

  // Follow-up: Active Directory sends long member lists in slices (";range=").
  const groupDn = "cn=big,dc=example,dc=com";
  const slices: Record<string, Record<string, string[]>> = {
    "member;range=3-*": { "member;range=3-5": ["uid=u3", "uid=u4", "uid=u5"] },
    "member;range=6-*": { "member;range=6-*": ["uid=u6"] },
  };
  const answerRanges = (missing?: string) =>
    searchMock.mockImplementation(async (base: string, options: { attributes: string[] }) => {
      if (base === "dc=example,dc=com") {
        return {
          searchEntries: [
            { dn: groupDn, cn: "big", "member;range=0-2": ["uid=u0", "uid=u1", "uid=u2"] },
          ],
          searchReferences: [],
        };
      }
      const wanted = options.attributes[0];
      if (base === groupDn && wanted !== missing && slices[wanted]) {
        return { searchEntries: [{ dn: groupDn, ...slices[wanted] }], searchReferences: [] };
      }
      return { searchEntries: [], searchReferences: [] };
    });

  it("reads every slice of a ranged attribute and sends the whole list", async () => {
    answerRanges();

    const snapshot = await service.readSnapshot();

    const group = snapshot.entries.find((e) => e.dn === groupDn);
    expect(group.attributes.member).toEqual([
      "uid=u0",
      "uid=u1",
      "uid=u2",
      "uid=u3",
      "uid=u4",
      "uid=u5",
      "uid=u6",
    ]);
    expect(Object.keys(group.attributes).some((k) => k.includes(";range="))).toBe(false);
  });

  it("keeps the range in the name when the rest does not come, so Cockpit sees the list is incomplete", async () => {
    answerRanges("member;range=6-*");

    const snapshot = await service.readSnapshot();

    const group = snapshot.entries.find((e) => e.dn === groupDn);
    expect(group.attributes["member;range=0-5"]).toHaveLength(6);
    expect(group.attributes.member).toBeUndefined();
    expect(logService.warning).toHaveBeenCalledWith(expect.stringContaining('"member"'));
  });

  // conn-35
  it("reads in pages by default, and unpaged when paged search is switched off", async () => {
    await service.readSnapshot();
    expect(baseSearches()[0].paged).toEqual({ pageSize: 500 });

    searchMock.mockClear();
    useConfig({ pagedSearch: false });
    await service.readSnapshot();
    expect(baseSearches()[0].paged).toBeUndefined();
  });

  // conn-8
  it.each([
    [
      { code: 34, name: "InvalidDNSyntaxError", message: "invalid DN Code: 0x22" },
      "ldapErrorInvalidDn",
    ],
    [{ code: 4, name: "SizeLimitExceededError", message: " Code: 0x4" }, "ldapErrorSizeLimit"],
    [
      { code: 50, name: "InsufficientAccessError", message: " Code: 0x32" },
      "ldapErrorInsufficientAccess",
    ],
    [
      { code: 13, name: "ConfidentialityRequiredError", message: " Code: 0xd" },
      "ldapErrorEncryptionRequired",
    ],
  ])("explains LDAP result code %#, keeping the code", async (fields, hint) => {
    searchMock.mockRejectedValue(Object.assign(new Error(fields.message), fields));

    const error = (await service.readSnapshot().catch((e: Error) => e)) as Error;

    expect(error.message).toContain(hint);
    expect(error.message).toContain(`LDAP result code ${fields.code}`);
    expect(error.message).not.toMatch(/^\s*Code: 0x/);
  });

  it("explains a bare result code that crossed a process boundary", async () => {
    bindMock.mockRejectedValue(new Error(" Code: 0x31"));

    await expect(service.readSnapshot()).rejects.toThrow("ldapErrorInvalidCredentials");
  });
});
