package com.alejo.toolsmobile

// PdfBridge — puente Kotlin<->Rust para Lector de PDF.
//
// A diferencia de Descargar Música (que necesitó youtubedl-android
// porque Android no trae yt-dlp), acá NO hace falta ninguna librería
// externa: android.graphics.pdf.PdfRenderer es parte del SDK de Android
// desde API 21 y renderiza páginas de PDF a Bitmap directo, sin pdf.js ni
// nada por el estilo -- justo lo que hace falta para no tener que
// resolver un parser de PDF completo en JS puro (que sí sería un
// proyecto en sí mismo).
//
// Igual que YtDlpBridge.kt: llamado desde Rust por JNI (WebviewWindow::
// with_webview(...).jni_handle().exec(...) + wry::find_class, porque esta
// clase vive en el classloader de la app). A diferencia de YtDlpBridge,
// acá SÍ es seguro llamar directo sin el patrón job+poll -- renderizar una
// página de PDF a un bitmap es rápido (milisegundos, no segundos) y no
// depende de red ni de un proceso externo.
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

object PdfBridge {
    // sessionId -> renderer abierto, para no reabrir el archivo en cada
    // página. Se cierra explícitamente con close() cuando el usuario sale
    // del lector (ver ui.js) -- si la app se mata sin llamar close(), el
    // proceso completo termina igual (no queda un fd huérfano entre
    // sesiones de la app).
    private val sessions = ConcurrentHashMap<String, PdfRenderer>()
    private val pfds = ConcurrentHashMap<String, ParcelFileDescriptor>()

    // NUEVO (manejador por defecto de PDFs): MainActivity.kt guarda acá la
    // URI content:// cuando la app se abre (o se retoma, launchMode=
    // singleTask) desde un Intent VIEW de otra app ("Abrir con..."). El
    // frontend consulta takePendingUri() una vez al arrancar -- si hay
    // algo, navega directo al lector y abre ese PDF; si no, sigue con la
    // lista de herramientas normal. "Take" (lee y borra) para no volver a
    // abrir el mismo PDF si el usuario simplemente vuelve a la lista y
    // reentra a la herramienta más tarde.
    @Volatile
    var pendingUri: String? = null

    @JvmStatic
    fun takePendingUri(): String {
        val v = pendingUri
        pendingUri = null
        return v ?: ""
    }

    private fun errorJson(e: Throwable): String {
        val j = JSONObject()
        j.put("ok", false)
        j.put("error", e.message ?: e.toString())
        return j.toString()
    }

    /// Abre un PDF -- pathOrUri puede ser una ruta cruda de archivo (los
    /// PDFs listados desde la carpeta configurada), una URI content://
    /// (el caso normal cuando otra app nos abre un PDF vía "Abrir con", ver
    /// MainActivity.kt) o -- NUEVO, bug real confirmado en vivo con la
    /// prueba de "Abrir con" -- una URI file:// (algunas apps/orígenes
    /// arman el Intent así en vez de con FileProvider): "file:///sdcard/…"
    /// NO es una ruta de archivo válida tal cual para File(...) (el
    /// prefijo "file://" queda pegado al path, tira ENOENT), hace falta
    /// pelarle el esquema con Uri.parse(...).path primero.
    /// Devuelve {"ok":true,"sessionId":..,"pageCount":..} o
    /// {"ok":false,"error":..}.
    @JvmStatic
    fun open(context: Context, pathOrUri: String): String {
        return try {
            val pfd = if (pathOrUri.startsWith("content://")) {
                context.contentResolver.openFileDescriptor(Uri.parse(pathOrUri), "r")
                    ?: throw IllegalStateException("No se pudo abrir el archivo")
            } else if (pathOrUri.startsWith("file://")) {
                val realPath = Uri.parse(pathOrUri).path
                    ?: throw IllegalStateException("URI de archivo inválida: $pathOrUri")
                ParcelFileDescriptor.open(File(realPath), ParcelFileDescriptor.MODE_READ_ONLY)
            } else {
                ParcelFileDescriptor.open(File(pathOrUri), ParcelFileDescriptor.MODE_READ_ONLY)
            }
            val renderer = PdfRenderer(pfd)
            val sessionId = UUID.randomUUID().toString()
            sessions[sessionId] = renderer
            pfds[sessionId] = pfd
            val j = JSONObject()
            j.put("ok", true)
            j.put("sessionId", sessionId)
            j.put("pageCount", renderer.pageCount)
            j.toString()
        } catch (e: Exception) {
            errorJson(e)
        }
    }

    /// Renderiza una página a PNG (base64) ajustada a maxWidthPx de ancho
    /// (alto proporcional). Devuelve {"ok":true,"png":"<base64>","width":..,
    /// "height":..} o {"ok":false,"error":..}.
    @JvmStatic
    fun renderPage(sessionId: String, pageIndex: Int, maxWidthPx: Int): String {
        val renderer = sessions[sessionId] ?: return errorJson(IllegalStateException("Sesión no encontrada -- ¿se cerró el PDF?"))
        return try {
            renderer.openPage(pageIndex).use { page ->
                val scale = maxWidthPx.toFloat() / page.width.toFloat()
                val w = maxWidthPx
                val h = (page.height * scale).toInt().coerceAtLeast(1)
                val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                bitmap.eraseColor(Color.WHITE) // páginas con fondo transparente no deberían verse negras
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)

                val out = ByteArrayOutputStream()
                bitmap.compress(Bitmap.CompressFormat.PNG, 90, out)
                bitmap.recycle()

                val j = JSONObject()
                j.put("ok", true)
                j.put("png", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
                j.put("width", w)
                j.put("height", h)
                j.toString()
            }
        } catch (e: Exception) {
            errorJson(e)
        }
    }

    @JvmStatic
    fun close(sessionId: String) {
        try { sessions.remove(sessionId)?.close() } catch (e: Exception) { /* best effort */ }
        try { pfds.remove(sessionId)?.close() } catch (e: Exception) { /* best effort */ }
    }

    /// Lista los ".pdf" de una carpeta (no recursivo) -- nombre + tamaño,
    /// ordenados alfabéticamente. Devuelve un array JSON (no un objeto
    /// {ok:..} como el resto, para que el lado Rust lo parsee directo como
    /// Vec<Value>).
    @JvmStatic
    fun listFolder(dirPath: String): String {
        val dir = File(dirPath)
        val files = dir.listFiles { f -> f.isFile && f.name.lowercase().endsWith(".pdf") } ?: emptyArray()
        val arr = JSONArray()
        files.sortedBy { it.name.lowercase() }.forEach { f ->
            val o = JSONObject()
            o.put("name", f.name)
            o.put("path", f.absolutePath)
            o.put("sizeBytes", f.length())
            arr.put(o)
        }
        return arr.toString()
    }
}
