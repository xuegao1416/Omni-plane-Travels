//! Mod system backend (Rust, Tauri v2).
//!
//! Implements module discovery / validation / storage / import-export /
//! enable-disable / registry + manifest validation + zip pack-unpack +
//! checksum. The rule engine itself runs in the frontend (pure TypeScript);
//! this backend never evaluates rules or executes player code.
//!
//! Layout:
//! - `error`    — unified `ModError` envelope
//! - `types`    — manifest + API response data types
//! - `registry` — in-memory `ModRegistry` (persisted to `registry.json`)
//! - `package`  — `.wtgmod` zip pack/unpack, zip-bomb + checksum guards
//! - `validator`— manifest structure / version / dependency / permission checks
//! - `commands` — the 10 Tauri commands

pub mod commands;
pub mod error;
pub mod package;
pub mod registry;
pub mod types;
pub mod validator;

use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager};

/// Application version, taken from `Cargo.toml` at compile time.
/// Used for `minAppVersion` compatibility checks.
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Payload broadcast to the frontend after any mutating Mod operation.
#[derive(Clone, Serialize)]
pub struct ModsChanged {
    pub id: Option<String>,
    pub action: String,
}

/// Emit `mods:changed` so the React UI re-renders. Emit failures are logged
/// but never fail the operation.
pub fn emit_mods_changed(app: &AppHandle, id: Option<&str>, action: &str) {
    let payload = ModsChanged {
        id: id.map(|s| s.to_string()),
        action: action.to_string(),
    };
    if let Err(e) = app.emit("mods:changed", payload) {
        log::warn!("emit mods:changed failed: {e}");
    }
}

// ---------------- Path helpers (always resolve via app_data_dir) ----------------

/// `{app_data_dir}/wtg/`
pub fn app_data_wtg(app: &AppHandle) -> Result<std::path::PathBuf, error::ModError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| error::ModError::io_error(e.to_string(), None))?;
    Ok(base.join("wtg"))
}

/// `{app_data_dir}/wtg/mods/`
pub fn mods_root(app: &AppHandle) -> Result<std::path::PathBuf, error::ModError> {
    Ok(app_data_wtg(app)?.join("mods"))
}

/// `{app_data_dir}/wtg/mods/<id>/`
pub fn mod_dir(app: &AppHandle, id: &str) -> Result<std::path::PathBuf, error::ModError> {
    Ok(mods_root(app)?.join(id))
}

/// `{app_data_dir}/wtg/registry.json`
pub fn registry_path(app: &AppHandle) -> Result<std::path::PathBuf, error::ModError> {
    Ok(app_data_wtg(app)?.join("registry.json"))
}

// ---------------- Small utilities ----------------

/// Current UTC time as an ISO-8601 string.
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Recursively sum the size (bytes) of all files under `path`.
pub fn dir_size(path: &Path) -> Result<u64, error::ModError> {
    let mut total: u64 = 0;
    let entries = std::fs::read_dir(path)?;
    for entry in entries {
        let entry = entry?;
        let ft = entry.file_type()?;
        if ft.is_dir() {
            total += dir_size(&entry.path())?;
        } else if ft.is_file() {
            total += entry.metadata()?.len();
        }
    }
    Ok(total)
}
