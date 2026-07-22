//! Manifest validation: structure, app-version, checksum, dependencies,
//! conflicts, and (static) rule-permission checks.
//!
//! These run on the backend only as *data* validation — no rule evaluation.
//! The rule engine itself lives in the frontend (pure TypeScript).

use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;

use crate::mod_system::error::ModError;
use crate::mod_system::registry::ModRegistry;
use crate::mod_system::types::*;
use crate::mod_system::APP_VERSION;

// ---------------- manual format validators (avoid extra deps) ----------------

/// `^[a-z0-9][a-z0-9_:-]{2,63}$`
pub fn is_valid_mod_id(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() < 3 || b.len() > 64 {
        return false;
    }
    let is_id_char = |c: u8| c.is_ascii_digit() || c.is_ascii_lowercase();
    if !is_id_char(b[0]) {
        return false;
    }
    for &c in &b[1..] {
        if !(is_id_char(c) || c == b'_' || c == b'-' || c == b':') {
            return false;
        }
    }
    true
}

/// `^\d+\.\d+\.\d+$`
pub fn is_version_triple(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// `^#[0-9a-fA-F]{6}$`
pub fn is_hex_color(s: &str) -> bool {
    if !s.starts_with('#') || s.len() != 7 {
        return false;
    }
    s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

// ---------------- structure ----------------

/// Validate structural / format constraints (post-deserialize).
/// Returns blocking `SCHEMA` issues. Missing *required* fields are caught at
/// deserialization time and surface as `MANIFEST_MISSING_FIELD` by callers.
pub fn validate_structure(m: &ModManifest) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();

    if !is_valid_mod_id(&m.id) {
        issues.push(issue("SCHEMA", Some("id"), "id 格式必须匹配 ^[a-z0-9][a-z0-9_:-]{2,63}$"));
    }
    if m.name.is_empty() || m.name.len() > 80 {
        issues.push(issue("SCHEMA", Some("name"), "name 长度需为 1..80"));
    }
    if m.author.is_empty() || m.author.len() > 60 {
        issues.push(issue("SCHEMA", Some("author"), "author 长度需为 1..60"));
    }
    if let Some(d) = &m.description {
        if d.len() > 500 {
            issues.push(issue("SCHEMA", Some("description"), "description 长度需 <= 500"));
        }
    }
    if !is_version_triple(&m.version) {
        issues.push(issue("SCHEMA", Some("version"), "version 必须匹配 ^\\d+\\.\\d+\\.\\d+$"));
    }
    if m.engine != "wtg-mod" {
        issues.push(issue("SCHEMA", Some("engine"), "engine 必须为 \"wtg-mod\""));
    }
    if m.schema_version < 1 {
        issues.push(issue("SCHEMA", Some("schemaVersion"), "schemaVersion 必须 >= 1"));
    }
    if !is_version_triple(&m.min_app_version) {
        issues.push(issue(
            "SCHEMA",
            Some("minAppVersion"),
            "minAppVersion 必须匹配 ^\\d+\\.\\d+\\.\\d+$",
        ));
    }
    if !is_hex_color(&m.cover_color) {
        issues.push(issue("SCHEMA", Some("coverColor"), "coverColor 必须为 #RRGGBB 十六进制"));
    }
    if m.icon.is_empty() || m.icon.len() > 48 {
        issues.push(issue("SCHEMA", Some("icon"), "icon 必须为非空且长度 <= 48 的 Lucide 图标名"));
    }
    if let Some(deps) = &m.dependencies {
        for d in deps {
            if !is_valid_mod_id(d) {
                issues.push(issue(
                    "SCHEMA",
                    Some("dependencies"),
                    &format!("依赖 id 格式非法：{d}"),
                ));
            }
        }
    }
    if let Some(conflicts) = &m.conflicts {
        for c in conflicts {
            if !is_valid_mod_id(c) {
                issues.push(issue(
                    "SCHEMA",
                    Some("conflicts"),
                    &format!("冲突 id 格式非法：{c}"),
                ));
            }
        }
    }
    if let Some(assets) = &m.assets {
        for a in assets {
            if a.path.is_empty() || a.size < 0 {
                issues.push(issue(
                    "SCHEMA",
                    Some("assets"),
                    "资源 path 不可为空且 size 必须 >= 0",
                ));
            }
        }
    }
    issues
}

fn issue(code: &str, field: Option<&str>, message: &str) -> ValidationIssue {
    ValidationIssue {
        code: code.to_string(),
        field: field.map(|s| s.to_string()),
        message: message.to_string(),
    }
}

/// Map a serde deserialization error to the right `ModError`.
pub fn parse_manifest_err(e: &serde_json::Error) -> ModError {
    let msg = e.to_string();
    if msg.contains("missing field") {
        let field = extract_missing_field(&msg);
        ModError::manifest_missing_field(&[&field])
    } else {
        ModError::manifest_invalid(format!("Manifest 解析失败：{msg}"))
    }
}

fn extract_missing_field(msg: &str) -> String {
    // serde message looks like: `missing field `id` at line 1 column 10`
    if let Some(start) = msg.find("missing field `") {
        let rest = &msg[start + "missing field `".len()..];
        if let Some(end) = rest.find('`') {
            return rest[..end].to_string();
        }
    }
    "manifest".to_string()
}

// ---------------- app version ----------------

/// Ensure the running app satisfies `manifest.minAppVersion`.
pub fn verify_app_version(m: &ModManifest) -> Result<(), ModError> {
    let need = semver::Version::parse(&m.min_app_version)?;
    let have = semver::Version::parse(APP_VERSION)
        .map_err(|e| ModError::manifest_invalid(format!("应用版本号非法：{e}")))?;
    if have < need {
        return Err(ModError::app_version_incompatible(
            &m.min_app_version,
            APP_VERSION,
        ));
    }
    Ok(())
}

// ---------------- checksums ----------------

/// Verify manifest + asset checksums against the in-memory archive (install).
pub fn verify_install_checksums(
    m: &ModManifest,
    files: &HashMap<String, Vec<u8>>,
) -> Result<(), ModError> {
    let cs = match &m.checksum {
        Some(c) => c,
        None => return Ok(()), // unsigned mods are trusted
    };

    let mut bad: Vec<String> = Vec::new();

    if let Some(mb) = files.get("manifest.json") {
        if compute_or(&cs.manifest, mb) {
            bad.push("manifest.json".to_string());
        }
    } else {
        bad.push("manifest.json".to_string());
    }

    if let Some(assets) = &m.assets {
        for a in assets {
            let archive_path = format!("assets/{}", a.path);
            match files.get(&archive_path) {
                Some(bytes) => {
                    if let Some(expected) = cs.assets.get(&a.path) {
                        if compute_or(expected, bytes) {
                            bad.push(a.path.clone());
                        }
                    }
                }
                None => bad.push(a.path.clone()),
            }
        }
    }

    if bad.is_empty() {
        Ok(())
    } else {
        Err(ModError::checksum_mismatch(&bad))
    }
}

/// Returns true if the sha256 of `bytes` does NOT equal `expected`.
fn compute_or(expected: &str, bytes: &[u8]) -> bool {
    let actual = crate::mod_system::package::compute_sha256(bytes);
    actual != expected
}

/// Verify asset checksums for editor-time validation (in-memory bytes).
pub fn verify_assets_in_memory(m: &ModManifest, assets: &[AssetBytes]) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    let cs = match &m.checksum {
        Some(c) => c,
        None => return issues,
    };
    let by_path: HashMap<&str, &AssetBytes> =
        assets.iter().map(|a| (a.path.as_str(), a)).collect();
    if let Some(declared) = &m.assets {
        for a in declared {
            if let Some(expected) = cs.assets.get(&a.path) {
                match by_path.get(a.path.as_str()) {
                    Some(ab) => {
                        let actual = crate::mod_system::package::compute_sha256(&ab.bytes);
                        if &actual != expected {
                            issues.push(issue(
                                "CHECKSUM",
                                Some(&a.path),
                                "资源校验和不匹配",
                            ));
                        }
                    }
                    None => issues.push(issue(
                        "CHECKSUM",
                        Some(&a.path),
                        "缺少资源字节以进行校验",
                    )),
                }
            }
        }
    }
    issues
}

