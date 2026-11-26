import type { Jsonify } from "type-fest";

import type { GroupEntry } from "@/libs/models/groupEntry";
import type { UserEntry } from "@/libs/models/userEntry";
import type { SyncOutcome } from "@/libs/services/sync.service";

export class RendererSyncService {
  run(
    force: boolean,
    test: boolean,
  ): Promise<[Jsonify<GroupEntry>[] | null, Jsonify<UserEntry>[] | null, SyncOutcome | null]> {
    return ipc.sync.run(force, test);
  }

  preview(): ReturnType<typeof ipc.sync.preview> {
    return ipc.sync.preview();
  }
}
