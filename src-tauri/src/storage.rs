// storage.rs — permiso "Acceso a todos los archivos" (MANAGE_EXTERNAL_STORAGE),
// necesario para que SyncManager pueda escanear conflictos/duplicados en
// la carpeta real que sincroniza Syncthing-Android (ver syncthing.rs).
//
// Android no tiene un diálogo rápido tipo "Permitir/Denegar" para este
// permiso puntual (a diferencia de cámara, ubicación, etc.) -- desde
// Android 11 hace falta mandar al usuario a una pantalla de Ajustes
// dedicada (ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION) donde lo
// activa a mano con un switch. check_permission()/request_permission()
// usan el mismo mecanismo JNI que installer.rs (WebviewWindow::
// with_webview(...).jni_handle()) -- acá no hace falta wry::find_class
// porque Environment/Intent/Uri son todas clases del framework (viven en
// el boot classpath), no de AndroidX.
#[cfg(target_os = "android")]
pub async fn has_all_files_access(app: &tauri::AppHandle) -> Result<bool, String> {
    use tauri::Manager;

    let window = app
        .get_webview_window("main")
        .ok_or("No se encontró la ventana principal")?;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<bool, String>>();

    window
        .with_webview(move |webview| {
            let handle = webview.jni_handle();
            handle.exec(move |env, _activity, _webview| {
                let result = env
                    .call_static_method(
                        "android/os/Environment",
                        "isExternalStorageManager",
                        "()Z",
                        &[],
                    )
                    .and_then(|v| v.z())
                    .map_err(|e| format!("No se pudo consultar el permiso: {e}"));
                let _ = tx.send(result);
            });
        })
        .map_err(|e| format!("No se pudo acceder al webview: {e}"))?;

    rx.await.map_err(|_| "No se obtuvo respuesta".to_string())?
}

#[cfg(target_os = "android")]
pub async fn request_all_files_access(app: &tauri::AppHandle) -> Result<(), String> {
    use jni::objects::JValue;
    use tauri::Manager;

    let window = app
        .get_webview_window("main")
        .ok_or("No se encontró la ventana principal")?;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();

    window
        .with_webview(move |webview| {
            let handle = webview.jni_handle();
            handle.exec(move |env, activity, _webview| {
                let result = (|| -> Result<(), String> {
                    let package_name_obj = env
                        .call_method(activity, "getPackageName", "()Ljava/lang/String;", &[])
                        .and_then(|v| v.l())
                        .map_err(|e| format!("No se pudo leer el package name: {e}"))?;
                    let package_name: String = env
                        .get_string(&package_name_obj.into())
                        .map_err(|e| format!("No se pudo leer el package name: {e}"))?
                        .into();

                    let uri_string = env
                        .new_string(format!("package:{package_name}"))
                        .map_err(|e| e.to_string())?;
                    let uri = env
                        .call_static_method(
                            "android/net/Uri",
                            "parse",
                            "(Ljava/lang/String;)Landroid/net/Uri;",
                            &[JValue::Object(&uri_string)],
                        )
                        .and_then(|v| v.l())
                        .map_err(|e| format!("No se pudo armar la URI del paquete: {e}"))?;

                    let action = env
                        .new_string("android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION")
                        .map_err(|e| e.to_string())?;
                    let intent = env
                        .new_object(
                            "android/content/Intent",
                            "(Ljava/lang/String;Landroid/net/Uri;)V",
                            &[JValue::Object(&action), JValue::Object(&uri)],
                        )
                        .map_err(|e| format!("No se pudo crear el Intent: {e}"))?;

                    env.call_method(&intent, "addFlags", "(I)Landroid/content/Intent;", &[JValue::Int(0x10000000)])
                        .map_err(|e| format!("No se pudo setear flags del Intent: {e}"))?;

                    env.call_method(activity, "startActivity", "(Landroid/content/Intent;)V", &[JValue::Object(&intent)])
                        .map_err(|e| format!("No se pudo abrir la pantalla de permiso: {e}"))?;

                    Ok(())
                })();
                let _ = tx.send(result);
            });
        })
        .map_err(|e| format!("No se pudo acceder al webview: {e}"))?;

    rx.await.map_err(|_| "No se obtuvo respuesta".to_string())?
}

#[cfg(not(target_os = "android"))]
pub async fn has_all_files_access(_app: &tauri::AppHandle) -> Result<bool, String> {
    Ok(true)
}

#[cfg(not(target_os = "android"))]
pub async fn request_all_files_access(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn sync_check_storage_permission(app: tauri::AppHandle) -> Result<bool, String> {
    has_all_files_access(&app).await
}

#[tauri::command]
pub async fn sync_request_storage_permission(app: tauri::AppHandle) -> Result<(), String> {
    request_all_files_access(&app).await
}
