use enigo::{Enigo, Key, Keyboard, Mouse, Settings, Button, Coordinate};
use std::io::{ErrorKind, Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

// ── Managed state ─────────────────────────────────────────────────────────────

struct OAuthServer(Mutex<Option<TcpListener>>);

/// Holds the live arecord child process so we can kill it on stop.
struct RecordingState(Mutex<Option<std::process::Child>>);

// ── Helpers ───────────────────────────────────────────────────────────────────

fn extended_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let current = std::env::var("PATH").unwrap_or_default();
    let mut parts = vec![
        format!("{home}/.npm/bin"),
        format!("{home}/.npm-global/bin"),
        format!("{home}/.local/bin"),
        format!("{home}/.local/share/pnpm"),
        format!("{home}/.volta/bin"),
        format!("{home}/.yarn/bin"),
        format!("{home}/.config/yarn/global/node_modules/.bin"),
        "/usr/local/bin".into(),
        "/usr/bin".into(),
        "/bin".into(),
    ];

    if let Ok(v) = std::env::var("PNPM_HOME") {
        if !v.trim().is_empty() {
            parts.push(v);
        }
    }
    if let Ok(v) = std::env::var("VOLTA_HOME") {
        if !v.trim().is_empty() {
            parts.push(format!("{v}/bin"));
        }
    }
    if let Ok(v) = std::env::var("NPM_CONFIG_PREFIX") {
        if !v.trim().is_empty() {
            parts.push(format!("{v}/bin"));
        }
    }

    parts.push(current);
    parts.join(":")
}

fn resolve_cli_path(cli: &str) -> Option<String> {
    let path = extended_path();
    let home = std::env::var("HOME").unwrap_or_default();

    let candidates = [
        format!("{home}/.npm/bin/{cli}"),
        format!("{home}/.npm-global/bin/{cli}"),
        format!("{home}/.local/bin/{cli}"),
        format!("{home}/.local/share/pnpm/{cli}"),
        format!("{home}/.volta/bin/{cli}"),
        format!("/usr/local/bin/{cli}"),
        format!("/usr/bin/{cli}"),
    ];

    for candidate in candidates {
        let p = PathBuf::from(&candidate);
        if p.exists() {
            return Some(candidate);
        }
    }

    #[cfg(target_os = "windows")]
    let which = "where";
    #[cfg(not(target_os = "windows"))]
    let which = "which";

    if let Ok(output) = std::process::Command::new(which)
        .arg(cli)
        .env("PATH", &path)
        .output()
    {
        if output.status.success() {
            let found = String::from_utf8_lossy(&output.stdout)
                .lines()
                .find(|line| !line.trim().is_empty())
                .map(|line| line.trim().to_string());
            if found.is_some() {
                return found;
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Fallback: ask a login shell, which picks up shell profile PATH customizations.
        if let Ok(output) = std::process::Command::new("sh")
            .args(["-lc", &format!("command -v {cli}")])
            .env("PATH", &path)
            .output()
        {
            if output.status.success() {
                let found = String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .to_string();
                if !found.is_empty() {
                    return Some(found);
                }
            }
        }
    }

    None
}

/// Percent-decode a URL query string value (no external deps).
fn url_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Ok(hi), Ok(lo)) = (
                std::str::from_utf8(&bytes[i + 1..i + 2]),
                std::str::from_utf8(&bytes[i + 2..i + 3]),
            ) {
                if let Ok(byte) = u8::from_str_radix(&format!("{hi}{lo}"), 16) {
                    out.push(byte as char);
                    i += 3;
                    continue;
                }
            }
        } else if bytes[i] == b'+' {
            out.push(' ');
            i += 1;
            continue;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

// ── OAuth server commands ─────────────────────────────────────────────────────

/// Bind a random local port for the OAuth redirect URI and return the port number.
/// Call this BEFORE opening the browser so the port is known for the auth URL.
#[tauri::command]
fn start_oauth_server(state: tauri::State<OAuthServer>) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Could not start local OAuth server: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();
    *state.0.lock().unwrap() = Some(listener);
    Ok(port)
}

