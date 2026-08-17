// epub.rs — Lector de Libros (mobile).
//
// Un .epub es un .zip con XHTML adentro (spec OCF/OPF de IDPF). A
// diferencia del Lector de PDF (que usa PdfRenderer, nativo del SDK de
// Android vía JNI), acá NO hay ningún equivalente de plataforma -- el
// parseo es Rust puro multiplataforma (crate `zip`), sin puente Kotlin,
// mismo binario en Windows dev y en el APK.
//
// Alcance de esta primera versión (recorte a propósito, no un olvido):
//   - Solo .epub -- .mobi/.azw3 quedan afuera (formatos propietarios de
//     Amazon, requieren parsers completamente distintos).
//   - No se renderizan imágenes embebidas -- se extraen y descartan al
//     limpiar el XHTML de cada capítulo. La mayoría de las novelas/textos
//     largos (el caso de uso típico acá) no dependen de imágenes para
//     leerse; agregar esto exigiría servir cada imagen del zip como un
//     recurso propio (otro comando + manejo de content-type), significativo
//     para el beneficio real en este caso.
//   - Navegación por CAPÍTULO (unidad = un archivo XHTML del spine), no
//     paginación real dentro de un capítulo largo -- se scrollea. Mucho
//     más simple que reimplementar paginación por ancho de pantalla, y el
//     progreso guarda tanto el capítulo como la posición de scroll dentro
//     de él, así que "seguir donde quedé" funciona igual.
//   - El progreso de lectura se guarda LOCAL (app_data_dir), NO en la
//     carpeta sincronizada de libros. Esto es deliberado: el usuario pidió
//     antes que los cambios locales del celular NO afecten el sync (ver
//     syncthing.rs, modo "Recibir solamente") -- escribir un archivo de
//     progreso DENTRO de esa misma carpeta sincronizada sería exactamente
//     el tipo de cambio local que ese pedido buscaba evitar, y si la
//     carpeta está en "Recibir solamente" Syncthing directamente revertiría
//     ese archivo. El progreso sí sobrevive reinstalar/reabrir la app en
//     este mismo teléfono, pero no viaja a otro dispositivo todavía -- ver
//     el mensaje final al usuario para el trade-off explicado.
use once_cell::sync::Lazy;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

// ══════════════════════════════════════════════════════════════════════════
//  CONFIG (carpeta de libros) -- mismo patrón que pdf.rs
// ══════════════════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookConfig {
    pub folder: String,
    // NUEVO: preferencia de lectura persistida -- pedido explícito del
    // usuario ("funciones de calidad de vida del lector"), sencillo de
    // sumar reusando el mismo archivo de config en vez de otro aparte.
    pub font_size: u32,
}

impl Default for BookConfig {
    fn default() -> Self {
        Self { folder: "/storage/emulated/0/Books".to_string(), font_size: 18 }
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("book_config.json"))
}

#[tauri::command]
pub fn book_get_config(app: AppHandle) -> BookConfig {
    let Ok(path) = config_path(&app) else { return BookConfig::default() };
    std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

#[tauri::command]
pub fn book_set_config(app: AppHandle, folder: String, font_size: u32) -> Result<(), String> {
    let path = config_path(&app)?;
    let cfg = BookConfig { folder: folder.trim().to_string(), font_size: font_size.clamp(12, 32) };
    let s = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| e.to_string())
}

/// Setter de solo-carpeta -- para que Settings (ver FOLDERS en
/// Settings/ui.js, patrón genérico `set: (folder) => invoke(...)` con un
/// único argumento) pueda cambiar la carpeta de libros sin tener que
/// conocer/pisar font_size, que se administra desde el lector.
#[tauri::command]
pub fn book_set_folder(app: AppHandle, folder: String) -> Result<(), String> {
    let mut cfg = book_get_config(app.clone());
    cfg.folder = folder.trim().to_string();
    let path = config_path(&app)?;
    let s = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookFile {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_at: i64,
}

#[tauri::command]
pub async fn book_list_folder(app: AppHandle, folder: String) -> Result<Vec<BookFile>, String> {
    if !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\" -- pedilo desde Sincronización o en Ajustes del sistema.".to_string());
    }
    let dir = PathBuf::from(&folder);
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("No se pudo leer la carpeta: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        let is_epub = path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("epub")).unwrap_or(false);
        if !is_epub { continue; }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let meta = entry.metadata().ok();
        let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified_at = meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        out.push(BookFile { name, path: path.to_string_lossy().to_string(), size_bytes, modified_at });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Borra un .epub -- también limpia su progreso guardado.
#[tauri::command]
pub async fn book_delete_file(app: AppHandle, path: String) -> Result<(), String> {
    if !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\".".to_string());
    }
    std::fs::remove_file(&path).map_err(|e| format!("No se pudo borrar el archivo: {e}"))?;
    let mut all = read_all_progress(&app);
    if all.remove(&path).is_some() {
        let out_path = progress_path(&app)?;
        let s = serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?;
        let _ = std::fs::write(&out_path, s);
    }
    Ok(())
}

