package com.alejo.toolsmobile

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    capturePdfIntent(intent)
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
}