/// Block until the browser hits the local redirect URI, then return the
/// query params (code, state, error, …) as a JSON object string.
/// Sends a friendly "you can close this tab" page back to the browser.
#[tauri::command]
fn collect_oauth_callback(state: tauri::State<OAuthServer>) -> Result<String, String> {
    let listener = state
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or("No OAuth server is running — call start_oauth_server first.")?;

    // Accept exactly one connection (the browser redirect).
    // Use a timeout so invalid OAuth flows don't hang the app.
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("OAuth callback setup error: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(180);
    let (mut stream, _) = loop {
        match listener.accept() {
            Ok(conn) => break conn,
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("OAuth timed out waiting for provider callback. Please try again.".into());
                }
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(format!("OAuth callback error: {e}")),
        }
    };

    // Read the HTTP GET request
    let mut buf = vec![0u8; 8192];
    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buf[..n]);

    // Reply immediately so the browser stops spinning
    let html = "<html><head><style>body{font-family:monospace;display:flex;align-items:center;\
        justify-content:center;height:100vh;margin:0;background:#f5f5f0}\
        div{text-align:center;border:1px solid #000;padding:40px 60px}\
        h2{margin:0 0 12px;font-size:16px;letter-spacing:.2em;text-transform:uppercase}\
        p{margin:0;font-size:12px;color:#666;letter-spacing:.1em}</style></head>\
        <body><div><h2>Authentication complete</h2>\
        <p>You can close this tab and return to Cortex Nova.</p></div>\
        <script>setTimeout(()=>window.close(),1500)</script></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(), html
    );
    let _ = stream.write_all(response.as_bytes());

    // Parse the GET request line: "GET /callback?code=...&state=... HTTP/1.1"
    let first_line = request.lines().next().unwrap_or("");
    let path = first_line.split_whitespace().nth(1).unwrap_or("");
    let query = path.splitn(2, '?').nth(1).unwrap_or("");

    let mut map = serde_json::Map::new();
    for pair in query.split('&') {
        if pair.is_empty() { continue; }
        let mut parts = pair.splitn(2, '=');
        let key = url_decode(parts.next().unwrap_or(""));
        let val = url_decode(parts.next().unwrap_or(""));
        map.insert(key, serde_json::Value::String(val));
    }

    serde_json::to_string(&map).map_err(|e| e.to_string())
}

// ── Existing commands ──────────────────────────────────────────────────────────

/// Open a URL in the system default browser.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let result = {
        #[cfg(target_os = "linux")]
        { std::process::Command::new("xdg-open").arg(&url).spawn() }

        #[cfg(target_os = "macos")]
        { std::process::Command::new("open").arg(&url).spawn() }

        #[cfg(target_os = "windows")]
        { std::process::Command::new("cmd").args(["/C", "start", &url]).spawn() }
    };
    result.map(|_| ()).map_err(|e| e.to_string())
}

/// Returns true if `binary` exists somewhere on PATH.
fn binary_in_path(binary: &str) -> bool {
    std::env::var("PATH").ok().is_some_and(|paths| {
        paths
            .split(':')
            .any(|dir| std::path::Path::new(dir).join(binary).is_file())
    })
}

/// Returns true only when the snap package is actually installed (not just snap itself).
fn snap_package_installed(name: &str) -> bool {
    binary_in_path("snap")
        && std::process::Command::new("snap")
            .args(["list", name])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
}

/// Returns true only when the flatpak app ID is actually installed.
fn flatpak_app_installed(app_id: &str) -> bool {
    binary_in_path("flatpak")
        && std::process::Command::new("flatpak")
            .args(["info", app_id])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
}

/// Search installed .desktop files for an app matching `name` and launch via gtk-launch.
/// Covers apps installed as Flatpak, Snap, or system packages that don't have a plain binary.
#[cfg(target_os = "linux")]
fn try_desktop_launch(name: &str) -> bool {
    let needle = name.to_lowercase().replace([' ', '-', '_', '.'], "");
    let home = std::env::var("HOME").unwrap_or_default();
    let dirs = [
        "/usr/share/applications".to_string(),
        format!("{home}/.local/share/applications"),
        "/var/lib/flatpak/exports/share/applications".to_string(),
        format!("{home}/.local/share/flatpak/exports/share/applications"),
        "/var/lib/snapd/desktop/applications".to_string(),
    ];
    for dir in &dirs {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_lowercase();
                if !fname.ends_with(".desktop") { continue; }
                let base = fname.trim_end_matches(".desktop")
                    .replace(['-', '_', '.'], "");
                if base.contains(&needle) || needle.contains(&base) {
                    let desktop_id = fname.trim_end_matches(".desktop").to_string();
                    if std::process::Command::new("gtk-launch")
                        .arg(&desktop_id)
                        .spawn()
                        .is_ok()
                    {
                        return true;
                    }
                }
            }
        }
    }
    false
}

