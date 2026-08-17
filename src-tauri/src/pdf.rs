// pdf.rs — Lector de PDF (mobile).
//
// El render en sí vive en PdfBridge.kt (Kotlin), sobre
// android.graphics.pdf.PdfRenderer -- parte del SDK de Android, no hace
// falta ninguna librería tipo pdf.js embebida. Acá solo está el puente JNI
// (mismo mecanismo que downloader.rs/installer.rs/storage.rs:
// WebviewWindow::with_webview(...).jni_handle().exec(...) +
// wry::prelude::find_class) y la persistencia de la carpeta configurada.
//
// A diferencia de YtDlpBridge (que usa un patrón job+poll porque
// descargar tarda segundos/minutos), acá se llama directo y se espera la
// respuesta: renderizar una página de PDF a bitmap tarda milisegundos, no
// hay riesgo real de ANR por una llamada tan corta.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PdfConfig {
    pub folder: String,
}

impl Default for PdfConfig {
    fn default() -> Self {
        // Misma convención que SyncManager (suggestedPath en ui.js): en
        // Android moderno de usuario único, /storage/emulated/0 es el
        // storage compartido primario prácticamente siempre.
        Self { folder: "/storage/emulated/0/Download".to_string() }
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("pdf_config.json"))
}

#[tauri::command]
pub fn pdf_get_config(app: AppHandle) -> PdfConfig {
    let Ok(path) = config_path(&app) else { return PdfConfig::default() };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn pdf_set_config(app: AppHandle, folder: String) -> Result<(), String> {
    let path = config_path(&app)?;
    let cfg = PdfConfig { folder: folder.trim().to_string() };
    let s = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| e.to_string())
}

// ══════════════════════════════════════════════════════════════════════════
//  PROGRESO DE LECTURA -- mismo patrón que book_progress.json de epub.rs
//  (local, no viaja por SyncManager, ver la nota grande en epub.rs sobre
//  el porqué). NUEVO respecto de la primera versión: antes el Lector de
//  PDF no recordaba nada -- hacía falta para la miniatura de "última
//  página leída" que pidió el usuario en la lista de archivos.
// ══════════════════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PdfProgress {
    pub page_index: u32,
    pub scroll_fraction: f64,
    pub updated_at: i64,
}

fn progress_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("pdf_progress.json"))
}

