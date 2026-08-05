//! Shared data types for the Mod system.
//!
//! These mirror the TypeScript contract in `docs/api-mod-system.md` §3.
//! Field naming follows the JSON (camelCase) contract: Rust fields use
//! `snake_case` and `#[serde(rename_all = "camelCase")]` (with explicit
//! `rename` where a field name diverges, e.g. `type`).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// User-facing Mod classification. Derives from `type` in the manifest.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModType {
    Card,
    Rule,
    Worldbook,
    Bundle,
}

/// Capabilities a Mod may declare it needs.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    ReadWorldState,
    ModifyWorldState,
    AddCard,
    OverrideCard,
    RegisterTick,
    EmitWorldEvent,
    ProvideAssets,
}

/// Kind of an asset file.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Image,
    Text,
    Data,
    Audio,
}

/// A single declared asset.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetDecl {
    pub path: String,
    pub kind: AssetKind,
    pub size: i64,
}

/// Integrity checksums stored in the manifest.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checksum {
    /// sha256 of `manifest.json`.
    pub manifest: String,
    /// path -> sha256 of each declared asset.
    pub assets: HashMap<String, String>,
}

/// The full Mod manifest. This is the on-disk `manifest.json` shape and the
/// `validate_mod` input. `additionalProperties` is rejected via
/// `#[serde(deny_unknown_fields)]` (security red line).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ModManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    pub engine: String,
    pub schema_version: i64,
    pub min_app_version: String,
    #[serde(rename = "type")]
    pub mod_type: ModType,
    pub cover_color: String,
    pub icon: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled_by_default: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub load_order: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dependencies: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conflicts: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Vec<Permission>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rules: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cards: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assets: Option<Vec<AssetDecl>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checksum: Option<Checksum>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

/// Discovery-time metadata (`discover_mods` / `list_mods` payload subset).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModMeta {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub mod_type: ModType,
    pub cover_color: String,
    pub icon: String,
    pub schema_version: i64,
    pub min_app_version: String,
    pub load_order: i64,
    pub enabled_by_default: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disk_size_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discovered_at: Option<String>,
}

impl ModMeta {
    pub fn from_manifest(
        m: &ModManifest,
        disk_size_bytes: Option<u64>,
        discovered_at: Option<String>,
    ) -> Self {
        ModMeta {
            id: m.id.clone(),
            name: m.name.clone(),
            version: m.version.clone(),
            author: m.author.clone(),
            description: m.description.clone(),
            mod_type: m.mod_type,
            cover_color: m.cover_color.clone(),
            icon: m.icon.clone(),
            schema_version: m.schema_version,
            min_app_version: m.min_app_version.clone(),
            load_order: m.load_order.unwrap_or(100),
            enabled_by_default: m.enabled_by_default.unwrap_or(false),
            homepage: m.homepage.clone(),
            disk_size_bytes,
            discovered_at,
        }
    }
}

/// A registered Mod entry (`list_mods` payload).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModRegistryEntry {
    pub meta: ModMeta,
    pub enabled: bool,
    /// `"enabled"` | `"disabled"`.
    pub status: String,
    pub registered_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_enabled_at: Option<String>,
}

/// One validation issue (`validate_mod` payload).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    /// `MISSING_FIELD` | `SCHEMA` | `CHECKSUM` | `APP_VER` | `DEP` | `CONFLICT`
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    pub message: String,
}

/// Result of `validate_mod` (never throws; problems expressed as issues).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ValidationResult {
    pub ok: bool,
    pub errors: Vec<ValidationIssue>,
    pub warnings: Vec<ValidationIssue>,
}

/// In-memory asset bytes for editor-time validation (`validate_mod`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetBytes {
    pub path: String,
    pub bytes: Vec<u8>,
}