#[tauri::command]
fn open_application(app: String) -> Result<(), String> {
    let requested = app.trim();
    if requested.is_empty() {
        return Err("No application name provided.".into());
    }

    #[cfg(target_os = "linux")]
    {
        let normalized = requested.to_lowercase();
        let home = std::env::var("HOME").unwrap_or_default();

        let mut candidates: Vec<Vec<String>> = match normalized.as_str() {
            "chrome" | "google chrome" => vec![
                vec!["google-chrome".into()],
                vec!["google-chrome-stable".into()],
                vec!["chromium-browser".into()],
                vec!["chromium".into()],
            ],
            "firefox" | "firefox browser" => vec![
                vec!["firefox".into()],
                vec!["firefox-esr".into()],
            ],
            "brave" | "brave-browser" | "brave browser" => vec![
                vec!["brave-browser".into()],
                vec!["brave".into()],
            ],
            "opera" => vec![vec!["opera".into()]],
            "edge" | "microsoft-edge" | "microsoft edge" => vec![
                vec!["microsoft-edge".into()],
                vec!["microsoft-edge-stable".into()],
            ],
            "calculator" | "calc" => vec![
                vec!["gnome-calculator".into()],
                vec!["kcalc".into()],
                vec!["mate-calc".into()],
                vec!["galculator".into()],
                vec!["qalculate-gtk".into()],
            ],
            "files" | "file manager" | "nautilus" => vec![
                vec!["nautilus".into()],
                vec!["dolphin".into()],
                vec!["thunar".into()],
                vec!["pcmanfm".into()],
                vec!["nemo".into()],
            ],
            "dolphin" => vec![vec!["dolphin".into()]],
            "thunar"  => vec![vec!["thunar".into()]],
            "terminal" => vec![
                vec!["gnome-terminal".into()],
                vec!["konsole".into()],
                vec!["xfce4-terminal".into()],
                vec!["alacritty".into()],
                vec!["kitty".into()],
                vec!["tilix".into()],
                vec!["xterm".into()],
            ],
            "telegram" | "telegram desktop" | "telegram app" => {
                let mut t = vec![
                    vec!["telegram-desktop".into()],
                    vec!["telegram".into()],
                    vec!["Telegram".into()],
                ];
                for path in [
                    format!("{home}/Telegram/Telegram"),
                    "/opt/Telegram/Telegram".into(),
                    format!("{home}/.local/bin/Telegram"),
                ] {
                    if std::path::Path::new(&path).exists() { t.push(vec![path]); }
                }
                t
            }
            "discord" => vec![
                vec!["discord".into()],
                vec!["Discord".into()],
                vec![format!("{home}/.local/bin/discord")],
            ],
            "slack" => vec![vec!["slack".into()]],
            "zoom"  => vec![vec!["zoom".into()]],
            "skype" => vec![vec!["skype".into()]],
            "signal" | "signal-desktop" => vec![
                vec!["signal-desktop".into()],
                vec!["signal".into()],
            ],
            "teams" | "microsoft teams" => vec![
                vec!["teams".into()],
                vec!["teams-for-linux".into()],
            ],
            "code" | "vscode" | "visual studio code" | "vs code" => vec![
                vec!["code".into()],
                vec!["code-insiders".into()],
                vec!["codium".into()],
            ],
            "vim" => vec![vec!["vim".into()]],
            "gedit" | "text editor" => vec![
                vec!["gedit".into()],
                vec!["kate".into()],
                vec!["mousepad".into()],
                vec!["xed".into()],
            ],
            "vlc" | "media player" => vec![vec!["vlc".into()]],
            "mpv" => vec![vec!["mpv".into()]],
            "spotify" => vec![
                vec!["spotify".into()],
                vec![format!("{home}/.local/share/spotify/spotify")],
            ],
            "steam" => vec![vec!["steam".into()]],
            "gimp"  => vec![vec!["gimp".into()]],
            "inkscape" => vec![vec!["inkscape".into()]],
            "blender"  => vec![vec!["blender".into()]],
            "obs" | "obs studio" => vec![vec!["obs".into()]],
            "audacity"  => vec![vec!["audacity".into()]],
            "kdenlive"  => vec![vec!["kdenlive".into()]],
            "libreoffice" | "libre office" => vec![vec!["libreoffice".into()]],
            "gnome-system-monitor" | "system monitor" | "monitor" => vec![
                vec!["gnome-system-monitor".into()],
                vec!["ksysguard".into()],
            ],
            "settings" => vec![
                vec!["gnome-control-center".into()],
                vec!["systemsettings5".into()],
            ],
            _ => {
                // Generic: try the exact requested string and common binary variations
                let lower = normalized.replace(' ', "-");
                let no_space = normalized.replace(' ', "");
                vec![
                    vec![requested.into()],
                    vec![lower.clone()],
                    vec![no_space],
                ]
            }
        };

        // Snap/Flatpak verified candidates for known packages
        match normalized.as_str() {
            "telegram" | "telegram desktop" | "telegram app" => {
                if snap_package_installed("telegram-desktop") {
                    candidates.push(vec!["snap".into(), "run".into(), "telegram-desktop".into()]);
                }
                if flatpak_app_installed("org.telegram.desktop") {
                    candidates.push(vec!["flatpak".into(), "run".into(), "org.telegram.desktop".into()]);
                }
            }
            "code" | "vscode" | "visual studio code" | "vs code" => {
                if snap_package_installed("code") {
                    candidates.push(vec!["snap".into(), "run".into(), "code".into()]);
                }
                if flatpak_app_installed("com.visualstudio.code") {
                    candidates.push(vec!["flatpak".into(), "run".into(), "com.visualstudio.code".into()]);
                }
            }
            "discord" => {
                if flatpak_app_installed("com.discordapp.Discord") {
                    candidates.push(vec!["flatpak".into(), "run".into(), "com.discordapp.Discord".into()]);
                }
                if snap_package_installed("discord") {
                    candidates.push(vec!["snap".into(), "run".into(), "discord".into()]);
                }
            }
            "spotify" => {
                if snap_package_installed("spotify") {
                    candidates.push(vec!["snap".into(), "run".into(), "spotify".into()]);
                }
                if flatpak_app_installed("com.spotify.Client") {
                    candidates.push(vec!["flatpak".into(), "run".into(), "com.spotify.Client".into()]);
                }
            }
            "steam" => {
                if flatpak_app_installed("com.valvesoftware.Steam") {
                    candidates.push(vec!["flatpak".into(), "run".into(), "com.valvesoftware.Steam".into()]);
                }
            }
            _ => {}
        }

        // Try every binary candidate first
        for cmd in &candidates {
            if let Some((bin, args)) = cmd.split_first() {
                if std::process::Command::new(bin).args(args).spawn().is_ok() {
                    return Ok(());
                }
            }
        }

        // Final fallback: search installed .desktop files and launch via gtk-launch.
        // Covers any app not in the known list above (Flatpak, AppImage, custom installs).
        if try_desktop_launch(requested) {
            return Ok(());
        }

        Err(format!(
            "Could not find or launch \"{requested}\". Make sure it is installed and on your PATH."
        ))
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-a", requested])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open {requested}: {e}"))
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", requested])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open {requested}: {e}"))
    }
}

