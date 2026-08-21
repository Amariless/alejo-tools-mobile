// ui.js — Creador de Texturas (mobile).
//
// Foto de una superficie -> normal map + mapa de altura + roughness +
// oclusión (estimada). Dos pestañas (mismo patrón que Reloj/Lector de
// Documentos): "Crear" (todo el flujo cámara -> recorte -> mapas ->
// guardar) y "Colecciones" (organizar lo ya guardado).
//
// NUEVO (pedido grande del usuario, esta es la reescritura completa):
//   - "Tomar foto" ahora abre la app de cámara COMPLETA del sistema (con
//     todos sus modos -- macro, Pro, noche, etc.) en vez de la mini-UI
//     reducida que daba <input capture=environment> del WebView -- ver
//     ctx.captureFullCamera en main.js / camera.rs / CameraCapture.kt.
//     "Elegir de galería" sigue usando el <input type=file> normal (el
//     selector de archivos del sistema ya muestra todo bien).
//   - Recorte: antes de procesar, se puede ajustar un recuadro sobre la
//     foto (arrastrando las esquinas) o usar la foto completa.
//   - Selección + guardado por lote: cada mapa generado es una "tarjeta"
//     que se toca para marcar/desmarcar (en vez de un botón "Guardar" por
//     mapa) -- Albedo queda SIEMPRE marcado. Un botón al fondo guarda
//     todo lo marcado de una, eligiendo (o creando) una Colección.
//   - Colecciones: nombre único + categoría (lista curada de materiales),
//     buscador con filtro en vivo, y las categorías se ordenan por
//     cantidad de colecciones (de mayor a menor, las de cero orden
//     alfabético) -- ver collections.rs para el guardado (una carpeta de
//     verdad por colección, renombrable, sin nombres duplicados ni
//     caracteres inválidos).
//   - Mapa nuevo: oclusión/cavidad (estimada) -- ver computeAOMap. Sigue
//     sin haber tiling/AO real ni metallic: no hay información suficiente
//     en una sola foto 2D para eso sin inventar datos (mismo criterio que
//     ya regía roughness).
registerRenderer("creadortexturas", {
    render(tool, area) {
        const root = el("div", { className: "tx-root" });
        area.appendChild(root);

        const WORK_SIZE = 512; // lado más largo de trabajo -- balance velocidad/detalle

        const CATEGORIES = [
            ["madera", "Madera"], ["piedra", "Piedra"], ["cemento", "Cemento/Hormigón"], ["metal", "Metal"],
            ["plastico", "Plástico"], ["tela", "Tela/Tejido"], ["cuero", "Cuero"], ["vidrio", "Vidrio"],
            ["ceramica", "Cerámica/Azulejo"], ["ladrillo", "Ladrillo"], ["papel", "Papel/Cartón"], ["arena", "Arena"],
            ["tierra", "Tierra"], ["pasto", "Pasto/Césped"], ["hojas", "Hojas/Follaje"], ["agua", "Agua"],
            ["nieve", "Nieve/Hielo"], ["oxido", "Óxido/Herrumbre"], ["pintura", "Pintura"], ["goma", "Goma/Caucho"],
            ["alfombra", "Alfombra"], ["marmol", "Mármol"], ["granito", "Granito"], ["yeso", "Yeso"],
            ["corcho", "Corcho"], ["mimbre", "Mimbre/Ratán"], ["piel", "Piel/Animal"], ["otro", "Otro"],
        ];
        const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);
        const MAPS = [
            ["albedo", "albedoCanvas", "albedo.png", "Albedo (color)"],
            ["normal", "normalCanvas", "normal.png", "Normal map"],
            ["height", "heightCanvas", "altura.png", "Altura / desplazamiento"],
            ["roughness", "roughnessCanvas", "roughness.png", "Roughness (estimado)"],
            ["ao", "aoCanvas", "oclusion.png", "Oclusión / cavidad (estimada)"],
        ];

        const S = {
            tab: "crear", // crear | colecciones
            view: "pick", // pick | crop | result
            pendingImage: null, // { img, url }
            cropBox: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
            width: 0, height: 0, heightArr: null,
            albedoCanvas: null, heightCanvas: null, normalCanvas: null, roughnessCanvas: null, aoCanvas: null,
            strength: 2.5,
            selected: { albedo: true, normal: false, height: false, roughness: false, ao: false },
            busy: false, savedMsg: "", savedIsError: false,
            capturing: false,
            saveSheetOpen: false,
            newCollectionDialog: null, // { name, category }

            collections: [],
            collectionsQuery: "",
            collectionsCategory: null,
            collectionMenu: null, // collection
            renameDialog: null,   // collection
            activeCollection: null,
            activeImages: [],
        };

        function clampIdx(v, max) { return v < 0 ? 0 : v >= max ? max - 1 : v; }
        function assetUrl(path) { return window.__TAURI__.core.convertFileSrc(path); }

        // ── Carga de imagen (cámara completa, galería, o recorte pendiente) ──
        function loadImageFromUrl(url) {
            const img = new Image();
            img.onload = () => {
                S.pendingImage = { img, url };
                S.cropBox = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
                S.view = "crop";
                renderView();
            };
            img.onerror = () => alert("No se pudo cargar la imagen.");
            img.src = url;
        }

        function loadFile(file) {
            if (!file) return;
            loadImageFromUrl(URL.createObjectURL(file));
        }

        // NUEVO (bug real, encontrado en vivo con Chrome DevTools conectado
        // al WebView -- ver la nota grande en camera_read_as_data_url,
        // camera.rs): la foto de la cámara NO se carga con
        // assetUrl()/convertFileSrc como el resto de las imágenes que solo
        // se muestran -- acá el recorte necesita leer píxeles del canvas
        // (getImageData), y una imagen servida por el asset protocol
        // contamina ("taintea") el canvas -- getImageData tira SecurityError
        // y el botón de recorte parece "no responder" (el toque sí llega,
        // el handler revienta adentro). data: URL no tiene ese problema.
        async function loadCapturedPhoto(path) {
            const dataUrl = await invoke("camera_read_as_data_url", { path });
            loadImageFromUrl(dataUrl);
        }

        async function captureFromCamera() {
            if (S.capturing) return;
            S.capturing = true; renderView();
            const path = await ctx.captureFullCamera("texturas");
            S.capturing = false;
            if (!path) { renderView(); return; }
            await loadCapturedPhoto(path);
        }

        // ── Recorte ──
        function applyCrop(useFullPhoto) {
            const img = S.pendingImage.img;
            const box = useFullPhoto ? { x: 0, y: 0, w: 1, h: 1 } : S.cropBox;
            const sx = Math.round(box.x * img.naturalWidth);
            const sy = Math.round(box.y * img.naturalHeight);
            const sw = Math.max(1, Math.round(box.w * img.naturalWidth));
            const sh = Math.max(1, Math.round(box.h * img.naturalHeight));

            const scale = Math.min(1, WORK_SIZE / Math.max(sw, sh));
            const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
            S.width = w; S.height = h;

            const src = document.createElement("canvas");
            src.width = w; src.height = h;
            const sctx = src.getContext("2d");
            sctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
            S.albedoCanvas = src;

            const imgData = sctx.getImageData(0, 0, w, h);
            const heightArr = new Float32Array(w * h);
            for (let i = 0; i < w * h; i++) {
                const r = imgData.data[i * 4], g = imgData.data[i * 4 + 1], b = imgData.data[i * 4 + 2];
                heightArr[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            }
            S.heightArr = heightArr;

            if (S.pendingImage.url.startsWith("blob:")) URL.revokeObjectURL(S.pendingImage.url);
            S.pendingImage = null;

            computeAll();
            S.selected = { albedo: true, normal: false, height: false, roughness: false, ao: false };
            S.savedMsg = "";
            S.view = "result";
            renderView();
        }

        function cancelCrop() {
            if (S.pendingImage?.url.startsWith("blob:")) URL.revokeObjectURL(S.pendingImage.url);
            S.pendingImage = null;
            S.view = "pick";
            renderView();
        }

        // Arrastre de las 4 esquinas del recuadro de recorte -- coordenadas
        // en fracción (0..1) de la imagen NATURAL, convertidas desde
        // píxeles CSS del contenedor donde se muestra (que puede estar
        // escalada respecto del tamaño real de la foto).
        function attachCropHandles(containerEl, boxEl, masks) {
            function applyBoxStyle() {
                const { x, y, w, h } = S.cropBox;
                boxEl.style.left = `${x * 100}%`;
                boxEl.style.top = `${y * 100}%`;
                boxEl.style.width = `${w * 100}%`;
                boxEl.style.height = `${h * 100}%`;
                masks.maskTop.style.height = `${y * 100}%`;
                masks.maskBottom.style.top = `${(y + h) * 100}%`;
                masks.maskLeft.style.top = `${y * 100}%`;
                masks.maskLeft.style.height = `${h * 100}%`;
                masks.maskLeft.style.width = `${x * 100}%`;
                masks.maskRight.style.top = `${y * 100}%`;
                masks.maskRight.style.height = `${h * 100}%`;
                masks.maskRight.style.left = `${(x + w) * 100}%`;
            }
            const MIN = 0.12;

            function dragHandle(corner) {
                return (e) => {
                    e.stopPropagation();
                    const startRect = containerEl.getBoundingClientRect();
                    const start = { ...S.cropBox };
                    // Bordes ABSOLUTOS fijos: el borde opuesto a la esquina
                    // que se arrastra no se mueve nunca. Antes se calculaba
                    // x/w (o y/h) por separado y se resolvía el choque entre
                    // ellos DESPUÉS con un clamp posicional -- eso hacía que
                    // si arrastrabas "br" bien afuera del borde derecho, `w`
                    // quedaba sin tope y el clamp de `x` (a 1-w, negativo)
                    // lo mandaba de golpe a 0, con `w` reclamado a 1 en el
                    // paso siguiente: el recuadro "saltaba" a cubrir toda la
                    // imagen en vez de simplemente detenerse en el borde
                    // (bug real reportado por el usuario). Clampeando cada
                    // borde arrastrado directo contra [0,1] y contra el
                    // borde fijo opuesto (con margen MIN) no hay ningún paso
                    // intermedio que pueda producir ese salto.
                    const fixedLeft = start.x, fixedTop = start.y;
                    const fixedRight = start.x + start.w, fixedBottom = start.y + start.h;
                    function move(ev) {
                        const dx = (ev.clientX - e.clientX) / startRect.width;
                        const dy = (ev.clientY - e.clientY) / startRect.height;
                        let left = fixedLeft, top = fixedTop, right = fixedRight, bottom = fixedBottom;
                        if (corner.includes("l")) left = Math.max(0, Math.min(fixedRight - MIN, start.x + dx));
                        if (corner.includes("r")) right = Math.min(1, Math.max(fixedLeft + MIN, fixedRight + dx));
                        if (corner.includes("t")) top = Math.max(0, Math.min(fixedBottom - MIN, start.y + dy));
                        if (corner.includes("b")) bottom = Math.min(1, Math.max(fixedTop + MIN, fixedBottom + dy));
                        S.cropBox = { x: left, y: top, w: right - left, h: bottom - top };
                        applyBoxStyle();
                    }
                    function up() {
                        window.removeEventListener("pointermove", move);
                        window.removeEventListener("pointerup", up);
                    }
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up);
                };
            }

            function dragMove() {
                return (e) => {
                    const startRect = containerEl.getBoundingClientRect();
                    const start = { ...S.cropBox };
                    function move(ev) {
                        const dx = (ev.clientX - e.clientX) / startRect.width;
                        const dy = (ev.clientY - e.clientY) / startRect.height;
                        let x = Math.max(0, Math.min(1 - start.w, start.x + dx));
                        let y = Math.max(0, Math.min(1 - start.h, start.y + dy));
                        S.cropBox = { x, y, w: start.w, h: start.h };
                        applyBoxStyle();
                    }
                    function up() {
                        window.removeEventListener("pointermove", move);
                        window.removeEventListener("pointerup", up);
                    }
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up);
                };
            }

            boxEl.onpointerdown = dragMove();
            ["tl", "tr", "bl", "br"].forEach(corner => {
                const handle = boxEl.querySelector(`.tx-crop-handle--${corner}`);
                if (handle) handle.onpointerdown = dragHandle(corner);
            });
            applyBoxStyle();
        }

        // ── Cómputo de mapas ──
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
            // Reusa el mismo elemento <canvas> si ya existe (en vez de crear
            // uno nuevo cada vez) -- así el slider de fuerza puede repintarlo
            // en cada "input" (mientras se arrastra) sin tener que tocar el
            // DOM ni volver a llamar a renderView(): el <canvas> ya montado
            // en la tarjeta de resultado se actualiza en el lugar. Asignar
            // width/height a un canvas existente ya lo limpia solo.
            const c = S.normalCanvas instanceof HTMLCanvasElement ? S.normalCanvas : document.createElement("canvas");
            c.width = S.width; c.height = S.height;
            const ctx = c.getContext("2d");
            const out = ctx.createImageData(S.width, S.height);
            const strength = S.strength;
            for (let y = 0; y < S.height; y++) {
                for (let x = 0; x < S.width; x++) {
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

        // Blur separable (horizontal + vertical, mucho más barato que un
        // kernel cuadrado completo) sobre un radio más grande que el de
        // roughness -- la diferencia entre la altura fina y este blur
        // "amplio" es lo que se interpreta como cavidad/oclusión: zonas
        // hundidas respecto de su entorno quedan más oscuras. Técnica
        // conocida como "cavity map" en pipelines de texturizado -- NO es
        // ambient occlusion real (eso necesitaría geometría 3D de verdad),
        // por eso el nombre en la UI aclara "estimada".
        function boxBlur(src, w, h, r) {
            const tmp = new Float32Array(w * h);
            const out = new Float32Array(w * h);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    let sum = 0;
                    for (let dx = -r; dx <= r; dx++) sum += src[y * w + clampIdx(x + dx, w)];
                    tmp[y * w + x] = sum / (2 * r + 1);
                }
            }
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    let sum = 0;
                    for (let dy = -r; dy <= r; dy++) sum += tmp[clampIdx(y + dy, h) * w + x];
                    out[y * w + x] = sum / (2 * r + 1);
                }
            }
            return out;
        }

        function computeAOMap() {
            const w = S.width, h = S.height;
            const blurred = boxBlur(S.heightArr, w, h, 5);
            let minV = Infinity, maxV = -Infinity;
            const diff = new Float32Array(w * h);
            for (let i = 0; i < w * h; i++) {
                diff[i] = S.heightArr[i] - blurred[i];
                if (diff[i] < minV) minV = diff[i];
                if (diff[i] > maxV) maxV = diff[i];
            }
            const range = Math.max(0.0001, maxV - minV);
            S.aoCanvas = canvasFromGray((x, y) => Math.round(((diff[y * w + x] - minV) / range) * 255));
        }

        function computeAll() {
            computeHeightMap();
            computeNormalMap();
            computeRoughnessMap();
            computeAOMap();
        }

        function bytesToBase64(bytes) {
            let binary = "";
            const chunk = 8192;
            for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
            return btoa(binary);
        }

        // ── Selección + guardado por lote en una Colección ──
        function toggleSelect(key) {
            if (key === "albedo") return; // siempre marcado, pedido del usuario
            S.selected[key] = !S.selected[key];
            renderView();
        }

        function selectedCount() { return Object.values(S.selected).filter(Boolean).length; }

        async function saveSelectedToCollection(collectionId) {
            S.saveSheetOpen = false;
            S.busy = true; S.savedMsg = ""; S.savedIsError = false; renderView();
            try {
                for (const [key, canvasKey, filename] of MAPS) {
                    if (!S.selected[key]) continue;
                    const canvas = S[canvasKey];
                    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
                    const buf = await blob.arrayBuffer();
                    const base64 = bytesToBase64(new Uint8Array(buf));
                    await invoke("collections_add_image", { id: collectionId, filename, dataBase64: base64 });
                }
                S.savedMsg = "Guardado en la colección.";
                await loadCollections();
            } catch (e) {
                S.savedMsg = "Error: " + e;
                S.savedIsError = true;
            } finally {
                S.busy = false; renderView();
            }
        }

        async function createCollectionAndSave(name, category) {
            try {
                const info = await invoke("collections_create", { name, category });
                S.newCollectionDialog = null;
                await saveSelectedToCollection(info.id);
            } catch (e) {
                alert("No se pudo crear la colección: " + e);
            }
        }

        // ── Colecciones (gestión) ──
        async function loadCollections() {
            try { S.collections = await invoke("collections_list"); } catch (e) { S.collections = []; }
        }

        function sortedCategoryChips() {
            const counts = {};
            S.collections.forEach(c => { counts[c.category] = (counts[c.category] || 0) + 1; });
            return [...CATEGORIES].sort((a, b) => {
                const ca = counts[a[0]] || 0, cb = counts[b[0]] || 0;
                if (cb !== ca) return cb - ca;
                return a[1].localeCompare(b[1]);
            }).map(([slug, label]) => [slug, label, counts[slug] || 0]);
        }

        function visibleCollections() {
            const q = S.collectionsQuery.trim().toLowerCase();
            return S.collections.filter(c => {
                if (S.collectionsCategory && c.category !== S.collectionsCategory) return false;
                if (q && !c.name.toLowerCase().includes(q)) return false;
                return true;
            });
        }

        function attachLongPress(elm, onLongPress) {
            let timer = null, startX = 0, startY = 0, moved = false, fired = false;
            elm.addEventListener("pointerdown", (e) => {
                moved = false; fired = false; startX = e.clientX; startY = e.clientY;
                timer = setTimeout(() => { if (!moved) { fired = true; onLongPress(); } }, 480);
            });
            const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
            elm.addEventListener("pointermove", (e) => {
                if (Math.hypot(e.clientX - startX, e.clientY - startY) > 12) { moved = true; cancel(); }
            });
            elm.addEventListener("pointerup", cancel);
            elm.addEventListener("pointercancel", cancel);
            elm.addEventListener("click", (e) => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
        }

        async function openCollectionDetail(c) {
            S.activeCollection = c;
            S.activeImages = [];
            renderView();
            try { S.activeImages = await invoke("collections_list_images", { id: c.id }); } catch (e) { /* no-op */ }
            renderView();
        }

        async function deleteCollection(c) {
            S.collectionMenu = null;
            if (!confirm(`¿Borrar la colección "${c.name}"? Se borran también todas sus imágenes guardadas.`)) return;
            try { await invoke("collections_delete", { id: c.id }); } catch (e) { alert("Error: " + e); return; }
            await loadCollections();
            renderView();
        }

        async function submitRenameCollection(inputEl) {
            const c = S.renameDialog;
            const newName = inputEl.value.trim();
            S.renameDialog = null;
            if (!newName || newName === c.name) { renderView(); return; }
            try {
                await invoke("collections_rename", { id: c.id, newName });
                await loadCollections();
                if (S.activeCollection?.id === c.id) S.activeCollection = S.collections.find(x => x.id === c.id) || null;
            } catch (e) { alert("No se pudo renombrar: " + e); }
            renderView();
        }

        async function setCollectionCategory(c, category) {
            try {
                await invoke("collections_set_category", { id: c.id, category });
                await loadCollections();
                if (S.activeCollection?.id === c.id) S.activeCollection = S.collections.find(x => x.id === c.id) || null;
            } catch (e) { alert("Error: " + e); }
            renderView();
        }

        async function removeActiveImage(name) {
            if (!confirm(`¿Borrar "${name}"?`)) return;
            try {
                await invoke("collections_remove_image", { id: S.activeCollection.id, filename: name });
                S.activeImages = S.activeImages.filter(i => i.name !== name);
                await loadCollections();
            } catch (e) { alert("Error: " + e); }
            renderView();
        }

        // ══════════════════════════════════════════════════════════════
        //  RENDER — pestaña "Crear"
        // ══════════════════════════════════════════════════════════════
        function renderPick() {
            const pickRow = el("div", { className: "tx-pick-row" });
            const cameraBtn = el("button", { className: "primary tx-pick-btn", disabled: S.capturing });
            cameraBtn.innerHTML = `${window.AlejoIcons.glyph("camera", 18)}<span>${S.capturing ? "Abriendo cámara..." : "Tomar foto"}</span>`;
            cameraBtn.onclick = captureFromCamera;

            const galleryInp = el("input", { type: "file", accept: "image/*", className: "tx-hidden-input" });
            galleryInp.onchange = (e) => loadFile(e.target.files[0]);
            const galleryBtn = el("button", { className: "tx-pick-btn" });
            galleryBtn.innerHTML = `${window.AlejoIcons.glyph("image", 18)}<span>Elegir de galería</span>`;
            galleryBtn.onclick = () => galleryInp.click();

            pickRow.append(cameraBtn, galleryInp, galleryBtn);
            root.appendChild(pickRow);
            root.appendChild(el("p", { className: "tx-empty", textContent: "Sacale una foto de cerca y de frente a una superficie (piedra, madera, tela...) para generar su set de texturas. \"Tomar foto\" abre la cámara completa del sistema -- todos sus modos (macro, Pro, noche...) están disponibles." }));
        }

        function renderCrop() {
            // NUEVO (bug real, encontrado en vivo -- ver nota grande más
            // abajo): los botones de acción van ARRIBA de la foto, no
            // debajo. En este WebView, cualquier botón ubicado DESPUÉS del
            // recuadro de recorte en el documento dejaba de recibir
            // toques -- se veía perfectamente pero no respondía a nada
            // (confirmado con media hora de pruebas: no era el
            // box-shadow, no era touch-action, no era un salto de layout
            // por la imagen sin decodificar, el propio contenedor medía
            // exactamente lo que se veía). Un botón en la MISMA posición
            // pero ANTES del recuadro sí respondía siempre. En vez de
            // seguir cazando la causa exacta, se evita el problema entero:
            // los botones van antes, y de paso queda un layout más común
            // para pantallas de recorte (barra de acciones arriba, imagen
            // abajo).
            const actions = el("div", { className: "tx-crop-actions" });
            const applyBtn = el("button", { className: "primary", textContent: "Recortar y continuar" });
            applyBtn.onclick = () => applyCrop(false);
            const fullBtn = el("button", { textContent: "Usar foto completa" });
            fullBtn.onclick = () => applyCrop(true);
            const cancelBtn = el("button", { textContent: "Cancelar" });
            cancelBtn.onclick = cancelCrop;
            actions.append(applyBtn, fullBtn, cancelBtn);
            root.appendChild(actions);

            root.appendChild(el("p", { className: "tx-hint", textContent: "Arrastrá las esquinas para ajustar qué parte de la foto usar, o tocá y arrastrá el recuadro para moverlo." }));

            const wrap = el("div", { className: "tx-crop-wrap" });
            const container = el("div", { className: "tx-crop-container" });
            // Reusa el MISMO HTMLImageElement que ya terminó de cargar en
            // loadImageFromUrl() en vez de crear un <img> nuevo con el
            // mismo src (que aunque salga del cache decodifica de forma
            // asíncrona igual) -- evita un salto de layout innecesario.
            const img = S.pendingImage.img;
            img.className = "tx-crop-img";
            container.appendChild(img);

            const maskTop = el("div", { className: "tx-crop-mask tx-crop-mask--top" });
            const maskBottom = el("div", { className: "tx-crop-mask tx-crop-mask--bottom" });
            const maskLeft = el("div", { className: "tx-crop-mask tx-crop-mask--left" });
            const maskRight = el("div", { className: "tx-crop-mask tx-crop-mask--right" });
            container.append(maskTop, maskBottom, maskLeft, maskRight);

            const box = el("div", { className: "tx-crop-box" });
            ["tl", "tr", "bl", "br"].forEach(corner => {
                box.appendChild(el("div", { className: `tx-crop-handle tx-crop-handle--${corner}` }));
            });
            container.appendChild(box);
            wrap.appendChild(container);
            root.appendChild(wrap);

            attachCropHandles(container, box, { maskTop, maskBottom, maskLeft, maskRight });
        }

        function renderResultCard([key, canvasKey, filename, title]) {
            const canvas = S[canvasKey];
            const checked = S.selected[key];
            const card = el("div", { className: `tx-card${checked ? " tx-card--selected" : ""}` });
            card.onclick = () => toggleSelect(key);
            const checkBadge = el("div", { className: "tx-card-check" });
            checkBadge.innerHTML = checked ? window.AlejoIcons.glyph("check", 14) : "";
            card.appendChild(checkBadge);
            card.appendChild(el("div", { className: "tx-card-title", textContent: title }));
            const wrap = el("div", { className: "tx-canvas-wrap" });
            canvas.className = "tx-canvas";
            wrap.appendChild(canvas);
            card.appendChild(wrap);
            return card;
        }

        function renderSaveSheet() {
            const overlay = el("div", { className: "tx-overlay" });
            overlay.onclick = (e) => { if (e.target === overlay) { S.saveSheetOpen = false; renderView(); } };
            const sheet = el("div", { className: "tx-sheet" });
            sheet.appendChild(el("div", { className: "tx-sheet-title", textContent: `Guardar ${selectedCount()} mapa(s) en...` }));

            if (!S.collections.length) {
                sheet.appendChild(el("p", { className: "tx-empty", textContent: "Todavía no tenés colecciones." }));
            }
            S.collections.forEach(c => {
                const row = el("button", { className: "tx-sheet-btn" });
                row.innerHTML = `<span>${c.name}</span><span class="tx-sheet-btn-sub">${CATEGORY_LABEL[c.category] || c.category} · ${c.imageCount}</span>`;
                row.onclick = () => saveSelectedToCollection(c.id);
                sheet.appendChild(row);
            });
            const newBtn = el("button", { className: "tx-sheet-btn tx-sheet-btn--accent", textContent: "+ Nueva colección" });
            newBtn.onclick = () => { S.saveSheetOpen = false; S.newCollectionDialog = { name: "", category: CATEGORIES[0][0] }; renderView(); };
            sheet.appendChild(newBtn);
            const cancelBtn = el("button", { className: "tx-sheet-btn tx-sheet-cancel", textContent: "Cancelar" });
            cancelBtn.onclick = () => { S.saveSheetOpen = false; renderView(); };
            sheet.appendChild(cancelBtn);

            overlay.appendChild(sheet);
            root.appendChild(overlay);
        }

        function renderNewCollectionDialog() {
            const overlay = el("div", { className: "tx-overlay" });
            const dialog = el("div", { className: "tx-dialog" });
            dialog.appendChild(el("div", { className: "tx-dialog-title", textContent: "Nueva colección" }));
            // NUEVO (bug real, encontrado en vivo): el nombre tiene que
            // sincronizarse a S.newCollectionDialog.name en cada tecla --
            // tocar un chip de categoría llama a renderView(), que reconstruye
            // este diálogo entero (incluido un <input> nuevo); sin este
            // oninput, ese input nuevo arranca vacío y se pierde lo ya
            // escrito.
            const nameInp = el("input", { type: "text", className: "tx-dialog-input", placeholder: "Nombre", value: S.newCollectionDialog.name });
            nameInp.oninput = (e) => { S.newCollectionDialog.name = e.target.value; };
            dialog.appendChild(nameInp);

            const catRow = el("div", { className: "tx-cat-row" });
            CATEGORIES.forEach(([slug, label]) => {
                const chip = el("button", { className: `tx-cat-chip${S.newCollectionDialog.category === slug ? " tx-cat-chip--active" : ""}`, textContent: label });
                chip.onclick = () => { S.newCollectionDialog.category = slug; renderView(); };
                catRow.appendChild(chip);
            });
            dialog.appendChild(catRow);

            const actions = el("div", { className: "tx-dialog-actions" });
            const createBtn = el("button", { className: "primary", textContent: "Crear y guardar" });
            createBtn.onclick = () => createCollectionAndSave(nameInp.value, S.newCollectionDialog.category);
            const cancelBtn = el("button", { textContent: "Cancelar" });
            cancelBtn.onclick = () => { S.newCollectionDialog = null; renderView(); };
            actions.append(createBtn, cancelBtn);
            dialog.appendChild(actions);

            overlay.appendChild(dialog);
            root.appendChild(overlay);
            setTimeout(() => nameInp.focus(), 0);
        }

        function renderResult() {
            const strengthRow = el("div", { className: "tx-slider-row" });
            const strengthLabel = el("label", { textContent: `Fuerza del relieve: ${S.strength.toFixed(1)}` });
            strengthRow.appendChild(strengthLabel);
            const slider = el("input", { type: "range", min: "0.5", max: "6", step: "0.1", value: String(S.strength) });
            slider.oninput = (e) => {
                // NUEVO: antes esto solo actualizaba el número y el mapa
                // normal recién se recalculaba en "change" (al soltar) --
                // el usuario pidió que se vea en vivo. computeNormalMap()
                // repinta el <canvas> ya montado en la tarjeta (ver el
                // comentario ahí) sin reconstruir el DOM, así que es seguro
                // llamarlo en cada evento de arrastre sin cortar el gesto
                // del slider ni perder el foco.
                S.strength = parseFloat(e.target.value);
                strengthLabel.textContent = `Fuerza del relieve: ${S.strength.toFixed(1)}`;
                computeNormalMap();
            };
            strengthRow.appendChild(slider);
            root.appendChild(strengthRow);

            const newPhotoBtn = el("button", { className: "tx-newphoto-btn", textContent: "Empezar de nuevo con otra foto" });
            newPhotoBtn.onclick = () => { S.view = "pick"; S.savedMsg = ""; renderView(); };
            root.appendChild(newPhotoBtn);

            if (S.savedMsg) {
                root.appendChild(el("p", { className: S.savedIsError ? "tx-saved-msg tx-saved-msg--error" : "tx-saved-msg", textContent: S.savedMsg }));
                if (S.savedIsError && S.savedMsg.includes("Acceso a todos los archivos")) {
                    const permBtn = el("button", { textContent: "Dar permiso" });
                    permBtn.onclick = async () => { try { await invoke("sync_request_storage_permission"); } catch (e) { /* best effort */ } };
                    root.appendChild(permBtn);
                }
            }

            const grid = el("div", { className: "tx-grid" });
            MAPS.forEach(m => grid.appendChild(renderResultCard(m)));
            root.appendChild(grid);

            root.appendChild(el("p", { className: "tx-hint", textContent: "Tocá un mapa para marcarlo/desmarcarlo -- Albedo siempre se guarda. Roughness y Oclusión son estimaciones a partir del contraste/relieve local, no mediciones reales." }));

            const saveBar = el("div", { className: "tx-save-bar" });
            const saveBtn = el("button", { className: "primary", textContent: `Guardar seleccionadas (${selectedCount()})`, disabled: S.busy || selectedCount() === 0 });
            saveBtn.onclick = () => { S.saveSheetOpen = true; renderView(); };
            saveBar.appendChild(saveBtn);
            root.appendChild(saveBar);
        }

        // ══════════════════════════════════════════════════════════════
        //  RENDER — pestaña "Colecciones"
        // ══════════════════════════════════════════════════════════════
        function renderCollectionRow(c) {
            const row = el("div", { className: "tx-coll-row" });
            row.onclick = () => openCollectionDetail(c);
            attachLongPress(row, () => { S.collectionMenu = c; renderView(); });
            row.innerHTML = `
                <div class="tx-coll-main">
                    <div class="tx-coll-name">${c.name}</div>
                    <div class="tx-coll-sub">${CATEGORY_LABEL[c.category] || c.category} · ${c.imageCount} imagen(es)</div>
                </div>`;
            const dots = el("button", { className: "tx-coll-dots", innerHTML: window.AlejoIcons.glyph("dots", 18) });
            dots.onclick = (e) => { e.stopPropagation(); S.collectionMenu = c; renderView(); };
            row.appendChild(dots);
            return row;
        }

        function renderCollectionsList() {
            const wrap = el("div", { className: "tx-coll-wrap" });

            const searchRow = el("div", { className: "tx-coll-search-row" });
            const searchInp = el("input", { type: "text", placeholder: "Buscar colección...", value: S.collectionsQuery, className: "tx-coll-search" });
            const resultsDiv = el("div", { className: "tx-coll-list" });

            function renderResults() {
                resultsDiv.innerHTML = "";
                const visible = visibleCollections();
                if (!visible.length) {
                    resultsDiv.appendChild(el("p", { className: "tx-empty", textContent: "Sin colecciones todavía." }));
                    return;
                }
                visible.forEach(c => resultsDiv.appendChild(renderCollectionRow(c)));
            }
            searchInp.oninput = (e) => { S.collectionsQuery = e.target.value; renderResults(); };
            searchRow.appendChild(searchInp);
            wrap.appendChild(searchRow);

            const chipRow = el("div", { className: "tx-cat-row" });
            const allChip = el("button", { className: `tx-cat-chip${S.collectionsCategory == null ? " tx-cat-chip--active" : ""}`, textContent: "Todas" });
            allChip.onclick = () => { S.collectionsCategory = null; renderView(); };
            chipRow.appendChild(allChip);
            sortedCategoryChips().filter(([, , count]) => count > 0 || S.collectionsCategory).forEach(([slug, label, count]) => {
                const chip = el("button", { className: `tx-cat-chip${S.collectionsCategory === slug ? " tx-cat-chip--active" : ""}`, textContent: `${label} (${count})` });
                chip.onclick = () => { S.collectionsCategory = slug; renderView(); };
                chipRow.appendChild(chip);
            });
            wrap.appendChild(chipRow);

            wrap.appendChild(resultsDiv);
            renderResults();
            root.appendChild(wrap);

            if (S.collectionMenu) {
                const c = S.collectionMenu;
                const overlay = el("div", { className: "tx-overlay" });
                overlay.onclick = (e) => { if (e.target === overlay) { S.collectionMenu = null; renderView(); } };
                const sheet = el("div", { className: "tx-sheet" });
                sheet.appendChild(el("div", { className: "tx-sheet-title", textContent: c.name }));
                const renameBtn = el("button", { className: "tx-sheet-btn", textContent: "Renombrar" });
                renameBtn.onclick = () => { S.collectionMenu = null; S.renameDialog = c; renderView(); };
                const deleteBtn = el("button", { className: "tx-sheet-btn tx-sheet-btn--danger", textContent: "Borrar" });
                deleteBtn.onclick = () => deleteCollection(c);
                const cancelBtn = el("button", { className: "tx-sheet-btn tx-sheet-cancel", textContent: "Cancelar" });
                cancelBtn.onclick = () => { S.collectionMenu = null; renderView(); };
                sheet.append(renameBtn, deleteBtn, cancelBtn);
                overlay.appendChild(sheet);
                root.appendChild(overlay);
            }

            if (S.renameDialog) {
                const c = S.renameDialog;
                const overlay = el("div", { className: "tx-overlay" });
                const dialog = el("div", { className: "tx-dialog" });
                dialog.appendChild(el("div", { className: "tx-dialog-title", textContent: "Renombrar colección" }));
                const inp = el("input", { type: "text", className: "tx-dialog-input", value: c.name });
                dialog.appendChild(inp);
                const actions = el("div", { className: "tx-dialog-actions" });
                const saveBtn = el("button", { className: "primary", textContent: "Guardar" });
                saveBtn.onclick = () => submitRenameCollection(inp);
                const cancelBtn = el("button", { textContent: "Cancelar" });
                cancelBtn.onclick = () => { S.renameDialog = null; renderView(); };
                actions.append(saveBtn, cancelBtn);
                dialog.appendChild(actions);
                overlay.appendChild(dialog);
                root.appendChild(overlay);
                setTimeout(() => { inp.focus(); inp.select(); }, 0);
            }
        }

        function renderCollectionDetail() {
            const c = S.activeCollection;
            const wrap = el("div", { className: "tx-coll-detail" });
            const backBtn = el("button", { className: "tx-back-btn", textContent: "← Colecciones" });
            backBtn.onclick = () => { S.activeCollection = null; renderView(); };
            wrap.appendChild(backBtn);

            wrap.appendChild(el("div", { className: "tx-coll-detail-title", textContent: c.name }));

            const catRow = el("div", { className: "tx-cat-row" });
            CATEGORIES.forEach(([slug, label]) => {
                const chip = el("button", { className: `tx-cat-chip${c.category === slug ? " tx-cat-chip--active" : ""}`, textContent: label });
                chip.onclick = () => setCollectionCategory(c, slug);
                catRow.appendChild(chip);
            });
            wrap.appendChild(catRow);

            if (!S.activeImages.length) {
                wrap.appendChild(el("p", { className: "tx-empty", textContent: "Sin imágenes guardadas todavía -- generá un set de texturas en \"Crear\" y guardalas acá." }));
            } else {
                const grid = el("div", { className: "tx-img-grid" });
                S.activeImages.forEach(img => {
                    const cell = el("div", { className: "tx-img-cell" });
                    cell.innerHTML = `<img class="tx-img-thumb" src="${assetUrl(img.path)}"><div class="tx-img-name">${img.name}</div>`;
                    const rmBtn = el("button", { className: "tx-img-remove", innerHTML: window.AlejoIcons.glyph("trash", 14) });
                    rmBtn.onclick = () => removeActiveImage(img.name);
                    cell.appendChild(rmBtn);
                    grid.appendChild(cell);
                });
                wrap.appendChild(grid);
            }
            root.appendChild(wrap);
        }

        // ══════════════════════════════════════════════════════════════
        //  DISPATCH
        // ══════════════════════════════════════════════════════════════
        function renderView() {
            root.innerHTML = "";

            const tabs = el("div", { className: "tx-tabs" });
            [["crear", "Crear"], ["colecciones", "Colecciones"]].forEach(([key, label]) => {
                const btn = el("button", { className: `tx-tab${S.tab === key ? " tx-tab--active" : ""}`, textContent: label });
                btn.onclick = () => { S.tab = key; S.activeCollection = null; renderView(); };
                tabs.appendChild(btn);
            });
            root.appendChild(tabs);

            if (S.tab === "crear") {
                if (S.view === "pick") renderPick();
                else if (S.view === "crop") renderCrop();
                else renderResult();
                if (S.saveSheetOpen) renderSaveSheet();
                if (S.newCollectionDialog) renderNewCollectionDialog();
            } else {
                if (S.activeCollection) renderCollectionDetail();
                else renderCollectionsList();
            }
        }

        renderView();
        loadCollections().then(() => { if (S.tab === "colecciones") renderView(); });

        // Recupera una foto que haya quedado pendiente de una captura de
        // cámara cortada a mitad por un reinicio de proceso (ver la nota
        // grande en captureFullCamera, main.js) -- se revisa una vez al
        // entrar a la herramienta, igual que Configuración lo hace con el
        // selector de carpeta.
        ctx.checkPendingCameraCapture().then(res => {
            if (res && res.path && res.key === "texturas" && S.view === "pick" && !S.pendingImage) {
                loadCapturedPhoto(res.path);
            }
        });
    },
    onOutput() {},
    onDone() {},
});
