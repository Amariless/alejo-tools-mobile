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
// (acá solo se descarga una canción por vez), el redescargar-con-otra-
// fuente de Music Metadata Updater (que ni siquiera existe en mobile
// todavía).
//
// NUEVO (pedido del usuario -- búsqueda por nombre): sí se agregó una
// versión simplificada de la búsqueda multi-fuente de escritorio
// (find_best_candidate). A diferencia de esa, acá NO se sondea cada
// candidato por separado pidiendo su info completa uno por uno (son
// llamadas JNI reales a un proceso yt-dlp embebido, bastante más caras que
// en escritorio) -- yt-dlp resuelve "ytsearchN:"/"scsearchN:" como si
// fueran URLs de playlist y con --dump-json (sin --flat-playlist) cada
// resultado ya sale con título/duración/miniatura reales en un solo viaje.
// Bandcamp queda afuera de la búsqueda por texto (yt-dlp no tiene
// extractor de búsqueda para Bandcamp) -- se sigue soportando pegando su
// URL directa, igual que antes.

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
                    if job_id_obj.is_null() {
                        return Err("startFetchInfo devolvió null".to_string());
                    }
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

    // NUEVO (auditoría -- hallazgo MEDIO #7): sin timeout, un closure JNI
    // colgado dejaba el comando esperando para siempre.
    match tokio::time::timeout(std::time::Duration::from_secs(20), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("No se obtuvo respuesta".to_string()),
        Err(_) => Err("La búsqueda tardó demasiado en iniciar".to_string()),
    }
}

