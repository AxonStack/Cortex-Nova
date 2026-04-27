// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKit on Linux/Wayland aborts when the EGL display can't be created via
    // DMA-buf (common on Fedora/NVIDIA/some Mesa drivers). Set before Tauri
    // initialises WebKit so the renderer falls back to a safe software path.
    #[cfg(target_os = "linux")]
    {
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            // SAFETY: single-threaded at this point, before any WebKit init.
            unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
        }
    }

    nova_lib::run()
}
