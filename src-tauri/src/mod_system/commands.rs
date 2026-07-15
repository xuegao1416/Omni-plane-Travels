//! The 10 Mod-system Tauri commands.
//!
//! Command names match `docs/api-mod-system.md` exactly. Each returns
//! `Result<T, ModError>`; `ModError` is serialized into `error.message` so the
//! frontend `unwrapModError()` helper can reconstruct it.
//!
//! Per the architecture boundary, the rule engine is pure TypeScript in the
//! frontend: these commands only store/validate/register Mods and flip
//! enabled flags. They never evaluate rules or execute player code.

use std::path::PathBuf;
use std::sync::mpsc;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::mod_system::error::ModError;
use crate::mod_system::package;
use crate::mod_system::registry::ModRegistry;
use crate::mod_system::types::*;
use crate::mod_system::validator;
use crate::mod_system::{emit_mods_changed, mod_dir, mods_root, now_iso, dir_size};

// ===========================================================================
// 1. discover_mods
// ===========================================================================
#[tauri::command]
pub fn discover_mods(app: AppHandle) -> Result<Vec<ModMeta>, ModError> {
    let root = mods_root(&app)?;
    std::fs::create_dir_all(&root)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let dir = entry.path();
        let manifest_path = dir.join("manifest.json");
        if !manifest_path.is_file() {
            continue;
        }
        let data = match std::fs::read_to_string(&manifest_path) {
            Ok(d) => d,
            Err(_) => continue, // skip unreadable mods, don't poison discovery
        };
        let manifest: ModManifest = match serde_json::from_str(&data) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let disk_size = dir_size(&dir).unwrap_or(0);
        out.push(ModMeta::from_manifest(
            &manifest,
            Some(disk_size),
            Some(now_iso()),
        ));
    }
    Ok(out)
}

// ===========================================================================
// 2. list_mods
// ===========================================================================
#[tauri::command]
pub fn list_mods(state: State<'_, ModRegistry>) -> Result<Vec<ModRegistryEntry>, ModError> {
    Ok(state.entries())
}

// ===========================================================================
// 3. validate_mod  (never throws except on infrastructure errors)
// ===========================================================================
#[tauri::command]
pub fn validate_mod(
    manifest: ModManifest,
    assets: Option<Vec<AssetBytes>>,
    assets_root: Option<String>,
    state: State<'_, ModRegistry>,
) -> Result<ValidationResult, ModError> {
    let mut result = ValidationResult::default();

    // ① structure (missing fields are caught at deserialize -> handled by
    //    the caller for install; here they surface as SCHEMA where possible)
    for i in validator::validate_structure(&manifest) {
        result.errors.push(i);
    }

    // ② checksums (only when resources are supplied)
    if let Some(cs) = &manifest.checksum {
        let _ = cs; // presence gate
        if let Some(assets) = &assets {
            for i in validator::verify_assets_in_memory(&manifest, assets) {
                result.errors.push(i);
            }
        } else if let Some(root) = &assets_root {
            let root_path = PathBuf::from(root);
            if !root_path.is_absolute() {
                return Err(ModError::path_invalid(root));
            }
            for i in validator::verify_assets_on_disk(&manifest, &root_path)? {
                result.errors.push(i);
            }
        }
    }

    // ③ app version
    if let Err(e) = validator::verify_app_version(&manifest) {
        result.errors.push(ValidationIssue {
            code: "APP_VER".to_string(),
            field: None,
            message: e.message,
        });
    }

    // ④ dependencies
    for i in validator::check_dependencies(&manifest, &state) {
        result.errors.push(i);
    }

    // ⑤ conflicts
    let conflict_ids = validator::check_conflicts(&manifest, &state);
    if !conflict_ids.is_empty() {
        result.errors.push(ValidationIssue {
            code: "CONFLICT".to_string(),
            field: None,
            message: format!("与已启用模块冲突：{}", conflict_ids.join(", ")),
        });
    }

    // non-blocking warning: unsigned
    if manifest.signature.is_none() {
        result.warnings.push(ValidationIssue {
            code: "SCHEMA".to_string(),
            field: Some("signature".to_string()),
            message: "模块未签名（本期本地文件，信任用户自担）".to_string(),
        });
    }

    result.ok = result.errors.is_empty();
    Ok(result)
}

// ===========================================================================
// 4. install_mod
// ===========================================================================
#[tauri::command]
pub fn install_mod(
    path: String,
    app: AppHandle,
    state: State<'_, ModRegistry>,
) -> Result<ModMeta, ModError> {
    install_mod_impl(&path, &app, &state)
}