/// Close/quit a running desktop application by name. Tries multiple common
/// process names and pkill flavors so "close firefox" actually terminates it.
#[tauri::command]
fn close_application(app: String) -> Result<(), String> {
    let requested = app.trim();
    if requested.is_empty() {
        return Err("No application name provided.".into());
    }

    #[cfg(target_os = "linux")]
    {
        let normalized = requested.to_lowercase();
        // Map common app names to the actual process names that show up in `ps`.
        let proc_names: Vec<String> = match normalized.as_str() {
            "chrome" | "google chrome" => vec!["chrome".into(), "google-chrome".into(), "google-chrome-stable".into()],
            "firefox" | "firefox browser" => vec!["firefox".into(), "firefox-bin".into()],
            "brave" | "brave-browser" | "brave browser" => vec!["brave".into(), "brave-browser".into()],
            "edge" | "microsoft-edge" | "microsoft edge" => vec!["msedge".into(), "microsoft-edge".into()],
            "opera" => vec!["opera".into()],
            "chromium" => vec!["chromium".into(), "chromium-browser".into()],
            "telegram" | "telegram desktop" => vec!["telegram-desktop".into(), "Telegram".into()],
            "discord" => vec!["Discord".into(), "discord".into()],
            "slack" => vec!["slack".into()],
            "zoom" => vec!["zoom".into()],
            "spotify" => vec!["spotify".into()],
            "vlc" => vec!["vlc".into()],
            "vscode" | "code" | "vs code" | "visual studio code" => vec!["code".into()],
            "calculator" | "calc" => vec!["gnome-calculator".into(), "kcalc".into()],
            "files" | "nautilus" | "file manager" => vec!["nautilus".into(), "dolphin".into(), "thunar".into()],
            "terminal" => vec!["gnome-terminal".into(), "konsole".into(), "xfce4-terminal".into()],
            "steam"  => vec!["steam".into()],
            "gimp"   => vec!["gimp".into()],
            "obs" | "obs studio" => vec!["obs".into()],
            _ => vec![requested.to_string(), normalized.replace(' ', "-")],
        };

        let mut anything_killed = false;
        for name in &proc_names {
            // pkill -i is case-insensitive; -f matches the full command line so
            // launchers like "/opt/google/chrome/chrome" still match "chrome".
            let status = std::process::Command::new("pkill")
                .args(["-TERM", "-f", "-i", name])
                .status();
            if let Ok(s) = status {
                if s.success() { anything_killed = true; }
            }
        }

        if anything_killed { Ok(()) } else { Err(format!("No running process found for \"{requested}\".")) }
    }

    #[cfg(target_os = "macos")]
    {
        let script = format!(r#"tell application "{requested}" to quit"#);
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .status()
            .map(|_| ())
            .map_err(|e| format!("Could not close {requested}: {e}"))
    }

    #[cfg(target_os = "windows")]
    {
        // taskkill matches by image name; .exe suffix added if missing
        let target = if requested.to_lowercase().ends_with(".exe") {
            requested.to_string()
        } else {
            format!("{requested}.exe")
        };
        std::process::Command::new("taskkill")
            .args(["/F", "/IM", &target])
            .status()
            .map(|_| ())
            .map_err(|e| format!("Could not close {requested}: {e}"))
    }
}

/// Type text into the currently focused application using enigo (no xdotool needed).
#[tauri::command]
fn type_text(text: String) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.text(&text).map_err(|e| e.to_string())
}

