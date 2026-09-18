package com.alejo.toolsmobile

import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
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
import androidx.camera.core.AspectRatio
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
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
//
// NUEVO (pedido del usuario, celular Samsung S23 Ultra -- "puede que este
// permita acceder a las diferentes cámaras desde otras apps, si detecta
// que el celular no lo puede hacer, que use la que ya existe"): algunos
// teléfonos (sobre todo flagships recientes) exponen cada lente física
// trasera (ultra-wide/wide/tele) como una CÁMARA SEPARADA en
// CameraManager.cameraIdList -- otros esconden todo eso detrás de una
// única cámara "lógica" que hace el zoom internamente, y ahí no hay nada
// que listar. Se detecta esto DESPUÉS de bindear la cámara por defecto (ver
// bindCamera): recién ahí se sabe la distancia focal real de la lente que
// CameraX eligió como "1x" de referencia, necesaria para calcular la
// etiqueta ("0.6x"/"2x"/etc.) del resto. Si sólo hay una cámara trasera
// real, el selector de lentes simplemente no se muestra -- mismo
// comportamiento de antes, sin romper nada.
@ExperimentalCamera2Interop
class MacroCameraActivity : AppCompatActivity() {
    private var camera: Camera? = null
    private var minFocusDistance = 0f // dioptrías del punto más cercano enfocable; 0 = esta lente no tiene enfoque ajustable (fixed-focus)
    private lateinit var imageCapture: ImageCapture
    private lateinit var focusSeekBar: SeekBar
    private lateinit var focusLabel: TextView
    private lateinit var controlsPanel: LinearLayout
    private var lensRow: LinearLayout? = null
    private var capturing = false

    private var previewViewRef: PreviewView? = null
    private var currentKey: String = ""
    private data class LensOption(val cameraId: String, val label: String)
    private var lensOptions: List<LensOption> = emptyList()
    private var activeLensId: String? = null

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

        controlsPanel = LinearLayout(this).apply {
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
        controlsPanel.addView(focusLabel)

        // Desliza de "lejos" (0, izquierda) a "macro" (minFocusDistance,
        // derecha) -- deshabilitado hasta saber si esta lente lo permite
        // (bindCamera lo habilita async, algunos teléfonos son fixed-focus
        // y ahí no hay nada que ajustar).
        focusSeekBar = SeekBar(this).apply {
            max = 1000
            progress = 0
            isEnabled = false
        }
        controlsPanel.addView(focusSeekBar)

        val autoBtn = Button(this).apply {
            text = "Volver a enfoque automático"
            textSize = 12f
            setOnClickListener { resetToAutoFocus() }
        }
        controlsPanel.addView(autoBtn)

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
        controlsPanel.addView(captureRow)

        root.addView(controlsPanel)
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

        bindCamera(previewView, key, CameraSelector.DEFAULT_BACK_CAMERA)
    }

