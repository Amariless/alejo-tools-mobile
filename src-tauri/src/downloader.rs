// downloader.rs — Descargar Música (mobile).
//
// yt-dlp no existe como binario de PATH en Android (a diferencia de
// escritorio, ver downloader.rs de alejo-tools, que shellea
// Command::new("yt-dlp")). La app usa youtubedl-android (empaqueta Python +
// yt-dlp + ffmpeg por ABI dentro del propio APK, ver
// gen/android/app/build.gradle.kts) a través de un puente Kotlin propio,
// YtDlpBridge.kt (gen/android/app/src/main/java/.../YtDlpBridge.kt) --
// llamado desde acá por JNI, mismo mecanismo que installer.rs/storage.rs
// (WebviewWindow::with_webview(...).jni_handle().exec(...) +
// wry::prelude::find_class, porque YtDlpBridge vive en el classloader de
// la app, no en el que ve por defecto el hilo JNI de wry).
//
// La limpieza de título/artista (clean_title, CHANNEL_SUFFIX, NOISE, etc.)
// es texto puro -- se porta 1:1 de downloader.rs de escritorio, sin ningún
// cambio: no depende de shellear ningún proceso.
//
// A propósito NO se portó de escritorio para esta primera versión mobile
// (queda para más adelante si hace falta): soporte de playlists completas
// (acá solo se descarga una canción por vez), la búsqueda multi-fuente
// find_best_candidate (YouTube+SoundCloud+Bandcamp sondeando bitrate real
// para elegir la mejor fuente -- acá se descarga directo de la URL que el
// usuario pegó), el autocompletado dl_search_suggestions, y el redescargar-
// con-otra-fuente de Music Metadata Updater (que ni siquiera existe en
// mobile todavía).

use std::path::PathBuf;

use once_cell::sync::Lazy;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

// ══════════════════════════════════════════════════════════════════════════
//  LIMPIEZA DE TÍTULO (portado 1:1 de downloader.rs de escritorio)
// ══════════════════════════════════════════════════════════════════════════

static NOISE: Lazy<Regex> = Lazy::new(|| {
    RegexBuilder::new(concat!(
        r"\b(",
        r"hd|hq|4k|8k|2k|720p|1080p|2160p|uhd|fhd|",
        r"official\s*(?:video|audio|mv|m/?v|lyric\s*video|music\s*video|visualizer|clip)?|",
        r"oficial|",
        r"music\s*video|lyric\s*video|audio\s*(?:oficial)?|",
        r"visualizer|video\s*oficial|clip\s*oficial|",
        r"letra|lyrics?|lyric|subtitulado|subtitles?|cc|closed\s*captions?|karaoke|",
        r"version|versión|ver\.|edit|extended|radio\s*edit|album\s*version|",
        r"remaster(?:ed)?|remastered?\s*\d{4}|demo|rough\s*mix|",
        r"live|en\s*vivo|acoustic|acústico|unplugged|session|",
        r"m/?v|choreography|dance\s*(?:ver(?:sion)?|practice|video)|",
        r"performance\s*(?:ver(?:sion)?|video)|",
        r"stage\s*(?:mix)?|comeback|teaser|trailer|b-?side|",
        r"fan\s*(?:made|cam|chant)|fancam|",
        r"color\s*coded|rom\s*\+?\s*(?:han\s*\+?\s*)?eng|",
        r"feat(?:uring)?|ft\.|prod(?:uced)?\s*by|",
        r"instrumental|cover|remake|tribute|",
        r"english\s*ver(?:sion)?|japanese\s*ver(?:sion)?|",
        r"chinese\s*ver(?:sion)?|spanish\s*ver(?:sion)?|",
        r"auto[-\s]?generated|provided\s*to\s*youtube|",
        r"topic|vevo|",
        r"full\s*(?:song|album|version)?|completo|stereo|mono|hifi|",
        r"explicit|clean",
        r")\b"
    ))
    .case_insensitive(true)
    .build()
    .expect("NOISE regex inválido")
});

static CHANNEL_SUFFIX: Lazy<Regex> = Lazy::new(|| {
    RegexBuilder::new(concat!(
        r"\s*[-–—]\s*(",
        r"vevo|records?|music|entertainment|official|tv|channel|",
        r"productions?|label|discos?|media|sounds?|audio|",
        r"hybe\s*labels?|sm\s*entertainment|yg\s*entertainment|",
        r"jyp\s*entertainment|big\s*hit|starship|stone\s*music|",
        r"loen|kakao|stone|ktmg|",
        r"emi|sony|universal|warner|island|columbia|atlantic|",
        r"republic|interscope|def\s*jam|epic|rca|virgin",
        r")\s*$"
    ))
    .case_insensitive(true)
    .build()
    .expect("CHANNEL_SUFFIX regex inválido")
});

