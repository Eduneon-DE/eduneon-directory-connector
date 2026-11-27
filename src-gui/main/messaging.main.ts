import { ipcMain } from "electron";

import { LogService } from "@/libs/abstractions/log.service";
import { StateService } from "@/libs/abstractions/state.service";
import { SyncService } from "@/libs/services/sync.service";
import { isValidSyncInterval } from "@/libs/utils/syncInterval";

import { TrayMain } from "@/src-gui/tray.main";
import { UpdaterMain } from "@/src-gui/updater.main";
import { WindowMain } from "@/src-gui/window.main";

import { MenuMain } from "./menu.main";

const SyncCheckInterval = 60 * 1000; // 1 minute

/**
 * Runs the automatic sync schedule. The timer and the sync both live in the main process, so the
 * schedule keeps running while the window is closed (macOS keeps the app in the dock) and is
 * switched back on when the app starts with the schedule saved as on.
 */
export class MessagingMain {
  private syncTimeout: ReturnType<typeof setTimeout>;
  /**
   * Counts Stops. Each scheduled check carries the value it was started under, so a check that
   * was already running when Stop was pressed cannot switch the schedule back on.
   */
  private syncGeneration = 0;

  constructor(
    private windowMain: WindowMain,
    private menuMain: MenuMain,
    private updaterMain: UpdaterMain,
    private trayMain: TrayMain,
    private stateService: StateService,
    private syncService: Pick<SyncService, "sync">,
    private logService: LogService,
  ) {}

  init() {
    ipcMain.on("messagingService", async (event: any, message: any) => this.onMessage(message));
  }

  onMessage(message: any) {
    switch (message.command) {
      case "checkForUpdate":
        this.updaterMain.checkForUpdate(true);
        break;
      case "scheduleNextDirSync":
        this.startSchedule();
        break;
      case "cancelDirSync":
        this.stopSchedule();
        break;
      case "logout":
        // A logged-out connector has nothing to sync with: the schedule stops with the login.
        this.stopSchedule();
        break;
      case "hideToTray":
        this.trayMain.hideToTray();
        break;
      default:
        break;
    }
  }

  /** At app start: a schedule that was on when the app last ran is on again. */
  async resumeSchedule() {
    try {
      if (await this.stateService.getSyncingDir()) {
        this.startSchedule();
      }
    } catch (e) {
      this.logService.error(e);
    }
  }

  private startSchedule() {
    void this.saveSyncingDir(true);
    this.sendToWindow({ command: "syncScheduleStarted" });
    this.armSyncCheck(this.syncGeneration);
  }

  private stopSchedule() {
    this.syncGeneration++;
    if (this.syncTimeout) {
      global.clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }
    void this.saveSyncingDir(false);
    this.sendToWindow({ command: "syncScheduleStopped" });
  }

  private armSyncCheck(generation: number) {
    if (this.syncTimeout) {
      global.clearTimeout(this.syncTimeout);
    }
    this.syncTimeout = global.setTimeout(
      () => void this.checkDirSync(generation),
      SyncCheckInterval,
    );
  }

  /** Sync when the interval has passed since the last sync; always check again a minute later. */
  private async checkDirSync(generation: number) {
    try {
      if (await this.isSyncDue()) {
        await this.syncService.sync(false, false);
      }
    } catch (e) {
      this.logService.error(`Scheduled sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      // Stop was pressed while this check ran: stay stopped.
      if (generation === this.syncGeneration) {
        this.armSyncCheck(generation);
      }
    }
  }

  private async isSyncDue(): Promise<boolean> {
    const syncConfig = await this.stateService.getSync();
    if (!isValidSyncInterval(syncConfig?.interval)) {
      // Nothing to go by until a valid interval is saved; the next check reads it again.
      return false;
    }
    const lastSyncs = [
      await this.stateService.getLastGroupSync(),
      await this.stateService.getLastUserSync(),
    ].filter((d) => d != null);
    if (lastSyncs.length === 0) {
      return true;
    }
    // The older of the two times counts. A time in the future (the clock was set back) waits.
    const lastSync = Math.min(...lastSyncs.map((d) => new Date(d).getTime()));
    return Date.now() - lastSync >= syncConfig.interval * 60000;
  }

  private async saveSyncingDir(value: boolean) {
    try {
      await this.stateService.setSyncingDir(value);
    } catch (e) {
      this.logService.error(e);
    }
  }

  private sendToWindow(message: { command: string }) {
    const win = this.windowMain.win;
    if (win == null || win.isDestroyed()) {
      return;
    }
    win.webContents.send("messagingService", message);
  }
}
