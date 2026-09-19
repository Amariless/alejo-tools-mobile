// favorites.rs — Favoritos del Hub elegidos por el usuario.
//
// Hasta ahora la sección "Favoritos" del Hub era SOLO las herramientas con
// "persistent": true en su tool.json (Reloj, Sincronización) -- fijo, sin
// forma de que el usuario sumara otra. Esto agrega una lista de ids
// (tool.id, la carpeta de cada herramienta) que el usuario marca a mano
// desde una estrella en cada tarjeta del Hub; main.js arma la sección
// Favoritos como la unión de las persistentes + esta lista.
//
// Mismo patrón de JSON en app_data_dir + escritura atómica que
// notes.rs/expenses.rs.
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn favorites_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("favorites.json"))
}

fn read_all(app: &AppHandle) -> Result<Vec<String>, String> {
    let path = favorites_path(app)?;
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    serde_json::from_str(&raw).map_err(|e| format!("favorites.json corrupto: {e}"))
}

fn write_all(app: &AppHandle, ids: &[String]) -> Result<(), String> {
    let path = favorites_path(app)?;
    let s = serde_json::to_string_pretty(ids).map_err(|e| e.to_string())?;
    let tmp_path = PathBuf::from(format!("{}.tmp", path.to_string_lossy()));
    std::fs::write(&tmp_path, s).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn favorites_list(app: AppHandle) -> Result<Vec<String>, String> {
    read_all(&app)
}

#[tauri::command]
pub fn favorites_set(app: AppHandle, id: String, value: bool) -> Result<(), String> {
    let mut ids = read_all(&app)?;
    let already = ids.iter().any(|x| x == &id);
    if value && !already {
        ids.push(id);
    } else if !value && already {
        ids.retain(|x| x != &id);
    } else {
        return Ok(()); // ya estaba en el estado pedido, no hace falta escribir
    }
    write_all(&app, &ids)
}
