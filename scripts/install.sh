#!/bin/sh
# Install the Eduneon Directory Connector from the command line (macOS and Linux).
#
#   curl -fsSL https://raw.githubusercontent.com/Eduneon-DE/eduneon-directory-connector/main/scripts/install.sh | sh
#   curl -fsSL …/install.sh | sh -s -- --app              # the desktop app as well
#   sh install.sh --version 2026.11.0                        # a given release instead of the latest
#   sh install.sh --from ./eduneon-dc-linux-2026.11.0.zip    # a file already downloaded (offline)
#   sh install.sh --app --from ./Eduneon-Directory-Connector-2026.11.0-arm64.dmg
#
# The CLI goes to ~/.local/bin (or --bin-dir). The desktop app goes to /Applications (or --apps-dir) on macOS and to
# ~/.local/bin/eduneon-directory-connector (an AppImage) on Linux.
set -eu

REPO="Eduneon-DE/eduneon-directory-connector"
VERSION=""
FROM=""
APP=0
BIN_DIR="${HOME}/.local/bin"
APPS_DIR="/Applications"

usage() {
  sed -n '2,14p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP=1 ;;
    --version) VERSION="${2:?--version needs a value}"; shift ;;
    --from) FROM="${2:?--from needs a file}"; shift ;;
    --bin-dir) BIN_DIR="${2:?--bin-dir needs a directory}"; shift ;;
    --apps-dir) APPS_DIR="${2:?--apps-dir needs a directory}"; shift ;;
    -h | --help) usage 0 ;;
    *) echo "Unknown option: $1" >&2; usage 1 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
fail() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required"; }

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Darwin) PLATFORM="macos" ;;
  Linux) PLATFORM="linux" ;;
  *) fail "unsupported system $OS (on Windows use install.ps1)" ;;
esac

# The release asset this machine needs. The CLI exists for macOS on Apple Silicon and Linux x64; the
# desktop app for macOS (arm64, x64) and Linux x64.
asset_name() {
  kind="$1"
  case "$kind-$PLATFORM-$ARCH" in
    cli-macos-arm64) echo "eduneon-dc-macos-arm64-${VERSION}.zip" ;;
    cli-linux-x86_64 | cli-linux-amd64) echo "eduneon-dc-linux-${VERSION}.zip" ;;
    app-macos-arm64) echo "Eduneon-Directory-Connector-${VERSION}-arm64.dmg" ;;
    app-macos-x86_64) echo "Eduneon-Directory-Connector-${VERSION}-x64.dmg" ;;
    app-linux-x86_64 | app-linux-amd64) echo "Eduneon-Directory-Connector-${VERSION}-x86_64.AppImage" ;;
    *) fail "no $kind build for $PLATFORM on $ARCH" ;;
  esac
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() {
  need curl
  if [ -z "$VERSION" ]; then
    # The latest release's tag (vX.Y.Z) without asking the API: GitHub redirects /releases/latest to it.
    tag="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest")"
    # Without any release GitHub redirects to /releases instead of /releases/tag/vX.Y.Z.
    case "$tag" in
      */releases/tag/v*) ;;
      *) fail "no release of the Directory Connector is published yet; install from a downloaded file: sh install.sh --from <file>" ;;
    esac
    tag="${tag##*/}"
    VERSION="${tag#v}"
  fi
  name="$(asset_name "$1")"
  say "Downloading $name" >&2
  curl -fL --progress-bar -o "$TMP/$name" "https://github.com/${REPO}/releases/download/v${VERSION}/${name}" ||
    fail "download failed: $name (version ${VERSION})"
  echo "$TMP/$name"
}

install_cli() {
  zip="$1"
  need unzip
  mkdir -p "$TMP/cli" "$BIN_DIR"
  unzip -q -o "$zip" -d "$TMP/cli"
  bin="$(find "$TMP/cli" -type f -name 'eduneon-dc' | head -n 1)"
  [ -n "$bin" ] || fail "no eduneon-dc in $zip"
  # The CLI ships its native module next to the binary: keep the whole folder together.
  dest="${BIN_DIR%/bin}/lib/eduneon-dc"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -R "$(dirname "$bin")/." "$dest/"
  chmod +x "$dest/eduneon-dc"
  [ "$PLATFORM" = macos ] && xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true
  ln -sf "$dest/eduneon-dc" "$BIN_DIR/eduneon-dc"
  say "Installed the CLI: $BIN_DIR/eduneon-dc"
  "$BIN_DIR/eduneon-dc" --version >/dev/null 2>&1 || say "Warning: eduneon-dc did not start; run it to see why."
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) say "Add $BIN_DIR to your PATH, e.g.: echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.profile" ;;
  esac
}

detach() {
  diskutil image detach "$1" >/dev/null 2>&1 || hdiutil detach -quiet "$1" 2>/dev/null || diskutil eject "$1" >/dev/null 2>&1 || true
}

install_app_macos() {
  dmg="$1"
  # `diskutil image` replaces `hdiutil attach` from macOS 27 on; older systems only have hdiutil.
  if diskutil image attach --help >/dev/null 2>&1; then
    mount="$(diskutil image attach --mountOptions nobrowse --readOnly "$dmg" 2>/dev/null | grep -o '/Volumes/.*' | head -n 1)"
  else
    mount="$(hdiutil attach -nobrowse -readonly "$dmg" | grep -o '/Volumes/.*' | head -n 1)"
  fi
  [ -n "$mount" ] || fail "could not open $dmg"
  app="$(find "$mount" -maxdepth 1 -name '*.app' | head -n 1)"
  [ -n "$app" ] || { detach "$mount"; fail "no app in $dmg"; }
  mkdir -p "$APPS_DIR"
  target="$APPS_DIR/$(basename "$app")"
  SUDO=""
  [ -w "$APPS_DIR" ] || SUDO="sudo"
  $SUDO rm -rf "$target"
  $SUDO cp -R "$app" "$APPS_DIR/"
  detach "$mount"
  # The builds are not notarized yet: without this, macOS refuses the first start of a downloaded copy.
  $SUDO xattr -dr com.apple.quarantine "$target" 2>/dev/null || true
  say "Installed the desktop app: $target"
}

install_app_linux() {
  image="$1"
  mkdir -p "$BIN_DIR"
  cp "$image" "$BIN_DIR/eduneon-directory-connector"
  chmod +x "$BIN_DIR/eduneon-directory-connector"
  say "Installed the desktop app: $BIN_DIR/eduneon-directory-connector"
  say "It needs FUSE 2 (e.g. 'sudo apt install libfuse2'); without it, start it with --appimage-extract-and-run."
}

if [ -n "$FROM" ]; then
  [ -f "$FROM" ] || fail "no such file: $FROM"
  case "$FROM" in
    *.dmg) install_app_macos "$FROM" ;;
    *.AppImage) install_app_linux "$FROM" ;;
    *.zip) install_cli "$FROM" ;;
    *) fail "unknown file type: $FROM" ;;
  esac
  exit 0
fi

# fetch fails inside $(…), a subshell: stop here rather than install an empty path.
cli_zip="$(fetch cli)" || exit 1
install_cli "$cli_zip"
if [ "$APP" = 1 ]; then
  file="$(fetch app)" || exit 1
  case "$PLATFORM" in
    macos) install_app_macos "$file" ;;
    linux) install_app_linux "$file" ;;
  esac
fi

say ""
say "Next: eduneon-dc login   (with a Cockpit API token, see Platform → Service accounts)"
