#!/usr/bin/env bash
set -euo pipefail

REPO="BluntXdev/cortex-nova"
APP_NAME="Cortex Nova"

err() { echo "[nova] ERROR: $*" >&2; exit 1; }
info() { echo "[nova] $*"; }

# Detect distro / arch
OS="$(uname -s)"
ARCH="$(uname -m)"

[[ "$OS" != "Linux" ]] && err "This script only supports Linux. Download the .dmg or .msi from the releases page."

# Resolve latest release tag
LATEST=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep '"tag_name"' | head -1 | cut -d'"' -f4)
[[ -z "$LATEST" ]] && err "Could not fetch latest release tag. Check your internet connection."

info "Latest release: $LATEST"

# Prefer .deb on Debian/Ubuntu, fall back to AppImage
if command -v dpkg &>/dev/null; then
  case "$ARCH" in
    x86_64)   FILE="cortex-nova_${LATEST#v}_amd64.deb" ;;
    aarch64)  FILE="cortex-nova_${LATEST#v}_arm64.deb" ;;
    *)        err "Unsupported architecture: $ARCH" ;;
  esac
  URL="https://github.com/${REPO}/releases/download/${LATEST}/${FILE}"
  TMPFILE=$(mktemp /tmp/cortex-nova-XXXXXX.deb)
  info "Downloading $FILE ..."
  curl -fSL "$URL" -o "$TMPFILE"
  info "Installing (requires sudo) ..."
  sudo dpkg -i "$TMPFILE"
  rm -f "$TMPFILE"
  info "Installed. Run: cortex-nova"
else
  case "$ARCH" in
    x86_64)   FILE="cortex-nova_${LATEST#v}_amd64.AppImage" ;;
    aarch64)  FILE="cortex-nova_${LATEST#v}_aarch64.AppImage" ;;
    *)        err "Unsupported architecture: $ARCH" ;;
  esac
  URL="https://github.com/${REPO}/releases/download/${LATEST}/${FILE}"
  DEST="$HOME/.local/bin/cortex-nova"
  mkdir -p "$HOME/.local/bin"
  info "Downloading $FILE ..."
  curl -fSL "$URL" -o "$DEST"
  chmod +x "$DEST"

  # Desktop entry
  DESKTOP_DIR="$HOME/.local/share/applications"
  mkdir -p "$DESKTOP_DIR"
  cat >"$DESKTOP_DIR/cortex-nova.desktop" <<EOF
[Desktop Entry]
Name=Cortex Nova
Comment=AI Voice Assistant
Exec=$DEST
Icon=utilities-terminal
Terminal=false
Type=Application
Categories=Utility;
EOF

  info "Installed to $DEST"
  info "Make sure ~/.local/bin is in your PATH, then run: cortex-nova"
fi

# Linux system dep reminder
if ! command -v xdotool &>/dev/null; then
  echo ""
  info "Optional: install xdotool to enable the 'type' and 'click' commands:"
  info "  sudo apt install xdotool   # Debian/Ubuntu"
  info "  sudo dnf install xdotool   # Fedora"
fi

echo ""
info "Done! $APP_NAME is installed."
info "On first launch, the setup wizard will ask you to pick an AI provider."
