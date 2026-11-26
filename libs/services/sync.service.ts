import { ApiService } from "@/libs/abstractions/api.service";
import { DirectoryFactoryService } from "@/libs/abstractions/directory-factory.service";
import { MessagingService } from "@/libs/abstractions/messaging.service";
import { StateService } from "@/libs/abstractions/state.service";
import { DirectoryType } from "@/libs/enums/directoryType";
import { DirectoryEntry, DirectorySyncResponse } from "@/libs/models/cockpit";
import { GroupEntry } from "@/libs/models/groupEntry";
import { SyncConfiguration } from "@/libs/models/syncConfiguration";
import { UserEntry } from "@/libs/models/userEntry";

import { DirectorySnapshot, IDirectoryService } from "./directory-services/directory.service";

/** Entries per upload request; a few MB each, well under Cockpit's request limit. */
export const UPLOAD_CHUNK_SIZE = 2000;

/** What the last sync did, in words for the person who pressed "Sync". */
export interface SyncOutcome {
  status: DirectorySyncResponse["status"];
  directory: string;
  received: number;
  message: string;
  /** Cockpit took the upload but some entries need an admin there: shown as a warning, not as a failed sync. */
  needsAttention: boolean;
}

/**
 * Reads the configured directory and sends it to Cockpit.
 *
 * Every sync sends the FULL directory: Cockpit maps the raw entries with the mapping configured
 * there, and treats an entry that is missing from the snapshot as gone (deactivate/delete, as
 * configured). So the read is never a delta, and an empty read is never sent.
 */
export class SyncService {
  /** The outcome of the last sync that reached Cockpit; null after a test or a failure. */
  lastOutcome: SyncOutcome | null = null;

  constructor(
    private apiService: ApiService,
    private messagingService: MessagingService,
    private stateService: StateService,
    private directoryFactory: DirectoryFactoryService,
  ) {}

  /**
   * @param test read only and return what was found; nothing is sent to Cockpit.
   * @returns the groups and users found, for display.
   */
  async sync(_force: boolean, test: boolean): Promise<[GroupEntry[], UserEntry[]]> {
    const dirType = await this.stateService.getDirectoryType();
    if (dirType == null) {
      throw new Error("No directory configured.");
    }

    const directoryService = this.directoryFactory.createService(dirType);
    if (directoryService == null) {
      throw new Error("Cannot load directory service.");
    }

    const syncConfig = await this.stateService.getSync();
    const startingGroupDelta = await this.stateService.getGroupDelta();
    const startingUserDelta = await this.stateService.getUserDelta();
    const now = new Date();

    this.lastOutcome = null;
    this.messagingService.send("dirSyncStarted");
    try {
      // A directory read whole for Cockpit (LDAP) needs no user/group search to upload: that search follows the
      // Bitwarden paths and filters (CN=Users by default) and only fails on servers laid out otherwise. A test still
      // runs it, to show what was found.
      const [groups, users] =
        test || directoryService.readSnapshot == null
          ? await directoryService.getEntries(true, test)
          : [[], []];

      if (test) {
        this.messagingService.send("dirSyncCompleted", { successfully: true });
        return [groups, users];
      }

      const snapshot = await SyncService.snapshotOf(directoryService, dirType, groups, users);
      if (snapshot.entries.length === 0) {
        throw new Error(
          "The directory returned no entries, so nothing was sent to Cockpit. " +
            "Check the directory settings (an empty sync would deactivate everyone).",
        );
      }

      const result = await this.upload(snapshot);
      // The upload reached Cockpit: that is a completed sync. What Cockpit could not import is for an admin there,
      // said as such, not as "an error has occurred" on this machine.
      const problems = result?.issues?.filter((i) => i.severity === "error") ?? [];
      const needsAttention =
        problems.length > 0 ||
        (result?.mappings ?? []).some((m) => m.errors > 0 || m.conflicts > 0);
      const described = SyncService.describe(result);
      this.lastOutcome = {
        status: result.status,
        directory: result.provider.name,
        received: result.received,
        needsAttention,
        message: needsAttention
          ? `${described}\n\nNeeds attention in Cockpit (Platform → Authentication → "${result.provider.name}")` +
            (problems.length > 0 ? `:\n${problems.map((i) => `• ${i.message}`).join("\n")}` : ".")
          : described,
      };

      await this.saveSyncTimes(syncConfig, now);
      this.messagingService.send("dirSyncCompleted", {
        successfully: true,
        summary: this.lastOutcome.message,
      });
      return [groups, users];
    } catch (e) {
      if (!test) {
        await this.stateService.setGroupDelta(startingGroupDelta);
        await this.stateService.setUserDelta(startingUserDelta);
      }

      this.messagingService.send("dirSyncCompleted", { successfully: false });
      throw e;
    }
  }

  /**
   * Send the snapshot in parts of UPLOAD_CHUNK_SIZE entries under one upload id. Cockpit applies it
   * when the last part arrives, so the answer to the last part is the result of the sync.
   */
  private async upload(snapshot: DirectorySnapshot): Promise<DirectorySyncResponse> {
    const providerId = Number(await this.stateService.getOrganizationId());
    const parts = Math.max(1, Math.ceil(snapshot.entries.length / UPLOAD_CHUNK_SIZE));
    const uploadId = crypto.randomUUID();
    let result: DirectorySyncResponse = null;
    for (let part = 0; part < parts; part++) {
      result = await this.apiService.postDirectorySync({
        providerId: Number.isInteger(providerId) && providerId > 0 ? providerId : undefined,
        dryRun: false,
        baseDn: snapshot.baseDn,
        uploadId,
        part,
        parts,
        entries: snapshot.entries.slice(part * UPLOAD_CHUNK_SIZE, (part + 1) * UPLOAD_CHUNK_SIZE),
        // The schema travels once, with the first part.
        ...(part === 0 && snapshot.objectClasses?.length
          ? { objectClasses: snapshot.objectClasses }
          : {}),
      });
    }
    return result;
  }

