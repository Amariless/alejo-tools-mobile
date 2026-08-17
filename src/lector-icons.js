// lector-icons.js — íconos del modo de lectura de Lector de Documentos
// (orientación vertical/horizontal, modo página/scroll, índice).
//
// A diferencia de icons.js (el set general de la app, dibujado a mano),
// el usuario pidió explícitamente para ESTOS controles íconos "sacados de
// internet" -- son los de Lucide (https://lucide.dev, licencia ISC,
// permite embeber el SVG tal cual con la nota de licencia), bajados en su
// forma original con `curl` desde unpkg y pegados acá sin modificar el
// contenido del <path> (solo se le saca el <svg> exterior para poder
// reinyectar currentColor/tamaño al vuelo, igual que el resto de los
// glifos de la app).
const LECTOR_GLYPHS = {
    // lucide "rows-3" -- orientación vertical (páginas apiladas arriba/abajo)
    orientationVertical: `<rect width="18" height="18" x="3" y="3" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M21 9H3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M21 15H3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    // lucide "columns-3" -- orientación horizontal (páginas lado a lado)
    orientationHorizontal: `<rect width="18" height="18" x="3" y="3" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M9 3v18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M15 3v18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    // lucide "book-open" -- modo página (saltos paginados, como pasar hojas)
    modePaginated: `<path d="M12 5v16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    // lucide "scroll-text" -- modo scroll continuo
    modeContinuous: `<path d="M15 12h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M15 8h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 17V5a2 2 0 0 0-2-2H4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    // lucide "list" -- índice de capítulos (Lector de Libros)
    toc: `<path d="M3 5h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 19h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 5h13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 12h13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 19h13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
};

function lectorGlyph(name, size = 22) {
    const inner = LECTOR_GLYPHS[name] || "";
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

window.LectorIcons = { glyph: lectorGlyph };