/// Move the mouse and left-click at absolute screen coordinates using enigo.
#[tauri::command]
fn mouse_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(80));
    enigo.button(Button::Left, enigo::Direction::Click).map_err(|e| e.to_string())
}

/// Launch the system Chrome/Chromium browser as a new window.
#[tauri::command]
fn launch_browser() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let candidates: Vec<(&str, Vec<&str>)> = vec![
            ("google-chrome", vec![]),
            ("google-chrome-stable", vec![]),
            ("chromium-browser", vec![]),
            ("chromium", vec![]),
            ("snap", vec!["run", "chromium"]),
        ];
        for (bin, args) in candidates {
            if std::process::Command::new(bin).args(args).spawn().is_ok() {
                return Ok(());
            }
        }
        Err("Chrome/Chromium launch failed. Install google-chrome or chromium, or ensure the browser is available on PATH.".into())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-a", "Google Chrome"])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "chrome"])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

/// Bring a window to the foreground by partial title match.
/// Uses wmctrl → xdotool → platform-native fallback (enigo can't raise windows).
#[tauri::command]
fn focus_window(name: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        // wmctrl works on both X11 and XWayland; xdotool is the X11-only fallback.
        if std::process::Command::new("wmctrl")
            .args(["-a", &name])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Ok(());
        }
        // xdotool fallback
        let _ = std::process::Command::new("xdotool")
            .args(["search", "--name", &name, "windowactivate", "--sync"])
            .status();
        Ok(()) // best-effort — don't fail the automation chain if focus fails
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!(r#"tell application "{name}" to activate"#);
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let ps = format!(r#"(New-Object -ComObject WScript.Shell).AppActivate("{name}")"#);
        std::process::Command::new("powershell")
            .args(["-Command", &ps])
            .output()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

/// Send a key or key combination using enigo (no xdotool needed, works on X11 + Wayland).
#[tauri::command]
fn press_key(keys: String) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    let lower = keys.to_lowercase();

    // Parse modifier+key combos like "ctrl+l", "alt+f4", or bare keys like "Return".
    let parts: Vec<&str> = lower.split('+').collect();
    let key_str: &str = parts.last().copied().unwrap_or("");
    let mods: Vec<&str> = parts[..parts.len().saturating_sub(1)].to_vec();

    let key = match key_str {
        "return" | "enter" => Key::Return,
        "tab"              => Key::Tab,
        "escape" | "esc"   => Key::Escape,
        "space"            => Key::Space,
        "backspace"        => Key::Backspace,
        "delete" | "del"   => Key::Delete,
        "up"               => Key::UpArrow,
        "down"             => Key::DownArrow,
        "left"             => Key::LeftArrow,
        "right"            => Key::RightArrow,
        "home"             => Key::Home,
        "end"              => Key::End,
        "pageup"           => Key::PageUp,
        "pagedown"         => Key::PageDown,
        "f1"  => Key::F1,  "f2"  => Key::F2,  "f3"  => Key::F3,
        "f4"  => Key::F4,  "f5"  => Key::F5,  "f6"  => Key::F6,
        "f7"  => Key::F7,  "f8"  => Key::F8,  "f9"  => Key::F9,
        "f10" => Key::F10, "f11" => Key::F11, "f12" => Key::F12,
        s if s.chars().count() == 1 => Key::Unicode(s.chars().next().unwrap()),
        other => return Err(format!("Unknown key: {other}")),
    };

    // Press modifier keys down
    for m in &mods {
        let modifier = match *m {
            "ctrl" | "control" => Key::Control,
            "alt"              => Key::Alt,
            "shift"            => Key::Shift,
            "meta" | "super" | "win" => Key::Meta,
            other => return Err(format!("Unknown modifier: {other}")),
        };
        enigo.key(modifier, enigo::Direction::Press).map_err(|e| e.to_string())?;
    }

    enigo.key(key, enigo::Direction::Click).map_err(|e| e.to_string())?;

    // Release modifiers in reverse order
    for m in mods.iter().rev() {
        let modifier = match *m {
            "ctrl" | "control" => Key::Control,
            "alt"              => Key::Alt,
            "shift"            => Key::Shift,
            "meta" | "super" | "win" => Key::Meta,
            _ => continue,
        };
        enigo.key(modifier, enigo::Direction::Release).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Start recording microphone audio to /tmp/nova_voice.wav via arecord (Linux).
#[tauri::command]
fn start_recording(state: tauri::State<RecordingState>) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        // Kill any existing recording first
        if let Some(mut old) = state.0.lock().unwrap().take() {
            let _ = old.kill();
            let _ = old.wait();
        }
        let child = std::process::Command::new("arecord")
            .args(["-f", "S16_LE", "-r", "16000", "-c", "1", "/tmp/nova_voice.wav"])
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("arecord not found — install: sudo dnf install alsa-utils. Error: {e}"))?;
        *state.0.lock().unwrap() = Some(child);
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    Err("start_recording is Linux-only".into())
}

/// Stop arecord and transcribe the captured WAV. Returns the recognised text.
#[tauri::command]
fn stop_recording_and_transcribe(
    state: tauri::State<RecordingState>,
    openai_key: Option<String>,
) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        // Stop the recording process
        if let Some(mut child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        // Small sleep so the file is fully flushed
        std::thread::sleep(std::time::Duration::from_millis(150));
        transcribe_wav("/tmp/nova_voice.wav", openai_key)
    }
    #[cfg(not(target_os = "linux"))]
    Err("stop_recording_and_transcribe is Linux-only".into())
}

