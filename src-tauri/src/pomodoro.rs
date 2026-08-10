// pomodoro.rs — Pomodoro (mobile).
//
// A diferencia del "Reloj" de escritorio (alejo-tools/src-tauri/tools/Reloj,
// ~1700 líneas: Pomodoro + cronómetro + temporizador + alarmas con sonidos
// propios + clima), acá se porta específicamente lo que se pidió: el
// Pomodoro. El resto del conteo (arrancar/pausar/avanzar de fase) vive
// entero en JS (tools/Pomodoro/ui.js) -- no hace falta que Rust sepa nada
// de tiempo real, solo persiste la configuración (duración de cada fase,
// etc.) para que sobreviva a cerrar la app, mismo patrón que
// sync_get_config/sync_set_config de syncthing.rs.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroConfig {
    pub work_minutes: u32,
    pub short_break_minutes: u32,
    pub long_break_minutes: u32,
    pub long_break_interval: u32,
    pub auto_start: bool,
    pub sound_enabled: bool,
}

impl Default for PomodoroConfig {
    fn default() -> Self {
        // Mismos valores por defecto que pomodoro_config.json de escritorio.
        Self {
            work_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            long_break_interval: 4,
            auto_start: true,
            sound_enabled: true,
        }
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("pomodoro_config.json"))
}

#[tauri::command]
pub fn pomodoro_get_config(app: AppHandle) -> PomodoroConfig {
    let Ok(path) = config_path(&app) else { return PomodoroConfig::default() };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn pomodoro_set_config(app: AppHandle, config: PomodoroConfig) -> Result<(), String> {
    let path = config_path(&app)?;
    let s = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| e.to_string())
}