#[cfg(target_os = "android")]
async fn jni_start_search(app: &AppHandle, source: &str, query: &str) -> Result<String, String> {
    use jni::objects::JValue;
    use tauri::Manager;

    let window = app.get_webview_window("main").ok_or("No se encontró la ventana principal")?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let source = source.to_string();
    let query = query.to_string();

    window
        .with_webview(move |webview| {
            let handle = webview.jni_handle();
            handle.exec(move |env, activity, _webview| {
                let result = (|| -> Result<String, String> {
                    let class = wry::prelude::find_class(env, activity, "com.alejo.toolsmobile.YtDlpBridge".to_string())
                        .map_err(|e| format!("No se encontró YtDlpBridge: {e}"))?;
                    let source_j = env.new_string(&source).map_err(|e| e.to_string())?;
                    let query_j = env.new_string(&query).map_err(|e| e.to_string())?;
                    let job_id_obj = env
                        .call_static_method(
                            class,
                            "startSearch",
                            "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
                            &[JValue::Object(activity), JValue::Object(&source_j), JValue::Object(&query_j)],
                        )
                        .and_then(|v| v.l())
                        .map_err(|e| format!("No se pudo iniciar la búsqueda: {e}"))?;
                    if job_id_obj.is_null() {
                        return Err("startSearch devolvió null".to_string());
                    }
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

    match tokio::time::timeout(std::time::Duration::from_secs(20), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("No se obtuvo respuesta".to_string()),
        Err(_) => Err("La búsqueda tardó demasiado en iniciar".to_string()),
    }
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
                    if job_id_obj.is_null() {
                        return Err("startDownload devolvió null".to_string());
                    }
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

    // NUEVO (auditoría -- hallazgo MEDIO #7): sin timeout, un closure JNI
    // colgado dejaba el comando esperando para siempre.
    match tokio::time::timeout(std::time::Duration::from_secs(20), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("No se obtuvo respuesta".to_string()),
        Err(_) => Err("La descarga tardó demasiado en iniciar".to_string()),
    }
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
                    if json_obj.is_null() {
                        return Err("poll devolvió null".to_string());
                    }
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

    // NUEVO (auditoría -- hallazgo MEDIO #7): sin timeout, un closure JNI
    // colgado dejaba el comando esperando para siempre.
    let raw = match tokio::time::timeout(std::time::Duration::from_secs(20), rx).await {
        Ok(Ok(result)) => result?,
        Ok(Err(_)) => return Err("No se obtuvo respuesta".to_string()),
        Err(_) => return Err("La consulta de progreso tardó demasiado".to_string()),
    };
    serde_json::from_str(&raw).map_err(|e| format!("Respuesta inesperada de YtDlpBridge: {e}"))
}

#[cfg(not(target_os = "android"))]
async fn jni_start_fetch_info(_app: &AppHandle, _url: &str) -> Result<String, String> {
    Err("Descargar Música solo está disponible en Android".to_string())
}
#[cfg(not(target_os = "android"))]
async fn jni_start_search(_app: &AppHandle, _source: &str, _query: &str) -> Result<String, String> {
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
async fn poll_until_done(app: &AppHandle, job_id: &str, timeout_secs: u64) -> Result<serde_json::Value, String> {
    // NUEVO (auditoría -- hallazgo MEDIO #4): sin límite, un job que se
    // cuelga del lado de YtDlpBridge.kt (yt-dlp trabado con una URL rara)
    // dejaba este sondeo corriendo cada 250ms indefinidamente, sin ningún
    // feedback de error al usuario. timeout_secs lo elige cada llamador
    // según cuánto puede tardar razonablemente ese job (ver dl_fetch_info
    // vs dl_search, que resuelve varios candidatos de una).
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
    loop {
        let v = jni_poll(app, job_id).await?;
        if v.get("status").and_then(|s| s.as_str()) == Some("done") {
            return Ok(v);
        }
        if std::time::Instant::now() >= deadline {
            return Err("La búsqueda tardó demasiado.".to_string());
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

/// Arma un TrackInfo a partir de un JSON crudo de yt-dlp (title/uploader/
/// duration/thumbnail/webpage_url) -- extraído a función propia porque
/// dl_fetch_info (una URL pegada) y dl_search (varios candidatos de una
/// búsqueda por texto) parsean exactamente la misma forma de dato.
fn track_info_from_json(result: &serde_json::Value, fallback_url: &str) -> TrackInfo {
    let raw_title = result.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let uploader = result.get("uploader").and_then(|v| v.as_str()).unwrap_or("").to_string();
    // NUEVO (auditoría -- hallazgo MENOR #11): as_i64() devuelve None (y se
    // perdía el dato, cayendo a 0) si el bridge serializa "duration" como
    // float (ej. 213.0) en vez de entero -- as_f64() cubre ambos casos.
    let duration_secs = result.get("duration").and_then(|v| v.as_f64()).map(|f| f as i64).unwrap_or(0);
    let thumbnail = result.get("thumbnail").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string());
    let webpage_url = result.get("webpage_url").and_then(|v| v.as_str()).unwrap_or(fallback_url).to_string();

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

    TrackInfo {
        platform,
        title,
        artist: artist_name,
        duration: fmt_dur(duration_secs),
        thumbnail_url: thumbnail,
        track_url: webpage_url,
    }
}

#[tauri::command]
pub async fn dl_fetch_info(app: AppHandle, url: String) -> Result<TrackInfo, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Pegá un link primero.".to_string());
    }
    let job_id = jni_start_fetch_info(&app, &url).await?;
    let result = poll_until_done(&app, &job_id, 90).await?;

    if result.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let err = result.get("error").and_then(|v| v.as_str()).unwrap_or("Error desconocido");
        return Err(format!("No se pudo leer el link: {err}"));
    }

    Ok(track_info_from_json(&result, &url))
}

/// Búsqueda por nombre/artista -- ver el comentario grande al principio del
/// archivo sobre por qué no se sondea cada candidato por separado. YouTube y
/// SoundCloud se buscan en paralelo (tokio::join!, son 2 llamadas JNI
/// independientes) y se combinan: dentro de cada plataforma se ordena por
/// bitrate reportado (abr/tbr) cuando yt-dlp lo trae, dejando el orden de
/// relevancia original de yt-dlp para el resto -- no hay suficiente dato
/// confiable en un resultado de búsqueda (a diferencia de una URL resuelta a
/// mano) como para replicar el sondeo de bitrate real de find_best_candidate
/// de escritorio sin agregar varios segundos más de espera por candidato.
#[tauri::command]
pub async fn dl_search(app: AppHandle, query: String) -> Result<Vec<TrackInfo>, String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Err("Escribí algo para buscar.".to_string());
    }

    async fn search_one(app: &AppHandle, source: &str, query: &str) -> Result<Vec<serde_json::Value>, String> {
        let job_id = jni_start_search(app, source, query).await?;
        let result = poll_until_done(app, &job_id, 90).await?;
        if result.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            let err = result.get("error").and_then(|v| v.as_str()).unwrap_or("Error desconocido");
            return Err(err.to_string());
        }
        Ok(result.get("results").and_then(|v| v.as_array()).cloned().unwrap_or_default())
    }

    let (yt_res, sc_res) = tokio::join!(
        search_one(&app, "youtube", &query),
        search_one(&app, "soundcloud", &query),
    );

    let mut errors = Vec::new();
    let yt = yt_res.unwrap_or_else(|e| { errors.push(e); Vec::new() });
    let sc = sc_res.unwrap_or_else(|e| { errors.push(e); Vec::new() });

    if yt.is_empty() && sc.is_empty() {
        return Err(errors.into_iter().next().unwrap_or_else(|| "No se encontraron resultados.".to_string()));
    }

    fn bitrate_of(v: &serde_json::Value) -> f64 {
        v.get("abr").and_then(|x| x.as_f64())
            .or_else(|| v.get("tbr").and_then(|x| x.as_f64()))
            .unwrap_or(0.0)
    }
    let mut yt = yt;
    yt.sort_by(|a, b| bitrate_of(b).partial_cmp(&bitrate_of(a)).unwrap_or(std::cmp::Ordering::Equal));
    let mut sc = sc;
    sc.sort_by(|a, b| bitrate_of(b).partial_cmp(&bitrate_of(a)).unwrap_or(std::cmp::Ordering::Equal));

    Ok(yt.iter().chain(sc.iter()).map(|v| track_info_from_json(v, "")).collect())
}

// ══════════════════════════════════════════════════════════════════════════
//  GESTOR DE DESCARGAS -- reproducir/renombrar/eliminar mp3 ya bajados.
//  Mismo patrón que pdf_list_folder/pdf_delete_file/pdf_rename_file
//  (pdf.rs), pero con std::fs directo en vez de un puente JNI: la carpeta
//  de Música es del propio storage compartido de la app (misma que ya
//  escribe dl_download), no hace falta pasar por el AssetManager/SAF.
// ══════════════════════════════════════════════════════════════════════════

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedFile {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_at: i64,
}

#[tauri::command]
pub async fn dl_list_downloads(app: AppHandle) -> Result<Vec<DownloadedFile>, String> {
    if !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\" -- pedilo desde Sincronización o en Ajustes del sistema.".to_string());
    }
    let dir = music_dir(&app);
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(e) => e,
        // La carpeta todavía no existe (nunca se descargó nada) -- lista
        // vacía, no es un error.
        Err(_) => return Ok(Vec::new()),
    };
    let mut out = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if !path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("mp3")) {
            continue;
        }
        let Ok(meta) = entry.metadata().await else { continue };
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        out.push(DownloadedFile {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            size_bytes: meta.len(),
            modified_at,
        });
    }
    out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(out)
}

