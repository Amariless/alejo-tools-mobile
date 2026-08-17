// lib.rs — shell de Alejo Tools Mobile.
//
// Mismo patrón de descubrimiento de herramientas que la app de escritorio
// (alejo-tools/src-tauri/src/lib.rs): cada carpeta en tools/ con un
// tool.json válido es una herramienta; ui.js/style.css opcionales se leen
// tal cual y se mandan al frontend como texto plano (ver get_tool_ui /
// get_tool_style, y loadToolUi en src/main.js).
//
// DIFERENCIA real con el escritorio: tools/ NO se lee del disco en tiempo
// de ejecución. En Android, lo que tauri.conf.json empaqueta como
// "resources" queda dentro de assets/ del APK -- no es un filesystem
// normal, std::fs no puede leerlo ahí (solo el AssetManager de Android,
// vía JNI). En vez de escribir código de lectura distinto por plataforma,
// tools/ se embebe DENTRO DEL BINARIO en tiempo de compilación con
// rust-embed -- funciona idéntico en dev (Windows) y en el APK final. El
// costo es que un cambio en tools/ requiere recompilar, no hay "hot
// reload" editando archivos con la app corriendo -- aceptable acá porque,
// a diferencia del escritorio, ninguna herramienta de esta app depende de
// que el usuario edite tools/ a mano.
//
// A propósito NO se portó (no aplica en Android, o es exclusivo de
// Windows en el original): el sistema de "run_tool" que shellea tool.py
// con Python (ninguna herramienta de la v1 mobile lo necesita —
// SyncManager/Descargar Música son comandos Rust/plugin nativos propios,
// invocados directo desde cada ui.js), rfd (sin soporte mobile), bandeja
// del sistema, autostart, ventana sin bordes.
use std::collections::HashMap;
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};

mod downloader;
mod epub;
mod expenses;
mod folder_picker;
mod installer;
mod notes;
mod pdf;
mod pomodoro;
mod scene_prompts;
mod storage;
mod syncthing;
mod textures;
mod tls;
mod update;

#[derive(RustEmbed)]
#[folder = "tools/"]
struct ToolsAssets;

fn read_embedded(path: &str) -> Option<String> {
    ToolsAssets::get(path).and_then(|f| String::from_utf8(f.data.into_owned()).ok())
}

fn embedded_exists(path: &str) -> bool {
    ToolsAssets::get(path).is_some()
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ToolInfo {
    pub id:          String,
    pub name:        String,
    pub icon:        String,
    pub description: String,
    pub input:       String,
    pub has_style:   bool,
    pub has_ui:      bool,
    pub persistent:  bool,
}

#[tauri::command]
fn list_tools() -> Vec<ToolInfo> {
    let mut ids: Vec<String> = ToolsAssets::iter()
        .filter_map(|path| path.strip_suffix("/tool.json").map(|s| s.to_string()))
        .collect();
    ids.sort();
    ids.dedup();

    let mut tools = Vec::new();
    for id in ids {
        let Some(json_str) = read_embedded(&format!("{id}/tool.json")) else { continue };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&json_str) else { continue };

        tools.push(ToolInfo {
            has_style:   embedded_exists(&format!("{id}/style.css")),
            has_ui:      embedded_exists(&format!("{id}/ui.js")),
            name:        json["name"].as_str().unwrap_or("Sin nombre").to_string(),
            // NUEVO: el campo ya no se usa para nada visual -- el ícono de
            // cada herramienta ahora es un SVG con color asignado por
            // `input` (ver src/icons.js, pedido explícito del usuario de
            // no usar más emoji en la app). Se mantiene el campo en la
            // struct/JSON por compatibilidad con tool.json existentes,
            // pero vacío por default.
            icon:        json["icon"].as_str().unwrap_or("").to_string(),
            description: json["description"].as_str().unwrap_or("").to_string(),
            input:       json["input"].as_str().unwrap_or("text").to_string(),
            persistent:  json["persistent"].as_bool().unwrap_or(false),
            id,
        });
    }

    // Orden desde tools-order.json -- mismo formato que en escritorio
    // (números con gaps, "_always_last" para fijar una al final).
    let order_json: Option<serde_json::Value> = read_embedded("tools-order.json")
        .and_then(|s| serde_json::from_str(&s).ok());

    let order_map: HashMap<String, i64> = order_json
        .as_ref()
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .filter(|(k, _)| !k.starts_with('_'))
                .filter_map(|(k, v)| v.as_i64().map(|n| (k.clone(), n)))
                .collect()
        })
        .unwrap_or_default();

    let always_last = order_json
        .as_ref()
        .and_then(|v| v["_always_last"].as_str().map(|s| s.to_lowercase()))
        .unwrap_or_else(|| "settings".to_string());

    tools.sort_by(|a, b| {
        let a_last = a.id.to_lowercase() == always_last;
        let b_last = b.id.to_lowercase() == always_last;
        if a_last && !b_last { return std::cmp::Ordering::Greater; }
        if b_last && !a_last { return std::cmp::Ordering::Less; }
        match (order_map.get(&a.id), order_map.get(&b.id)) {
            (Some(oa), Some(ob)) if oa != ob => oa.cmp(ob),
            (Some(_), Some(_)) => a.name.cmp(&b.name),
            (Some(_), None)    => std::cmp::Ordering::Less,
            (None, Some(_))    => std::cmp::Ordering::Greater,
            (None, None)       => a.name.cmp(&b.name),
        }
    });
    tools
}

