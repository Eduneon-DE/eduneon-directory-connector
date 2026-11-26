import { mock, MockProxy } from "jest-mock-extended";

import { ApiService } from "@/libs/abstractions/api.service";
import { DirectoryFactoryService } from "@/libs/abstractions/directory-factory.service";
import { MessagingService } from "@/libs/abstractions/messaging.service";
import { StateService } from "@/libs/abstractions/state.service";
import { DirectoryType } from "@/libs/enums/directoryType";
import { DirectorySyncResponse } from "@/libs/models/cockpit";

import { getSyncConfiguration } from "../../utils/openldap/config-fixtures";
import { GroupEntry } from "../models/groupEntry";
import { UserEntry } from "../models/userEntry";

import { IDirectoryService } from "./directory-services/directory.service";
import { SyncService, UPLOAD_CHUNK_SIZE } from "./sync.service";

const okResponse: DirectorySyncResponse = {
  provider: { id: 7, name: "Test" },
  status: "synced",
  uploadId: "u",
  dryRun: false,
  received: 1,
  mappings: [
    {
      targetModel: "AuthenticationAccount",
      total: 1,
      created: 1,
      updated: 0,
      skipped: 0,
      errors: 0,
      conflicts: 0,
      deprovisioned: 0,
    },
  ],
  issues: [],
};

function user(id: string, email: string): UserEntry {
  const u = new UserEntry();
  u.referenceId = id;
  u.externalId = id;
  u.email = email;
  return u;
}

