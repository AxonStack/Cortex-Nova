// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKit on Linux/Wayland aborts when the EGL display can't be created via
    // DMA-buf (common on Fedora/NVIDIA/some Mesa drivers). Set before Tauri
    // initialises WebKit so the renderer falls back to a safe software path.
    // On Linux/Wayland two WebKit flags are needed to prevent a black window:
    // 1. WEBKIT_DISABLE_DMABUF_RENDERER — stops the EGL_BAD_PARAMETER abort
    // 2. WEBKIT_DISABLE_COMPOSITING_MODE — stops GPU compositing that silently
    //    produces a blank (all-black) content area even after EGL init succeeds
    #[cfg(target_os = "linux")]
    {
        // SAFETY: single-threaded here, before Tauri/WebKit initialise.
        unsafe {
            if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
            if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
                std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
            }
        }
    }

    nova_lib::run()
}