fn read_all_progress(app: &AppHandle) -> std::collections::HashMap<String, PdfProgress> {
    let Ok(path) = progress_path(app) else { return Default::default() };
    std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn write_all_progress(app: &AppHandle, all: &std::collections::HashMap<String, PdfProgress>) -> Result<(), String> {
    let path = progress_path(app)?;
    let s = serde_json::to_string_pretty(all).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pdf_get_progress(app: AppHandle, path: String) -> Option<PdfProgress> {
    read_all_progress(&app).get(&path).cloned()
}

#[tauri::command]
pub fn pdf_set_progress(app: AppHandle, path: String, page_index: u32, scroll_fraction: f64) -> Result<(), String> {
    let mut all = read_all_progress(&app);
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    all.insert(path, PdfProgress { page_index, scroll_fraction, updated_at: now });
    write_all_progress(&app, &all)
}

// ══════════════════════════════════════════════════════════════════════════
//  PUENTE JNI -- PdfBridge.kt
// ══════════════════════════════════════════════════════════════════════════

// NUEVO (revisión de código -- deduplicación): las funciones de este
// archivo que llaman a un método estático de PdfBridge.kt vía JNI
// compartían ~25 líneas idénticas (buscar la ventana, armar el canal
// oneshot, with_webview + jni_handle().exec, find_class, mandar el
// resultado por el canal, esperarlo) y solo diferían en qué argumentos
// arman y cómo interpretan el valor de vuelta -- esa duplicación fue la
// causa directa de los dos bugs de JNI reales que aparecieron en esta
// misma sesión (uno en el armado de argumentos, otro en la firma de
// renderPage). call_pdf_bridge() de acá abajo factoriza exactamente esa
// parte común; cada llamada específica (más abajo) le pasa un closure con
// SOLO la lógica que realmente cambia entre métodos: qué JValues arma y
// cómo interpreta el valor de vuelta.
//
// El closure en sí (jni::objects::JValue, env.new_string, etc.) compila
// en cualquier plataforma -- "jni" es una dependencia normal de Cargo.toml,
// no gateada por target, son solo bindings de tipos sin necesitar una JVM
// real para compilar. Lo único específico de Android es EJECUTAR el
// closure (with_webview/jni_handle/find_class, que sí vienen de "wry",
// gateada solo para Android en Cargo.toml) -- por eso solo call_pdf_bridge
// necesita dos versiones (real / stub), no cada call site.
//
// La firma del closure (`&mut JNIEnv, JClass, &JObject` sin lifetimes
// explícitos) copia tal cual la de `JniHandle::exec` en wry 0.55
// (`FnOnce(&mut JNIEnv, &JObject, &JObject) + Send + 'static`, ver
// wry::android::JniHandle) -- necesario para que el elision de lifetimes
// de Rust trate esto como higher-ranked igual que el propio exec().
#[cfg(target_os = "android")]
async fn call_pdf_bridge<T, F>(app: &AppHandle, build: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut jni::JNIEnv, jni::objects::JClass, &jni::objects::JObject) -> Result<T, String> + Send + 'static,
{
    use tauri::Manager as _;

    let window = app.get_webview_window("main").ok_or("No se encontró la ventana principal")?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<T, String>>();

    window
        .with_webview(move |webview| {
            let handle = webview.jni_handle();
            handle.exec(move |env, activity, _webview| {
                let result = (|| -> Result<T, String> {
                    let class = wry::prelude::find_class(env, activity, "com.alejo.toolsmobile.PdfBridge".to_string())
                        .map_err(|e| format!("No se encontró PdfBridge: {e}"))?;
                    build(env, class, activity)
                })();
                let _ = tx.send(result);
            });
        })
        .map_err(|e| format!("No se pudo acceder al webview: {e}"))?;

    rx.await.map_err(|_| "No se obtuvo respuesta".to_string())?
}

#[cfg(not(target_os = "android"))]
async fn call_pdf_bridge<T, F>(_app: &AppHandle, _build: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut jni::JNIEnv, jni::objects::JClass, &jni::objects::JObject) -> Result<T, String> + Send + 'static,
{
    Err("Lector de PDF solo está disponible en Android".to_string())
}

/// Extrae el String de vuelta de un método JNI que devuelve
/// `Ljava/lang/String;` -- repetido en los 3 call sites de abajo que
/// devuelven texto (a diferencia de "close", que devuelve void).
fn jstring_result(env: &mut jni::JNIEnv, ret: Result<jni::objects::JValueOwned, jni::errors::Error>, ctx: &str) -> Result<String, String> {
    let ret_obj = ret.and_then(|v| v.l()).map_err(|e| format!("{ctx}: {e}"))?;
    Ok(env.get_string(&ret_obj.into()).map_err(|e| e.to_string())?.into())
}

async fn call_pdf_bridge_static_str(app: &AppHandle, method: &'static str, sig: &'static str, args_json: Vec<String>) -> Result<String, String> {
    use jni::objects::JValue;
    call_pdf_bridge(app, move |env, class, _activity| {
        let jstrings: Vec<_> = args_json.iter().map(|s| env.new_string(s).map_err(|e| e.to_string())).collect::<Result<_, _>>()?;
        // NUEVO (bug real de compilación en el build de Android, no lo
        // detecta `cargo check` en Windows porque call_pdf_bridge (arriba)
        // solo EJECUTA este closure del lado Android): pasar JValue::Object
        // directo como puntero a función no aplica auto-deref de &JString
        // a &JObject -- envuelto en closure sí, porque ahí es una llamada
        // normal.
        let jvalues: Vec<JValue> = jstrings.iter().map(|s| JValue::Object(s)).collect();
        let ret = env.call_static_method(class, method, sig, &jvalues);
        jstring_result(env, ret, &format!("Error llamando {method}"))
    })
    .await
}

// "open" necesita el Context de la Activity como primer argumento Java, a
// diferencia del resto -- se llama aparte porque ese argumento no es un
// String como los demás.
async fn call_pdf_bridge_open(app: &AppHandle, path_or_uri: &str) -> Result<String, String> {
    use jni::objects::JValue;
    let path_or_uri = path_or_uri.to_string();
    call_pdf_bridge(app, move |env, class, activity| {
        let uri_j = env.new_string(&path_or_uri).map_err(|e| e.to_string())?;
        let ret = env.call_static_method(
            class,
            "open",
            "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
            &[JValue::Object(activity), JValue::Object(&uri_j)],
        );
        jstring_result(env, ret, "No se pudo abrir el PDF")
    })
    .await
}

// "renderPage" recibe (String, int, int) -- a diferencia del resto de los
// métodos de PdfBridge, que son todos (String...) -- así que arma sus
// propios JValue en vez de reusar call_pdf_bridge_static_str (que asume
// todos los argumentos son JString). NUEVO: bug real confirmado en
// vivo -- pasar los números como JValue::Object(JString) contra una
// firma "(Ljava/lang/String;II)..." tira "Invalid number or type of
// arguments passed to java method" porque Java espera enteros primitivos
// (I), no objetos String, en esa posición.
async fn call_pdf_bridge_render_page(app: &AppHandle, session_id: &str, page_index: u32, max_width: u32) -> Result<String, String> {
    use jni::objects::JValue;
    let session_id = session_id.to_string();
    let page_index = page_index as i32;
    let max_width = max_width as i32;
    call_pdf_bridge(app, move |env, class, _activity| {
        let sid_j = env.new_string(&session_id).map_err(|e| e.to_string())?;
        let ret = env.call_static_method(
            class,
            "renderPage",
            "(Ljava/lang/String;II)Ljava/lang/String;",
            &[JValue::Object(&sid_j), JValue::Int(page_index), JValue::Int(max_width)],
        );
        jstring_result(env, ret, "Error llamando renderPage")
    })
    .await
}

// "renderThumbnail" recibe (String, int, int) -- mismo motivo que
// renderPage arriba para armar sus propios JValue en vez de reusar
// call_pdf_bridge_static_str.
async fn call_pdf_bridge_thumbnail(app: &AppHandle, path: &str, page_index: u32, max_width: u32) -> Result<String, String> {
    use jni::objects::JValue;
    let path = path.to_string();
    let page_index = page_index as i32;
    let max_width = max_width as i32;
    call_pdf_bridge(app, move |env, class, _activity| {
        let path_j = env.new_string(&path).map_err(|e| e.to_string())?;
        let ret = env.call_static_method(
            class,
            "renderThumbnail",
            "(Ljava/lang/String;II)Ljava/lang/String;",
            &[JValue::Object(&path_j), JValue::Int(page_index), JValue::Int(max_width)],
        );
        jstring_result(env, ret, "Error llamando renderThumbnail")
    })
    .await
}

async fn call_pdf_bridge_rename(app: &AppHandle, path: &str, new_name: &str) -> Result<String, String> {
    use jni::objects::JValue;
    let path = path.to_string();
    let new_name = new_name.to_string();
    call_pdf_bridge(app, move |env, class, _activity| {
        let path_j = env.new_string(&path).map_err(|e| e.to_string())?;
        let name_j = env.new_string(&new_name).map_err(|e| e.to_string())?;
        let ret = env.call_static_method(
            class,
            "renameFile",
            "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
            &[JValue::Object(&path_j), JValue::Object(&name_j)],
        );
        jstring_result(env, ret, "Error llamando renameFile")
    })
    .await
}

// ══════════════════════════════════════════════════════════════════════════
//  COMANDOS TAURI
// ══════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn pdf_list_folder(app: AppHandle, folder: String) -> Result<Vec<serde_json::Value>, String> {
    if !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\" -- pedilo desde Sincronización o en Ajustes del sistema.".to_string());
    }
    let raw = call_pdf_bridge_static_str(&app, "listFolder", "(Ljava/lang/String;)Ljava/lang/String;", vec![folder]).await?;
    serde_json::from_str(&raw).map_err(|e| format!("Respuesta inesperada: {e}"))
}

