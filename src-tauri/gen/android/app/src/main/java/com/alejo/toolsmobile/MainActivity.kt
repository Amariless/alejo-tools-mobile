package com.alejo.toolsmobile

import android.content.Intent
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

    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    capturePdfIntent(intent)
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.putString(STATE_PENDING_FOLDER_KEY, pendingFolderPickKey)
    outState.putString(STATE_PENDING_CAMERA_KEY, pendingCameraKey)
    outState.putString(STATE_PENDING_CAMERA_PATH, pendingCameraOutputPath)
  }

  companion object {
    private const val STATE_PENDING_FOLDER_KEY = "pendingFolderPickKey"
    private const val STATE_PENDING_CAMERA_KEY = "pendingCameraKey"
    private const val STATE_PENDING_CAMERA_PATH = "pendingCameraOutputPath"
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

  /// Llamado por JNI desde camera.rs (camera_capture_start) -- lanza la
  /// app de cámara COMPLETA del sistema (todos sus modos: Pro, macro,
  /// noche, etc.) en vez de la mini-UI reducida que da
  /// <input capture=environment> del WebView (el bug real reportado por
  /// el usuario). MediaStore.ACTION_IMAGE_CAPTURE + EXTRA_OUTPUT hacia un
  /// archivo propio (vía FileProvider, ya declarado en
  /// AndroidManifest.xml) es la app de cámara REAL del teléfono, no un
  /// picker minimalista -- guarda a máxima resolución en vez de la
  /// miniatura que devolvía el flujo anterior.
  fun launchCameraCapture(key: String) {
    val dir = File(cacheDir, "camera_capture")
    dir.mkdirs()
    val file = File(dir, "capture_${System.currentTimeMillis()}.jpg")
    pendingCameraKey = key
    pendingCameraOutputPath = file.absolutePath
    val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
    runOnUiThread { cameraCaptureLauncher.launch(uri) }
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
