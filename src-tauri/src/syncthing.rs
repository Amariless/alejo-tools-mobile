// syncthing.rs — SyncManager mobile: cliente de la API REST local que YA
// expone la app oficial de Syncthing para Android (127.0.0.1:8384, la
// misma que usa su propia interfaz web) -- a diferencia del escritorio
// (alejo-tools/src-tauri/src/syncthing.rs), acá NO se vendoriza ni se
// administra ningún binario propio de Syncthing.
//
// Por qué: Android no deja ejecutar binarios arbitrarios descargados en
// caliente (el escritorio sí, ahí Alejo Tools baja y corre su propia copia
// de syncthing.exe) -- solo binarios que ya vienen empaquetados DENTRO del
// propio .apk. La app oficial de Syncthing-Android ya resolvió eso (trae
// su propio build de Syncthing compilado para Android, corriendo como
// servicio en primer plano con notificación persistente y exenciones de
// batería) -- reimplementar todo eso acá sería reconstruir esa app entera
// para un beneficio chico. En cambio, el usuario instala Syncthing una
// sola vez y copia su API Key acá (Ajustes > Interfaz Web, dentro de la
// app de Syncthing) -- el acceso a 127.0.0.1 SÍ funciona entre apps
// distintas en Android (a diferencia de iOS, no hay sandboxing de
// loopback), así que esto es solo un cliente HTTP normal.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

static HTTP_ST: OnceLock<reqwest::Client> = OnceLock::new();

// NUEVO (bug real reportado -- "invalid peer certificate: UnknownIssuer"):
// Syncthing sirve su API local con un certificado autofirmado por default
// en versiones recientes -- ver el comentario grande en
// tls::client_trusting_loopback sobre por qué es seguro confiar en eso acá
// (y solo acá) sin aflojar la verificación del resto de la app.
fn http() -> &'static reqwest::Client {
    HTTP_ST.get_or_init(|| crate::tls::client_trusting_loopback("AlejoToolsMobile-SyncManager/1.0", 15))
}

/// reqwest::Error a secas solo muestra "error sending request for url
/// (...)" -- inútil para diagnosticar de verdad (¿conexión rechazada?
/// ¿timeout? ¿DNS?). El motivo real vive en la cadena de .source(), que
/// Display no sigue solo -- esto la recorre entera y la concatena.
fn describe_reqwest_err(e: &reqwest::Error) -> String {
    let mut msg = e.to_string();
    let mut source = std::error::Error::source(e);
    while let Some(s) = source {
        msg.push_str(" -- causa: ");
        msg.push_str(&s.to_string());
        source = s.source();
    }
    msg
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct SyncConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default)]
    pub api_key: String,
}

fn default_host() -> String {
    "http://127.0.0.1:8384".to_string()
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("sync_config.json"))
}

#[tauri::command]
pub fn sync_get_config(app: AppHandle) -> SyncConfig {
    let Ok(path) = config_path(&app) else { return SyncConfig { host: default_host(), api_key: String::new() } };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(SyncConfig { host: default_host(), api_key: String::new() })
}

#[tauri::command]
pub fn sync_set_config(app: AppHandle, host: String, api_key: String) -> Result<(), String> {
    let path = config_path(&app)?;
    let cfg = SyncConfig {
        host: if host.trim().is_empty() { default_host() } else { host.trim().trim_end_matches('/').to_string() },
        api_key: api_key.trim().to_string(),
    };
    let s = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| e.to_string())
}

fn require_config(app: &AppHandle) -> Result<SyncConfig, String> {
    let cfg = sync_get_config(app.clone());
    if cfg.api_key.is_empty() {
        return Err("Todavía no configuraste el API Key de Syncthing".to_string());
    }
    Ok(cfg)
}

fn flipped_scheme_host(host: &str) -> Option<String> {
    if let Some(rest) = host.strip_prefix("http://") {
        Some(format!("https://{rest}"))
    } else if let Some(rest) = host.strip_prefix("https://") {
        Some(format!("http://{rest}"))
    } else {
        None
    }
}

