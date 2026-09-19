// ui.js — Descargar Música (mobile).
//
// A propósito NO persistente (ver tool.json) -- a diferencia de SyncManager,
// acá no hay nada que mantener vivo de fondo entre pestañas: una descarga
// ya arrancada sigue corriendo del lado de Android aunque el usuario
// vuelva a la lista (ver downloader.rs/YtDlpBridge.kt, corre en su propio
// hilo), simplemente esta pantalla no se queda mostrando su progreso si el
// usuario se fue -- aceptable para esta primera versión: pegar un link,
// bajar una canción por vez. La pestaña "Descargas" sí vuelve a pedir la
// lista cada vez que se entra (dl_list_downloads es liviana, solo lee la
// carpeta) -- no hace falta que esta herramienta sea persistente por eso.
//
// NUEVO (pedido del usuario -- búsqueda por nombre + gestor de descargas):
// antes esta herramienta solo aceptaba pegar un link directo (dl_fetch_info)
// y no tenía forma de ver/reproducir/renombrar/borrar lo ya descargado. Se
// agregan 2 pestañas (mismo patrón de S.tab que Reloj/LectorDocs):
//   - "Buscar": por defecto busca por nombre/artista (dl_search, resuelve
//     yt-dlp con "ytsearchN:"/"scsearchN:" -- ver downloader.rs), con un
//     link para volver al modo "pegar URL" de siempre si el usuario ya
//     tiene el link exacto (útil sobre todo para Bandcamp, que no tiene
//     extractor de búsqueda en yt-dlp).
//   - "Descargas": lista los .mp3 ya guardados (dl_list_downloads), con el
//     mismo patrón de long-press/hoja de acciones que ya usa LectorDocs
//     para renombrar/borrar, más un reproductor <audio> inline al tocar
//     una fila (sin problema de "taint" de canvas acá -- es audio, no
//     píxeles -- así que convertFileSrc alcanza, igual que CreadorTexturas
//     lo usa para mostrar imágenes ya guardadas).
// NUEVO (compartir a la app, estilo Snaptube): igual patrón que
// pendingPdfUriFromDeepLink en LectorDocs -- checkDeepLink() corre ANTES
// de que render() monte S (que es local a initNormal(), no de módulo), así
// que el valor tiene que vivir acá afuera hasta que initNormal() lo
// consuma.
let pendingShareUrlFromDeepLink = null;

