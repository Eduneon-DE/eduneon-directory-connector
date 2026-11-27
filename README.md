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

## Set it up from the command line

The CLI, `eduneon-dc`, does everything the desktop app does, without a desktop: it is what runs on a
server. Every step below works the same on Windows (PowerShell), macOS and Linux.

### 1. What you need

- **In Cockpit:** a directory of the kind _LDAP / Active Directory → Import through the Directory Connector_
  (Platform → Authentication), and an **API token** of an account that may manage identity providers
  (Platform → Service accounts → create a token). The directory's setup page shows its **directory ID**
  and the **server address** to use.
- **On the machine:** network access to the directory (e.g. port 389 or 636 of a domain controller) and
  HTTPS to Cockpit. Nothing has to reach the machine from outside.

### 2. Point it at Cockpit and the directory

```bash
eduneon-dc config server https://app.eduneon.com
eduneon-dc config directory ldap
eduneon-dc config ldap.hostname dc01.school.local
eduneon-dc config ldap.port 636
eduneon-dc config ldap.ssl true
eduneon-dc config ldap.ad true                         # false for OpenLDAP, UCS, 389 DS
eduneon-dc config ldap.rootPath "dc=school,dc=local"
eduneon-dc config ldap.username "cn=eduneon-sync,cn=users,dc=school,dc=local"
eduneon-dc config ldap.password --secretenv LDAP_PASSWORD
```

Secrets never have to be typed on the command line, where they would stay in the shell history: put them
in an environment variable (`--secretenv NAME`) or a file (`--secretfile path`). In PowerShell:
`$env:LDAP_PASSWORD = [Net.NetworkCredential]::new("", (Read-Host -AsSecureString "LDAP password")).Password` (works in Windows PowerShell 5.1 and PowerShell 7).

Other directories:

```bash
# Microsoft Entra ID
eduneon-dc config directory entra
eduneon-dc config entra.tenant contoso.onmicrosoft.com
eduneon-dc config entra.applicationId 00000000-0000-0000-0000-000000000000
eduneon-dc config entra.key --secretenv ENTRA_SECRET
eduneon-dc config sync.users true
eduneon-dc config sync.groups true

# Google Workspace
eduneon-dc config directory gsuite
eduneon-dc config gsuite.domain school.org
eduneon-dc config gsuite.adminUser admin@school.org
eduneon-dc config gsuite.keyfile ./service-account.json   # e-mail and private key in one step
eduneon-dc config sync.users true
eduneon-dc config sync.groups true
```

`eduneon-dc config --help` lists every setting; `eduneon-dc config show` shows the current ones (secrets
only as _(set)_).

### 3. Check what it reads

```bash
eduneon-dc test
```

It reads the directory exactly as a sync does and prints how many entries of which kind it found. It sends
nothing and needs no login, so it is the place to get the connection and the base DN right.

### 4. Log in and sync

```bash
EDUNEON_DC_API_TOKEN=<token> EDUNEON_DC_DIRECTORY_ID=<id> eduneon-dc login
eduneon-dc sync
```

PowerShell: `$env:EDUNEON_DC_API_TOKEN = "<token>"; $env:EDUNEON_DC_DIRECTORY_ID = "<id>"; eduneon-dc login`.
The directory ID is only needed when the organization has more than one Directory Connector directory.
When the API token's account belongs to several organizations, also set `EDUNEON_DC_ORGANIZATION_ID` to the one to sync into.

The first sync only delivers the directory to Cockpit: the admin chooses there what to import and runs the
first import. From then on every sync is applied at once, and `sync` prints what Cockpit created,
updated and deactivated. It exits with a non-zero code when something failed.

### 5. Sync on a schedule

Every sync sends the whole directory, so the interval only decides how soon a change arrives; 15 to 60
minutes is usual. Log in and configure **as the account that runs the schedule**: settings and the token
belong to that account.

**Windows server (Task Scheduler)**, in PowerShell as the sync account (here `SCHOOL\svc-eduneon`):

```powershell
$cli = "$env:LOCALAPPDATA\Programs\eduneon-dc\eduneon-dc.exe"
$action = New-ScheduledTaskAction -Execute $cli -Argument "sync"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName "Eduneon Directory Connector" -Action $action -Trigger $trigger `
  -User "SCHOOL\svc-eduneon" -Password (Read-Host "Password of SCHOOL\svc-eduneon") -RunLevel Limited
