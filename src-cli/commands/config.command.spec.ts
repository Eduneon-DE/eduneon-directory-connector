/**
 * @jest-environment node
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { mock } from "jest-mock-extended";

import { I18nService } from "@/libs/abstractions/i18n.service";
import { LogService } from "@/libs/abstractions/log.service";
import { DirectoryType } from "@/libs/enums/directoryType";
import { LdapConfiguration } from "@/libs/models/ldapConfiguration";
import { DefaultEnvironmentService } from "@/libs/services/environment/environment.service";
import { LowdbStorageService } from "@/libs/services/lowdbStorage.service";
import { DefaultStateService } from "@/libs/services/state-service/default-state.service";

import { configFileLock } from "@/src-cli/services/node/configLock";

import { ConfigCommand } from "./config.command";

// lowdb ships only as ESM, which this Jest setup does not load; its LowSync is this small.
jest.mock("lowdb", () => ({
  LowSync: class {
    data: unknown;
    constructor(
      private adapter: { read(): unknown; write(data: unknown): void },
      defaults: unknown,
    ) {
      this.data = defaults;
    }
    read() {
      this.data = this.adapter.read() ?? this.data;
    }
    write() {
      this.adapter.write(this.data);
    }
  },
}));

const i18n = { t: (key: string, ...args: string[]) => [key, ...args].join(" ") } as I18nService;

describe("ConfigCommand", () => {
  let dir: string;

  /** One CLI process: its own storage on the shared data dir, as two `eduneon-dc` runs have. */
  async function cli(withLock = true) {
    const storage = new LowdbStorageService(mock<LogService>(), null, dir, false, true);
    await storage.init();
    const state = new DefaultStateService(storage, storage, mock<LogService>(), null, false);
    const environment = new DefaultEnvironmentService(state);
    await environment.setUrlsFromStorage();
    const command = new ConfigCommand(
      i18n,
      state,
      environment,
      withLock ? configFileLock(dir) : undefined,
    );
    const run = (setting: string, value?: string, options: Record<string, string> = {}) =>
      command.run(setting, value, options);
    return { run, state, environment };
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-config-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // conn-10
  it("keeps every setting when several config commands run at once", async () => {
    await (await cli()).run("directory", "ldap");
    const settings: Array<[string, string]> = [
      ["ldap.hostname", "dc1.school.test"],
      ["ldap.port", "636"],
      ["ldap.rootpath", "dc=school,dc=test"],
      ["ldap.username", "cn=sync,dc=school,dc=test"],
      ["ldap.password", "fake-password"],
    ];
    const clis = await Promise.all(settings.map(() => cli()));

    const results = await Promise.all(clis.map((c, i) => c.run(...settings[i])));

    expect(results.map((r) => r.success)).toEqual([true, true, true, true, true]);
    const ldap = await (await cli()).state.getDirectory<LdapConfiguration>(DirectoryType.Ldap);
    expect(ldap).toMatchObject({
      hostname: "dc1.school.test",
      port: 636,
      rootPath: "dc=school,dc=test",
      username: "cn=sync,dc=school,dc=test",
      password: "fake-password",
    });
  });

  // conn-7
  describe("changing the server while logged in", () => {
    async function loggedInTo(server: string) {
      const c = await cli();
      await c.run("server", server);
      await c.state.setAccessToken("FAKE-TOKEN-OF-A");
      await c.state.setOrganizationId("9182");
      return c;
    }

    it("refuses another server, so the token never goes there", async () => {
      const c = await loggedInTo("https://a.cockpit.test");

      const result = await c.run("server", "https://b.cockpit.test");

      expect(result.success).toBe(false);
      expect(result.message).toContain("logout");
      expect(c.environment.getApiUrl()).toBe("https://a.cockpit.test/api");
    });

    it("refuses an imported file that names another server", async () => {
      const c = await loggedInTo("https://a.cockpit.test");
      const file = path.join(dir, "other.json");
      fs.writeFileSync(file, JSON.stringify({ server: "https://b.cockpit.test" }));

      const result = await c.run("import", file);

      expect(result.success).toBe(false);
      expect((await cli()).environment.getApiUrl()).toBe("https://a.cockpit.test/api");
    });

    it("accepts the same server written another way", async () => {
      const c = await loggedInTo("https://a.cockpit.test");

      const result = await c.run("server", "a.cockpit.test/");

      expect(result.success).toBe(true);
    });

    it("lets a logged-out connector change the server", async () => {
      const c = await cli();
      await c.run("server", "https://a.cockpit.test");

      const result = await c.run("server", "https://b.cockpit.test");

      expect(result.success).toBe(true);
      expect(c.environment.getApiUrl()).toBe("https://b.cockpit.test/api");
    });
  });

  // conn-26
  it.each([["ldap.username"], ["ldap.port"], ["server"]])(
    "refuses %s without a value instead of clearing it",
    async (setting) => {
      const c = await cli();
      await c.run("directory", "ldap");
      await c.run("server", "https://a.cockpit.test");
      await c.run("ldap.username", "cn=x,dc=test");
      await c.run("ldap.port", "636");

      const result = await c.run(setting, undefined);

      expect(result.success).toBe(false);
      const ldap = await c.state.getDirectory<LdapConfiguration>(DirectoryType.Ldap);
      expect(ldap.username).toBe("cn=x,dc=test");
      expect(ldap.port).toBe(636);
      expect(c.environment.getApiUrl()).toBe("https://a.cockpit.test/api");
    },
  );

  it('clears a setting given "null"', async () => {
    const c = await cli();
    await c.run("ldap.username", "cn=x,dc=test");

    expect((await c.run("ldap.username", "null")).success).toBe(true);

    expect((await c.state.getDirectory<LdapConfiguration>(DirectoryType.Ldap)).username).toBe(null);
  });

  // conn-28
  it("refuses an empty --secretfile and keeps the old secret", async () => {
    const c = await cli();
    const old = path.join(dir, "old.txt");
    const empty = path.join(dir, "empty.txt");
    fs.writeFileSync(old, "fake-old-password\n");
    fs.writeFileSync(empty, "");
    expect((await c.run("ldap.password", undefined, { secretfile: old })).success).toBe(true);

    const result = await c.run("ldap.password", undefined, { secretfile: empty });

    expect(result.success).toBe(false);
    expect(result.message).toContain("is empty");
    expect((await c.state.getDirectory<LdapConfiguration>(DirectoryType.Ldap)).password).toBe(
      "fake-old-password",
    );
  });

  it("refuses a --secretfile holding only an empty line", async () => {
    const c = await cli();
    const file = path.join(dir, "newline.txt");
    fs.writeFileSync(file, "\n");

    expect((await c.run("ldap.password", undefined, { secretfile: file })).success).toBe(false);
  });

  // conn-32 and conn-39
  it.each([
    ["ldap.port", "0", "from 1 to 65535"],
    ["ldap.port", "70000", "from 1 to 65535"],
    ["sync.interval", "-1", "0 or more"],
    ["sync.interval", "4", "at least 5 minutes"],
    ["sync.interval", "1.5", "whole number"],
  ])("refuses %s %s with an accurate message", async (setting, value, text) => {
    const result = await (await cli()).run(setting, value);

    expect(result.success).toBe(false);
    expect(result.message).toContain(text);
  });

  it("says that sync.interval 0 switches the automatic sync off", async () => {
    const result = await (await cli()).run("sync.interval", "0");

    expect(result.success).toBe(true);
    expect((result.data as unknown as { message: string }).message).toContain(
      "automatic sync is off",
    );
  });

  // conn-38
  it.each([["abc"], [{ a: 1 }], [3]])(
    "refuses an imported sync.interval of %p, as `config sync.interval` does",
    async (interval) => {
      const c = await cli();
      await c.run("sync.interval", "10");
      const file = path.join(dir, "import.json");
      fs.writeFileSync(file, JSON.stringify({ sync: { interval } }));

      const result = await c.run("import", file);

      expect(result.success).toBe(false);
      expect((await c.state.getSync()).interval).toBe(10);
    },
  );

  it("imports what `config export` wrote", async () => {
    const a = await cli();
    await a.run("directory", "ldap");
    await a.run("ldap.hostname", "dc1.school.test");
    await a.run("ldap.port", "636");
    await a.run("ldap.ssl", "true");
    await a.run("sync.interval", "15");
    const file = path.join(dir, "export.json");
    await a.run("export", file);
    await a.run("ldap.hostname", "other");
    await a.run("sync.interval", "30");

    const result = await a.run("import", file);

    expect(result.success).toBe(true);
    const ldap = await a.state.getDirectory<LdapConfiguration>(DirectoryType.Ldap);
    expect(ldap).toMatchObject({ hostname: "dc1.school.test", port: 636, ssl: true });
    expect((await a.state.getSync()).interval).toBe(15);
  });

  // conn-27, #102
  describe("settings an LDAP sync does not use", () => {
    const message = (result: { data: unknown }) =>
      (result.data as { message: string }).message ?? "";
    const shown = async (c: Awaited<ReturnType<typeof cli>>) =>
      ((await c.run("show")).data as unknown as { data: string }).data;

    it("refuses a user filter with LDAP, and says why", async () => {
      const c = await cli();
      await c.run("directory", "ldap");

      const result = await c.run("sync.userfilter", "(uid=alice)");

      expect(result.success).toBe(false);
      expect(result.message).toContain("not used with LDAP");
      expect(result.message).toContain("Cockpit's mappings");
      expect((await c.state.getSync())?.userFilter ?? null).toBeNull();
    });

    it("still clears one", async () => {
      const c = await cli();
      await c.run("directory", "ldap");

      expect((await c.run("sync.userfilter", "null")).success).toBe(true);
    });

    it("keeps the filters of the other directories", async () => {
      const c = await cli();
      await c.run("directory", "entra");

      expect((await c.run("sync.userfilter", "exclude:joe@school.test")).success).toBe(true);
      expect((await c.state.getSync()).userFilter).toBe("exclude:joe@school.test");
    });

    it.each([["sync.userpath"], ["sync.memberattribute"], ["sync.overwriteexisting"]])(
      "says %s is no longer a setting",
      async (setting) => {
        const result = await (await cli()).run(setting, "x");

        expect(result.success).toBe(false);
        expect(result.message).toContain("no longer a setting");
      },
    );

    it("shows only what an LDAP sync uses, and names a filter left from an earlier version", async () => {
      const c = await cli();
      await c.run("directory", "ldap");
      await c.state.setSync({ ...(await c.state.getSync()), userFilter: "(uid=alice)" });

      const text = await shown(c);

      expect(text).toContain("sync.interval:");
      expect(text).not.toMatch(/^sync\.(users|userfilter|groupfilter|removedisabled):/m);
      expect(text).toContain("removed on the next save: sync.userFilter");
    });

    it("removes such a filter on the next save, and says so", async () => {
      const c = await cli();
      await c.run("directory", "ldap");
      await c.state.setSync({
        ...(await c.state.getSync()),
        groupFilter: "(cn=staff)",
        removeDisabled: true,
      });

      const result = await c.run("ldap.port", "636");

      expect(result.success).toBe(true);
      expect(message(result)).toContain("sync.groupFilter, sync.removeDisabled");
      expect(await c.state.getSync()).toMatchObject({ groupFilter: null, removeDisabled: false });
      expect(await shown(c)).not.toContain("removed on the next save");
    });

    it("leaves such a filter out of an import into LDAP, and says so", async () => {
      const c = await cli();
      const file = path.join(dir, "old-export.json");
      fs.writeFileSync(
        file,
        JSON.stringify({
          directory: "ldap",
          ldap: { hostname: "dc1.school.test" },
          sync: { interval: 15, userFilter: "(uid=alice)", userPath: "ou=people" },
        }),
      );

      const result = await c.run("import", file);

      expect(result.success).toBe(true);
      expect(message(result)).toContain("sync.userFilter");
      const sync = await c.state.getSync();
      expect(sync.interval).toBe(15);
      expect(sync.userFilter ?? null).toBeNull();
      expect(sync.userPath ?? null).toBeNull();
    });

    it("exports no setting that was removed", async () => {
      const c = await cli();
      await c.run("directory", "ldap");
      await c.run("ldap.ad", "true");

      const exported = JSON.parse(
        ((await c.run("export")).data as unknown as { data: string }).data,
      );

      expect(exported.sync).toHaveProperty("interval");
      expect(exported.sync).not.toHaveProperty("userPath");
      expect(exported.sync).not.toHaveProperty("userObjectClass");
      expect(exported.ldap).toMatchObject({ ad: true });
      expect(exported.ldap).not.toHaveProperty("id");
    });
  });
});
