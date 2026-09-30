//! `terminal` commands. Stubs until M9 Wave 1.
use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn terminal_open(
    app: tauri::AppHandle,
    terminals: tauri::State<'_, crate::terminal::Terminals>,
    request: TerminalOpenRequest,
) -> AppResult<String> {
    let _ = (&app, &terminals, &request);
    Err(AppError::not_implemented("terminal_open"))
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_write(
    terminals: tauri::State<'_, crate::terminal::Terminals>,
    id: String,
    data: String,
) -> AppResult<()> {
    let _ = (&terminals, &id, &data);
    Err(AppError::not_implemented("terminal_write"))
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_resize(
    terminals: tauri::State<'_, crate::terminal::Terminals>,
    id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    let _ = (&terminals, &id, &cols, &rows);
    Err(AppError::not_implemented("terminal_resize"))
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_close(
    terminals: tauri::State<'_, crate::terminal::Terminals>,
    id: String,
) -> AppResult<()> {
    let _ = (&terminals, &id);
    Err(AppError::not_implemented("terminal_close"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::error::ErrorKind;
    use tauri::Manager;

    #[test]
    fn stubs_are_not_implemented() {
        let app = tauri::test::mock_app();
        app.manage(crate::terminal::Terminals::default());
        let t = || app.state::<crate::terminal::Terminals>();
        let kind = |e: AppError| e.kind;
        tauri::async_runtime::block_on(async {
            assert_eq!(
                kind(
                    terminal_write(t(), "x".into(), "y".into())
                        .await
                        .unwrap_err()
                ),
                ErrorKind::NotImplemented
            );
            assert_eq!(
                kind(terminal_resize(t(), "x".into(), 1, 1).await.unwrap_err()),
                ErrorKind::NotImplemented
            );
            assert_eq!(
                kind(terminal_close(t(), "x".into()).await.unwrap_err()),
                ErrorKind::NotImplemented
            );
        });
    }
}
