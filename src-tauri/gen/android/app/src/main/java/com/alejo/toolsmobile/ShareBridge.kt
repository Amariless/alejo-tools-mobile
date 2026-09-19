package com.alejo.toolsmobile

// ShareBridge — puente Kotlin<->Rust para "Compartir a Alejo Tools" (ver
// AndroidManifest.xml, activity-alias ShareReceiverActivity para
// ACTION_SEND). Mismo patrón "consume-once" que PdfBridge.pendingUri:
// MainActivity.captureShareIntent() guarda acá el texto compartido por
// otra app (YouTube, un navegador, etc. -- llamado desde onCreate Y
// onNewIntent) y el lado Rust lo consume una sola vez (dl_take_pending_
// share_text, ver downloader.rs) para que Descargar Música lo detecte
// como deep link al arrancar.
object ShareBridge {
    @Volatile
    var pendingText: String? = null

    @JvmStatic
    fun takePendingText(): String {
        val v = pendingText
        pendingText = null
        return v ?: ""
    }
}
