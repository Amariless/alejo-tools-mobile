// ui.js — Descargar Música (mobile).
//
// A propósito NO persistente (ver tool.json) -- a diferencia de SyncManager,
// acá no hay nada que mantener vivo de fondo entre pestañas: una descarga
// ya arrancada sigue corriendo del lado de Android aunque el usuario
// vuelva a la lista (ver downloader.rs/YtDlpBridge.kt, corre en su propio
// hilo), simplemente esta pantalla no se queda mostrando su progreso si el
// usuario se fue -- aceptable para esta primera versión: pegar un link,
// bajar una canción por vez.
registerRenderer("descargarmusica", {
    render(tool, area) {
        const root = el("div", { className: "dl-root" });
        area.appendChild(root);

        const S = {
            phase: "input", // input | loading | preview | downloading | done | error
            url: "",
            info: null,
            quality: "0", // "0" = mejor disponible
            progress: null,
            eta: null,
            error: "",
            savedPath: "",
        };

        function fmtEta(secs) {
            if (secs == null || secs < 0) return "";
            const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
            return `${m}:${String(s).padStart(2, "0")}`;
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

        async function startDownload() {
            S.phase = "downloading";
            S.progress = 0;
            S.eta = null;
            S.error = "";
            renderView();

            let unlisten = null;
            try {
                unlisten = await window.__TAURI__.event.listen("dl-progress", (e) => {
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

        function resetToInput() {
            S.phase = "input";
            S.info = null;
            S.error = "";
            S.progress = null;
            S.savedPath = "";
            renderView();
        }

        function renderView() {
            root.innerHTML = "";

            const urlRow = el("div", { className: "input-row dl-url-row" });
            const urlInp = el("input", {
                type: "text",
                placeholder: "Pegá el link (YouTube, SoundCloud, Bandcamp...)",
                value: S.url,
                disabled: S.phase === "loading" || S.phase === "downloading",
            });
            urlInp.oninput = (e) => { S.url = e.target.value; };
            urlInp.onkeydown = (e) => { if (e.key === "Enter") fetchInfo(); };
            urlRow.append(lbl("Link"), urlInp);
            root.appendChild(urlRow);

            if (S.phase === "input" || S.phase === "loading") {
                const btn = el("button", {
                    className: "primary dl-search-btn",
                    textContent: S.phase === "loading" ? "Buscando..." : "Buscar",
                    disabled: S.phase === "loading",
                });
                btn.onclick = fetchInfo;
                root.appendChild(btn);
            }

            if (S.phase === "error") {
                root.appendChild(el("p", { className: "dl-error", textContent: S.error }));
                const retryBtn = el("button", { textContent: "Volver a intentar" });
                retryBtn.onclick = resetToInput;
                root.appendChild(retryBtn);
            }

            if (S.info && (S.phase === "preview" || S.phase === "downloading" || S.phase === "done")) {
                const card = el("div", { className: "dl-card" });
                if (S.info.thumbnailUrl) {
                    card.appendChild(el("img", { className: "dl-thumb", src: S.info.thumbnailUrl }));
                }
                const meta = el("div", { className: "dl-meta" });

                const titleInp = el("input", { type: "text", className: "dl-title-inp", value: S.info.title, disabled: S.phase !== "preview" });
                titleInp.oninput = (e) => { S.info.title = e.target.value; };
                const artistInp = el("input", { type: "text", className: "dl-artist-inp", value: S.info.artist, disabled: S.phase !== "preview" });
                artistInp.oninput = (e) => { S.info.artist = e.target.value; };

                meta.append(
                    lbl("Artista"), artistInp,
                    lbl("Título"), titleInp,
                    el("p", { className: "dl-sub", textContent: `${S.info.platform}${S.info.duration ? " · " + S.info.duration : ""}` }),
                );
                card.appendChild(meta);
                root.appendChild(card);

                if (S.phase === "preview") {
                    const qualityRow = el("div", { className: "input-row" });
                    const qualitySel = el("select", { className: "dl-quality-sel" });
                    [["0", "Mejor disponible"], ["320", "320 kbps"], ["256", "256 kbps"], ["192", "192 kbps"], ["128", "128 kbps"]]
                        .forEach(([v, label]) => qualitySel.appendChild(el("option", { value: v, textContent: label, selected: v === S.quality })));
                    qualitySel.onchange = (e) => { S.quality = e.target.value; };
                    qualityRow.append(lbl("Calidad"), qualitySel);
                    root.appendChild(qualityRow);

                    const actions = el("div", { className: "sm-row-actions" });
                    const dlBtn = el("button", { className: "primary", textContent: "Descargar" });
                    dlBtn.onclick = startDownload;
                    const cancelBtn = el("button", { textContent: "Cancelar" });
                    cancelBtn.onclick = resetToInput;
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
                    const anotherBtn = el("button", { className: "primary", textContent: "Descargar otra" });
                    anotherBtn.onclick = () => { S.url = ""; resetToInput(); };
                    root.appendChild(anotherBtn);
                }
            }
        }

        renderView();
    },
    onOutput() {},
    onDone() {},
});
