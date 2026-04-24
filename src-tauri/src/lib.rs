use std::io::{ErrorKind, Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::{Duration, Instant};

// ── Managed state for OAuth redirect server ───────────────────────────────────

struct OAuthServer(Mutex<Option<TcpListener>>);

// ── Helpers ───────────────────────────────────────────────────────────────────

fn extended_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let current = std::env::var("PATH").unwrap_or_default();
    format!("{home}/.npm/bin:{home}/.local/bin:/usr/local/bin:/usr/bin:/bin:{current}")
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

/// Returns false on Linux WebKitGTK which doesn't implement the Web Speech API.
#[tauri::command]
fn speech_api_supported() -> bool {
    cfg!(not(target_os = "linux"))
}

/// Check whether a CLI tool is on the PATH.
#[tauri::command]
fn check_cli_available(cli: String) -> bool {
    let path = extended_path();
    #[cfg(target_os = "windows")]
    let which = "where";
    #[cfg(not(target_os = "windows"))]
    let which = "which";
    std::process::Command::new(which)
        .arg(&cli)
        .env("PATH", &path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Run a CLI AI tool and return its text response.
#[tauri::command]
fn ask_via_cli(cli: String, prompt: String) -> Result<String, String> {
    let path = extended_path();
    let output = match cli.as_str() {
        "claude" => std::process::Command::new("claude")
            .args(["--print", &prompt])
            .env("PATH", &path)
            .output()
            .map_err(|e| format!("claude not found. Install: npm i -g @anthropic-ai/claude-code\nError: {e}"))?,
        "codex" => std::process::Command::new("codex")
            .args(["--quiet", "--approval-policy=auto", &prompt])
            .env("PATH", &path)
            .output()
            .map_err(|e| format!("codex not found. Install: npm i -g @openai/codex\nError: {e}"))?,
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_url,
            type_text,
            mouse_click,
            speech_api_supported,
            check_cli_available,
            ask_via_cli,
            start_oauth_server,
            collect_oauth_callback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
