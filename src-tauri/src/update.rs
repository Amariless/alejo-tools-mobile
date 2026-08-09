// update.rs — auto-actualización vía GitHub Releases (Fase 4 del plan).
//
// No hay Play Store de por medio -- el repo https://github.com/Amariless/
// alejo-tools-mobile es público a propósito para que esto funcione SIN
// token embebido en la app (un token de verdad no se puede esconder de
// forma segura dentro de un .apk que cualquiera puede descompilar).
//
// Android nunca deja instalar un APK en silencio -- siempre pide
// confirmación humana + el permiso de "instalar apps de origen
// desconocido" para quien lo está ofreciendo (acá, el navegador). Por eso
// "actualizar" acá es: comparar versión contra el último Release, y si hay
// una más nueva, abrir el navegador directo en la URL de descarga del
// .apk -- Android se encarga del resto con el flujo estándar de
// instalación manual, igual que si el usuario lo hubiera bajado a mano.
use serde::{Deserialize, Serialize};

const REPO_API: &str = "https://api.github.com/repos/Amariless/alejo-tools-mobile/releases/latest";

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

#[derive(Serialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub is_newer: bool,
    pub apk_url: Option<String>,
    pub release_url: Option<String>,
    pub message: String,
}

/// Compara dos versiones "x.y.z" numéricamente (no lexicográfico -- "2.0.0"
/// tiene que ganarle a "10.0.0" mal comparado como texto). Cualquier
/// componente no numérico se trata como 0 -- alcanza para tags tipo
/// "v1.2.3" (el 'v' se saca antes de llamar a esto).
fn version_gt(a: &str, b: &str) -> bool {
    let parse = |s: &str| -> Vec<u64> {
        s.split('.').map(|p| p.trim().parse::<u64>().unwrap_or(0)).collect()
    };
    let (va, vb) = (parse(a), parse(b));
    for i in 0..va.len().max(vb.len()) {
        let na = va.get(i).copied().unwrap_or(0);
        let nb = vb.get(i).copied().unwrap_or(0);
        if na != nb {
            return na > nb;
        }
    }
    false
}

#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let client = crate::tls::client("AlejoToolsMobile-Updater/1.0", 15);

    let resp = client.get(REPO_API).send().await.map_err(|e| format!("No se pudo consultar GitHub: {e}"))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(UpdateInfo {
            current_version,
            latest_version: None,
            is_newer: false,
            apk_url: None,
            release_url: None,
            message: "Todavía no hay ningún Release publicado en el repositorio.".to_string(),
        });
    }
    if !resp.status().is_success() {
        return Err(format!("GitHub respondió {}", resp.status()));
    }

    let release: GhRelease = resp.json().await.map_err(|e| format!("Respuesta inesperada de GitHub: {e}"))?;
    let latest = release.tag_name.trim_start_matches('v').to_string();
    let is_newer = version_gt(&latest, &current_version);
    let apk_url = release.assets.iter()
        .find(|a| a.name.to_lowercase().ends_with(".apk"))
        .map(|a| a.browser_download_url.clone());

    let message = if !is_newer {
        format!("Ya tenés la última versión ({current_version}).")
    } else if apk_url.is_some() {
        format!("Hay una versión nueva disponible: {latest}.")
    } else {
        format!("Hay una versión nueva ({latest}) pero ese Release no tiene un .apk adjunto todavía.")
    };

    Ok(UpdateInfo {
        current_version,
        latest_version: Some(latest),
        is_newer,
        apk_url,
        release_url: Some(release.html_url),
        message,
    })
}