#[tauri::command]
pub async fn pdf_open(app: AppHandle, path_or_uri: String) -> Result<serde_json::Value, String> {
    // NUEVO (revisión de código): a diferencia de pdf_list_folder, este
    // comando aceptaba cualquier path/URI crudo desde IPC sin gate de
    // permiso. Pero una URI content:// (el caso normal de "Abrir con...",
    // ver MainActivity.kt/PdfBridge.kt) ya viene con su propio permiso de
    // acceso otorgado por el Intent que la trajo -- exigir acá el permiso
    // amplio de "Acceso a todos los archivos" rompería justo ese flujo para
    // un usuario que nunca lo otorgó. Solo se exige para rutas de archivo
    // crudas (las que vienen de listar la carpeta configurada), igual que
    // pdf_list_folder.
    if !path_or_uri.starts_with("content://") && !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\" -- pedilo desde Sincronización o en Ajustes del sistema.".to_string());
    }
    let raw = call_pdf_bridge_open(&app, &path_or_uri).await?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| format!("Respuesta inesperada: {e}"))?;
    if v.get("ok").and_then(|b| b.as_bool()) != Some(true) {
        let err = v.get("error").and_then(|e| e.as_str()).unwrap_or("Error desconocido");
        return Err(format!("No se pudo abrir el PDF: {err}"));
    }
    Ok(v)
}

#[tauri::command]
pub async fn pdf_render_page(app: AppHandle, session_id: String, page_index: u32, max_width: u32) -> Result<serde_json::Value, String> {
    let raw = call_pdf_bridge_render_page(&app, &session_id, page_index, max_width).await?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| format!("Respuesta inesperada: {e}"))?;
    if v.get("ok").and_then(|b| b.as_bool()) != Some(true) {
        let err = v.get("error").and_then(|e| e.as_str()).unwrap_or("Error desconocido");
        return Err(format!("No se pudo renderizar la página: {err}"));
    }
    Ok(v)
}

