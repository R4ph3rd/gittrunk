//! gittrunk backend.

pub mod commands;
pub mod git;
pub mod ipc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = ipc::builder();

    #[cfg(debug_assertions)]
    ipc::export_bindings(&builder, ipc::BINDINGS_PATH);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(git::GitState::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running gittrunk");
}
