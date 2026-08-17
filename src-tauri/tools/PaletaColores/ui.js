// ui.js — Paleta de Colores (mobile).
//
// 100% cliente, sin comandos Rust: tomar/elegir una foto usa
// <input type="file" accept="image/*" capture="environment"> -- en Android,
// el WebView le pasa esto directo a la cámara del sistema (o a la galería,
// según el input) sin que haga falta pedir el permiso CAMERA a mano ni
// escribir ningún plugin nativo -- es la app de cámara del sistema la que
// toma la foto, a nosotros solo nos llega el archivo resultante. Todo el
// procesamiento (extraer la paleta) es Canvas + JS puro.
//
// Algoritmo: "popularidad con diversidad" en vez de k-means/median-cut de
// verdad (mucho más código para el beneficio real acá) -- se arma un
// histograma de color cuantizado (menos niveles por canal que 0-255) para
// agrupar píxeles parecidos, se ordena por frecuencia, y se van
// seleccionando los colores más frecuentes EXIGIENDO que cada uno nuevo
// esté a cierta distancia mínima de los ya elegidos (si no, una foto de un
// atardecer podría devolver 6 variantes casi idénticas de naranja en vez de
// una paleta variada). Ese umbral de distancia se relaja de a poco si no
// alcanzan colores suficientemente distintos.
registerRenderer("paletacolores", {
    render(tool, area) {
        const root = el("div", { className: "pc-root" });
        area.appendChild(root);

        const S = {
            imageUrl: null,
            imageData: null, // ImageData de una versión reducida de la foto, para procesar rápido
            count: 6,
            palette: [],
            copiedHex: null,
        };

        function rgbToHex(r, g, b) {
            return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
        }

        function dist2(a, b) {
            const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
            return dr * dr + dg * dg + db * db;
        }

        function extractPalette(imageData, k) {
            const data = imageData.data;
            const BITS = 4; // 16 niveles por canal -- suficiente para agrupar sin perder variedad real
            const shift = 8 - BITS;
            const buckets = new Map();
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] < 128) continue; // píxeles transparentes, no cuentan
                const r = data[i], g = data[i + 1], b = data[i + 2];
                const key = ((r >> shift) << (BITS * 2)) | ((g >> shift) << BITS) | (b >> shift);
                let bucket = buckets.get(key);
                if (!bucket) { bucket = { count: 0, r: 0, g: 0, b: 0 }; buckets.set(key, bucket); }
                bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b;
            }
            const list = Array.from(buckets.values()).map(b => ({
                count: b.count,
                r: Math.round(b.r / b.count), g: Math.round(b.g / b.count), b: Math.round(b.b / b.count),
            }));
            list.sort((a, b) => b.count - a.count);

            const selected = [];
            let threshold = 4800;
            while (selected.length < k && threshold >= 0) {
                for (const cand of list) {
                    if (selected.length >= k) break;
                    if (selected.includes(cand)) continue;
                    if (selected.every(s => dist2(s, cand) >= threshold)) selected.push(cand);
                }
                threshold -= 600;
            }
            for (const cand of list) {
                if (selected.length >= k) break;
                if (!selected.includes(cand)) selected.push(cand);
            }
            return selected.slice(0, k);
        }

        function loadFile(file) {
            if (!file) return;
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                if (S.imageUrl) URL.revokeObjectURL(S.imageUrl);
                S.imageUrl = url;

                // Reducir a como mucho 220px de lado más largo antes de leer
                // los píxeles -- procesar una foto de 12MP entera no aporta
                // nada a la paleta y sí tarda.
                const maxSide = 220;
                const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
                const w = Math.max(1, Math.round(img.width * scale));
                const h = Math.max(1, Math.round(img.height * scale));
                const canvas = document.createElement("canvas");
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, w, h);
                S.imageData = ctx.getImageData(0, 0, w, h);
                S.palette = extractPalette(S.imageData, S.count);
                renderView();
            };
            img.src = url;
        }

        function reextract() {
            if (!S.imageData) return;
            S.palette = extractPalette(S.imageData, S.count);
            renderView();
        }

        async function copyHex(hex) {
            try { await navigator.clipboard.writeText(hex); } catch (e) { /* sin clipboard, no es grave */ }
            S.copiedHex = hex;
            renderView();
            setTimeout(() => { if (S.copiedHex === hex) { S.copiedHex = null; renderView(); } }, 1200);
        }

        function renderView() {
            root.innerHTML = "";

            const pickRow = el("div", { className: "pc-pick-row" });
            const cameraInp = el("input", { type: "file", accept: "image/*", capture: "environment", className: "pc-hidden-input" });
            cameraInp.onchange = (e) => loadFile(e.target.files[0]);
            const cameraBtn = el("button", { className: "primary", textContent: "📷 Tomar foto" });
            cameraBtn.onclick = () => cameraInp.click();

            const galleryInp = el("input", { type: "file", accept: "image/*", className: "pc-hidden-input" });
            galleryInp.onchange = (e) => loadFile(e.target.files[0]);
            const galleryBtn = el("button", { textContent: "🖼️ Elegir de galería" });
            galleryBtn.onclick = () => galleryInp.click();

            pickRow.append(cameraInp, cameraBtn, galleryInp, galleryBtn);
            root.appendChild(pickRow);

            if (!S.imageUrl) {
                root.appendChild(el("p", { className: "pc-empty", textContent: "Tomá o elegí una foto para sacarle una paleta de colores." }));
                return;
            }

            root.appendChild(el("img", { className: "pc-preview", src: S.imageUrl }));

            const sliderRow = el("div", { className: "pc-slider-row" });
            const sliderLabel = el("label", { textContent: `Detalle de la paleta: ${S.count} colores` });
            sliderRow.appendChild(sliderLabel);
            const slider = el("input", { type: "range", min: "3", max: "12", value: String(S.count) });
            // NUEVO (bug real, arreglado): reextract() termina en
            // renderView() (root.innerHTML = ""), que en "input" (dispara
            // en cada tick de arrastre) destruye el propio <input> a mitad
            // de gesto y corta la captura táctil nativa -- solo el primer
            // toque llegaba a cambiar el valor. "input" ahora solo
            // actualiza el label; volver a extraer la paleta (más re-render
            // completo) se hace una sola vez al soltar ("change").
            slider.oninput = (e) => {
                S.count = parseInt(e.target.value, 10);
                sliderLabel.textContent = `Detalle de la paleta: ${S.count} colores`;
            };
            slider.onchange = () => reextract();
            sliderRow.appendChild(slider);
            root.appendChild(sliderRow);

            const swatches = el("div", { className: "pc-swatches" });
            S.palette.forEach(c => {
                const hex = rgbToHex(c.r, c.g, c.b);
                const sw = el("button", { className: "pc-swatch" });
                sw.style.background = hex;
                sw.onclick = () => copyHex(hex);
                sw.innerHTML = `<span class="pc-swatch-hex">${S.copiedHex === hex ? "Copiado ✓" : hex}</span>`;
                // Contraste simple para que el texto se lea sobre cualquier color.
                const luminance = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
                sw.classList.add(luminance > 0.6 ? "pc-swatch--dark-text" : "pc-swatch--light-text");
                swatches.appendChild(sw);
            });
            root.appendChild(swatches);
        }

        renderView();
    },
    onOutput() {},
    onDone() {},
});
