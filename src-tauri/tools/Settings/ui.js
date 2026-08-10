// ui.js — Configuración: estado del proyecto + auto-actualización.
//
// Sin Play Store de por medio -- "actualizar" acá compara la versión
// instalada contra el último Release de GitHub (ver update.rs) y, si hay
// una más nueva, la DESCARGA nosotros mismos (ver
// download_and_install_update en update.rs) y le pide al sistema que la
// instale (ver installer.rs, FileProvider + Intent por JNI) -- Android
// igual va a pedir confirmación humana para instalar (no hay forma de
// saltarse eso, ni con esta app ni con ninguna otra fuera de una store),
// pero al menos no hace falta salir al navegador ni volver a abrir el
// archivo a mano.
registerRenderer("settings", {
    render(tool, area) {
        const wrap = el("div", { className: "st-wrap" });
        area.appendChild(wrap);

        wrap.innerHTML = `
            <div class="st-card">
                <div class="st-card-title">Estado del proyecto</div>
                <ul class="st-list">
                    <li>✅ Esqueleto (list_tools / get_tool_ui / get_tool_style)</li>
                    <li>✅ SyncManager (cliente de Syncthing-Android)</li>
                    <li>⏳ Descargar Música (youtubedl-android)</li>
                </ul>
            </div>
            <div class="st-card">
                <div class="st-card-title">Versión</div>
                <div class="st-version" id="st-current-version">…</div>
                <button id="st-update-btn" class="primary">Buscar actualizaciones</button>
                <div class="st-progress hidden" id="st-progress"><div class="st-progress-bar" id="st-progress-bar"></div></div>
                <p class="st-update-msg" id="st-update-msg"></p>
            </div>
        `;

        const btn = wrap.querySelector("#st-update-btn");
        const msg = wrap.querySelector("#st-update-msg");
        const versionEl = wrap.querySelector("#st-current-version");
        const progressWrap = wrap.querySelector("#st-progress");
        const progressBar = wrap.querySelector("#st-progress-bar");

        function fmtMb(bytes) {
            return (bytes / (1024 * 1024)).toFixed(1);
        }

        async function downloadAndInstall(info) {
            btn.disabled = true;
            progressWrap.classList.remove("hidden");
            progressBar.style.width = "0%";
            msg.textContent = "Descargando…";
            msg.className = "st-update-msg";

            let unlisten = null;
            try {
                unlisten = await window.__TAURI__.event.listen("update-download-progress", (e) => {
                    const { downloaded, total, percent } = e.payload;
                    if (percent != null) {
                        progressBar.style.width = `${percent.toFixed(0)}%`;
                        msg.textContent = total
                            ? `Descargando… ${fmtMb(downloaded)} MB / ${fmtMb(total)} MB (${percent.toFixed(0)}%)`
                            : `Descargando… ${fmtMb(downloaded)} MB`;
                    }
                });
                await invoke("download_and_install_update", { url: info.apk_url });
                msg.textContent = "Listo -- confirmá la instalación en el diálogo del sistema.";
                msg.classList.add("st-update-msg--new");
            } catch (e) {
                msg.textContent = "Error al descargar/instalar: " + e;
                msg.classList.add("st-update-msg--error");
            } finally {
                if (unlisten) unlisten();
                progressWrap.classList.add("hidden");
                btn.disabled = false;
                btn.textContent = "Buscar actualizaciones";
                btn.onclick = checkUpdate;
            }
        }

        async function checkUpdate() {
            btn.disabled = true;
            const original = btn.textContent;
            btn.textContent = "Buscando...";
            msg.textContent = "";
            msg.className = "st-update-msg";
            try {
                const info = await invoke("check_for_update");
                versionEl.textContent = `v${info.current_version}`;
                msg.textContent = info.message;
                if (info.is_newer && info.apk_url) {
                    msg.classList.add("st-update-msg--new");
                    btn.textContent = `Descargar e instalar v${info.latest_version}`;
                    btn.disabled = false;
                    btn.onclick = () => downloadAndInstall(info);
                } else {
                    btn.textContent = original;
                    btn.disabled = false;
                    btn.onclick = checkUpdate;
                }
            } catch (e) {
                msg.textContent = "Error: " + e;
                msg.classList.add("st-update-msg--error");
                btn.textContent = original;
                btn.disabled = false;
            }
        }

        btn.onclick = checkUpdate;

        // Versión instalada visible de entrada, sin esperar al primer
        // chequeo -- checkUpdate() la vuelve a pisar con el mismo valor
        // (viene de env!("CARGO_PKG_VERSION"), no hace falta duplicar la
        // constante acá).
        invoke("check_for_update").then(info => {
            versionEl.textContent = `v${info.current_version}`;
        }).catch(() => {});
    },
    onOutput() {},
    onDone() {},
});
