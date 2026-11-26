// Build and start the desktop app for local testing, in one command:
//
//   npm run local              build what is missing, then start the app
//   npm run local -- --fresh   also wipe the local test settings first
//
// The app runs fully local:
// - settings live in ./.local/appdata (your real install is not touched),
// - the server is pinned to your local Cockpit (EDUNEON_DC_SERVER_URL, default http://localhost:5000),
// - the auto-updater is off, so it does not contact GitHub.
//
// Secrets you enter still go to the OS keychain under "Eduneon Directory Connector".

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const fresh = process.argv.includes("--fresh");
const appDataDir = join(root, ".local", "appdata");
const serverUrl = process.env.EDUNEON_DC_SERVER_URL || "http://localhost:5000";

function step(title) {
  console.log(`\n\x1b[1m▸ ${title}\x1b[0m`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: isWindows,
    ...options,
  });
  if (result.error) {
    console.error(`\nCould not run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n${command} ${args.join(" ")} failed with exit code ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}

function has(command) {
  const probe = spawnSync(command, ["--version"], { stdio: "ignore", shell: isWindows });
  return !probe.error && probe.status === 0;
}

// 1. Rust is needed once, to compile the native keychain module.
const nativeBuilt = readdirSync(join(root, "native")).some((f) => f.endsWith(".node"));
if (!nativeBuilt && !has("cargo")) {
  console.error(
    [
      "The native keychain module is not built yet, and that needs Rust.",
      "Install it once from https://rustup.rs, open a new terminal, then run `npm run local` again.",
      isWindows ? "" : "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
    ].join("\n"),
  );
  process.exit(1);
}

// 2. Dependencies.
if (!existsSync(join(root, "node_modules", ".bin"))) {
  step("Installing dependencies (npm ci)");
  run("npm", ["ci"], { env: { ...process.env, HUSKY: "0" } });
}

// Electron downloads its runtime in a postinstall step; when that was skipped (install with
// --ignore-scripts, an interrupted download) the app cannot start, so fetch it now.
if (!existsSync(join(root, "node_modules", "electron", "path.txt"))) {
  step("Downloading the Electron runtime");
  run("node", [join("node_modules", "electron", "install.js")]);
}

// 3. Native module.
if (!nativeBuilt) {
  step("Building the native keychain module (first run only)");
  run("npm", ["run", "build:native:release"]);
}

// 4. App bundles. Always rebuilt so the window shows your latest changes.
step("Building the app");
run("npm", ["run", "build"]);

// 5. Start.
if (fresh) {
  step("Wiping local test settings");
  rmSync(appDataDir, { recursive: true, force: true });
}

step("Starting Eduneon Directory Connector");
console.log(`  Server:   ${serverUrl}`);
console.log(`  Settings: ${appDataDir}`);
console.log("  Updates:  off\n");

run(join(root, "node_modules", ".bin", isWindows ? "electron.cmd" : "electron"), ["./build"], {
  env: {
    ...process.env,
    ELECTRON_NO_UPDATER: "1",
    EDUNEON_DC_APPDATA_DIR: appDataDir,
    EDUNEON_DC_SERVER_URL: serverUrl,
  },
});
