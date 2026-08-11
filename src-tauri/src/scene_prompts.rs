// scene_prompts.rs — persistencia de "Guardados" para Generador de Escenas
// (mobile).
//
// A diferencia de notes.rs/expenses.rs, acá no hace falta que Rust sepa
// nada de la forma de una escena (título, tags, paleta, etc.) -- son
// blobs JSON opacos que arma y entiende el propio engine.js. Se persiste
// el array completo cada vez que cambia (agregar/borrar/reordenar) en vez
// de comandos granulares por operación -- el volumen de datos es chico
// (prompts guardados a mano por el usuario) y esto evita duplicar en Rust
// la lógica de "encontrar por id" que ya vive en el JS.
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn saved_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("scene_saved_prompts.json"))
}

#[tauri::command]
pub fn scene_prompts_list(app: AppHandle) -> Vec<Value> {
    let Ok(path) = saved_path(&app) else { return Vec::new() };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn scene_prompts_save_all(app: AppHandle, items: Vec<Value>) -> Result<(), String> {
    let path = saved_path(&app)?;
    let s = serde_json::to_string_pretty(&items).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| e.to_string())
}
