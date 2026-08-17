// main.js — shell de Alejo Tools Mobile.
//
// Mismo patrón que la app de escritorio (alejo-tools/src/main.js): cada
// herramienta vive en tools/<Id>/ con tool.json + ui.js + style.css
// opcional, list_tools()/get_tool_ui()/get_tool_style() del lado Rust las
// descubre, y cada ui.js se ejecuta con el mismo contrato de funciones
// (window._toolCtx, registerRenderer/getRenderer, invoke, el, lbl,
// runTool, appendLine, etc.) — así una herramienta portada desde el
// escritorio necesita tocar lo mínimo de su ui.js para correr acá.
//
// Navegación (pedido del usuario -- antes era una barra de pestañas
// abajo): pantalla de inicio con la lista de herramientas, tocar una
// entra a pantalla completa con una flecha "←" arriba a la izquierda
// para volver a la lista -- patrón estándar de navegación por lista en
// Android/iOS, en vez de tabs siempre visibles.
//
// Lo que NO se portó (no tiene sentido en un teléfono, o es exclusivo de
// Windows en el original): barra de título sin bordes + drag, bandeja del
// sistema, autostart, mini-navegador de búsqueda, autofill de WebView2,
// SkinManager (skins de escritorio con ventana transparente), F11/F12.
const { invoke } = window.__TAURI__.core;
const { listen }  = window.__TAURI__.event;

let tools      = [];
let activeTool = null;
let isRunning  = false;

const toolListEl     = document.getElementById("tool-list");
const toolView       = document.getElementById("tool-view");
const appBar         = document.getElementById("app-bar");
const appBarBack     = document.getElementById("app-bar-back");
const appBarSettings = document.getElementById("app-bar-settings");
const appBarIcon     = document.getElementById("app-bar-icon");
const appBarTitle    = document.getElementById("app-bar-title");
const appBarDesc     = document.getElementById("app-bar-desc");
const toolInputArea  = document.getElementById("tool-input-area");
const toolOutput     = document.getElementById("tool-output");
const styleOverride  = document.getElementById("tool-style-override");

// ════════════════════════════════════════════════════════
//  BOTÓN FÍSICO/GESTO DE "ATRÁS" DE ANDROID — Tauri ya trae un manejador
//  nativo (app.tauri.AppPlugin, ver mobile/android del crate "tauri"):
//  si el WebView tiene historial (WebView.canGoBack()) hace
//  WebView.goBack(); si no, deja que la Activity haga lo de siempre
//  (minimizar/cerrar). Antes de este cambio la app nunca tocaba
//  history.pushState, así que canGoBack() siempre daba false y "atrás"
//  cerraba la app de una, sin importar en qué pantalla estuviera el
//  usuario -- el bug reportado.
//
//  Solución: una pila de "handlers" de retroceso in-app. Cada vez que se
//  entra un nivel más adentro (lista -> herramienta, o una herramienta
//  entra a una sub-vista propia), se llama pushBack(handler) -- eso
//  apila el handler Y empuja un estado en el historial del navegador.
//  goBack() (la flecha en pantalla) NUNCA llama al handler directo: solo
//  pide history.back(), que WebView.goBack() también dispara -- así hay
//  un solo camino real de "retroceder" sin importar si lo disparó el
//  dedo del usuario tocando la flecha o el botón físico del teléfono.
//  popstate (que dispara en ambos casos) es quien finalmente desapila y
//  ejecuta el handler.
// ════════════════════════════════════════════════════════
const backStack = [];

function pushBack(handler) {
    backStack.push(handler);
    history.pushState({ depth: backStack.length }, "");
}

function popBack() {
    const handler = backStack.pop();
    if (handler) handler();
}

window.addEventListener("popstate", popBack);