/// Shared install core used by both `install_mod` and `import_mod`.
fn install_mod_impl(
    path: &str,
    app: &AppHandle,
    state: &ModRegistry,
) -> Result<ModMeta, ModError> {
    let pkg_path = PathBuf::from(path);
    if !pkg_path.is_absolute() || !pkg_path.is_file() {
        return Err(ModError::path_invalid(path));
    }

    // Unpack with all zip-bomb / traversal guards.
    let files = package::read_archive(&pkg_path)?;

    // Manifest must be present at the archive root.
    let manifest_bytes = files
        .get("manifest.json")
        .ok_or_else(|| ModError::manifest_missing_field(&["manifest.json"]))?;
    let manifest: ModManifest =
        serde_json::from_slice(manifest_bytes).map_err(|e| validator::parse_manifest_err(&e))?;

    // Structural validation.
    let struct_issues = validator::validate_structure(&manifest);
    if !struct_issues.is_empty() {
        return Err(ModError::manifest_invalid(
            struct_issues
                .iter()
                .map(|i| i.message.clone())
                .collect::<Vec<_>>()
                .join("; "),
        ));
    }
    if !validator::is_valid_mod_id(&manifest.id) {
        return Err(ModError::manifest_invalid(format!(
            "id 格式非法：{}",
            manifest.id
        )));
    }

    // Already installed?
    let dir = mod_dir(app, &manifest.id)?;
    if dir.exists() || state.contains(&manifest.id) {
        return Err(ModError::already_installed(&manifest.id));
    }

    // App version + checksum.
    validator::verify_app_version(&manifest)?;
    validator::verify_install_checksums(&manifest, &files)?;

    // Write files to disk, then register (default disabled).
    std::fs::create_dir_all(&dir)?;
    package::write_mod_files(&dir, &files)?;

    let meta = ModMeta::from_manifest(&manifest, Some(dir_size(&dir).unwrap_or(0)), Some(now_iso()));
    let entry = ModRegistryEntry {
        meta: meta.clone(),
        enabled: false,
        status: "installed".to_string(),
        registered_at: now_iso(),
        last_enabled_at: None,
    };
    state.insert(entry);
    state.save(app)?;
    emit_mods_changed(app, Some(&manifest.id), "install");
    Ok(meta)
}