// NUEVO (bug real reportado -- "invalid peer certificate: UnknownIssuer"
// seguía apareciendo tras el fix de loopback en tls.rs): ese fix soluciona
// un certificado autofirmado, pero asume que ya estamos hablando HTTPS --
// default_host() en cambio asume "http://" a secas, y NO hay forma de
// saber desde acá si la instalación de Syncthing del usuario tiene "Usar
// HTTPS para la interfaz" activada (versiones recientes de
// Syncthing-Android lo traen activado por default). Un socket que solo
// habla TLS no puede "redirigir" a un cliente que le manda texto plano --
// eso explica que el error observado sea justo el de validación de
// certificado, no un simple rechazo de conexión. En vez de obligar al
// usuario a editar el host a mano (dato que ni sabía que existía, si solo
// cargó el API Key), cuando el esquema configurado falla se reintenta UNA
// vez con el otro esquema sobre el mismo host:puerto -- si funciona, se
// persiste en sync_config.json para no repetir la conexión fallida en
// cada llamada futura.
async fn send_with_fallback(
    app: &AppHandle,
    cfg: &SyncConfig,
    method: reqwest::Method,
    path: &str,
    body: Option<&serde_json::Value>,
) -> Result<reqwest::Response, reqwest::Error> {
    let build = |host: &str| {
        let mut req = http().request(method.clone(), format!("{host}{path}")).header("X-API-Key", &cfg.api_key);
        if let Some(b) = body {
            req = req.json(b);
        }
        req
    };
    match build(&cfg.host).send().await {
        Ok(resp) => Ok(resp),
        Err(first_err) => {
            let Some(alt_host) = flipped_scheme_host(&cfg.host) else { return Err(first_err) };
            match build(&alt_host).send().await {
                Ok(resp) => {
                    let _ = sync_set_config(app.clone(), alt_host, cfg.api_key.clone());
                    Ok(resp)
                }
                Err(_) => Err(first_err),
            }
        }
    }
}

