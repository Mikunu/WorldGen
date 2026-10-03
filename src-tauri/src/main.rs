#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
};
use tauri_plugin_dialog::DialogExt;

const PROJECT_LIMIT: usize = 100 * 1024 * 1024;
const RULES_LIMIT: usize = 100_000;

fn decode_document(kind: &str, content: &str) -> Result<Vec<u8>, String> {
    match kind {
        "json" => {
            if content.len() > PROJECT_LIMIT {
                return Err("Файл превышает 100 МБ".into());
            }
            serde_json::from_str::<serde_json::Value>(content)
                .map_err(|e| format!("Некорректный JSON: {e}"))?;
            Ok(content.as_bytes().to_vec())
        }
        "png" => {
            if content.len() > 16 * 1024 * 1024 {
                return Err("Изображение слишком велико".into());
            }
            let bytes = STANDARD.decode(content).map_err(|e| e.to_string())?;
            if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                return Err("Некорректный PNG".into());
            }
            Ok(bytes)
        }
        _ => Err("Неподдерживаемый тип файла".into()),
    }
}

fn suggested_name(name: &str, extension: &str) -> String {
    let clean: String = name
        .chars()
        .take(150)
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let stem = clean
        .strip_suffix(&format!(".{extension}"))
        .unwrap_or(&clean)
        .trim_matches([' ', '.']);
    format!(
        "{}.{}",
        if stem.is_empty() { "worldgen" } else { stem },
        extension
    )
}

fn write_document(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Не найдена папка назначения")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary.write_all(bytes).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

fn read_document(path: &Path, limit: usize) -> Result<String, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        return Err("Выбранный файл слишком велик".into());
    }
    String::from_utf8(bytes).map_err(|e| format!("Требуется файл в UTF-8: {e}"))
}

// No command accepts a filesystem path from JavaScript.
#[tauri::command]
async fn save_document(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    name: String,
    kind: String,
    content: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = decode_document(&kind, &content)?;
        let title = if kind == "png" {
            "Сохранить карту PNG"
        } else {
            "Сохранить JSON"
        };
        let picked = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title(title)
            .set_file_name(suggested_name(&name, &kind))
            .add_filter(
                if kind == "png" {
                    "Карта PNG"
                } else {
                    "Проект / данные JSON"
                },
                &[kind.as_str()],
            )
            .blocking_save_file();
        let Some(picked) = picked else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        write_document(&path, &bytes)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_document(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    kind: String,
) -> Result<Option<String>, String> {
    let (title, limit) = match kind.as_str() {
        "project" => ("Открыть проект WorldGen", PROJECT_LIMIT),
        "rules" => ("Открыть шаблон правил", RULES_LIMIT),
        _ => return Err("Неподдерживаемый тип файла".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title(title)
            .add_filter("WorldGen JSON", &["json"])
            .blocking_pick_file();
        let Some(picked) = picked else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        read_document(&path, limit).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_document, open_document])
        .run(tauri::generate_context!())
        .expect("Не удалось запустить WorldGen");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_json_and_png_payloads() {
        assert_eq!(
            decode_document("json", "{\"seed\":\"Эмбер\"}").unwrap(),
            "{\"seed\":\"Эмбер\"}".as_bytes()
        );
        assert!(decode_document("json", "broken").is_err());
        assert!(decode_document("exe", "{}").is_err());
        assert!(decode_document("png", &STANDARD.encode(b"not png")).is_err());
        assert!(decode_document("png", &STANDARD.encode(b"\x89PNG\r\n\x1a\nrest")).is_ok());
    }

    #[test]
    fn suggested_name_is_a_filename() {
        assert_eq!(
            suggested_name("../../Эмбер:1.json", "json"),
            "_.._Эмбер_1.json"
        );
        assert_eq!(suggested_name("", "png"), "worldgen.png");
    }

    #[test]
    fn file_roundtrip_overwrites_atomically_and_enforces_limits() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.json");
        write_document(&path, b"{\"seed\":1}").unwrap();
        write_document(&path, b"{\"seed\":2}").unwrap();
        assert_eq!(read_document(&path, 100).unwrap(), "{\"seed\":2}");
        assert!(read_document(&path, 2).is_err());
        write_document(&path, &[0xff]).unwrap();
        assert!(read_document(&path, 100).is_err());
    }
}
