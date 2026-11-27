import * as fs from "fs";
import * as path from "path";

import * as lock from "proper-lockfile";

import type { ConfigLock } from "@/src-cli/commands/config.command";

/**
 * A lock across processes for one `eduneon-dc config` command, so commands run at the same time
 * (a setup script) change the settings one after the other. It has its own lock file next to
 * data.json: the storage locks data.json itself for every single read and write meanwhile.
 */
export function configFileLock(dataDir: string): ConfigLock {
  return async (action) => {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const release = await lock.lock(dataDir, {
      lockfilePath: path.join(dataDir, "config.lock"),
      // A config command takes well under a second; a setup script may start many at once.
      retries: { retries: 60, factor: 1.2, minTimeout: 50, maxTimeout: 1000, randomize: true },
      stale: 30 * 1000,
    });
    try {
      return await action();
    } finally {
      await release();
    }
  };
}
