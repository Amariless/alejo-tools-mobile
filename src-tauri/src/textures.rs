// textures.rs — Creador de Texturas (mobile).
//
// El procesamiento en sí (foto -> mapa de altura -> normal map/roughness
// vía Sobel) es 100% Canvas/JS -- ver tools/CreadorTexturas/ui.js, no hay
// nada ahí que se beneficie de estar en Rust (es aritmética de píxeles
// simple sobre una imagen ya reducida a 512px). Lo único que necesita
// Rust es GUARDAR los PNG resultantes en storage compartido -- mismo gate
// de permiso "Acceso a todos los archivos" que ya usan SyncManager y
// Descargar Música (ver storage.rs), reutilizado tal cual.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// NUEVO (pedido del usuario -- poder elegir dónde se guardan las
// texturas): mismo patrón que DownloaderConfig en downloader.rs
// (dl_get_config/dl_set_config) -- carpeta configurable vía el selector
// nativo (folder_picker.rs), persistida en app_data_dir.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TexturesConfig {
    pub folder: String,
}

impl Default for TexturesConfig {
    fn default() -> Self {
        // TODO(storage): path hardcodeado al volumen "primary" de Android
        // como default -- no hay hoy ninguna función ya expuesta (JNI, ver
        // storage.rs/installer.rs) que resuelva el directorio real de
        // almacenamiento externo. Es el default que ya funcionaba antes de
        // que la carpeta fuera configurable, así que instalaciones
        // existentes no ven ningún cambio hasta que elijan otra a mano.
        Self { folder: "/storage/emulated/0/Pictures/AlejoTools/Texturas".to_string() }
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("textures_config.json"))
}

#[tauri::command]
pub fn textures_get_config(app: AppHandle) -> TexturesConfig {
    let Ok(path) = config_path(&app) else { return TexturesConfig::default() };
    std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

#[tauri::command]
pub fn textures_set_config(app: AppHandle, folder: String) -> Result<(), String> {
    let path = config_path(&app)?;
    let cfg = TexturesConfig { folder: folder.trim().to_string() };
    let s = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| e.to_string())
}

// pub(crate): reusado por collections.rs -- las colecciones son
// subcarpetas DENTRO de esta misma carpeta general de texturas (pedido
// del usuario), no un árbol separado.
pub(crate) fn textures_dir(app: &AppHandle) -> PathBuf {
    PathBuf::from(textures_get_config(app.clone()).folder)
}

// NUEVO: base64 a mano en vez de agregar una dependencia solo para esto
// (mismo espíritu que el resto de la app -- ver notes.rs generando ids
// sin el crate uuid). El PNG viaja del JS a Rust como base64 en vez de un
// array de bytes crudo (Vec<u8>) porque, serializado a JSON para el IPC de
// Tauri, un array de números como [137,80,78,...] pesa 3-4 veces más que
// el mismo dato en base64 (un string corto por byte vs. varios dígitos +
// comas) -- para una textura de unos cientos de KB esa diferencia sí se
// nota.
pub(crate) fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut table = [255u8; 256];
    for (i, &c) in ALPHABET.iter().enumerate() {
        table[c as usize] = i as u8;
    }
    let input = input.trim_end_matches('=');
    let mut out = Vec::with_capacity(input.len() * 3 / 4 + 3);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for c in input.bytes() {
        let val = table[c as usize];
        if val == 255 {
            return Err("Datos de imagen inválidos (base64)".to_string());
        }
        buf = (buf << 6) | val as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
}

// pub(crate): reusado por camera.rs -- ver camera_read_as_data_url, la
// contraparte de base64_decode de acá arriba (mismo motivo para no traer
// una dependencia solo para esto).
pub(crate) fn base64_encode(input: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(ALPHABET[(b0 >> 2) as usize] as char);
        out.push(ALPHABET[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 { ALPHABET[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { ALPHABET[(b2 & 0x3f) as usize] as char } else { '=' });
    }
    out
}

#[tauri::command]
pub async fn save_texture_png(app: AppHandle, filename: String, data_base64: String) -> Result<String, String> {
    if !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\" -- pedilo desde Sincronización o en Ajustes del sistema.".to_string());
    }
    let bytes = base64_decode(&data_base64)?;
    let dir = textures_dir(&app);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    // Nombre saneado -- viene de nuestro propio JS (siempre algo tipo
    // "albedo.png"), pero por las dudas evitamos que un "/" se cuele y
    // termine escribiendo fuera de la carpeta.
    let safe_name = filename.replace(['/', '\\'], "_");
    if safe_name == ".." || safe_name == "." {
        return Err("Nombre de archivo inválido.".to_string());
    }
    let path = dir.join(&safe_name);
    tokio::fs::write(&path, &bytes).await.map_err(|e| format!("No se pudo guardar {safe_name}: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}