fn transcribe_wav(path: &str, openai_key: Option<String>) -> Result<String, String> {
    if !std::path::Path::new(path).exists() {
        return Err("Recording file not found — was audio captured?".into());
    }

    // 1. Try local whisper CLI (pip install openai-whisper)
    let whisper_output = std::process::Command::new("whisper")
        .args([path, "--model", "tiny", "--language", "en", "--output_format", "txt", "--output_dir", "/tmp"])
        .output();

    if let Ok(out) = whisper_output {
        if out.status.success() {
            let txt_path = path.replace(".wav", ".txt");
            if let Ok(text) = std::fs::read_to_string(&txt_path) {
                let trimmed = text.trim().to_string();
                if !trimmed.is_empty() {
                    return Ok(trimmed);
                }
            }
        }
    }

    // 2. OpenAI Whisper API via curl
    if let Some(key) = openai_key {
        if !key.is_empty() {
            let out = std::process::Command::new("curl")
                .args([
                    "-s",
                    "https://api.openai.com/v1/audio/transcriptions",
                    "-H", &format!("Authorization: Bearer {key}"),
                    "-F", "model=whisper-1",
                    "-F", &format!("file=@{path}"),
                ])
                .output()
                .map_err(|e| format!("curl error: {e}"))?;

            if out.status.success() {
                let json: serde_json::Value = serde_json::from_slice(&out.stdout)
                    .map_err(|e| format!("Whisper API response parse error: {e}"))?;
                if let Some(text) = json["text"].as_str() {
                    let trimmed = text.trim().to_string();
                    if !trimmed.is_empty() {
                        return Ok(trimmed);
                    }
                }
                let err_msg = json["error"]["message"].as_str().unwrap_or("Unknown error");
                return Err(format!("Whisper API: {err_msg}"));
            }
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(format!("curl failed: {stderr}"));
        }
    }

    Err("No transcription method found. Install whisper (pip install openai-whisper) or set an OpenAI API key in setup.".into())
}

