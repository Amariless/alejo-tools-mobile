// ui.js — Lector de Libros (mobile).
//
// El parseo del .epub (zip + XHTML) vive del lado Rust (ver epub.rs) --
// acá solo se pide la carpeta configurada, se lista, se abre un libro y se
// muestra capítulo por capítulo como HTML ya limpio (sin imágenes, sin
// script/style propios del epub).
//
// Progreso de lectura: se guarda LOCAL en este teléfono (capítulo +
// fracción de scroll dentro de él), no en la carpeta sincronizada -- ver
// la nota grande en epub.rs para el porqué. Quiere decir que si el mismo
// libro se lee también en otro teléfono con esta app, el progreso NO se
// comparte entre ellos todavía.
registerRenderer("lectorlibros", {
    render(tool, area) {
        const root = el("div", { className: "bk-root" });
        area.appendChild(root);

        const S = {
            view: "list", // list | reader
            folder: "",
            editingFolder: false,
            files: [],
            loading: false,
            error: "",
            hasStorageAccess: null,
            sessionId: null,
            bookPath: "",
            bookTitle: "",
            chapterCount: 0,
            chapterIndex: 0,
            chapterHtml: "",
            chapterTitles: {},
            chapterLoading: false,
            fontSize: 18,
            showToc: false,
            saveTimer: null,
        };

        function fmtBytes(n) {
            if (!n && n !== 0) return "";
            const units = ["B", "KB", "MB"];
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
            try { S.files = await invoke("book_list_folder", { folder: S.folder }); }
            catch (e) { S.error = String(e); S.files = []; }
            S.loading = false;
            renderView();
        }

        async function saveFolder(newFolder) {
            S.folder = newFolder.trim() || S.folder;
            S.editingFolder = false;
            try { await invoke("book_set_config", { folder: S.folder, fontSize: S.fontSize }); } catch (e) { /* best effort */ }
            loadFiles();
        }

        async function saveFontSize() {
            try { await invoke("book_set_config", { folder: S.folder, fontSize: S.fontSize }); } catch (e) { /* best effort */ }
        }

        function scheduleSaveProgress(contentEl) {
            if (S.saveTimer) clearTimeout(S.saveTimer);
            S.saveTimer = setTimeout(() => {
                const max = contentEl.scrollHeight - contentEl.clientHeight;
                const frac = max > 0 ? contentEl.scrollTop / max : 0;
                invoke("book_set_progress", { path: S.bookPath, chapterIndex: S.chapterIndex, scrollFraction: frac }).catch(() => {});
            }, 400);
        }

        async function loadChapter(index, restoreFraction) {
            S.chapterLoading = true; renderView();
            try {
                const res = await invoke("book_get_chapter", { sessionId: S.sessionId, chapterIndex: index });
                S.chapterHtml = res.html;
                if (res.title) S.chapterTitles[index] = res.title;
                S.chapterIndex = index;
            } catch (e) {
                S.error = String(e);
            }
            S.chapterLoading = false;
            renderView();
            const contentEl = root.querySelector(".bk-content");
            if (contentEl && restoreFraction != null && restoreFraction > 0) {
                requestAnimationFrame(() => {
                    const max = contentEl.scrollHeight - contentEl.clientHeight;
                    if (max > 0) contentEl.scrollTop = max * restoreFraction;
                });
            }
            invoke("book_set_progress", { path: S.bookPath, chapterIndex: index, scrollFraction: restoreFraction || 0 }).catch(() => {});
        }

        async function openBook(path) {
            S.error = "";
            try {
                const res = await invoke("book_open", { path });
                S.sessionId = res.sessionId;
                S.bookTitle = res.title;
                S.chapterCount = res.chapterCount;
                S.bookPath = path;
                S.chapterTitles = {};
                S.view = "reader";

                let startChapter = 0, startFraction = 0;
                try {
                    const prog = await invoke("book_get_progress", { path });
                    if (prog) { startChapter = Math.min(prog.chapterIndex, res.chapterCount - 1); startFraction = prog.scrollFraction; }
                } catch (e) { /* sin progreso guardado */ }

                await loadChapter(startChapter, startFraction);
            } catch (e) {
                S.error = String(e);
                renderView();
            }
        }

        async function closeReader() {
            if (S.sessionId) { try { await invoke("book_close", { sessionId: S.sessionId }); } catch (e) { /* best effort */ } }
            S.sessionId = null;
            S.chapterHtml = "";
            S.view = "list";
            renderView();
        }

        function goToChapter(delta) {
            const next = S.chapterIndex + delta;
            if (next < 0 || next >= S.chapterCount) return;
            loadChapter(next, 0);
        }

        function renderList() {
            const folderRow = el("div", { className: "bk-folder-row" });
            if (S.editingFolder) {
                const inp = el("input", { type: "text", value: S.folder, className: "bk-folder-inp" });
                const saveBtn = el("button", { textContent: "Guardar" });
                saveBtn.onclick = () => saveFolder(inp.value);
                folderRow.append(inp, saveBtn);
            } else {
                const label = el("span", { className: "bk-folder-label", textContent: `📁 ${S.folder}` });
                const editBtn = el("button", { className: "bk-folder-edit", textContent: "Cambiar" });
                editBtn.onclick = () => { S.editingFolder = true; renderView(); };
                folderRow.append(label, editBtn);
            }
            root.appendChild(folderRow);

            if (S.hasStorageAccess === false) {
                const permCard = el("div", { className: "bk-card sm-perm" });
                permCard.innerHTML = `
                    <div>
                        <div class="sm-status-title">Falta un permiso</div>
                        <div class="sm-status-sub">Para leer libros guardados en el teléfono hace falta darle a Alejo Tools acceso a "Todos los archivos".</div>
                    </div>`;
                const btn = el("button", { className: "primary", textContent: "Dar permiso" });
                btn.onclick = async () => {
                    try { await invoke("sync_request_storage_permission"); } catch (e) { alert("Error: " + e); }
                };
                root.append(permCard, btn);
                return;
            }

            if (S.loading) { root.appendChild(el("p", { className: "bk-empty", textContent: "Buscando libros..." })); return; }
            if (S.error) { root.appendChild(el("p", { className: "bk-error", textContent: S.error })); return; }
            if (!S.files.length) { root.appendChild(el("p", { className: "bk-empty", textContent: "Sin archivos .epub en esta carpeta." })); return; }

            const list = el("div", { className: "bk-list" });
            S.files.forEach(f => {
                const row = el("div", { className: "bk-item" });
                row.onclick = () => openBook(f.path);
                row.innerHTML = `
                    <div class="bk-item-icon">📖</div>
                    <div class="bk-item-main">
                        <div class="bk-item-name"></div>
                        <div class="bk-item-size"></div>
                    </div>`;
                row.querySelector(".bk-item-name").textContent = f.name;
                row.querySelector(".bk-item-size").textContent = fmtBytes(f.sizeBytes);
                list.appendChild(row);
            });
            root.appendChild(list);
        }

        function renderToc() {
            const wrap = el("div", { className: "bk-toc" });
            for (let i = 0; i < S.chapterCount; i++) {
                const label = S.chapterTitles[i] || `Capítulo ${i + 1}`;
                const item = el("button", { className: i === S.chapterIndex ? "bk-toc-item active" : "bk-toc-item", textContent: label });
                item.onclick = () => { S.showToc = false; loadChapter(i, 0); };
                wrap.appendChild(item);
            }
            return wrap;
        }

        function renderReader() {
            const bar = el("div", { className: "bk-reader-bar" });
            const closeBtn = el("button", { textContent: "← Lista" });
            closeBtn.onclick = closeReader;
            const title = el("span", { className: "bk-reader-title", textContent: S.bookTitle });
            const tocBtn = el("button", { textContent: "Índice" });
            tocBtn.onclick = () => { S.showToc = !S.showToc; renderView(); };
            bar.append(closeBtn, title, tocBtn);
            root.appendChild(bar);

            const fontRow = el("div", { className: "bk-font-row" });
            const smallerBtn = el("button", { textContent: "A−" });
            smallerBtn.onclick = () => { S.fontSize = Math.max(12, S.fontSize - 2); saveFontSize(); renderView(); };
            const biggerBtn = el("button", { textContent: "A+" });
            biggerBtn.onclick = () => { S.fontSize = Math.min(32, S.fontSize + 2); saveFontSize(); renderView(); };
            fontRow.append(smallerBtn, el("span", { className: "bk-font-label", textContent: `${S.fontSize}px` }), biggerBtn);
            root.appendChild(fontRow);

            if (S.error) root.appendChild(el("p", { className: "bk-error", textContent: S.error }));

            if (S.showToc) {
                root.appendChild(renderToc());
                return;
            }

            const contentEl = el("div", { className: "bk-content" });
            contentEl.style.fontSize = `${S.fontSize}px`;
            if (S.chapterLoading) {
                contentEl.appendChild(el("p", { className: "bk-empty", textContent: "Cargando capítulo..." }));
            } else {
                // NUEVO: innerHTML directo del XHTML ya limpiado del lado
                // Rust (sin script/style/img/svg) -- no es un sanitizado a
                // prueba de balas (un atributo tipo onclick="..." suelto en
                // una etiqueta que sobrevivió igual ejecutaría JS), pero el
                // origen es un archivo .epub que el usuario mismo eligió en
                // su propio teléfono, no contenido remoto/de terceros, así
                // que ese riesgo residual es aceptable acá -- mismo criterio
                // que un lector de epub de escritorio (Calibre, etc.).
                contentEl.innerHTML = S.chapterHtml;
            }
            contentEl.onscroll = () => scheduleSaveProgress(contentEl);
            root.appendChild(contentEl);

            const nav = el("div", { className: "bk-nav" });
            const prevBtn = el("button", { textContent: "‹ Anterior", disabled: S.chapterIndex <= 0 || S.chapterLoading });
            prevBtn.onclick = () => goToChapter(-1);
            const pageLabel = el("span", { className: "bk-page-label", textContent: `${S.chapterIndex + 1} / ${S.chapterCount}` });
            const nextBtn = el("button", { textContent: "Siguiente ›", disabled: S.chapterIndex >= S.chapterCount - 1 || S.chapterLoading });
            nextBtn.onclick = () => goToChapter(1);
            nav.append(prevBtn, pageLabel, nextBtn);
            root.appendChild(nav);
        }

        function renderView() {
            root.innerHTML = "";
            if (S.view === "list") renderList();
            else renderReader();
        }

        (async () => {
            const cfg = await invoke("book_get_config").catch(() => ({ folder: "/storage/emulated/0/Books", fontSize: 18 }));
            S.folder = cfg.folder;
            S.fontSize = cfg.fontSize;
            await loadFiles();
        })();
    },
    onOutput() {},
    onDone() {},
});
