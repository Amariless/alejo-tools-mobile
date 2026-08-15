// ui.js — Lector de PDF (mobile).
//
// El render de páginas usa android.graphics.pdf.PdfRenderer nativo del SDK
// (ver PdfBridge.kt) -- acá del lado JS solo se pide la carpeta configurada,
// se lista, se abre un PDF (o el que haya llegado por "Abrir con..." desde
// otra app, ver pdf_take_pending_uri/MainActivity.kt) y se muestra página
// por página como una imagen PNG.
//
// A propósito NO incluido en esta primera versión: scroll continuo entre
// páginas (una imagen por vez, con botones anterior/siguiente, es mucho
// más simple de implementar bien que un visor continuo con precarga),
// zoom/pinch (la página se ajusta al ancho de pantalla, sin más), y
// búsqueda de texto dentro del PDF (PdfRenderer no expone texto, solo
// renderiza a bitmap -- buscar texto real exigiría un parser de PDF
// aparte, mucho más trabajo para un caso de uso que no era el pedido
// principal).
//
// Estado de la sesión actual -- a nivel de módulo (no local a render())
// para que onLeave, más abajo, pueda cerrar la sesión de PdfRenderer
// abierta del lado Kotlin cuando el usuario sale de la herramienta con la
// flecha de "volver" de la barra superior (antes de este fix, ese camino
// no cerraba nada -- el recurso quedaba abierto indefinidamente hasta que
// la app cerraba el proceso; SÍ se seguía cerrando la sesión anterior al
// abrir un PDF nuevo, pero eso no cubría "salir sin abrir otro PDF").
let S = null;

