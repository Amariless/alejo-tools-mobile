// Acerca/ui.js — herramienta de prueba: confirma que list_tools() /
// get_tool_ui() / get_tool_style() funcionan de punta a punta en un
// dispositivo/emulador Android real antes de portar SyncManager o
// Descargar Música. Se puede borrar cuando exista otra herramienta que
// cumpla el mismo rol de "primera pestaña".
registerRenderer("acerca", {
    render(tool, area) {
        const wrap = el("div", { className: "acerca-wrap" });
        wrap.innerHTML = `
            <p class="acerca-lead">Esqueleto de Alejo Tools Mobile funcionando 🎉</p>
            <ul class="acerca-list">
                <li>✅ list_tools / get_tool_ui / get_tool_style</li>
                <li>⏳ SyncManager (cliente de Syncthing-Android)</li>
                <li>⏳ Descargar Música (youtubedl-android)</li>
            </ul>
        `;
        area.appendChild(wrap);
    },
    onOutput() {},
    onDone() {},
});
