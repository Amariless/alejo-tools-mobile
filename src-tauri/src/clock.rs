// clock.rs — "Reloj" (mobile): Pomodoro + reloj mundial + clima.
//
// Nace como pomodoro.rs (ver ese historial) y se extiende acá con lo que
// pidió el usuario: reloj mundial y clima, más el renombre del tool en sí
// (tools/Pomodoro -> tools/Reloj, input "pomodoro" -> "reloj").
//
// El Pomodoro sigue siendo 100% client-side (ver ui.js) -- Rust solo
// persiste su configuración. El reloj mundial también es 100% client-side
// (Intl.DateTimeFormat con timeZone ya sabe convertir a cualquier huso
// horario sin pedirle nada a Rust) -- lo único que persiste acá es CUÁLES
// ciudades eligió el usuario, mismo patrón de archivo JSON en
// app_data_dir() que el resto de la app.
//
// El clima SÍ necesita Rust: es una llamada HTTPS a un servicio externo
// (Open-Meteo, sin API key -- a diferencia de OpenWeatherMap no hace falta
// registrar una cuenta ni vendorizar un secreto en el APK) y reqwest ya
// está configurado con el cliente TLS a mano de tls.rs (ver ese archivo:
// evita por completo rustls-platform-verifier). No se usa la ubicación
// real del dispositivo (evita pedir permiso de localización) -- el usuario
// elige una ciudad de la misma lista curada que usa el reloj mundial, cada
// una con lat/lon fijas del lado del frontend.
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

fn config_path(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(file))
}

#[tauri::command]
pub fn pomodoro_get_config(app: AppHandle) -> PomodoroConfig {
    let Ok(path) = config_path(&app, "pomodoro_config.json") else { return PomodoroConfig::default() };
    std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

#[tauri::command]
pub fn pomodoro_set_config(app: AppHandle, config: PomodoroConfig) -> Result<(), String> {
    let path = config_path(&app, "pomodoro_config.json")?;
    let s = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| e.to_string())
}

// ══════════════════════════════════════════════════════════════════════════
//  RELOJ MUNDIAL -- solo persiste la lista de ciudades elegidas (ids que
//  el frontend resuelve contra su propia tabla curada, ver Reloj/ui.js).
// ══════════════════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorldClockConfig {
    pub city_ids: Vec<String>,
}

#[tauri::command]
pub fn clock_get_worldclock_config(app: AppHandle) -> WorldClockConfig {
    let Ok(path) = config_path(&app, "worldclock_config.json") else { return WorldClockConfig::default() };
    std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

#[tauri::command]
pub fn clock_set_worldclock_config(app: AppHandle, config: WorldClockConfig) -> Result<(), String> {
    let path = config_path(&app, "worldclock_config.json")?;
    let s = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| e.to_string())
}

// ══════════════════════════════════════════════════════════════════════════
//  CLIMA -- Open-Meteo (https://open-meteo.com), sin API key. Solo se
//  persiste la última ciudad elegida; el clima en sí se pide fresco cada
//  vez que se abre la pestaña (ver clock_get_weather).
// ══════════════════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WeatherConfig {
    pub city_id: Option<String>,
}

#[tauri::command]
pub fn clock_get_weather_config(app: AppHandle) -> WeatherConfig {
    let Ok(path) = config_path(&app, "weather_config.json") else { return WeatherConfig::default() };
    std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

#[tauri::command]
pub fn clock_set_weather_config(app: AppHandle, config: WeatherConfig) -> Result<(), String> {
    let path = config_path(&app, "weather_config.json")?;
    let s = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherInfo {
    pub temperature_c: f64,
    pub apparent_c: f64,
    pub humidity: f64,
    pub wind_kmh: f64,
    pub weather_code: i64,
    pub is_day: bool,
}

/// lat/lon vienen de la tabla curada de ciudades del frontend -- nunca de
/// la ubicación real del dispositivo (así no hace falta pedir permiso de
/// localización para algo tan chico como mostrar el clima de una ciudad).
#[tauri::command]
pub async fn clock_get_weather(lat: f64, lon: f64) -> Result<WeatherInfo, String> {
    let client = crate::tls::client("AlejoToolsMobile-Weather/1.0", 15);
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day"
    );
    let resp = client.get(&url).send().await.map_err(|e| format!("No se pudo conectar con el servicio de clima: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("El servicio de clima respondió {}", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| format!("Respuesta inesperada del servicio de clima: {e}"))?;
    let current = json.get("current").ok_or("Respuesta sin datos actuales")?;
    Ok(WeatherInfo {
        temperature_c: current.get("temperature_2m").and_then(|v| v.as_f64()).unwrap_or(0.0),
        apparent_c: current.get("apparent_temperature").and_then(|v| v.as_f64()).unwrap_or(0.0),
        humidity: current.get("relative_humidity_2m").and_then(|v| v.as_f64()).unwrap_or(0.0),
        wind_kmh: current.get("wind_speed_10m").and_then(|v| v.as_f64()).unwrap_or(0.0),
        weather_code: current.get("weather_code").and_then(|v| v.as_i64()).unwrap_or(0),
        is_day: current.get("is_day").and_then(|v| v.as_i64()).unwrap_or(1) == 1,
    })
}
