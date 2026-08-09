// ui.js — Configuración: estado del proyecto + auto-actualización.
//
// Sin Play Store de por medio -- "actualizar" acá compara la versión
// instalada contra el último Release de GitHub (ver update.rs) y, si hay
// una más nueva, abre el navegador directo en la URL del .apk. Android
// siempre pide confirmación humana para instalar -- no hay forma de
// saltarse eso, ni con esta app ni con ninguna otra fuera de una store.
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
                <p class="st-update-msg" id="st-update-msg"></p>
            </div>
        `;

        const btn = wrap.querySelector("#st-update-btn");
        const msg = wrap.querySelector("#st-update-msg");
        const versionEl = wrap.querySelector("#st-current-version");

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
                    btn.textContent = `Descargar v${info.latest_version}`;
                    btn.disabled = false;
                    btn.onclick = () => {
                        try {
                            window.__TAURI__.opener.openUrl(info.apk_url);
                        } catch (e) {
                            alert("No se pudo abrir el navegador: " + e);
                        }
                    };
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