#[tauri::command]
fn get_tool_style(tool_id: String) -> String {
    read_embedded(&format!("{tool_id}/style.css")).unwrap_or_default()
}

#[tauri::command]
fn get_tool_ui(tool_id: String) -> String {
    read_embedded(&format!("{tool_id}/ui.js")).unwrap_or_default()
}

/// themes.css opcional (tools/Settings/themes.css) -- si todavía no existe
/// ninguna herramienta de Configuración portada, simplemente no hay nada
/// que aplicar y el frontend sigue con los valores por defecto de
/// styles.css (ver _applyTheme-equivalente ausente a propósito en esta
/// primera versión: todavía no hay selector de tema).
#[tauri::command]
fn get_themes_css() -> String {
    read_embedded("Settings/themes.css").unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_tools,
            get_tool_style,
            get_tool_ui,
            get_themes_css,
            // SyncManager (cliente de Syncthing-Android)
            syncthing::sync_get_config,
            syncthing::sync_set_config,
            syncthing::sync_status,
            syncthing::sync_get_folders,
            syncthing::sync_get_folder_status,
            syncthing::sync_set_folder_paused,
            syncthing::sync_rescan_folder,
            syncthing::sync_pending_folders,
            syncthing::sync_accept_pending_folder,
            syncthing::sync_dismiss_pending_folder,
            syncthing::sync_get_devices,
            syncthing::sync_connections,
            syncthing::sync_add_device,
            syncthing::sync_share_folder,
            syncthing::sync_my_id_qr,
            syncthing::sync_set_folder_type,
            syncthing::sync_list_conflicts,
            syncthing::sync_resolve_conflict,
            syncthing::sync_find_duplicate_files,
            syncthing::sync_delete_files,
            storage::sync_check_storage_permission,
            storage::sync_request_storage_permission,
            // Descargar Música (yt-dlp vía youtubedl-android)
            downloader::dl_fetch_info,
            downloader::dl_download,
            downloader::dl_get_config,
            downloader::dl_set_config,
            // Selector de carpeta nativo (Settings, y cualquier
            // herramienta que necesite elegir una carpeta)
            folder_picker::pick_folder_start,
            folder_picker::pick_folder_poll,
            // Pomodoro
            pomodoro::pomodoro_get_config,
            pomodoro::pomodoro_set_config,
            // Ideas rápidas
            notes::notes_list,
            notes::notes_save,
            notes::notes_delete,
            // Gastos
            expenses::expenses_list,
            expenses::expenses_save,
            expenses::expenses_delete,
            expenses::expenses_set_currency,
            // Creador de Texturas
            textures::save_texture_png,
            // Generador de Escenas
            scene_prompts::scene_prompts_list,
            scene_prompts::scene_prompts_save_all,
            // Lector de PDF
            pdf::pdf_get_config,
            pdf::pdf_set_config,
            pdf::pdf_list_folder,
            pdf::pdf_open,
            pdf::pdf_render_page,
            pdf::pdf_close,
            pdf::pdf_take_pending_uri,
            // Lector de Libros (EPUB)
            epub::book_get_config,
            epub::book_set_config,
            epub::book_list_folder,
            epub::book_open,
            epub::book_get_chapter,
            epub::book_close,
            epub::book_get_progress,
            epub::book_set_progress,
            // Auto-actualización por GitHub Releases
            update::check_for_update,
            update::download_and_install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
