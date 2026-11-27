import "@angular/compiler";
import { ChangeDetectorRef, Injector, runInInjectionContext } from "@angular/core";

import { BroadcasterService } from "@/libs/abstractions/broadcaster.service";
import { I18nService } from "@/libs/abstractions/i18n.service";
import { MessagingService } from "@/libs/abstractions/messaging.service";
import { PlatformUtilsService } from "@/libs/abstractions/platformUtils.service";
import { StateService } from "@/libs/abstractions/state.service";
import { BroadcasterService as RealBroadcaster } from "@/libs/services/broadcaster.service";

import { RendererSyncService } from "@/src-gui/services/electron/rendererSync.service";

import { DashboardComponent } from "./dashboard.component";

async function dashboard(interval: number | null) {
  const broadcaster = new RealBroadcaster();
  const toMain: string[] = [];
  const toasts: any[] = [];
  const run = jest.fn(async (): Promise<any> => [[], [], null]);
  const injector = Injector.create({
    providers: [
      { provide: ChangeDetectorRef, useValue: { markForCheck: jest.fn() } },
      { provide: RendererSyncService, useValue: { run } },
      { provide: I18nService, useValue: { t: (k: string) => k } },
      { provide: BroadcasterService, useValue: broadcaster },
      { provide: MessagingService, useValue: { send: (c: string) => toMain.push(c) } },
      {
        provide: PlatformUtilsService,
        useValue: { showToast: (...args: any[]) => toasts.push(args) },
      },
      {
        provide: StateService,
        useValue: {
          getSync: async () => ({ interval }),
          getSyncingDir: async () => false,
          getDirectoryType: async () => 0,
          getLastGroupSync: async (): Promise<Date> => null,
          getLastUserSync: async (): Promise<Date> => null,
        },
      },
    ],
  });
  const c = runInInjectionContext(injector, () => new DashboardComponent());
  await c.ngOnInit();
  return { c, broadcaster, toMain, toasts, run };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("DashboardComponent", () => {
  it.each([null, 0, 3])("does not start the schedule with the interval %p", async (interval) => {
    const { c, toMain, toasts, run } = await dashboard(interval);

    await c.start();

    expect(run).not.toHaveBeenCalled();
    expect(toMain).not.toContain("scheduleNextDirSync");
    expect(c.syncRunning()).toBe(false);
    expect(toasts[0][0]).toBe("error");
  });

  it("starts the schedule with a valid interval", async () => {
    const { c, toMain } = await dashboard(5);

    await c.start();

    expect(toMain).toContain("scheduleNextDirSync");
    expect(c.syncRunning()).toBe(true);
  });

  it("shows what a scheduled sync did, warnings included", async () => {
    const { c, broadcaster } = await dashboard(5);

    broadcaster.send({
      command: "dirSyncCompleted",
      successfully: true,
      outcome: { message: "1 created\n\nNeeds attention in Cockpit", needsAttention: true },
    });
    await flush();

    expect(c.lastResult()).toEqual({
      message: "1 created\n\nNeeds attention in Cockpit",
      needsAttention: true,
    });
  });

  it("shows why a scheduled sync failed", async () => {
    const { c, broadcaster } = await dashboard(5);

    broadcaster.send({ command: "dirSyncCompleted", successfully: false, error: "LDAP down" });
    await flush();

    expect(c.lastResult()).toEqual({
      message: "The last sync failed: LDAP down",
      needsAttention: true,
    });
  });

  it("shows Cockpit's refusal as a warning, not as a completed sync", async () => {
    const { c, run, toasts } = await dashboard(5);
    run.mockResolvedValue([[], [], { message: "another import is running", refused: true }]);

    await c.sync();

    expect(toasts).toEqual([["warning", null, "another import is running", { timeout: 15000 }]]);
  });
});
