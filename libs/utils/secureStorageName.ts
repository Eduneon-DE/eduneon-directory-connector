import { createHash } from "crypto";
import * as path from "path";

import { APPLICATION_NAME } from "@/libs/constants";

type Platform = typeof process.platform;

/**
 * The name this connector's OS keychain entries (Keychain, Credential Manager, Secret Service) are
 * kept under, for a data folder.
 *
 * The settings (data.json) live in a data folder; the token and the directory secrets they belong
 * to live in the keychain. With one fixed name, two data folders (the desktop app's and a CLI's
 * EDUNEON_DC_APPDATA_DIR) shared one API token and one set of secrets while their settings
 * differed. So a data folder other than the default one gets entries of its own: the name carries a
 * suffix derived from the folder's path, the same on every start.
 *
 * The default data folder keeps the plain name it always had, so an existing install keeps its
 * token. Nothing is copied between the names: another folder starts without a token.
 */
export function secureStorageServiceName(
  dataFolder: string,
  defaultDataFolder: string,
  platform: Platform = process.platform,
): string {
  if (dataFolder == null || dataFolder.trim() === "") {
    return APPLICATION_NAME;
  }
  const folder = folderKey(dataFolder, platform);
  if (defaultDataFolder != null && folder === folderKey(defaultDataFolder, platform)) {
    return APPLICATION_NAME;
  }
  const suffix = createHash("sha256").update(folder, "utf8").digest("hex").slice(0, 12);
  return `${APPLICATION_NAME} (${suffix})`;
}

/**
 * One spelling per folder: absolute, without a trailing separator, and in lower case where the
 * file system ignores case by default (Windows, macOS), so "C:\Data\" and "c:\data" are one folder.
 */
function folderKey(folder: string, platform: Platform): string {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const resolved = paths.resolve(folder.trim());
  return platform === "win32" || platform === "darwin" ? resolved.toLowerCase() : resolved;
}
