package com.alejo.toolsmobile

// YtDlpBridge — puente Kotlin<->Rust para Descargar Música (yt-dlp en
// Android vía youtubedl-android, que empaqueta Python + yt-dlp + ffmpeg
// dentro del APK -- ver comentario en app/build.gradle.kts).
//
// Rust llama a estos métodos por JNI (mismo mecanismo que installer.rs y
// storage.rs: WebviewWindow::with_webview(...).jni_handle().exec(...) +
// wry::find_class, porque esta clase vive en el classloader de la app, no
// en el classloader del sistema que ve el hilo JNI de wry por defecto).
//
// PATRÓN JOB + POLL, a propósito, en vez de bloquear adentro de exec():
// YoutubeDL.getInfo()/execute() son llamadas bloqueantes que pueden tardar
// desde un par de segundos (info) hasta varios minutos (una descarga
// larga). No hay ninguna garantía documentada de que el hilo donde wry
// ejecuta el callback de jni_handle().exec() sea un hilo de fondo real y no
// el hilo principal/UI -- si fuera el hilo UI, una llamada bloqueante larga
// ahí congelaría toda la app y Android la mataría por ANR. Para no
// arriesgarse a eso: cada método público de acá arranca un Thread propio y
// devuelve un jobId al toque (esa parte sí es segura de llamar desde
// cualquier hilo, tarda microsegundos) -- el lado Rust after va sondeando
// poll(jobId) cada tanto (cada sondeo también es instantáneo) hasta que el
// resultado está listo. Mismo espíritu que el streaming de progreso del
// downloader de escritorio, pero por polling en vez de por stdout en vivo
// porque acá no hay un proceso hijo cuyo stdout leer línea a línea -- todo
// corre embebido en el proceso de la app.
import android.content.Context
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

object YtDlpBridge {
    // jobId -> resultado final en JSON (String), SOLO una vez que terminó
    // (mientras corre, la key simplemente no existe todavía -- ver poll()).
    // FIX (crash real en el emulador -- NullPointerException en
    // ConcurrentHashMap.putVal): la primera versión de esto pre-insertaba
    // jobs[jobId] = null como sentinel de "corriendo" -- ConcurrentHashMap,
    // a diferencia de HashMap, no admite valores null (ni claves null) y
    // tira NPE en el put(), no en una lectura -- por eso el crash pasaba
    // apenas se arrancaba un job, no al leerlo. Un job leído por poll() se
    // borra del mapa -- nadie más lo va a volver a pedir (Rust solo sondea
    // su propio jobId una vez que ve el resultado).
    private val jobs = ConcurrentHashMap<String, String>()

    // jobId -> (porcentaje 0-100, ETA en segundos o -1 si no se conoce) --
    // YoutubeDL.execute() acepta un callback que se llama en vivo con el
    // avance real (lee el mismo stdout de yt-dlp que el escritorio, pero acá
    // no hace falta parsear texto a mano -- la librería ya lo hace). Se
    // guarda acá para que poll() lo devuelva mientras el job sigue "running".
    private val progress = ConcurrentHashMap<String, Pair<Float, Long>>()

    @Volatile
    private var initialized = false

    private fun ensureInit(context: Context) {
        if (initialized) return
        synchronized(this) {
            if (initialized) return
            YoutubeDL.getInstance().init(context)
            FFmpeg.getInstance().init(context)
            initialized = true
        }
    }

    private fun errorJson(e: Throwable): String {
        val j = JSONObject()
        j.put("ok", false)
        j.put("error", e.message ?: e.toString())
        return j.toString()
    }

    /// Arranca la resolución de metadata de una URL (título, uploader,
    /// duración, miniatura) en un hilo de fondo. Devuelve el jobId para
    /// sondear con poll().
    @JvmStatic
    fun startFetchInfo(context: Context, url: String): String {
        val jobId = UUID.randomUUID().toString()
        val appContext = context.applicationContext
        Thread {
            val result = try {
                ensureInit(appContext)
                val info = YoutubeDL.getInstance().getInfo(url)
                val j = JSONObject()
                j.put("ok", true)
                j.put("title", info.title ?: info.fulltitle ?: "")
                j.put("uploader", info.uploader ?: "")
                j.put("duration", info.duration)
                j.put("thumbnail", info.thumbnail ?: "")
                j.put("webpage_url", info.webpageUrl ?: url)
                j.toString()
            } catch (e: Exception) {
                errorJson(e)
            }
            jobs[jobId] = result
        }.start()
        return jobId
    }

    /// Arranca la descarga+extracción de audio (mp3) de una URL hacia
    /// outputPath (ruta absoluta completa, SIN plantilla -- Rust ya arma el
    /// nombre de archivo final a partir del título/artista limpios, ver
    /// downloader.rs). quality: bitrate deseado en kbps como string ("0" o
    /// vacío = mejor disponible, igual que en escritorio).
    @JvmStatic
    fun startDownload(context: Context, url: String, outputPath: String, quality: String): String {
        val jobId = UUID.randomUUID().toString()
        progress[jobId] = Pair(0f, -1L)
        val appContext = context.applicationContext
        Thread {
            val result = try {
                ensureInit(appContext)
                val request = YoutubeDLRequest(url)
                request.addOption("--no-playlist")
                request.addOption("-x")
                request.addOption("--audio-format", "mp3")
                if (quality.isNotBlank() && quality != "0") {
                    request.addOption("--audio-quality", "${quality}K")
                }
                request.addOption("-o", outputPath)
                YoutubeDL.getInstance().execute(request, jobId) { pct, etaSecs, _line ->
                    progress[jobId] = Pair(pct, etaSecs)
                }
                val j = JSONObject()
                j.put("ok", true)
                j.put("path", outputPath)
                j.toString()
            } catch (e: Exception) {
                errorJson(e)
            }
            progress.remove(jobId)
            jobs[jobId] = result
        }.start()
        return jobId
    }

    /// Sondea el resultado de un job. Mientras sigue corriendo devuelve
    /// {"status":"running","progress":..,"eta":..} (progress/eta solo
    /// presentes para descargas, no para fetchInfo) -- una vez que hay
    /// resultado, lo devuelve UNA sola vez (con "status":"done" agregado) y
    /// lo borra del mapa interno.
    @JvmStatic
    fun poll(jobId: String): String {
        val stored = jobs.remove(jobId)
        if (stored == null) {
            val j = JSONObject()
            j.put("status", "running")
            progress[jobId]?.let { (pct, eta) ->
                j.put("progress", pct)
                j.put("eta", eta)
            }
            return j.toString()
        }
        return try {
            val obj = JSONObject(stored)
            obj.put("status", "done")
            obj.toString()
        } catch (e: Exception) {
            errorJson(e)
        }
    }
}
