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
//  PUENTE JNI -- PdfBridge.kt
// ══════════════════════════════════════════════════════════════════════════

#[cfg(target_os = "android")]
async fn call_pdf_bridge_static_str(
    app: &AppHandle,
    method: &'static str,
    sig: &'static str,
    args_json: Vec<String>,
) -> Result<String, String> {
    use jni::objects::JValue;
    use tauri::Manager as _;

    let window = app.get_webview_window("main").ok_or("No se encontró la ventana principal")?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();

    window
        .with_webview(move |webview| {
            let handle = webview.jni_handle();
            handle.exec(move |env, activity, _webview| {
                let result = (|| -> Result<String, String> {
                    let class = wry::prelude::find_class(env, activity, "com.alejo.toolsmobile.PdfBridge".to_string())
                        .map_err(|e| format!("No se encontró PdfBridge: {e}"))?;
                    let jstrings: Vec<_> = args_json
                        .iter()
                        .map(|s| env.new_string(s).map_err(|e| e.to_string()))
                        .collect::<Result<_, _>>()?;
                    // NUEVO (bug real de compilación en el build de Android,
                    // no lo detecta `cargo check` en Windows porque este
                    // bloque es cfg(target_os = "android")): pasar
                    // JValue::Object directo como puntero a función no
                    // aplica auto-deref de &JString a &JObject -- envuelto
                    // en closure sí, porque ahí es una llamada normal.
                    let jvalues: Vec<JValue> = jstrings.iter().map(|s| JValue::Object(s)).collect();
                    let ret_obj = env
                        .call_static_method(class, method, sig, &jvalues)
                        .and_then(|v| v.l())
                        .map_err(|e| format!("Error llamando {method}: {e}"))?;
                    let ret: String = env.get_string(&ret_obj.into()).map_err(|e| e.to_string())?.into();
                    Ok(ret)
                })();
                let _ = tx.send(result);
            });
        })
        .map_err(|e| format!("No se pudo acceder al webview: {e}"))?;

    rx.await.map_err(|_| "No se obtuvo respuesta".to_string())?
}

#[cfg(not(target_os = "android"))]
async fn call_pdf_bridge_static_str(
    _app: &AppHandle,
    _method: &'static str,
    _sig: &'static str,
    _args_json: Vec<String>,
) -> Result<String, String> {
    Err("Lector de PDF solo está disponible en Android".to_string())
}

// "open" necesita el Context de la Activity como primer argumento Java, a
// diferencia del resto -- se llama aparte porque ese argumento no es un
// String como los demás.
#[cfg(target_os = "android")]
async fn call_pdf_bridge_open(app: &AppHandle, path_or_uri: &str) -> Result<String, String> {
    use jni::objects::JValue;
    use tauri::Manager as _;

    let window = app.get_webview_window("main").ok_or("No se encontró la ventana principal")?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let path_or_uri = path_or_uri.to_string();

    window
        .with_webview(move |webview| {
            let handle = webview.jni_handle();
            handle.exec(move |env, activity, _webview| {
                let result = (|| -> Result<String, String> {
                    let class = wry::prelude::find_class(env, activity, "com.alejo.toolsmobile.PdfBridge".to_string())
                        .map_err(|e| format!("No se encontró PdfBridge: {e}"))?;
                    let uri_j = env.new_string(&path_or_uri).map_err(|e| e.to_string())?;
                    let ret_obj = env
                        .call_static_method(
                            class,
                            "open",
                            "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
                            &[JValue::Object(activity), JValue::Object(&uri_j)],
                        )
                        .and_then(|v| v.l())
                        .map_err(|e| format!("No se pudo abrir el PDF: {e}"))?;
                    let ret: String = env.get_string(&ret_obj.into()).map_err(|e| e.to_string())?.into();
                    Ok(ret)
                })();
                let _ = tx.send(result);
            });
        })
        .map_err(|e| format!("No se pudo acceder al webview: {e}"))?;

    rx.await.map_err(|_| "No se obtuvo respuesta".to_string())?
}

