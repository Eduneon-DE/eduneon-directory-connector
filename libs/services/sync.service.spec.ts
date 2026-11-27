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
import { SyncService, UPLOAD_CHUNK_SIZE, UPLOAD_PART_BYTES } from "./sync.service";

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
      outcome: expect.objectContaining({ status: "synced", needsAttention: false }),
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

    const [, , outcome] = await syncService.sync(false, false);

    expect(stateService.setLastUserSync).toHaveBeenCalled();
    expect(outcome?.needsAttention).toBe(true);
    expect(outcome?.message).toContain("Needs attention in Cockpit");
    expect(outcome?.message).toContain("Mapping is broken");
  });

  it("says the upload was only stored when Cockpit does not import uploads automatically", async () => {
    apiService.postDirectorySync.mockResolvedValue({
      ...okResponse,
      status: "stored",
      mappings: [],
    });

    const [, , outcome] = await syncService.sync(false, false);

    expect(outcome?.needsAttention).toBe(false);
    expect(outcome?.message).toContain("nothing was imported");
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

  it("starts a new part by size, so big entries never make a part over Cockpit's request limit", async () => {
    // 2000 entries of about 20 KB each: 40 MB, one part by count alone (Cockpit refuses over 50 MiB).
    const big = "x".repeat(20 * 1024);
    const entries = Array.from({ length: UPLOAD_CHUNK_SIZE }, (_, i) => ({
      dn: `uid=u${i},dc=x`,
      attributes: { uid: [`u${i}`], description: [big] },
    }));
    directory.readSnapshot.mockResolvedValue({ baseDn: "dc=x", entries, objectClasses: ["oc"] });

    await syncService.sync(false, false);

    const calls = apiService.postDirectorySync.mock.calls.map(([req]) => req);
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const call of calls) {
      expect(call.parts).toBe(calls.length);
      expect(Buffer.byteLength(JSON.stringify(call.entries))).toBeLessThanOrEqual(
        UPLOAD_PART_BYTES,
      );
    }
    expect(calls.map((c) => c.part)).toEqual(calls.map((_, i) => i));
    expect(calls.flatMap((c) => c.entries)).toEqual(entries);
    expect(new Set(calls.map((c) => c.uploadId)).size).toBe(1);
  });

  it("puts an entry bigger than a part on its own, and sends an empty snapshot as one part", () => {
    const huge = { dn: "cn=g,dc=x", attributes: { member: ["y".repeat(200)] } };
    const small = { dn: "uid=a,dc=x", attributes: { uid: ["a"] } };
    expect(SyncService.splitIntoParts([small, huge, small], 10, 100)).toEqual([
      [small],
      [huge],
      [small],
    ]);
    expect(SyncService.splitIntoParts([])).toEqual([[]]);
  });

  it("reports an upload Cockpit keeps until the setup is finished there", async () => {
    apiService.postDirectorySync.mockResolvedValue({
      ...okResponse,
      status: "awaiting-setup",
      received: 434,
      mappings: [],
    });

    const [, , outcome] = await syncService.sync(false, false);

    expect(outcome).toMatchObject({ status: "awaiting-setup", received: 434 });
    expect(outcome.message).toContain("Finish the setup in Cockpit");
  });

  it("lets a second sync join the running one: one upload, both get its outcome", async () => {
    let answer: (r: DirectorySyncResponse) => void;
    apiService.postDirectorySync.mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );

    const syncNow = syncService.sync(false, false);
    await new Promise((r) => setTimeout(r, 5));
    const scheduled = syncService.sync(false, false); // a scheduled check while Sync Now runs
    answer({ ...okResponse, provider: { id: 7, name: "A" } });
    const [first, second] = await Promise.all([syncNow, scheduled]);

    expect(apiService.postDirectorySync).toHaveBeenCalledTimes(1);
    expect(first[2]).toMatchObject({ directory: "A", status: "synced" });
    expect(second[2]).toBe(first[2]);

    // Finished: the next sync uploads again.
    apiService.postDirectorySync.mockResolvedValue(okResponse);
    await syncService.sync(false, false);
    expect(apiService.postDirectorySync).toHaveBeenCalledTimes(2);
  });

  it("returns each sync's own outcome, also when the next one starts while it saves its times", async () => {
    // setup-10: the outcome used to sit on the service, so a sync starting meanwhile wiped it.
    let releaseSave: () => void;
    stateService.setLastGroupSync.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseSave = resolve)),
    );
    apiService.postDirectorySync.mockResolvedValueOnce({
      ...okResponse,
      provider: { id: 7, name: "A" },
    });

    const a = syncService.sync(false, false);
    await new Promise((r) => setTimeout(r, 5));
    const b = syncService.sync(false, false);
    releaseSave();

    expect((await a)[2]).toMatchObject({ directory: "A" });
    expect((await b)[2]).toMatchObject({ directory: "A" });
  });

  it("reads Cockpit's sync-in-progress answer as a refusal and does not save the sync time", async () => {
    apiService.postDirectorySync.mockResolvedValue({
      ...okResponse,
      mappings: [],
      issues: [
        {
          targetModel: "",
          severity: "error",
          code: "sync-in-progress",
          message: "A model sync for identity provider 7 is already running.",
        },
      ],
    });

    const [, , outcome] = await syncService.sync(false, false);

    expect(outcome.refused).toBe(true);
    expect(outcome.needsAttention).toBe(true);
    expect(outcome.message).toContain("another import");
    expect(outcome.message).not.toContain("no mapping is enabled");
    expect(stateService.setLastGroupSync).not.toHaveBeenCalled();
    expect(stateService.setLastUserSync).not.toHaveBeenCalled();
    expect(messagingService.send).toHaveBeenLastCalledWith(
      "dirSyncCompleted",
      expect.objectContaining({ successfully: false, outcome }),
    );
  });

  it("shows Cockpit's warnings as needing attention", async () => {
    apiService.postDirectorySync.mockResolvedValue({
      ...okResponse,
      issues: [
        {
          targetModel: "AuthenticationAccount",
          severity: "warning",
          code: "read-empty",
          message: "The read found no entries for this mapping.",
        },
      ],
    });

    const [, , outcome] = await syncService.sync(false, false);

    expect(outcome.needsAttention).toBe(true);
    expect(outcome.message).toContain("The read found no entries for this mapping.");
    expect(stateService.setLastUserSync).toHaveBeenCalled();
  });

  it("does not say 'no mapping is enabled' when Cockpit imported nothing because of an error", () => {
    const message = SyncService.describe({
      ...okResponse,
      mappings: [],
      issues: [{ targetModel: "", severity: "error", code: "x", message: "broken" }],
    });
    expect(message).not.toContain("no mapping is enabled");
    expect(message).toContain("imported nothing");
  });

  it("sends why a sync failed with dirSyncCompleted, for the dashboard", async () => {
    apiService.postDirectorySync.mockRejectedValue(new Error("Cockpit is down"));

    await expect(syncService.sync(false, false)).rejects.toThrow("Cockpit is down");

    expect(messagingService.send).toHaveBeenLastCalledWith("dirSyncCompleted", {
      successfully: false,
      error: "Cockpit is down",
    });
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