/// Valida que `path` resuelva DENTRO de la carpeta de Música configurada --
/// mismo criterio defensivo que camera_read_as_data_url en camera.rs: un
/// `path` arbitrario llegando por invoke() no debería poder borrar/renombrar
/// cualquier archivo del teléfono, aunque hoy solo lo llame el propio ui.js
/// de esta herramienta.
fn ensure_in_music_dir(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let dir = music_dir(app);
    let canon_dir = std::fs::canonicalize(&dir).unwrap_or(dir);
    let p = PathBuf::from(path);
    let canon_p = std::fs::canonicalize(&p).map_err(|_| "Archivo no encontrado.".to_string())?;
    if !canon_p.starts_with(&canon_dir) {
        return Err("Ruta inválida.".to_string());
    }
    Ok(p)
}

#[tauri::command]
pub async fn dl_delete_file(app: AppHandle, path: String) -> Result<(), String> {
    if !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\".".to_string());
    }
    let p = ensure_in_music_dir(&app, &path)?;
    tokio::fs::remove_file(&p).await.map_err(|e| format!("No se pudo borrar: {e}"))
}

#[tauri::command]
pub async fn dl_rename_file(app: AppHandle, path: String, new_name: String) -> Result<String, String> {
    if !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\".".to_string());
    }
    let p = ensure_in_music_dir(&app, &path)?;
    let new_name = new_name.trim();
    if new_name.is_empty() {
        return Err("El nombre no puede estar vacío.".to_string());
    }
    let dir = p.parent().ok_or("Ruta inválida.")?.to_path_buf();
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("mp3").to_string();
    let base = sanitize_filename(new_name.trim_end_matches(&format!(".{ext}")));
    let new_path = dir.join(format!("{base}.{ext}"));
    tokio::fs::rename(&p, &new_path).await.map_err(|e| format!("No se pudo renombrar: {e}"))?;
    Ok(new_path.to_string_lossy().to_string())
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

    // NUEVO (auditoría -- hallazgo MEDIO #4): sin límite, un job que se
    // cuelga del lado de YtDlpBridge.kt dejaba este sondeo corriendo cada
    // 250ms indefinidamente. 30 minutos es de sobra incluso para una
    // descarga larga en una conexión lenta.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30 * 60);
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
        if std::time::Instant::now() >= deadline {
            return Err("La descarga tardó demasiado.".to_string());
        }
        let progress = v.get("progress").and_then(|p| p.as_f64());
        let eta = v.get("eta").and_then(|e| e.as_i64()).filter(|&e| e >= 0);
        let _ = app.emit("dl-progress", serde_json::json!({ "progress": progress, "eta": eta }));
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}
