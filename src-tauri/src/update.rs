// update.rs — auto-actualización vía GitHub Releases (Fase 4 del plan).
//
// No hay Play Store de por medio -- el repo https://github.com/Amariless/
// alejo-tools-mobile es público a propósito para que esto funcione SIN
// token embebido en la app (un token de verdad no se puede esconder de
// forma segura dentro de un .apk que cualquiera puede descompilar).
//
// Android nunca deja instalar un APK en silencio -- siempre pide
// confirmación humana + el permiso de "instalar apps de origen
// desconocido" para quien lo está ofreciendo. Por eso "actualizar" acá es:
// comparar versión contra el último Release y, si hay una más nueva,
// DESCARGAR el .apk nosotros mismos (ver download_and_install_update) y
// pedirle al sistema que lo instale (ver installer.rs) -- Android se
// encarga del resto con su diálogo estándar de instalación, pero al menos
// el usuario no tiene que salir a un navegador ni volver a abrir el
// archivo a mano.
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

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

// ══════════════════════════════════════════════════════════════════════════
//  Descarga + instalación in-app (pedido del usuario -- antes esto solo
//  abría el navegador y el usuario tenía que bajar el .apk y abrirlo a
//  mano). Nombre de archivo FIJO ("alejo-tools-update.apk", siempre el
//  mismo, sobreescrito en cada descarga) -- así nunca se acumulan copias
//  viejas aunque el borrado de "después de instalar" (más abajo) falle o
//  no llegue a tiempo.
// ══════════════════════════════════════════════════════════════════════════

fn update_apk_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("alejo-tools-update.apk"))
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
    percent: Option<f64>,
}

#[tauri::command]
pub async fn download_and_install_update(app: AppHandle, url: String) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let dest = update_apk_path(&app)?;
    // Por si quedó un archivo de una descarga anterior interrumpida --
    // nunca hace falta más de una copia a la vez.
    let _ = std::fs::remove_file(&dest);

    let client = crate::tls::client("AlejoToolsMobile-Updater/1.0", 120);
    let resp = client.get(&url).send().await.map_err(|e| format!("No se pudo empezar la descarga: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub respondió {} al descargar", resp.status()));
    }
    let total = resp.content_length();

    let mut file = tokio::fs::File::create(&dest).await.map_err(|e| format!("No se pudo crear el archivo: {e}"))?;
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Error durante la descarga: {e}"))?;
        file.write_all(&chunk).await.map_err(|e| format!("No se pudo escribir el archivo: {e}"))?;
        downloaded += chunk.len() as u64;
        // No emitir un evento por cada chunk (miles por segundo a buena
        // velocidad) -- alcanza con actualizar la UI unas 10 veces por
        // segundo.
        if last_emit.elapsed().as_millis() >= 100 {
            let _ = app.emit("update-download-progress", DownloadProgress {
                downloaded,
                total,
                percent: total.map(|t| (downloaded as f64 / t as f64) * 100.0),
            });
            last_emit = std::time::Instant::now();
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    let _ = app.emit("update-download-progress", DownloadProgress { downloaded, total, percent: Some(100.0) });

    let dest_str = dest.to_string_lossy().to_string();
    crate::installer::install_apk(&dest_str)?;

    // Mejor esfuerzo: borra el .apk descargado un rato después de haber
    // lanzado el instalador. No hay ninguna forma simple de saber "ya
    // terminó de instalarse" desde acá (eso requeriría un BroadcastReceiver
    // de Android, código Kotlin de verdad) -- este delay le da tiempo de
    // sobra al instalador del sistema para copiar lo que necesite de la
    // URI content:// antes de que el archivo original desaparezca. Si el
    // usuario tarda MUCHO en confiar/aceptar el diálogo de instalación,
    // en el peor caso el instalador ya leyó el archivo y esto no rompe
    // nada -- solo limpia el cache.
    let cleanup_path = dest;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(45)).await;
        let _ = std::fs::remove_file(&cleanup_path);
    });

    Ok(())
}
