# Install the Eduneon Directory Connector from the command line (Windows, PowerShell 5.1 or later).
#
#   irm https://raw.githubusercontent.com/Eduneon-DE/eduneon-directory-connector/main/scripts/install.ps1 | iex
#   & ([scriptblock]::Create((irm …/install.ps1))) -App           # the desktop app as well
#   .\install.ps1 -Version 2026.11.0                                # a given release instead of the latest
#   .\install.ps1 -From .\eduneon-dc-windows-2026.11.0.zip           # a file already downloaded (offline)
#   .\install.ps1 -From .\Eduneon-Directory-Connector-Setup-2026.11.0.exe
#
# The CLI goes to %LOCALAPPDATA%\Programs\eduneon-dc and onto the user's PATH. The desktop app is installed
# silently for all users (the installer asks for administrator rights).
[CmdletBinding()]
param(
  [switch]$App,
  [string]$Version = "",
  [string]$From = "",
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\eduneon-dc")
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # Invoke-WebRequest is many times slower with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = "Eduneon-DE/eduneon-directory-connector"
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("eduneon-dc-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null

function Get-LatestVersion {
  # GitHub redirects /releases/latest to the newest tag (vX.Y.Z); no API token needed.
  $request = [Net.WebRequest]::Create("https://github.com/$Repo/releases/latest")
  $request.AllowAutoRedirect = $false
  $response = $request.GetResponse()
  $location = $response.Headers["Location"]
  $response.Close()
  if (-not $location) { throw "No release found." }
  return ($location -split "/")[-1].TrimStart("v")
}

function Get-Asset([string]$Name) {
  $target = Join-Path $Tmp $Name
  Write-Host "Downloading $Name"
  Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$Repo/releases/download/v$script:Version/$Name" -OutFile $target
  return $target
}

function Install-Cli([string]$Zip) {
  if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
  New-Item -ItemType Directory -Path $InstallDir | Out-Null
  Expand-Archive -Path $Zip -DestinationPath $InstallDir -Force
  $exe = Get-ChildItem -Path $InstallDir -Recurse -Filter "eduneon-dc.exe" | Select-Object -First 1
  if (-not $exe) { throw "No eduneon-dc.exe in $Zip" }
  $dir = $exe.DirectoryName
  # Files from the internet carry a Mark of the Web; SmartScreen would stop the unsigned binary otherwise.
  Get-ChildItem -Path $InstallDir -Recurse | Unblock-File
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (($userPath -split ";") -contains $dir)) {
    [Environment]::SetEnvironmentVariable("Path", ($userPath.TrimEnd(";") + ";" + $dir).TrimStart(";"), "User")
    Write-Host "Added $dir to your PATH (open a new terminal to use it)."
  }
  $env:Path = "$env:Path;$dir"
  Write-Host "Installed the CLI: $($exe.FullName)"
  & $exe.FullName --version | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Warning "eduneon-dc did not start; run it to see why." }
}

function Install-App([string]$Setup) {
  Unblock-File -Path $Setup
  Write-Host "Installing the desktop app (silent)…"
  # NSIS: /S is silent; the installer elevates itself for an all-users install.
  $process = Start-Process -FilePath $Setup -ArgumentList "/S" -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "The installer exited with code $($process.ExitCode)." }
  Write-Host "Installed the desktop app (Start menu: Eduneon Directory Connector)."
}

try {
  if ($From) {
    if (-not (Test-Path $From)) { throw "No such file: $From" }
    $file = (Resolve-Path $From).Path
    switch -Wildcard ($file) {
      "*.zip" { Install-Cli $file }
      "*.exe" { Install-App $file }
      default { throw "Unknown file type: $file" }
    }
    return
  }

  if (-not [Environment]::Is64BitOperatingSystem) { throw "The Directory Connector needs 64-bit Windows." }
  if (-not $Version) { $script:Version = Get-LatestVersion } else { $script:Version = $Version }

  Install-Cli (Get-Asset "eduneon-dc-windows-$script:Version.zip")
  if ($App) { Install-App (Get-Asset "Eduneon-Directory-Connector-Setup-$script:Version.exe") }

  Write-Host ""
  Write-Host "Next: eduneon-dc login   (with a Cockpit API token, see Platform -> Service accounts)"
}
finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
