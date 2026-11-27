import * as fs from "fs";
import * as path from "path";

import { APPLICATION_NAME } from "@/libs/constants";

/** The folder next to the CLI that makes it portable: its settings are kept there when it exists. */
export const PORTABLE_DATA_FOLDER = "eduneon-connector-appdata";

/**
 * Where the CLI keeps its settings (data.json): EDUNEON_DC_APPDATA_DIR, else a portable folder next
 * to the program, else the platform's default folder, which the desktop app uses too. The default
 * folder is returned as well: only a folder other than it gets keychain entries of its own (see
 * secureStorageServiceName).
 */
export function cliDataFolder(
  env: Record<string, string | undefined> = process.env,
  platform: typeof process.platform = process.platform,
  programFolder: string = __dirname,
  exists: (folder: string) => boolean = fs.existsSync,
): { dataFolder: string; defaultDataFolder: string } {
  const paths = platform === "win32" ? path.win32 : path.posix;
  let defaultDataFolder: string;
  if (platform === "darwin") {
    defaultDataFolder = paths.join(env.HOME, "Library/Application Support/" + APPLICATION_NAME);
  } else if (platform === "win32") {
    defaultDataFolder = paths.join(env.APPDATA, APPLICATION_NAME);
  } else if (env.XDG_CONFIG_HOME) {
    defaultDataFolder = paths.join(env.XDG_CONFIG_HOME, APPLICATION_NAME);
  } else {
    defaultDataFolder = paths.join(env.HOME, ".config/" + APPLICATION_NAME);
  }

  if (env.EDUNEON_DC_APPDATA_DIR) {
    return { dataFolder: paths.resolve(env.EDUNEON_DC_APPDATA_DIR), defaultDataFolder };
  }
  const portable = paths.join(programFolder, PORTABLE_DATA_FOLDER);
  if (exists(portable)) {
    return { dataFolder: portable, defaultDataFolder };
  }
  return { dataFolder: defaultDataFolder, defaultDataFolder };
}
