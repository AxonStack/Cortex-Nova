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

#[tauri::command]
fn open_application(app: String) -> Result<(), String> {
    let requested = app.trim();
    if requested.is_empty() {
        return Err("No application name provided.".into());
    }

    #[cfg(target_os = "linux")]
    {
        let normalized = requested.to_lowercase();
        let candidates: Vec<Vec<String>> = match normalized.as_str() {
            "chrome" | "google chrome" => vec![
                vec!["google-chrome".into()],
                vec!["google-chrome-stable".into()],
                vec!["chromium-browser".into()],
                vec!["chromium".into()],
            ],
            "calculator" | "calc" => vec![
                vec!["gnome-calculator".into()],
                vec!["kcalc".into()],
                vec!["mate-calc".into()],
                vec!["galculator".into()],
            ],
            "files" | "file manager" => vec![
                vec!["nautilus".into()],
                vec!["dolphin".into()],
                vec!["thunar".into()],
                vec!["pcmanfm".into()],
            ],
            "terminal" => vec![
                vec!["gnome-terminal".into()],
                vec!["konsole".into()],
                vec!["xfce4-terminal".into()],
                vec!["xterm".into()],
            ],
            _ => vec![
                vec![requested.into()],
                vec!["gtk-launch".into(), requested.replace(' ', "-")],
                vec!["gio".into(), "launch".into(), requested.into()],
            ],
        };

        for cmd in candidates {
            if let Some((bin, args)) = cmd.split_first() {
                if std::process::Command::new(bin).args(args).spawn().is_ok() {
                    return Ok(());
                }
            }
        }
        Err(format!("Could not open application: {requested}"))
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-a", requested])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open application {requested}: {e}"))
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", requested])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open application {requested}: {e}"))
    }
}

/// Type text into the currently focused application.
#[tauri::command]
fn type_text(text: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdotool")
            .args(["type", "--clearmodifiers", "--delay", "20", "--", &text])
            .output()
            .map(|_| ())
            .map_err(|e| format!("xdotool not found — install: sudo apt install xdotool. Error: {e}"))
    }
    #[cfg(target_os = "macos")]
    {
        let safe = text.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(r#"tell application "System Events" to keystroke "{safe}""#);
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let safe = text.replace('{', "{{").replace('}', "}}").replace('"', r#""""#);
        let ps = format!(r#"$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys("{safe}")"#);
        std::process::Command::new("powershell")
            .args(["-Command", &ps])
            .output()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

/// Move the mouse and left-click at absolute screen coordinates.
#[tauri::command]
fn mouse_click(x: i32, y: i32) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdotool")
            .args(["mousemove", &x.to_string(), &y.to_string()])
            .output();
        std::thread::sleep(std::time::Duration::from_millis(80));
        std::process::Command::new("xdotool")
            .args(["click", "1"])
            .output()
            .map(|_| ())
            .map_err(|e| format!("xdotool error: {e}"))
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!(r#"tell application "System Events" to click at {{{x}, {y}}}"#);
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let ps = format!(
            r#"Add-Type -Name W -Namespace "" -Member @"
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int c,int e);
"@; [W]::SetCursorPos({x},{y}); [W]::mouse_event(2,0,0,0,0); [W]::mouse_event(4,0,0,0,0)"#
        );
        std::process::Command::new("powershell")
            .args(["-Command", &ps])
            .output()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
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
#[tauri::command]
fn focus_window(name: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdotool")
            .args(["search", "--name", &name, "windowactivate", "--sync"])
            .output()
            .map(|_| ())
            .map_err(|e| format!("xdotool not found — install: sudo dnf install xdotool. Error: {e}"))
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

/// Send a key or key combination (e.g. "ctrl+l", "Return", "Tab").
#[tauri::command]
fn press_key(keys: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdotool")
            .args(["key", "--clearmodifiers", &keys])
            .output()
            .map(|_| ())
            .map_err(|e| format!("xdotool not found — install: sudo dnf install xdotool. Error: {e}"))
    }
    #[cfg(target_os = "macos")]
    {
        // Map common keys to osascript key codes
        let script = match keys.to_lowercase().as_str() {
            "return" | "enter" => r#"tell application "System Events" to key code 36"#.to_string(),
            "tab" => r#"tell application "System Events" to key code 48"#.to_string(),
            "ctrl+l" => r#"tell application "System Events" to keystroke "l" using {command down}"#.to_string(),
            _ => return Err(format!("Unsupported key on macOS: {keys}")),
        };
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let wsh_key = match keys.to_lowercase().as_str() {
            "return" | "enter" => "{ENTER}".to_string(),
            "tab" => "{TAB}".to_string(),
            "ctrl+l" => "^l".to_string(),
            _ => keys.clone(),
        };
        let ps = format!(r#"(New-Object -ComObject WScript.Shell).SendKeys("{wsh_key}")"#);
        std::process::Command::new("powershell")
            .args(["-Command", &ps])
            .output()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
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
        .invoke_handler(tauri::generate_handler![
            open_url,
            open_application,
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
