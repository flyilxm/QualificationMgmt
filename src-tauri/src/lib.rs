use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub absolute_path: String,
    pub relative_path: String,
    pub name: String,
    pub modified_ms: i64,
    pub size: u64,
    pub kind: String,
}

fn is_image_ext(ext: &str) -> bool {
    matches!(
        ext,
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "ico" | "tif" | "tiff"
    )
}

fn is_pdf_ext(ext: &str) -> bool {
    ext == "pdf"
}

fn classify_kind(ext: &str) -> Option<&'static str> {
    let e = ext.to_ascii_lowercase();
    if is_image_ext(&e) {
        Some("image")
    } else if is_pdf_ext(&e) {
        Some("pdf")
    } else {
        None
    }
}

#[tauri::command]
fn scan_directory(root: String) -> Result<Vec<FileMeta>, String> {
    let root_path = PathBuf::from(&root);
    let root_canon = fs::canonicalize(&root_path).map_err(|e| e.to_string())?;
    if !root_canon.is_dir() {
        return Err("路径不是目录".into());
    }
    let mut out = Vec::new();
    for entry in WalkDir::new(&root_canon).follow_links(false).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let Some(ext_os) = path.extension().and_then(|x| x.to_str()) else {
            continue;
        };
        let Some(kind) = classify_kind(ext_os) else {
            continue;
        };

        let meta = fs::metadata(path).map_err(|e| e.to_string())?;
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let absolute_path = path.to_string_lossy().to_string();
        let rel = path
            .strip_prefix(&root_canon)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.file_name().unwrap_or_default().to_string_lossy().to_string());

        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        out.push(FileMeta {
            absolute_path,
            relative_path: rel.replace('\\', "/"),
            name,
            modified_ms,
            size: meta.len(),
            kind: kind.to_string(),
        });
    }

    out.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(out)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppendChunkPayload {
    path: String,
    chunk_base64: String,
    is_first: bool,
}

/// 分块写入二进制文件（首块覆盖创建，后续追加），避免单次 IPC 传整包 zip 过大失败。
#[tauri::command]
fn save_binary_append(payload: AppendChunkPayload) -> Result<(), String> {
    let p = Path::new(&payload.path);
    if !p.is_absolute() {
        return Err("必须使用绝对路径".into());
    }
    let bytes = STANDARD
        .decode(payload.chunk_base64.trim())
        .map_err(|e| format!("Base64 解码失败: {e}"))?;
    if payload.is_first {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(p, &bytes).map_err(|e| e.to_string())?;
    } else {
        let mut f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(p)
            .map_err(|e| e.to_string())?;
        f.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            #[cfg(all(
                debug_assertions,
                not(any(target_os = "android", target_os = "ios"))
            ))]
            {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(not(all(
                debug_assertions,
                not(any(target_os = "android", target_os = "ios"))
            )))]
            {
                let _ = app;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![scan_directory, save_binary_append])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
