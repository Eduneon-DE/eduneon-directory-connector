# Eduneon Directory Connector

Syncs users and groups from your school's or organization's directory to [Eduneon](https://eduneon.de). It runs on your own machine or server, inside your network, so Eduneon never needs direct access to your directory: the connector reads the directory locally and sends the result to Eduneon over HTTPS.

Supported directories:

- Active Directory and any other LDAP directory
- Microsoft Entra ID
- Google Workspace
- Okta
- OneLogin

It comes as a desktop app (Windows, macOS, Linux) and as a command-line tool, `eduneon-dc`, for scheduled syncs on servers.

> **Status:** in development. Sending directory data to Eduneon is the next milestone.

## Install

Download the latest release from the [Releases page](https://github.com/Eduneon-DE/eduneon-directory-connector/releases):

| Platform              | Desktop app                                                                 | CLI                                    |
| --------------------- | --------------------------------------------------------------------------- | -------------------------------------- |
| Windows               | `Eduneon-Directory-Connector-Setup-<version>.exe` (or the `Portable` build) | `eduneon-dc-windows-<version>.zip`     |
| macOS (Apple Silicon) | `Eduneon-Directory-Connector-<version>-arm64.dmg`                           | `eduneon-dc-macos-arm64-<version>.zip` |
| macOS (Intel)         | `Eduneon-Directory-Connector-<version>-x64.dmg`                             | not available                          |
| Linux                 | `Eduneon-Directory-Connector-<version>-x86_64.AppImage`                     | `eduneon-dc-linux-<version>.zip`       |

The desktop app updates itself from this repository's releases.

## CLI

The CLI documents itself:

```bash
eduneon-dc --help
eduneon-dc config --help
```

To sync on a schedule, run `eduneon-dc sync` from cron, a systemd timer or Windows Task Scheduler.

Environment variables:

| Variable                       | Purpose                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `EDUNEON_DC_APPDATA_DIR`       | Where settings are stored (default: the OS config folder)                                                    |
| `EDUNEON_DC_PLAINTEXT_SECRETS` | `true` stores secrets in the settings file instead of the OS keychain (for headless Linux without a keyring) |
| `EDUNEON_DC_NOINTERACTION`     | `true` never prompts for input                                                                               |
| `EDUNEON_DC_DEBUG`             | `true` enables debug logging                                                                                 |

## Build from source

Requirements: Node.js (version in `.nvmrc`), npm, and a Rust toolchain for the native keychain module. On Linux also `libsecret-1-dev`, `libdbus-1-dev` and `pkg-config`. On Windows, the Visual C++ build tools.

### Run it locally (one command)

```bash
npm run local              # installs, builds and starts the desktop app
npm run local -- --fresh   # same, but starts with empty test settings
```

This never talks to the Eduneon cloud: the server is pinned to your local Cockpit at `http://localhost:5000` (override with `EDUNEON_DC_SERVER_URL=http://localhost:5001 npm run local`), settings are kept in `./.local/appdata`, and the auto-updater is off.

### Other commands

Desktop app:

```bash
npm ci
npm run rebuild      # builds the native module
npm run electron     # runs the app with live reload
npm run dist:mac     # or dist:win / dist:lin to build an installer into ./dist
```

CLI:

```bash
npm ci
npm run build:native:release
npm run build:cli:watch
node ./build-cli/eduneon-dc.js --help
```

## Releasing

Set `version` in `package.json`, then push a matching tag (`v2026.11.1`). The [Release workflow](.github/workflows/release.yml) builds every platform and publishes a GitHub release. Code signing turns on when the signing secrets listed in that workflow are configured.

## License

GNU General Public License v3.0, see [LICENSE.txt](LICENSE.txt).
