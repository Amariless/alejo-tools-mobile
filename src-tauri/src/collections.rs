// collections.rs — "Colecciones" de Creador de Texturas (pedido del
// usuario): agrupar los sets de texturas generados bajo un nombre propio
// + categoría (madera, cemento, plástico...), en vez de que todo caiga
// suelto en la carpeta general de texturas.
//
// Cada colección es una CARPETA de verdad dentro de textures_dir() (ver
// textures.rs), nombrada como el nombre de la colección saneado --
// renombrar la colección renombra la carpeta (fs::rename, no copia+borra:
// instantáneo aunque la carpeta tenga varios archivos). El registro en sí
// (id, nombre, categoría, fechas) vive aparte en collections.json --
// necesario porque el nombre visible puede tener caracteres que no son
// válidos en un nombre de carpeta (se sanean con sanitize_folder_name),
// así que "nombre de la colección" y "nombre de la carpeta" no son
// siempre el mismo string.
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// Mismo criterio que INVALID_FS_CHARS de downloader.rs -- el storage de
// Android es permisivo (ext4/F2FS) pero evitamos igual '/' (rompe la
// ruta) y el resto de los símbolos problemáticos de Windows, por si el
// usuario sincroniza esta carpeta hacia su PC con SyncManager.
static INVALID_FS_CHARS: Lazy<Regex> = Lazy::new(|| Regex::new(r#"[<>:"/\\|?*\x00-\x1f]"#).unwrap());

fn sanitize_folder_name(name: &str) -> String {
    let s = INVALID_FS_CHARS.replace_all(name.trim(), "").trim().to_string();
    if s.is_empty() { "coleccion".to_string() } else { s }
}

fn now_millis() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn rand_u16() -> u16 {
    static COUNTER: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(0);
    COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub category: String,
    pub created_at: i64,
    pub updated_at: i64,
}

fn collections_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("collections.json"))
}

fn read_all(app: &AppHandle) -> Vec<Collection> {
    let Ok(path) = collections_path(app) else { return Vec::new() };
    std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn write_all(app: &AppHandle, items: &[Collection]) -> Result<(), String> {
    let path = collections_path(app)?;
    let s = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| e.to_string())
}

fn collection_dir(c: &Collection) -> PathBuf {
    crate::textures::textures_dir().join(sanitize_folder_name(&c.name))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionInfo {
    pub id: String,
    pub name: String,
    pub category: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub image_count: usize,
}

fn to_info(c: &Collection) -> CollectionInfo {
    let dir = collection_dir(c);
    let image_count = std::fs::read_dir(&dir)
        .map(|rd| rd.filter_map(|e| e.ok()).filter(|e| e.path().is_file()).count())
        .unwrap_or(0);
    CollectionInfo {
        id: c.id.clone(),
        name: c.name.clone(),
        category: c.category.clone(),
        created_at: c.created_at,
        updated_at: c.updated_at,
        image_count,
    }
}

#[tauri::command]
pub fn collections_list(app: AppHandle) -> Vec<CollectionInfo> {
    let mut items = read_all(&app);
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    items.iter().map(to_info).collect()
}

#[tauri::command]
pub fn collections_create(app: AppHandle, name: String, category: String) -> Result<CollectionInfo, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("El nombre de la colección no puede estar vacío.".to_string());
    }
    let mut items = read_all(&app);
    if items.iter().any(|c| c.name.eq_ignore_ascii_case(&name)) {
        return Err("Ya existe una colección con ese nombre.".to_string());
    }
    let now = now_millis();
    let c = Collection {
        id: format!("{now:x}-{:04x}", rand_u16()),
        name,
        category,
        created_at: now,
        updated_at: now,
    };
    std::fs::create_dir_all(collection_dir(&c)).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    let info = to_info(&c);
    items.push(c);
    write_all(&app, &items)?;
    Ok(info)
}

