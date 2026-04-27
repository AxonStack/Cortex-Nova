// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKit on Linux/Wayland aborts when the EGL display can't be created via
    // DMA-buf (common on Fedora/NVIDIA/some Mesa drivers). Set before Tauri
    // initialises WebKit so the renderer falls back to a safe software path.
    // On Fedora/Wayland WebKit2GTK renders a black window when using native
    // Wayland EGL. Three env vars together fix it:
    //   GDK_BACKEND=x11          — force GTK/WebKit through XWayland (X11)
    //   WEBKIT_DISABLE_DMABUF_RENDERER=1 — prevent EGL_BAD_PARAMETER abort
    //   WEBKIT_FORCE_SANDBOX=0   — prevent SELinux/seccomp blocking the renderer
    // All are set only when not already overridden by the user's environment.
    #[cfg(target_os = "linux")]
    {
        // SAFETY: single-threaded here, before Tauri/WebKit initialise.
        unsafe {
            if std::env::var("GDK_BACKEND").is_err() {
                std::env::set_var("GDK_BACKEND", "x11");
            }
            if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
     
            }
            if std::env::var("WEBKIT_FORCE_SANDBOX").is_err() {
                std::env::set_var("WEBKIT_FORCE_SANDBOX", "0");
            }
        }
    }

    nova_lib::run()
}