registerRenderer("lectorpdf", {
    render(tool, area) {
        const root = el("div", { className: "pdf-root" });
        area.appendChild(root);

        S = {
            view: "list", // list | reader
            folder: "",
            editingFolder: false,
            files: [],
            loading: false,
            error: "",
            hasStorageAccess: null,
            sessionId: null,
            pageCount: 0,
            pageIndex: 0,
            pageImgUrl: null,
            pageLoading: false,
            currentName: "",
        };

        function fmtBytes(n) {
            if (!n && n !== 0) return "";
            const units = ["B", "KB", "MB", "GB"];
            let i = 0, v = n;
            while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
            return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
        }

        async function ensureStorageAccess() {
            try { S.hasStorageAccess = await invoke("sync_check_storage_permission"); }
            catch { S.hasStorageAccess = false; }
        }

        async function loadFiles() {
            S.loading = true; S.error = ""; renderView();
            await ensureStorageAccess();
            if (!S.hasStorageAccess) { S.loading = false; renderView(); return; }
            try { S.files = await invoke("pdf_list_folder", { folder: S.folder }); }
            catch (e) { S.error = String(e); S.files = []; }
            S.loading = false;
            renderView();
        }

        async function saveFolder(newFolder) {
            S.folder = newFolder.trim() || S.folder;
            S.editingFolder = false;
            try { await invoke("pdf_set_config", { folder: S.folder }); } catch (e) { /* best effort */ }
            loadFiles();
        }

        async function renderPageImage() {
            S.pageLoading = true; renderView();
            const maxWidth = Math.min(1400, Math.round((window.innerWidth || 400) * (window.devicePixelRatio || 1)));
            try {
                const res = await invoke("pdf_render_page", { sessionId: S.sessionId, pageIndex: S.pageIndex, maxWidth });
                S.pageImgUrl = `data:image/png;base64,${res.png}`;
            } catch (e) {
                S.error = String(e);
            }
            S.pageLoading = false;
            renderView();
        }

        async function openPdf(pathOrUri, name) {
            S.error = "";
            if (S.sessionId) {
                try { await invoke("pdf_close", { sessionId: S.sessionId }); } catch (e) { /* best effort */ }
                S.sessionId = null;
            }
            try {
                const res = await invoke("pdf_open", { pathOrUri });
                S.sessionId = res.sessionId;
                S.pageCount = res.pageCount;
                S.pageIndex = 0;
                // NUEVO (revisión de código): para URIs content:// (el caso
                // normal de "Abrir con...") PdfBridge.kt ahora devuelve el
                // nombre real vía displayName -- el `name` recibido acá
                // como parámetro (derivado del último segmento de la URI)
                // solía ser un id opaco del proveedor, no el nombre real.
                S.currentName = res.displayName || name;
                S.view = "reader";
                renderView();
                await renderPageImage();
            } catch (e) {
                S.error = String(e);
                renderView();
            }
        }

        async function closeReader() {
            if (S.sessionId) {
                try { await invoke("pdf_close", { sessionId: S.sessionId }); } catch (e) { /* best effort */ }
            }
            S.sessionId = null;
            S.pageImgUrl = null;
            S.view = "list";
            renderView();
        }

        function goToPage(delta) {
            const next = S.pageIndex + delta;
            if (next < 0 || next >= S.pageCount) return;
            S.pageIndex = next;
            renderPageImage();
        }

        function renderList() {
            const folderRow = el("div", { className: "pdf-folder-row" });
            if (S.editingFolder) {
                const inp = el("input", { type: "text", value: S.folder, className: "pdf-folder-inp" });
                const saveBtn = el("button", { textContent: "Guardar" });
                saveBtn.onclick = () => saveFolder(inp.value);
                folderRow.append(inp, saveBtn);
            } else {
                const label = el("span", { className: "pdf-folder-label", textContent: `📁 ${S.folder}` });
                const editBtn = el("button", { className: "pdf-folder-edit", textContent: "Cambiar" });
                editBtn.onclick = () => { S.editingFolder = true; renderView(); };
                folderRow.append(label, editBtn);
            }
            root.appendChild(folderRow);

            if (S.hasStorageAccess === false) {
                const permCard = el("div", { className: "pdf-card" });
                permCard.innerHTML = `
                    <div>
                        <div class="pdf-status-title">Falta un permiso</div>
                        <div class="pdf-status-sub">Para leer PDFs guardados en el teléfono hace falta darle a Alejo Tools acceso a "Todos los archivos".</div>
                    </div>`;
                const btn = el("button", { className: "primary", textContent: "Dar permiso" });
                btn.onclick = async () => {
                    try { await invoke("sync_request_storage_permission"); } catch (e) { alert("Error: " + e); }
                };
                root.append(permCard, btn);
                return;
            }

            if (S.loading) { root.appendChild(el("p", { className: "pdf-empty", textContent: "Buscando PDFs..." })); return; }
            if (S.error) { root.appendChild(el("p", { className: "pdf-error", textContent: S.error })); return; }
            if (!S.files.length) { root.appendChild(el("p", { className: "pdf-empty", textContent: "Sin archivos .pdf en esta carpeta." })); return; }

            const list = el("div", { className: "pdf-list" });
            S.files.forEach(f => {
                const row = el("div", { className: "pdf-item" });
                row.onclick = () => openPdf(f.path, f.name);
                row.innerHTML = `
                    <div class="pdf-item-icon">📄</div>
                    <div class="pdf-item-main">
                        <div class="pdf-item-name"></div>
                        <div class="pdf-item-size"></div>
                    </div>`;
                row.querySelector(".pdf-item-name").textContent = f.name;
                row.querySelector(".pdf-item-size").textContent = fmtBytes(f.sizeBytes);
                list.appendChild(row);
            });
            root.appendChild(list);
        }

        function renderReader() {
            const bar = el("div", { className: "pdf-reader-bar" });
            const closeBtn = el("button", { textContent: "← Lista" });
            closeBtn.onclick = closeReader;
            bar.append(closeBtn, el("span", { className: "pdf-reader-name", textContent: S.currentName }));
            root.appendChild(bar);

            if (S.error) root.appendChild(el("p", { className: "pdf-error", textContent: S.error }));

            const pageWrap = el("div", { className: "pdf-page-wrap" });
            if (S.pageLoading || !S.pageImgUrl) {
                pageWrap.appendChild(el("p", { className: "pdf-empty", textContent: "Cargando página..." }));
            } else {
                pageWrap.appendChild(el("img", { className: "pdf-page-img", src: S.pageImgUrl }));
            }
            root.appendChild(pageWrap);

            const nav = el("div", { className: "pdf-nav" });
            const prevBtn = el("button", { textContent: "‹ Anterior", disabled: S.pageIndex <= 0 || S.pageLoading });
            prevBtn.onclick = () => goToPage(-1);
            const pageLabel = el("span", { className: "pdf-page-label", textContent: `${S.pageIndex + 1} / ${S.pageCount}` });
            const nextBtn = el("button", { textContent: "Siguiente ›", disabled: S.pageIndex >= S.pageCount - 1 || S.pageLoading });
            nextBtn.onclick = () => goToPage(1);
            nav.append(prevBtn, pageLabel, nextBtn);
            root.appendChild(nav);
        }

        function renderView() {
            root.innerHTML = "";
            if (S.view === "list") renderList();
            else renderReader();
        }

        (async () => {
            const cfg = await invoke("pdf_get_config").catch(() => ({ folder: "/storage/emulated/0/Download" }));
            S.folder = cfg.folder;

            // Si la app se abrió (o se retomó) desde "Abrir con..." de otra
            // app, hay un PDF pendiente -- se abre directo, sin pasar por la
            // lista de esta carpeta. checkDeepLink(), más abajo, ya lo
            // consumió una vez (pdf_take_pending_uri() borra el valor del
            // lado Kotlin al leerlo, así que solo se puede leer una vez) y
            // lo dejó en window._pendingPdfUri para que lo usemos acá; si
            // no hay nada ahí, se intenta el comando igual (cubre el caso
            // de entrar a esta herramienta a mano sin pasar por ese flujo).
            let pendingUri = window._pendingPdfUri || "";
            window._pendingPdfUri = null;
            if (!pendingUri) {
                try { pendingUri = await invoke("pdf_take_pending_uri"); } catch (e) { /* no-op */ }
            }
            if (pendingUri) {
                const name = decodeURIComponent(pendingUri.split("/").pop() || "PDF");
                await openPdf(pendingUri, name);
                return;
            }

            await loadFiles();
        })();
    },
    onOutput() {},
    onDone() {},
    onLeave() {
        if (S?.sessionId) {
            invoke("pdf_close", { sessionId: S.sessionId }).catch(() => {});
            S.sessionId = null;
        }
    },
    // NUEVO (revisión de código): antes esto vivía hardcodeado en
    // main.js (buscando la herramienta por id "lectorpdf" a mano); ahora
    // es el mecanismo genérico de deep-link (ver checkDeepLinks() en
    // main.js) -- esta herramienta simplemente declara que tiene algo
    // que revisar. pdf_take_pending_uri() consume el valor (lo borra
    // del lado Kotlin), así que se guarda en window._pendingPdfUri para
    // que el propio render(), más arriba, lo use en vez de volver a
    // pedirlo (encontraría el valor ya vacío).
    async checkDeepLink() {
        try {
            const pendingUri = await invoke("pdf_take_pending_uri");
            if (pendingUri) { window._pendingPdfUri = pendingUri; return true; }
        } catch (e) { /* no-op -- no es Android */ }
        return false;
    },
});
