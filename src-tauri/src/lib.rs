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

/// Type text into the currently focused application on the host OS.
/// Linux: requires xdotool. macOS: uses osascript. Windows: uses PowerShell.
#[tauri::command]
fn type_text(text: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdotool")
            .args(["type", "--clearmodifiers", "--delay", "20", "--", &text])
            .output()
            .map(|_| ())
            .map_err(|e| format!("xdotool not found — install it: sudo apt install xdotool. Error: {e}"))
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
        let ps = format!(
            r#"$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys("{safe}")"#
        );
        std::process::Command::new("powershell")
            .args(["-Command", &ps])
            .output()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

/// Move the mouse to absolute screen coordinates and left-click.
/// Linux: requires xdotool. macOS: uses cliclick if available.
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
        let script = format!(
            r#"tell application "System Events" to click at {{{x}, {y}}}"#
        );
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

/// Check whether the Web Speech API is likely available in this WebView.
/// Returns false on Linux WebKitGTK (which does not implement it).
#[tauri::command]
fn speech_api_supported() -> bool {
    cfg!(not(target_os = "linux"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_url,
            type_text,
            mouse_click,
            speech_api_supported
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
