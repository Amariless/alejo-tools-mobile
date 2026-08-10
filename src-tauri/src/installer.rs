// installer.rs — instalador in-app del APK descargado (ver update.rs).
//
// Por qué JNI directo y no un plugin Tauri normal: instalar un APK exige
// pedirle al sistema (su instalador de paquetes, vía un Intent
// ACTION_VIEW) que abra un archivo que vive en el storage PRIVADO de esta
// app -- eso requiere una URI content:// armada por nuestro propio
// FileProvider (ya declarado en AndroidManifest.xml / file_paths.xml),
// no un path crudo. Confirmado leyendo la fuente de tauri-plugin-opener:
// su comando "open" en Android hace Intent.ACTION_VIEW directo sobre el
// path tal cual viene -- con un archivo de nuestro propio storage eso
// tira FileUriExposedException desde Android 7 en adelante.
//
// NUEVO (primer intento, roto en vivo -- "android context was not
// initialized"): la primera versión de esto usaba el crate `ndk-context`
// para conseguir el JavaVM/Activity, asumiendo que wry/tao lo poblaban
// solos -- FALSO para esta versión de tao: trae su PROPIO módulo interno
// `ndk_glue` (no el crate externo `ndk-context`), así que ese estático
// global de `ndk-context` nunca se inicializaba y `android_context()`
// panickeaba apenas se llamaba. La forma correcta -- confirmada leyendo
// la fuente de Tauri/wry -- es `WebviewWindow::with_webview(...)`, que ya
// usa este mismo proyecto en el escritorio (ver disable_webview_autofill
// en el lib.rs de alejo-tools) para COM de WebView2 en Windows: en
// Android, el handle que le llega a ese closure tiene un método
// `.jni_handle()` (wry::JniHandle) que corre código en el hilo correcto
// con un JNIEnv y Activity YA ATACHADOS por wry mismo -- sin ndk-context,
// sin JavaVM::attach_current_thread a mano.
#[cfg(target_os = "android")]
pub async fn install_apk(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    use jni::objects::{JObject, JString, JValue};
    use tauri::Manager;

    let window = app
        .get_webview_window("main")
        .ok_or("No se encontró la ventana principal")?;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let path = path.to_string();

    window
        .with_webview(move |webview| {
            let handle = webview.jni_handle();
            handle.exec(move |env, activity, _webview| {
                let result = (|| -> Result<(), String> {
                    let package_name_obj = env
                        .call_method(activity, "getPackageName", "()Ljava/lang/String;", &[])
                        .and_then(|v| v.l())
                        .map_err(|e| format!("No se pudo leer el package name: {e}"))?;
                    let package_name_jstring = JString::from(package_name_obj);
                    let package_name: String = env
                        .get_string(&package_name_jstring)
                        .map_err(|e| format!("No se pudo leer el package name: {e}"))?
                        .into();
                    let authority = format!("{package_name}.fileprovider");

                    let path_jstring = env
                        .new_string(&path)
                        .map_err(|e| format!("No se pudo crear el string del path: {e}"))?;
                    let file_obj = env
                        .new_object("java/io/File", "(Ljava/lang/String;)V", &[JValue::Object(&path_jstring)])
                        .map_err(|e| format!("No se pudo crear el objeto File: {e}"))?;

                    let authority_jstring = env
                        .new_string(&authority)
                        .map_err(|e| format!("No se pudo crear el string de authority: {e}"))?;

                    let apk_uri = env
                        .call_static_method(
                            "androidx/core/content/FileProvider",
                            "getUriForFile",
                            "(Landroid/content/Context;Ljava/lang/String;Ljava/io/File;)Landroid/net/Uri;",
                            &[
                                JValue::Object(activity),
                                JValue::Object(&authority_jstring),
                                JValue::Object(&file_obj),
                            ],
                        )
                        .and_then(|v| v.l())
                        .map_err(|e| format!("No se pudo obtener la URI content:// del APK (FileProvider): {e}"))?;

                    let intent = env
                        .new_object("android/content/Intent", "()V", &[])
                        .map_err(|e| format!("No se pudo crear el Intent: {e}"))?;

                    let action_view = env
                        .new_string("android.intent.action.VIEW")
                        .map_err(|e| e.to_string())?;
                    env.call_method(
                        &intent,
                        "setAction",
                        "(Ljava/lang/String;)Landroid/content/Intent;",
                        &[JValue::Object(&action_view)],
                    )
                    .map_err(|e| format!("No se pudo setear la acción del Intent: {e}"))?;

                    let mime_type = env
                        .new_string("application/vnd.android.package-archive")
                        .map_err(|e| e.to_string())?;
                    env.call_method(
                        &intent,
                        "setDataAndType",
                        "(Landroid/net/Uri;Ljava/lang/String;)Landroid/content/Intent;",
                        &[JValue::Object(&apk_uri), JValue::Object(&mime_type)],
                    )
                    .map_err(|e| format!("No se pudo setear data/type del Intent: {e}"))?;

                    // FLAG_GRANT_READ_URI_PERMISSION (0x1): sin esto, el
                    // instalador de paquetes del sistema (OTRA app) no
                    // tiene permiso para leer esta URI content:// que es
                    // de NUESTRO storage privado -- fallaría en silencio.
                    // FLAG_ACTIVITY_NEW_TASK (0x10000000): hace falta
                    // porque este Intent se arranca desde el contexto de
                    // la aplicación, no desde una Activity en sí.
                    let flags: i32 = 0x1 | 0x10000000;
                    env.call_method(&intent, "addFlags", "(I)Landroid/content/Intent;", &[JValue::Int(flags)])
                        .map_err(|e| format!("No se pudo setear flags del Intent: {e}"))?;

                    env.call_method(activity, "startActivity", "(Landroid/content/Intent;)V", &[JValue::Object(&intent)])
                        .map_err(|e| format!("No se pudo iniciar el instalador: {e}"))?;

                    Ok(())
                })();
                let _ = tx.send(result);
            });
        })
        .map_err(|e| format!("No se pudo acceder al webview: {e}"))?;

    rx.await.map_err(|_| "El instalador no respondió".to_string())?
}

#[cfg(not(target_os = "android"))]
pub async fn install_apk(_app: &tauri::AppHandle, _path: &str) -> Result<(), String> {
    Err("El instalador in-app solo está disponible en Android".to_string())
}
