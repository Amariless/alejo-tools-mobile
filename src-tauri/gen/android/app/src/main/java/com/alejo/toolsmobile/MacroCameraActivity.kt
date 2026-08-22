package com.alejo.toolsmobile

import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureRequest
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.camera2.interop.Camera2CameraControl
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.CaptureRequestOptions
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import java.io.File

// MacroCameraActivity — pantalla de cámara propia para Creador de
// Texturas (pedido explícito del usuario -- "quiero la cámara normal con
// todos sus modos para usar el modo pro + macro, muy importante para
// texturas"). Ver el comentario grande en MainActivity.launchMacroCamera
// para el porqué hace falta esto en vez de seguir delegando a la app de
// cámara del sistema: no existe ningún extra público de Android para
// pedirle a un intent de terceros "abrite en modo Pro/macro" -- cada
// fabricante decide qué UI mostrarle a un intent ajeno, y en varios
// (confirmado en vivo por el usuario en un Redmi Note 12 Pro / MIUI) esa
// UI viene recortada, sin selector de modos.
//
// Un "modo macro" no es más que la posibilidad de forzar el enfoque MUY
// cerca del sensor en vez de dejar que el autofoco decida (que normalmente
// no puede enfocar a pocos centímetros) -- eso es exactamente lo que
// CaptureRequest.LENS_FOCUS_DISTANCE permite, expuesto acá vía el puente
// oficial de CameraX a Camera2 (androidx.camera.camera2.interop), sin
// tener que reimplementar toda la cámara en Camera2 puro.
@ExperimentalCamera2Interop
class MacroCameraActivity : AppCompatActivity() {
    private var camera: Camera? = null
    private var minFocusDistance = 0f // dioptrías del punto más cercano enfocable; 0 = esta lente no tiene enfoque ajustable (fixed-focus)
    private lateinit var imageCapture: ImageCapture
    private lateinit var focusSeekBar: SeekBar
    private lateinit var focusLabel: TextView
    private var capturing = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val key = intent.getStringExtra(EXTRA_KEY) ?: ""

        // No debería pasar nunca (MainActivity.launchMacroCamera ya pide
        // el permiso ANTES de lanzar esta Activity) -- red de seguridad
        // por si de todos modos llega acá sin permiso.
        if (checkSelfPermission(android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            CameraCapture.deliver("", key)
            finish()
            return
        }

        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val previewView = PreviewView(this).apply {
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        root.addView(previewView)

        val closeBtn = Button(this).apply {
            text = "✕"
            textSize = 18f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#66000000"))
            layoutParams = FrameLayout.LayoutParams(dp(48), dp(48)).apply {
                gravity = Gravity.TOP or Gravity.START
                topMargin = dp(24); leftMargin = dp(16)
            }
            setOnClickListener { cancelAndFinish(key) }
        }
        root.addView(closeBtn)

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#99000000"))
            setPadding(dp(20), dp(16), dp(20), dp(28))
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.BOTTOM
            }
        }

        focusLabel = TextView(this).apply {
            text = "Iniciando cámara..."
            setTextColor(Color.WHITE)
            textSize = 13f
        }
        controls.addView(focusLabel)

        // Desliza de "lejos" (0, izquierda) a "macro" (minFocusDistance,
        // derecha) -- deshabilitado hasta saber si esta lente lo permite
        // (bindCamera lo habilita async, algunos teléfonos son fixed-focus
        // y ahí no hay nada que ajustar).
        focusSeekBar = SeekBar(this).apply {
            max = 1000
            progress = 0
            isEnabled = false
        }
        controls.addView(focusSeekBar)

        val autoBtn = Button(this).apply {
            text = "Volver a enfoque automático"
            textSize = 12f
            setOnClickListener { resetToAutoFocus() }
        }
        controls.addView(autoBtn)

        val captureRow = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(96))
        }
        val captureBtn = View(this).apply {
            layoutParams = FrameLayout.LayoutParams(dp(72), dp(72)).apply { gravity = Gravity.CENTER }
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.WHITE)
                setStroke(dp(4), Color.parseColor("#CCCCCC"))
            }
            setOnClickListener { takePhoto(key) }
        }
        captureRow.addView(captureBtn)
        controls.addView(captureRow)

        root.addView(controls)
        setContentView(root)

        focusSeekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, progress: Int, fromUser: Boolean) {
                if (!fromUser || minFocusDistance <= 0f) return
                val distance = (progress / 1000f) * minFocusDistance
                applyManualFocus(distance)
                focusLabel.text = if (progress > 850) "Enfoque: macro (muy cerca)" else "Enfoque manual"
            }
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onStopTrackingTouch(sb: SeekBar) {}
        })

        bindCamera(previewView, key)
    }

    private fun bindCamera(previewView: PreviewView, key: String) {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            try {
                val provider = providerFuture.get()
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
                imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                    .build()
                provider.unbindAll()
                val cam = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture)
                camera = cam
                minFocusDistance = Camera2CameraInfo.from(cam.cameraInfo)
                    .getCameraCharacteristic(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f
                if (minFocusDistance > 0f) {
                    focusSeekBar.isEnabled = true
                    focusLabel.text = "Enfoque: auto (deslizá para modo macro)"
                } else {
                    focusLabel.text = "Este teléfono no permite enfoque manual -- foco automático"
                }
            } catch (e: Exception) {
                focusLabel.text = "No se pudo iniciar la cámara: ${e.message}"
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun applyManualFocus(distance: Float) {
        val cam = camera ?: return
        val options = CaptureRequestOptions.Builder()
            .setCaptureRequestOption(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_OFF)
            .setCaptureRequestOption(CaptureRequest.LENS_FOCUS_DISTANCE, distance)
            .build()
        Camera2CameraControl.from(cam.cameraControl).setCaptureRequestOptions(options)
    }

    private fun resetToAutoFocus() {
        val cam = camera ?: return
        val options = CaptureRequestOptions.Builder()
            .setCaptureRequestOption(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
            .build()
        Camera2CameraControl.from(cam.cameraControl).setCaptureRequestOptions(options)
        focusSeekBar.progress = 0
        focusLabel.text = if (minFocusDistance > 0f) "Enfoque: auto (deslizá para modo macro)" else "Enfoque automático"
    }

    private fun takePhoto(key: String) {
        if (capturing || !::imageCapture.isInitialized) return
        capturing = true
        val dir = File(cacheDir, "camera_capture")
        dir.mkdirs()
        val file = File(dir, "capture_${System.currentTimeMillis()}.jpg")
        val output = ImageCapture.OutputFileOptions.Builder(file).build()
        imageCapture.takePicture(output, ContextCompat.getMainExecutor(this), object : ImageCapture.OnImageSavedCallback {
            override fun onImageSaved(results: ImageCapture.OutputFileResults) {
                CameraCapture.deliver(file.absolutePath, key)
                finish()
            }
            override fun onError(exc: ImageCaptureException) {
                capturing = false
                focusLabel.text = "No se pudo sacar la foto: ${exc.message}"
            }
        })
    }

    private fun cancelAndFinish(key: String) {
        CameraCapture.deliver("", key)
        finish()
    }

    @Deprecated("Deprecated in Java", ReplaceWith(""))
    override fun onBackPressed() {
        cancelAndFinish(intent.getStringExtra(EXTRA_KEY) ?: "")
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_KEY = "key"
    }
}
