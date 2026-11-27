jest.mock("electron", () => ({ ipcMain: { on: jest.fn() } }));
jest.mock("@/src-gui/tray.main", () => ({ TrayMain: class {} }));
jest.mock("@/src-gui/updater.main", () => ({ UpdaterMain: class {} }));
jest.mock("@/src-gui/window.main", () => ({ WindowMain: class {} }));
jest.mock("./menu.main", () => ({ MenuMain: class {} }));

import { MessagingMain } from "./messaging.main";

describe("MessagingMain sync schedule", () => {
  let sent: any[];
  let windowMain: { win: any };
  let store: { syncingDir?: boolean; interval: number | null; lastSync: Date | null };
  let syncs: number;
  let syncImpl: () => Promise<any>;
  let main: MessagingMain;

  const win = () => ({
    isDestroyed: () => false,
    webContents: { send: (_: string, m: any) => sent.push(m) },
  });
  const commands = () => sent.map((m) => m.command);
  /** Let the timer's promise chain (state reads, the sync, re-arming) finish. */
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  };
  const minutes = async (n: number) => {
    for (let i = 0; i < n; i++) {
      jest.advanceTimersByTime(60_000);
      await settle();
    }
  };

  beforeEach(() => {
    jest.useFakeTimers();
    sent = [];
    syncs = 0;
    store = { interval: 5, lastSync: null };
    syncImpl = async () => [[], [], null];
    windowMain = { win: win() };
    const stateService: any = {
      getSyncingDir: async () => store.syncingDir,
      setSyncingDir: async (v: boolean): Promise<void> => void (store.syncingDir = v),
      getSync: async () => ({ interval: store.interval }),
      getLastGroupSync: async () => store.lastSync,
      getLastUserSync: async () => store.lastSync,
    };
    const syncService: any = {
      sync: async () => {
        syncs++;
        const result = await syncImpl();
        store.lastSync = new Date();
        return result;
      },
    };
    const logService: any = { error: jest.fn() };
    main = new MessagingMain(
      windowMain as any,
      null,
      null,
      null,
      stateService,
      syncService,
      logService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("syncs when the interval has passed and keeps checking every minute", async () => {
    main.onMessage({ command: "scheduleNextDirSync" }); // Start
    await settle();
    expect(store.syncingDir).toBe(true);
    expect(commands()).toEqual(["syncScheduleStarted"]);

    await minutes(1);
    expect(syncs).toBe(1); // never synced before

    await minutes(4);
    expect(syncs).toBe(1); // 4 of 5 minutes
    await minutes(1);
    expect(syncs).toBe(2);
  });

  it("keeps syncing while the window is closed (macOS: the app stays in the dock)", async () => {
    main.onMessage({ command: "scheduleNextDirSync" });
    windowMain.win = null;

    await minutes(11);
    expect(syncs).toBe(3); // minutes 1, 6 and 11

    windowMain.win = win(); // reopened from the dock
    await minutes(5);
    expect(syncs).toBe(4);
  });

  it("switches the schedule back on when the app starts with it saved as on", async () => {
    store.syncingDir = true;

    await main.resumeSchedule();
    await minutes(1);

    expect(syncs).toBe(1);
    expect(commands()).toContain("syncScheduleStarted");
  });

  it("stays off at app start when the schedule was off", async () => {
    store.syncingDir = false;

    await main.resumeSchedule();
    await minutes(10);

    expect(syncs).toBe(0);
  });

  it("keeps checking after a failed sync", async () => {
    syncImpl = async () => {
      throw new Error("LDAP server down");
    };
    main.onMessage({ command: "scheduleNextDirSync" });

    await minutes(3);

    expect(syncs).toBe(3); // the failed sync saved no time: every check tries again
  });

  it("does not sync with an unusable interval, and resumes once a valid one is saved", async () => {
    store.interval = null;
    main.onMessage({ command: "scheduleNextDirSync" });
    await minutes(10);
    expect(syncs).toBe(0);

    store.interval = 3;
    await minutes(10);
    expect(syncs).toBe(0);

    store.interval = 5;
    await minutes(1);
    expect(syncs).toBe(1);
  });

  it("waits when the last sync is in the future (the clock was set back)", async () => {
    store.lastSync = new Date(Date.now() + 3600_000);
    main.onMessage({ command: "scheduleNextDirSync" });

    await minutes(10);

    expect(syncs).toBe(0);
  });

  it("does not switch the schedule back on when a check that was running at Stop finishes", async () => {
    let finish: () => void;
    syncImpl = () => new Promise((resolve) => (finish = () => resolve([[], [], null])));
    main.onMessage({ command: "scheduleNextDirSync" });
    await minutes(1);
    expect(syncs).toBe(1);

    // The check's sync is running; Stop is pressed; then the sync finishes.
    main.onMessage({ command: "cancelDirSync" });
    finish();
    await settle();
    syncImpl = async () => [[], [], null];
    await minutes(30);

    expect(syncs).toBe(1);
    expect(store.syncingDir).toBe(false);
    expect(commands()[commands().length - 1]).toBe("syncScheduleStopped");
  });

  it("starts again after Stop and Start", async () => {
    main.onMessage({ command: "scheduleNextDirSync" });
    await minutes(1);
    main.onMessage({ command: "cancelDirSync" });
    await minutes(10);
    expect(syncs).toBe(1);

    main.onMessage({ command: "scheduleNextDirSync" });
    await minutes(5);
    expect(syncs).toBe(2);
  });

  it("stops the schedule on logout", async () => {
    main.onMessage({ command: "scheduleNextDirSync" });
    main.onMessage({ command: "logout", expired: false });

    await minutes(10);

    expect(syncs).toBe(0);
    expect(store.syncingDir).toBe(false);
  });
});
