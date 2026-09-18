import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// NUEVO (bug real, encontrado en vivo -- "actualizar desde la app dice
// 'no se instaló la app'"): este archivo (generado por `tauri android
// init`, nunca tocado hasta ahora) jamás definió un signingConfig propio
// -- ni "debug" ni "release" leían keystore.properties para nada, así que
// el paso "Configurar firma de Android" del CI (android-release.yml, que
// SÍ escribe gen/android/keystore.properties con los secrets del repo)
// escribía un archivo que Gradle nunca llegaba a mirar. El build type que
// de verdad se publica es "debug" (`tauri android build --debug --apk`,
// ver el comentario en android-release.yml), así que sin este bloque cada
// variante debug se firmaba con el keystore de debug EFÍMERO que Android
// Gradle Plugin autogenera solo si no existe ~/.android/debug.keystore --
// en un runner de GitHub Actions (una VM nueva en cada corrida, sin ese
// archivo cacheado) eso significa una clave de firma DISTINTA en CADA
// build. Confirmado extrayendo y comparando a mano el certificado real
// (APK Signing Block v2) de 4 releases publicados: los 4 tenían firmas
// distintas entre sí -- por eso Android rechazaba instalar cualquiera de
// ellos "como actualización" de la anterior sin desinstalar primero.
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        load(FileInputStream(keystorePropertiesFile))
    }
}

android {
    compileSdk = 36
    namespace = "com.alejo.toolsmobile"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.alejo.toolsmobile"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["password"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["password"] as String
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            // El build que de verdad se publica es este (debug, ver más
            // arriba) -- sin esto, firmado con el keystore efímero de
            // Android Gradle Plugin en vez del real.
            if (keystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            if (keystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
    // NUEVO (Descargar Música): pareja de android:extractNativeLibs="true"
    // en AndroidManifest.xml -- ver el comentario ahí para el porqué (bug
    // real, YoutubeDL.init() fallaba con "failed to initialize" porque
    // youtubedl-android empaqueta su Python/ffmpeg como .zip disfrazado de
    // .so, no como ELFs de verdad). Gradle avisa explícitamente que hace
    // falta esta línea cuando esa flag del manifest está en "true".
    packaging {
        jniLibs.useLegacyPackaging = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    // NUEVO (Descargar Música): yt-dlp no existe como binario de PATH en
    // Android (a diferencia de escritorio, ver downloader.rs de alejo-tools).
    // youtubedl-android empaqueta un build de Python + yt-dlp + ffmpeg por
    // ABI dentro del propio APK -- ver YtDlpBridge.kt para el puente
    // Kotlin<->Rust (JNI) que expone esto a los comandos de Tauri.
    implementation("io.github.junkfood02.youtubedl-android:library:0.18.1")
    implementation("io.github.junkfood02.youtubedl-android:ffmpeg:0.18.1")
    // NUEVO (Creador de Texturas, pedido explícito del usuario -- "quiero
    // modo Pro + macro"): la cámara del SISTEMA invocada por intent
    // (MediaStore.ACTION_IMAGE_CAPTURE, ver launchCameraCapture arriba) es
    // la más completa que permite la API pública de Android, pero cada
    // fabricante decide qué UI mostrarle a un intent de terceros -- en
    // MIUI (confirmado en vivo por el usuario en un Redmi Note 12 Pro) eso
    // es una versión simplificada SIN selector de modos. La única forma de
    // garantizar control real (en particular, enfoque manual para
    // fotografiar de cerca -- lo que en la UI de una cámara se llama "modo
    // macro") es NO depender de la app de cámara de terceros y tener
    // nuestra propia pantalla de captura -- ver MacroCameraActivity.kt.
    // CameraX (no Camera2 crudo) por su API mucho más simple para
    // preview+captura, pero exponiendo igual el control manual de enfoque
    // vía Camera2Interop/CaptureRequestOptions (androidx.camera.camera2) --
    // ese puente es justamente lo que CameraX simplifica sobre Camera2 puro.
    val cameraxVersion = "1.4.1"
    implementation("androidx.camera:camera-core:$cameraxVersion")
    implementation("androidx.camera:camera-camera2:$cameraxVersion")
    implementation("androidx.camera:camera-lifecycle:$cameraxVersion")
    implementation("androidx.camera:camera-view:$cameraxVersion")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")