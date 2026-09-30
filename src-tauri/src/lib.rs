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
        .manage(git::GitState::default())
        .manage(terminal::Terminals::default())
        .manage(avatars::AvatarCache::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            #[cfg(embedded_git)]
            {
                use tauri::Manager;
                let dir = app.path().app_data_dir()?;
                mobile::init(&dir)?;
            }
            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running gittrunk");
}