// ---------------- get_mod_detail sub-types ----------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleSummary {
    pub id: String,
    pub file: String,
    pub priority: i64,
    pub once: bool,
    pub cooldown_ticks: i64,
    pub when: serde_json::Value,
    pub action_kinds: Vec<String>,
    pub action_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSummary {
    pub id: String,
    pub title: String,
    pub file: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub override_target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldbookEntrySummary {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepIssue {
    pub id: String,
    pub satisfied: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actual_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictStatus {
    pub id: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModRuntimeState {
    pub once_fired: HashMap<String, bool>,
    pub cooldown_remaining: HashMap<String, i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_tick: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModDetail {
    pub meta: ModRegistryEntry,
    pub manifest: ModManifest,
    pub rules_summary: Vec<RuleSummary>,
    pub cards_summary: Vec<CardSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worldbook_summary: Option<Vec<WorldbookEntrySummary>>,
    pub dependency_status: Vec<DepIssue>,
    pub conflict_status: Vec<ConflictStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_state: Option<ModRuntimeState>,
}

// ---------------- Internal parsing helpers (schema/*.json) ----------------

#[derive(Debug, Clone, Deserialize)]
struct RuleFile {
    #[allow(dead_code)]
    version: i64,
    #[serde(default)]
    rules: Vec<RuleNode>,
    #[serde(default)]
    #[allow(dead_code)]
    periodic_rules: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct RuleNode {
    id: String,
    #[serde(default)]
    priority: i64,
    #[serde(default)]
    once: bool,
    #[serde(default)]
    cooldown_ticks: i64,
    when: serde_json::Value,
    #[serde(default)]
    then: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EventPackIndex {
    pub version: i64,
    #[serde(default)]
    pub name: Option<String>,
    pub events: Vec<EventIndexEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EventIndexEntry {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CardWorkflow {
    pub version: i64,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub nodes: Vec<WorkflowNode>,
    pub connections: Vec<WorkflowConnection>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkflowNode {
    pub id: String,
    pub type_id: String,
    pub position: WorkflowPosition,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub widget_values: Option<serde_json::Value>,
    #[serde(default)]
    pub runtime_state: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WorkflowPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkflowConnection {
    pub id: String,
    pub source_node_id: String,
    pub source_socket_key: String,
    pub target_node_id: String,
    pub target_socket_key: String,
}

#[derive(Debug, Clone, Deserialize)]
struct WorldbookFile {
    #[allow(dead_code)]
    version: i64,
    #[serde(default)]
    entries: Vec<WbNode>,
}

#[derive(Debug, Clone, Deserialize)]
struct WbNode {
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    category: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModStateFile {
    #[allow(dead_code)]
    version: i64,
    #[serde(default)]
    once_fired: HashMap<String, bool>,
    #[serde(default)]
    cooldown_remaining: HashMap<String, i64>,
    #[serde(default)]
    last_tick: Option<i64>,
}

/// Build `RuleSummary` list from a `schema/rules.json` file on disk.
pub(crate) fn parse_rules(dir: &std::path::Path, rules_path: &str) -> Vec<RuleSummary> {
    // Manifest-controlled path: reject absolute paths and `..` traversal
    // before joining, so we never read outside the mod dir (skip if malicious).
    if rules_path.contains("..") || std::path::Path::new(rules_path).is_absolute() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let p = dir.join(rules_path);
    if let Ok(data) = std::fs::read_to_string(&p) {
        if let Ok(rf) = serde_json::from_str::<RuleFile>(&data) {
            for r in rf.rules {
                let action_kinds: Vec<String> = r
                    .then
                    .iter()
                    .filter_map(|a| a.as_object().and_then(|o| o.keys().next().cloned()))
                    .collect();
                out.push(RuleSummary {
                    id: r.id,
                    file: rules_path.to_string(),
                    priority: r.priority,
                    once: r.once,
                    cooldown_ticks: r.cooldown_ticks,
                    when: r.when,
                    action_kinds,
                    action_count: r.then.len(),
                });
            }
        }
    }
    out
}

/// Build event/workflow summaries from the canonical v2 files on disk.
pub(crate) fn parse_cards(dir: &std::path::Path) -> Result<Vec<CardSummary>, crate::mod_system::error::ModError> {
    let data = std::fs::read_to_string(dir.join("schema/events.json"))?;
    let index: EventPackIndex = serde_json::from_str(&data)?;
    if index.version != 2 {
        return Err(crate::mod_system::error::ModError::manifest_invalid(
            "schema/events.json version 必须为 2",
        ));
    }
    let mut out = Vec::with_capacity(index.events.len());
    for event in index.events {
        let file = format!("schema/event-{}.json", event.id);
        let workflow: CardWorkflow = serde_json::from_str(&std::fs::read_to_string(dir.join(&file))?)?;
        if workflow.id != event.id || workflow.name != event.name {
            return Err(crate::mod_system::error::ModError::manifest_invalid(format!(
                "workflow 与索引不一致：{file}"
            )));
        }
        out.push(CardSummary {
            id: event.id,
            title: event.name,
            file,
            kind: "workflow".to_string(),
            override_target: None,
        });
    }
    Ok(out)
}

/// Build `WorldbookEntrySummary` list from `schema/worldbook.json` (if present).
pub(crate) fn parse_worldbook(dir: &std::path::Path) -> Option<Vec<WorldbookEntrySummary>> {
    let p = dir.join("schema/worldbook.json");
    let data = std::fs::read_to_string(&p).ok()?;
    let wf = serde_json::from_str::<WorldbookFile>(&data).ok()?;
    Some(
        wf.entries
            .into_iter()
            .map(|e| WorldbookEntrySummary {
                id: e.id,
                title: e.title,
                category: e.category,
                file: "schema/worldbook.json".to_string(),
            })
            .collect(),
    )
}

/// Build `ModRuntimeState` from `state.json` (if present).
pub(crate) fn parse_runtime_state(dir: &std::path::Path) -> Option<ModRuntimeState> {
    let p = dir.join("state.json");
    let data = std::fs::read_to_string(&p).ok()?;
    let sf = serde_json::from_str::<ModStateFile>(&data).ok()?;
    Some(ModRuntimeState {
        once_fired: sf.once_fired,
        cooldown_remaining: sf.cooldown_remaining,
        last_tick: sf.last_tick,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_workflows_produce_event_summaries() {
        let dir = std::env::temp_dir().join(format!(
            "opt-event-summary-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(dir.join("schema")).unwrap();
        std::fs::write(dir.join("schema/events.json"), serde_json::to_vec(&json!({
            "version": 2,
            "events": [{ "id": "event-one", "name": "Event One" }]
        })).unwrap()).unwrap();
        std::fs::write(dir.join("schema/event-event-one.json"), serde_json::to_vec(&json!({
            "version": 1,
            "id": "event-one",
            "name": "Event One",
            "nodes": [],
            "connections": []
        })).unwrap()).unwrap();

        let summaries = parse_cards(&dir).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "event-one");
        assert_eq!(summaries[0].file, "schema/event-event-one.json");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
