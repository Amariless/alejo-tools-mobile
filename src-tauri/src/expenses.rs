// expenses.rs — Gastos (mobile).
//
// Sin precedente en el escritorio -- herramienta nueva, pedida como
// "rastreador de gastos mensuales con todo lo que se te ocurra". Alcance
// de esta primera versión: cargar gastos (monto, categoría, nota, fecha),
// verlos agrupados por mes con navegación entre meses, y un resumen por
// categoría. Mismo patrón de persistencia que el resto de la app (JSON en
// app_data_dir, ver syncthing.rs/pomodoro.rs/notes.rs) -- un solo archivo
// con la lista completa de gastos más el símbolo de moneda elegido, no
// hace falta una base de datos real para el volumen de datos de un uso
// personal.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Expense {
    pub id: String,
    pub amount: f64,
    pub category: String,
    pub note: String,
    /// "YYYY-MM-DD" -- string simple en vez de un tipo de fecha real: no
    /// hace falta más que eso para agrupar por mes y ordenar, y evita
    /// problemas de zona horaria (Rust/Android UTC vs. hora local del
    /// usuario) que sí importarían con un timestamp.
    pub date: String,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExpensesData {
    pub currency_symbol: String,
    pub items: Vec<Expense>,
}

impl Default for ExpensesData {
    fn default() -> Self {
        Self { currency_symbol: "$".to_string(), items: Vec::new() }
    }
}

fn data_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("expenses.json"))
}

fn read_all(app: &AppHandle) -> Result<ExpensesData, String> {
    let path = data_path(app)?;
    Ok(std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default())
}

fn write_all(app: &AppHandle, data: &ExpensesData) -> Result<(), String> {
    let path = data_path(app)?;
    let s = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| e.to_string())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn next_id() -> String {
    static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    format!("{:x}-{:x}", now_millis(), COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed))
}

#[tauri::command]
pub fn expenses_list(app: AppHandle) -> Result<ExpensesData, String> {
    let mut data = read_all(&app)?;
    data.items.sort_by(|a, b| b.date.cmp(&a.date).then_with(|| b.created_at.cmp(&a.created_at)));
    Ok(data)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn expenses_save(
    app: AppHandle,
    id: Option<String>,
    amount: f64,
    category: String,
    note: String,
    date: String,
) -> Result<Expense, String> {
    if !amount.is_finite() || amount <= 0.0 {
        return Err("El monto tiene que ser un número mayor que cero.".to_string());
    }
    let mut data = read_all(&app)?;
    let expense = if let Some(id) = id.filter(|id| !id.is_empty()) {
        if let Some(existing) = data.items.iter_mut().find(|e| e.id == id) {
            existing.amount = amount;
            existing.category = category;
            existing.note = note;
            existing.date = date;
            existing.clone()
        } else {
            let e = Expense { id, amount, category, note, date, created_at: now_millis() };
            data.items.push(e.clone());
            e
        }
    } else {
        let e = Expense { id: next_id(), amount, category, note, date, created_at: now_millis() };
        data.items.push(e.clone());
        e
    };
    write_all(&app, &data)?;
    Ok(expense)
}

#[tauri::command]
pub fn expenses_delete(app: AppHandle, id: String) -> Result<(), String> {
    let mut data = read_all(&app)?;
    data.items.retain(|e| e.id != id);
    write_all(&app, &data)
}

#[tauri::command]
pub fn expenses_set_currency(app: AppHandle, symbol: String) -> Result<(), String> {
    let mut data = read_all(&app)?;
    data.currency_symbol = if symbol.trim().is_empty() { "$".to_string() } else { symbol.trim().to_string() };
    write_all(&app, &data)
}
