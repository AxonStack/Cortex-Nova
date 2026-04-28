// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Force WebKit off the native Wayland renderer before GTK initialises.
    // Set unconditionally — a .desktop launcher may already export GDK_BACKEND=wayland,
    // which the previous is_err() guard silently left in place causing a black window.
    #[cfg(target_os = "linux")]
    {
        // SAFETY: single-threaded here, before Tauri/WebKit/GTK initialise.
        // Force all vars unconditionally — a Wayland .desktop launcher may have
        // already set GDK_BACKEND=wayland, which our previous is_err() guard
        // left untouched and allowed WebKit's native Wayland renderer to produce
        // a black window on Fedora/NVIDIA/some Mesa drivers.
        unsafe {
            // Force GTK through XWayland (X11 backend); avoids native Wayland
            // WebKitGTK renderer which silently renders a black canvas on many systems.
            std::env::set_var("GDK_BACKEND", "x11");
            // Disable DMA-buf zero-copy buffer sharing (causes EGL_BAD_PARAMETER crashes).
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            // Disable WebKit accelerated compositing entirely (deeper than the API policy).
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
            // Prevent SELinux/seccomp from blocking the WebKit GPU process.
            std::env::set_var("WEBKIT_FORCE_SANDBOX", "0");
        }
    }

    nova_lib::run()
}