static TOPIC_CHANNEL: Lazy<Regex> = Lazy::new(|| {
    RegexBuilder::new(r"^(.+?)\s*-\s*Topic$")
        .case_insensitive(true)
        .build()
        .expect("TOPIC_CHANNEL regex inválido")
});

static MULTI_ARTIST_SEP: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s*[,;]\s*|\s+/\s+").unwrap());

fn primary_artist(s: &str) -> String {
    MULTI_ARTIST_SEP.splitn(s.trim(), 2).next().unwrap_or(s).trim().to_string()
}

static ALT_SEP: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s*[|｜·•／/]\s*").unwrap());
static NUM_PREFIX: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d{1,3}[\s.\-–—:]+").unwrap());
static MULTI_SPACE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s{2,}").unwrap());
static TRAILING_DASH: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s*-\s*$").unwrap());
static LEADING_DASH: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*-\s*").unwrap());
// NUEVO respecto de escritorio: ahí se llamaba WIN_INVALID (caracteres que
// NTFS rechaza). Acá el filesystem de destino es el storage de Android
// (ext4/F2FS, mucho más permisivo) pero igual conviene evitar '/' (rompe la
// ruta) y de paso el resto de los símbolos problemáticos de Windows -- por
// si el usuario después sincroniza esta misma carpeta hacia su PC con
// SyncManager, donde sí importan.
static INVALID_FS_CHARS: Lazy<Regex> = Lazy::new(|| Regex::new(r#"[<>:"/\\|?*\x00-\x1f]"#).unwrap());
static BRACKET_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[([^\[\]]*)\]").unwrap());
static PAREN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\(([^\(\)]*)\)").unwrap());

static CHAR_MAP: &[(&str, &str)] = &[
    ("？", "?"), ("！", "!"), ("～", "~"), ("：", ":"), ("；", ";"),
    ("，", ","), ("。", "."), ("「", "\""), ("」", "\""), ("『", "'"),
    ("』", "'"), ("【", "["), ("】", "]"), ("《", "<"), ("》", ">"),
    ("·", "-"), ("•", "-"), ("‧", "-"),
    ("\u{200b}", ""), ("\u{200c}", ""), ("\u{200d}", ""), ("\u{feff}", ""),
    ("\u{2019}", "'"), ("\u{2018}", "'"), ("\u{201c}", "\""), ("\u{201d}", "\""),
    ("\u{2013}", "-"), ("\u{2014}", "-"), ("\u{2026}", "..."),
];

fn normalize_chars(t: &str) -> String {
    let mut s = t.to_string();
    for (bad, good) in CHAR_MAP.iter() {
        s = s.replace(bad, good);
    }
    s.chars().filter(|&c| c as u32 >= 0x20 || c == '\t' || c == '\n').collect()
}

fn remove_noisy_brackets(t: &str) -> String {
    let t = BRACKET_RE.replace_all(t, |caps: &regex::Captures| {
        if NOISE.is_match(&caps[1]) { String::new() } else { caps[0].to_string() }
    });
    let t = PAREN_RE.replace_all(&t, |caps: &regex::Captures| {
        if NOISE.is_match(&caps[1]) { String::new() } else { caps[0].to_string() }
    });
    t.to_string()
}

fn extract_artist_from_channel(channel: &str) -> Option<String> {
    TOPIC_CHANNEL.captures(channel.trim()).map(|c| c[1].trim().to_string())
}

fn is_emoji_or_symbol(c: char) -> bool {
    let cp = c as u32;
    (0x1F300..=0x1FAFF).contains(&cp) || (0x2600..=0x27BF).contains(&cp) || (0xFE00..=0xFE0F).contains(&cp)
}

pub fn clean_title(raw: &str, channel: &str) -> String {
    let mut t = normalize_chars(raw.trim());
    t = ALT_SEP.replace_all(&t, " - ").to_string();
    t = t.chars().filter(|&c| !is_emoji_or_symbol(c)).collect();
    t = remove_noisy_brackets(&t);
    t = CHANNEL_SUFFIX.replace(&t, "").to_string();
    t = NUM_PREFIX.replace(&t, "").to_string();
    t = MULTI_SPACE.replace_all(&t, " ").to_string();
    t = TRAILING_DASH.replace(&t, "").to_string();
    t = LEADING_DASH.replace(&t, "").to_string();
    t = t.trim_matches(|c: char| c == '.' || c == ' ').to_string();
    t = INVALID_FS_CHARS.replace_all(&t, "").to_string();
    t = t.trim().to_string();

    if !channel.is_empty() && !t.contains(" - ") {
        if let Some(artist) = extract_artist_from_channel(channel) {
            t = format!("{artist} - {t}");
        }
    }

    if t.chars().count() > 2 { t } else { raw.to_string() }
}

fn sanitize_filename(name: &str) -> String {
    let s = INVALID_FS_CHARS.replace_all(name.trim(), "").trim().to_string();
    if s.is_empty() { "cancion".to_string() } else { s }
}

fn fmt_dur(secs: i64) -> String {
    if secs <= 0 { return String::new(); }
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    if h > 0 { format!("{h}:{m:02}:{s:02}") } else { format!("{m}:{s:02}") }
}

fn detect_platform(url: &str) -> String {
    let u = url.to_lowercase();
    if u.contains("music.youtube.com") { return "YouTube Music".into(); }
    if u.contains("youtube.com") || u.contains("youtu.be") { return "YouTube".into(); }
    if u.contains("soundcloud.com") { return "SoundCloud".into(); }
    if u.contains("bandcamp.com") { return "Bandcamp".into(); }
    "Web".into()
}

// ══════════════════════════════════════════════════════════════════════════
//  RUTA DE DESTINO -- misma convención que ya usa SyncManager en la UI
//  (suggestedPath = "/storage/emulated/0/Syncthing/${label}") en vez de
//  resolver Environment.getExternalStoragePublicDirectory() por JNI: en
//  Android moderno de usuario único, /storage/emulated/0 es el storage
//  compartido primario prácticamente siempre.
// ══════════════════════════════════════════════════════════════════════════

// NUEVO (config de carpeta de descarga, pedido del usuario): antes la
// carpeta de destino estaba hardcodeada -- ahora es elegible desde
// Configuración (selector de carpeta nativo, ver folder_picker.rs) y
// persistida acá, mismo patrón que PdfConfig en pdf.rs.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloaderConfig {
    pub folder: String,
}

impl Default for DownloaderConfig {
    fn default() -> Self {
        Self { folder: "/storage/emulated/0/Music/AlejoTools".to_string() }
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("downloader_config.json"))
}

#[tauri::command]
pub fn dl_get_config(app: AppHandle) -> DownloaderConfig {
    let Ok(path) = config_path(&app) else { return DownloaderConfig::default() };
    std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

#[tauri::command]
pub fn dl_set_config(app: AppHandle, folder: String) -> Result<(), String> {
    let path = config_path(&app)?;
    let cfg = DownloaderConfig { folder: folder.trim().to_string() };
    let s = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| e.to_string())
}

fn music_dir(app: &AppHandle) -> PathBuf {
    PathBuf::from(dl_get_config(app.clone()).folder)
}

// ══════════════════════════════════════════════════════════════════════════
//  PUENTE JNI -- YtDlpBridge.kt (ver ese archivo para el patrón job+poll:
//  por qué NO se bloquea directo adentro de exec() para llamadas largas)
// ══════════════════════════════════════════════════════════════════════════

#[cfg(target_os = "android")]
async fn jni_start_fetch_info(app: &AppHandle, url: &str) -> Result<String, String> {
    use jni::objects::JValue;
    use tauri::Manager;

    let window = app.get_webview_window("main").ok_or("No se encontró la ventana principal")?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let url = url.to_string();

    window
        .with_webview(move |webview| {
            let handle = webview.jni_handle();
            handle.exec(move |env, activity, _webview| {
                let result = (|| -> Result<String, String> {
                    let class = wry::prelude::find_class(env, activity, "com.alejo.toolsmobile.YtDlpBridge".to_string())
                        .map_err(|e| format!("No se encontró YtDlpBridge: {e}"))?;
                    let url_j = env.new_string(&url).map_err(|e| e.to_string())?;
                    let job_id_obj = env
                        .call_static_method(
                            class,
                            "startFetchInfo",
                            "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
                            &[JValue::Object(activity), JValue::Object(&url_j)],
                        )
                        .and_then(|v| v.l())
                        .map_err(|e| format!("No se pudo iniciar la búsqueda: {e}"))?;
                    let job_id: String = env
                        .get_string(&job_id_obj.into())
                        .map_err(|e| e.to_string())?
                        .into();
                    Ok(job_id)
                })();
                let _ = tx.send(result);
            });
        })
        .map_err(|e| format!("No se pudo acceder al webview: {e}"))?;

    rx.await.map_err(|_| "No se obtuvo respuesta".to_string())?
}

#[cfg(target_os = "android")]
async fn jni_start_download(app: &AppHandle, url: &str, out_path: &str, quality: &str) -> Result<String, String> {
    use jni::objects::JValue;
    use tauri::Manager;

    let window = app.get_webview_window("main").ok_or("No se encontró la ventana principal")?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let url = url.to_string();
    let out_path = out_path.to_string();
    let quality = quality.to_string();

    window
        .with_webview(move |webview| {
            let handle = webview.jni_handle();
            handle.exec(move |env, activity, _webview| {
                let result = (|| -> Result<String, String> {
                    let class = wry::prelude::find_class(env, activity, "com.alejo.toolsmobile.YtDlpBridge".to_string())
                        .map_err(|e| format!("No se encontró YtDlpBridge: {e}"))?;
                    let url_j = env.new_string(&url).map_err(|e| e.to_string())?;
                    let path_j = env.new_string(&out_path).map_err(|e| e.to_string())?;
                    let quality_j = env.new_string(&quality).map_err(|e| e.to_string())?;
                    let job_id_obj = env
                        .call_static_method(
                            class,
                            "startDownload",
                            "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
                            &[JValue::Object(activity), JValue::Object(&url_j), JValue::Object(&path_j), JValue::Object(&quality_j)],
                        )
                        .and_then(|v| v.l())
                        .map_err(|e| format!("No se pudo iniciar la descarga: {e}"))?;
                    let job_id: String = env
                        .get_string(&job_id_obj.into())
                        .map_err(|e| e.to_string())?
                        .into();
                    Ok(job_id)
                })();
                let _ = tx.send(result);
            });
        })
        .map_err(|e| format!("No se pudo acceder al webview: {e}"))?;

    rx.await.map_err(|_| "No se obtuvo respuesta".to_string())?
}

#[cfg(target_os = "android")]
async fn jni_poll(app: &AppHandle, job_id: &str) -> Result<serde_json::Value, String> {
    use jni::objects::JValue;
    use tauri::Manager;

    let window = app.get_webview_window("main").ok_or("No se encontró la ventana principal")?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let job_id = job_id.to_string();

    window
        .with_webview(move |webview| {
            let handle = webview.jni_handle();
            handle.exec(move |env, activity, _webview| {
                let result = (|| -> Result<String, String> {
                    let class = wry::prelude::find_class(env, activity, "com.alejo.toolsmobile.YtDlpBridge".to_string())
                        .map_err(|e| format!("No se encontró YtDlpBridge: {e}"))?;
                    let job_id_j = env.new_string(&job_id).map_err(|e| e.to_string())?;
                    let json_obj = env
                        .call_static_method(
                            class,
                            "poll",
                            "(Ljava/lang/String;)Ljava/lang/String;",
                            &[JValue::Object(&job_id_j)],
                        )
                        .and_then(|v| v.l())
                        .map_err(|e| format!("No se pudo consultar el progreso: {e}"))?;
                    let json: String = env
                        .get_string(&json_obj.into())
                        .map_err(|e| e.to_string())?
                        .into();
                    Ok(json)
                })();
                let _ = tx.send(result);
            });
        })
        .map_err(|e| format!("No se pudo acceder al webview: {e}"))?;

    let raw = rx.await.map_err(|_| "No se obtuvo respuesta".to_string())??;
    serde_json::from_str(&raw).map_err(|e| format!("Respuesta inesperada de YtDlpBridge: {e}"))
}

#[cfg(not(target_os = "android"))]
async fn jni_start_fetch_info(_app: &AppHandle, _url: &str) -> Result<String, String> {
    Err("Descargar Música solo está disponible en Android".to_string())
}
#[cfg(not(target_os = "android"))]
async fn jni_start_download(_app: &AppHandle, _url: &str, _out_path: &str, _quality: &str) -> Result<String, String> {
    Err("Descargar Música solo está disponible en Android".to_string())
}
#[cfg(not(target_os = "android"))]
async fn jni_poll(_app: &AppHandle, _job_id: &str) -> Result<serde_json::Value, String> {
    Err("Descargar Música solo está disponible en Android".to_string())
}

/// Sondea un job hasta que termina, durmiendo entre cada intento -- ver
/// comentario de YtDlpBridge.kt sobre por qué es polling y no un callback
/// directo. 250ms es suficientemente seguido para que la barra de progreso
/// se sienta fluida sin saturar el puente JNI con llamadas.
async fn poll_until_done(app: &AppHandle, job_id: &str) -> Result<serde_json::Value, String> {
    loop {
        let v = jni_poll(app, job_id).await?;
        if v.get("status").and_then(|s| s.as_str()) == Some("done") {
            return Ok(v);
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}

// ══════════════════════════════════════════════════════════════════════════
//  COMANDOS TAURI
// ══════════════════════════════════════════════════════════════════════════

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub platform: String,
    pub title: String,
    pub artist: String,
    pub duration: String,
    pub thumbnail_url: Option<String>,
    pub track_url: String,
}

#[tauri::command]
pub async fn dl_fetch_info(app: AppHandle, url: String) -> Result<TrackInfo, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Pegá un link primero.".to_string());
    }
    let job_id = jni_start_fetch_info(&app, &url).await?;
    let result = poll_until_done(&app, &job_id).await?;

    if result.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let err = result.get("error").and_then(|v| v.as_str()).unwrap_or("Error desconocido");
        return Err(format!("No se pudo leer el link: {err}"));
    }

    let raw_title = result.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let uploader = result.get("uploader").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let duration_secs = result.get("duration").and_then(|v| v.as_i64()).unwrap_or(0);
    let thumbnail = result.get("thumbnail").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string());
    let webpage_url = result.get("webpage_url").and_then(|v| v.as_str()).unwrap_or(&url).to_string();

    let mut artist_name = primary_artist(&uploader);
    artist_name = CHANNEL_SUFFIX.replace(&artist_name, "").trim().to_string();
    if let Some(caps) = TOPIC_CHANNEL.captures(&artist_name) {
        artist_name = caps[1].trim().to_string();
    }

    let bare_title = clean_title(&raw_title, "");
    let platform = detect_platform(&webpage_url);
    let mut title = bare_title.clone();
    if !artist_name.is_empty() && platform == "YouTube Music" {
        let title_lower = title.to_lowercase();
        let artist_lower = artist_name.to_lowercase();
        if !title_lower.starts_with(&artist_lower) {
            title = format!("{artist_name} - {title}");
        }
    }

    Ok(TrackInfo {
        platform,
        title,
        artist: artist_name,
        duration: fmt_dur(duration_secs),
        thumbnail_url: thumbnail,
        track_url: webpage_url,
    })
}

