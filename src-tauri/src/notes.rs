// notes.rs — Ideas rápidas (mobile).
//
// Empezó como notas de texto sueltas sin categorías ni dibujos (ver
// historial de este archivo). El usuario pidió sumarle categorías propias
// y poder meter un dibujo simple en cualquier punto de una idea -- para lo
// segundo, una nota deja de ser un `text: String` plano y pasa a ser una
// lista de "bloques" ordenada (texto o dibujo, ver Block) que el frontend
// renderiza en secuencia; eso es lo que permite intercalar un dibujo entre
// dos párrafos de texto en vez de que el dibujo sea siempre "al final".
//
// Se guardan como arrays JSON en app_data_dir, mismo patrón que el resto
// de la app -- notes.json para las notas, note_categories.json para las
// categorías. Los dibujos se guardan como data URL (PNG en base64) DENTRO
// del bloque, no como archivo aparte: son trazos simples de un canvas
// chico, no fotos, así que el tamaño no justifica la complejidad extra de
// manejar archivos sueltos + limpieza de huérfanos.
//
// MIGRACIÓN: las notas guardadas antes de esta versión tienen
// `{"id","text","createdAt","updatedAt"}` (sin "blocks" ni "categoryId").
// read_all() migra esas al vuelo a `{"blocks":[{"type":"text","value":text}],
// "categoryId":null}` la primera vez que se leen -- así el usuario no
// pierde ninguna idea guardada por este cambio.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum Block {
    #[serde(rename = "text")]
    Text { value: String },
    #[serde(rename = "drawing")]
    Drawing { data_url: String },
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    #[serde(default)]
    pub blocks: Vec<Block>,
    #[serde(default)]
    pub category_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

fn notes_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("notes.json"))
}

/// Migra un valor JSON crudo de nota vieja (`text: String`) al formato
/// nuevo (`blocks: Vec<Block>`) antes de deserializar de verdad -- así
/// serde nunca ve el formato viejo y no hace falta un enum "V1 | V2".
fn migrate_note_value(mut v: serde_json::Value) -> serde_json::Value {
    if v.get("blocks").is_none() {
        if let Some(text) = v.get("text").and_then(|t| t.as_str()).map(|s| s.to_string()) {
            v["blocks"] = serde_json::json!([{ "type": "text", "value": text }]);
        }
    }
    v
}

fn read_all(app: &AppHandle) -> Result<Vec<Note>, String> {
    let path = notes_path(app)?;
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|_| "[]".to_string());
    let values: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap_or_default();
    Ok(values
        .into_iter()
        .filter_map(|v| serde_json::from_value(migrate_note_value(v)).ok())
        .collect())
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

// NUEVO: id local simple sin dependencia extra (uuid) -- alcanza con no
// colisionar entre elementos creados en el mismo milisegundo: timestamp +
// contador atómico del proceso.
fn rand_u16() -> u16 {
    static COUNTER: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(0);
    COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
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
pub fn notes_save(app: AppHandle, id: Option<String>, blocks: Vec<Block>, category_id: Option<String>) -> Result<Note, String> {
    let mut notes = read_all(&app)?;
    let now = now_millis();
    let note = if let Some(id) = id.filter(|id| !id.is_empty()) {
        if let Some(existing) = notes.iter_mut().find(|n| n.id == id) {
            existing.blocks = blocks;
            existing.category_id = category_id;
            existing.updated_at = now;
            existing.clone()
        } else {
            // El id no existe (¿se borró en otro lado?) -- se crea de nuevo
            // en vez de fallar la escritura.
            let n = Note { id, blocks, category_id, created_at: now, updated_at: now };
            notes.push(n.clone());
            n
        }
    } else {
        let n = Note {
            id: format!("{now:x}-{:04x}", rand_u16()),
            blocks,
            category_id,
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

// ══════════════════════════════════════════════════════════════════════════
//  CATEGORÍAS -- propias del usuario (nombre + color elegido de una
//  paleta chica en el frontend), sin límite de cantidad ni jerarquía.
// ══════════════════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteCategory {
    pub id: String,
    pub name: String,
    pub color: String,
}

fn categories_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("note_categories.json"))
}

fn read_categories(app: &AppHandle) -> Result<Vec<NoteCategory>, String> {
    let path = categories_path(app)?;
    Ok(std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
}

fn write_categories(app: &AppHandle, cats: &[NoteCategory]) -> Result<(), String> {
    let path = categories_path(app)?;
    let s = serde_json::to_string_pretty(cats).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn notes_categories_list(app: AppHandle) -> Result<Vec<NoteCategory>, String> {
    read_categories(&app)
}

#[tauri::command]
pub fn notes_categories_save(app: AppHandle, name: String, color: String) -> Result<NoteCategory, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("El nombre de la categoría no puede estar vacío.".to_string());
    }
    let mut cats = read_categories(&app)?;
    if cats.iter().any(|c| c.name.eq_ignore_ascii_case(&name)) {
        return Err("Ya existe una categoría con ese nombre.".to_string());
    }
    let cat = NoteCategory { id: format!("{:x}-{:04x}", now_millis(), rand_u16()), name, color };
    cats.push(cat.clone());
    write_categories(&app, &cats)?;
    Ok(cat)
}

/// Borra una categoría y desasigna (no borra) las notas que la tenían --
/// perder la etiqueta de una idea es recuperable, perder la idea en sí no.
#[tauri::command]
pub fn notes_categories_delete(app: AppHandle, id: String) -> Result<(), String> {
    let mut cats = read_categories(&app)?;
    cats.retain(|c| c.id != id);
    write_categories(&app, &cats)?;

    let mut notes = read_all(&app)?;
    let mut changed = false;
    for n in notes.iter_mut() {
        if n.category_id.as_deref() == Some(id.as_str()) {
            n.category_id = None;
            changed = true;
        }
    }
    if changed {
        write_all(&app, &notes)?;
    }
    Ok(())
}