// ════════════════════════════════════════════════════════
//  HERRAMIENTAS PERSISTENTES — igual que en escritorio: una herramienta
//  con "persistent": true en su tool.json recibe un contenedor propio que
//  nunca se destruye al salir de ella, solo se oculta (para que una
//  sincronización o descarga en curso siga viva de fondo aunque el
//  usuario vuelva a la lista).
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
    // pushBack: para que una herramienta con sub-vistas propias (ej. un
    // lector con lista de archivos + vista de lectura) se sume al mismo
    // mecanismo de "atrás" físico -- ver la pila de arriba. Su botón "←
    // Lista" propio debe llamar a history.back() en vez de cerrar la
    // sub-vista directo, igual que hace acá el botón de la app-bar.
    pushBack,
    // pickFolder: abre el selector de carpeta nativo de Android y
    // devuelve la ruta elegida (o null si el usuario canceló, o si la
    // carpeta elegida no se pudo resolver a una ruta cruda -- ver
    // MainActivity.kt). Pedido explícito del usuario: elegir carpetas
    // desde un picker nativo en vez de escribir la ruta a mano.
    pickFolder,
    checkPendingFolderPick,
    get activeTool()    { return activeTool; },
    get toolOutput()    { return toolOutput; },
    get toolInputArea() { return toolInputArea; },
};

// NUEVO -- bug real confirmado en vivo: abrir el picker nativo de
// carpetas (una Activity/proceso aparte, DocumentsUI) puede hacer que
// Android mate el proceso de esta app en segundo plano mientras el
// picker está al frente (memoria) -- el polling de acá abajo se corta
// junto con el resto del JS cuando eso pasa, aunque el resultado SÍ le
// llegó al lado Kotlin. Por eso "key" identifica para qué configuración
// era el pedido: quien use pickFolder() no debería asumir que esta
// promesa siempre resuelve -- ver checkPendingFolderPick(), que revisa
// (sin haber pedido nada) si quedó un resultado pendiente de una sesión
// anterior, para las pantallas que muestren configuraciones de carpeta.
async function pickFolder(key) {
    try { await invoke("pick_folder_start", { key }); } catch (e) { return null; }
    // Polling simple: el usuario puede tardar bastante navegando el
    // picker del sistema, así que se espera hasta 3 minutos antes de
    // rendirse (no debería pasar en un uso normal).
    for (let i = 0; i < 900; i++) {
        await new Promise(r => setTimeout(r, 200));
        const res = await checkPendingFolderPick();
        if (res) return res.path || null;
    }
    return null;
}

// Consulta si quedó un resultado de selector de carpeta pendiente --
// tanto para el polling normal de pickFolder() como para revisarlo de
// entrada al abrir una pantalla con configuraciones de carpeta (cubre el
// caso del proceso reiniciado a mitad del picker, ver nota arriba).
// Devuelve null si no hay nada listo todavía.
async function checkPendingFolderPick() {
    try {
        const res = await invoke("pick_folder_poll");
        return res && res.ready ? res : null;
    } catch (e) {
        return null;
    }
}

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
    await listen("tool-output", onToolOutput);
    await listen("tool-done", onToolDone);

    renderToolList();
    showList();

    await checkDeepLinks();
}

// ════════════════════════════════════════════════════════
//  DEEP LINKS — mecanismo genérico para "esta app se abrió (o se retomó)
//  por un motivo externo, entrá directo a tal herramienta en vez de
//  mostrar la lista". Cualquier renderer puede sumarse definiendo
//  checkDeepLink(): una función async que revisa si hay algo pendiente
//  para SU herramienta (ej. una URI que llegó por "Abrir con...") y
//  devuelve true si lo consumió y quiere que se navegue a ella.
//
// NUEVO (revisión de código): esto reemplaza una versión anterior
// hardcodeada solo para Lector de PDF (tools.find(t => t.input ===
// "lectorpdf") + un global window._pendingPdfUri armado a mano acá
// mismo) -- cualquier herramienta futura que necesite este mismo patrón
// (ej. otro manejador de archivos por defecto) solo necesita definir su
// propio checkDeepLink() en su ui.js, sin tocar main.js.
//
// Se llama tanto desde init() (app recién abierta, "cold start") como
// desde el listener de visibilitychange más abajo (app YA corriendo en
// segundo plano y retomada vía onNewIntent -- launchMode="singleTask"
// reusa la Activity, lo cual en Android dispara un ciclo hidden->visible
// del WebView pero NO pasa de nuevo por init()). Sin ese segundo
// enganche, "Abrir con..." con la app ya abierta quedaba pendiente hasta
// que el usuario entrara a mano a la herramienta correspondiente.
async function checkDeepLinks() {
    for (const tool of tools) {
        const r = getRenderer(tool.input);
        if (!r?.checkDeepLink) continue;
        try {
            if (await r.checkDeepLink()) { await selectTool(tool); return; }
        } catch (e) { /* no-op -- este renderer no tenía nada pendiente */ }
    }
}

