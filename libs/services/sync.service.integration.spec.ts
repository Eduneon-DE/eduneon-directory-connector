import { mock, MockProxy } from "jest-mock-extended";

import { ApiService } from "@/libs/abstractions/api.service";
import { DirectoryFactoryService } from "@/libs/abstractions/directory-factory.service";
import { I18nService } from "@/libs/abstractions/i18n.service";
import { LogService } from "@/libs/abstractions/log.service";
import { MessagingService } from "@/libs/abstractions/messaging.service";
import { StateService } from "@/libs/abstractions/state.service";
import { DirectoryType } from "@/libs/enums/directoryType";
import { DirectorySyncRequest } from "@/libs/models/cockpit";

import { LdapDirectoryService } from "./directory-services/ldap-directory.service";
import { SyncService } from "./sync.service";

import { getLdapConfiguration, getSyncConfiguration } from "@/utils/openldap/config-fixtures";
import { groupFixtures } from "@/utils/openldap/group-fixtures";
import { userFixtures } from "@/utils/openldap/user-fixtures";

// Needs the test directory: `docker compose up -d` (see docker-compose.yml).
describe("SyncService against OpenLDAP", () => {
  let stateService: MockProxy<StateService>;
  let apiService: MockProxy<ApiService>;
  let syncService: SyncService;

  beforeEach(() => {
    stateService = mock();
    apiService = mock();
    const directoryFactory = mock<DirectoryFactoryService>();

    stateService.getDirectoryType.mockResolvedValue(DirectoryType.Ldap);
    stateService.getOrganizationId.mockResolvedValue("7");
    stateService.getDirectory
      .calledWith(DirectoryType.Ldap)
      .mockResolvedValue(getLdapConfiguration());
    stateService.getSync.mockResolvedValue(getSyncConfiguration({ users: true, groups: true }));
    apiService.postDirectorySync.mockResolvedValue({
      provider: { id: 7, name: "Test" },
      status: "synced",
      uploadId: "u",
      dryRun: false,
      received: 0,
      mappings: [],
      issues: [],
    });

    directoryFactory.createService.mockReturnValue(
      new LdapDirectoryService(mock<LogService>(), mock<I18nService>(), stateService),
    );
    syncService = new SyncService(
      apiService,
      mock<MessagingService>(),
      stateService,
      directoryFactory,
    );
  });

  it("returns the directory's users and groups", async () => {
    await expect(syncService.sync(false, false)).resolves.toEqual([groupFixtures, userFixtures]);
  });

  it("sends every user and group to Cockpit once, as raw entries", async () => {
    await syncService.sync(false, false);

    expect(apiService.postDirectorySync).toHaveBeenCalledTimes(1);
    const request: DirectorySyncRequest = apiService.postDirectorySync.mock.calls[0][0];
    expect(request).toMatchObject({ providerId: 7, dryRun: false, baseDn: "dc=example,dc=com" });

    const dns = request.entries.map((e) => e.dn.toLowerCase());
    for (const u of userFixtures) {
      expect(dns).toContain(u.referenceId.toLowerCase());
    }
    for (const g of groupFixtures) {
      expect(dns).toContain(g.referenceId.toLowerCase());
    }

    const roland = request.entries.find((e) => e.dn.startsWith("cn=Roland Dyke"));
    expect(roland.attributes).toMatchObject({
      cn: ["Roland Dyke"],
      mail: ["DykeR@220af87272f04218bb8dd81d50fb19f5.example.com"],
      objectclass: expect.arrayContaining(["inetOrgPerson"]),
      entryuuid: [expect.any(String)],
    });
  });

  it("never sends password attributes", async () => {
    await syncService.sync(false, false);

    const request: DirectorySyncRequest = apiService.postDirectorySync.mock.calls[0][0];
    for (const entry of request.entries) {
      expect(Object.keys(entry.attributes)).not.toContain("userpassword");
    }
  });

  it("sends nothing in test mode", async () => {
    await syncService.sync(false, true);
    expect(apiService.postDirectorySync).not.toHaveBeenCalled();
  });
});
