// main.js — shell de Alejo Tools Mobile.
//
// Mismo patrón que la app de escritorio (alejo-tools/src/main.js): cada
// herramienta vive en tools/<Id>/ con tool.json + ui.js + style.css
// opcional, list_tools()/get_tool_ui()/get_tool_style() del lado Rust las
// descubre, y cada ui.js se ejecuta con el mismo contrato de funciones
// (window._toolCtx, registerRenderer/getRenderer, invoke, el, lbl,
// runTool, appendLine, etc.) — así una herramienta portada desde el
// escritorio (SyncManager, Descargar Música) necesita tocar lo mínimo de
// su ui.js para correr acá.
//
// Lo que NO se portó (no tiene sentido en un teléfono, o es exclusivo de
// Windows en el original): barra de título sin bordes + drag, bandeja del
// sistema, autostart, mini-navegador de búsqueda, autofill de WebView2,
// SkinManager (skins de escritorio con ventana transparente), F11/F12.
// La navegación es una barra de pestañas ABAJO (patrón Android) en vez de
// un sidebar a la izquierda.
const { invoke } = window.__TAURI__.core;
const { listen }  = window.__TAURI__.event;

let tools      = [];
let activeTool = null;
let isRunning  = false;

const tabBar         = document.getElementById("tab-bar");
const welcome        = document.getElementById("welcome");
const toolView       = document.getElementById("tool-view");
const appBarIcon     = document.getElementById("app-bar-icon");
const appBarTitle    = document.getElementById("app-bar-title");
const appBarDesc     = document.getElementById("app-bar-desc");
const toolInputArea  = document.getElementById("tool-input-area");
const toolOutput     = document.getElementById("tool-output");
const styleOverride  = document.getElementById("tool-style-override");

// ════════════════════════════════════════════════════════
//  HERRAMIENTAS PERSISTENTES — igual que en escritorio: una herramienta
//  con "persistent": true en su tool.json recibe un contenedor propio que
//  nunca se destruye al cambiar de pestaña, solo se oculta (para que una
//  sincronización o descarga en curso siga viva de fondo).
// ════════════════════════════════════════════════════════
const persistentTools = {}; // id -> { el, initialized }

function getOrCreatePersistentContainer(tool) {
    let entry = persistentTools[tool.id];
    if (!entry) {
        const elDiv = document.createElement("div");
        elDiv.style.cssText = "flex:1;display:none;flex-direction:column;overflow:hidden;min-height:0;";
        toolView.appendChild(elDiv);
        entry = { el: elDiv, initialized: false };
        persistentTools[tool.id] = entry;
    }
    return entry;
}

function hideAllPersistentContainersExcept(keepId) {
    Object.entries(persistentTools).forEach(([id, entry]) => {
        if (id !== keepId) entry.el.style.display = "none";
    });
}

// ════════════════════════════════════════════════════════
//  SISTEMA DE RENDERERS — mismo contrato que escritorio.
// ════════════════════════════════════════════════════════
const RENDERERS = {};
const registerRenderer = (type, r) => RENDERERS[type] = r;
const getRenderer      = (type)    => RENDERERS[type] || RENDERERS["text"];

window._toolCtx = {
    invoke, el, lbl, runTool,
    appendLine, appendSeparator, resetBtn, classifyLine,
    defaultOut, defaultDone, registerRenderer,
    get activeTool()    { return activeTool; },
    get toolOutput()    { return toolOutput; },
    get toolInputArea() { return toolInputArea; },
};

// ── text (fallback genérico) ────────────────────────────
registerRenderer("text", {
    render(tool, area) {
        const row = el("div", { className: "input-row" });
        const inp = el("input", { type: "text", placeholder: "Escribe algo...", id: "main-input" });
        const btn = el("button", { textContent: "Ejecutar", id: "run-btn", className: "primary" });
        btn.onclick = () => { const v = inp.value.trim(); if (v) runTool(tool, [v]); };
        inp.onkeydown = e => { if (e.key === "Enter") btn.click(); };
        row.append(inp, btn);
        area.append(lbl("Entrada"), row);
    },
    onOutput: defaultOut, onDone: defaultDone("Ejecutar")
});

// ════════════════════════════════════════════════════════
//  CARGA DINÁMICA DE ui.js — idéntico al mecanismo de escritorio.
// ════════════════════════════════════════════════════════
const _loadedUiScripts = new Set();

async function loadToolUi(tool) {
    if (!tool.has_ui) return;
    if (_loadedUiScripts.has(tool.id)) return;
    let code;
    try { code = await invoke("get_tool_ui", { toolId: tool.id }); }
    catch (e) { console.error(`Error invocando get_tool_ui para ${tool.id}:`, e); return; }
    if (!code || !code.trim()) return;
    try {
        const fn = new Function(
            "ctx", "registerRenderer", "getRenderer", "invoke", "el", "lbl",
            "runTool", "appendLine", "appendSeparator", "resetBtn",
            "classifyLine", "defaultOut", "defaultDone",
            "toolOutput", "toolInputArea",
            code
        );
        fn(window._toolCtx, registerRenderer, getRenderer, invoke, el, lbl,
           runTool, appendLine, appendSeparator, resetBtn,
           classifyLine, defaultOut, defaultDone,
           toolOutput, toolInputArea);
        _loadedUiScripts.add(tool.id);
    } catch (e) { console.error(`Error ejecutando ui.js de ${tool.id}:`, e); }
}