/// Renombra un .epub dentro de la misma carpeta -- migra también su
/// progreso guardado (indexado por ruta) para no perder "dónde iba".
#[tauri::command]
pub async fn book_rename_file(app: AppHandle, path: String, new_name: String) -> Result<String, String> {
    if !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\".".to_string());
    }
    let old = PathBuf::from(&path);
    let parent = old.parent().ok_or("Ruta inválida")?;
    let target = parent.join(&new_name);
    if target.exists() {
        return Err("Ya existe un archivo con ese nombre.".to_string());
    }
    std::fs::rename(&old, &target).map_err(|e| format!("No se pudo renombrar: {e}"))?;
    let new_path = target.to_string_lossy().to_string();
    let mut all = read_all_progress(&app);
    if let Some(prog) = all.remove(&path) {
        all.insert(new_path.clone(), prog);
        let out_path = progress_path(&app)?;
        let s = serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?;
        let _ = std::fs::write(&out_path, s);
    }
    Ok(new_path)
}

/// Vista previa chica de texto para la miniatura en la lista (pedido del
/// usuario -- "mini preview de la primera página, o de la última leída"):
/// como un .epub no tiene una imagen de página como el PDF, la miniatura
/// acá es un fragmento de texto del capítulo correspondiente (el 0 si el
/// libro nunca se abrió, o el del progreso guardado si ya se leyó algo).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookPreview {
    pub snippet: String,
    pub chapter_index: usize,
}

