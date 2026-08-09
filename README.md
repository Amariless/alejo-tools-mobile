# Alejo Tools Mobile

App hermana de [alejo-tools](https://github.com/Amariless/alejo-tools) para
Android, hecha con Tauri 2. No es un port 1:1 del escritorio — cada
herramienta se adapta (o se reemplaza por un cliente de la app oficial
correspondiente) según lo que Android realmente permite a una app de
terceros. Ver el detalle de alcance y arquitectura en el plan de
implementación (`.claude/plans` de la sesión que arrancó este proyecto).

## Estado

- [x] Fase 0 — entorno Android (SDK, NDK, targets de Rust)
- [x] Fase 1 — esqueleto de la app (descubrimiento de herramientas, tema,
      navegación por pestañas)
- [ ] Fase 2 — SyncManager (cliente de Syncthing-Android)
- [ ] Fase 3 — Descargar Música (youtubedl-android)
- [ ] Fase 4 — auto-actualización vía GitHub Releases

## Desarrollo

```bash
npm install
npm run tauri android dev
```

## Arquitectura de herramientas

Igual que en el escritorio: cada carpeta en `src-tauri/tools/<Id>/` con un
`tool.json` es una herramienta. `ui.js` (opcional) se ejecuta con el mismo
contrato de funciones que usa el escritorio (`registerRenderer`, `invoke`,
`el`, `lbl`, `appendLine`, etc. — ver `src/main.js`), así que una
herramienta que ya vive del lado de escritorio necesita tocar lo mínimo
para correr acá. La diferencia real está del lado Rust: no hay sistema
genérico de "correr tool.py con Python" (ninguna herramienta de la v1 lo
necesita) y cualquier acceso a almacenamiento pasa por las APIs de Android,
no por rutas de archivo crudas.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