#[tauri::command]
pub async fn dl_download(app: AppHandle, url: String, title: String, artist: String, quality: String) -> Result<String, String> {
    if !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\" -- pedilo desde Sincronización o en Ajustes del sistema.".to_string());
    }

    let dir = music_dir(&app);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| format!("No se pudo crear la carpeta de destino: {e}"))?;

    let base_name = if !artist.trim().is_empty() {
        format!("{} - {}", artist.trim(), title.trim())
    } else {
        title.trim().to_string()
    };
    let file_name = format!("{}.mp3", sanitize_filename(&base_name));
    let out_path = dir.join(&file_name);
    let out_path_str = out_path.to_string_lossy().to_string();

    let job_id = jni_start_download(&app, &url, &out_path_str, &quality).await?;

    loop {
        let v = jni_poll(&app, &job_id).await?;
        let status = v.get("status").and_then(|s| s.as_str()).unwrap_or("running");
        if status == "done" {
            if v.get("ok").and_then(|b| b.as_bool()) == Some(true) {
                return Ok(out_path_str);
            }
            let err = v.get("error").and_then(|e| e.as_str()).unwrap_or("Error desconocido");
            return Err(format!("No se pudo descargar: {err}"));
        }
        let progress = v.get("progress").and_then(|p| p.as_f64());
        let eta = v.get("eta").and_then(|e| e.as_i64()).filter(|&e| e >= 0);
        let _ = app.emit("dl-progress", serde_json::json!({ "progress": progress, "eta": eta }));
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}
