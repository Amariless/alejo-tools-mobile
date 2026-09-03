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
// Navegación (rediseño por pilares, propuesta de diseño aprobada): la
// pantalla base ya no es una lista plana -- es un Hub en Bento grid
// (tarjetas en vivo para las herramientas persistentes, accesos directos
// para el resto) más un buscador universal, con una barra inferior de 4
// pilares (Favoritos, Conectividad, Productividad, Suite Creativa) que
// filtra a una lista de esa categoría. Cualquier herramienta se abre en
// como mucho 2 toques (tab + tarjeta) o 1 (buscador). Tocar una
// herramienta entra a pantalla completa con una flecha "←" arriba a la
// izquierda para volver -- eso no cambia.
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
// Guard de secuencia para selectTool(): navegar rápido entre herramientas
// puede disparar dos llamadas async en paralelo (cada una con sus propios
// await a invoke()) -- sin esto, la que termina después puede pisar el
// DOM/estado que ya dejó la más reciente. Cada selectTool() toma su propio
// número al entrar y, después de cada await, chequea si sigue siendo la
// navegación más reciente antes de seguir tocando DOM/estado global.
let navSeq = 0;

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

// ── Hub (pantalla base) — pedido del usuario: reemplaza la lista plana
// por un Dashboard en Bento grid con 4 pilares de navegación (Conectividad,
// Productividad, Suite Creativa, Favoritos/Hub) más un buscador universal.
// Ver la propuesta de diseño aprobada para el detalle de la arquitectura.
const hubView          = document.getElementById("hub-view");
const hubSearchIcon    = document.getElementById("hub-search-icon");
const hubSearchInput   = document.getElementById("hub-search");
const hubBento         = document.getElementById("hub-bento");
const hubSearchResults = document.getElementById("hub-search-results");
const categoryView     = document.getElementById("category-view");
const categoryTitleEl  = document.getElementById("category-title");
const categoryListEl   = document.getElementById("category-list");
const pillarTabbar     = document.getElementById("pillar-tabbar");
const pillarTabs       = Array.from(document.querySelectorAll(".pillar-tab"));

const PILLAR_INFO = {
    hub:     { label: "Favoritos",     glyph: "home" },
    connect: { label: "Conectividad",  glyph: "sync" },
    product: { label: "Productividad", glyph: "clock" },
    create:  { label: "Suite Creativa", glyph: "palette" },
};

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
    setChromeHidden,
    captureFullCamera,
    checkPendingCameraCapture,
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

// captureFullCamera: mismo mecanismo que pickFolder pero para abrir una
// pantalla de captura de foto (Creador de Texturas) en vez de la mini-UI
// reducida de <input capture=environment>. Devuelve la ruta del archivo
// capturado, o null si el usuario canceló / si el resultado nunca llegó.
//
// NUEVO -- del lado de Kotlin (camera_capture_start → MainActivity.
// launchMacroCamera) esto ahora abre MacroCameraActivity (cámara propia
// con CameraX + enfoque manual/modo macro) en vez de delegar a la app de
// cámara del sistema por intent -- ver el comentario grande en
// camera.rs para el porqué (bug real: en MIUI esa cámara se abría
// simplificada, sin selector de modos). Acá del lado JS no cambia nada,
// el contrato (key → poll → path) es el mismo.
//
// NUEVO (más viejo) -- bug real confirmado en vivo (mismo mecanismo que
// ya rompía el selector de carpeta, ver la nota grande más arriba): una
// Activity de cámara al frente es pesada en memoria, así que Android
// puede matar el proceso de esta app mientras está abierta -- confirmado
// viendo `pidof` dar vacío justo después de sacar una foto. El polling de
// acá abajo se corta junto con el resto del JS cuando eso pasa, aunque la
// foto SÍ se guardó y CameraCapture.kt SÍ tiene el resultado esperando --
// checkPendingCameraCapture(), como checkPendingFolderPick(), permite
// recuperarlo al volver a entrar a la herramienta en vez de perderlo.
async function captureFullCamera(key) {
    try { await invoke("camera_capture_start", { key }); } catch (e) { return null; }
    for (let i = 0; i < 300; i++) { // hasta 1 minuto
        await new Promise(r => setTimeout(r, 200));
        try {
            const res = await invoke("camera_capture_poll");
            if (res && res.ready) return res.path || null;
        } catch (e) { return null; }
    }
    return null;
}

