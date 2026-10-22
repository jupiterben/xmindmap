use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Mind-map files passed by the shell before the webview is ready, drained by the frontend.
struct PendingFiles(Mutex<Vec<String>>);

fn write_all(path: &str, data: &[u8]) -> Result<(), String> {
    std::fs::write(path, data).map_err(|error| format!("写入失败：{error}"))
}

fn collect_document_paths(args: &[String]) -> Vec<String> {
    args.iter()
        .filter(|arg| !arg.starts_with('-'))
        .filter(|arg| {
            let extension = std::path::Path::new(arg)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            matches!(extension.as_str(), "xmm" | "smm" | "json")
        })
        .filter(|arg| std::path::Path::new(arg).is_file())
        .map(|arg| arg.to_string())
        .collect()
}

fn push_pending(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    app.state::<PendingFiles>()
        .0
        .lock()
        .expect("pending file lock")
        .extend(paths);
}

#[tauri::command]
fn take_pending_files(state: tauri::State<'_, PendingFiles>) -> Vec<String> {
    let mut pending = state.0.lock().expect("pending file lock");
    std::mem::take(&mut *pending)
}

#[tauri::command]
fn write_text(path: String, text: String) -> Result<(), String> {
    write_all(&path, text.as_bytes())
}

#[tauri::command]
fn write_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    write_all(&path, &data)
}

#[tauri::command]
fn write_data_url(path: String, data_url: String) -> Result<(), String> {
    let payload = data_url
        .split_once(',')
        .map(|(_, content)| content)
        .unwrap_or(data_url.as_str());
    let bytes = STANDARD
        .decode(payload.trim())
        .map_err(|error| format!("图片数据无效：{error}"))?;
    write_all(&path, &bytes)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|error| format!("读取失败：{error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Registered first so a second launch forwards its arguments instead of booting another app.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            push_pending(app, collect_document_paths(&argv[1..]));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            let _ = app.emit("open-file", ());
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingFiles(Mutex::new(Vec::new())))
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            push_pending(app.handle(), collect_document_paths(args.get(1..).unwrap_or(&[])));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            write_text,
            write_bytes,
            write_data_url,
            read_text_file,
            take_pending_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
