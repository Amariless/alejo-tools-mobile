package com.alejo.toolsmobile

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import java.io.File

class MainActivity : TauriActivity() {
  // NUEVO (selector de carpeta nativo, pedido del usuario en vez de
  // escribir rutas a mano): ActivityResultLauncher tiene que registrarse
  // ANTES de que la Activity llegue a STARTED -- por eso va acá, al
  // arrancar onCreate, no en el momento en que folder_picker.rs lo
  // dispara por JNI (para entonces ya sería tarde).
  private lateinit var folderPickerLauncher: ActivityResultLauncher<Uri?>

  // NUEVO (cámara completa para Creador de Texturas, pedido del usuario):
  // mismo motivo que folderPickerLauncher -- tiene que registrarse acá,
  // no en el momento en que camera.rs lo dispara por JNI. TakePicture()
  // (a diferencia de ACTION_IMAGE_CAPTURE crudo) ya maneja el permiso de
  // la URI de salida por nosotros.
  private lateinit var cameraCaptureLauncher: ActivityResultLauncher<Uri>
  private var pendingCameraOutputPath: String = ""

  // NUEVO (Creador de Texturas -- modo macro real, ver
  // MacroCameraActivity.kt): a diferencia de cameraCaptureLauncher (que
  // delega a la app de cámara del sistema, sin permiso propio necesario),
  // abrir NUESTRA propia pantalla de cámara con CameraX sí requiere pedir
  // CAMERA en tiempo de ejecución -- mismo motivo de "registrar ANTES de
  // STARTED" que los demás launchers de acá arriba.
  private lateinit var cameraPermissionLauncher: ActivityResultLauncher<String>
  private var pendingMacroCameraKey: String = ""

  // NUEVO -- qué configuración pidió el picker (ej. "music"), para que
  // FolderPicker.deliver() pueda avisarle al JS correcto incluso si el
  // proceso se reinició mientras el picker de DocumentsUI estaba al
  // frente (ver nota grande en FolderPicker.kt). Persistido en
  // savedInstanceState -- si Android mata y recrea esta Activity, este
  // valor tiene que sobrevivir junto con el propio ActivityResultLauncher
  // (que la propia librería ya restaura solo).
  private var pendingFolderPickKey: String = ""
  private var pendingCameraKey: String = ""

  override fun onCreate(savedInstanceState: Bundle?) {
    pendingFolderPickKey = savedInstanceState?.getString(STATE_PENDING_FOLDER_KEY) ?: ""
    pendingCameraKey = savedInstanceState?.getString(STATE_PENDING_CAMERA_KEY) ?: ""
    pendingCameraOutputPath = savedInstanceState?.getString(STATE_PENDING_CAMERA_PATH) ?: ""
    pendingMacroCameraKey = savedInstanceState?.getString(STATE_PENDING_MACRO_CAMERA_KEY) ?: ""

    folderPickerLauncher = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
      val forKey = pendingFolderPickKey
      pendingFolderPickKey = ""
      if (uri != null) {
        try {
          contentResolver.takePersistableUriPermission(
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
          )
        } catch (e: Exception) { /* best effort -- si falla, igual devolvemos el path */ }
        FolderPicker.deliver(resolvePathFromTreeUri(uri) ?: "", forKey)
      } else {
        FolderPicker.deliver("", forKey) // usuario canceló el picker
      }
    }

    cameraCaptureLauncher = registerForActivityResult(ActivityResultContracts.TakePicture()) { success ->
      val forKey = pendingCameraKey
      val path = pendingCameraOutputPath
      pendingCameraKey = ""
      pendingCameraOutputPath = ""
      CameraCapture.deliver(if (success) path else "", forKey)
    }

    cameraPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      val forKey = pendingMacroCameraKey
      pendingMacroCameraKey = ""
      if (granted) {
        startActivity(Intent(this, MacroCameraActivity::class.java).putExtra(MacroCameraActivity.EXTRA_KEY, forKey))
      } else {
        // Usuario negó el permiso -- se resuelve como "cancelado sin
        // foto", mismo contrato que cuando se cancela la cámara del
        // sistema (path vacío), así el JS (captureFullCamera en main.js)
        // no necesita distinguir los dos casos.
        CameraCapture.deliver("", forKey)
      }
    }

    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    capturePdfIntent(intent)
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.putString(STATE_PENDING_FOLDER_KEY, pendingFolderPickKey)
    outState.putString(STATE_PENDING_CAMERA_KEY, pendingCameraKey)
    outState.putString(STATE_PENDING_CAMERA_PATH, pendingCameraOutputPath)
    outState.putString(STATE_PENDING_MACRO_CAMERA_KEY, pendingMacroCameraKey)
  }

  companion object {
    private const val STATE_PENDING_FOLDER_KEY = "pendingFolderPickKey"
    private const val STATE_PENDING_CAMERA_KEY = "pendingCameraKey"
    private const val STATE_PENDING_CAMERA_PATH = "pendingCameraOutputPath"
    private const val STATE_PENDING_MACRO_CAMERA_KEY = "pendingMacroCameraKey"
  }

  // NUEVO (Lector de PDF, manejador por defecto): launchMode="singleTask"
  // (ver AndroidManifest.xml) hace que abrir un PDF con la app YA corriendo
  // reuse la misma Activity en vez de crear una nueva -- eso NO pasa por
  // onCreate() de nuevo, pasa por acá. Sin este override, "Abrir con..."
  // desde otra app funcionaría la primera vez (app cerrada) pero se
  // quedaría sin efecto si Alejo Tools ya estaba abierta.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    capturePdfIntent(intent)
  }

  private fun capturePdfIntent(intent: Intent?) {
    if (intent?.action == Intent.ACTION_VIEW && intent.data != null) {
      PdfBridge.pendingUri = intent.data.toString()
    }
  }

  /// Llamado por JNI desde folder_picker.rs (pick_folder_start) -- lanza
  /// el picker nativo de carpetas de Android (Storage Access Framework).
  /// "key" identifica para qué configuración es (ej. "music"), para que
  /// FolderPicker.poll() pueda devolverlo junto con el resultado -- ver
  /// nota grande en FolderPicker.kt sobre por qué hace falta. runOnUiThread
  /// porque JNI desde jni_handle().exec() no corre necesariamente en el
  /// hilo principal.
  fun launchFolderPicker(key: String) {
    pendingFolderPickKey = key
    runOnUiThread { folderPickerLauncher.launch(null) }
  }

  /// Lanza la app de cámara COMPLETA del sistema vía intent
  /// (MediaStore.ACTION_IMAGE_CAPTURE + EXTRA_OUTPUT). Es lo más completo
  /// que permite la API pública de Android para delegarle la captura a
  /// OTRA app -- pero "completo" según la API no significa "con todos los
  /// modos": cada fabricante decide qué UI mostrarle a un intent de
  /// terceros, y en varios (confirmado en vivo en MIUI/Xiaomi) eso es una
  /// versión simplificada sin selector de modos. YA NO la usa Creador de
  /// Texturas (ver launchMacroCamera, abajo, y camera.rs) pero se deja el
  /// mecanismo funcionando -- es la forma más simple de sacar una foto sin
  /// pedir el permiso CAMERA, por si alguna herramienta futura solo
  /// necesita eso.
  fun launchCameraCapture(key: String) {
    val dir = File(cacheDir, "camera_capture")
    dir.mkdirs()
    val file = File(dir, "capture_${System.currentTimeMillis()}.jpg")
    pendingCameraKey = key
    pendingCameraOutputPath = file.absolutePath
    val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
    runOnUiThread { cameraCaptureLauncher.launch(uri) }
  }

  /// Llamado por JNI desde camera.rs (camera_capture_start) -- Creador de
  /// Texturas. Lanza NUESTRA propia pantalla de cámara (MacroCameraActivity,
  /// CameraX) en vez de delegar a la app de cámara del sistema: es la única
  /// forma de garantizar enfoque manual real (modo macro) sin depender de
  /// qué tan completa decida ser la UI de la cámara de cada fabricante ante
  /// un intent de terceros (ver el comentario de launchCameraCapture).
  /// Pide el permiso CAMERA en tiempo de ejecución si todavía no lo tiene
  /// -- MacroCameraActivity en sí NO lo pide (asume que ya está concedido
  /// para cuando arranca).
  fun launchMacroCamera(key: String) {
    if (checkSelfPermission(android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
      runOnUiThread {
        startActivity(Intent(this, MacroCameraActivity::class.java).putExtra(MacroCameraActivity.EXTRA_KEY, key))
      }
    } else {
      pendingMacroCameraKey = key
      runOnUiThread { cameraPermissionLauncher.launch(android.Manifest.permission.CAMERA) }
    }
  }

  /// El picker devuelve una URI content://tree (ej.
  /// "content://com.android.externalstorage.documents/tree/primary%3AMusic%2FAlejoTools"),
  /// no una ruta de archivo cruda. Como esta app ya pide "Acceso a todos
  /// los archivos" (MANAGE_EXTERNAL_STORAGE) para todo el resto del
  /// manejo de archivos, no tiene sentido migrar pdf_list_folder/
  /// book_list_folder/etc. a leer por DocumentsContract solo por esto --
  /// alcanza con decodificar la URI de vuelta a una ruta cruda cuando es
  /// del volumen "primary" (un solo almacenamiento interno, el caso
  /// normal). Si el usuario elige una carpeta de una SD externa (volumen
  /// != "primary"), no la resolvemos a una ruta cruda -- devolvemos null
  /// y el frontend lo trata como "no se pudo usar esa carpeta".
  private fun resolvePathFromTreeUri(uri: Uri): String? {
    val docId = try { DocumentsContract.getTreeDocumentId(uri) } catch (e: Exception) { return null }
    val colonIndex = docId.indexOf(':')
    if (colonIndex < 0) return null
    val volume = docId.substring(0, colonIndex)
    val relativePath = docId.substring(colonIndex + 1)
    if (volume != "primary") return null
    val base = Environment.getExternalStorageDirectory().absolutePath
    return if (relativePath.isEmpty()) base else "$base/$relativePath"
  }
}
