import { ipcMain } from "electron";

import { TrayMain } from "@/src-gui/tray.main";
import { UpdaterMain } from "@/src-gui/updater.main";
import { WindowMain } from "@/src-gui/window.main";

import { MenuMain } from "./menu.main";

const SyncCheckInterval = 60 * 1000; // 1 minute

export class MessagingMain {
  private syncTimeout: ReturnType<typeof setTimeout>;
  /**
   * Counts Stops. Each scheduled check carries the value it was started under and hands it back
   * when it asks for the next one, so a check that was already running when Stop was pressed
   * cannot switch the schedule back on.
   */
  private syncGeneration = 0;

  constructor(
    private windowMain: WindowMain,
    private menuMain: MenuMain,
    private updaterMain: UpdaterMain,
    private trayMain: TrayMain,
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
        this.scheduleNextSync(message.generation);
        break;
      case "cancelDirSync":
        this.syncGeneration++;
        this.windowMain.win.webContents.send("messagingService", {
          command: "syncScheduleStopped",
        });
        if (this.syncTimeout) {
          global.clearTimeout(this.syncTimeout);
          this.syncTimeout = null;
        }
        break;
      case "hideToTray":
        this.trayMain.hideToTray();
        break;
      default:
        break;
    }
  }

  /** @param generation set when a scheduled check asks for the next one; none when Start is pressed. */
  private scheduleNextSync(generation?: number) {
    if (generation != null && generation !== this.syncGeneration) {
      // Stop was pressed while this check ran.
      return;
    }
    const current = this.syncGeneration;
    this.windowMain.win.webContents.send("messagingService", {
      command: "syncScheduleStarted",
    });

    if (this.syncTimeout) {
      global.clearTimeout(this.syncTimeout);
    }

    this.syncTimeout = global.setTimeout(() => {
      if (this.windowMain.win == null) {
        return;
      }

      this.windowMain.win.webContents.send("messagingService", {
        command: "checkDirSync",
        generation: current,
      });
    }, SyncCheckInterval);
  }
}