// ════════════════════════════════════════════════════════
//  CORE
// ════════════════════════════════════════════════════════
async function init() {
    try {
        const themesCSS = await invoke("get_themes_css");
        if (themesCSS) {
            const styleEl = document.getElementById("themes-style");
            if (styleEl) styleEl.textContent = themesCSS;
        }
    } catch (e) { console.warn("No se pudo cargar themes.css:", e); }

    tools = await invoke("list_tools");
    await Promise.all(tools.filter(t => t.has_ui).map(loadToolUi));
    renderTabBar();
    await listen("tool-output", onToolOutput);
    await listen("tool-done", onToolDone);

    if (tools.length) {
        selectTool(tools[0]);
    } else {
        welcome.querySelector("p").textContent = "Sin herramientas todavía";
    }
}

function renderTabBar() {
    tabBar.innerHTML = "";
    tools.forEach(tool => {
        const item = el("button", { className: "tab-item", type: "button" });
        item.dataset.id = tool.id;
        item.innerHTML = `<span class="tab-item-icon">${tool.icon}</span><span class="tab-item-name">${tool.name}</span>`;
        item.onclick = () => selectTool(tool);
        tabBar.appendChild(item);
    });
}

async function selectTool(tool) {
    if (activeTool?.id === tool.id) return;

    if (activeTool && !activeTool.persistent) {
        const prev = getRenderer(activeTool.input);
        if (prev?.onLeave) prev.onLeave();
        try { await Promise.race([invoke("kill_tool", { toolId: activeTool.id }), new Promise(r => setTimeout(r, 300))]); } catch (e) {}
    } else if (activeTool && activeTool.persistent) {
        const entry = persistentTools[activeTool.id];
        if (entry) entry.el.style.display = "none";
    }

    activeTool = tool; isRunning = false;
    document.querySelectorAll(".tab-item").forEach(e => e.classList.toggle("active", e.dataset.id === tool.id));
    welcome.classList.add("hidden"); toolView.classList.remove("hidden");

    appBarIcon.textContent = tool.icon;
    appBarTitle.textContent = tool.name;
    appBarDesc.textContent = tool.description;
    styleOverride.textContent = tool.has_style ? await invoke("get_tool_style", { toolId: tool.id }) : "";

    hideAllPersistentContainersExcept(tool.persistent ? tool.id : null);

    if (tool.persistent) {
        toolInputArea.style.display = "none";
        toolOutput.style.display = "none";
        const entry = getOrCreatePersistentContainer(tool);
        entry.el.style.display = "flex";
        if (!entry.initialized) {
            entry.initialized = true;
            getRenderer(tool.input).render(tool, entry.el, toolOutput);
        }
    } else {
        toolInputArea.style.display = "";
        toolOutput.style.display = "";
        toolOutput.innerHTML = ""; toolInputArea.innerHTML = "";
        toolInputArea.style.cssText = "";
        getRenderer(tool.input).render(tool, toolInputArea, toolOutput);
    }
}

async function runTool(tool, args) {
    if (isRunning) return; isRunning = true;
    toolOutput.innerHTML = ""; appendSeparator(toolOutput);
    const btn = document.getElementById("run-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Ejecutando..."; }
    try { await invoke("run_tool", { toolId: tool.id, args }); }
    catch (e) { appendLine(toolOutput, e.toString(), "error"); isRunning = false; }
}

function onToolOutput(e) {
    const { tool, line, stream } = e.payload;
    if (activeTool?.id !== tool) return;
    getRenderer(activeTool.input).onOutput(line, stream, toolOutput);
}

function onToolDone(e) {
    const { tool, code } = e.payload;
    const renderer = tools.find(t => t.id === tool);
    const r = renderer ? getRenderer(renderer.input) : null;
    if (!r?.onDone) return;
    if (activeTool?.id !== tool) { r.onDone(code, toolOutput); return; }
    if (code === -1 || code === 1) return;
    isRunning = false;
    r.onDone(code, toolOutput);
}

// ── Helpers ────────────────────────────────────────────
function el(tag, props = {}) { const e = document.createElement(tag); Object.assign(e, props); return e; }
function lbl(text) { return el("div", { className: "input-label", textContent: text }); }
function classifyLine(l) { if (/✓|completad|listo|✅/i.test(l)) return "success"; if (/✗|error|fallo|❌/i.test(l)) return "error"; if (/warning|advertencia|⚠/i.test(l)) return "warning"; if (/^[\s═─=\-]{5,}/.test(l)) return "dim"; return ""; }
function appendLine(out, text, cls = "") { const s = el("span", { className: "out-line" + (cls ? ` ${cls}` : ""), textContent: text }); out.appendChild(s); out.scrollTop = out.scrollHeight; }
function appendSeparator(out) { out.appendChild(el("hr", { className: "out-separator" })); }
function resetBtn(label) { isRunning = false; const b = document.getElementById("run-btn"); if (b) { b.disabled = false; b.textContent = label; } }
function defaultOut(line, stream, out) { appendLine(out, line, stream === "stderr" ? "error" : classifyLine(line)); }
function defaultDone(label) { return (code, out) => { appendSeparator(out); appendLine(out, code === 0 ? "✓ Completado" : `✗ Código ${code}`, code === 0 ? "success" : "error"); resetBtn(label); }; }

document.addEventListener("contextmenu", e => e.preventDefault());

window.addEventListener("DOMContentLoaded", init);
