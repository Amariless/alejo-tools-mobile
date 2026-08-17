// ui.js — Lector de Documentos (mobile): PDF + Libros (EPUB) fusionados.
//
// Antes eran 2 herramientas separadas (Lector de PDF / Lector de Libros,
// ver su historial) -- el usuario pidió fusionarlas en una sola con 2
// pestañas (mismo patrón que el escritorio usa para familias de
// herramientas relacionadas) y de paso rehacer el lector entero:
//   - Miniatura de la primera página (o la última leída) en la lista.
//   - Menú contextual por archivo (mantener presionado, o el botón "⋮"):
//     renombrar / borrar / propiedades.
//   - Lector a pantalla completa: la barra de arriba de la app se oculta
//     (ver ctx.setChromeHidden en main.js) y el lector muestra su propia
//     barra flotante que aparece/desaparece con un toque en el contenido.
//   - SIN botones de anterior/siguiente -- cambiar de página es scrollear
//     con el dedo, nada más. Para PDF hay 2 controles (íconos, ver
//     lector-icons.js -- bajados de internet a pedido del usuario):
//     orientación (vertical/horizontal) y modo (paginado/scroll continuo).
//   - Zoom por doble toque sobre la página (ver attachDoubleTapZoom).
//   - Carga de páginas "ventaneada": no se renderizan las 300 páginas de
//     un PDF de una -- solo la visible + un margen chico alrededor (ver
//     IntersectionObserver en openPdfReader), y las que quedan lejos se
//     liberan de nuevo a placeholder para no acumular memoria. Esto es la
//     parte de "la carga de página es lenta, optimizala" del pedido.
//
// La carpeta de cada pestaña se configura en Configuración (selector de
// carpeta nativo, ver Settings/ui.js) -- esta herramienta ya NO tiene su
// propio campo de texto para editarla, solo la muestra.
//
// Estado a nivel de módulo (no local a render()) -- mismo motivo que los
// lectores viejos: onLeave necesita poder cerrar la sesión abierta y
// devolver la app-bar aunque el usuario salga con la flecha de "volver".
let S = null;
// A diferencia del resto del estado (que vive en S y se reinicia cada vez
// que render() corre de nuevo), esto necesita sobrevivir esa reinicialización:
// checkDeepLink() puede correr y dejar acá una URI pendiente ANTES de que
// selectTool() dispare render() (que pisa S entero con un objeto nuevo) --
// si esto viviera en S, se perdería al toque en ese mismo pisado.
let pendingPdfUriFromDeepLink = null;