async fn st_get(app: &AppHandle, path: &str) -> Result<serde_json::Value, String> {
    let cfg = require_config(app)?;
    let resp = send_with_fallback(app, &cfg, reqwest::Method::GET, path, None)
        .await
        .map_err(|e| format!("No se pudo conectar con Syncthing: {}", describe_reqwest_err(&e)))?;
    if !resp.status().is_success() {
        return Err(format!("Syncthing respondió {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

async fn st_put(app: &AppHandle, path: &str, body: &serde_json::Value) -> Result<(), String> {
    let cfg = require_config(app)?;
    let resp = send_with_fallback(app, &cfg, reqwest::Method::PUT, path, Some(body))
        .await
        .map_err(|e| format!("No se pudo conectar con Syncthing: {}", describe_reqwest_err(&e)))?;
    if !resp.status().is_success() {
        let msg = resp.text().await.unwrap_or_default();
        return Err(format!("Syncthing rechazó el cambio: {msg}"));
    }
    Ok(())
}

async fn st_post(app: &AppHandle, path: &str) -> Result<(), String> {
    let cfg = require_config(app)?;
    let resp = send_with_fallback(app, &cfg, reqwest::Method::POST, path, None)
        .await
        .map_err(|e| format!("No se pudo conectar con Syncthing: {}", describe_reqwest_err(&e)))?;
    if !resp.status().is_success() {
        return Err(format!("Syncthing respondió {}", resp.status()));
    }
    Ok(())
}

#[derive(Serialize)]
pub struct SyncStatus {
    pub connected: bool,
    pub my_id: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn sync_status(app: AppHandle) -> SyncStatus {
    if sync_get_config(app.clone()).api_key.is_empty() {
        return SyncStatus { connected: false, my_id: None, version: None, error: Some("Sin configurar".to_string()) };
    }
    match st_get(&app, "/rest/system/status").await {
        Ok(sys) => {
            let my_id = sys.get("myID").and_then(|v| v.as_str()).map(|s| s.to_string());
            let version = st_get(&app, "/rest/system/version").await.ok()
                .and_then(|v| v.get("version").and_then(|x| x.as_str()).map(|s| s.to_string()));
            SyncStatus { connected: true, my_id, version, error: None }
        }
        Err(e) => SyncStatus { connected: false, my_id: None, version: None, error: Some(e) },
    }
}

#[tauri::command]
pub async fn sync_get_folders(app: AppHandle) -> Result<serde_json::Value, String> {
    st_get(&app, "/rest/config/folders").await
}

#[tauri::command]
pub async fn sync_get_folder_status(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
    st_get(&app, &format!("/rest/db/status?folder={id}")).await
}

#[tauri::command]
pub async fn sync_set_folder_paused(app: AppHandle, id: String, paused: bool) -> Result<(), String> {
    let mut folder = st_get(&app, &format!("/rest/config/folders/{id}")).await?;
    folder["paused"] = serde_json::Value::Bool(paused);
    st_put(&app, &format!("/rest/config/folders/{id}"), &folder).await
}

/// NUEVO (pedido del usuario -- widget del Hub "Activar/Pausar sync"):
/// Syncthing no expone un único toggle "todo pausado" que podamos leer de
/// vuelta de forma confiable en todas las versiones -- en vez de eso se
/// pausa/reanuda CADA carpeta con el mismo mecanismo que ya usa
/// sync_set_folder_paused (un PUT por carpeta, reusando el objeto que ya
/// devuelve la lista en vez de volver a pedirlo uno por uno).
#[tauri::command]
pub async fn sync_set_all_paused(app: AppHandle, paused: bool) -> Result<(), String> {
    let folders = st_get(&app, "/rest/config/folders").await?;
    let arr = folders.as_array().cloned().unwrap_or_default();
    for mut folder in arr {
        let id = folder.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if id.is_empty() { continue; }
        folder["paused"] = serde_json::Value::Bool(paused);
        st_put(&app, &format!("/rest/config/folders/{id}"), &folder).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_rescan_folder(app: AppHandle, id: String) -> Result<(), String> {
    st_post(&app, &format!("/rest/db/scan?folder={id}")).await
}

#[tauri::command]
pub async fn sync_pending_folders(app: AppHandle) -> Result<serde_json::Value, String> {
    st_get(&app, "/rest/cluster/pending/folders").await
}

#[tauri::command]
pub async fn sync_accept_pending_folder(app: AppHandle, id: String, path: String, label: String, device_id: String) -> Result<(), String> {
    let body = serde_json::json!({
        "id": id,
        "label": label,
        "path": path,
        "type": "sendreceive",
        "devices": [{ "deviceID": device_id }],
    });
    st_put(&app, &format!("/rest/config/folders/{id}"), &body).await
}

#[tauri::command]
pub async fn sync_dismiss_pending_folder(app: AppHandle, id: String, label: String, device_id: String) -> Result<(), String> {
    let mut device = st_get(&app, &format!("/rest/config/devices/{device_id}")).await?;
    let ignored = device
        .get_mut("ignoredFolders")
        .and_then(|v| v.as_array_mut())
        .ok_or("Config de dispositivo con forma inesperada")?;
    let already = ignored.iter().any(|f| f.get("id").and_then(|v| v.as_str()) == Some(id.as_str()));
    if !already {
        ignored.push(serde_json::json!({ "id": id, "label": label }));
    }
    st_put(&app, &format!("/rest/config/devices/{device_id}"), &device).await
}

#[tauri::command]
pub async fn sync_get_devices(app: AppHandle) -> Result<serde_json::Value, String> {
    st_get(&app, "/rest/config/devices").await
}

#[tauri::command]
pub async fn sync_connections(app: AppHandle) -> Result<serde_json::Value, String> {
    st_get(&app, "/rest/system/connections").await
}

#[tauri::command]
pub async fn sync_add_device(app: AppHandle, id: String, name: String) -> Result<(), String> {
    let body = serde_json::json!({
        "deviceID": id,
        "name": name,
        "addresses": ["dynamic"],
    });
    st_put(&app, &format!("/rest/config/devices/{id}"), &body).await
}

#[tauri::command]
pub async fn sync_share_folder(app: AppHandle, folder_id: String, device_id: String, share: bool) -> Result<(), String> {
    let mut folder = st_get(&app, &format!("/rest/config/folders/{folder_id}")).await?;
    let devices = folder
        .get_mut("devices")
        .and_then(|v| v.as_array_mut())
        .ok_or("Config de carpeta con forma inesperada")?;
    let already = devices.iter().any(|d| d.get("deviceID").and_then(|v| v.as_str()) == Some(device_id.as_str()));
    if share && !already {
        devices.push(serde_json::json!({ "deviceID": device_id }));
    } else if !share {
        devices.retain(|d| d.get("deviceID").and_then(|v| v.as_str()) != Some(device_id.as_str()));
    }
    st_put(&app, &format!("/rest/config/folders/{folder_id}"), &folder).await
}

/// QR del ID de este dispositivo (el que corre Syncthing-Android) para
/// emparejar con el escritorio -- mismo mecanismo que syncthing.rs de
/// escritorio: se arma el SVG a mano con QrCode::to_colors(), sin el
/// feature "svg" del crate.
#[tauri::command]
pub async fn sync_my_id_qr(app: AppHandle) -> Result<String, String> {
    let sys = st_get(&app, "/rest/system/status").await?;
    let my_id = sys.get("myID").and_then(|v| v.as_str()).ok_or("No se pudo leer el ID de este dispositivo")?;

    let code = qrcode::QrCode::new(my_id.as_bytes()).map_err(|e| e.to_string())?;
    let width = code.width();
    let colors = code.to_colors();
    let scale: usize = 6;
    let quiet: usize = 4 * scale;
    let size = width * scale + quiet * 2;

    let mut svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}"><rect width="{size}" height="{size}" fill="#ffffff"/>"##
    );
    for y in 0..width {
        for x in 0..width {
            if colors[y * width + x] == qrcode::Color::Dark {
                svg.push_str(&format!(
                    r##"<rect x="{}" y="{}" width="{scale}" height="{scale}" fill="#000000"/>"##,
                    x * scale + quiet,
                    y * scale + quiet
                ));
            }
        }
    }
    svg.push_str("</svg>");
    Ok(svg)
}

// ══════════════════════════════════════════════════════════════════════════
//  "Recibir solamente" (pedido del usuario -- "los cambios locales en el
//  cel siempre me dan problemas con el sync"): algunas apps (Poweramp,
//  entre otras) escriben DENTRO de la carpeta sincronizada (caché,
//  metadata, marcas de "reproducido") -- Syncthing ve esos cambios como
//  ediciones locales legítimas y, si el mismo archivo cambió en la PC
//  casi al mismo tiempo, no sabe cuál "gana" y crea una copia
//  ".sync-conflict-..." en vez de arriesgarse a perder datos (ver más
//  abajo). Poner una carpeta en modo "Recibir solamente" es la forma que
//  Syncthing ya trae para esto: los cambios locales quedan SOLO en este
//  dispositivo (nunca se mandan a la PC ni generan conflictos), y quedan
//  marcados como "ítems locales adicionales" que se pueden revertir con
//  un toque si hace falta.
// ══════════════════════════════════════════════════════════════════════════
#[tauri::command]
pub async fn sync_set_folder_type(app: AppHandle, id: String, folder_type: String) -> Result<(), String> {
    let folder_type = match folder_type.as_str() {
        "receiveonly" | "sendonly" | "sendreceive" => folder_type,
        _ => return Err(format!("Tipo de carpeta desconocido: {folder_type}")),
    };
    let mut folder = st_get(&app, &format!("/rest/config/folders/{id}")).await?;
    folder["type"] = serde_json::Value::String(folder_type);
    st_put(&app, &format!("/rest/config/folders/{id}"), &folder).await
}

// ══════════════════════════════════════════════════════════════════════════
//  CONFLICTOS DE SINCRONIZACIÓN Y ARCHIVOS DUPLICADOS
//
//  Mismo mecanismo 1:1 que el escritorio (ver syncthing.rs de
//  alejo-tools) -- Syncthing en sí no tiene ningún endpoint que liste
//  esto ni ninguna UI para resolverlo, así que se recorre a mano la
//  carpeta real en el disco del teléfono (el "path" que devuelve
//  /rest/config/folders, que en Syncthing-Android es storage compartido
//  normal -- por eso Poweramp también la lee). Necesita el permiso
//  "Acceso a todos los archivos" (ver storage.rs) porque desde Android 11
//  leer archivos de OTRA app a partir de una ruta cruda exige ese permiso
//  especial.
//
//  Conflictos: cuando el mismo archivo cambia en dos dispositivos casi al
//  mismo tiempo, Syncthing NO pisa nada -- deja el original tal cual y
//  crea una copia aparte por cada versión en conflicto, con este patrón
//  de nombre: "archivo.sync-conflict-20240101-120000-ABCDEFG.ext".
//
//  Duplicados: archivos con contenido IDÉNTICO (mismo hash) dentro de la
//  misma carpeta, sin ningún ".sync-conflict-" de por medio -- copiados a
//  mano dos veces, guardados con otro nombre sin darse cuenta, etc.
//  Syncthing no avisa nada de esto por su cuenta, solo replica lo que ya
//  está. Esto es justo lo que reportó el usuario: al actualizar una
//  playlist en la PC, la vieja y la nueva conviven en el teléfono con
//  nombres distintos y Poweramp las muestra como si fueran dos playlists.
// ══════════════════════════════════════════════════════════════════════════

static CONFLICT_RE: Lazy<regex::Regex> = Lazy::new(|| {
    regex::Regex::new(r"^(.+)\.sync-conflict-\d{8}-\d{6}-([A-Za-z0-9]{7})(\.[^./\\]*)?$").unwrap()
});

fn parse_conflict_name(file_name: &str) -> Option<(String, String)> {
    let caps = CONFLICT_RE.captures(file_name)?;
    let base = caps.get(1)?.as_str();
    let short_id = caps.get(2)?.as_str().to_string();
    let ext = caps.get(3).map(|m| m.as_str()).unwrap_or("");
    Some((format!("{base}{ext}"), short_id))
}

fn should_skip_dir(name: &str) -> bool {
    name == ".stfolder" || name == ".stversions" || name.starts_with(".git")
}

// NUEVO (auditoría -- hallazgo MENOR #9): sin límite de profundidad, un
// enlace simbólico circular o un árbol de directorios patológico podía
// recursar sin fin. 30 niveles es muchísimo más de lo que cualquier
// estructura de carpetas real necesita.
const MAX_SCAN_DEPTH: u32 = 30;

fn scan_dir_for_conflicts(dir: &Path, out: &mut Vec<PathBuf>, depth: u32) {
    if depth > MAX_SCAN_DEPTH { return; }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if path.is_dir() {
            if !should_skip_dir(&name_str) {
                scan_dir_for_conflicts(&path, out, depth + 1);
            }
        } else if name_str.contains(".sync-conflict-") {
            out.push(path);
        }
    }
}

fn file_meta(path: &Path) -> (u64, u64) {
    match std::fs::metadata(path) {
        Ok(m) => {
            let modified = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            (modified, m.len())
        }
        Err(_) => (0, 0),
    }
}

#[derive(Serialize, Clone)]
pub struct ConflictVariant {
    pub path: String,
    pub is_original: bool,
    pub device_short_id: Option<String>,
    pub device_name: Option<String>,
    pub modified_secs: u64,
    pub size_bytes: u64,
}

#[derive(Serialize)]
pub struct ConflictGroup {
    pub folder_id: String,
    pub folder_label: String,
    pub base_path: String,
    pub file_name: String,
    pub variants: Vec<ConflictVariant>,
}

async fn folders_with_local_path(app: &AppHandle) -> Result<Vec<(String, String, PathBuf)>, String> {
    let folders = st_get(app, "/rest/config/folders").await?;
    let mut out = Vec::new();
    for f in folders.as_array().cloned().unwrap_or_default() {
        let folder_id = f.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if folder_id.is_empty() { continue; }
        let folder_label = f.get("label").and_then(|v| v.as_str())
            .filter(|s| !s.is_empty()).unwrap_or(&folder_id).to_string();
        let folder_path = f.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if folder_path.is_empty() { continue; }
        let root = PathBuf::from(&folder_path);
        if !root.is_dir() { continue; }
        out.push((folder_id, folder_label, root));
    }
    Ok(out)
}

#[tauri::command]
pub async fn sync_list_conflicts(app: AppHandle) -> Result<Vec<ConflictGroup>, String> {
    if !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\" -- pedilo desde el botón de arriba.".to_string());
    }

    let devices = st_get(&app, "/rest/config/devices").await.unwrap_or(serde_json::Value::Array(vec![]));
    let device_names: HashMap<String, String> = devices.as_array()
        .map(|arr| arr.iter().filter_map(|d| {
            let id = d.get("deviceID")?.as_str()?.to_string();
            let name = d.get("name")?.as_str()?.to_string();
            if name.is_empty() { None } else { Some((id, name)) }
        }).collect())
        .unwrap_or_default();

    let mut out: Vec<ConflictGroup> = Vec::new();
    for (folder_id, folder_label, root) in folders_with_local_path(&app).await? {
        // NUEVO (auditoría -- hallazgo MEDIO #2): el recorrido recursivo del
        // disco es I/O bloqueante -- corría directo dentro de la tarea async,
        // a diferencia de sync_find_duplicate_files (más abajo) que ya lo
        // envuelve en spawn_blocking. Mismo patrón acá.
        let conflict_files = tokio::task::spawn_blocking(move || {
            let mut out = Vec::new();
            scan_dir_for_conflicts(&root, &mut out, 0);
            out
        })
        .await
        .unwrap_or_default();
        if conflict_files.is_empty() { continue; }

        let mut by_base: HashMap<PathBuf, Vec<(PathBuf, String)>> = HashMap::new();
        for cf in conflict_files {
            let Some(file_name) = cf.file_name().and_then(|n| n.to_str()) else { continue };
            let Some((orig_name, short_id)) = parse_conflict_name(file_name) else { continue };
            let base_path = cf.with_file_name(orig_name);
            by_base.entry(base_path).or_default().push((cf, short_id));
        }

        for (base_path, conflicts) in by_base {
            let mut variants = Vec::new();
            if base_path.is_file() {
                let (modified_secs, size_bytes) = file_meta(&base_path);
                variants.push(ConflictVariant {
                    path: base_path.to_string_lossy().to_string(),
                    is_original: true, device_short_id: None, device_name: None,
                    modified_secs, size_bytes,
                });
            }
            for (cf, short_id) in &conflicts {
                let (modified_secs, size_bytes) = file_meta(cf);
                let device_name = device_names.iter()
                    .find(|(id, _)| id.starts_with(short_id.as_str()))
                    .map(|(_, name)| name.clone());
                variants.push(ConflictVariant {
                    path: cf.to_string_lossy().to_string(),
                    is_original: false, device_short_id: Some(short_id.clone()), device_name,
                    modified_secs, size_bytes,
                });
            }
            if variants.len() < 2 { continue; }
            variants.sort_by(|a, b| b.modified_secs.cmp(&a.modified_secs));
            let file_name = base_path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            out.push(ConflictGroup {
                folder_id: folder_id.clone(), folder_label: folder_label.clone(),
                base_path: base_path.to_string_lossy().to_string(), file_name, variants,
            });
        }
    }
    out.sort_by(|a, b| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub async fn sync_resolve_conflict(
    app: AppHandle,
    folder_id: String,
    base_path: String,
    keep_path: String,
    all_paths: Vec<String>,
) -> Result<(), String> {
    let base = PathBuf::from(&base_path);
    let keep = PathBuf::from(&keep_path);
    if keep != base {
        std::fs::copy(&keep, &base).map_err(|e| format!("No se pudo aplicar la versión elegida: {e}"))?;
    }
    // NUEVO (auditoría -- hallazgo MENOR #7): antes se ignoraban todos los
    // errores de borrado con `let _ = ...`. Ahora se intentan TODOS los
    // paths y se reportan al final los que fallaron.
    let mut errors = Vec::new();
    for p in &all_paths {
        let pb = PathBuf::from(p);
        if pb != base {
            if let Err(e) = std::fs::remove_file(&pb) {
                errors.push(format!("{p}: {e}"));
            }
        }
    }
    let _ = st_post(&app, &format!("/rest/db/scan?folder={folder_id}")).await;
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!("No se pudieron borrar algunas variantes: {}", errors.join("; ")))
    }
}

fn scan_dir_for_files(dir: &Path, out: &mut Vec<PathBuf>, depth: u32) {
    if depth > MAX_SCAN_DEPTH { return; }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if path.is_dir() {
            if !should_skip_dir(&name_str) {
                scan_dir_for_files(&path, out, depth + 1);
            }
        } else if !name_str.contains(".sync-conflict-") {
            out.push(path);
        }
    }
}

fn hash_file(path: &Path) -> Option<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 128 * 1024];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Some(format!("{:x}", hasher.finalize()))
}