#[tauri::command]
pub async fn book_get_preview(app: AppHandle, path: String) -> Result<BookPreview, String> {
    if !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\".".to_string());
    }
    let parsed = parse_epub(&path)?;
    let chapter_index = read_all_progress(&app)
        .get(&path)
        .map(|p| p.chapter_index.min(parsed.spine.len().saturating_sub(1)))
        .unwrap_or(0);
    let entry_name = parsed.spine.get(chapter_index).cloned().ok_or("Capítulo fuera de rango")?;
    let file = std::fs::File::open(&path).map_err(|e| format!("No se pudo abrir el archivo: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("No se pudo leer el epub: {e}"))?;
    let raw_bytes = zip_read_entry(&mut zip, &entry_name)?;
    let raw = String::from_utf8_lossy(&raw_bytes);
    let (html, _title) = clean_chapter_html(&raw);
    let text = strip_tags(&html);
    let snippet: String = text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(160).collect();
    Ok(BookPreview { snippet, chapter_index })
}

// ══════════════════════════════════════════════════════════════════════════
//  PARSEO DE EPUB -- container.xml -> .opf (manifest + spine) -- regex en
//  vez de un parser XML completo: el XHTML/OPF de un EPUB real es bastante
//  regular para esto, y evita sumar una dependencia de parsing XML entera
//  solo para leer un puñado de atributos.
// ══════════════════════════════════════════════════════════════════════════

static ROOTFILE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"full-path="([^"]+)""#).unwrap());
static ITEM_TAG_RE: Lazy<Regex> = Lazy::new(|| RegexBuilder::new(r"<item\b[^>]*/?>").build().unwrap());
static ID_ATTR_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"\bid="([^"]+)""#).unwrap());
static HREF_ATTR_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"\bhref="([^"]+)""#).unwrap());
static ITEMREF_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"<itemref\b[^>]*\bidref="([^"]+)""#).unwrap());
static TITLE_RE: Lazy<Regex> = Lazy::new(|| RegexBuilder::new(r"<dc:title[^>]*>(.*?)</dc:title>").dot_matches_new_line(true).build().unwrap());

/// Decodifica percent-encoding (RFC 3986) -- hand-rolled en vez de sumar una
/// dependencia (percent-encoding/urlencoding) solo para esto, mismo criterio
/// que base64_decode en textures.rs. NUEVO (bug real de la revisión de
/// código): los href del manifest de un .opf son URIs y muchos generadores
/// de epub (conversores Word->epub, web->epub) los percent-codifican cuando
/// el nombre de archivo real tiene espacios o acentos -- ej.
/// href="Cap%C3%ADtulo%201.xhtml" apuntando a un miembro del zip llamado
/// literalmente "Capítulo 1.xhtml". Sin decodificar esto antes de buscar en
/// el zip (zip.by_name hace match exacto de bytes), esos capítulos nunca se
/// encontraban.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 3 <= bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn zip_read_entry(zip: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Result<Vec<u8>, String> {
    let mut file = zip.by_name(name).map_err(|e| format!("No se encontró {name} dentro del epub: {e}"))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| format!("No se pudo leer {name}: {e}"))?;
    Ok(buf)
}

/// Resuelve una ruta relativa (como aparece en href="...") contra el
/// directorio del .opf -- los href del manifest son relativos a donde
/// vive el .opf, no a la raíz del zip.
fn resolve_relative(base_dir: &str, href: &str) -> String {
    if href.starts_with('/') { return href.trim_start_matches('/').to_string(); }
    let mut parts: Vec<&str> = if base_dir.is_empty() { Vec::new() } else { base_dir.split('/').collect() };
    for seg in href.split('/') {
        match seg {
            "." | "" => {}
            ".." => { parts.pop(); }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

struct ParsedBook {
    title: String,
    spine: Vec<String>, // rutas dentro del zip, en orden de lectura
}

fn parse_epub(path: &str) -> Result<ParsedBook, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("No se pudo abrir el archivo: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("No es un .epub válido (zip corrupto): {e}"))?;

    let container = zip_read_entry(&mut zip, "META-INF/container.xml")?;
    let container_str = String::from_utf8_lossy(&container);
    let opf_path = ROOTFILE_RE
        .captures(&container_str)
        .map(|c| percent_decode(&c[1]))
        .ok_or("container.xml no tiene un rootfile válido")?;

    let opf_bytes = zip_read_entry(&mut zip, &opf_path)?;
    let opf_str = String::from_utf8_lossy(&opf_bytes).to_string();

    let opf_dir = opf_path.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_default();

    // manifest: id -> href (resuelto contra la carpeta del .opf)
    let mut manifest: HashMap<String, String> = HashMap::new();
    for m in ITEM_TAG_RE.find_iter(&opf_str) {
        let tag = m.as_str();
        let (Some(id), Some(href)) = (ID_ATTR_RE.captures(tag), HREF_ATTR_RE.captures(tag)) else { continue };
        manifest.insert(id[1].to_string(), resolve_relative(&opf_dir, &percent_decode(&href[1])));
    }

    let spine: Vec<String> = ITEMREF_RE
        .captures_iter(&opf_str)
        .filter_map(|c| manifest.get(&c[1]).cloned())
        .collect();
    if spine.is_empty() {
        return Err("El epub no tiene capítulos (spine vacío) -- ¿archivo corrupto?".to_string());
    }

    let title = TITLE_RE
        .captures(&opf_str)
        .map(|c| strip_tags(&c[1]).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            PathBuf::from(path).file_stem().and_then(|s| s.to_str()).unwrap_or("Sin título").to_string()
        });

    Ok(ParsedBook { title, spine })
}

// ══════════════════════════════════════════════════════════════════════════
//  LIMPIEZA DE XHTML DE CAPÍTULO -- se descartan script/style/img/svg, el
//  resto de las etiquetas se dejan pasar tal cual (el WebView las renderiza
//  igual sin el CSS propio del epub, que tampoco se porta -- suficiente
//  para lectura de texto plano con la tipografía de la app).
// ══════════════════════════════════════════════════════════════════════════

static BODY_RE: Lazy<Regex> = Lazy::new(|| RegexBuilder::new(r"<body[^>]*>(.*)</body>").dot_matches_new_line(true).build().unwrap());
static SCRIPT_RE: Lazy<Regex> = Lazy::new(|| RegexBuilder::new(r"<script[^>]*>.*?</script>").dot_matches_new_line(true).build().unwrap());
static STYLE_RE: Lazy<Regex> = Lazy::new(|| RegexBuilder::new(r"<style[^>]*>.*?</style>").dot_matches_new_line(true).build().unwrap());
static SVG_RE: Lazy<Regex> = Lazy::new(|| RegexBuilder::new(r"<svg[^>]*>.*?</svg>").dot_matches_new_line(true).build().unwrap());
static IMG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"<img\b[^>]*/?>").unwrap());
static TAG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"<[^>]+>").unwrap());
static HEADING_RE: Lazy<Regex> = Lazy::new(|| RegexBuilder::new(r"<h[1-3][^>]*>(.*?)</h[1-3]>").dot_matches_new_line(true).build().unwrap());

fn strip_tags(s: &str) -> String {
    TAG_RE.replace_all(s, "").to_string()
}

fn clean_chapter_html(raw: &str) -> (String, Option<String>) {
    let body = BODY_RE.captures(raw).map(|c| c[1].to_string()).unwrap_or_else(|| raw.to_string());
    let cleaned = SCRIPT_RE.replace_all(&body, "");
    let cleaned = STYLE_RE.replace_all(&cleaned, "");
    let cleaned = SVG_RE.replace_all(&cleaned, "");
    let cleaned = IMG_RE.replace_all(&cleaned, "");

    let chapter_title = HEADING_RE.captures(&cleaned).map(|c| strip_tags(&c[1]).trim().to_string()).filter(|s| !s.is_empty());

    (cleaned.trim().to_string(), chapter_title)
}

// ══════════════════════════════════════════════════════════════════════════
//  SESIONES -- igual que PdfBridge del lado Kotlin, pero acá no hace falta
//  mantener el zip abierto entre llamadas: releer un capítulo puntual de un
//  epub (típicamente unos cientos de KB a pocos MB en total) es rápido, así
//  que cada get_chapter reabre el archivo -- evita lidiar con guardar un
//  ZipArchive<File> (no Send/Sync-friendly para un Mutex estático usado
//  desde comandos async) por un ahorro de tiempo insignificante.
// ══════════════════════════════════════════════════════════════════════════

struct BookSession {
    path: String,
    spine: Vec<String>,
}

static SESSIONS: Lazy<Mutex<HashMap<String, BookSession>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn new_session_id() -> String {
    static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    format!("{now:x}-{:x}", COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookOpenResult {
    pub session_id: String,
    pub title: String,
    pub chapter_count: usize,
}

#[tauri::command]
pub async fn book_open(app: AppHandle, path: String) -> Result<BookOpenResult, String> {
    // NUEVO (revisión de código): a diferencia de book_list_folder, este
    // comando aceptaba cualquier ruta cruda desde IPC sin pasar por el
    // gate de permiso -- lo alinea con el resto de los comandos que tocan
    // storage compartido.
    if !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\" -- pedilo desde Sincronización o en Ajustes del sistema.".to_string());
    }
    let parsed = parse_epub(&path)?;
    let session_id = new_session_id();
    let chapter_count = parsed.spine.len();
    let title = parsed.title.clone();
    SESSIONS.lock().unwrap().insert(session_id.clone(), BookSession { path, spine: parsed.spine });
    Ok(BookOpenResult { session_id, title, chapter_count })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterResult {
    pub html: String,
    pub title: Option<String>,
}

#[tauri::command]
pub fn book_get_chapter(session_id: String, chapter_index: usize) -> Result<ChapterResult, String> {
    let (path, entry_name) = {
        let sessions = SESSIONS.lock().unwrap();
        let session = sessions.get(&session_id).ok_or("Sesión no encontrada -- ¿se cerró el libro?")?;
        let entry_name = session.spine.get(chapter_index).ok_or("Índice de capítulo fuera de rango")?.clone();
        (session.path.clone(), entry_name)
    };
    let file = std::fs::File::open(&path).map_err(|e| format!("No se pudo abrir el archivo: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("No se pudo leer el epub: {e}"))?;
    let raw_bytes = zip_read_entry(&mut zip, &entry_name)?;
    let raw = String::from_utf8_lossy(&raw_bytes);
    let (html, title) = clean_chapter_html(&raw);
    Ok(ChapterResult { html, title })
}

#[tauri::command]
pub fn book_close(session_id: String) {
    SESSIONS.lock().unwrap().remove(&session_id);
}

// ══════════════════════════════════════════════════════════════════════════
//  PROGRESO DE LECTURA -- local (app_data_dir), ver nota grande al
//  principio del archivo sobre por qué NO se guarda en la carpeta
//  sincronizada.
// ══════════════════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookProgress {
    pub chapter_index: usize,
    pub scroll_fraction: f64,
    pub updated_at: i64,
}

fn progress_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("book_progress.json"))
}

fn read_all_progress(app: &AppHandle) -> HashMap<String, BookProgress> {
    let Ok(path) = progress_path(app) else { return HashMap::new() };
    std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

#[tauri::command]
pub fn book_get_progress(app: AppHandle, path: String) -> Option<BookProgress> {
    read_all_progress(&app).get(&path).cloned()
}

#[tauri::command]
pub fn book_set_progress(app: AppHandle, path: String, chapter_index: usize, scroll_fraction: f64) -> Result<(), String> {
    let mut all = read_all_progress(&app);
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    all.insert(path, BookProgress { chapter_index, scroll_fraction, updated_at: now });
    let out_path = progress_path(&app)?;
    let s = serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?;
    std::fs::write(&out_path, s).map_err(|e| e.to_string())
}