    private fun bindCamera(previewView: PreviewView, key: String, cameraSelector: CameraSelector) {
        previewViewRef = previewView
        currentKey = key
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            try {
                val provider = providerFuture.get()
                // NUEVO (bug real reportado por el usuario -- "la foto tiene
                // más contenido del que veía antes de tomarla"): dos causas
                // combinadas.
                // 1) Sin fijar una estrategia de aspecto, Preview e
                //    ImageCapture negocian resolución cada uno por su
                //    cuenta y pueden terminar en relaciones DISTINTAS (ej.
                //    16:9 el preview, 4:3 la captura) -- acá se fuerza la
                //    MISMA para los dos (AspectRatioStrategy solo admite
                //    4:3 o 16:9, no una relación arbitraria; 16:9 es la más
                //    parecida a una pantalla de teléfono moderna).
                // 2) Aun con la MISMA relación negociada, PreviewView por
                //    default usa scaleType FILL_CENTER: como la pantalla es
                //    más alta y angosta que cualquier stream 4:3/16:9,
                //    "llenar" la vista significa recortar los bordes
                //    laterales del stream -- el usuario ve ese recorte
                //    angosto, pero ImageCapture guarda el cuadro COMPLETO
                //    del stream (sin ese recorte extra), más ancho que lo
                //    que se veía en pantalla. FIT_CENTER (ver abajo, sobre
                //    previewView) muestra el cuadro completo tal cual sin
                //    recortarlo -- con franjas negras arriba/abajo en vez de
                //    "mentir" sobre el encuadre real, que es exactamente lo
                //    que se termina guardando.
                previewView.scaleType = PreviewView.ScaleType.FIT_CENTER
                val matchingAspect = ResolutionSelector.Builder()
                    .setAspectRatioStrategy(AspectRatioStrategy(AspectRatio.RATIO_16_9, AspectRatioStrategy.FALLBACK_RULE_AUTO))
                    .build()
                val preview = Preview.Builder()
                    .setResolutionSelector(matchingAspect)
                    .build()
                    .also { it.setSurfaceProvider(previewView.surfaceProvider) }
                imageCapture = ImageCapture.Builder()
                    .setResolutionSelector(matchingAspect)
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                    .build()
                provider.unbindAll()
                val cam = provider.bindToLifecycle(this, cameraSelector, preview, imageCapture)
                camera = cam
                activeLensId = Camera2CameraInfo.from(cam.cameraInfo).cameraId
                minFocusDistance = Camera2CameraInfo.from(cam.cameraInfo)
                    .getCameraCharacteristic(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f
                focusSeekBar.progress = 0
                if (minFocusDistance > 0f) {
                    focusSeekBar.isEnabled = true
                    focusLabel.text = "Enfoque: auto (deslizá para modo macro)"
                } else {
                    focusSeekBar.isEnabled = false
                    focusLabel.text = "Este teléfono no permite enfoque manual -- foco automático"
                }

                // Recién con una cámara ya bindeada se conoce la distancia
                // focal real de la lente "1x" de referencia -- se arma el
                // selector de lentes UNA sola vez (si hay más de una
                // trasera real); en cambios de lente posteriores solo se
                // refresca cuál chip está activo.
                if (lensOptions.isEmpty()) {
                    val referenceFocal = focalLengthOf(activeLensId!!)
                    lensOptions = detectBackLenses(referenceFocal)
                    if (lensOptions.size > 1) buildLensRow()
                }
                updateActiveLensChip()
            } catch (e: Exception) {
                focusLabel.text = "No se pudo iniciar la cámara: ${e.message}"
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun focalLengthOf(cameraId: String): Float {
        val manager = getSystemService(CAMERA_SERVICE) as CameraManager
        return try {
            manager.getCameraCharacteristics(cameraId)
                .get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
                ?.firstOrNull() ?: 0f
        } catch (e: Exception) {
            0f
        }
    }

    // Etiqueta tipo "0.6x"/"1x"/"3x": aproximación estándar de zoom óptico
    // = distancia focal de esta lente / distancia focal de la lente "1x"
    // (la que CameraX bindea por defecto) -- una lente ultra-wide tiene
    // distancia focal MENOR (FOV más ancho, "menos zoom") y una teleobjetivo
    // MAYOR, así que el cociente cae naturalmente de un lado o del otro de
    // 1.0 sin necesidad de convertir a equivalente de 35mm (que requeriría
    // también el tamaño físico del sensor de cada lente).
    private fun detectBackLenses(referenceFocal: Float): List<LensOption> {
        if (referenceFocal <= 0f) return emptyList()
        val manager = getSystemService(CAMERA_SERVICE) as CameraManager
        val raw = mutableListOf<Pair<String, Float>>()
        for (id in manager.cameraIdList) {
            try {
                val chars = manager.getCameraCharacteristics(id)
                if (chars.get(CameraCharacteristics.LENS_FACING) != CameraCharacteristics.LENS_FACING_BACK) continue
                val focal = chars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull() ?: continue
                raw.add(id to focal)
            } catch (e: Exception) {
                // Una lente que no se puede leer no debería tirar abajo el
                // resto del selector -- se la ignora.
            }
        }
        // distinctBy: algunos teléfonos listan la MISMA lente física bajo
        // más de un id lógico -- se queda con una sola entrada por
        // distancia focal real.
        if (raw.distinctBy { it.second }.size <= 1) return emptyList()
        return raw.distinctBy { it.second }.sortedBy { it.second }.map { (id, focal) ->
            val ratio = focal / referenceFocal
            val label = if (kotlin.math.abs(ratio - 1f) < 0.05f) "1x" else String.format("%.1fx", ratio)
            LensOption(id, label)
        }
    }

    private fun buildLensRow() {
        val scroller = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
        }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        lensOptions.forEach { opt ->
            val chip = Button(this).apply {
                text = opt.label
                textSize = 12f
                tag = opt.cameraId
                setPadding(dp(14), dp(6), dp(14), dp(6))
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    marginEnd = dp(8)
                }
                setOnClickListener { switchLens(opt.cameraId) }
            }
            row.addView(chip)
        }
        scroller.addView(row)
        lensRow = row
        // Arriba de todo del panel de controles (índice 0), para que sea
        // lo primero que se ve al abrir la cámara si el teléfono soporta
        // varias lentes traseras.
        controlsPanel.addView(scroller, 0)
    }

    private fun updateActiveLensChip() {
        val row = lensRow ?: return
        for (i in 0 until row.childCount) {
            val chip = row.getChildAt(i) as? Button ?: continue
            val active = chip.tag == activeLensId
            chip.setTypeface(null, if (active) Typeface.BOLD else Typeface.NORMAL)
            chip.setBackgroundColor(if (active) Color.parseColor("#FFFFFF") else Color.parseColor("#33FFFFFF"))
            chip.setTextColor(if (active) Color.BLACK else Color.WHITE)
        }
    }

    private fun switchLens(cameraId: String) {
        if (cameraId == activeLensId) return
        val pv = previewViewRef ?: return
        val selector = CameraSelector.Builder()
            .addCameraFilter { infos -> infos.filter { Camera2CameraInfo.from(it).cameraId == cameraId } }
            .build()
        bindCamera(pv, currentKey, selector)
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
        // NUEVO (auditoría -- hallazgo MENOR): si imageCapture.takePicture
        // nunca invoca ni onImageSaved ni onError (fallo de hardware/driver
        // de cámara), "capturing" quedaba en true para siempre y el botón
        // de captura no volvía a responder. Timeout simple: si a los 10s
        // seguimos "capturing" (ninguno de los dos callbacks bajó la
        // bandera todavía), se libera la UI sola.
        android.os.Handler(mainLooper).postDelayed({
            if (capturing) {
                capturing = false
                focusLabel.text = "No se pudo sacar la foto: tiempo agotado"
            }
        }, 10000)
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