#[cfg(not(target_os = "android"))]
async fn call_pdf_bridge_open(_app: &AppHandle, _path_or_uri: &str) -> Result<String, String> {
    Err("Lector de PDF solo está disponible en Android".to_string())
}

// "renderPage" recibe (String, int, int) -- a diferencia del resto de los
// métodos de PdfBridge, que son todos (String...) -- así que no puede
// reusar call_pdf_bridge_static_str (arma todos los argumentos como
// JString). NUEVO: bug real confirmado en vivo -- pasar los números como
// JValue::Object(JString) contra una firma "(Ljava/lang/String;II)..."
// tira "Invalid number or type of arguments passed to java method" porque
// Java espera enteros primitivos (I), no objetos String, en esa posición.
#[cfg(target_os = "android")]
async fn call_pdf_bridge_render_page(app: &AppHandle, session_id: &str, page_index: u32, max_width: u32) -> Result<String, String> {
    use jni::objects::JValue;
    use tauri::Manager as _;

    let window = app.get_webview_window("main").ok_or("No se encontró la ventana principal")?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let session_id = session_id.to_string();
    let page_index = page_index as i32;
    let max_width = max_width as i32;

    window
        .with_webview(move |webview| {
            let handle = webview.jni_handle();
            handle.exec(move |env, activity, _webview| {
                let result = (|| -> Result<String, String> {
                    let class = wry::prelude::find_class(env, activity, "com.alejo.toolsmobile.PdfBridge".to_string())
                        .map_err(|e| format!("No se encontró PdfBridge: {e}"))?;
                    let sid_j = env.new_string(&session_id).map_err(|e| e.to_string())?;
                    let ret_obj = env
                        .call_static_method(
                            class,
                            "renderPage",
                            "(Ljava/lang/String;II)Ljava/lang/String;",
                            &[JValue::Object(&sid_j), JValue::Int(page_index), JValue::Int(max_width)],
                        )
                        .and_then(|v| v.l())
                        .map_err(|e| format!("Error llamando renderPage: {e}"))?;
                    let ret: String = env.get_string(&ret_obj.into()).map_err(|e| e.to_string())?.into();
                    Ok(ret)
                })();
                let _ = tx.send(result);
            });
        })
        .map_err(|e| format!("No se pudo acceder al webview: {e}"))?;

    rx.await.map_err(|_| "No se obtuvo respuesta".to_string())?
}

#[cfg(not(target_os = "android"))]
async fn call_pdf_bridge_render_page(_app: &AppHandle, _session_id: &str, _page_index: u32, _max_width: u32) -> Result<String, String> {
    Err("Lector de PDF solo está disponible en Android".to_string())
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

#[cfg(target_os = "android")]
async fn close_impl(app: &AppHandle, session_id: &str) -> Result<(), String> {
    use jni::objects::JValue;
    use tauri::Manager as _;

    let window = app.get_webview_window("main").ok_or("No se encontró la ventana principal")?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let session_id = session_id.to_string();

    window
        .with_webview(move |webview| {
            let handle = webview.jni_handle();
            handle.exec(move |env, activity, _webview| {
                let result = (|| -> Result<(), String> {
                    let class = wry::prelude::find_class(env, activity, "com.alejo.toolsmobile.PdfBridge".to_string())
                        .map_err(|e| format!("No se encontró PdfBridge: {e}"))?;
                    let sid_j = env.new_string(&session_id).map_err(|e| e.to_string())?;
                    env.call_static_method(class, "close", "(Ljava/lang/String;)V", &[JValue::Object(&sid_j)])
                        .map_err(|e| format!("No se pudo cerrar el PDF: {e}"))?;
                    Ok(())
                })();
                let _ = tx.send(result);
            });
        })
        .map_err(|e| format!("No se pudo acceder al webview: {e}"))?;

    rx.await.map_err(|_| "No se obtuvo respuesta".to_string())?
}

#[cfg(not(target_os = "android"))]
async fn close_impl(_app: &AppHandle, _session_id: &str) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn pdf_take_pending_uri(app: AppHandle) -> Result<String, String> {
    call_pdf_bridge_static_str(&app, "takePendingUri", "()Ljava/lang/String;", vec![]).await
}