registerRenderer("descargarmusica", {
    render(tool, area) {
        const root = el("div", { className: "dl-root" });
        area.appendChild(root);

        // NUEVO (pedido del usuario -- no arrancar con una carpeta elegida
        // sin que el usuario lo haya decidido): dl_get_config ya no trae un
        // default hardcodeado (ver downloader.rs) -- si folder viene vacío,
        // se pide elegir carpeta ANTES de montar el flujo normal, en vez de
        // dejar descargar a un lugar que el usuario nunca eligió. Misma
        // key ("music") que ya usa Configuración, así que elegirla desde
        // cualquiera de los dos lados queda consistente en el otro.
        invoke("dl_get_config").then(cfg => {
            if (cfg.folder) initNormal(); else renderFolderGate();
        });

        function renderFolderGate() {
            root.innerHTML = "";
            const gate = el("div", { className: "dl-folder-gate" });
            gate.appendChild(el("p", { className: "dl-folder-gate-txt", textContent: "Elegí dónde guardar la música que descargues." }));
            const btn = el("button", { className: "primary", textContent: "Elegir carpeta" });
            btn.onclick = async () => {
                const path = await ctx.pickFolder("music");
                if (!path) return;
                await invoke("dl_set_config", { folder: path });
                initNormal();
            };
            gate.appendChild(btn);
            root.appendChild(gate);
        }

        function initNormal() {
        const S = {
            tab: "buscar", // buscar | descargas
            mode: "search", // search | link -- solo aplica dentro de "buscar"
            phase: "input", // input | loading | results | preview | downloading | done | error
            query: "",
            url: "",
            results: [],
            info: null,
            quality: "0", // "0" = mejor disponible
            progress: null,
            eta: null,
            error: "",
            savedPath: "",
            copiedPath: false,
            downloads: { loading: false, error: "", files: [] },
            playingPath: null,
            // NUEVO (pedido del usuario -- preview de un resultado de
            // búsqueda antes de descargarlo): url = trackUrl de la fila
            // seleccionada, path = archivo local ya bajado (dl_preview),
            // loading = true mientras se está generando. Un solo preview a
            // la vez -- togglePreview() la reemplaza por completo.
            preview: { url: null, path: null, loading: false },
            menu: null,         // { file } -- hoja de acciones abierta
            renameDialog: null, // { file }
        };

        // NUEVO (compartir a la app, estilo Snaptube): si checkDeepLink()
        // dejó una URL pendiente, arrancar directo en modo "link" con esa
        // URL ya pegada -- ver checkDeepLink más abajo y checkDeepLinks()
        // en main.js, que es quien llama a render() para esto.
        let deepLinkUrl = null;
        if (pendingShareUrlFromDeepLink) {
            deepLinkUrl = pendingShareUrlFromDeepLink;
            pendingShareUrlFromDeepLink = null;
            S.tab = "buscar";
            S.mode = "link";
            S.url = deepLinkUrl;
        }

        function fmtEta(secs) {
            if (secs == null || secs < 0) return "";
            const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
            return `${m}:${String(s).padStart(2, "0")}`;
        }
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

        // ── Gesto de "mantener presionado" -- mismo helper que LectorDocs
        // (attachLongPress), portado tal cual para el gestor de descargas. ──
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
            elm.addEventListener("click", (e) => {
                if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; }
            }, true);
        }

        // ══════════════════════════════════════════════════════════════
        //  BUSCAR / DESCARGAR
        // ══════════════════════════════════════════════════════════════
        async function searchTracks() {
            const query = S.query.trim();
            if (!query) return;
            S.phase = "loading";
            S.error = "";
            renderView();
            try {
                S.results = await invoke("dl_search", { query });
                S.phase = "results";
            } catch (e) {
                S.error = String(e);
                S.phase = "error";
            }
            renderView();
        }

        async function fetchInfo() {
            const url = S.url.trim();
            if (!url) return;
            S.phase = "loading";
            S.error = "";
            renderView();
            try {
                S.info = await invoke("dl_fetch_info", { url });
                S.phase = "preview";
            } catch (e) {
                S.error = String(e);
                S.phase = "error";
            }
            renderView();
        }

        function pickResult(track) {
            S.info = { ...track };
            S.phase = "preview";
            renderView();
        }

        async function startDownload() {
            S.phase = "downloading";
            S.progress = 0;
            S.eta = null;
            S.error = "";
            renderView();

            let unlisten = null;
            try {
                unlisten = await window.__TAURI__.event.listen("dl-progress", (e) => {
                    // NUEVO (auditoría -- hallazgo MENOR): si el usuario
                    // navegó fuera de esta herramienta (no persistente)
                    // antes de que termine la descarga, este listener sigue
                    // vivo hasta el "finally" de más abajo -- sin este
                    // chequeo, cada evento de progreso seguía disparando un
                    // render() completo sobre un árbol que nadie ve.
                    if (ctx.activeTool?.id !== tool.id) return;
                    const { progress, eta } = e.payload || {};
                    if (progress != null) S.progress = progress;
                    S.eta = eta;
                    renderView();
                });
                S.savedPath = await invoke("dl_download", {
                    url: S.info.trackUrl,
                    title: S.info.title,
                    artist: S.info.artist,
                    quality: S.quality,
                });
                S.phase = "done";
            } catch (e) {
                S.error = String(e);
                S.phase = "error";
            } finally {
                if (unlisten) unlisten();
            }
            renderView();
        }

        // NUEVO (auditoría -- hallazgo MEDIO): no había forma de copiar la
        // ruta guardada (mismo patrón "copiar" que ya usa Paleta de Colores)
        // -- body tiene user-select:none global, así que tampoco se podía
        // seleccionar el texto a mano.
        async function copySavedPath() {
            try { await navigator.clipboard.writeText(S.savedPath); } catch (e) { /* sin clipboard, no es grave */ }
            S.copiedPath = true;
            renderView();
            setTimeout(() => { if (S.copiedPath) { S.copiedPath = false; renderView(); } }, 1200);
        }

        function resetToInput() {
            S.phase = "input";
            S.info = null;
            S.error = "";
            S.progress = null;
            S.savedPath = "";
            renderView();
        }

        function backToResults() {
            S.phase = S.results.length ? "results" : "input";
            S.info = null;
            S.error = "";
            renderView();
        }

        // ══════════════════════════════════════════════════════════════
        //  GESTOR DE DESCARGAS
        // ══════════════════════════════════════════════════════════════
        async function loadDownloads() {
            const d = S.downloads;
            d.loading = true; d.error = ""; renderView();
            try { d.files = await invoke("dl_list_downloads"); }
            catch (e) { d.error = String(e); d.files = []; }
            d.loading = false;
            renderView();
        }

        function openFileMenu(file) { S.menu = { file }; renderView(); }
        function closeFileMenu() { S.menu = null; renderView(); }

        async function deleteDownload(file) {
            closeFileMenu();
            if (!confirm(`¿Borrar "${file.name}"? Esta acción no se puede deshacer.`)) return;
            try { await invoke("dl_delete_file", { path: file.path }); }
            catch (e) { alert("No se pudo borrar: " + e); return; }
            if (S.playingPath === file.path) S.playingPath = null;
            await loadDownloads();
        }

        function openRenameDialog(file) { S.menu = null; S.renameDialog = { file }; renderView(); }
        async function submitRename(inputEl) {
            const { file } = S.renameDialog;
            const newName = inputEl.value.trim();
            S.renameDialog = null;
            const currentBase = file.name.replace(/\.mp3$/i, "");
            if (!newName || newName === currentBase) { renderView(); return; }
            try { await invoke("dl_rename_file", { path: file.path, newName }); }
            catch (e) { alert("No se pudo renombrar: " + e); }
            await loadDownloads();
        }

        function togglePlay(file) {
            S.playingPath = S.playingPath === file.path ? null : file.path;
            renderView();
        }

        function renderDownloadRow(f) {
            const wrap = el("div", { className: "dl-item-wrap" });
            const playing = S.playingPath === f.path;

            const row = el("div", { className: "dl-item", role: "button", tabIndex: 0 });
            row.onclick = () => togglePlay(f);
            row.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePlay(f); } };
            attachLongPress(row, () => openFileMenu(f));

            const thumb = el("div", { className: "dl-item-thumb", innerHTML: window.AlejoIcons.glyph(playing ? "pause" : "music", 20) });
            const main = el("div", { className: "dl-item-main" });
            main.appendChild(el("div", { className: "dl-item-name", textContent: f.name }));
            main.appendChild(el("div", { className: "dl-item-sub", textContent: `${fmtBytes(f.sizeBytes)}${f.modifiedAt ? " · " + fmtDate(f.modifiedAt) : ""}` }));
            const dots = el("button", { className: "dl-item-dots", innerHTML: window.AlejoIcons.glyph("dots", 18) });
            dots.onclick = (e) => { e.stopPropagation(); openFileMenu(f); };

            row.append(thumb, main, dots);
            wrap.appendChild(row);

            if (playing) {
                const audio = el("audio", { className: "dl-audio", controls: true, autoplay: true, src: window.__TAURI__.core.convertFileSrc(f.path) });
                audio.onended = () => { S.playingPath = null; renderView(); };
                wrap.appendChild(audio);
            }
            return wrap;
        }

        function renderDownloadsTab() {
            const d = S.downloads;
            if (d.loading) { root.appendChild(el("p", { className: "dl-empty", textContent: "Buscando descargas..." })); return; }
            if (d.error) { root.appendChild(el("p", { className: "dl-error", textContent: d.error })); return; }
            if (!d.files.length) { root.appendChild(el("p", { className: "dl-empty", textContent: "Todavía no descargaste ninguna canción." })); return; }
            const list = el("div", { className: "dl-list" });
            d.files.forEach(f => list.appendChild(renderDownloadRow(f)));
            root.appendChild(list);
        }

        function renderSheetAndDialogs() {
            if (S.menu) {
                const { file } = S.menu;
                const overlay = el("div", { className: "dl-overlay" });
                overlay.onclick = (e) => { if (e.target === overlay) closeFileMenu(); };
                const sheet = el("div", { className: "dl-sheet" });
                sheet.appendChild(el("div", { className: "dl-sheet-title", textContent: file.name }));
                const renameBtn = el("button", { className: "dl-sheet-btn", textContent: "Renombrar" });
                renameBtn.onclick = () => openRenameDialog(file);
                const deleteBtn = el("button", { className: "dl-sheet-btn dl-sheet-btn--danger", textContent: "Borrar" });
                deleteBtn.onclick = () => deleteDownload(file);
                const cancelBtn = el("button", { className: "dl-sheet-btn dl-sheet-cancel", textContent: "Cancelar" });
                cancelBtn.onclick = closeFileMenu;
                sheet.append(renameBtn, deleteBtn, cancelBtn);
                overlay.appendChild(sheet);
                root.appendChild(overlay);
            }

            if (S.renameDialog) {
                const { file } = S.renameDialog;
                const overlay = el("div", { className: "dl-overlay" });
                const dialog = el("div", { className: "dl-dialog" });
                dialog.appendChild(el("div", { className: "dl-dialog-title", textContent: "Renombrar" }));
                const inp = el("input", { type: "text", className: "dl-dialog-input", value: file.name.replace(/\.mp3$/i, "") });
                dialog.appendChild(inp);
                const actions = el("div", { className: "dl-dialog-actions" });
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
        }

        // ══════════════════════════════════════════════════════════════
        //  PESTAÑA "BUSCAR"
        // ══════════════════════════════════════════════════════════════

        // NUEVO (pedido del usuario -- escuchar antes de decidir
        // descargar): togglea el preview de esta fila -- si ya era la que
        // estaba sonando/cargando, la para; si no, arranca dl_preview
        // (baja ~20s, cachea por URL del lado Rust) y reemplaza cualquier
        // otro preview que estuviera activo.
        function togglePreview(track) {
            if (S.preview.url === track.trackUrl) {
                S.preview = { url: null, path: null, loading: false };
                renderView();
                return;
            }
            S.preview = { url: track.trackUrl, path: null, loading: true };
            renderView();
            invoke("dl_preview", { url: track.trackUrl }).then(path => {
                if (S.preview.url !== track.trackUrl) return; // cambió de fila mientras cargaba
                S.preview.path = path;
                S.preview.loading = false;
                renderView();
            }).catch(e => {
                if (S.preview.url !== track.trackUrl) return;
                S.preview = { url: null, path: null, loading: false };
                renderView();
                alert("No se pudo cargar la preview: " + e);
            });
        }

        function renderResultRow(track) {
            const wrap = el("div", { className: "dl-item-wrap" });
            const row = el("div", { className: "dl-item", role: "button", tabIndex: 0 });
            row.onclick = () => pickResult(track);
            row.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickResult(track); } };

            if (track.thumbnailUrl) {
                row.appendChild(el("img", { className: "dl-item-thumb dl-item-thumb--img", src: track.thumbnailUrl }));
            } else {
                row.appendChild(el("div", { className: "dl-item-thumb", innerHTML: window.AlejoIcons.glyph("music", 20) }));
            }
            const main = el("div", { className: "dl-item-main" });
            main.appendChild(el("div", { className: "dl-item-name", textContent: track.title }));
            const subParts = [track.artist, track.platform, track.duration].filter(Boolean);
            main.appendChild(el("div", { className: "dl-item-sub", textContent: subParts.join(" · ") }));
            row.appendChild(main);

            const isThis = S.preview.url === track.trackUrl;
            const previewBtn = el("button", {
                className: "dl-preview-btn", type: "button",
                title: isThis && S.preview.path ? "Detener preview" : "Escuchar preview",
                innerHTML: window.AlejoIcons.glyph(isThis && S.preview.loading ? "dots" : isThis && S.preview.path ? "pause" : "play", 16),
            });
            previewBtn.onclick = (e) => { e.stopPropagation(); togglePreview(track); };
            row.appendChild(previewBtn);

            wrap.appendChild(row);
            if (isThis && S.preview.path) {
                const audio = el("audio", { className: "dl-audio", controls: true, autoplay: true, src: window.__TAURI__.core.convertFileSrc(S.preview.path) });
                audio.onended = () => { S.preview = { url: null, path: null, loading: false }; renderView(); };
                wrap.appendChild(audio);
            }
            return wrap;
        }

        function renderBuscarTab() {
            if (S.phase === "input" || S.phase === "loading") {
                if (S.mode === "search") {
                    const row = el("div", { className: "input-row dl-url-row" });
                    const inp = el("input", {
                        id: "dl-query-inp",
                        type: "text",
                        placeholder: "Buscar canción o artista...",
                        value: S.query,
                        disabled: S.phase === "loading",
                    });
                    inp.oninput = (e) => { S.query = e.target.value; };
                    inp.onkeydown = (e) => { if (e.key === "Enter") searchTracks(); };
                    row.append(lbl("Buscar", "dl-query-inp"), inp);
                    root.appendChild(row);

                    const btn = el("button", { className: "primary dl-search-btn", textContent: S.phase === "loading" ? "Buscando..." : "Buscar", disabled: S.phase === "loading" });
                    btn.onclick = searchTracks;
                    root.appendChild(btn);

                    const swap = el("button", { className: "dl-mode-swap", textContent: "¿Ya tenés el link? Pegalo en su lugar" });
                    swap.onclick = () => { S.mode = "link"; renderView(); };
                    root.appendChild(swap);
                } else {
                    const row = el("div", { className: "input-row dl-url-row" });
                    const inp = el("input", {
                        id: "dl-url-inp",
                        type: "text",
                        placeholder: "Pegá el link (YouTube, SoundCloud, Bandcamp...)",
                        value: S.url,
                        disabled: S.phase === "loading",
                    });
                    inp.oninput = (e) => { S.url = e.target.value; };
                    inp.onkeydown = (e) => { if (e.key === "Enter") fetchInfo(); };
                    row.append(lbl("Link", "dl-url-inp"), inp);
                    root.appendChild(row);

                    const btn = el("button", { className: "primary dl-search-btn", textContent: S.phase === "loading" ? "Buscando..." : "Buscar", disabled: S.phase === "loading" });
                    btn.onclick = fetchInfo;
                    root.appendChild(btn);

                    const swap = el("button", { className: "dl-mode-swap", textContent: "Volver a buscar por nombre" });
                    swap.onclick = () => { S.mode = "search"; renderView(); };
                    root.appendChild(swap);
                }
            }

            if (S.phase === "error") {
                root.appendChild(el("p", { className: "dl-error", textContent: S.error }));
                const retryBtn = el("button", { textContent: "Volver a intentar" });
                retryBtn.onclick = resetToInput;
                root.appendChild(retryBtn);
            }

            if (S.phase === "results") {
                if (!S.results.length) {
                    root.appendChild(el("p", { className: "dl-empty", textContent: "Sin resultados." }));
                } else {
                    const list = el("div", { className: "dl-list" });
                    S.results.forEach(track => list.appendChild(renderResultRow(track)));
                    root.appendChild(list);
                }
                const backBtn = el("button", { textContent: "Buscar de nuevo" });
                backBtn.onclick = resetToInput;
                root.appendChild(backBtn);
            }

            if (S.info && (S.phase === "preview" || S.phase === "downloading" || S.phase === "done")) {
                const card = el("div", { className: "dl-card" });
                if (S.info.thumbnailUrl) {
                    card.appendChild(el("img", { className: "dl-thumb", src: S.info.thumbnailUrl }));
                }
                const meta = el("div", { className: "dl-meta" });

                const titleInp = el("input", { id: "dl-title-inp", type: "text", className: "dl-title-inp", value: S.info.title, disabled: S.phase !== "preview" });
                titleInp.oninput = (e) => { S.info.title = e.target.value; };
                const artistInp = el("input", { id: "dl-artist-inp", type: "text", className: "dl-artist-inp", value: S.info.artist, disabled: S.phase !== "preview" });
                artistInp.oninput = (e) => { S.info.artist = e.target.value; };

                meta.append(
                    lbl("Artista", "dl-artist-inp"), artistInp,
                    lbl("Título", "dl-title-inp"), titleInp,
                    el("p", { className: "dl-sub", textContent: `${S.info.platform}${S.info.duration ? " · " + S.info.duration : ""}` }),
                );
                card.appendChild(meta);
                root.appendChild(card);

                if (S.phase === "preview") {
                    const qualityRow = el("div", { className: "input-row" });
                    const qualitySel = el("select", { id: "dl-quality-sel", className: "dl-quality-sel" });
                    [["0", "Mejor disponible"], ["320", "320 kbps"], ["256", "256 kbps"], ["192", "192 kbps"], ["128", "128 kbps"]]
                        .forEach(([v, label]) => qualitySel.appendChild(el("option", { value: v, textContent: label, selected: v === S.quality })));
                    qualitySel.onchange = (e) => { S.quality = e.target.value; };
                    qualityRow.append(lbl("Calidad", "dl-quality-sel"), qualitySel);
                    root.appendChild(qualityRow);

                    const actions = el("div", { className: "sm-row-actions" });
                    const dlBtn = el("button", { className: "primary", textContent: "Descargar" });
                    dlBtn.onclick = startDownload;
                    const cancelBtn = el("button", { textContent: "Cancelar" });
                    cancelBtn.onclick = backToResults;
                    actions.append(dlBtn, cancelBtn);
                    root.appendChild(actions);
                }

                if (S.phase === "downloading") {
                    const pct = S.progress != null ? Math.max(0, Math.min(100, S.progress)) : 0;
                    const wrap = el("div", { className: "dl-progress" });
                    const bar = el("div", { className: "dl-progress-bar" });
                    bar.style.width = `${pct.toFixed(0)}%`;
                    wrap.appendChild(bar);
                    root.appendChild(wrap);
                    root.appendChild(el("p", { className: "dl-sub", textContent: `Descargando... ${pct.toFixed(0)}%${S.eta != null ? " · ETA " + fmtEta(S.eta) : ""}` }));
                }

                if (S.phase === "done") {
                    root.appendChild(el("p", { className: "dl-done", textContent: `Guardada en ${S.savedPath}` }));
                    const copyBtn = el("button", { textContent: S.copiedPath ? "Copiada" : "Copiar ruta" });
                    copyBtn.onclick = copySavedPath;
                    root.appendChild(copyBtn);
                    const anotherBtn = el("button", { className: "primary", textContent: "Descargar otra" });
                    anotherBtn.onclick = () => { S.url = ""; S.query = ""; resetToInput(); };
                    root.appendChild(anotherBtn);
                }
            }
        }

        // ══════════════════════════════════════════════════════════════
        //  DISPATCH
        // ══════════════════════════════════════════════════════════════
        function renderTabs() {
            const tabs = el("div", { className: "dl-tabs" });
            [["buscar", "Buscar"], ["descargas", "Descargas"]].forEach(([key, label]) => {
                const btn = el("button", { className: `dl-tab${S.tab === key ? " dl-tab--active" : ""}`, textContent: label });
                btn.onclick = () => {
                    S.tab = key;
                    renderView();
                    if (key === "descargas" && !S.downloads.files.length && !S.downloads.loading) loadDownloads();
                };
                tabs.appendChild(btn);
            });
            root.appendChild(tabs);
        }

        function renderView() {
            root.innerHTML = "";
            renderTabs();
            if (S.tab === "descargas") renderDownloadsTab();
            else renderBuscarTab();
            renderSheetAndDialogs();
        }

        renderView();
        if (deepLinkUrl) fetchInfo(); // "Compartir" ya dejó la URL pegada -- arrancar la búsqueda de info sola
        }
    },
    onOutput() {},
    onDone() {},
    // NUEVO (compartir a la app, estilo Snaptube): mismo mecanismo genérico
    // que ya usa LectorDocs para "Abrir con..." -- checkDeepLinks() en
    // main.js llama a esto por cada tool al arrancar (o al retomar la app);
    // si hay texto pendiente de un ACTION_SEND, se guarda y se devuelve
    // true para que main.js abra esta herramienta directo.
    async checkDeepLink() {
        try {
            const url = await invoke("dl_take_pending_share_text");
            if (url) {
                pendingShareUrlFromDeepLink = url;
                return true;
            }
        } catch (e) { /* no-op -- no es Android, o nada pendiente */ }
        return false;
    },
});
