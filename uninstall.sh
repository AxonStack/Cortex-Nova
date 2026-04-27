#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Cortex Nova"
info()  { echo "[nova] $*"; }
ok()    { echo "[nova] ✓ $*"; }
skip()  { echo "[nova] – $*"; }

info "Uninstalling $APP_NAME..."

removed=0

# ── .deb / dpkg install ───────────────────────────────────────────────────────
if command -v dpkg &>/dev/null && dpkg -l cortex-nova &>/dev/null 2>&1; then
  info "Removing dpkg package cortex-nova (requires sudo)..."
  sudo apt-get remove -y cortex-nova 2>/dev/null || sudo dpkg -r cortex-nova
  ok "dpkg package removed."
  removed=1
fi

# ── AppImage install ──────────────────────────────────────────────────────────
for f in "$HOME/.local/bin/cortex-nova" "$HOME/.local/bin/cortex-nova.appimage"; do
  if [[ -f "$f" ]]; then
    rm -f "$f"
    ok "Removed $f"
    removed=1
  fi
done

# ── Desktop entry ─────────────────────────────────────────────────────────────
DESKTOP="$HOME/.local/share/applications/cortex-nova.desktop"
if [[ -f "$DESKTOP" ]]; then
  rm -f "$DESKTOP"
  command -v update-desktop-database &>/dev/null \
    && update-desktop-database "$HOME/.local/share/applications" || true
  ok "Removed desktop entry."
fi

# ── App icon ──────────────────────────────────────────────────────────────────
ICON="$HOME/.local/share/icons/hicolor/128x128/apps/cortex-nova.png"
if [[ -f "$ICON" ]]; then
  rm -f "$ICON"
  command -v gtk-update-icon-cache &>/dev/null \
    && gtk-update-icon-cache "$HOME/.local/share/icons/hicolor" || true
  ok "Removed icon."
fi

# ── User config / data (optional) ────────────────────────────────────────────
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/cortex-nova"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/cortex-nova"

if [[ -d "$CONFIG_DIR" || -d "$DATA_DIR" ]]; then
  echo ""
  read -rp "[nova] Remove saved settings and data? [y/N] " yn
  if [[ "${yn,,}" == "y" ]]; then
    [[ -d "$CONFIG_DIR" ]] && rm -rf "$CONFIG_DIR" && ok "Removed $CONFIG_DIR"
    [[ -d "$DATA_DIR"   ]] && rm -rf "$DATA_DIR"   && ok "Removed $DATA_DIR"
  else
    skip "Kept user data. Delete manually: $CONFIG_DIR  $DATA_DIR"
  fi
fi

echo ""
if [[ $removed -eq 1 ]]; then
  info "$APP_NAME has been uninstalled."
else
  info "No $APP_NAME installation found."
fi