#[tauri::command]
pub async fn pdf_close(app: AppHandle, session_id: String) -> Result<(), String> {
    // PdfBridge.close() en Kotlin devuelve Unit (void), no un String como
    // el resto de los métodos -- por eso no usa call_pdf_bridge_static_str
    // (armado para respuestas String) y tiene su propia llamada JNI acá
    // abajo con firma "(Ljava/lang/String;)V".
    close_impl(&app, &session_id).await
}

async fn close_impl(app: &AppHandle, session_id: &str) -> Result<(), String> {
    use jni::objects::JValue;
    let session_id = session_id.to_string();
    let result = call_pdf_bridge(app, move |env, class, _activity| {
        let sid_j = env.new_string(&session_id).map_err(|e| e.to_string())?;
        env.call_static_method(class, "close", "(Ljava/lang/String;)V", &[JValue::Object(&sid_j)])
            .map_err(|e| format!("No se pudo cerrar el PDF: {e}"))?;
        Ok(())
    })
    .await;
    // A diferencia de las demás llamadas, "cerrar algo que nunca se abrió"
    // fuera de Android (call_pdf_bridge ahí es el stub que siempre
    // devuelve Err) no debería ser un error real -- pero solo ahí: un
    // Err real del lado Android (el close en sí falló) sí se propaga
    // igual que antes.
    #[cfg(not(target_os = "android"))]
    {
        let _ = result;
        Ok(())
    }
    #[cfg(target_os = "android")]
    {
        result
    }
}

#[tauri::command]
pub async fn pdf_take_pending_uri(app: AppHandle) -> Result<String, String> {
    call_pdf_bridge_static_str(&app, "takePendingUri", "()Ljava/lang/String;", vec![]).await
}

/// Miniatura chica de una página -- la primera si el archivo nunca se
/// abrió, o la última leída si hay progreso guardado (ver pdf_get_progress,
/// lo decide el frontend antes de llamar acá). No requiere sesión abierta.
#[tauri::command]
pub async fn pdf_get_thumbnail(app: AppHandle, path: String, page_index: u32, max_width: u32) -> Result<String, String> {
    let raw = call_pdf_bridge_thumbnail(&app, &path, page_index, max_width).await?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| format!("Respuesta inesperada: {e}"))?;
    if v.get("ok").and_then(|b| b.as_bool()) != Some(true) {
        let err = v.get("error").and_then(|e| e.as_str()).unwrap_or("Error desconocido");
        return Err(format!("No se pudo generar la miniatura: {err}"));
    }
    let png = v.get("png").and_then(|p| p.as_str()).unwrap_or("").to_string();
    Ok(png)
}

/// Borra un .pdf de la carpeta configurada -- también limpia su progreso
/// guardado (si no, quedaría un registro huérfano en pdf_progress.json).
#[tauri::command]
pub async fn pdf_delete_file(app: AppHandle, path: String) -> Result<(), String> {
    if !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\".".to_string());
    }
    let raw = call_pdf_bridge_static_str(&app, "deleteFile", "(Ljava/lang/String;)Ljava/lang/String;", vec![path.clone()]).await?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| format!("Respuesta inesperada: {e}"))?;
    if v.get("ok").and_then(|b| b.as_bool()) != Some(true) {
        let err = v.get("error").and_then(|e| e.as_str()).unwrap_or("Error desconocido");
        return Err(format!("No se pudo borrar el archivo: {err}"));
    }
    let mut all = read_all_progress(&app);
    if all.remove(&path).is_some() { let _ = write_all_progress(&app, &all); }
    Ok(())
}

/// Renombra un .pdf -- migra también su progreso guardado (queda indexado
/// por ruta, ver PdfProgress) para no perder "dónde iba" solo por
/// cambiarle el nombre al archivo.
#[tauri::command]
pub async fn pdf_rename_file(app: AppHandle, path: String, new_name: String) -> Result<String, String> {
    if !crate::storage::has_all_files_access(&app).await? {
        return Err("Falta el permiso \"Acceso a todos los archivos\".".to_string());
    }
    let raw = call_pdf_bridge_rename(&app, &path, &new_name).await?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| format!("Respuesta inesperada: {e}"))?;
    if v.get("ok").and_then(|b| b.as_bool()) != Some(true) {
        let err = v.get("error").and_then(|e| e.as_str()).unwrap_or("Error desconocido");
        return Err(format!("No se pudo renombrar el archivo: {err}"));
    }
    let new_path = v.get("path").and_then(|p| p.as_str()).unwrap_or(&new_name).to_string();
    let mut all = read_all_progress(&app);
    if let Some(prog) = all.remove(&path) {
        all.insert(new_path.clone(), prog);
        let _ = write_all_progress(&app, &all);
    }
    Ok(new_path)
}
