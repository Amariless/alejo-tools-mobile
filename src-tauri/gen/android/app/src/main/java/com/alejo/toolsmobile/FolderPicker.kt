package com.alejo.toolsmobile

// FolderPicker — deja el resultado del selector de carpeta nativo
// (lanzado desde MainActivity.launchFolderPicker(), ver ahí el porqué
// del ActivityResultLauncher) para que el lado Rust lo consuma por
// polling. Mismo patrón "consume-once" que PdfBridge.pendingUri: una vez
// leído con poll(), se limpia -- así un segundo poll sin una nueva
// selección no vuelve a entregar la misma carpeta.
//
// NUEVO -- bug real confirmado en vivo: abrir el picker nativo de
// carpetas (DocumentsUI, una Activity/proceso aparte) puede hacer que
// Android mate el proceso de esta app en segundo plano para liberar
// memoria mientras el picker está al frente (confirmado viendo el PID
// del proceso cambiar entre "abrir el picker" y "volver" en el
// emulador). registerForActivityResult sobrevive un reinicio así -- el
// callback de MainActivity SÍ se ejecuta en el proceso nuevo y llega
// hasta acá -- pero el JS que estaba haciendo polling (con el resultado
// de qué configuración era, ej. "carpeta de música") se pierde con el
// proceso viejo. Por eso "key" viaja junto con el path: al reabrir la
// app (o volver a entrar a Configuración), un poll sin más ya sabe para
// qué configuración era el resultado que quedó pendiente, sin depender
// de que el JS que lo pidió siga vivo.
import org.json.JSONObject

object FolderPicker {
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