  /** What Cockpit did with the upload, for the person who pressed "Sync". */
  static describe(result: DirectorySyncResponse): string {
    if (result?.status === "stored") {
      return (
        `Uploaded ${result.received} directory entries to "${result.provider.name}". ` +
        "They are stored in Cockpit; nothing was imported. Start the import in Cockpit (Platform → Authentication), " +
        'or switch on "Import each upload automatically" there.'
      );
    }
    if (result?.status === "awaiting-setup") {
      return (
        `Uploaded ${result.received} directory entries to "${result.provider.name}". ` +
        "Finish the setup in Cockpit (Platform → Authentication): choose what to import and run the first import."
      );
    }
    if (result?.mappings == null || result.mappings.length === 0) {
      return `Cockpit received ${result?.received ?? 0} entries; no mapping is enabled for this directory in Cockpit yet.`;
    }
    return result.mappings
      .map((m) => {
        const parts = [`${m.created} created`, `${m.updated} updated`, `${m.skipped} unchanged`];
        if (m.deprovisioned > 0) {
          parts.push(`${m.deprovisioned} deactivated`);
        }
        if ((m.pending ?? 0) > 0) {
          parts.push(`${m.pending} gone from the directory, kept for the grace period`);
        }
        if (m.conflicts > 0) {
          parts.push(`${m.conflicts} need a decision in Cockpit`);
        }
        if (m.errors > 0) {
          parts.push(`${m.errors} failed`);
        }
        return `${m.targetModel}: ${parts.join(", ")}`;
      })
      .join("\n");
  }

  /**
   * What a sync would upload, read the same way, without sending anything: the number of entries per
   * object class. For `eduneon-dc test`, so an admin sees what Cockpit will get before the first sync.
   */
  async preview(): Promise<{
    baseDn: string;
    total: number;
    byClass: Array<{ objectClass: string; count: number }>;
  }> {
    const dirType = await this.stateService.getDirectoryType();
    if (dirType == null) {
      throw new Error("No directory configured. Run: eduneon-dc config directory ldap");
    }
    const directoryService = this.directoryFactory.createService(dirType);
    if (directoryService == null) {
      throw new Error("Cannot load directory service.");
    }
    const [groups, users] =
      directoryService.readSnapshot == null
        ? await directoryService.getEntries(true, true)
        : [[], []];
    const snapshot = await SyncService.snapshotOf(directoryService, dirType, groups, users);
    const counts = new Map<string, number>();
    for (const entry of snapshot.entries) {
      const classes = (entry.attributes.objectclass ?? []).filter((c) => c.toLowerCase() !== "top");
      const objectClass = classes[classes.length - 1] ?? "(none)";
      counts.set(objectClass, (counts.get(objectClass) ?? 0) + 1);
    }
    return {
      baseDn: snapshot.baseDn,
      total: snapshot.entries.length,
      byClass: [...counts.entries()]
        .map(([objectClass, count]) => ({ objectClass, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  private static async snapshotOf(
    directoryService: IDirectoryService,
    dirType: DirectoryType,
    groups: GroupEntry[],
    users: UserEntry[],
  ): Promise<DirectorySnapshot> {
    return directoryService.readSnapshot
      ? await directoryService.readSnapshot()
      : (directoryService.getSnapshot?.() ??
          SyncService.snapshotFromEntries(dirType, groups, users));
  }

  /**
   * For directories that do not collect raw entries (Okta, OneLogin): describe each user and group
   * with the fields the connector knows.
   */
  static snapshotFromEntries(
    dirType: DirectoryType,
    groups: GroupEntry[],
    users: UserEntry[],
  ): DirectorySnapshot {
    const o = DirectoryType[dirType]?.toLowerCase() ?? "directory";
    const userDn = (id: string) => `uid=${id},ou=users,o=${o}`;
    const groupDn = (id: string) => `cn=${id},ou=groups,o=${o}`;
    const entries: DirectoryEntry[] = [];
    for (const u of users ?? []) {
      if (u.deleted) {
        continue;
      }
      const memberOf = (groups ?? [])
        .filter((g) => g.userMemberExternalIds.has(u.externalId))
        .map((g) => groupDn(g.referenceId));
      entries.push({
        dn: userDn(u.referenceId),
        attributes: {
          objectclass: ["user"],
          id: [u.referenceId],
          externalid: [u.externalId],
          ...(u.email ? { mail: [u.email] } : {}),
          disabled: [String(u.disabled)],
          ...(memberOf.length > 0 ? { memberof: memberOf } : {}),
        },
      });
    }
    for (const g of groups ?? []) {
      const usersById = new Map((users ?? []).map((u) => [u.externalId, u.referenceId]));
      const member = [
        ...[...g.userMemberExternalIds].map((id) => userDn(usersById.get(id) ?? id)),
        ...[...g.groupMemberReferenceIds].map(groupDn),
      ];
      entries.push({
        dn: groupDn(g.referenceId),
        attributes: {
          objectclass: ["group"],
          id: [g.referenceId],
          externalid: [g.externalId],
          ...(g.name ? { name: [g.name] } : {}),
          ...(member.length > 0 ? { member } : {}),
        },
      });
    }
    return { baseDn: "", entries };
  }

  // The whole directory went to Cockpit: that is when it last synced, whatever the user/group switches say.
  private async saveSyncTimes(_syncConfig: SyncConfiguration, time: Date) {
    await this.stateService.setLastGroupSync(time);
    await this.stateService.setLastUserSync(time);
  }
}
