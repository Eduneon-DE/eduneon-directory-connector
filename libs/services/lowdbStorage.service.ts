import * as lock from "proper-lockfile";

import { LogService } from "@/libs/abstractions/log.service";
import { LowdbStorageService as LowdbStorageServiceBase } from "@/libs/services/baseLowdbStorage.service";
import { Utils } from "@/libs/utils/utils";

export class LowdbStorageService extends LowdbStorageServiceBase {
  constructor(
    logService: LogService,
    defaults?: any,
    dir?: string,
    allowCache = false,
    private requireLock = false,
  ) {
    super(logService, defaults, dir, allowCache);
  }

  /** The lock work of this process, one at a time (see lockDbFile). */
  private lockQueue: Promise<unknown> = Promise.resolve();

  /**
   * Runs the action while holding the data file's lock. Within one process the calls queue up
   * instead of all trying the lock file at once: parallel callers (such as the five token removals
   * of a logout) used to run out of retries on their own lock ("Lock file is already being held").
   * The file lock itself is for other processes (the CLI next to the desktop app).
   */
  protected async lockDbFile<T>(action: () => T): Promise<T> {
    if (!this.requireLock || Utils.isNullOrWhitespace(this.dataFilePath)) {
      return action();
    }
    const run = async () => {
      this.logService.info("acquiring db file lock");
      const release = await lock.lock(this.dataFilePath, {
        retries: { retries: 10, factor: 1.5, minTimeout: 50, maxTimeout: 1000, randomize: true },
      });
      try {
        return action();
      } finally {
        await release();
      }
    };
    const result = this.lockQueue.then(run, run);
    this.lockQueue = result.catch((): void => undefined);
    return result;
  }
}