#[derive(Serialize)]
pub struct DuplicateGroup {
    pub folder_id: String,
    pub folder_label: String,
    pub size_bytes: u64,
    pub paths: Vec<String>,
}

fn find_duplicates_in_folder(root: &Path, folder_id: &str, folder_label: &str) -> Vec<DuplicateGroup> {
    let mut files = Vec::new();
    scan_dir_for_files(root, &mut files, 0);

    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    for p in files {
        if let Ok(meta) = std::fs::metadata(&p) {
            let len = meta.len();
            if len == 0 { continue; }
            by_size.entry(len).or_default().push(p);
        }
    }

    let mut out = Vec::new();
    for (size, paths) in by_size {
        if paths.len() < 2 { continue; }
        let mut by_hash: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for p in paths {
            if let Some(h) = hash_file(&p) {
                by_hash.entry(h).or_default().push(p);
            }
        }
        for group in by_hash.into_values() {
            if group.len() < 2 { continue; }
            out.push(DuplicateGroup {
                folder_id: folder_id.to_string(),
                folder_label: folder_label.to_string(),
                size_bytes: size,
                paths: group.iter().map(|p| p.to_string_lossy().to_string()).collect(),
            });
        }
    }
    out
}

#[tauri::command]
pub async fn sync_find_duplicate_files(app: AppHandle) -> Result<Vec<DuplicateGroup>, String> {
    if !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\" -- pedilo desde el botón de arriba.".to_string());
    }

    let mut out: Vec<DuplicateGroup> = Vec::new();
    for (folder_id, folder_label, root) in folders_with_local_path(&app).await? {
        let groups = tokio::task::spawn_blocking(move || find_duplicates_in_folder(&root, &folder_id, &folder_label))
            .await
            .unwrap_or_default();
        out.extend(groups);
    }
    Ok(out)
}

/// Borra todas las rutas dadas menos una -- usado por el frontend tanto
/// para "quedate con esta copia, borrá las demás" como acción genérica.
#[tauri::command]
pub fn sync_delete_files(paths: Vec<String>) -> Result<(), String> {
    // NUEVO (auditoría -- hallazgo MENOR #7): antes cortaba con `?` en el
    // primer error, dejando sin intentar el resto de los paths pedidos.
    // Ahora se intentan TODOS y se reportan al final los que fallaron.
    let mut errors = Vec::new();
    for p in &paths {
        if let Err(e) = std::fs::remove_file(p) {
            errors.push(format!("{p}: {e}"));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!("No se pudieron borrar algunos archivos: {}", errors.join("; ")))
    }
}
