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
use std::path::PathBuf;
use std::sync::OnceLock;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

static HTTP_ST: OnceLock<reqwest::Client> = OnceLock::new();

fn http() -> &'static reqwest::Client {
    HTTP_ST.get_or_init(|| crate::tls::client("AlejoToolsMobile-SyncManager/1.0", 15))
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

async fn st_get(app: &AppHandle, path: &str) -> Result<serde_json::Value, String> {
    let cfg = require_config(app)?;
    let resp = http()
        .get(format!("{}{path}", cfg.host))
        .header("X-API-Key", &cfg.api_key)
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con Syncthing: {}", describe_reqwest_err(&e)))?;
    if !resp.status().is_success() {
        return Err(format!("Syncthing respondió {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

async fn st_put(app: &AppHandle, path: &str, body: &serde_json::Value) -> Result<(), String> {
    let cfg = require_config(app)?;
    let resp = http()
        .put(format!("{}{path}", cfg.host))
        .header("X-API-Key", &cfg.api_key)
        .json(body)
        .send()
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
    let resp = http()
        .post(format!("{}{path}", cfg.host))
        .header("X-API-Key", &cfg.api_key)
        .send()
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
