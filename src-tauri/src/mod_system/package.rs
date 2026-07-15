//! `.wtgmod` (ZIP) pack/unpack with integrity and anti-zip-bomb guards.
//!
//! Constants mirror `docs/storage-mod-system.md` §4.2. All paths are resolved
//! relative to `app_data_dir`; absolute paths, `..` traversal, and symlinks
//! are rejected (security red line: never write outside the target root).

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use sha2::{Digest, Sha256};
use zip::write::FileOptions;
use zip::CompressionMethod;
use zip::ZipArchive;

use crate::mod_system::error::ModError;
use crate::mod_system::types::{Checksum, ModManifest};

// ---- Anti zip-bomb constants (storage-mod-system.md §4.2) ----
pub const MAX_ZIP_ENTRIES: usize = 1024;
pub const MAX_UNCOMPRESSED_TOTAL: u64 = 50 * 1024 * 1024; // 50 MiB
pub const MAX_SINGLE_ENTRY: u64 = 10 * 1024 * 1024; // 10 MiB
pub const MAX_COMPRESSION_RATIO: f64 = 100.0;
#[allow(dead_code)]
pub const MAX_RULES_PER_MOD: usize = 128;

/// Compute a lowercase hex sha256 of `bytes`.
pub fn compute_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let result = hasher.finalize();
    let mut s = String::with_capacity(result.len() * 2);
    for b in result {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Read a `.wtgmod` archive into an in-memory `name -> bytes` map, enforcing:
/// ZIP magic number, entry count, per-entry & total uncompressed size,
/// compression-ratio heuristic, symlink rejection, and path traversal.
pub fn read_archive(path: &Path) -> Result<HashMap<String, Vec<u8>>, ModError> {
    let raw = std::fs::read(path)?;
    // Magic number: PK\x03\x04 (local file header).
    if raw.len() < 4 || raw[0] != 0x50 || raw[1] != 0x4B || raw[2] != 0x03 || raw[3] != 0x04 {
        return Err(ModError::zip_invalid(&path.to_string_lossy()));
    }

    let mut archive =
        ZipArchive::new(std::io::Cursor::new(raw)).map_err(|e| ModError::zip_invalid(&e.to_string()))?;

    if archive.len() as usize > MAX_ZIP_ENTRIES {
        return Err(ModError::zip_bomb("entries"));
    }

    let mut map: HashMap<String, Vec<u8>> = HashMap::new();
    let mut total: u64 = 0;

    for i in 0..archive.len() {
        let mut entry =
            archive.by_index(i).map_err(|e| ModError::zip_invalid(&e.to_string()))?;

        // `enclosed_name` returns None for unsafe (absolute / `..`) paths.
        let name = match entry.enclosed_name() {
            Some(p) => p.to_string_lossy().replace('\\', "/"),
            None => return Err(ModError::path_invalid(&entry.name().to_string())),
        };

        if entry.is_symlink() {
            return Err(ModError::path_invalid(&format!(
                "symbolic link not allowed: {name}"
            )));
        }
        if entry.is_dir() {
            continue;
        }

        let uncompressed = entry.size();
        let compressed = entry.compressed_size();

        if uncompressed > MAX_SINGLE_ENTRY {
            return Err(ModError::zip_bomb("single_entry"));
        }
        // Compression-ratio heuristic: suspicious if uncompressed is >100x the
        // compressed size AND larger than 1 MiB.
        if compressed > 0
            && uncompressed as f64 > compressed as f64 * MAX_COMPRESSION_RATIO
            && uncompressed > 1024 * 1024
        {
            return Err(ModError::zip_bomb("ratio"));
        }

        total += uncompressed;
        if total > MAX_UNCOMPRESSED_TOTAL {
            return Err(ModError::zip_bomb("total_size"));
        }

        let mut buf = Vec::with_capacity(uncompressed as usize);
        entry
            .read_to_end(&mut buf)
            .map_err(|e| ModError::io_error(e.to_string(), Some(&name)))?;
        map.insert(name, buf);
    }

    Ok(map)
}

/// Write the in-memory archive entries under `root`, defending against any
/// path that would escape `root`.
pub fn write_mod_files(root: &Path, files: &HashMap<String, Vec<u8>>) -> Result<(), ModError> {
    for (name, bytes) in files {
        let rel = Path::new(name);
        if rel.is_absolute() || name.contains("..") {
            return Err(ModError::path_invalid(name));
        }
        let dest = root.join(rel);
        // Component-wise check that `dest` begins exactly with `root`.
        let mut root_iter = root.components();
        let mut escaped = false;
        for c in dest.components() {
            match root_iter.next() {
                Some(rc) if rc == c => continue,
                _ => {
                    escaped = true;
                    break;
                }
            }
        }
        if escaped {
            return Err(ModError::path_invalid(name));
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&dest, bytes)?;
    }
    Ok(())
}

/// Recompute the manifest's checksum block from the on-disk mod directory.
/// Used on export so the produced `.wtgmod` is internally consistent.
pub fn recompute_manifest_checksums(
    manifest: &ModManifest,
    dir: &Path,
) -> Result<ModManifest, ModError> {
    let mut m = manifest.clone();
    let manifest_bytes = serde_json::to_vec(manifest)?;
    let manifest_hash = compute_sha256(&manifest_bytes);

    let mut asset_hashes: HashMap<String, String> = HashMap::new();
    if let Some(assets) = &manifest.assets {
        for a in assets {
            // Manifest-controlled path: reject absolute paths and `..` traversal
            // before joining, so export can never read outside the mod dir.
            if a.path.contains("..") || Path::new(&a.path).is_absolute() {
                return Err(ModError::path_invalid(&a.path));
            }
            let p = dir.join("assets").join(&a.path);
            if p.is_file() {
                let bytes = std::fs::read(&p)?;
                asset_hashes.insert(a.path.clone(), compute_sha256(&bytes));
            }
        }
    }

    m.checksum = Some(Checksum {
        manifest: manifest_hash,
        assets: asset_hashes,
    });
    Ok(m)
}

/// Collect `manifest.json` + `schema/*` + `assets/*` + optional `README.md`
/// from `mod_dir` and pack them into a `.wtgmod` ZIP at `target`.
/// `manifest` is written as-is (caller may have refreshed its checksum).
pub fn pack_mod(
    mod_dir: &Path,
    manifest: &ModManifest,
    target: &Path,
) -> Result<(), ModError> {
    let mut to_pack: Vec<(String, Vec<u8>)> = Vec::new();

    // manifest.json (from the provided, possibly checksum-refreshed, manifest)
    let manifest_bytes = serde_json::to_vec(manifest)?;
    to_pack.push(("manifest.json".to_string(), manifest_bytes));

    // schema/*
    let schema_dir = mod_dir.join("schema");
    if schema_dir.is_dir() {
        for entry in std::fs::read_dir(&schema_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                let fname = entry.file_name().to_string_lossy().to_string();
                let bytes = std::fs::read(entry.path())?;
                to_pack.push((format!("schema/{fname}"), bytes));
            }
        }
    }

    // assets/*
    let assets_dir = mod_dir.join("assets");
    if assets_dir.is_dir() {
        for entry in std::fs::read_dir(&assets_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                let fname = entry.file_name().to_string_lossy().to_string();
                let bytes = std::fs::read(entry.path())?;
                to_pack.push((format!("assets/{fname}"), bytes));
            }
        }
    }

    // README.md (optional)
    let readme = mod_dir.join("README.md");
    if readme.is_file() {
        to_pack.push(("README.md".to_string(), std::fs::read(&readme)?));
    }

    let file = std::fs::File::create(target)?;
    let mut writer = zip::ZipWriter::new(file);
    let options = FileOptions::default().compression_method(CompressionMethod::Deflated);

    for (name, bytes) in &to_pack {
        writer
            .start_file(name, options)
            .map_err(|e| ModError::export_failed(e.to_string()))?;
        writer
            .write_all(bytes)
            .map_err(|e| ModError::export_failed(e.to_string()))?;
    }
    writer
        .finish()
        .map_err(|e| ModError::export_failed(e.to_string()))?;
    Ok(())
}
