// folder_picker.rs — selector de carpeta nativo de Android (Storage
// Access Framework), pedido explícito del usuario en vez de escribir
// rutas a mano en cada herramienta.
//
// Patrón job+poll (como YtDlpBridge, no como PdfBridge): abrir el picker
// del sistema y esperar a que el usuario elija implica lanzar una Activity
// e ir y volver -- no es instantáneo como renderizar una página de PDF,
// así que bloquear adentro de jni_handle().exec() (que corre en el hilo
// del WebView) no es una opción. En vez de eso:
//   1. pick_folder_start() llama a MainActivity.launchFolderPicker() (un
//      método de INSTANCIA de la propia Activity, no hace falta
//      find_class -- ya tenemos el objeto activity a mano en el closure
//      de JNI) que dispara un ActivityResultLauncher registrado en
//      onCreate().
//   2. Cuando el usuario elige (o cancela), el callback del launcher deja
//      el resultado en FolderPicker.kt (objeto Kotlin con un campo
//      volatile, mismo mecanismo "consume-once" que PdfBridge.
//      pendingUri).
//   3. El frontend hace poll (pick_folder_poll()) cada tanto hasta que
//      "ready" da true.
//
// Sobre el path devuelto: el picker nativo (ACTION_OPEN_DOCUMENT_TREE)
// devuelve una URI content://, no una ruta cruda -- pero como la app ya
// pide "Acceso a todos los archivos" (MANAGE_EXTERNAL_STORAGE) para todo
// lo demás, no tiene sentido migrar el resto del código a leer por
// DocumentsContract/content resolver solo para esto. MainActivity.kt
// decodifica la URI de vuelta a una ruta cruda de /storage/emulated/0/...
// cuando es del volumen "primary" (el caso normal de un solo storage
// interno) -- eso es lo que este módulo termina devolviendo, así que
// pdf_list_folder/book_list_folder/etc. no necesitan cambiar nada.
use tauri::AppHandle;

#[cfg(target_os = "android")]
async fn call_activity_launch_folder_picker(app: &AppHandle, key: &str) -> Result<(), String> {
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
                    // Método de instancia de la propia Activity -- no
                    // hace falta find_class, ya tenemos el objeto.
                    env.call_method(activity, "launchFolderPicker", "(Ljava/lang/String;)V", &[JValue::Object(&key_j)])
                        .map(|_| ())
                        .map_err(|e| format!("Error llamando launchFolderPicker: {e}"))
                })();
                let _ = tx.send(result);
            });
        })
        .map_err(|e| format!("No se pudo acceder al webview: {e}"))?;

    rx.await.map_err(|_| "No se obtuvo respuesta".to_string())?
}

#[cfg(not(target_os = "android"))]
async fn call_activity_launch_folder_picker(_app: &AppHandle, _key: &str) -> Result<(), String> {
    Err("El selector de carpeta solo está disponible en Android".to_string())
}

#[cfg(target_os = "android")]
async fn call_folder_picker_poll(app: &AppHandle) -> Result<String, String> {
    use tauri::Manager as _;

    let window = app.get_webview_window("main").ok_or("No se encontró la ventana principal")?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();

    window
        .with_webview(move |webview| {
            let handle = webview.jni_handle();
            handle.exec(move |env, activity, _webview| {
                let result = (|| -> Result<String, String> {
                    let class = wry::prelude::find_class(env, activity, "com.alejo.toolsmobile.FolderPicker".to_string())
                        .map_err(|e| format!("No se encontró FolderPicker: {e}"))?;
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
async fn call_folder_picker_poll(_app: &AppHandle) -> Result<String, String> {
    Err("El selector de carpeta solo está disponible en Android".to_string())
}

/// "key" identifica para qué configuración es este pedido (ej. "music") --
/// viaja hasta el resultado (ver pick_folder_poll) para que sobreviva
/// aunque Android mate y reinicie el proceso de la app mientras el picker
/// nativo está al frente (pasa de verdad, confirmado en vivo en el
/// emulador -- ver la nota grande en FolderPicker.kt).
#[tauri::command]
pub async fn pick_folder_start(app: AppHandle, key: String) -> Result<(), String> {
    call_activity_launch_folder_picker(&app, &key).await
}

/// `{"ready": false}` mientras el usuario todavía no eligió/canceló, o
/// `{"ready": true, "path": "...", "key": "..."}` una vez que hay
/// respuesta ("path" vacío significa que el usuario canceló el picker sin
/// elegir nada, o que se eligió una carpeta que no se pudo resolver a una
/// ruta cruda -- el frontend trata ambos casos igual, "no se cambió
/// nada"). "key" es el mismo valor pasado a pick_folder_start -- se debe
/// consultar este poll no solo justo después de pedir el picker, sino
/// también al abrir cualquier pantalla que tenga configuraciones de
/// carpeta (ver Settings/ui.js), por si quedó un resultado pendiente de
/// una sesión anterior que se cortó por un reinicio de proceso.
#[tauri::command]
pub async fn pick_folder_poll(app: AppHandle) -> Result<serde_json::Value, String> {
    let raw = call_folder_picker_poll(&app).await?;
    serde_json::from_str(&raw).map_err(|e| format!("Respuesta inesperada: {e}"))
}
