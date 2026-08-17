// icons.js — set de íconos SVG propios de la app (sin emoji, ver pedido
// del usuario). Cada herramienta tiene un color sólido asignado; el
// ícono en sí es un trazo blanco simple sobre una "badge" redondeada de
// ese color (mismo patrón que iOS Settings/Shortcuts) -- se ve mucho más
// prolijo y consistente que tratar de hacer cada glifo multicolor, y
// sigue leyéndose como "con color" porque el conjunto entero es un
// mosaico de colores distintos, no íconos negros sueltos.
//
// Los paths son dibujados a mano (formas simples/genéricas: nota
// musical, reloj, engranaje, etc.) para no depender de ninguna librería
// de íconos de terceros ni de descargar assets de internet -- los únicos
// íconos "sacados de internet" que pidió el usuario son los del modo de
// lectura (ver LectorDocs/icons.js), esos sí son SVGs curados a mano
// pero con más detalle porque van sueltos (sin badge de color atrás).

const TOOL_ICON_COLORS = {
    syncmanager:      "#3b82f6", // azul
    descargarmusica:  "#ec4899", // rosa
    reloj:            "#f59e0b", // ámbar
    ideasrapidas:     "#eab308", // amarillo
    gastos:           "#22c55e", // verde
    paletacolores:    "#a855f7", // violeta
    creadortexturas:  "#f97316", // naranja
    scene:            "#6366f1", // índigo
    lectordocs:       "#0ea5e9", // celeste
    settings:         "#64748b", // gris pizarra
};

function iconColor(toolInput) {
    return TOOL_ICON_COLORS[toolInput] || "#64748b";
}