```

The task's _Last Run Result_ is `0x0` when the sync worked.

**Linux server (systemd timer)**, as root:

```bash
curl -fsSL https://raw.githubusercontent.com/Eduneon-DE/eduneon-directory-connector/main/scripts/install.sh \
  | sh -s -- --bin-dir /usr/local/bin
useradd --system --home-dir /var/lib/eduneon-dc --create-home eduneon-dc
cat > /etc/eduneon-dc.env <<'ENV'
EDUNEON_DC_APPDATA_DIR=/var/lib/eduneon-dc
EDUNEON_DC_PLAINTEXT_SECRETS=true
EDUNEON_DC_NOINTERACTION=true
ENV
chmod 600 /etc/eduneon-dc.env
# configure and log in as the service user (steps 2 to 4):
sudo -u eduneon-dc env $(cat /etc/eduneon-dc.env) eduneon-dc config server https://app.eduneon.com
# … the other config lines …
sudo -u eduneon-dc env $(cat /etc/eduneon-dc.env) EDUNEON_DC_API_TOKEN=<token> eduneon-dc login

cat > /etc/systemd/system/eduneon-dc.service <<'UNIT'
[Unit]
Description=Eduneon Directory Connector sync
After=network-online.target
[Service]
Type=oneshot
User=eduneon-dc
EnvironmentFile=/etc/eduneon-dc.env
ExecStart=/usr/local/bin/eduneon-dc sync
UNIT
cat > /etc/systemd/system/eduneon-dc.timer <<'UNIT'
[Unit]
Description=Sync the directory to Eduneon every 15 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload && systemctl enable --now eduneon-dc.timer
journalctl -u eduneon-dc.service    # what the last syncs did
```

A Linux server usually has no keyring, hence `EDUNEON_DC_PLAINTEXT_SECRETS=true`: the secrets are then
kept in the settings file, readable only by the service user.

### 6. Move a setup to another server

```bash
eduneon-dc config export settings.json   # everything except secrets
eduneon-dc config import settings.json   # on the new server; then set the password and log in
```

### Where things are kept

| What                   | Windows                                 | macOS                                                       | Linux                                   |
| ---------------------- | --------------------------------------- | ----------------------------------------------------------- | --------------------------------------- |
| Settings (`data.json`) | `%APPDATA%\Eduneon Directory Connector` | `~/Library/Application Support/Eduneon Directory Connector` | `~/.config/Eduneon Directory Connector` |
| Token and passwords    | Windows Credential Manager              | Keychain                                                    | Secret Service, or the settings file    |

`EDUNEON_DC_APPDATA_DIR` moves the settings; `eduneon-dc data-file` prints where they are.

### Environment variables

| Variable                       | Purpose                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `EDUNEON_DC_API_TOKEN`         | Cockpit API token for `eduneon-dc login`                                                     |
| `EDUNEON_DC_DIRECTORY_ID`      | Cockpit directory ID, only when the organization has several Directory Connector directories |
| `EDUNEON_DC_ORGANIZATION_ID`   | Cockpit organization ID, only when the API token's account belongs to several organizations  |
| `EDUNEON_DC_SERVER_URL`        | Pins the Cockpit server, overriding `config server`                                          |
| `EDUNEON_DC_APPDATA_DIR`       | Where settings are stored                                                                    |
| `EDUNEON_DC_PLAINTEXT_SECRETS` | `true` keeps secrets in the settings file instead of the OS keychain                         |
| `EDUNEON_DC_NOINTERACTION`     | `true` never prompts for input                                                               |
| `EDUNEON_DC_DEBUG`             | `true` enables debug logging                                                                 |

### When something is wrong

- `test` reads 0 entries: check `ldap.rootPath` and that the bind user may read below it.
- `Invalid credentials`: `ldap.username` must be the full DN (or `user@domain` on Active Directory).
- A certificate error with LDAPS: give the CA with `ldap.sslCaPath` (or `ldap.tlsCaPath` for StartTLS).
- `401` at login: the token is wrong or revoked, or its account may not manage identity providers.
- `EDUNEON_DC_DEBUG=true eduneon-dc sync` prints every step.

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