describe("SyncService", () => {
  let apiService: MockProxy<ApiService>;
  let messagingService: MockProxy<MessagingService>;
  let stateService: MockProxy<StateService>;
  let directory: MockProxy<IDirectoryService>;
  let syncService: SyncService;

  const alice = { dn: "uid=alice,dc=x", attributes: { uid: ["alice"] } };

  beforeEach(() => {
    apiService = mock();
    messagingService = mock();
    stateService = mock();
    directory = mock<IDirectoryService>();
    const directoryFactory = mock<DirectoryFactoryService>();
    directoryFactory.createService.mockReturnValue(directory);

    stateService.getDirectoryType.mockResolvedValue(DirectoryType.Ldap);
    stateService.getOrganizationId.mockResolvedValue("7");
    stateService.getSync.mockResolvedValue(getSyncConfiguration({ users: true, groups: true }));
    directory.getEntries.mockResolvedValue([[], [user("uid=alice,dc=x", "a@x")]]);
    directory.readSnapshot.mockResolvedValue({
      baseDn: "dc=x",
      entries: [alice],
      objectClasses: ["( 2.5.6.6 NAME 'person' STRUCTURAL )"],
    });
    apiService.postDirectorySync.mockResolvedValue(okResponse);

    syncService = new SyncService(apiService, messagingService, stateService, directoryFactory);
  });

  it("always reads the full directory and pushes the snapshot", async () => {
    await syncService.sync(false, false);

    // The upload is the whole read: no user/group search by the old paths (CN=Users breaks on OpenLDAP).
    expect(directory.getEntries).not.toHaveBeenCalled();
    expect(apiService.postDirectorySync).toHaveBeenCalledWith({
      providerId: 7,
      dryRun: false,
      baseDn: "dc=x",
      uploadId: expect.any(String),
      part: 0,
      parts: 1,
      entries: [alice],
      objectClasses: ["( 2.5.6.6 NAME 'person' STRUCTURAL )"],
    });
    expect(stateService.setLastUserSync).toHaveBeenCalled();
    expect(messagingService.send).toHaveBeenLastCalledWith("dirSyncCompleted", {
      successfully: true,
      summary: "AuthenticationAccount: 1 created, 0 updated, 0 unchanged",
    });
  });

  it("does not push in test mode", async () => {
    const result = await syncService.sync(false, true);

    expect(result[1]).toHaveLength(1);
    expect(apiService.postDirectorySync).not.toHaveBeenCalled();
  });

  it("refuses to push an empty directory", async () => {
    directory.readSnapshot.mockResolvedValue({ baseDn: "dc=x", entries: [] });

    await expect(syncService.sync(false, false)).rejects.toThrow("returned no entries");
    expect(apiService.postDirectorySync).not.toHaveBeenCalled();
  });

  it("completes the sync with a warning when Cockpit could not import some entries", async () => {
    apiService.postDirectorySync.mockResolvedValue({
      ...okResponse,
      issues: [{ targetModel: "", severity: "error", code: "x", message: "Mapping is broken" }],
    });

    await syncService.sync(false, false);

    expect(stateService.setLastUserSync).toHaveBeenCalled();
    expect(syncService.lastOutcome?.needsAttention).toBe(true);
    expect(syncService.lastOutcome?.message).toContain("Needs attention in Cockpit");
    expect(syncService.lastOutcome?.message).toContain("Mapping is broken");
  });

  it("says the upload was only stored when Cockpit does not import uploads automatically", async () => {
    apiService.postDirectorySync.mockResolvedValue({
      ...okResponse,
      status: "stored",
      mappings: [],
    });

    await syncService.sync(false, false);

    expect(syncService.lastOutcome?.needsAttention).toBe(false);
    expect(syncService.lastOutcome?.message).toContain("nothing was imported");
  });

  it("uploads a large directory in parts under one upload id, the schema only once", async () => {
    const entries = Array.from({ length: UPLOAD_CHUNK_SIZE * 2 + 1 }, (_, i) => ({
      dn: `uid=u${i},dc=x`,
      attributes: { uid: [`u${i}`] },
    }));
    directory.readSnapshot.mockResolvedValue({ baseDn: "dc=x", entries, objectClasses: ["oc"] });

    await syncService.sync(false, false);

    const calls = apiService.postDirectorySync.mock.calls.map(([req]) => req);
    expect(calls.map((c) => [c.part, c.parts, c.entries.length])).toEqual([
      [0, 3, UPLOAD_CHUNK_SIZE],
      [1, 3, UPLOAD_CHUNK_SIZE],
      [2, 3, 1],
    ]);
    expect(new Set(calls.map((c) => c.uploadId)).size).toBe(1);
    expect(calls.map((c) => c.objectClasses)).toEqual([["oc"], undefined, undefined]);
  });

  it("reports an upload Cockpit keeps until the setup is finished there", async () => {
    apiService.postDirectorySync.mockResolvedValue({
      ...okResponse,
      status: "awaiting-setup",
      received: 434,
      mappings: [],
    });

    await syncService.sync(false, false);

    expect(syncService.lastOutcome).toMatchObject({ status: "awaiting-setup", received: 434 });
    expect(syncService.lastOutcome.message).toContain("Finish the setup in Cockpit");
  });

  it("builds entries itself for directories without a raw snapshot", () => {
    const g = new GroupEntry();
    g.referenceId = "g1";
    g.externalId = "g1";
    g.name = "Teachers";
    g.userMemberExternalIds.add("u1");

    const snapshot = SyncService.snapshotFromEntries(DirectoryType.Okta, [g], [user("u1", "t@x")]);

    expect(snapshot.entries).toEqual([
      {
        dn: "uid=u1,ou=users,o=okta",
        attributes: {
          objectclass: ["user"],
          id: ["u1"],
          externalid: ["u1"],
          mail: ["t@x"],
          disabled: ["false"],
          memberof: ["cn=g1,ou=groups,o=okta"],
        },
      },
      {
        dn: "cn=g1,ou=groups,o=okta",
        attributes: {
          objectclass: ["group"],
          id: ["g1"],
          externalid: ["g1"],
          name: ["Teachers"],
          member: ["uid=u1,ou=users,o=okta"],
        },
      },
    ]);
  });
});

describe("SyncService.describe", () => {
  it("names records that were deactivated or are waiting out the grace period", () => {
    const summary = SyncService.describe({
      ...okResponse,
      mappings: [{ ...okResponse.mappings[0], updated: 3, deprovisioned: 1, pending: 2 }],
    });
    expect(summary).toContain(
      "AuthenticationAccount: 1 created, 3 updated, 0 unchanged, 1 deactivated, 2 gone from the directory, kept for the grace period",
    );
  });
});