// Paths a trazo simple, viewBox 0 0 24 24, pensados para ir en blanco
// (currentColor) centrados dentro de una badge de color sólido.
const GLYPHS = {
    sync: `<path d="M4 12a8 8 0 0 1 13.66-5.66M20 12a8 8 0 0 1-13.66 5.66" stroke="white" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M17.5 3v4h-4M6.5 21v-4h4" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    music: `<circle cx="7" cy="18" r="3" fill="white"/><circle cx="18" cy="16" r="3" fill="white"/><path d="M10 18V5.5L21 4v11.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    clock: `<circle cx="12" cy="12" r="8.5" stroke="white" stroke-width="2" fill="none"/><path d="M12 7.5V12l3 2" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    note: `<path d="M6 3h9l4 4v14H6z" stroke="white" stroke-width="2" stroke-linejoin="round" fill="none"/><path d="M14.5 3v4.5H19" stroke="white" stroke-width="2" stroke-linejoin="round" fill="none"/><path d="M9 12.5h6M9 16h6" stroke="white" stroke-width="1.8" stroke-linecap="round"/>`,
    money: `<rect x="3" y="7" width="18" height="12" rx="2.5" stroke="white" stroke-width="2" fill="none"/><circle cx="12" cy="13" r="2.6" stroke="white" stroke-width="1.8" fill="none"/><path d="M3 10h3M18 16h3" stroke="white" stroke-width="1.8" stroke-linecap="round"/>`,
    palette: `<path d="M12 3.5a8.5 8 0 1 0 0 16c1.1 0 2-.82 2-1.9 0-.5-.2-.96-.53-1.3-.32-.35-.52-.8-.52-1.3 0-1.08.9-1.9 2-1.9H16.5c2.2 0 4-1.7 4-4C20.5 6 16.7 3.5 12 3.5Z" stroke="white" stroke-width="1.8" fill="none"/><circle cx="7.3" cy="10.5" r="1.15" fill="white"/><circle cx="9.8" cy="7" r="1.15" fill="white"/><circle cx="14.7" cy="7" r="1.15" fill="white"/><circle cx="17" cy="10.7" r="1.15" fill="white"/>`,
    bricks: `<rect x="3" y="4" width="8" height="5" stroke="white" stroke-width="1.7" fill="none"/><rect x="11" y="4" width="10" height="5" stroke="white" stroke-width="1.7" fill="none"/><rect x="3" y="9.5" width="6" height="5" stroke="white" stroke-width="1.7" fill="none"/><rect x="9" y="9.5" width="8" height="5" stroke="white" stroke-width="1.7" fill="none"/><rect x="17" y="9.5" width="4" height="5" stroke="white" stroke-width="1.7" fill="none"/><rect x="3" y="15" width="9" height="5" stroke="white" stroke-width="1.7" fill="none"/><rect x="12" y="15" width="9" height="5" stroke="white" stroke-width="1.7" fill="none"/>`,
    clapper: `<rect x="3.5" y="10.5" width="17" height="9" rx="1.2" stroke="white" stroke-width="1.8" fill="none"/><path d="M3.5 10.5 4.2 6.3a1 1 0 0 1 1.15-.82l14.1 2.35a1 1 0 0 1 .83 1.14l-.5 3z" stroke="white" stroke-width="1.8" stroke-linejoin="round" fill="none"/><path d="m7.3 6 2.2 4M12.7 6.9l2.2 4" stroke="white" stroke-width="1.5"/>`,
    doc: `<path d="M6.5 2.5h8l4 4v14.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" stroke="white" stroke-width="1.8" stroke-linejoin="round" fill="none"/><path d="M14 2.5V7h4.3" stroke="white" stroke-width="1.8" stroke-linejoin="round" fill="none"/><path d="M8.3 12h7.2M8.3 15.2h7.2M8.3 18.4h4.5" stroke="white" stroke-width="1.6" stroke-linecap="round"/>`,
    gear: `<circle cx="12" cy="12" r="3.1" stroke="white" stroke-width="1.8" fill="none"/><path d="M12 3.5v2.3M12 18.2v2.3M20.5 12h-2.3M5.8 12H3.5M17.8 6.2l-1.6 1.6M7.8 16.2l-1.6 1.6M17.8 17.8l-1.6-1.6M7.8 7.8 6.2 6.2" stroke="white" stroke-width="1.8" stroke-linecap="round"/>`,
    chevronLeft: `<path d="M14.5 5 8 12l6.5 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    chevronRight: `<path d="M9.5 5 16 12l-6.5 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    close: `<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
    dots: `<circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/>`,
    folder: `<path d="M3.5 6.2a1 1 0 0 1 1-1H10l1.8 2.1h7.7a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>`,
    trash: `<path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l.8 12.2a1 1 0 0 0 1 .8h7.4a1 1 0 0 0 1-.8L17.5 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M10 10.5v6M14 10.5v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
    alert: `<path d="M12 3.5 2.5 20h19z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/><path d="M12 9.5v4.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="17" r="1.05" fill="currentColor"/>`,
    copy: `<rect x="8.3" y="8.3" width="12.2" height="12.2" rx="1.8" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M15.7 8.3V5.5a1.8 1.8 0 0 0-1.8-1.8H5.5a1.8 1.8 0 0 0-1.8 1.8v8.4a1.8 1.8 0 0 0 1.8 1.8h2.8" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" fill="none"/>`,
    edit: `<path d="M4 20l.9-4L16 4.9a1.8 1.8 0 0 1 2.5 0l.6.6a1.8 1.8 0 0 1 0 2.5L8 19.1z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/><path d="M14.3 6.6l3.1 3.1" stroke="currentColor" stroke-width="1.8"/>`,
    info: `<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 11v5.3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="8" r="1.05" fill="currentColor"/>`,
    // Clima (Reloj -- pestaña "Clima"): dibujados a mano como el resto del
    // set, sin depender de ningún ícono bajado de internet -- a diferencia
    // de los íconos de modo de lectura (ver LectorDocs/icons.js), estos no
    // necesitan más detalle que un pictograma simple.
    wxSun: `<circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 17.2l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 6.8 5.6 5.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
    wxCloud: `<path d="M7 18.5a4.2 4.2 0 0 1-.6-8.36 5.4 5.4 0 0 1 10.4-1.9A4.35 4.35 0 0 1 17.5 18.5H7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>`,
    wxCloudSun: `<circle cx="8.6" cy="7.4" r="2.7" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M8.6 3.3v1.3M8.6 12.2v.5M13 7.4h-1.3M4.6 7.4h-.9M11.5 4.5l-.9.9M6.5 9.3l-.9.9M11.5 10.3l-.9-.9M6.5 5.5l-.9-.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M9.5 19.5a4 4 0 0 1-.5-7.97 5.1 5.1 0 0 1 9.83-1.53A4.1 4.1 0 0 1 18.5 19.5h-9Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>`,
    wxFog: `<path d="M6.5 14.5a3.6 3.6 0 0 1-.4-7.18A4.6 4.6 0 0 1 15 5.65 3.7 3.7 0 0 1 16 13" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/><path d="M4 16.5h16M4 19.5h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
    wxRain: `<path d="M7 13.5a4.2 4.2 0 0 1-.6-8.36 5.4 5.4 0 0 1 10.4-1.9A4.35 4.35 0 0 1 17.5 13.5H7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/><path d="M8.5 16.5 7.2 19.8M13 16.5l-1.3 3.3M17.5 16.5l-1.3 3.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
    wxSnow: `<path d="M7 13.5a4.2 4.2 0 0 1-.6-8.36 5.4 5.4 0 0 1 10.4-1.9A4.35 4.35 0 0 1 17.5 13.5H7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/><path d="M9 17v3.4M9 17l-1.6 1M9 17l1.6 1M9 20.4l-1.6-1M9 20.4l1.6-1M15 17v3.4M15 17l-1.6 1M15 17l1.6 1M15 20.4l-1.6-1M15 20.4l1.6-1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
    wxStorm: `<path d="M7 12.5a4.2 4.2 0 0 1-.6-8.36 5.4 5.4 0 0 1 10.4-1.9A4.35 4.35 0 0 1 17.5 12.5H7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/><path d="M13 14.5 10 19h3l-1.6 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    eye: `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" fill="none"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.7" fill="none"/>`,
    camera: `<rect x="3" y="7" width="18" height="13" rx="2.2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M8.3 7 9.6 4.6h4.8L15.7 7" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/><circle cx="12" cy="13.5" r="3.6" stroke="currentColor" stroke-width="1.8" fill="none"/>`,
    image: `<rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="8.3" cy="9.3" r="1.7" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M4 17.5 9 12l3.5 3.5L15.5 12 20 16.5" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" fill="none"/>`,
    check: `<path d="M4.5 12.5 9.5 17.5 19.5 6.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
};

/** SVG completo (sin badge) de un glifo -- currentColor, para usar suelto
 * (botones de barra, menús, etc.) en vez de dentro de una badge. */
function glyph(name, size = 22) {
    const inner = GLYPHS[name] || GLYPHS.dots;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

const TOOL_GLYPH = {
    syncmanager: "sync",
    descargarmusica: "music",
    reloj: "clock",
    ideasrapidas: "note",
    gastos: "money",
    paletacolores: "palette",
    creadortexturas: "bricks",
    scene: "clapper",
    lectordocs: "doc",
    settings: "gear",
};

/** Ícono "badge" de una herramienta: cuadrado redondeado de color sólido
 * (asignado por herramienta) con el glifo blanco centrado adentro. */
function toolBadge(toolInput, size = 40) {
    const color = iconColor(toolInput);
    const g = TOOL_GLYPH[toolInput] || "dots";
    const iconSize = Math.round(size * 0.56);
    return `<span class="tool-badge" style="width:${size}px;height:${size}px;background:${color}">${glyph(g, iconSize)}</span>`;
}

window.AlejoIcons = { glyph, toolBadge, iconColor, GLYPHS };