// Consulta si quedó una foto pendiente de una captura de cámara que se
// cortó a mitad (ver la nota grande en captureFullCamera) -- mismo
// espíritu que checkPendingFolderPick(): quien la llame debe hacerlo no
// solo durante el polling normal, sino también al volver a entrar a la
// pantalla que la pidió, por si el proceso se reinició de por medio.
async function checkPendingCameraCapture() {
    try {
        const res = await invoke("camera_capture_poll");
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

    // NUEVO (Hub con tarjetas en vivo): las herramientas "persistent"
    // (Sincronización, Reloj) hoy recién montaban su render() la primera
    // vez que el usuario las abría a mano -- el Hub necesita poder leer su
    // estado (getWidgetSummary()) desde el arranque, así que se
    // pre-inicializan en frío, ocultas, apenas arranca la app.
    tools.filter(t => t.persistent && t.has_ui).forEach(tool => {
        const entry = getOrCreatePersistentContainer(tool);
        if (!entry.initialized) {
            entry.initialized = true;
            getRenderer(tool.input).render(tool, entry.el, toolOutput);
        }
    });

    initHub();
    showHub();

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

// ════════════════════════════════════════════════════════
//  HUB — Dashboard en Bento grid + navegación por pilares.
// ════════════════════════════════════════════════════════

// Pantalla "base" activa -- a dónde volver desde una herramienta
// (goBackToBase) y qué tab de la barra inferior queda resaltado. Cambiar
// de tab NO empuja al backStack (es navegación lateral entre pares, no
// "profundidad") -- mismo criterio que un bottom-nav nativo.
let currentBase = { view: "hub", pillar: null };

function normalize(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function pillarOf(tool) {
    return window.AlejoIcons ? window.AlejoIcons.TOOL_PILLAR[tool.input] : null;
}

// NUEVO: "create2" (Generador de Escenas -- generativo) es un matiz DENTRO
// del pilar Suite Creativa, no una quinta pestaña -- pedir la categoría
// "create" tiene que traer también las tools "create2" (mismo criterio
// que la propuesta de diseño aprobada: conviven en la misma lista, solo
// con un acento de ícono distinto).
function pillarTools(pillarKey) {
    return visibleTools().filter(t => {
        const p = pillarOf(t);
        return p === pillarKey || (pillarKey === "create" && p === "create2");
    });
}

function badgeEl(tool, size) {
    const b = el("div", { className: size === "list" ? "list-row-icon" : "hub-card-icon" });
    b.style.background = window.AlejoIcons ? window.AlejoIcons.iconColor(tool.input) : "#64748b";
    if (window.AlejoIcons) {
        const glyphSize = size === "list" ? 20 : 16;
        b.appendChild(document.createRange().createContextualFragment(window.AlejoIcons.glyph(TOOL_GLYPH_FALLBACK[tool.input] || "dots", glyphSize)));
    }
    return b;
}

// Mismo mapeo símbolo-por-herramienta que ya usa toolBadge() del lado de
// icons.js (TOOL_GLYPH ahí es privado al módulo) -- se repite acá porque
// hub-card-icon/list-row-icon usan su propio layout (círculo de color +
// glifo suelto), no el .tool-badge cuadrado redondeado original.
const TOOL_GLYPH_FALLBACK = {
    syncmanager: "sync", descargarmusica: "music", reloj: "clock",
    ideasrapidas: "note", gastos: "money", paletacolores: "palette",
    creadortexturas: "bricks", scene: "clapper", lectordocs: "doc", settings: "gear",
};

function buildListRow(tool) {
    const row = el("button", { className: "list-row", type: "button" });
    row.appendChild(badgeEl(tool, "list"));
    const text = el("div", { className: "list-row-text" });
    text.append(
        el("div", { className: "list-row-name", textContent: tool.name }),
        el("div", { className: "list-row-desc", textContent: tool.description || "" })
    );
    row.appendChild(text);
    const chev = el("span", { className: "list-row-chevron" });
    if (window.AlejoIcons) chev.appendChild(document.createRange().createContextualFragment(window.AlejoIcons.glyph("chevronRight", 18)));
    row.appendChild(chev);
    row.onclick = () => selectTool(tool);
    return row;
}

function renderRowList(container, list, emptyMsg) {
    container.innerHTML = "";
    if (!list.length) {
        container.appendChild(el("p", { className: "list-empty", textContent: emptyMsg }));
        return;
    }
    list.forEach(tool => container.appendChild(buildListRow(tool)));
}

// Tarjeta ancha "en vivo" para una herramienta persistente -- lee
// getWidgetSummary() del renderer si lo implementa (opcional en el
// contrato, ver Reloj/ui.js y SyncManager/ui.js). Si no hay resumen (la
// tool no lo implementa, o hoy no tiene nada que mostrar -- ej. Pomodoro
// parado), cae a una tarjeta compacta normal.
function buildWideCard(tool) {
    const r = getRenderer(tool.input);
    const summary = r?.getWidgetSummary ? r.getWidgetSummary() : null;
    if (!summary) return buildCompactCard(tool);

    const card = el("button", { className: "hub-card hub-card--wide", type: "button" });
    const main = el("div", { className: "hub-card-main" });
    main.appendChild(badgeEl(tool, "wide"));
    const text = el("div", { className: "hub-card-text" });
    text.append(
        el("div", { className: "hub-card-title", textContent: summary.title || tool.name }),
        el("div", { className: "hub-card-sub", textContent: summary.subtitle || "" })
    );
    main.appendChild(text);
    card.appendChild(main);
    if (typeof summary.progress === "number") {
        const ring = el("div", { className: "hub-card-ring" });
        ring.style.setProperty("--ring-pct", String(Math.min(100, Math.max(0, summary.progress * 100))));
        ring.style.setProperty("--ring-color", window.AlejoIcons ? window.AlejoIcons.iconColor(tool.input) : "");
        card.appendChild(ring);
    }
    card.onclick = () => selectTool(tool);
    return card;
}

function buildCompactCard(tool) {
    const card = el("button", { className: "hub-card", type: "button" });
    card.appendChild(badgeEl(tool, "compact"));
    card.appendChild(el("div", { className: "hub-card-title", textContent: tool.name }));
    card.onclick = () => selectTool(tool);
    return card;
}

function renderHub() {
    hubBento.innerHTML = "";
    const list = visibleTools();
    if (!list.length) {
        hubBento.appendChild(el("p", { className: "hub-empty", textContent: "Sin herramientas todavía" }));
        return;
    }
    const persistent = list.filter(t => t.persistent);
    const rest = list.filter(t => !t.persistent);

    if (persistent.length) {
        hubBento.appendChild(el("div", { className: "hub-section-lbl", textContent: "Favoritos" }));
        const wideGrid = el("div", { className: "hub-bento-grid" });
        persistent.forEach(t => wideGrid.appendChild(buildWideCard(t)));
        hubBento.appendChild(wideGrid);
    }
    if (rest.length) {
        hubBento.appendChild(el("div", { className: "hub-section-lbl", textContent: persistent.length ? "Todas las herramientas" : "Herramientas" }));
        const grid = el("div", { className: "hub-bento-grid" });
        rest.forEach(t => grid.appendChild(buildCompactCard(t)));
        hubBento.appendChild(grid);
    }
}

// Solo re-pinta las 2 tarjetas anchas (estado en vivo) -- evita rehacer
// todo el grid (y perder el foco del buscador si estuviera abierto) cada
// pocos segundos. Mismo criterio de "chequear visibilidad antes de
// trabajar" que ya se aplicó a los timers de Reloj/SyncManager.
function refreshHubWidgets() {
    if (hubView.classList.contains("hidden") || !hubSearchResults.classList.contains("hidden")) return;
    renderHub();
}
setInterval(refreshHubWidgets, 4000);

function renderCategoryList(pillarKey) {
    const info = PILLAR_INFO[pillarKey];
    categoryTitleEl.innerHTML = "";
    const icon = el("div", { className: "ct-icon" });
    icon.style.background = `var(--pillar-${pillarKey})`;
    if (window.AlejoIcons) icon.appendChild(document.createRange().createContextualFragment(window.AlejoIcons.glyph(info.glyph, 18)));
    const list = pillarTools(pillarKey);
    const textWrap = el("div", {});
    textWrap.append(
        el("div", { className: "ct-text-name", textContent: info.label }),
        el("div", { className: "ct-text-count", textContent: `${list.length} herramienta${list.length === 1 ? "" : "s"}` })
    );
    categoryTitleEl.append(icon, textWrap);
    renderRowList(categoryListEl, list, "Sin herramientas en esta categoría.");
}

function renderSearchResults(query) {
    const q = normalize(query);
    const list = visibleTools().filter(t => normalize(t.name).includes(q) || normalize(t.description).includes(q));
    renderRowList(hubSearchResults, list, "Sin resultados.");
}

function initHub() {
    hubSearchIcon.appendChild(document.createRange().createContextualFragment(window.AlejoIcons ? window.AlejoIcons.glyph("search", 18) : ""));
    pillarTabs.forEach(tab => {
        const pillar = tab.dataset.pillar;
        const info = PILLAR_INFO[pillar];
        tab.querySelector(".pt-ico").appendChild(document.createRange().createContextualFragment(window.AlejoIcons ? window.AlejoIcons.glyph(info.glyph, 22) : ""));
        tab.onclick = () => (pillar === "hub" ? showHub() : showCategory(pillar));
    });
    hubSearchInput.addEventListener("input", () => {
        const q = hubSearchInput.value.trim();
        if (!q) {
            hubBento.classList.remove("hidden");
            hubSearchResults.classList.add("hidden");
            return;
        }
        hubBento.classList.add("hidden");
        hubSearchResults.classList.remove("hidden");
        renderSearchResults(q);
    });
}

// NUEVO (Lector de Documentos -- lector "a pantalla completa", pedido del
// usuario): oculta/muestra la app-bar propia de la app entera mientras una
// herramienta muestra su propio contenido a pantalla completa con su
// propia barra flotante encima (que aparece/desaparece con un toque, ver
// LectorDocs/ui.js). showHub()/showCategory()/showToolView() la vuelven a mostrar
// siempre como red de seguridad -- así nunca queda escondida "para
// siempre" aunque una herramienta se salga de una vista fullscreen por un
// camino que no haya limpiado su propio estado.
function setChromeHidden(hidden) {
    appBar.classList.toggle("app-bar--hidden", hidden);
}

// ── Navegación: Hub / categoría de pilar / herramienta ──
function updateTabActive() {
    const active = currentBase.view === "hub" ? "hub" : currentBase.pillar;
    pillarTabs.forEach(tab => tab.classList.toggle("is-active", tab.dataset.pillar === active));
}

function showBaseChrome() {
    setChromeHidden(false);
    toolView.classList.add("hidden");
    appBarBack.classList.add("hidden");
    appBarSettings.classList.remove("hidden");
    appBar.classList.remove("app-bar--tool");
    appBarIcon.innerHTML = "";
    appBarTitle.textContent = "Alejo Tools";
    appBarDesc.textContent = "";
    styleOverride.textContent = "";
    pillarTabbar.classList.remove("hidden");
}

function showHub() {
    currentBase = { view: "hub", pillar: null };
    showBaseChrome();
    hubView.classList.remove("hidden");
    categoryView.classList.add("hidden");
    hubSearchInput.value = "";
    hubBento.classList.remove("hidden");
    hubSearchResults.classList.add("hidden");
    renderHub();
    updateTabActive();
}

// NUEVO (navegación por pilares, ≤2 toques): tocar un tab de la barra
// inferior filtra a las herramientas de ESE pilar -- es navegación
// lateral (como cambiar de tab), no "profundidad", así que no empuja al
// backStack (ver pushBack más arriba). Solo entrar a una herramienta
// desde acá sí empuja.
function showCategory(pillarKey) {
    currentBase = { view: "category", pillar: pillarKey };
    showBaseChrome();
    hubView.classList.add("hidden");
    categoryView.classList.remove("hidden");
    renderCategoryList(pillarKey);
    updateTabActive();
}

function showToolView() {
    setChromeHidden(false);
    hubView.classList.add("hidden");
    categoryView.classList.add("hidden");
    pillarTabbar.classList.add("hidden");
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

// Vuelve a la pantalla "base" desde la que se entró a la herramienta --
// el Hub, o la categoría de pilar si se entró desde ahí (currentBase no
// cambia mientras una herramienta está abierta, ver showHub/showCategory).
async function goBackToBase() {
    await deactivateCurrentTool();
    activeTool = null;
    isRunning = false;
    if (currentBase.view === "category" && currentBase.pillar) showCategory(currentBase.pillar);
    else showHub();
}
// NUEVO: la flecha en pantalla ya no llama a la lógica de volver
// directo -- pide history.back(), que dispara popstate igual que el
// botón físico de Android, y es popBack() quien de verdad ejecuta
// goBackToBase() (ver la pila de handlers más arriba). Un solo camino
// para ambos disparadores.
appBarBack.onclick = () => history.back();

appBarSettings.onclick = () => {
    const settingsTool = tools.find(t => t.input === "settings");
    if (settingsTool) selectTool(settingsTool);
};

async function selectTool(tool) {
    if (activeTool?.id === tool.id) return;
    const mySeq = ++navSeq;
    const cameFromBase = !activeTool;
    await deactivateCurrentTool();
    if (mySeq !== navSeq) return;

    activeTool = tool; isRunning = false;
    showToolView();
    // Un nivel más adentro que el Hub/categoría -- si el usuario (o el
    // botón físico) aprieta "atrás" ahora, tiene que volver a la base.
    if (cameFromBase) pushBack(goBackToBase);

    appBarIcon.innerHTML = window.AlejoIcons ? window.AlejoIcons.toolBadge(tool.input, 32) : "";
    appBarTitle.textContent = tool.name;
    appBarDesc.textContent = tool.description;
    styleOverride.textContent = tool.has_style ? await invoke("get_tool_style", { toolId: tool.id }) : "";
    if (mySeq !== navSeq) return;

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
        // NUEVO (bug real reportado por el usuario -- "muchas herramientas
        // quedaron con una caja gris abajo que no parece tener un
        // objetivo"): #tool-output es el panel de log estilo consola del
        // patrón viejo de escritorio (subprocesos vía runTool/appendLine,
        // ver más abajo) -- NINGUNA de las herramientas mobile actuales lo
        // usa (todas renderizan su UI propia entera dentro de
        // toolInputArea), así que quedaba SIEMPRE vacío pero igual visible
        // -- con el rediseño le dieron fondo/sombra/bordes redondeados
        // propios, y una caja vacía con esa pinta se ve como un elemento
        // roto en vez de simplemente invisible como antes. Ahora arranca
        // oculto y solo runTool() (el único lugar que le escribe algo, ver
        // más abajo) lo vuelve a mostrar -- si algún día una herramienta
        // vuelve a necesitar el patrón de log de subprocesos, sigue
        // funcionando igual.
        toolOutput.style.display = "none";
        toolOutput.innerHTML = ""; toolInputArea.innerHTML = "";
        toolInputArea.style.cssText = "";
        getRenderer(tool.input).render(tool, toolInputArea, toolOutput);
    }
}

async function runTool(tool, args) {
    if (isRunning) return; isRunning = true;
    toolOutput.style.display = ""; // ver nota en selectTool() -- solo se muestra si de verdad se usa
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
    // Si el evento es de una tool que ya no es la activa, no hay que tocar
    // el DOM de #tool-output (que pertenece a la tool activa ACTUAL) -- solo
    // avisarle al renderer sin pasarle el nodo de salida.
    if (activeTool?.id !== tool) { r.onDone(code, null); return; }
    if (code === -1 || code === 1) return;
    isRunning = false;
    r.onDone(code, toolOutput);
}

// ── Helpers ────────────────────────────────────────────
function el(tag, props = {}) { const e = document.createElement(tag); Object.assign(e, props); return e; }
// lbl(text, id): id opcional del input al que corresponde esta etiqueta --
// cuando se pasa, genera un <label for="id"> con asociación programática
// real (screen readers, tocar la etiqueta enfoca el input) en vez de un
// <div> suelto. Los call-sites que no pasan id siguen funcionando igual
// (label sin "for", mismo aspecto visual que antes).
function lbl(text, id) { return el("label", { className: "input-label", textContent: text, htmlFor: id || "" }); }
function classifyLine(l) { if (/✓|completad|listo|✅/i.test(l)) return "success"; if (/✗|error|fallo|❌/i.test(l)) return "error"; if (/warning|advertencia|⚠/i.test(l)) return "warning"; if (/^[\s═─=\-]{5,}/.test(l)) return "dim"; return ""; }
function appendLine(out, text, cls = "") { const s = el("span", { className: "out-line" + (cls ? ` ${cls}` : ""), textContent: text }); out.appendChild(s); out.scrollTop = out.scrollHeight; }
function appendSeparator(out) { out.appendChild(el("hr", { className: "out-separator" })); }
function resetBtn(label) { isRunning = false; const b = document.getElementById("run-btn"); if (b) { b.disabled = false; b.textContent = label; } }
function defaultOut(line, stream, out) { appendLine(out, line, stream === "stderr" ? "error" : classifyLine(line)); }
function defaultDone(label) { return (code, out) => { if (!out) return; appendSeparator(out); appendLine(out, code === 0 ? "Completado" : `Código ${code}`, code === 0 ? "success" : "error"); resetBtn(label); }; }

document.addEventListener("contextmenu", e => e.preventDefault());

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkDeepLinks();
});

window.addEventListener("DOMContentLoaded", init);
