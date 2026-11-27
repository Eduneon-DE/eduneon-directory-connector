import { APPLICATION_NAME } from "@/libs/constants";
import { secureStorageServiceName } from "@/libs/utils/secureStorageName";

import { cliDataFolder } from "./dataFolder";

const noPortable = () => false;

/** The keychain name the CLI would use with this environment. */
function keychainName(...args: Parameters<typeof cliDataFolder>) {
  const { dataFolder, defaultDataFolder } = cliDataFolder(...args);
  return secureStorageServiceName(dataFolder, defaultDataFolder, args[1]);
}

describe("cliDataFolder", () => {
  it("uses the platform's default folder, the desktop app's, with the keychain name of today", () => {
    const env = { HOME: "/Users/admin" };

    expect(cliDataFolder(env, "darwin", "/opt/dc", noPortable).dataFolder).toBe(
      "/Users/admin/Library/Application Support/Eduneon Directory Connector",
    );
    expect(keychainName(env, "darwin", "/opt/dc", noPortable)).toBe(APPLICATION_NAME);
    expect(
      keychainName(
        { APPDATA: "C:\\Users\\admin\\AppData\\Roaming" },
        "win32",
        "C:\\dc",
        noPortable,
      ),
    ).toBe(APPLICATION_NAME);
    expect(keychainName({ HOME: "/home/admin" }, "linux", "/opt/dc", noPortable)).toBe(
      APPLICATION_NAME,
    );
  });

  it("gives EDUNEON_DC_APPDATA_DIR keychain entries of its own", () => {
    const env = { HOME: "/home/admin", EDUNEON_DC_APPDATA_DIR: "/var/lib/eduneon-dc" };

    expect(cliDataFolder(env, "linux", "/opt/dc", noPortable).dataFolder).toBe(
      "/var/lib/eduneon-dc",
    );
    expect(keychainName(env, "linux", "/opt/dc", noPortable)).toMatch(
      /^Eduneon Directory Connector \([0-9a-f]{12}\)$/,
    );
  });

  it("keeps the name of today when EDUNEON_DC_APPDATA_DIR names the default folder", () => {
    const env = {
      HOME: "/home/admin",
      EDUNEON_DC_APPDATA_DIR: "/home/admin/.config/Eduneon Directory Connector/",
    };

    expect(keychainName(env, "linux", "/opt/dc", noPortable)).toBe(APPLICATION_NAME);
  });

  it("gives the portable folder next to the CLI keychain entries of its own", () => {
    const env = { HOME: "/home/admin" };
    const portable = (folder: string) => folder === "/opt/dc/eduneon-connector-appdata";

    expect(cliDataFolder(env, "linux", "/opt/dc", portable).dataFolder).toBe(
      "/opt/dc/eduneon-connector-appdata",
    );
    expect(keychainName(env, "linux", "/opt/dc", portable)).not.toBe(APPLICATION_NAME);
  });
});