// ===========================================================================
// 5. uninstall_mod
// ===========================================================================
#[tauri::command]
pub fn uninstall_mod(
    id: String,
    app: AppHandle,
    state: State<'_, ModRegistry>,
) -> Result<(), ModError> {
    if !state.contains(&id) {
        return Err(ModError::not_found(&id));
    }
    // Disable first (record state; no engine side-effects in the backend).
    if state.is_enabled(&id) {
        state.set_enabled(&app, &id, false, "disable")?;
    }
    let dir = mod_dir(&app, &id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    state.remove(&id);
    state.save(&app)?;
    emit_mods_changed(&app, Some(&id), "uninstall");
    Ok(())
}

// ===========================================================================
// 6. enable_mod
// ===========================================================================
#[tauri::command]
pub fn enable_mod(
    id: String,
    app: AppHandle,
    state: State<'_, ModRegistry>,
) -> Result<(), ModError> {
    if !state.contains(&id) {
        return Err(ModError::not_found(&id));
    }
    let dir = mod_dir(&app, &id)?;
    let manifest_path = dir.join("manifest.json");
    let manifest: ModManifest = serde_json::from_str(&std::fs::read_to_string(&manifest_path)?)?;

    // Pre-checks: version, dependencies, conflicts, permissions.
    validator::verify_app_version(&manifest)?;

    let dep_issues = validator::check_dependencies(&manifest, &state);
    if !dep_issues.is_empty() {
        return Err(ModError::dependency_unsatisfied(serde_json::json!(
            dep_issues
                .iter()
                .map(|i| DepIssue {
                    id: i.field.clone().unwrap_or_default(),
                    satisfied: false,
                    reason: Some(i.message.clone()),
                    required_version: None,
                    actual_version: None,
                })
                .collect::<Vec<_>>()
        )));
    }

    let conflict_ids = validator::check_conflicts(&manifest, &state);
    if !conflict_ids.is_empty() {
        return Err(ModError::conflict_detected(&conflict_ids));
    }

    if let Some(perms) = &manifest.permissions {
        if let Some(missing) = validator::check_rule_permissions(&manifest, &dir, perms)? {
            return Err(ModError::permission_denied(&missing));
        }
    }

    // Record state + emit. The frontend RuleEngine/CardRegistry pick this up
    // on the `mods:changed` event and inject the actual rules/cards.
    state.set_enabled(&app, &id, true, "enable")?;
    Ok(())
}

// ===========================================================================
// 7. disable_mod
// ===========================================================================
#[tauri::command]
pub fn disable_mod(
    id: String,
    app: AppHandle,
    state: State<'_, ModRegistry>,
) -> Result<(), ModError> {
    if !state.contains(&id) {
        return Err(ModError::not_found(&id));
    }
    state.set_enabled(&app, &id, false, "disable")?;
    Ok(())
}

// ===========================================================================
// 8. import_mod  (optional path -> else native dialog)
// ===========================================================================
#[tauri::command]
pub fn import_mod(
    path: Option<String>,
    app: AppHandle,
    state: State<'_, ModRegistry>,
) -> Result<ModMeta, ModError> {
    let pkg = match path {
        Some(p) => p,
        None => match pick_wtgmod(&app)? {
            Some(p) => p.to_string_lossy().to_string(),
            None => return Err(ModError::import_cancelled()),
        },
    };
    install_mod_impl(&pkg, &app, &state)
}

// ===========================================================================
// 9. export_mod  (optional target -> else native save dialog)
// ===========================================================================
#[tauri::command]
pub fn export_mod(
    id: String,
    target: Option<String>,
    app: AppHandle,
    state: State<'_, ModRegistry>,
) -> Result<(), ModError> {
    if !state.contains(&id) {
        return Err(ModError::not_found(&id));
    }
    let dir = mod_dir(&app, &id)?;
    let manifest_path = dir.join("manifest.json");
    let manifest: ModManifest = serde_json::from_str(&std::fs::read_to_string(&manifest_path)?)?;

    let target_path = match target {
        Some(t) => {
            let p = PathBuf::from(&t);
            if !p.is_absolute() {
                return Err(ModError::path_invalid(&t));
            }
            p
        }
        None => {
            let default_name = format!("{}-{}.wtgmod", manifest.name, manifest.version);
            match save_wtgmod(&app, &default_name)? {
                Some(p) => p,
                None => return Err(ModError::import_cancelled()),
            }
        }
    };

    // Recompute checksums so the produced package is internally consistent.
    let updated = package::recompute_manifest_checksums(&manifest, &dir)?;
    package::pack_mod(&dir, &updated, &target_path)?;

    emit_mods_changed(&app, Some(&id), "export");
    Ok(())
}

// ===========================================================================
// 10. get_mod_detail
// ===========================================================================
#[tauri::command]
pub fn get_mod_detail(
    id: String,
    app: AppHandle,
    state: State<'_, ModRegistry>,
) -> Result<ModDetail, ModError> {
    let entry = state.get(&id).ok_or_else(|| ModError::not_found(&id))?;
    let dir = mod_dir(&app, &id)?;
    let manifest_path = dir.join("manifest.json");
    let manifest: ModManifest = serde_json::from_str(&std::fs::read_to_string(&manifest_path)?)?;

    let rules_path = manifest
        .rules
        .clone()
        .and_then(|r| r.first().cloned())
        .unwrap_or_else(|| "schema/rules.json".to_string());
    let cards_path = manifest
        .cards
        .clone()
        .and_then(|c| c.first().cloned())
        .unwrap_or_else(|| "schema/card.json".to_string());

    let rules_summary = parse_rules(&dir, &rules_path);
    let cards_summary = parse_cards(&dir, &cards_path);
    let worldbook_summary = parse_worldbook(&dir);

    let dependency_status = manifest
        .dependencies
        .clone()
        .unwrap_or_default()
        .iter()
        .map(|dep| {
            let installed = state.get(dep);
            let (satisfied, actual) = match &installed {
                Some(e) => (e.enabled, Some(e.meta.version.clone())),
                None => (false, None),
            };
            DepIssue {
                id: dep.clone(),
                satisfied,
                reason: if satisfied {
                    None
                } else if state.contains(dep) {
                    Some("依赖已安装但未启用".to_string())
                } else {
                    Some("依赖未安装".to_string())
                },
                required_version: None,
                actual_version: actual,
            }
        })
        .collect();

    let conflict_status = manifest
        .conflicts
        .clone()
        .unwrap_or_default()
        .iter()
        .map(|c| ConflictStatus {
            id: c.clone(),
            active: state.get(c).map(|e| e.enabled).unwrap_or(false),
        })
        .collect();

    let runtime_state = parse_runtime_state(&dir);

    Ok(ModDetail {
        meta: entry,
        manifest,
        rules_summary,
        cards_summary,
        worldbook_summary,
        dependency_status,
        conflict_status,
        runtime_state,
    })
}

// ===========================================================================
// Dialog helpers
// ===========================================================================

/// Open a native file picker filtered to `.wtgmod`. Blocks until the user
/// chooses a file or cancels. Returns `None` on cancel.
fn pick_wtgmod(app: &AppHandle) -> Result<Option<PathBuf>, ModError> {
    let (tx, rx) = mpsc::channel();
    app.dialog()
        .file()
        .add_filter("WTG Mod", &["wtgmod"])
        .pick_file(move |p: Option<FilePath>| {
            let _ = tx.send(p);
        });
    match rx.recv().ok().flatten() {
        Some(FilePath::Path(p)) => Ok(Some(p)),
        Some(FilePath::Url(_)) => Err(ModError::path_invalid("不支持的 URL 路径")),
        None => Ok(None),
    }
}

/// Open a native save dialog with a default file name. Blocks until the user
/// confirms or cancels. Returns `None` on cancel.
fn save_wtgmod(app: &AppHandle, default_name: &str) -> Result<Option<PathBuf>, ModError> {
    let (tx, rx) = mpsc::channel();
    app.dialog()
        .file()
        .add_filter("WTG Mod", &["wtgmod"])
        .set_file_name(default_name)
        .save_file(move |p: Option<FilePath>| {
            let _ = tx.send(p);
        });
    match rx.recv().ok().flatten() {
        Some(FilePath::Path(p)) => Ok(Some(p)),
        Some(FilePath::Url(_)) => Err(ModError::path_invalid("不支持的 URL 路径")),
        None => Ok(None),
    }
}
