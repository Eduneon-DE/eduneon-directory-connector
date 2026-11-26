/**
 * @jest-environment node
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { mock } from "jest-mock-extended";

import { LogService } from "@/libs/abstractions/log.service";

import { LowdbStorageService } from "./lowdbStorage.service";

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

const modeOf = (file: string) => fs.statSync(file).mode & 0o777;

describe("LowdbStorageService (CLI, locked data file)", () => {
  let dir: string;
  let logService: ReturnType<typeof mock<LogService>>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-lowdb-"));
    fs.chmodSync(dir, 0o755);
    logService = mock<LogService>();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("removes many keys at once without running out of lock retries", async () => {
    const storage = new LowdbStorageService(logService, null, dir, false, true);
    const keys = ["a", "b", "c", "d", "e", "f", "g", "h"] as any[];
    for (const key of keys) {
      await storage.save(key, "value");
    }

    const results = await Promise.allSettled(keys.map((key) => storage.remove(key)));

    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    const data = JSON.parse(fs.readFileSync(path.join(dir, "data.json"), "utf8"));
    expect(Object.keys(data)).toEqual([]);
    expect(fs.existsSync(path.join(dir, "data.json.lock"))).toBe(false);
  });

  it("keeps data.json readable only by its owner after every write", async () => {
    const storage = new LowdbStorageService(logService, null, dir, false, true);
    await storage.save("ldapPassword" as any, "secret");
    await storage.save("other" as any, 1);

    expect(modeOf(path.join(dir, "data.json"))).toBe(0o600);
  });

  it("makes an existing world-readable data.json private again", async () => {
    fs.writeFileSync(path.join(dir, "data.json"), "{}", { mode: 0o644 });
    fs.chmodSync(path.join(dir, "data.json"), 0o644);

    const storage = new LowdbStorageService(logService, null, dir, false, true);
    await storage.get("x" as any);

    expect(modeOf(path.join(dir, "data.json"))).toBe(0o600);
  });

  it("backs up a corrupt data file privately and warns only when the copy fails", async () => {
    fs.writeFileSync(path.join(dir, "data.json"), "{bad", { mode: 0o644 });
    fs.chmodSync(path.join(dir, "data.json"), 0o644);

    const storage = new LowdbStorageService(logService, null, dir, false, true);
    await storage.get("x" as any);

    const backup = path.join(dir, "data.json.bak");
    expect(fs.readFileSync(backup, "utf8")).toBe("{bad");
    expect(modeOf(backup)).toBe(0o600);
    expect(logService.warning).not.toHaveBeenCalledWith(
      expect.stringContaining("No backup may have been created"),
    );
  });

  it("logs a missing directory and data file at debug level, not as warnings", async () => {
    const fresh = path.join(dir, "new");
    const storage = new LowdbStorageService(logService, null, fresh, false, true);
    await storage.get("x" as any);

    expect(logService.warning).not.toHaveBeenCalled();
    expect(logService.debug).toHaveBeenCalledWith(expect.stringContaining("Could not find dir"));
    expect(logService.debug).toHaveBeenCalledWith(
      expect.stringContaining("Could not find data file"),
    );
  });
});