/// Returns false on Linux WebKitGTK which doesn't implement the Web Speech API.
#[tauri::command]
fn speech_api_supported() -> bool {
    cfg!(not(target_os = "linux"))
}

/// Check whether a CLI tool is on the PATH.
#[tauri::command]
fn check_cli_available(cli: String) -> bool {
    resolve_cli_path(&cli).is_some()
}

/// Run a CLI AI tool and return its text response.
#[tauri::command]
fn ask_via_cli(cli: String, prompt: String) -> Result<String, String> {
    let path = extended_path();
    let cli_path = resolve_cli_path(&cli).ok_or_else(|| match cli.as_str() {
        "claude" => "claude not found. Install: npm i -g @anthropic-ai/claude-code".to_string(),
        "codex" => "codex not found. Install: npm i -g @openai/codex".to_string(),
        _ => format!("Unknown CLI: {cli}"),
    })?;

    let output = match cli.as_str() {
        "claude" => std::process::Command::new(&cli_path)
            .args(["--print", &prompt])
            .env("PATH", &path)
            .output()
            .map_err(|e| format!("Failed to run {cli} at `{cli_path}`: {e}"))?,
        "codex" => std::process::Command::new(&cli_path)
            .args(["--quiet", "--approval-policy=auto", &prompt])
            .env("PATH", &path)
            .output()
            .map_err(|e| format!("Failed to run {cli} at `{cli_path}`: {e}"))?,
        _ => return Err(format!("Unknown CLI: {cli}")),
    };

    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() {
            Err("CLI returned empty output — check authentication.".into())
        } else {
            Ok(text)
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("{cli} exited with an error — run it in a terminal to re-authenticate.")
        } else {
            stderr
        })
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OAuthServer(Mutex::new(None)))
        .manage(RecordingState(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            // Disable WebKit GPU hardware acceleration via the WebKit2GTK API.
            // Env vars alone can't reach this on Fedora/Wayland — GPU compositing
            // silently outputs a black canvas even when EGL init succeeds.
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                if let Some(win) = _app.get_webview_window("main") {
                    let _ = win.with_webview(|webview| {
                        use webkit2gtk::{HardwareAccelerationPolicy, SettingsExt, WebViewExt};
                        if let Some(settings) = webview.inner().settings() {
                            settings.set_hardware_acceleration_policy(
                                HardwareAccelerationPolicy::Never,
                            );
                        }
                    });
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_url,
            open_application,
            close_application,
            type_text,
            mouse_click,
            launch_browser,
            focus_window,
            press_key,
            start_recording,
            stop_recording_and_transcribe,
            speech_api_supported,
            check_cli_available,
            ask_via_cli,
            start_oauth_server,
            collect_oauth_callback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
