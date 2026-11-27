import "@angular/compiler";
import { Injector, runInInjectionContext } from "@angular/core";

import { I18nService } from "@/libs/abstractions/i18n.service";
import { LogService } from "@/libs/abstractions/log.service";
import { PlatformUtilsService } from "@/libs/abstractions/platformUtils.service";
import { StateService } from "@/libs/abstractions/state.service";
import { DirectoryType } from "@/libs/enums/directoryType";

import { SettingsComponent } from "./settings.component";

const clone = (v: any) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** A state service that keeps what is saved, as the app's storage does. */
function memoryState() {
  const store: Record<string, any> = {};
  const state = {
    store,
    getDirectoryType: async () => store.type ?? null,
    setDirectoryType: async (v: any): Promise<void> => void (store.type = v),
    getDirectory: async (t: any) => clone(store["dir" + t]) ?? null,
    setDirectory: async (t: any, v: any): Promise<void> => void (store["dir" + t] = clone(v)),
    getSync: async () => clone(store.sync) ?? null,
    setSync: async (v: any): Promise<void> => void (store.sync = clone(v)),
  };
  return state;
}

function settingsWith(state: ReturnType<typeof memoryState>) {
  const injector = Injector.create({
    providers: [
      { provide: I18nService, useValue: { t: (k: string) => k } },
      { provide: LogService, useValue: { error: jest.fn() } },
      { provide: StateService, useValue: state },
      { provide: PlatformUtilsService, useValue: { getDevice: () => 0, showToast: jest.fn() } },
    ],
  });
  return runInInjectionContext(injector, () => new SettingsComponent());
}

describe("SettingsComponent save", () => {
  it("saves ldaps://host:636 as LDAPS on 636, though the port field showed 389", async () => {
    const state = memoryState();
    const c = settingsWith(state);
    await c.ngOnInit();
    c.directory.set(DirectoryType.Ldap);
    expect(c.ldap().port).toBe(389);
    c.ldap.update((v) => ({ ...v, hostname: "ldaps://dc1.school.local:636/" }));

    await c.submit();

    const saved = state.store["dir" + DirectoryType.Ldap];
    expect(saved).toMatchObject({ hostname: "dc1.school.local", port: 636, ssl: true });
  });

  it("switches StartTLS off when Encrypted is unticked", async () => {
    const state = memoryState();
    const c = settingsWith(state);
    await c.ngOnInit();
    c.ldap.update((v) => ({ ...v, hostname: "dc1", ssl: true, startTls: true }));
    await c.submit();

    const c2 = settingsWith(state);
    await c2.ngOnInit();
    c2.ldap.update((v) => ({ ...v, ssl: false }));
    await c2.submit();

    expect(state.store["dir" + DirectoryType.Ldap]).toMatchObject({ ssl: false, startTls: false });
  });

  it.each([
    [null, 5],
    [0, 5],
    [2, 5],
    [-5, 5],
    [30, 30],
  ])("saves the interval %p as %p, so the schedule never stops silently", async (typed, saved) => {
    const state = memoryState();
    const c = settingsWith(state);
    await c.ngOnInit();
    c.sync.update((v) => ({ ...v, interval: typed }));

    await c.submit();

    expect(state.store.sync.interval).toBe(saved);
  });

  it("saves the port typed as text as a number", async () => {
    const state = memoryState();
    const c = settingsWith(state);
    await c.ngOnInit();
    c.ldap.update((v) => ({ ...v, hostname: "dc1", port: " 636" as any }));

    await c.submit();

    expect(state.store["dir" + DirectoryType.Ldap].port).toBe(636);
  });

  it("saves at once with the Save button, and shows the cleaned-up values", async () => {
    const state = memoryState();
    const c = settingsWith(state);
    await c.ngOnInit();
    c.ldap.update((v) => ({ ...v, hostname: "ldaps://dc1:636" }));

    await c.save();

    expect(state.store["dir" + DirectoryType.Ldap]).toMatchObject({ hostname: "dc1", port: 636 });
    expect(c.ldap()).toMatchObject({ hostname: "dc1", port: 636, ssl: true });
  });

  // #102
  it("names the LDAP filters an earlier version saved, and removes them on save", async () => {
    const state = memoryState();
    state.store.type = DirectoryType.Ldap;
    state.store.sync = { interval: 15, userFilter: "(uid=alice)", removeDisabled: true };
    const c = settingsWith(state);
    await c.ngOnInit();

    expect(c.ldapUnusedFilters()).toEqual(["userFilter", "removeDisabled"]);

    await c.save();

    expect(state.store.sync).toMatchObject({
      interval: 15,
      userFilter: null,
      removeDisabled: false,
    });
    expect(c.ldapUnusedFilters()).toEqual([]);
  });

  it("keeps the filters of another directory", async () => {
    const state = memoryState();
    state.store.type = DirectoryType.EntraID;
    state.store.sync = { interval: 15, userFilter: "exclude:joe@school.test" };
    const c = settingsWith(state);
    await c.ngOnInit();

    await c.save();

    expect(c.ldapUnusedFilters()).toEqual([]);
    expect(state.store.sync.userFilter).toBe("exclude:joe@school.test");
  });
});