// ── Pantalla de inicio: lista de herramientas ───────────
// NUEVO: Settings ya no aparece como una fila más de la lista -- vive
// como el ícono de tuerca de la app-bar (ver appBarSettings más arriba).
function visibleTools() {
    return tools.filter(t => t.input !== "settings");
}

function renderToolList() {
    toolListEl.innerHTML = "";
    const list = visibleTools();
    if (!list.length) {
        toolListEl.appendChild(el("p", { className: "tool-list-empty", textContent: "Sin herramientas todavía" }));
        return;
    }
    list.forEach(tool => {
        const item = el("button", { className: "tool-list-item", type: "button" });
        item.innerHTML = `
            ${window.AlejoIcons ? window.AlejoIcons.toolBadge(tool.input, 44) : ""}
            <div class="tool-list-item-text">
                <div class="tool-list-item-name">${tool.name}</div>
                <div class="tool-list-item-desc">${tool.description || ""}</div>
            </div>
            <span class="tool-list-item-chevron">${window.AlejoIcons ? window.AlejoIcons.glyph("chevronRight", 20) : ""}</span>
        `;
        item.onclick = () => selectTool(tool);
        toolListEl.appendChild(item);
    });
}

// ── Navegación entre lista y herramienta ────────────────
function showList() {
    toolListEl.classList.remove("hidden");
    toolView.classList.add("hidden");
    appBarBack.classList.add("hidden");
    appBarSettings.classList.remove("hidden");
    appBar.classList.remove("app-bar--tool");
    appBarIcon.innerHTML = "";
    appBarTitle.textContent = "Alejo Tools";
    appBarDesc.textContent = "";
    styleOverride.textContent = "";
}

function showToolView() {
    toolListEl.classList.add("hidden");
    toolView.classList.remove("hidden");
    appBarBack.classList.remove("hidden");
    appBarSettings.classList.add("hidden");
    appBar.classList.add("app-bar--tool");
}

async function deactivateCurrentTool() {
    if (!activeTool) return;
    if (!activeTool.persistent) {
        const prev = getRenderer(activeTool.input);
        if (prev?.onLeave) prev.onLeave();
        try { await Promise.race([invoke("kill_tool", { toolId: activeTool.id }), new Promise(r => setTimeout(r, 300))]); } catch (e) {}
    } else {
        const entry = persistentTools[activeTool.id];
        if (entry) entry.el.style.display = "none";
    }
}

async function goBackToList() {
    await deactivateCurrentTool();
    activeTool = null;
    isRunning = false;
    showList();
}
// NUEVO: la flecha en pantalla ya no llama a la lógica de volver
// directo -- pide history.back(), que dispara popstate igual que el
// botón físico de Android, y es popBack() quien de verdad ejecuta
// goBackToList() (ver la pila de handlers más arriba). Un solo camino
// para ambos disparadores.
appBarBack.onclick = () => history.back();

appBarSettings.onclick = () => {
    const settingsTool = tools.find(t => t.input === "settings");
    if (settingsTool) selectTool(settingsTool);
};

async function selectTool(tool) {
    if (activeTool?.id === tool.id) return;
    const cameFromList = !activeTool;
    await deactivateCurrentTool();

    activeTool = tool; isRunning = false;
    showToolView();
    // Un nivel más adentro que la lista -- si el usuario (o el botón
    // físico) aprieta "atrás" ahora, tiene que volver a la lista.
    if (cameFromList) pushBack(goBackToList);

    appBarIcon.innerHTML = window.AlejoIcons ? window.AlejoIcons.toolBadge(tool.input, 32) : "";
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
function defaultDone(label) { return (code, out) => { appendSeparator(out); appendLine(out, code === 0 ? "Completado" : `Código ${code}`, code === 0 ? "success" : "error"); resetBtn(label); }; }

document.addEventListener("contextmenu", e => e.preventDefault());

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkDeepLinks();
});

window.addEventListener("DOMContentLoaded", init);