/// Verify asset checksums for editor-time validation (files on disk).
pub fn verify_assets_on_disk(
    m: &ModManifest,
    root: &Path,
) -> Result<Vec<ValidationIssue>, ModError> {
    let mut issues = Vec::new();
    let cs = match &m.checksum {
        Some(c) => c,
        None => return Ok(issues),
    };
    if let Some(declared) = &m.assets {
        for a in declared {
            // Manifest-controlled path: reject absolute paths and `..` traversal
            // before joining, so validation can never read outside the mod dir.
            if a.path.contains("..") || Path::new(&a.path).is_absolute() {
                return Err(ModError::path_invalid(&a.path));
            }
            if let Some(expected) = cs.assets.get(&a.path) {
                let p = root.join("assets").join(&a.path);
                match std::fs::read(&p) {
                    Ok(bytes) => {
                        let actual = crate::mod_system::package::compute_sha256(&bytes);
                        if &actual != expected {
                            issues.push(issue("CHECKSUM", Some(&a.path), "资源校验和不匹配"));
                        }
                    }
                    Err(_) => issues.push(issue("CHECKSUM", Some(&a.path), "资源文件读取失败")),
                }
            }
        }
    }
    Ok(issues)
}

// ---------------- dependencies / conflicts / permissions ----------------

