package com.alejo.toolsmobile

// CameraCapture — deja el resultado de la cámara nativa completa
// (lanzada desde MainActivity.launchCameraCapture(), ver ahí el
// porqué) para que Rust lo consuma por polling. Mismo patrón
// "consume-once" + "key" que FolderPicker (ver ese archivo para la nota
// grande sobre por qué hace falta -- Android puede matar el proceso
// mientras la app de cámara está al frente, "key" es lo que permite
// recuperar el resultado igual aunque eso pase).
//
// Por qué esto existe (pedido explícito del usuario): "Tomar foto" antes
// usaba <input type=file capture=environment> del WebView, que en la
// mayoría de los teléfonos abre una mini-UI de cámara reducida (sin modo
// Pro, sin macro, sin los demás modos de la app de cámara real). Esto
// lanza la Activity de cámara COMPLETA vía Intent explícito
// (MediaStore.ACTION_IMAGE_CAPTURE + EXTRA_OUTPUT a un archivo propio vía
// FileProvider) -- es la misma app de cámara del sistema que el usuario
// usa siempre, con todos sus modos disponibles.
import org.json.JSONObject

object CameraCapture {
    @Volatile
    private var ready: Boolean = false

    @Volatile
    private var value: String = ""

    @Volatile
    private var key: String = ""

    fun deliver(path: String, forKey: String) {
        value = path
        key = forKey
        ready = true
    }

    @JvmStatic
    fun poll(): String {
        val j = JSONObject()
        if (!ready) {
            j.put("ready", false)
            return j.toString()
        }
        ready = false
        j.put("ready", true)
        j.put("path", value)
        j.put("key", key)
        return j.toString()
    }
}
