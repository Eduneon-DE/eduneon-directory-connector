jest.mock("electron", () => ({ ipcMain: { on: jest.fn() } }));
jest.mock("@/src-gui/tray.main", () => ({ TrayMain: class {} }));
jest.mock("@/src-gui/updater.main", () => ({ UpdaterMain: class {} }));
jest.mock("@/src-gui/window.main", () => ({ WindowMain: class {} }));
jest.mock("./menu.main", () => ({ MenuMain: class {} }));

import { MessagingMain } from "./messaging.main";

describe("MessagingMain sync schedule", () => {
  let sent: any[];
  let main: MessagingMain;

  beforeEach(() => {
    jest.useFakeTimers();
    sent = [];
    const windowMain = { win: { webContents: { send: (_: string, m: any) => sent.push(m) } } };
    main = new MessagingMain(windowMain as any, null, null, null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const checks = () => sent.filter((m) => m.command === "checkDirSync");

  it("does not switch the schedule back on when a check that was running at Stop finishes", () => {
    main.onMessage({ command: "scheduleNextDirSync" }); // Start
    jest.advanceTimersByTime(60_000);
    const check = checks()[0];
    expect(check).toBeDefined();

    // The check's sync is running; Stop is pressed; then the check asks for the next one.
    main.onMessage({ command: "cancelDirSync" });
    main.onMessage({ command: "scheduleNextDirSync", generation: check.generation });
    jest.advanceTimersByTime(10 * 60_000);

    expect(checks()).toHaveLength(1);
    expect(sent[sent.length - 1].command).toBe("syncScheduleStopped");
  });

  it("keeps checking while the schedule is on, and starts again after Stop and Start", () => {
    main.onMessage({ command: "scheduleNextDirSync" });
    jest.advanceTimersByTime(60_000);
    main.onMessage({ command: "scheduleNextDirSync", generation: checks()[0].generation });
    jest.advanceTimersByTime(60_000);
    expect(checks()).toHaveLength(2);

    main.onMessage({ command: "cancelDirSync" });
    main.onMessage({ command: "scheduleNextDirSync" });
    jest.advanceTimersByTime(60_000);
    expect(checks()).toHaveLength(3);
  });
});