/// Renombra una colección -- también renombra su carpeta física en disco
/// (pedido explícito del usuario: "actualizar el nombre de la carpeta si
/// se renombra después"). Rechaza nombres duplicados (comparación sin
/// distinguir mayúsculas) igual que collections_create.
#[tauri::command]
pub fn collections_rename(app: AppHandle, id: String, new_name: String) -> Result<(), String> {
    let new_name = new_name.trim().to_string();
    if new_name.is_empty() {
        return Err("El nombre de la colección no puede estar vacío.".to_string());
    }
    let mut items = read_all(&app);
    if items.iter().any(|c| c.id != id && c.name.eq_ignore_ascii_case(&new_name)) {
        return Err("Ya existe una colección con ese nombre.".to_string());
    }
    let idx = items.iter().position(|c| c.id == id).ok_or("Colección no encontrada")?;
    let old_dir = collection_dir(&items[idx]);
    let mut updated = items[idx].clone();
    updated.name = new_name;
    updated.updated_at = now_millis();
    let new_dir = collection_dir(&updated);
    if old_dir != new_dir {
        if new_dir.exists() {
            return Err("Ya existe una carpeta con ese nombre en el storage.".to_string());
        }
        if old_dir.exists() {
            std::fs::rename(&old_dir, &new_dir).map_err(|e| format!("No se pudo renombrar la carpeta: {e}"))?;
        } else {
            std::fs::create_dir_all(&new_dir).map_err(|e| e.to_string())?;
        }
    }
    items[idx] = updated;
    write_all(&app, &items)
}

#[tauri::command]
pub fn collections_set_category(app: AppHandle, id: String, category: String) -> Result<(), String> {
    let mut items = read_all(&app);
    let c = items.iter_mut().find(|c| c.id == id).ok_or("Colección no encontrada")?;
    c.category = category;
    c.updated_at = now_millis();
    write_all(&app, &items)
}

#[tauri::command]
pub fn collections_delete(app: AppHandle, id: String) -> Result<(), String> {
    let mut items = read_all(&app);
    let idx = items.iter().position(|c| c.id == id).ok_or("Colección no encontrada")?;
    let dir = collection_dir(&items[idx]);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("No se pudo borrar la carpeta: {e}"))?;
    }
    items.remove(idx);
    write_all(&app, &items)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionImage {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
}

#[tauri::command]
pub fn collections_list_images(app: AppHandle, id: String) -> Result<Vec<CollectionImage>, String> {
    let items = read_all(&app);
    let c = items.iter().find(|c| c.id == id).ok_or("Colección no encontrada")?;
    let dir = collection_dir(c);
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(CollectionImage { name, path: path.to_string_lossy().to_string(), size_bytes });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Agrega una imagen (mapa de textura) a una colección -- mismo mecanismo
/// base64 que save_texture_png de textures.rs, reusado tal cual
/// (pub(crate) ahí para esto). "Tocar" el archivo en sí actualiza mtime,
/// pero además se actualiza updated_at de la colección en el registro
/// para que la lista ordenada por "más reciente" (ver collections_list)
/// la muestre arriba.
#[tauri::command]
pub async fn collections_add_image(app: AppHandle, id: String, filename: String, data_base64: String) -> Result<String, String> {
    if !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\" -- pedilo desde Sincronización o en Ajustes del sistema.".to_string());
    }
    let mut items = read_all(&app);
    let idx = items.iter().position(|c| c.id == id).ok_or("Colección no encontrada")?;
    let dir = collection_dir(&items[idx]);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    let bytes = crate::textures::base64_decode(&data_base64)?;
    let safe_name = filename.replace(['/', '\\'], "_");
    let path = dir.join(&safe_name);
    tokio::fs::write(&path, &bytes).await.map_err(|e| format!("No se pudo guardar {safe_name}: {e}"))?;
    items[idx].updated_at = now_millis();
    let _ = write_all(&app, &items);
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn collections_remove_image(app: AppHandle, id: String, filename: String) -> Result<(), String> {
    let items = read_all(&app);
    let c = items.iter().find(|c| c.id == id).ok_or("Colección no encontrada")?;
    let dir = collection_dir(c);
    let safe_name = filename.replace(['/', '\\'], "_");
    std::fs::remove_file(dir.join(&safe_name)).map_err(|e| format!("No se pudo borrar: {e}"))
}