registerRenderer("lectordocs", {
    render(tool, area) {
        const root = el("div", { className: "ld-root" });
        area.appendChild(root);

        S = {
            tab: "pdf", // pdf | books
            pdf: { folder: "", files: [], loading: false, error: "", hasStorageAccess: null },
            books: { folder: "", files: [], loading: false, error: "", hasStorageAccess: null, fontSize: 18 },
            view: "list", // list | reader
            reader: null,
            menu: null,          // { format, file } -- hoja de acciones abierta
            renameDialog: null,  // { format, file }
            propsDialog: null,   // { format, file }
        };

        const thumbEls = {}; // path -> nodo .ld-item-thumb (para actualizar sin re-renderizar toda la lista)

        function fmtBytes(n) {
            if (!n && n !== 0) return "";
            const units = ["B", "KB", "MB", "GB"];
            let i = 0, v = n;
            while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
            return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
        }
        function fmtDate(ms) {
            if (!ms) return "";
            return new Date(ms).toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "numeric" });
        }

        // ── Gesto de "mantener presionado" (equivalente táctil de
        // click-derecho, pedido del usuario) -- el botón "⋮" de cada fila
        // hace lo mismo con un toque normal, así el menú siempre es
        // alcanzable aunque el usuario no descubra el long-press. ──
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
            // Si el long-press ya disparó el menú, el "click" que el
            // navegador dispara igual al soltar el dedo NO debe además
            // abrir el lector (row.onclick) -- se intercepta en fase de
            // captura, así corre antes sin importar el orden en que se
            // hayan registrado los handlers.
            elm.addEventListener("click", (e) => {
                if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; }
            }, true);
        }

        // ── Carga de datos por pestaña ──
        async function ensureStorageAccess(bucket) {
            try { bucket.hasStorageAccess = await invoke("sync_check_storage_permission"); }
            catch { bucket.hasStorageAccess = false; }
        }

        async function loadPdfList() {
            const b = S.pdf;
            b.loading = true; b.error = ""; renderView();
            try { const cfg = await invoke("pdf_get_config"); b.folder = cfg.folder; } catch (e) { /* keep previous */ }
            await ensureStorageAccess(b);
            if (b.hasStorageAccess) {
                try { b.files = await invoke("pdf_list_folder", { folder: b.folder }); }
                catch (e) { b.error = String(e); b.files = []; }
            }
            b.loading = false;
            renderView();
            if (S.tab === "pdf") loadThumbnailsSequentially("pdf", b.files);
        }

        async function loadBooksList() {
            const b = S.books;
            b.loading = true; b.error = ""; renderView();
            try { const cfg = await invoke("book_get_config"); b.folder = cfg.folder; b.fontSize = cfg.fontSize; } catch (e) { /* keep previous */ }
            await ensureStorageAccess(b);
            if (b.hasStorageAccess) {
                try { b.files = await invoke("book_list_folder", { folder: b.folder }); }
                catch (e) { b.error = String(e); b.files = []; }
            }
            b.loading = false;
            renderView();
            if (S.tab === "books") loadThumbnailsSequentially("books", b.files);
        }

        // Miniaturas: una por vez (no en paralelo -- evita saturar el
        // puente JNI de golpe con decenas de renders si la carpeta tiene
        // muchos archivos) y parcheadas directo en el DOM ya existente
        // (thumbEls[path]) en vez de volver a dibujar toda la lista por
        // cada una -- eso sí sería el tipo de re-render destructivo que ya
        // causó bugs de foco en otras herramientas (ver sliders). El
        // resultado queda cacheado en el propio objeto del archivo
        // (f._thumbHtml) -- volver a esta pestaña más tarde (o cambiar de
        // pestaña y volver) pinta la miniatura de una sin tener que volver
        // a pedirla.
        async function loadThumbnailsSequentially(format, files) {
            for (const f of files) {
                if (S.tab !== format || S.view !== "list") return; // el usuario ya se fue de acá
                if (f._thumbHtml) continue; // ya se cargó antes
                const target = thumbEls[f.path];
                if (!target) continue;
                try {
                    if (format === "pdf") {
                        const prog = await invoke("pdf_get_progress", { path: f.path }).catch(() => null);
                        const pageIndex = prog?.pageIndex || 0;
                        const png = await invoke("pdf_get_thumbnail", { path: f.path, pageIndex, maxWidth: 160 });
                        f._thumbHtml = `<img class="ld-item-thumb-img" src="data:image/png;base64,${png}">`;
                    } else {
                        const preview = await invoke("book_get_preview", { path: f.path });
                        const safe = (preview.snippet || "").replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
                        f._thumbHtml = `<div class="ld-item-thumb-text">${safe}</div>`;
                    }
                    if (S.tab === format && S.view === "list" && thumbEls[f.path]) thumbEls[f.path].innerHTML = f._thumbHtml;
                } catch (e) { /* sin miniatura, se queda con el ícono genérico -- no es grave */ }
            }
        }

        // ── Menú de archivo (renombrar / borrar / propiedades) ──
        function openFileMenu(format, file) { S.menu = { format, file }; renderView(); }
        function closeFileMenu() { S.menu = null; renderView(); }

        async function deleteFile(format, file) {
            closeFileMenu();
            if (!confirm(`¿Borrar "${file.name}"? Esta acción no se puede deshacer.`)) return;
            try {
                await invoke(format === "pdf" ? "pdf_delete_file" : "book_delete_file", { path: file.path });
            } catch (e) { alert("No se pudo borrar: " + e); return; }
            if (format === "pdf") await loadPdfList(); else await loadBooksList();
        }

        function openRenameDialog(format, file) { S.menu = null; S.renameDialog = { format, file }; renderView(); }
        async function submitRename(inputEl) {
            const { format, file } = S.renameDialog;
            const newName = inputEl.value.trim();
            S.renameDialog = null;
            if (!newName || newName === file.name) { renderView(); return; }
            try {
                await invoke(format === "pdf" ? "pdf_rename_file" : "book_rename_file", { path: file.path, newName });
            } catch (e) { alert("No se pudo renombrar: " + e); }
            if (format === "pdf") await loadPdfList(); else await loadBooksList();
        }

        function openPropsDialog(format, file) { S.menu = null; S.propsDialog = { format, file }; renderView(); }

        function renderSheetAndDialogs() {
            if (S.menu) {
                const { format, file } = S.menu;
                const overlay = el("div", { className: "ld-overlay" });
                overlay.onclick = (e) => { if (e.target === overlay) closeFileMenu(); };
                const sheet = el("div", { className: "ld-sheet" });
                sheet.appendChild(el("div", { className: "ld-sheet-title", textContent: file.name }));
                const renameBtn = el("button", { className: "ld-sheet-btn", textContent: "Renombrar" });
                renameBtn.onclick = () => openRenameDialog(format, file);
                const propsBtn = el("button", { className: "ld-sheet-btn", textContent: "Propiedades" });
                propsBtn.onclick = () => openPropsDialog(format, file);
                const deleteBtn = el("button", { className: "ld-sheet-btn ld-sheet-btn--danger", textContent: "Borrar" });
                deleteBtn.onclick = () => deleteFile(format, file);
                const cancelBtn = el("button", { className: "ld-sheet-btn ld-sheet-cancel", textContent: "Cancelar" });
                cancelBtn.onclick = closeFileMenu;
                sheet.append(renameBtn, propsBtn, deleteBtn, cancelBtn);
                overlay.appendChild(sheet);
                root.appendChild(overlay);
            }

            if (S.renameDialog) {
                const { file } = S.renameDialog;
                const overlay = el("div", { className: "ld-overlay" });
                const dialog = el("div", { className: "ld-dialog" });
                dialog.appendChild(el("div", { className: "ld-dialog-title", textContent: "Renombrar" }));
                const inp = el("input", { type: "text", className: "ld-dialog-input", value: file.name });
                dialog.appendChild(inp);
                const actions = el("div", { className: "ld-dialog-actions" });
                const saveBtn = el("button", { className: "primary", textContent: "Guardar" });
                saveBtn.onclick = () => submitRename(inp);
                const cancelBtn = el("button", { textContent: "Cancelar" });
                cancelBtn.onclick = () => { S.renameDialog = null; renderView(); };
                actions.append(saveBtn, cancelBtn);
                dialog.appendChild(actions);
                overlay.appendChild(dialog);
                root.appendChild(overlay);
                setTimeout(() => { inp.focus(); inp.select(); }, 0);
            }

            if (S.propsDialog) {
                const { file } = S.propsDialog;
                const overlay = el("div", { className: "ld-overlay" });
                overlay.onclick = (e) => { if (e.target === overlay) { S.propsDialog = null; renderView(); } };
                const dialog = el("div", { className: "ld-dialog" });
                dialog.appendChild(el("div", { className: "ld-dialog-title", textContent: "Propiedades" }));
                const rows = [
                    ["Nombre", file.name],
                    ["Tamaño", fmtBytes(file.sizeBytes)],
                    ["Modificado", fmtDate(file.modifiedAt)],
                    ["Ruta", file.path],
                ];
                rows.forEach(([label, value]) => {
                    const row = el("div", { className: "ld-props-row" });
                    row.innerHTML = `<div class="ld-props-label">${label}</div><div class="ld-props-value">${value || "—"}</div>`;
                    dialog.appendChild(row);
                });
                const closeBtn = el("button", { className: "primary", textContent: "Cerrar" });
                closeBtn.onclick = () => { S.propsDialog = null; renderView(); };
                dialog.appendChild(closeBtn);
                overlay.appendChild(dialog);
                root.appendChild(overlay);
            }
        }

        // ── Lista de archivos ──
        function renderFileRow(format, f) {
            const row = el("div", { className: "ld-item" });
            row.onclick = () => (format === "pdf" ? openPdfReader(f) : openBookReader(f));
            attachLongPress(row, () => openFileMenu(format, f));

            const thumb = el("div", { className: "ld-item-thumb" });
            thumb.innerHTML = f._thumbHtml || window.AlejoIcons.glyph("doc", 22);
            thumbEls[f.path] = thumb;

            const main = el("div", { className: "ld-item-main" });
            main.innerHTML = `<div class="ld-item-name">${f.name}</div><div class="ld-item-sub">${fmtBytes(f.sizeBytes)}${f.modifiedAt ? " · " + fmtDate(f.modifiedAt) : ""}</div>`;

            const dots = el("button", { className: "ld-item-dots", innerHTML: window.AlejoIcons.glyph("dots", 18) });
            dots.onclick = (e) => { e.stopPropagation(); openFileMenu(format, f); };

            row.append(thumb, main, dots);
            return row;
        }

        function renderList() {
            const tabs = el("div", { className: "ld-tabs" });
            [["pdf", "PDF"], ["books", "Libros"]].forEach(([key, label]) => {
                const btn = el("button", { className: `ld-tab${S.tab === key ? " ld-tab--active" : ""}`, textContent: label });
                btn.onclick = () => {
                    S.tab = key;
                    renderView();
                    loadThumbnailsSequentially(key, key === "pdf" ? S.pdf.files : S.books.files);
                };
                tabs.appendChild(btn);
            });
            root.appendChild(tabs);

            const b = S.tab === "pdf" ? S.pdf : S.books;
            root.appendChild(el("div", { className: "ld-folder-label", textContent: b.folder || "…" }));

            if (b.hasStorageAccess === false) {
                const permCard = el("div", { className: "ld-perm-card" });
                permCard.innerHTML = `
                    <div class="ld-status-title">Falta un permiso</div>
                    <div class="ld-status-sub">Para leer archivos guardados en el teléfono hace falta darle a Alejo Tools acceso a "Todos los archivos".</div>`;
                const btn = el("button", { className: "primary", textContent: "Dar permiso" });
                btn.onclick = async () => { try { await invoke("sync_request_storage_permission"); } catch (e) { alert("Error: " + e); } };
                root.append(permCard, btn);
                return;
            }

            if (b.loading) { root.appendChild(el("p", { className: "ld-empty", textContent: "Buscando archivos..." })); return; }
            if (b.error) { root.appendChild(el("p", { className: "ld-error", textContent: b.error })); return; }
            if (!b.files.length) {
                root.appendChild(el("p", { className: "ld-empty", textContent: S.tab === "pdf" ? "Sin archivos .pdf en esta carpeta." : "Sin archivos .epub en esta carpeta." }));
                return;
            }

            const list = el("div", { className: "ld-list" });
            b.files.forEach(f => list.appendChild(renderFileRow(S.tab, f)));
            root.appendChild(list);
        }

        // ── Toque simple = mostrar/ocultar la barra flotante -- se activa
        // en pointerup solo si el gesto completo fue un toque de verdad
        // (poco movimiento, poco tiempo): un scroll real ya dispara
        // "pointercancel" del lado del navegador apenas se reconoce como
        // gesto de scroll (touch-action lo permite), así que ni siquiera
        // llega a este handler -- el umbral de movimiento es solo defensa
        // extra para navegadores que no cancelen. Usado tal cual por el
        // lector de libros (sin gesto de zoom con el que competir). ──
        function toggleReaderChrome(scopeEl) {
            const bar = scopeEl.querySelector(".ld-reader-bar");
            if (!bar) return;
            const hidden = bar.classList.toggle("ld-reader-bar--hidden");
            if (S.reader) S.reader.chromeVisible = !hidden;
        }
        function attachTapToggleChrome(containerEl, getReaderBar) {
            let downX = 0, downY = 0, downT = 0;
            containerEl.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; downT = Date.now(); });
            containerEl.addEventListener("pointerup", (e) => {
                const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
                if (moved > 10 || Date.now() - downT > 300) return;
                if (e.target.closest(".ld-reader-bar")) return; // toques en la barra no la ocultan
                const bar = getReaderBar();
                if (bar) { const hidden = bar.classList.toggle("ld-reader-bar--hidden"); if (S.reader) S.reader.chromeVisible = !hidden; }
            });
        }

        // ── Gestos de una página de PDF: toque simple = mostrar/ocultar
        // la barra, doble toque = zoom. Los dos compiten por el mismo
        // "toque" así que van juntos acá (no como 2 listeners
        // independientes, que se pisarían -- un doble toque haría
        // parpadear la barra además de hacer zoom): el primer toque queda
        // "pendiente" un instante corto por si llega un segundo cerca; si
        // no llega, recién ahí se confirma como toque simple. El zoom en
        // sí es doblar el ancho de la imagen y dejar que el scroll nativo
        // del slot (overflow:auto) haga de "paneo" -- gratis, con inercia
        // incluida, sin rastrear arrastre a mano. Se engancha UNA sola vez
        // por slot (ver renderPdfReader) y no por cada carga/descarte de
        // imagen -- la imagen de adentro se busca recién al toque, así que
        // funciona sea cual sea la página que haya en ese momento. ──
        function attachPdfSlotGestures(slotEl, onSingleTap) {
            let downX = 0, downY = 0, downT = 0, pendingSingle = null;
            slotEl.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; downT = Date.now(); });
            slotEl.addEventListener("pointerup", (e) => {
                const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
                if (moved > 10 || Date.now() - downT > 300) return; // fue un scroll, no un toque
                if (pendingSingle) {
                    clearTimeout(pendingSingle);
                    pendingSingle = null;
                    const imgEl = slotEl.querySelector(".ld-pdf-slot-img");
                    if (imgEl) {
                        const zoomed = slotEl.classList.toggle("ld-pdf-slot--zoomed");
                        imgEl.classList.toggle("ld-pdf-slot-img--zoomed", zoomed);
                        if (!zoomed) { slotEl.scrollTop = 0; slotEl.scrollLeft = 0; }
                    }
                    return;
                }
                pendingSingle = setTimeout(() => { pendingSingle = null; onSingleTap(); }, 280);
            });
        }

        // ══════════════════════════════════════════════════════════════
        //  LECTOR DE PDF
        // ══════════════════════════════════════════════════════════════
        async function openPdfReader(file) {
            S.reader = {
                format: "pdf", file, sessionId: null, pageCount: 0,
                orientation: "vertical", mode: "continuous",
                currentPage: 0, pages: {}, slotEls: {}, observer: null,
                chromeVisible: true, saveTimer: null, guessAspect: 1.4,
            };
            try {
                const res = await invoke("pdf_open", { pathOrUri: file.path });
                S.reader.sessionId = res.sessionId;
                S.reader.pageCount = res.pageCount;
                S.reader.file = { ...file, name: res.displayName || file.name };
                let startPage = 0;
                if (!file.path.startsWith("content://")) {
                    try {
                        const prog = await invoke("pdf_get_progress", { path: file.path });
                        if (prog) startPage = Math.min(prog.pageIndex, res.pageCount - 1);
                    } catch (e) { /* sin progreso guardado */ }
                }
                S.reader.currentPage = startPage;
                S.view = "reader";
                ctx.setChromeHidden(true);
                ctx.pushBack(closeReader);
                renderView();
                requestAnimationFrame(() => scrollToPage(startPage));
            } catch (e) {
                alert(String(e));
                S.reader = null;
            }
        }

        function scrollToPage(index) {
            const container = root.querySelector(".ld-pdf-scroll");
            const slot = S.reader?.slotEls?.[index];
            if (!container || !slot) return;
            if (S.reader.orientation === "vertical") container.scrollTop = slot.offsetTop;
            else container.scrollLeft = slot.offsetLeft;
        }

        async function loadPdfPage(index) {
            const r = S.reader;
            if (!r || r.pages[index]?.status === "loading" || r.pages[index]?.status === "ready") return;
            r.pages[index] = { status: "loading" };
            const maxWidth = Math.min(1400, Math.round((window.innerWidth || 400) * (window.devicePixelRatio || 1)));
            try {
                const res = await invoke("pdf_render_page", { sessionId: r.sessionId, pageIndex: index, maxWidth });
                if (S.reader !== r) return; // el lector ya se cerró
                r.pages[index] = { status: "ready", url: `data:image/png;base64,${res.png}` };
                if (res.width && res.height) r.guessAspect = res.height / res.width;
                const slot = r.slotEls[index];
                if (slot) {
                    slot.innerHTML = "";
                    slot.appendChild(el("img", { className: "ld-pdf-slot-img", src: r.pages[index].url }));
                }
                evictFarPages(index);
            } catch (e) {
                r.pages[index] = { status: "error" };
            }
        }

        // Libera las páginas que quedaron lejos de la actual -- volver a
        // ponerlas en placeholder (se recargan solas si el usuario
        // scrollea de vuelta hasta ahí) en vez de acumular decenas de PNG
        // en memoria a la vez. Ventana chica a propósito: es la parte
        // central del pedido "la carga de página es lenta, optimizala".
        function evictFarPages(aroundIndex) {
            const r = S.reader;
            if (!r) return;
            const WINDOW = 4;
            Object.keys(r.pages).forEach(k => {
                const i = Number(k);
                if (r.pages[i]?.status === "ready" && Math.abs(i - aroundIndex) > WINDOW) {
                    r.pages[i] = { status: "idle" };
                    const slot = r.slotEls[i];
                    if (slot) slot.innerHTML = `<div class="ld-pdf-slot-placeholder"></div>`;
                }
            });
        }

        function schedulePdfProgressSave() {
            const r = S.reader;
            if (!r || r.saveTimer) return;
            r.saveTimer = setTimeout(() => {
                r.saveTimer = null;
                if (!r.file.path.startsWith("content://")) {
                    invoke("pdf_set_progress", { path: r.file.path, pageIndex: r.currentPage, scrollFraction: 0 }).catch(() => {});
                }
            }, 500);
        }

        function setupPdfObserver(container) {
            const r = S.reader;
            const vertical = r.orientation === "vertical";
            r.observer = new IntersectionObserver((entries) => {
                let best = null;
                entries.forEach(entry => {
                    const idx = Number(entry.target.dataset.page);
                    if (entry.isIntersecting) {
                        loadPdfPage(idx);
                        if (!best || entry.intersectionRatio > best.ratio) best = { idx, ratio: entry.intersectionRatio };
                    }
                });
                if (best) {
                    r.currentPage = best.idx;
                    schedulePdfProgressSave();
                    updatePdfPageLabel();
                }
            }, { root: container, rootMargin: vertical ? "150% 0px 150% 0px" : "0px 150% 0px 150%", threshold: [0, 0.25, 0.5, 0.75, 1] });
        }

        function updatePdfPageLabel() {
            const lbl2 = root.querySelector(".ld-reader-page-label");
            if (lbl2 && S.reader) lbl2.textContent = `${S.reader.currentPage + 1} / ${S.reader.pageCount}`;
        }

        function renderPdfToolbar() {
            const r = S.reader;
            const bar = el("div", { className: "ld-reader-bar" });
            const backBtn = el("button", { className: "ld-reader-back", innerHTML: window.AlejoIcons.glyph("chevronLeft", 22) });
            backBtn.onclick = () => history.back();
            const title = el("div", { className: "ld-reader-title", textContent: r.file.name });
            bar.append(backBtn, title, el("span", { className: "ld-reader-page-label", textContent: `${r.currentPage + 1} / ${r.pageCount}` }));

            const controls = el("div", { className: "ld-reader-controls" });
            const orientGroup = el("div", { className: "ld-reader-toggle-group" });
            [["vertical", "orientationVertical"], ["horizontal", "orientationHorizontal"]].forEach(([val, icon]) => {
                const b = el("button", { className: `ld-reader-toggle${r.orientation === val ? " ld-reader-toggle--active" : ""}`, innerHTML: window.LectorIcons.glyph(icon, 18) });
                b.onclick = () => { r.orientation = val; rebuildPdfReaderView(); };
                orientGroup.appendChild(b);
            });
            const modeGroup = el("div", { className: "ld-reader-toggle-group" });
            [["paginated", "modePaginated"], ["continuous", "modeContinuous"]].forEach(([val, icon]) => {
                const b = el("button", { className: `ld-reader-toggle${r.mode === val ? " ld-reader-toggle--active" : ""}`, innerHTML: window.LectorIcons.glyph(icon, 18) });
                b.onclick = () => { r.mode = val; rebuildPdfReaderView(); };
                modeGroup.appendChild(b);
            });
            controls.append(orientGroup, modeGroup);
            bar.appendChild(controls);
            return bar;
        }

        function rebuildPdfReaderView() {
            const keepPage = S.reader.currentPage;
            renderView();
            requestAnimationFrame(() => scrollToPage(keepPage));
        }

        function renderPdfReader() {
            const r = S.reader;
            const wrap = el("div", { className: "ld-reader" });
            wrap.appendChild(renderPdfToolbar());

            const scrollClasses = ["ld-pdf-scroll", r.orientation === "horizontal" ? "ld-pdf-scroll--horizontal" : "ld-pdf-scroll--vertical", r.mode === "paginated" ? "ld-pdf-scroll--paginated" : "ld-pdf-scroll--continuous"];
            const container = el("div", { className: scrollClasses.join(" ") });
            r.slotEls = {};
            for (let i = 0; i < r.pageCount; i++) {
                const slot = el("div", { className: "ld-pdf-slot" });
                slot.dataset.page = String(i);
                const cached = r.pages[i];
                if (cached?.status === "ready") {
                    slot.appendChild(el("img", { className: "ld-pdf-slot-img", src: cached.url }));
                } else {
                    // Alto/ancho de arranque estimado con el aspect-ratio de
                    // la última página que sí se cargó -- evita un salto de
                    // layout grande mientras la miniatura real llega.
                    slot.style.aspectRatio = `1 / ${r.guessAspect}`;
                    slot.innerHTML = `<div class="ld-pdf-slot-placeholder"></div>`;
                }
                attachPdfSlotGestures(slot, () => toggleReaderChrome(wrap));
                r.slotEls[i] = slot;
                container.appendChild(slot);
            }
            wrap.appendChild(container);
            root.appendChild(wrap);

            setupPdfObserver(container);
            Object.values(r.slotEls).forEach(slot => r.observer.observe(slot));
            loadPdfPage(r.currentPage);
        }

        // ══════════════════════════════════════════════════════════════
        //  LECTOR DE LIBROS (EPUB) -- scroll continuo: los capítulos se
        //  van agregando al mismo contenedor a medida que el usuario se
        //  acerca al final del actual (estilo "scroll infinito"), en vez
        //  de que "pasar de capítulo" sea un botón -- mismo espíritu que
        //  el pedido de "sin botones de anterior/siguiente" del PDF.
        // ══════════════════════════════════════════════════════════════
        async function openBookReader(file) {
            S.reader = {
                format: "book", file, sessionId: null, title: "", chapterCount: 0,
                chapterIndex: 0, chapterTitles: {}, appendedUpTo: -1, loadingNext: false,
                fontSize: S.books.fontSize, chromeVisible: true, showToc: false,
                saveTimer: null, observer: null, sectionEls: {},
            };
            try {
                const res = await invoke("book_open", { path: file.path });
                S.reader.sessionId = res.sessionId;
                S.reader.title = res.title;
                S.reader.chapterCount = res.chapterCount;
                let startChapter = 0;
                try {
                    const prog = await invoke("book_get_progress", { path: file.path });
                    if (prog) startChapter = Math.min(prog.chapterIndex, res.chapterCount - 1);
                } catch (e) { /* sin progreso guardado */ }
                S.reader.chapterIndex = startChapter;
                S.view = "reader";
                ctx.setChromeHidden(true);
                ctx.pushBack(closeReader);
                renderView();
                await appendChapter(startChapter, true);
            } catch (e) {
                alert("No se pudo abrir el libro: " + e);
                S.reader = null;
            }
        }

        async function appendChapter(index, isFirst) {
            const r = S.reader;
            if (!r || index >= r.chapterCount || r.appendedUpTo >= index) return;
            r.loadingNext = true;
            try {
                const res = await invoke("book_get_chapter", { sessionId: r.sessionId, chapterIndex: index });
                if (S.reader !== r) return;
                if (res.title) r.chapterTitles[index] = res.title;
                const contentEl = root.querySelector(".ld-book-content");
                if (contentEl) {
                    const section = el("section", { className: "ld-book-chapter" });
                    section.dataset.chapter = String(index);
                    section.innerHTML = res.html;
                    contentEl.appendChild(section);
                    r.sectionEls[index] = section;
                    if (r.observer) r.observer.observe(section);
                }
                r.appendedUpTo = index;
            } catch (e) { /* si falla, simplemente no se agrega más -- el usuario sigue leyendo lo ya cargado */ }
            r.loadingNext = false;
        }

        function scheduleBookProgressSave() {
            const r = S.reader;
            if (!r || r.saveTimer) return;
            r.saveTimer = setTimeout(() => {
                r.saveTimer = null;
                invoke("book_set_progress", { path: r.file.path, chapterIndex: r.chapterIndex, scrollFraction: 0 }).catch(() => {});
            }, 500);
        }

        function setupBookObserver(scrollEl) {
            const r = S.reader;
            r.observer = new IntersectionObserver((entries) => {
                let best = null;
                entries.forEach(entry => {
                    const idx = Number(entry.target.dataset.chapter);
                    if (entry.isIntersecting && (!best || entry.intersectionRatio > best.ratio)) best = { idx, ratio: entry.intersectionRatio };
                });
                if (best) { r.chapterIndex = best.idx; scheduleBookProgressSave(); }
            }, { root: scrollEl, threshold: [0.1, 0.5] });

            scrollEl.addEventListener("scroll", () => {
                const nearEnd = scrollEl.scrollTop + scrollEl.clientHeight > scrollEl.scrollHeight - 600;
                if (nearEnd && !r.loadingNext) appendChapter(r.appendedUpTo + 1, false);
            });
        }

        function jumpToChapter(index) {
            const r = S.reader;
            r.showToc = false;
            const contentEl = root.querySelector(".ld-book-content");
            if (contentEl) contentEl.innerHTML = "";
            r.sectionEls = {};
            r.appendedUpTo = -1;
            r.chapterIndex = index;
            renderView();
            appendChapter(index, true);
        }

        function renderBookToolbar() {
            const r = S.reader;
            const bar = el("div", { className: "ld-reader-bar" });
            const backBtn = el("button", { className: "ld-reader-back", innerHTML: window.AlejoIcons.glyph("chevronLeft", 22) });
            backBtn.onclick = () => history.back();
            const title = el("div", { className: "ld-reader-title", textContent: r.title });
            bar.append(backBtn, title);

            const controls = el("div", { className: "ld-reader-controls" });
            const smallerBtn = el("button", { className: "ld-reader-toggle", textContent: "A−" });
            smallerBtn.onclick = () => { r.fontSize = Math.max(12, r.fontSize - 2); saveBookFontSize(); applyBookFontSize(); };
            const biggerBtn = el("button", { className: "ld-reader-toggle", textContent: "A+" });
            biggerBtn.onclick = () => { r.fontSize = Math.min(32, r.fontSize + 2); saveBookFontSize(); applyBookFontSize(); };
            const tocBtn = el("button", { className: "ld-reader-toggle", innerHTML: window.LectorIcons.glyph("toc", 18) });
            tocBtn.onclick = () => { r.showToc = !r.showToc; renderView(); };
            controls.append(smallerBtn, biggerBtn, tocBtn);
            bar.appendChild(controls);
            return bar;
        }

        function applyBookFontSize() {
            const contentEl = root.querySelector(".ld-book-content");
            if (contentEl) contentEl.style.fontSize = `${S.reader.fontSize}px`;
        }
        async function saveBookFontSize() {
            S.books.fontSize = S.reader.fontSize;
            try { await invoke("book_set_config", { folder: S.books.folder, fontSize: S.reader.fontSize }); } catch (e) { /* best effort */ }
        }

        function renderBookToc() {
            const wrap = el("div", { className: "ld-book-toc-overlay" });
            for (let i = 0; i < S.reader.chapterCount; i++) {
                const label = S.reader.chapterTitles[i] || `Capítulo ${i + 1}`;
                const item = el("button", { className: `ld-book-toc-item${i === S.reader.chapterIndex ? " ld-book-toc-item--active" : ""}`, textContent: label });
                item.onclick = () => jumpToChapter(i);
                wrap.appendChild(item);
            }
            return wrap;
        }

        function renderBookReader() {
            const r = S.reader;
            const wrap = el("div", { className: "ld-reader" });
            wrap.appendChild(renderBookToolbar());

            if (r.showToc) { wrap.appendChild(renderBookToc()); root.appendChild(wrap); return; }

            const scrollEl = el("div", { className: "ld-book-scroll" });
            const contentEl = el("div", { className: "ld-book-content" });
            contentEl.style.fontSize = `${r.fontSize}px`;
            scrollEl.appendChild(contentEl);
            wrap.appendChild(scrollEl);
            root.appendChild(wrap);

            setupBookObserver(scrollEl);
            attachTapToggleChrome(scrollEl, () => wrap.querySelector(".ld-reader-bar"));

            // Los capítulos ya agregados antes de este render (ej. al
            // cambiar el tamaño de letra) se vuelven a poner -- appendChapter
            // solo agrega los que faltan, r.sectionEls guarda el HTML ya
            // resuelto para no tener que volver a pedirlo a Rust.
            const already = { ...r.sectionEls };
            r.sectionEls = {};
            Object.keys(already).sort((a, b) => a - b).forEach(k => {
                const section = already[k];
                contentEl.appendChild(section);
                r.sectionEls[k] = section;
                r.observer.observe(section);
            });
        }

        // ══════════════════════════════════════════════════════════════
        //  CIERRE DEL LECTOR (ambos formatos)
        // ══════════════════════════════════════════════════════════════
        async function closeReader() {
            const r = S.reader;
            if (r?.observer) r.observer.disconnect();
            if (r?.saveTimer) { clearTimeout(r.saveTimer); r.saveTimer = null; }
            if (r?.sessionId) {
                try { await invoke(r.format === "pdf" ? "pdf_close" : "book_close", { sessionId: r.sessionId }); } catch (e) { /* best effort */ }
            }
            S.reader = null;
            S.view = "list";
            ctx.setChromeHidden(false);
            renderView();
        }

        // ══════════════════════════════════════════════════════════════
        //  DISPATCH
        // ══════════════════════════════════════════════════════════════
        function renderView() {
            root.innerHTML = "";
            if (S.view === "reader" && S.reader) {
                if (S.reader.format === "pdf") renderPdfReader(); else renderBookReader();
            } else {
                renderList();
            }
            renderSheetAndDialogs();
        }

        (async () => {
            await Promise.all([loadPdfList(), loadBooksList()]);

            // "Abrir con..." desde otra app -- ver la nota grande de
            // checkDeepLink() más abajo. Si hay algo pendiente, se abre
            // directo en el lector de PDF (bypass de la lista), igual que
            // el Lector de PDF viejo.
            let pendingUri = pendingPdfUriFromDeepLink || "";
            pendingPdfUriFromDeepLink = null;
            if (!pendingUri) { try { pendingUri = await invoke("pdf_take_pending_uri"); } catch (e) { /* no-op */ } }
            if (pendingUri) {
                const name = decodeURIComponent(pendingUri.split("/").pop() || "PDF");
                S.tab = "pdf";
                await openPdfReader({ path: pendingUri, name });
            }
        })();
    },
    onOutput() {},
    onDone() {},
    onLeave() {
        if (S?.reader) {
            if (S.reader.observer) S.reader.observer.disconnect();
            if (S.reader.saveTimer) clearTimeout(S.reader.saveTimer);
            if (S.reader.sessionId) {
                invoke(S.reader.format === "pdf" ? "pdf_close" : "book_close", { sessionId: S.reader.sessionId }).catch(() => {});
            }
        }
        window._toolCtx.setChromeHidden(false);
    },
    // Igual mecanismo genérico que tenía Lector de PDF (ver checkDeepLinks()
    // en main.js) -- pdf_take_pending_uri() consume el valor (lo borra del
    // lado Kotlin), así que se guarda para que el propio render(), más
    // arriba, lo use en vez de volver a pedirlo (lo encontraría vacío).
    async checkDeepLink() {
        try {
            const pendingUri = await invoke("pdf_take_pending_uri");
            if (pendingUri) {
                pendingPdfUriFromDeepLink = pendingUri;
                return true;
            }
        } catch (e) { /* no-op -- no es Android */ }
        return false;
    },
});

