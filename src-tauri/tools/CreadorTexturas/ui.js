// ui.js — Creador de Texturas (mobile).
//
// Foto de una superficie -> normal map + mapa de altura + roughness. Igual
// que Paleta de Colores: la foto sale de <input type=file capture=
// environment> (cámara del sistema, sin plugin ni permiso CAMERA propio) y
// todo el procesamiento es Canvas + JS puro.
//
// A propósito NO incluido en esta primera versión (el usuario mismo avisó
// que esto "puede ser un poco más complejo" al pedirlo, así que se recorta
// alcance a propósito en vez de over-engineerear a ciegas):
//   - Tiling/seamless: no se hace que la textura repita sin costuras --
//     eso normalmente exige mirror/offset blending, harina de otro costal.
//   - Ambient occlusion: no hay suficiente información en una sola foto
//     2D para estimar oclusión real sin asumir cosas -- se deja afuera en
//     vez de inventar un mapa que parezca AO pero no lo sea.
//   - Roughness es una ESTIMACIÓN (contraste local, ver computeRoughness)
//     no una medición real -- eso requeriría fotos con distintos ángulos
//     de luz o un sensor específico. Se avisa en la UI, no se pretende que
//     sea precisa.
registerRenderer("creadortexturas", {
    render(tool, area) {
        const root = el("div", { className: "tx-root" });
        area.appendChild(root);

        const WORK_SIZE = 512; // lado más largo de trabajo -- balance velocidad/detalle

        const S = {
            width: 0,
            height: 0,
            heightArr: null,   // Float32Array, luminancia 0..1 por píxel
            albedoCanvas: null,
            heightCanvas: null,
            normalCanvas: null,
            roughnessCanvas: null,
            strength: 2.5,
            busy: false,
            savedMsg: "",
            savedIsError: false,
        };

        function clampIdx(v, max) { return v < 0 ? 0 : v >= max ? max - 1 : v; }

        function loadFile(file) {
            if (!file) return;
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, WORK_SIZE / Math.max(img.width, img.height));
                const w = Math.max(1, Math.round(img.width * scale));
                const h = Math.max(1, Math.round(img.height * scale));
                S.width = w; S.height = h;

                const src = document.createElement("canvas");
                src.width = w; src.height = h;
                const sctx = src.getContext("2d");
                sctx.drawImage(img, 0, 0, w, h);
                URL.revokeObjectURL(url);

                S.albedoCanvas = src;

                const imgData = sctx.getImageData(0, 0, w, h);
                const heightArr = new Float32Array(w * h);
                for (let i = 0; i < w * h; i++) {
                    const r = imgData.data[i * 4], g = imgData.data[i * 4 + 1], b = imgData.data[i * 4 + 2];
                    heightArr[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                }
                S.heightArr = heightArr;

                computeAll();
                renderView();
            };
            img.src = url;
        }

        function getH(x, y) {
            x = clampIdx(x, S.width); y = clampIdx(y, S.height);
            return S.heightArr[y * S.width + x];
        }

        function canvasFromGray(fn) {
            const c = document.createElement("canvas");
            c.width = S.width; c.height = S.height;
            const ctx = c.getContext("2d");
            const out = ctx.createImageData(S.width, S.height);
            for (let y = 0; y < S.height; y++) {
                for (let x = 0; x < S.width; x++) {
                    const v = fn(x, y);
                    const idx = (y * S.width + x) * 4;
                    out.data[idx] = out.data[idx + 1] = out.data[idx + 2] = v;
                    out.data[idx + 3] = 255;
                }
            }
            ctx.putImageData(out, 0, 0);
            return c;
        }

        function computeHeightMap() {
            S.heightCanvas = canvasFromGray((x, y) => Math.round(getH(x, y) * 255));
        }

        function computeNormalMap() {
            const c = document.createElement("canvas");
            c.width = S.width; c.height = S.height;
            const ctx = c.getContext("2d");
            const out = ctx.createImageData(S.width, S.height);
            const strength = S.strength;
            for (let y = 0; y < S.height; y++) {
                for (let x = 0; x < S.width; x++) {
                    // Kernel de Sobel sobre el mapa de altura -- técnica
                    // estándar para "relieve a partir de una imagen": el
                    // gradiente horizontal/vertical local se interpreta
                    // como la inclinación de la superficie en ese punto.
                    const tl = getH(x - 1, y - 1), t = getH(x, y - 1), tr = getH(x + 1, y - 1);
                    const l = getH(x - 1, y), r = getH(x + 1, y);
                    const bl = getH(x - 1, y + 1), b = getH(x, y + 1), br = getH(x + 1, y + 1);
                    const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
                    const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
                    let nx = -dx * strength, ny = -dy * strength, nz = 1;
                    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
                    nx /= len; ny /= len; nz /= len;
                    const idx = (y * S.width + x) * 4;
                    out.data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
                    out.data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
                    out.data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
                    out.data[idx + 3] = 255;
                }
            }
            ctx.putImageData(out, 0, 0);
            S.normalCanvas = c;
        }

        function computeRoughnessMap() {
            // Heurística simple (NO una medición real, ver nota arriba):
            // diferencia entre la altura y una versión desenfocada 3x3 --
            // zonas con mucho detalle/textura fina quedan más "rugosas",
            // zonas lisas quedan más "pulidas". Normalizado contra el
            // máximo encontrado para aprovechar todo el rango 0-255.
            const w = S.width, h = S.height;
            const blurred = new Float32Array(w * h);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    let sum = 0;
                    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += getH(x + dx, y + dy);
                    blurred[y * w + x] = sum / 9;
                }
            }
            let maxDiff = 0.0001;
            const diff = new Float32Array(w * h);
            for (let i = 0; i < w * h; i++) {
                diff[i] = Math.abs(S.heightArr[i] - blurred[i]);
                if (diff[i] > maxDiff) maxDiff = diff[i];
            }
            S.roughnessCanvas = canvasFromGray((x, y) => Math.round((diff[y * w + x] / maxDiff) * 255));
        }

        function computeAll() {
            computeHeightMap();
            computeNormalMap();
            computeRoughnessMap();
        }

        function bytesToBase64(bytes) {
            let binary = "";
            const chunk = 8192;
            for (let i = 0; i < bytes.length; i += chunk) {
                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
            }
            return btoa(binary);
        }

        async function saveCanvas(canvas, filename) {
            S.busy = true; S.savedMsg = ""; S.savedIsError = false; renderView();
            try {
                const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
                const buf = await blob.arrayBuffer();
                const base64 = bytesToBase64(new Uint8Array(buf));
                const path = await invoke("save_texture_png", { filename, dataBase64: base64 });
                S.savedMsg = `Guardado: ${path}`;
            } catch (e) {
                S.savedMsg = "Error: " + e;
                S.savedIsError = true;
            } finally {
                S.busy = false; renderView();
            }
        }

        function mapCard(canvas, title, filename) {
            const card = el("div", { className: "tx-card" });
            card.appendChild(el("div", { className: "tx-card-title", textContent: title }));
            const wrap = el("div", { className: "tx-canvas-wrap" });
            canvas.className = "tx-canvas";
            wrap.appendChild(canvas);
            card.appendChild(wrap);
            const saveBtn = el("button", { textContent: "Guardar", disabled: S.busy });
            saveBtn.onclick = () => saveCanvas(canvas, filename);
            card.appendChild(saveBtn);
            return card;
        }

        function renderView() {
            root.innerHTML = "";

            const pickRow = el("div", { className: "tx-pick-row" });
            const cameraInp = el("input", { type: "file", accept: "image/*", capture: "environment", className: "tx-hidden-input" });
            cameraInp.onchange = (e) => loadFile(e.target.files[0]);
            const cameraBtn = el("button", { className: "primary", textContent: "📷 Tomar foto" });
            cameraBtn.onclick = () => cameraInp.click();

            const galleryInp = el("input", { type: "file", accept: "image/*", className: "tx-hidden-input" });
            galleryInp.onchange = (e) => loadFile(e.target.files[0]);
            const galleryBtn = el("button", { textContent: "🖼️ Elegir de galería" });
            galleryBtn.onclick = () => galleryInp.click();

            pickRow.append(cameraInp, cameraBtn, galleryInp, galleryBtn);
            root.appendChild(pickRow);

            if (!S.albedoCanvas) {
                root.appendChild(el("p", { className: "tx-empty", textContent: "Sacale una foto de cerca y de frente a una superficie (piedra, madera, tela...) para generar su set de texturas." }));
                return;
            }

            const strengthRow = el("div", { className: "tx-slider-row" });
            strengthRow.appendChild(el("label", { textContent: `Fuerza del relieve: ${S.strength.toFixed(1)}` }));
            const slider = el("input", { type: "range", min: "0.5", max: "6", step: "0.1", value: String(S.strength) });
            slider.oninput = (e) => { S.strength = parseFloat(e.target.value); computeNormalMap(); renderView(); };
            strengthRow.appendChild(slider);
            root.appendChild(strengthRow);

            if (S.savedMsg) {
                root.appendChild(el("p", { className: S.savedIsError ? "tx-saved-msg tx-saved-msg--error" : "tx-saved-msg", textContent: S.savedMsg }));
                if (S.savedIsError && S.savedMsg.includes("Acceso a todos los archivos")) {
                    const permBtn = el("button", { textContent: "Dar permiso" });
                    permBtn.onclick = async () => { try { await invoke("sync_request_storage_permission"); } catch (e) { /* best effort */ } };
                    root.appendChild(permBtn);
                }
            }

            const grid = el("div", { className: "tx-grid" });
            grid.appendChild(mapCard(S.albedoCanvas, "Albedo (color)", "albedo.png"));
            grid.appendChild(mapCard(S.normalCanvas, "Normal map", "normal.png"));
            grid.appendChild(mapCard(S.heightCanvas, "Altura / desplazamiento", "altura.png"));
            grid.appendChild(mapCard(S.roughnessCanvas, "Roughness (estimado)", "roughness.png"));
            root.appendChild(grid);

            root.appendChild(el("p", { className: "tx-hint", textContent: "Roughness es una estimación a partir del contraste local, no una medición real -- ajustala a mano en tu motor/editor si hace falta." }));
        }

        renderView();
    },
    onOutput() {},
    onDone() {},
});
