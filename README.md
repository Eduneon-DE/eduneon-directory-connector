# Eduneon Directory Connector

Syncs users and groups from your school's or organization's directory to [Eduneon](https://eduneon.de). It runs on your own machine or server, inside your network, so Eduneon never needs direct access to your directory: the connector reads the directory locally and sends the result to Eduneon over HTTPS.

Supported directories:

- Active Directory and any other LDAP directory
- Microsoft Entra ID
- Google Workspace
- Okta
- OneLogin

It comes as a desktop app (Windows, macOS, Linux) and as a command-line tool, `eduneon-dc`, for scheduled syncs on servers.

## How it works

1. In Cockpit (Platform → Authentication → Add provider → **Directory Connector**), an admin creates the directory. The wizard shows the server address and directory ID for the connector.
2. In Cockpit, create an API token for a service account that may manage identity providers (Platform → Service accounts).
3. In the connector, log in with that token, point it at your directory, and sync. The upload appears in the Cockpit wizard, which then scans it, proposes a mapping (accounts, schools, groups, devices), previews it and imports it.
4. After that first import in Cockpit, every sync of the connector is applied automatically.

Each sync reads the **whole** directory and sends it to Cockpit as raw entries over HTTPS. Cockpit applies the mapping: it creates and updates records, and deactivates those that disappeared if the directory is set to do so. Password attributes (`userPassword`, `unicodePwd`, LAPS, …) are never sent. An empty read is never sent, so a broken filter cannot deactivate everyone.

## Install

Download the latest release from the [Releases page](https://github.com/Eduneon-DE/eduneon-directory-connector/releases):

| Platform              | Desktop app                                                                 | CLI                                    |
| --------------------- | --------------------------------------------------------------------------- | -------------------------------------- |
| Windows               | `Eduneon-Directory-Connector-Setup-<version>.exe` (or the `Portable` build) | `eduneon-dc-windows-<version>.zip`     |
| macOS (Apple Silicon) | `Eduneon-Directory-Connector-<version>-arm64.dmg`                           | `eduneon-dc-macos-arm64-<version>.zip` |
| macOS (Intel)         | `Eduneon-Directory-Connector-<version>-x64.dmg`                             | not available                          |
| Linux                 | `Eduneon-Directory-Connector-<version>-x86_64.AppImage`                     | `eduneon-dc-linux-<version>.zip`       |

The desktop app updates itself from this repository's releases.

### From the command line

macOS (Apple Silicon) and Linux (x64): the CLI to `~/.local/bin`; `--app` adds the desktop app (`/Applications`, or an AppImage on Linux).

```bash
curl -fsSL https://raw.githubusercontent.com/Eduneon-DE/eduneon-directory-connector/main/scripts/install.sh | sh
curl -fsSL https://raw.githubusercontent.com/Eduneon-DE/eduneon-directory-connector/main/scripts/install.sh | sh -s -- --app
```

Windows (PowerShell): the CLI to `%LOCALAPPDATA%\Programs\eduneon-dc` and onto your PATH; `-App` installs the desktop app silently.

```powershell
irm https://raw.githubusercontent.com/Eduneon-DE/eduneon-directory-connector/main/scripts/install.ps1 | iex
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Eduneon-DE/eduneon-directory-connector/main/scripts/install.ps1))) -App
```

Both take a release (`--version 2026.11.0` / `-Version 2026.11.0`) or a file you already downloaded (`--from <file>` / `-From <file>`), for servers without internet access. The Windows installer also runs silently on its own: `Eduneon-Directory-Connector-Setup-<version>.exe /S`.

## CLI

The CLI documents itself:

```bash
eduneon-dc --help
eduneon-dc config --help
```

Log in once with the Cockpit API token (it is asked for, or read from `EDUNEON_DC_API_TOKEN`):

```bash
EDUNEON_DC_API_TOKEN=... eduneon-dc login
eduneon-dc test    # read the directory, send nothing
eduneon-dc sync    # read the directory and send it to Cockpit
```

To sync on a schedule, run `eduneon-dc sync` from cron, a systemd timer or Windows Task Scheduler.

Environment variables:

| Variable                       | Purpose                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `EDUNEON_DC_API_TOKEN`         | Cockpit API token for `eduneon-dc login`                                                                     |
| `EDUNEON_DC_DIRECTORY_ID`      | Cockpit directory ID, only when the organization has several Directory Connector directories                 |
| `EDUNEON_DC_SERVER_URL`        | Pins the Cockpit server (e.g. `http://localhost:5000` for a local Cockpit)                                   |
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

To try a full sync locally, start the test directory (`docker compose up -d`, an OpenLDAP with 20 users at `localhost:1389`, base `dc=example,dc=com`, user `cn=admin,dc=example,dc=com` / `admin`) and a Cockpit with the Directory Connector endpoint.

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
