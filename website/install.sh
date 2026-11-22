#!/bin/sh
# Kite installer for Linux and macOS. Installs for the current user (no sudo).
#
#   curl -fsSL https://mumbo235.github.io/kite/install.sh | sh
#
# Uninstall:
#   curl -fsSL https://mumbo235.github.io/kite/install.sh | sh -s -- --uninstall
set -eu

# Where things are hosted. Change these two when you publish, or override them
# with environment variables. With GitHub Releases, FILES is
#   https://github.com/mumbo235/kite/releases/latest/download
SITE="${KITE_SITE:-https://mumbo235.github.io/kite}"
FILES="${KITE_FILES:-https://github.com/mumbo235/kite/releases/latest/download}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$1" >&2; exit 1; }

fetch() { # fetch URL FILE
  if command -v curl >/dev/null 2>&1; then curl -fL --progress-bar "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -q --show-progress -O "$2" "$1"
  else fail "please install curl or wget"; fi
}

BIN_DIR="$HOME/.local/bin"

# ---------------------------------------------------------------- macOS
if [ "$(uname -s)" = "Darwin" ]; then
  APP="$HOME/Applications/Kite.app"
  if [ "${1:-}" = "--uninstall" ]; then
    say "Removing Kite"
    rm -rf "$APP" "$BIN_DIR/kite"
    say "Kite was removed. Your settings are in ~/Library/Application Support/Kite."
    exit 0
  fi
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  say "Downloading Kite for macOS"
  fetch "${KITE_URL:-$FILES/Kite-mac-universal.zip}" "$TMP/kite.zip"
  say "Installing to ~/Applications"
  mkdir -p "$HOME/Applications" "$BIN_DIR"
  ditto -x -k "$TMP/kite.zip" "$TMP/out"
  rm -rf "$APP"
  mv "$TMP/out/Kite.app" "$APP"
  # The app isn't signed with an Apple Developer ID yet; clear the download
  # quarantine flag so macOS lets it open.
  xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
  ln -sf "$APP/Contents/MacOS/Kite" "$BIN_DIR/kite"
  say "Kite is installed. Open it from Launchpad, or run: open -a Kite"
  exit 0
fi

# ---------------------------------------------------------------- Linux
[ "$(uname -s)" = "Linux" ] || fail "this installer is for Linux and macOS. On Windows, use install.ps1."
case "$(uname -m)" in x86_64 | amd64) ;; *) fail "Kite for Linux currently ships for 64-bit Intel/AMD (x86_64) only." ;; esac

APP_DIR="$HOME/.local/share/kite"
DESKTOP="$HOME/.local/share/applications/kite.desktop"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"

refresh() {
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
  for k in kbuildsycoca6 kbuildsycoca5; do command -v $k >/dev/null 2>&1 && { $k >/dev/null 2>&1 || true; break; }; done
}

if [ "${1:-}" = "--uninstall" ]; then
  say "Removing Kite"
  rm -rf "$APP_DIR" "$BIN_DIR/kite" "$DESKTOP" "$ICON_DIR/kite.png"
  refresh
  say "Kite was removed. Your settings are kept in ~/.config/Kite (delete it to remove them too)."
  exit 0
fi

mkdir -p "$APP_DIR" "$BIN_DIR" "$(dirname "$DESKTOP")" "$ICON_DIR"

say "Downloading Kite for Linux"
fetch "${KITE_URL:-$FILES/Kite-x86_64.AppImage}" "$APP_DIR/Kite.AppImage.part"
mv "$APP_DIR/Kite.AppImage.part" "$APP_DIR/Kite.AppImage"
chmod +x "$APP_DIR/Kite.AppImage"
fetch "${KITE_ICON_URL:-$SITE/kite.png}" "$ICON_DIR/kite.png" 2>/dev/null || true

# AppImages need FUSE 2. If it's missing, run Kite without it instead.
EXEC="$APP_DIR/Kite.AppImage"
if ! (ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'); then
  EXEC="env APPIMAGE_EXTRACT_AND_RUN=1 $APP_DIR/Kite.AppImage"
fi

ln -sf "$APP_DIR/Kite.AppImage" "$BIN_DIR/kite"

cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=Kite
GenericName=Web Browser
Comment=A browser for you
Exec=$EXEC %U
Icon=kite
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
StartupNotify=true
StartupWMClass=Kite
EOF

refresh
say "Kite is installed. Find it in your app menu, or run: kite"
