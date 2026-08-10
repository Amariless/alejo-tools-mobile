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
// tira FileUriExposedException desde Android 7 en adelante. No hace
// falta escribir ningún componente Kotlin nuevo para esto -- FileProvider
// e Intent son clases estándar de Android, así que alcanza con invocarlas
// por JNI usando el JavaVM/Activity que "ndk-context" ya expone (wry/tao,
// que Tauri ya trae, lo publican ahí solo al arrancar la Activity).
#[cfg(target_os = "android")]
pub fn install_apk(path: &str) -> Result<(), String> {
    use jni::objects::{JObject, JString, JValue};

    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("No se pudo obtener la JVM de Android: {e}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("No se pudo adjuntar el hilo actual a la JVM: {e}"))?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    // Autoridad del FileProvider -- "<packageName>.fileprovider", igual
    // que ${applicationId}.fileprovider en AndroidManifest.xml. Se arma
    // en runtime en vez de hardcodear el package id acá para no tener que
    // mantener el mismo string en dos lugares.
    let package_name_obj = env
        .call_method(&activity, "getPackageName", "()Ljava/lang/String;", &[])
        .and_then(|v| v.l())
        .map_err(|e| format!("No se pudo leer el package name: {e}"))?;
    let package_name_jstring = JString::from(package_name_obj);
    let package_name: String = env
        .get_string(&package_name_jstring)
        .map_err(|e| format!("No se pudo leer el package name: {e}"))?
        .into();
    let authority = format!("{package_name}.fileprovider");

    let path_jstring = env
        .new_string(path)
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
                JValue::Object(&activity),
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

    // FLAG_GRANT_READ_URI_PERMISSION (0x1): sin esto, el instalador de
    // paquetes del sistema (OTRA app) no tiene permiso para leer esta URI
    // content:// que es de NUESTRO storage privado -- fallaría en
    // silencio al intentar abrirla.
    // FLAG_ACTIVITY_NEW_TASK (0x10000000): hace falta porque quien
    // arranca este Intent es el Context de la aplicación, no una Activity
    // en sí -- Android lo exige para ese caso.
    let flags: i32 = 0x1 | 0x10000000;
    env.call_method(&intent, "addFlags", "(I)Landroid/content/Intent;", &[JValue::Int(flags)])
        .map_err(|e| format!("No se pudo setear flags del Intent: {e}"))?;

    env.call_method(&activity, "startActivity", "(Landroid/content/Intent;)V", &[JValue::Object(&intent)])
        .map_err(|e| format!("No se pudo iniciar el instalador: {e}"))?;

    Ok(())
}

#[cfg(not(target_os = "android"))]
pub fn install_apk(_path: &str) -> Result<(), String> {
    Err("El instalador in-app solo está disponible en Android".to_string())
}
