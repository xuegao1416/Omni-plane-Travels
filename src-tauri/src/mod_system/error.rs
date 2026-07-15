//! Unified error envelope for the Mod system.
//!
//! Every Mod-system Tauri command returns `Result<T, ModError>`.
//! `ModError` is serialized to JSON and carried inside Tauri's `error.message`
//! so the frontend `unwrapModError()` helper can parse it back into the
//! structured shape defined in `docs/api-mod-system.md` §2.

use serde::Serialize;
use std::fmt;

/// Error envelope matching `docs/api-mod-system.md` §2 `ModError`.
///
/// `code` is one of the machine-readable `ModErrorCode` strings
/// (e.g. `"MOD_NOT_FOUND"`). `message` is a Chinese, human-readable
/// description safe to show the user. `context` is optional structured
/// context (missing field names, conflicting mod ids, paths, etc.).
#[derive(Debug, Clone, Serialize)]
pub struct ModError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
}

impl ModError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        ModError {
            code: code.to_string(),
            message: message.into(),
            context: None,
        }
    }

    /// Attach a structured context object (built with `serde_json::json!`).
    pub fn with_context(mut self, ctx: serde_json::Value) -> Self {
        self.context = Some(ctx);
        self
    }

    // ---- Constructors per error code (docs/api-mod-system.md §2.1) ----

    pub fn not_found(id: &str) -> Self {
        ModError::new("MOD_NOT_FOUND", format!("未找到模块：{id}"))
            .with_context(serde_json::json!({ "id": id }))
    }

    pub fn already_installed(id: &str) -> Self {
        ModError::new("MOD_ALREADY_INSTALLED", format!("模块已安装：{id}"))
            .with_context(serde_json::json!({ "id": id }))
    }

    pub fn manifest_missing_field(fields: &[&str]) -> Self {
        ModError::new(
            "MANIFEST_MISSING_FIELD",
            format!("Manifest 缺少必填字段：{}", fields.join(", ")),
        )
        .with_context(serde_json::json!({ "fields": fields }))
    }

    pub fn manifest_invalid(reason: impl Into<String>) -> Self {
        ModError::new("MANIFEST_INVALID", reason)
    }

    pub fn checksum_mismatch(paths: &[String]) -> Self {
        ModError::new("CHECKSUM_MISMATCH", "资源校验和不匹配")
            .with_context(serde_json::json!({ "paths": paths }))
    }

    pub fn app_version_incompatible(need: &str, have: &str) -> Self {
        ModError::new(
            "APP_VERSION_INCOMPATIBLE",
            format!("应用版本过低，需要 >= {need}，当前 {have}"),
        )
        .with_context(serde_json::json!({ "need": need, "have": have }))
    }

    pub fn dependency_unsatisfied(deps: serde_json::Value) -> Self {
        ModError::new("DEPENDENCY_UNSATISFIED", "依赖未满足")
            .with_context(serde_json::json!({ "deps": deps }))
    }

    pub fn conflict_detected(conflicts: &[String]) -> Self {
        ModError::new("CONFLICT_DETECTED", "与已启用模块冲突")
            .with_context(serde_json::json!({ "conflicts": conflicts }))
    }

    pub fn permission_denied(action: &str) -> Self {
        ModError::new(
            "PERMISSION_DENIED",
            format!("规则引用了未声明的能力：{action}"),
        )
        .with_context(serde_json::json!({ "action": action }))
    }

    pub fn zip_invalid(path: &str) -> Self {
        ModError::new("ZIP_INVALID", "非法的 .wtgmod 文件（魔数不符）")
            .with_context(serde_json::json!({ "path": path }))
    }

    pub fn zip_bomb(reason: &str) -> Self {
        ModError::new("ZIP_BOMB", format!("压缩包疑似炸弹：{reason}"))
            .with_context(serde_json::json!({ "reason": reason }))
    }

    pub fn path_invalid(path: &str) -> Self {
        ModError::new("PATH_INVALID", format!("路径非法或越界：{path}"))
            .with_context(serde_json::json!({ "path": path }))
    }

    pub fn io_error(msg: impl Into<String>, path: Option<&str>) -> Self {
        let mut e = ModError::new("IO_ERROR", msg);
        if let Some(p) = path {
            e.context = Some(serde_json::json!({ "path": p }));
        }
        e
    }

    pub fn export_failed(reason: impl Into<String>) -> Self {
        ModError::new("EXPORT_FAILED", reason)
    }

    pub fn import_cancelled() -> Self {
        ModError::new("IMPORT_CANCELLED", "用户取消了文件选择")
            .with_context(serde_json::json!({}))
    }
}

/// `Display` emits the JSON shape so that, regardless of how Tauri wraps the
/// error, the frontend receives a parseable `ModError` in `error.message`.
impl fmt::Display for ModError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match serde_json::to_string(self) {
            Ok(s) => write!(f, "{s}"),
            Err(_) => write!(
                f,
                "{{\"code\":\"{}\",\"message\":\"{}\"}}",
                self.code, self.message
            ),
        }
    }
}

impl std::error::Error for ModError {}

/// Convert into Tauri's unified error type. `tauri::Error` has no `Command`
/// variant in v2, so we wrap with `Anyhow`.
impl From<ModError> for tauri::Error {
    fn from(e: ModError) -> Self {
        tauri::Error::Anyhow(anyhow::Error::new(e))
    }
}

// ---------------- Conversions for `?` ergonomics ----------------

impl From<std::io::Error> for ModError {
    fn from(e: std::io::Error) -> Self {
        ModError::io_error(e.to_string(), None)
    }
}

impl From<serde_json::Error> for ModError {
    fn from(e: serde_json::Error) -> Self {
        ModError::manifest_invalid(format!("JSON 解析失败：{e}"))
    }
}

impl From<zip::result::ZipError> for ModError {
    fn from(e: zip::result::ZipError) -> Self {
        ModError::zip_invalid(&format!("{e}"))
    }
}

impl From<semver::Error> for ModError {
    fn from(e: semver::Error) -> Self {
        ModError::manifest_invalid(format!("版本号解析失败：{e}"))
    }
}

impl From<tauri::Error> for ModError {
    fn from(e: tauri::Error) -> Self {
        ModError::io_error(e.to_string(), None)
    }
}
