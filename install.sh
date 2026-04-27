#!/usr/bin/env bash
set -euo pipefail

REPO="AxonStack/Cortex-Nova"
APP_NAME="Cortex Nova"

err() { echo "[nova] ERROR: $*" >&2; exit 1; }
info() { echo "[nova] $*"; }

release_json() {
  curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest"
}

latest_tag() {
  echo "$1" | grep '"tag_name"' | head -1 | cut -d'"' -f4
}

asset_url_for() {
  local json="$1"
  local pattern="$2"
  echo "$json" \
    | grep '"browser_download_url"' \
    | cut -d'"' -f4 \
    | grep -E "$pattern" \
    | head -1
}

# Detect distro / arch
OS="$(uname -s)"
ARCH="$(uname -m)"

[[ "$OS" != "Linux" ]] && err "This script only supports Linux. Download the .dmg or .msi from the releases page."

# Resolve latest release tag + assets
RELEASE_JSON="$(release_json)"
LATEST="$(latest_tag "$RELEASE_JSON")"
[[ -z "$LATEST" ]] && err "Could not fetch latest release tag. Check your internet connection."

info "Latest release: $LATEST"

# Prefer native package manager: RPM on Fedora/RHEL, DEB on Debian/Ubuntu,
# fall back to AppImage on everything else.
if command -v dnf &>/dev/null || (command -v rpm &>/dev/null && ! command -v dpkg &>/dev/null); then
  # ── Fedora / RHEL / openSUSE ───────────────────────────────────────────────
  case "$ARCH" in
    x86_64)   ASSET_PATTERN='x86_64\.rpm$' ;;
    aarch64)  ASSET_PATTERN='aarch64\.rpm$' ;;
    *)        err "Unsupported architecture: $ARCH" ;;
  esac
  URL="$(asset_url_for "$RELEASE_JSON" "$ASSET_PATTERN")"
  [[ -z "$URL" ]] && err "Could not find an RPM asset for ${ARCH} in release ${LATEST}."
  FILE="${URL##*/}"
  TMPFILE=$(mktemp /tmp/cortex-nova-XXXXXX.rpm)
  info "Downloading $FILE ..."
  curl -fSL "$URL" -o "$TMPFILE"
  info "Installing (requires sudo) ..."
  if command -v dnf &>/dev/null; then
    sudo dnf install -y "$TMPFILE"
  else
    sudo rpm -U --force "$TMPFILE"
  fi
  rm -f "$TMPFILE"
  info "Installed. Run: cortex-nova"
elif command -v dpkg &>/dev/null; then
  # ── Debian / Ubuntu ────────────────────────────────────────────────────────
  case "$ARCH" in
    x86_64)   ASSET_PATTERN='(amd64|x86_64).*\.deb$' ;;
    aarch64)  ASSET_PATTERN='(arm64|aarch64).*\.deb$' ;;
    *)        err "Unsupported architecture: $ARCH" ;;
  esac
  URL="$(asset_url_for "$RELEASE_JSON" "$ASSET_PATTERN")"
  [[ -z "$URL" ]] && err "Could not find a Debian package asset for ${ARCH} in release ${LATEST}."
  FILE="${URL##*/}"
  TMPFILE=$(mktemp /tmp/cortex-nova-XXXXXX.deb)
  info "Downloading $FILE ..."
  curl -fSL "$URL" -o "$TMPFILE"
  info "Installing (requires sudo) ..."
  sudo dpkg -i "$TMPFILE"
  rm -f "$TMPFILE"
  info "Installed. Run: cortex-nova"
else
  case "$ARCH" in
    x86_64)   ASSET_PATTERN='(amd64|x86_64).*\.AppImage$' ;;
    aarch64)  ASSET_PATTERN='(arm64|aarch64).*\.AppImage$' ;;
    *)        err "Unsupported architecture: $ARCH" ;;
  esac
  URL="$(asset_url_for "$RELEASE_JSON" "$ASSET_PATTERN")"
  [[ -z "$URL" ]] && err "Could not find an AppImage asset for ${ARCH} in release ${LATEST}."
  FILE="${URL##*/}"
  # AppImage stored as cortex-nova.appimage; the launcher wrapper at cortex-nova
  # sets required env vars so the command always works from the terminal.
  APPIMAGE="$HOME/.local/bin/cortex-nova.appimage"
  LAUNCHER="$HOME/.local/bin/cortex-nova"
  ICON_DEST="$HOME/.local/share/icons/hicolor/128x128/apps/cortex-nova.png"
  ICON_URL="https://raw.githubusercontent.com/${REPO}/${LATEST}/src-tauri/icons/128x128.png"
  mkdir -p "$HOME/.local/bin"
  info "Downloading $FILE ..."
  curl -fSL "$URL" -o "$APPIMAGE"
  chmod +x "$APPIMAGE"

  # Shell wrapper — sets env vars that WebKit needs on Wayland/Fedora/NVIDIA
  cat >"$LAUNCHER" <<'WRAPPER'
#!/usr/bin/env bash
# Force GTK/WebKit through XWayland — fixes black window on Fedora/Wayland.
# All vars are only set when the user hasn't already overridden them.
export GDK_BACKEND="${GDK_BACKEND:-x11}"
export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"
export WEBKIT_FORCE_SANDBOX="${WEBKIT_FORCE_SANDBOX:-0}"
exec "$(dirname "$(realpath "$0")")/cortex-nova.appimage" "$@"
WRAPPER
  chmod +x "$LAUNCHER"

  # Install app icon used by desktop launchers.
  mkdir -p "$(dirname "$ICON_DEST")"
  if curl -fSL "$ICON_URL" -o "$ICON_DEST"; then
    info "Installed desktop icon."
  else
    info "Could not fetch app icon from release tag; desktop may show a generic icon."
    rm -f "$ICON_DEST"
  fi

  # Desktop entry points to the wrapper, not the raw AppImage
  DESKTOP_DIR="$HOME/.local/share/applications"
  mkdir -p "$DESKTOP_DIR"
  cat >"$DESKTOP_DIR/cortex-nova.desktop" <<EOF
[Desktop Entry]
Name=Cortex Nova
Comment=AI Voice Assistant
Exec=$LAUNCHER
Icon=$ICON_DEST
Terminal=false
Type=Application
Categories=Utility;
EOF

  # Refresh desktop database/icon cache when available.
  command -v update-desktop-database &>/dev/null && update-desktop-database "$DESKTOP_DIR" || true
  command -v gtk-update-icon-cache &>/dev/null && gtk-update-icon-cache "$HOME/.local/share/icons/hicolor" || true

  info "Installed to $LAUNCHER"
  info "Make sure ~/.local/bin is in your PATH, then run: cortex-nova"
fi

# Optional: wmctrl improves window focus on X11/XWayland (not required)
if ! command -v wmctrl &>/dev/null; then
  echo ""
  info "Optional: install wmctrl for better window-focus support:"
  info "  sudo apt install wmctrl   # Debian/Ubuntu"
  info "  sudo dnf install wmctrl   # Fedora"
fi

echo ""
info "Done! $APP_NAME is installed."
info "On first launch, the setup wizard will ask you to pick an AI provider."
