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
//
// NUEVO (pedido del usuario): cada color seleccionado recuerda de qué
// "cubo" del histograma cuantizado salió (bucket.key) -- "Ver origen"
// reconstruye la miniatura ya procesada (S.imageData) oscureciendo todo
// pixel que NO cayó en ese cubo, para que salte a la vista en qué parte de
// la foto está ese color. También se puede copiar la paleta entera como
// lista de texto (un hex por línea) en vez de tener que tocar color por
// color.
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
            copiedList: false,
            originKey: null, // bucket.key del color cuyo origen se está mostrando, o null
        };

        const BITS = 4; // 16 niveles por canal -- mismo valor usado al extraer y al resaltar origen
        const SHIFT = 8 - BITS;
        function bucketKey(r, g, b) {
            return ((r >> SHIFT) << (BITS * 2)) | ((g >> SHIFT) << BITS) | (b >> SHIFT);
        }

        function rgbToHex(r, g, b) {
            return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
        }

        function dist2(a, b) {
            const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
            return dr * dr + dg * dg + db * db;
        }

        function extractPalette(imageData, k) {
            const data = imageData.data;
            const buckets = new Map();
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] < 128) continue; // píxeles transparentes, no cuentan
                const r = data[i], g = data[i + 1], b = data[i + 2];
                const key = bucketKey(r, g, b);
                let bucket = buckets.get(key);
                if (!bucket) { bucket = { key, count: 0, r: 0, g: 0, b: 0 }; buckets.set(key, bucket); }
                bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b;
            }
            const list = Array.from(buckets.values()).map(b => ({
                key: b.key,
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

        // Reconstruye la miniatura procesada oscureciendo todo lo que NO
        // pertenece al cubo `key` -- así se ve de un vistazo qué parte de la
        // foto generó ese color exacto de la paleta.
        function buildOriginDataUrl(key) {
            const { width, height, data } = S.imageData;
            const canvas = document.createElement("canvas");
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext("2d");
            const out = ctx.createImageData(width, height);
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
                if (bucketKey(r, g, b) === key) {
                    out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = a;
                } else {
                    out.data[i] = r * 0.15; out.data[i + 1] = g * 0.15; out.data[i + 2] = b * 0.15; out.data[i + 3] = a;
                }
            }
            ctx.putImageData(out, 0, 0);
            return canvas.toDataURL("image/png");
        }

        function loadFile(file) {
            if (!file) return;
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                if (S.imageUrl) URL.revokeObjectURL(S.imageUrl);
                S.imageUrl = url;
                S.originKey = null;

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
            S.originKey = null;
            S.palette = extractPalette(S.imageData, S.count);
            renderView();
        }

        async function copyHex(hex) {
            try { await navigator.clipboard.writeText(hex); } catch (e) { /* sin clipboard, no es grave */ }
            S.copiedHex = hex;
            renderView();
            setTimeout(() => { if (S.copiedHex === hex) { S.copiedHex = null; renderView(); } }, 1200);
        }

        async function copyList() {
            const text = S.palette.map(c => rgbToHex(c.r, c.g, c.b)).join("\n");
            try { await navigator.clipboard.writeText(text); } catch (e) { /* sin clipboard, no es grave */ }
            S.copiedList = true;
            renderView();
            setTimeout(() => { S.copiedList = false; renderView(); }, 1200);
        }

        function renderView() {
            root.innerHTML = "";

            const pickRow = el("div", { className: "pc-pick-row" });
            const cameraInp = el("input", { type: "file", accept: "image/*", capture: "environment", className: "pc-hidden-input" });
            cameraInp.onchange = (e) => loadFile(e.target.files[0]);
            const cameraBtn = el("button", { className: "primary pc-pick-btn" });
            cameraBtn.innerHTML = `${window.AlejoIcons.glyph("camera", 18)}<span>Tomar foto</span>`;
            cameraBtn.onclick = () => cameraInp.click();

            const galleryInp = el("input", { type: "file", accept: "image/*", className: "pc-hidden-input" });
            galleryInp.onchange = (e) => loadFile(e.target.files[0]);
            const galleryBtn = el("button", { className: "pc-pick-btn" });
            galleryBtn.innerHTML = `${window.AlejoIcons.glyph("image", 18)}<span>Elegir de galería</span>`;
            galleryBtn.onclick = () => galleryInp.click();

            pickRow.append(cameraInp, cameraBtn, galleryInp, galleryBtn);
            root.appendChild(pickRow);

            if (!S.imageUrl) {
                root.appendChild(el("p", { className: "pc-empty", textContent: "Tomá o elegí una foto para sacarle una paleta de colores." }));
                return;
            }

            const originColor = S.originKey != null ? S.palette.find(c => c.key === S.originKey) : null;
            if (originColor) {
                const wrap = el("div", { className: "pc-origin-wrap" });
                wrap.appendChild(el("img", { className: "pc-preview pc-preview--origin", src: buildOriginDataUrl(S.originKey) }));
                const hint = el("div", { className: "pc-origin-hint" });
                hint.innerHTML = `<span>La zona resaltada es de dónde salió ${rgbToHex(originColor.r, originColor.g, originColor.b)}</span>`;
                const closeBtn = el("button", { textContent: "Volver a la foto completa" });
                closeBtn.onclick = () => { S.originKey = null; renderView(); };
                hint.appendChild(closeBtn);
                wrap.appendChild(hint);
                root.appendChild(wrap);
            } else {
                root.appendChild(el("img", { className: "pc-preview", src: S.imageUrl }));
            }

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

            const listHeader = el("div", { className: "pc-list-header" });
            listHeader.appendChild(el("span", { textContent: "Paleta" }));
            const copyListBtn = el("button", { className: "pc-copy-list-btn" });
            copyListBtn.innerHTML = S.copiedList
                ? `${window.AlejoIcons.glyph("check", 15)}<span>Lista copiada</span>`
                : `${window.AlejoIcons.glyph("copy", 15)}<span>Copiar lista</span>`;
            copyListBtn.onclick = copyList;
            listHeader.appendChild(copyListBtn);
            root.appendChild(listHeader);

            // Lista de filas (en vez de una grilla de cuadrados chicos con
            // texto apretado adentro) -- pedido del usuario: "más intuitivo
            // de leer". Cada fila: pastilla de color + hex + rgb, tocar la
            // fila copia el hex, un botón aparte muestra de dónde salió.
            const swatches = el("div", { className: "pc-swatch-list" });
            S.palette.forEach(c => {
                const hex = rgbToHex(c.r, c.g, c.b);
                const row = el("div", { className: "pc-swatch-row" });
                const dot = el("span", { className: "pc-swatch-dot" });
                dot.style.background = hex;
                const text = el("div", { className: "pc-swatch-text" });
                text.innerHTML = `<div class="pc-swatch-hex">${hex}</div><div class="pc-swatch-rgb">rgb(${c.r}, ${c.g}, ${c.b})</div>`;

                const copyBtn = el("button", { className: "pc-swatch-copy" });
                copyBtn.innerHTML = S.copiedHex === hex ? window.AlejoIcons.glyph("check", 17) : window.AlejoIcons.glyph("copy", 17);
                copyBtn.onclick = (e) => { e.stopPropagation(); copyHex(hex); };

                const originBtn = el("button", { className: `pc-swatch-origin${S.originKey === c.key ? " pc-swatch-origin--active" : ""}` });
                originBtn.innerHTML = window.AlejoIcons.glyph("eye", 17);
                originBtn.title = "Ver de dónde salió este color";
                originBtn.onclick = (e) => { e.stopPropagation(); S.originKey = S.originKey === c.key ? null : c.key; renderView(); };

                row.append(dot, text, originBtn, copyBtn);
                row.onclick = () => copyHex(hex);
                swatches.appendChild(row);
            });
            root.appendChild(swatches);
        }

        renderView();
    },
    onOutput() {},
    onDone() {},
});
