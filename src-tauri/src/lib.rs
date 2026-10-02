//! gittrunk backend.

pub mod ai;
pub mod askpass;
pub mod avatars;
pub mod commands;
pub mod forge;
pub mod git;
pub mod http;
pub mod ipc;
#[cfg(embedded_git)]
pub mod mobile;
pub mod platform;
pub mod secrets;
pub mod settings;
#[cfg(not(target_os = "android"))]
pub mod ssh;
pub mod terminal;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = ipc::builder();

    // Keep bindings fresh during `tauri dev`. Skipped when the source tree is
    // absent (e.g. a debug binary copied elsewhere) instead of panicking.
    #[cfg(all(debug_assertions, not(mobile)))]
    if std::path::Path::new(ipc::BINDINGS_PATH)
        .parent()
        .is_some_and(|dir| dir.exists())
    {
        ipc::export_bindings(&builder, ipc::BINDINGS_PATH);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .manage(git::GitState::default())
        .manage(terminal::Terminals::default())
        .manage(avatars::AvatarCache::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            #[cfg(embedded_git)]
            {
                use tauri::Manager;
                // A failed bootstrap must not kill the app before the UI
                // shows: log it (logcat RustStdoutStderr) and keep going so
                // read-only browsing still works.
                match app.path().app_data_dir() {
                    Ok(dir) => {
                        if let Err(e) = mobile::init(&dir) {
                            eprintln!("gittrunk: mobile init failed: {e}");
                        }
                    }
                    Err(e) => eprintln!("gittrunk: no app data dir: {e}"),
                }
            }
            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running gittrunk");
}
