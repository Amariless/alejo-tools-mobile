// ui.js — SyncManager mobile (cliente de Syncthing-Android).
//
// Persistente (ver tool.json: "persistent": true) -- igual que en
// escritorio, para que la sincronización siga viva de fondo si el usuario
// cambia de pestaña. A diferencia del escritorio, acá NO hay ningún
// binario que arrancar/parar: solo se guarda host+API Key (una vez) y de
// ahí en más es un cliente HTTP puro contra la app oficial de Syncthing.
registerRenderer("syncmanager", {
    render(tool, area) {
        const root = el("div", { className: "sm-root" });
        area.appendChild(root);

        const S = {
            config: { host: "http://127.0.0.1:8384", api_key: "" },
            status: null,
            folders: [],
            folderStatus: {},
            pending: {},
            devices: [],
            connections: {},
            qr: null,
            showQr: false,
        };

        function fmtBytes(n) {
            if (!n && n !== 0) return "";
            const units = ["B", "KB", "MB", "GB", "TB"];
            let i = 0, v = n;
            while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
            return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
        }

        async function loadConfig() {
            S.config = await invoke("sync_get_config");
        }

        async function refreshAll() {
            if (!S.config || !S.config.api_key) { renderView(); return; }
            S.status = await invoke("sync_status");
            if (S.status.connected) {
                const [folders, pending, devices, connections] = await Promise.all([
                    invoke("sync_get_folders").catch(() => []),
                    invoke("sync_pending_folders").catch(() => ({})),
                    invoke("sync_get_devices").catch(() => []),
                    invoke("sync_connections").catch(() => ({ connections: {} })),
                ]);
                S.folders = folders || [];
                S.pending = pending || {};
                S.devices = devices || [];
                S.connections = (connections && connections.connections) || {};
                S.folders.forEach(f => {
                    invoke("sync_get_folder_status", { id: f.id })
                        .then(st => { S.folderStatus[f.id] = st; renderView(); })
                        .catch(() => {});
                });
            }
            renderView();
        }

        // ── Pantalla de conexión (sin API Key todavía) ──────────
        function renderConnectForm() {
            root.innerHTML = "";
            const wrap = el("div", { className: "sm-connect" });
            wrap.innerHTML = `
                <p class="sm-lead">Conectá con Syncthing en este teléfono</p>
                <p class="sm-hint">Instalá la app oficial de <b>Syncthing</b>
                (Play Store / F-Droid), abrí Ajustes → Interfaz Web y copiá
                el <b>API Key</b> acá.</p>
            `;
            const hostRow = el("div", { className: "input-row" });
            const hostInp = el("input", { type: "text", id: "sm-host", value: (S.config && S.config.host) || "http://127.0.0.1:8384" });
            hostRow.append(lbl("Dirección"), hostInp);

            const keyRow = el("div", { className: "input-row" });
            const keyInp = el("input", { type: "text", id: "sm-key", placeholder: "API Key" });
            keyRow.append(lbl("API Key"), keyInp);

            const err = el("p", { className: "sm-error hidden" });

            const btn = el("button", { className: "primary", textContent: "Conectar" });
            btn.onclick = async () => {
                if (!keyInp.value.trim()) { keyInp.focus(); return; }
                btn.disabled = true; btn.textContent = "Conectando...";
                err.classList.add("hidden");
                try {
                    await invoke("sync_set_config", { host: hostInp.value.trim(), apiKey: keyInp.value.trim() });
                    await loadConfig();
                    await refreshAll();
                    if (!S.status || !S.status.connected) {
                        err.textContent = (S.status && S.status.error) || "No se pudo conectar";
                        err.classList.remove("hidden");
                    }
                } catch (e) {
                    err.textContent = String(e);
                    err.classList.remove("hidden");
                } finally {
                    btn.disabled = false; btn.textContent = "Conectar";
                }
            };

            wrap.append(hostRow, keyRow, err, btn);
            root.appendChild(wrap);
        }

        // ── Estado de conexión ───────────────────────────────────
        function renderStatusCard() {
            const st = S.status;
            const ok = !!(st && st.connected);
            const card = el("div", { className: "sm-card sm-status" });
            card.innerHTML = ok
                ? `<div class="sm-status-dot ok"></div>
                   <div><div class="sm-status-title">Conectado</div>
                   <div class="sm-status-sub">Syncthing ${st.version || ""}</div></div>`
                : `<div class="sm-status-dot bad"></div>
                   <div><div class="sm-status-title">Sin conexión</div>
                   <div class="sm-status-sub">${(st && st.error) || "Revisá que Syncthing esté abierto"}</div></div>`;
            return card;
        }

        // ── Carpetas ofrecidas por otros dispositivos ───────────
        function renderPending() {
            const ids = Object.keys(S.pending || {});
            if (!ids.length) return null;
            const wrap = el("div", { className: "sm-section" });
            wrap.appendChild(el("div", { className: "sm-section-title", textContent: "Carpetas ofrecidas" }));
            ids.forEach(id => {
                const offeredBy = (S.pending[id] && S.pending[id].offeredBy) || {};
                Object.entries(offeredBy).forEach(([deviceId, info]) => {
                    const label = (info && info.label) || id;
                    const suggestedPath = `/storage/emulated/0/Syncthing/${label}`;
                    const row = el("div", { className: "sm-card sm-pending" });
                    row.innerHTML = `
                        <div class="sm-pending-name">📁 ${label}</div>
                        <div class="sm-pending-sub">ofrecida por ${deviceId.slice(0, 7)}…</div>
                        <div class="input-row"><input type="text" class="sm-accept-path" value="${suggestedPath}"></div>
                        <div class="sm-row-actions">
                          <button class="sm-accept-btn primary">Aceptar</button>
                          <button class="sm-dismiss-btn">Ignorar</button>
                        </div>`;
                    row.querySelector(".sm-accept-btn").onclick = async (e) => {
                        const path = row.querySelector(".sm-accept-path").value.trim();
                        e.target.disabled = true;
                        try { await invoke("sync_accept_pending_folder", { id, path, label, deviceId }); await refreshAll(); }
                        catch (err) { alert("Error: " + err); e.target.disabled = false; }
                    };
                    row.querySelector(".sm-dismiss-btn").onclick = async (e) => {
                        e.target.disabled = true;
                        try { await invoke("sync_dismiss_pending_folder", { id, label, deviceId }); await refreshAll(); }
                        catch (err) { alert("Error: " + err); e.target.disabled = false; }
                    };
                    wrap.appendChild(row);
                });
            });
            return wrap;
        }

        // ── Carpetas sincronizadas ───────────────────────────────
        function renderFolders() {
            const wrap = el("div", { className: "sm-section" });
            wrap.appendChild(el("div", { className: "sm-section-title", textContent: `Carpetas (${S.folders.length})` }));
            if (!S.folders.length) {
                wrap.appendChild(el("p", { className: "sm-empty", textContent: "Sin carpetas configuradas todavía -- agregalas desde la app de Syncthing." }));
                return wrap;
            }
            S.folders.forEach(f => {
                const stt = S.folderStatus[f.id];
                const state = f.paused ? "Pausada" : ((stt && stt.state) || "…");
                const row = el("div", { className: "sm-card sm-folder" });
                row.innerHTML = `
                    <div class="sm-folder-main">
                        <div class="sm-folder-name">📁 ${f.label || f.id}</div>
                        <div class="sm-folder-sub">${state}${stt ? " · " + fmtBytes(stt.globalBytes) : ""}</div>
                    </div>`;
                const actions = el("div", { className: "sm-row-actions" });
                const pauseBtn = el("button", { textContent: f.paused ? "Reanudar" : "Pausar" });
                pauseBtn.onclick = async () => {
                    pauseBtn.disabled = true;
                    try { await invoke("sync_set_folder_paused", { id: f.id, paused: !f.paused }); await refreshAll(); }
                    catch (e) { alert("Error: " + e); pauseBtn.disabled = false; }
                };
                const scanBtn = el("button", { textContent: "Reescanear" });
                scanBtn.onclick = async () => {
                    scanBtn.disabled = true;
                    try { await invoke("sync_rescan_folder", { id: f.id }); } catch (e) { alert("Error: " + e); }
                    scanBtn.disabled = false;
                };
                actions.append(pauseBtn, scanBtn);
                row.appendChild(actions);
                wrap.appendChild(row);
            });
            return wrap;
        }

        // ── Dispositivos ─────────────────────────────────────────
        function renderDevices() {
            const others = S.devices.filter(d => d.deviceID !== (S.status && S.status.my_id));
            const wrap = el("div", { className: "sm-section" });
            wrap.appendChild(el("div", { className: "sm-section-title", textContent: `Dispositivos (${others.length})` }));
            others.forEach(d => {
                const conn = S.connections[d.deviceID];
                const online = !!(conn && conn.connected);
                const row = el("div", { className: "sm-card sm-device" });
                row.innerHTML = `
                    <div class="sm-device-dot ${online ? "ok" : ""}"></div>
                    <div><div class="sm-device-name">${d.name || d.deviceID.slice(0, 7)}</div>
                    <div class="sm-device-sub">${online ? "Conectado" : "Desconectado"}</div></div>`;
                wrap.appendChild(row);
            });
            return wrap;
        }

        async function toggleQr() {
            S.showQr = !S.showQr;
            if (S.showQr && !S.qr) {
                try { S.qr = await invoke("sync_my_id_qr"); } catch (e) { S.qr = null; }
            }
            renderView();
        }

        // ── Vista principal (ya conectado) ───────────────────────
        function renderConnected() {
            root.innerHTML = "";
            const toolbar = el("div", { className: "sm-toolbar" });
            const refreshBtn = el("button", { textContent: "↻ Actualizar" });
            refreshBtn.onclick = () => refreshAll();
            const qrBtn = el("button", { textContent: S.showQr ? "Ocultar QR" : "Emparejar (QR)" });
            qrBtn.onclick = toggleQr;
            toolbar.append(refreshBtn, qrBtn);
            root.appendChild(toolbar);

            root.appendChild(renderStatusCard());

            if (S.showQr) {
                const qrWrap = el("div", { className: "sm-qr-wrap" });
                if (S.qr) {
                    qrWrap.innerHTML = S.qr;
                    if (S.status && S.status.my_id) qrWrap.appendChild(el("p", { className: "sm-qr-id", textContent: S.status.my_id }));
                } else {
                    qrWrap.textContent = "Generando...";
                }
                root.appendChild(qrWrap);
            }

            if (S.status && S.status.connected) {
                const pendingSection = renderPending();
                if (pendingSection) root.appendChild(pendingSection);
                root.appendChild(renderFolders());
                root.appendChild(renderDevices());
            }

            const forget = el("button", { className: "sm-forget", textContent: "Olvidar conexión" });
            forget.onclick = async () => {
                if (!confirm("¿Olvidar el API Key guardado?")) return;
                await invoke("sync_set_config", { host: S.config.host, apiKey: "" });
                await loadConfig();
                renderView();
            };
            root.appendChild(forget);
        }

        function renderView() {
            if (!S.config || !S.config.api_key) renderConnectForm();
            else renderConnected();
        }

        (async () => {
            await loadConfig();
            renderView();
            await refreshAll();
            setInterval(() => { if (S.config && S.config.api_key) refreshAll(); }, 10000);
        })();
    },
    onOutput() {},
    onDone() {},
});
