// notes.rs — Ideas rápidas (mobile).
//
// Notas de texto sueltas, sin carpetas ni categorías -- a propósito simple
// (el pedido del usuario fue "ideas rápidas", no un gestor de notas
// completo). Se guardan como un array JSON en app_data_dir, mismo patrón
// que el resto de la app (ver syncthing.rs/pomodoro.rs) en vez de
// localStorage del WebView -- así quedan en el mismo lugar que el resto de
// los datos de la app si alguna vez se agrega un "exportar/backup".
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub text: String,
    pub created_at: i64,
    pub updated_at: i64,
}

fn notes_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("notes.json"))
}

fn read_all(app: &AppHandle) -> Result<Vec<Note>, String> {
    let path = notes_path(app)?;
    Ok(std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default())
}

fn write_all(app: &AppHandle, notes: &[Note]) -> Result<(), String> {
    let path = notes_path(app)?;
    let s = serde_json::to_string_pretty(notes).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| e.to_string())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn notes_list(app: AppHandle) -> Result<Vec<Note>, String> {
    let mut notes = read_all(&app)?;
    // Más recientes primero -- lo que se acaba de anotar es lo más probable
    // que el usuario quiera ver/editar de nuevo.
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(notes)
}

#[tauri::command]
pub fn notes_save(app: AppHandle, id: Option<String>, text: String) -> Result<Note, String> {
    let mut notes = read_all(&app)?;
    let now = now_millis();
    let note = if let Some(id) = id.filter(|id| !id.is_empty()) {
        if let Some(existing) = notes.iter_mut().find(|n| n.id == id) {
            existing.text = text;
            existing.updated_at = now;
            existing.clone()
        } else {
            // El id no existe (¿se borró en otro lado?) -- se crea de nuevo
            // en vez de fallar la escritura.
            let n = Note { id, text, created_at: now, updated_at: now };
            notes.push(n.clone());
            n
        }
    } else {
        let n = Note {
            id: format!("{now:x}-{:04x}", rand_u16()),
            text,
            created_at: now,
            updated_at: now,
        };
        notes.push(n.clone());
        n
    };
    write_all(&app, &notes)?;
    Ok(note)
}

#[tauri::command]
pub fn notes_delete(app: AppHandle, id: String) -> Result<(), String> {
    let mut notes = read_all(&app)?;
    notes.retain(|n| n.id != id);
    write_all(&app, &notes)
}

// NUEVO: id local simple sin dependencia extra (uuid) -- alcanza con no
// colisionar entre notas creadas en el mismo milisegundo: timestamp +
// contador atómico del proceso (no necesita ser aleatorio, solo distinto
// entre dos llamadas seguidas, y un contador in-process lo garantiza sin
// las dudas de "¿esta dirección de stack realmente cambia?" de un pseudo-
// random hecho a mano).
fn rand_u16() -> u16 {
    static COUNTER: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(0);
    COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}
