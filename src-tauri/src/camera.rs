// camera.rs — cámara nativa completa (Creador de Texturas, pedido del
// usuario) por JNI, mismo patrón job+poll que folder_picker.rs (ver ese
// archivo para la explicación completa del "key" + por qué no basta con
// una promesa que espera una sola vez: Android puede matar el proceso de
// la app mientras la Activity de cámara del sistema está al frente).
//
// A diferencia de <input type=file capture=environment> del WebView
// (usado en Paleta de Colores/Creador de Texturas hasta ahora, sigue
// sirviendo para "Elegir de galería"), esto lanza la app de cámara REAL
// del sistema con todos sus modos -- ver MainActivity.launchCameraCapture
// y CameraCapture.kt.
use tauri::AppHandle;

#[cfg(target_os = "android")]
async fn call_activity_launch_camera(app: &AppHandle, key: &str) -> Result<(), String> {
    use jni::objects::JValue;
    use tauri::Manager as _;

    let window = app.get_webview_window("main").ok_or("No se encontró la ventana principal")?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let key = key.to_string();

    window
        .with_webview(move |webview| {
            let handle = webview.jni_handle();
            handle.exec(move |env, activity, _webview| {
                let result = (|| -> Result<(), String> {
                    let key_j = env.new_string(&key).map_err(|e| e.to_string())?;
                    env.call_method(activity, "launchCameraCapture", "(Ljava/lang/String;)V", &[JValue::Object(&key_j)])
                        .map(|_| ())
                        .map_err(|e| format!("Error llamando launchCameraCapture: {e}"))
                })();
                let _ = tx.send(result);
            });
        })
        .map_err(|e| format!("No se pudo acceder al webview: {e}"))?;

    rx.await.map_err(|_| "No se obtuvo respuesta".to_string())?
}

#[cfg(not(target_os = "android"))]
async fn call_activity_launch_camera(_app: &AppHandle, _key: &str) -> Result<(), String> {
    Err("La cámara solo está disponible en Android".to_string())
}

#[cfg(target_os = "android")]
async fn call_camera_capture_poll(app: &AppHandle) -> Result<String, String> {
    use tauri::Manager as _;

    let window = app.get_webview_window("main").ok_or("No se encontró la ventana principal")?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();

    window
        .with_webview(move |webview| {
            let handle = webview.jni_handle();
            handle.exec(move |env, activity, _webview| {
                let result = (|| -> Result<String, String> {
                    let class = wry::prelude::find_class(env, activity, "com.alejo.toolsmobile.CameraCapture".to_string())
                        .map_err(|e| format!("No se encontró CameraCapture: {e}"))?;
                    let ret_obj = env
                        .call_static_method(class, "poll", "()Ljava/lang/String;", &[])
                        .and_then(|v| v.l())
                        .map_err(|e| format!("Error llamando poll: {e}"))?;
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
async fn call_camera_capture_poll(_app: &AppHandle) -> Result<String, String> {
    Err("La cámara solo está disponible en Android".to_string())
}

/// "key" identifica para qué pedido es esta captura (ej. "texturas") --
/// viaja hasta el resultado (ver camera_capture_poll) por el mismo motivo
/// que pick_folder_start, ver folder_picker.rs.
#[tauri::command]
pub async fn camera_capture_start(app: AppHandle, key: String) -> Result<(), String> {
    call_activity_launch_camera(&app, &key).await
}

/// `{"ready": false}` mientras la app de cámara sigue abierta, o
/// `{"ready": true, "path": "...", "key": "..."}` una vez que hay
/// resultado ("path" vacío significa que el usuario canceló sin sacar
/// nada).
#[tauri::command]
pub async fn camera_capture_poll(app: AppHandle) -> Result<serde_json::Value, String> {
    let raw = call_camera_capture_poll(&app).await?;
    serde_json::from_str(&raw).map_err(|e| format!("Respuesta inesperada: {e}"))
}

/// NUEVO (bug real encontrado en vivo, no un misterio de touch/hit-testing
/// como se sospechó al principio): el JS de Creador de Texturas necesita
/// leer los píxeles de la foto capturada (canvas.getImageData, para poder
/// recortarla y generar los mapas) -- para eso NO alcanza con mostrar la
/// foto vía convertFileSrc()/<img src> como se hace en el resto de la app
/// (ahí sí alcanza, es solo para mostrarla). El asset protocol de Tauri
/// sirve el archivo desde un origen distinto al de la página
/// (http://tauri.localhost) sin headers CORS -- cualquier <canvas> donde
/// se dibuje esa imagen queda "tainted" (contaminado) y
/// getImageData()/toDataURL() tiran SecurityError. Confirmado en vivo con
/// Chrome DevTools Protocol conectado al WebView real (ver sesión): el tap
/// en los botones de recorte SÍ llegaba al handler, pero el handler
/// reventaba adentro con exactamente ese error -- por eso parecía que el
/// botón "no respondía". La foto de galería (<input type=file>) nunca tuvo
/// este problema porque usa un blob: URL, que no taintea nada.
/// Arreglo: en vez de convertFileSrc, leer el archivo acá y devolverlo
/// como data: URL -- un data: URL nunca contamina un canvas sin importar
/// el origen de la página.
#[tauri::command]
pub fn camera_read_as_data_url(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("No se pudo leer la foto: {e}"))?;
    let mime = if path.to_lowercase().ends_with(".png") { "image/png" } else { "image/jpeg" };
    Ok(format!("data:{mime};base64,{}", crate::textures::base64_encode(&bytes)))
}
