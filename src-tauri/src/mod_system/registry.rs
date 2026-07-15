//! In-memory Mod registry, persisted to `{app_data_dir}/wtg/registry.json`.
//!
//! Safety note: this is plain data (enabled flags, metadata, dependency
//! graph). It never holds or executes any player code.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::AppHandle;

use crate::mod_system::error::ModError;
use crate::mod_system::types::ModRegistryEntry;

/// Shared, thread-safe registry. Wrapped in `Arc<Mutex<..>>` so it can be
/// stored via Tauri's `manage()` and accessed from any command.
#[derive(Default)]
pub struct ModRegistry {
    inner: Arc<Mutex<HashMap<String, ModRegistryEntry>>>,
}

impl ModRegistry {
    pub fn new() -> Self {
        ModRegistry {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Load persisted registry from disk (called once at startup).
    pub fn load(&self, app: &AppHandle) -> Result<(), ModError> {
        let path = crate::mod_system::registry_path(app)?;
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| ModError::io_error("registry lock poisoned", None))?;
        if path.exists() {
            let data = std::fs::read_to_string(&path)?;
            let map: HashMap<String, ModRegistryEntry> = serde_json::from_str(&data)?;
            *guard = map;
        }
        Ok(())
    }

    /// Persist the registry to disk.
    pub fn save(&self, app: &AppHandle) -> Result<(), ModError> {
        let path = crate::mod_system::registry_path(app)?;
        let guard = self
            .inner
            .lock()
            .map_err(|_| ModError::io_error("registry lock poisoned", None))?;
        let data = serde_json::to_string_pretty(&*guard)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, data)?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<ModRegistryEntry> {
        self.inner.lock().ok()?.get(id).cloned()
    }

    pub fn insert(&self, entry: ModRegistryEntry) {
        if let Ok(mut g) = self.inner.lock() {
            g.insert(entry.meta.id.clone(), entry);
        }
    }

    pub fn remove(&self, id: &str) -> Option<ModRegistryEntry> {
        self.inner.lock().ok()?.remove(id)
    }

    pub fn entries(&self) -> Vec<ModRegistryEntry> {
        self.inner
            .lock()
            .map(|g| g.values().cloned().collect())
            .unwrap_or_default()
    }

    pub fn contains(&self, id: &str) -> bool {
        self.inner
            .lock()
            .map(|g| g.contains_key(id))
            .unwrap_or(false)
    }

    pub fn is_enabled(&self, id: &str) -> bool {
        self.inner
            .lock()
            .ok()
            .and_then(|g| g.get(id).map(|e| e.enabled))
            .unwrap_or(false)
    }

    /// Flip the enabled flag, persist, and emit `mods:changed`.
    pub fn set_enabled(
        &self,
        app: &AppHandle,
        id: &str,
        enabled: bool,
        action: &str,
    ) -> Result<(), ModError> {
        let mut entry = self.get(id).ok_or_else(|| ModError::not_found(id))?;
        entry.enabled = enabled;
        entry.status = if enabled {
            "enabled".to_string()
        } else {
            "disabled".to_string()
        };
        entry.last_enabled_at = if enabled {
            Some(crate::mod_system::now_iso())
        } else {
            None
        };
        self.insert(entry);
        self.save(app)?;
        crate::mod_system::emit_mods_changed(app, Some(id), action);
        Ok(())
    }
}