/// Dependency satisfaction against the installed registry.
/// Returns blocking `DEP` issues (unsatisfied dependencies).
pub fn check_dependencies(m: &ModManifest, state: &ModRegistry) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    if let Some(deps) = &m.dependencies {
        for dep in deps {
            let satisfied = match state.get(dep) {
                Some(e) => e.enabled, // must be installed AND enabled
                None => false,
            };
            if !satisfied {
                let reason = if state.contains(dep) {
                    "依赖已安装但未启用"
                } else {
                    "依赖未安装"
                };
                let mut issue = issue("DEP", Some(dep), reason);
                issue.field = Some(dep.clone());
                issues.push(issue);
            }
        }
    }
    issues
}

/// Conflicts against currently-enabled mods. Returns the conflicting ids.
pub fn check_conflicts(m: &ModManifest, state: &ModRegistry) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(conflicts) = &m.conflicts {
        for c in conflicts {
            if let Some(e) = state.get(c) {
                if e.enabled {
                    out.push(c.clone());
                }
            }
        }
    }
    out
}

/// Map a rule action key to the permission it requires (static check only).
fn required_perm_for_action(key: &str) -> Option<&'static str> {
    match key {
        "set" => Some("modify_world_state"),
        "emit" => Some("emit_world_event"),
        "addCard" => Some("add_card"),
        "overrideCard" => Some("override_card"),
        "modifyResource" => Some("modify_world_state"),
        "scheduleTick" => Some("register_tick"),
        _ => None,
    }
}

/// Statically verify that every rule action's required permission is declared
/// in `manifest.permissions`. Returns `Some(missing_permission)` on the first
/// violation, or `None` if all good. Reads `schema/rules.json` if present.
pub fn check_rule_permissions(
    m: &ModManifest,
    dir: &Path,
    perms: &[Permission],
) -> Result<Option<String>, ModError> {
    let rules_path = m
        .rules
        .clone()
        .and_then(|r| r.first().cloned())
        .unwrap_or_else(|| "schema/rules.json".to_string());
    // Manifest-controlled path: reject absolute paths and `..` traversal
    // before joining, so permission checks never read outside the mod dir.
    if rules_path.contains("..") || Path::new(&rules_path).is_absolute() {
        return Err(ModError::path_invalid(&rules_path));
    }
    let p = dir.join(&rules_path);
    let data = match std::fs::read_to_string(&p) {
        Ok(d) => d,
        Err(_) => return Ok(None), // no rules file -> nothing to check
    };
    #[derive(Deserialize)]
    struct RuleFile {
        rules: Vec<RuleNode>,
    }
    #[derive(Deserialize)]
    struct RuleNode {
        #[serde(default)]
        then: Vec<serde_json::Value>,
    }
    let rf: RuleFile = serde_json::from_str(&data)?;

    for r in rf.rules {
        for action in &r.then {
            if let Some(obj) = action.as_object() {
                if let Some(key) = obj.keys().next() {
                    if let Some(req) = required_perm_for_action(key) {
                        let declared = perms.iter().any(|p| perm_name(p) == req);
                        if !declared {
                            return Ok(Some(req.to_string()));
                        }
                    }
                }
            }
        }
    }
    Ok(None)
}

fn perm_name(p: &Permission) -> &'static str {
    match p {
        Permission::ReadWorldState => "read_world_state",
        Permission::ModifyWorldState => "modify_world_state",
        Permission::AddCard => "add_card",
        Permission::OverrideCard => "override_card",
        Permission::RegisterTick => "register_tick",
        Permission::EmitWorldEvent => "emit_world_event",
        Permission::ProvideAssets => "provide_assets",
    }
}
