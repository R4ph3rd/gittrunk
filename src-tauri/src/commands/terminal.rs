//! `terminal` commands: PTY sessions streamed to the webview.
use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[cfg(not(target_os = "android"))]
fn join_err(e: tauri::Error) -> AppError {
    AppError::new(crate::ipc::error::ErrorKind::Internal, e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_open(
    app: tauri::AppHandle,
    terminals: tauri::State<'_, crate::terminal::Terminals>,
    request: TerminalOpenRequest,
) -> AppResult<String> {
    #[cfg(target_os = "android")]
    {
        let _ = (&app, &terminals, &request);
        Err(AppError::unsupported("The terminal"))
    }
    #[cfg(not(target_os = "android"))]
    {
        use crate::terminal::TermEvent;
        use tauri_specta::Event;
        let emit: crate::terminal::EmitFn = std::sync::Arc::new(move |ev| {
            let _ = match ev {
                TermEvent::Output { id, data } => TerminalOutput { id, data }.emit(&app),
                TermEvent::Exit { id, code } => TerminalExit { id, code }.emit(&app),
            };
        });
        let t = terminals.handle();
        tauri::async_runtime::spawn_blocking(move || {
            t.open(&request.cwd, request.cols, request.rows, emit)
        })
        .await
        .map_err(join_err)?
    }
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_write(
    terminals: tauri::State<'_, crate::terminal::Terminals>,
    id: String,
    data: String,
) -> AppResult<()> {
    #[cfg(target_os = "android")]
    {
        let _ = (&terminals, &id, &data);
        Err(AppError::unsupported("The terminal"))
    }
    #[cfg(not(target_os = "android"))]
    {
        let t = terminals.handle();
        tauri::async_runtime::spawn_blocking(move || t.write(&id, &data))
            .await
            .map_err(join_err)?
    }
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_resize(
    terminals: tauri::State<'_, crate::terminal::Terminals>,
    id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    #[cfg(target_os = "android")]
    {
        let _ = (&terminals, &id, &cols, &rows);
        Err(AppError::unsupported("The terminal"))
    }
    #[cfg(not(target_os = "android"))]
    {
        terminals.resize(&id, cols, rows)
    }
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_close(
    terminals: tauri::State<'_, crate::terminal::Terminals>,
    id: String,
) -> AppResult<()> {
    #[cfg(target_os = "android")]
    {
        let _ = (&terminals, &id);
        Err(AppError::unsupported("The terminal"))
    }
    #[cfg(not(target_os = "android"))]
    {
        let t = terminals.handle();
        tauri::async_runtime::spawn_blocking(move || t.close(&id))
            .await
            .map_err(join_err)
    }
}

#[cfg(all(test, not(target_os = "android")))]
mod tests {
    use super::*;
    use crate::ipc::error::ErrorKind;
    use tauri::Manager;

    #[test]
    fn unknown_ids() {
        let app = tauri::test::mock_app();
        app.manage(crate::terminal::Terminals::default());
        let t = || app.state::<crate::terminal::Terminals>();
        tauri::async_runtime::block_on(async {
            let e = terminal_write(t(), "x".into(), "y".into())
                .await
                .unwrap_err();
            assert_eq!(e.kind, ErrorKind::InvalidInput);
            let e = terminal_resize(t(), "x".into(), 1, 1).await.unwrap_err();
            assert_eq!(e.kind, ErrorKind::InvalidInput);
            assert!(terminal_close(t(), "x".into()).await.is_ok());
        });
    }
}
