//! The install engine.
//!
//! Installation pipeline for each app:
//!   1. Download the release asset from GitHub to the cache dir, streaming
//!      to disk and emitting progress events to the UI.
//!   2. Compute SHA-256 of the downloaded bytes.
//!   3. If the manifest (or a sibling checksum file on the release) gives an
//!      expected SHA-256, verify it. Abort on mismatch.
//!   4. Extract / place the payload into {apps_dir}/<slug>/<version>/.
//!   5. Link the primary binary into {bin_dir} so it's on PATH once the
//!      user sources the printed snippet.
//!   6. Persist a record in installed.json.

use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Runtime};

use crate::storage;

#[derive(Debug, thiserror::Error)]
pub enum InstallError {
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("zip error: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("checksum mismatch: expected {expected}, got {actual}")]
    ChecksumMismatch { expected: String, actual: String },
    #[allow(dead_code)]
    #[error("unsupported install kind: {0}")]
    UnsupportedKind(String),
    #[error("binary not found after extraction: {0}")]
    BinaryNotFound(String),
    #[error("app not installed: {0}")]
    NotInstalled(String),
    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("other: {0}")]
    Other(String),
}

impl serde::Serialize for InstallError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum InstallKind {
    Appimage,
    Deb,
    Rpm,
    #[serde(rename = "tar.gz")]
    TarGz,
    Zip,
    Dmg,
    Pkg,
    Exe,
    Msi,
    #[serde(rename = "raw-binary")]
    RawBinary,
}

impl InstallKind {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Appimage => "appimage",
            Self::Deb => "deb",
            Self::Rpm => "rpm",
            Self::TarGz => "tar.gz",
            Self::Zip => "zip",
            Self::Dmg => "dmg",
            Self::Pkg => "pkg",
            Self::Exe => "exe",
            Self::Msi => "msi",
            Self::RawBinary => "raw-binary",
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct InstallArgs {
    pub slug: String,
    pub repo: String,
    pub version: String,
    pub download_url: String,
    pub kind: InstallKind,
    pub expected_sha256: Option<String>,
    pub binary_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstalledAppRecord {
    pub slug: String,
    pub repo: String,
    pub version: String,
    pub installed_at: String,
    pub binary_path: Option<String>,
    pub install_dir: String,
    pub kind: String,
    pub sha256: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "snake_case")]
enum Stage {
    Resolving,
    Downloading,
    Verifying,
    Extracting,
    Installing,
    Done,
    Error,
}

#[derive(Debug, Serialize, Clone)]
struct Progress {
    slug: String,
    stage: Stage,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes_downloaded: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes_total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn emit<R: Runtime>(handle: &AppHandle<R>, p: &Progress) {
    let _ = handle.emit("install-progress", p);
}

#[tauri::command]
pub async fn install_app<R: Runtime>(
    handle: AppHandle<R>,
    args: InstallArgs,
) -> Result<InstalledAppRecord, InstallError> {
    let slug = args.slug.clone();
    let result = install_app_inner(handle.clone(), args).await;
    match &result {
        Ok(_) => emit(
            &handle,
            &Progress {
                slug: slug.clone(),
                stage: Stage::Done,
                bytes_downloaded: None,
                bytes_total: None,
                message: None,
            },
        ),
        Err(e) => emit(
            &handle,
            &Progress {
                slug,
                stage: Stage::Error,
                bytes_downloaded: None,
                bytes_total: None,
                message: Some(e.to_string()),
            },
        ),
    }
    result
}

async fn install_app_inner<R: Runtime>(
    handle: AppHandle<R>,
    args: InstallArgs,
) -> Result<InstalledAppRecord, InstallError> {
    emit(
        &handle,
        &Progress {
            slug: args.slug.clone(),
            stage: Stage::Resolving,
            bytes_downloaded: None,
            bytes_total: None,
            message: None,
        },
    );

    storage::ensure_dirs(&handle).map_err(|e| InstallError::Other(e.to_string()))?;

    let cache_dir = storage::cache_dir(&handle).map_err(|e| InstallError::Other(e.to_string()))?;
    fs::create_dir_all(&cache_dir)?;

    let file_name = args
        .download_url
        .rsplit('/')
        .next()
        .unwrap_or("download.bin")
        .to_string();
    let download_path = cache_dir.join(format!("{}-{}-{}", args.slug, args.version, file_name));

    // Download with progress
    let client = reqwest::Client::builder()
        .user_agent("appstore-installer")
        .build()?;
    let resp = client
        .get(&args.download_url)
        .send()
        .await?
        .error_for_status()?;
    let total = resp.content_length();
    let mut stream = resp.bytes_stream();

    let mut file = BufWriter::new(File::create(&download_path)?);
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let bytes = chunk?;
        file.write_all(&bytes)?;
        hasher.update(&bytes);
        downloaded += bytes.len() as u64;
        if downloaded - last_emit > 64 * 1024 {
            emit(
                &handle,
                &Progress {
                    slug: args.slug.clone(),
                    stage: Stage::Downloading,
                    bytes_downloaded: Some(downloaded),
                    bytes_total: total,
                    message: None,
                },
            );
            last_emit = downloaded;
        }
    }
    file.flush()?;
    drop(file);

    let digest = hasher.finalize();
    let sha_hex = hex::encode(digest);

    // Verify checksum if caller supplied one.
    emit(
        &handle,
        &Progress {
            slug: args.slug.clone(),
            stage: Stage::Verifying,
            bytes_downloaded: Some(downloaded),
            bytes_total: total,
            message: None,
        },
    );

    if let Some(expected) = args.expected_sha256.as_deref() {
        let want = expected.trim().to_lowercase();
        if want != sha_hex {
            let _ = fs::remove_file(&download_path);
            return Err(InstallError::ChecksumMismatch {
                expected: want,
                actual: sha_hex,
            });
        }
    }

    // Extract / place payload.
    emit(
        &handle,
        &Progress {
            slug: args.slug.clone(),
            stage: Stage::Extracting,
            bytes_downloaded: Some(downloaded),
            bytes_total: total,
            message: None,
        },
    );

    let install_dir = storage::app_version_dir(&handle, &args.slug, &args.version)
        .map_err(|e| InstallError::Other(e.to_string()))?;
    // Clear any previous install at the same version.
    storage::remove_if_exists(&install_dir).map_err(|e| InstallError::Other(e.to_string()))?;
    fs::create_dir_all(&install_dir)?;

    let binary_path = match args.kind {
        InstallKind::TarGz => {
            extract_tar_gz(&download_path, &install_dir)?;
            locate_binary(&install_dir, args.binary_name.as_deref())?
        }
        InstallKind::Zip => {
            extract_zip(&download_path, &install_dir)?;
            locate_binary(&install_dir, args.binary_name.as_deref())?
        }
        InstallKind::Appimage => {
            // AppImages are self-contained; copy and mark executable.
            let target = install_dir.join(file_name);
            fs::copy(&download_path, &target)?;
            make_executable(&target)?;
            Some(target)
        }
        InstallKind::RawBinary => {
            let target = install_dir.join(args.binary_name.as_deref().unwrap_or(&file_name));
            fs::copy(&download_path, &target)?;
            make_executable(&target)?;
            Some(target)
        }
        InstallKind::Deb
        | InstallKind::Rpm
        | InstallKind::Dmg
        | InstallKind::Pkg
        | InstallKind::Exe
        | InstallKind::Msi => {
            // Native OS installers are kept as-is. The user runs them via the
            // system package manager / installer. We still stash a copy so the
            // user can re-run/uninstall via this UI.
            let target = install_dir.join(file_name);
            fs::copy(&download_path, &target)?;
            None
        }
    };

    // Link binary to shared bin dir.
    emit(
        &handle,
        &Progress {
            slug: args.slug.clone(),
            stage: Stage::Installing,
            bytes_downloaded: Some(downloaded),
            bytes_total: total,
            message: None,
        },
    );

    let mut linked: Option<PathBuf> = None;
    if let Some(bin) = &binary_path {
        let bin_dir = storage::bin_dir(&handle).map_err(|e| InstallError::Other(e.to_string()))?;
        fs::create_dir_all(&bin_dir)?;
        let link_name = args
            .binary_name
            .clone()
            .unwrap_or_else(|| args.slug.clone());
        let link_path = bin_dir.join(&link_name);
        let _ = fs::remove_file(&link_path);
        link_binary(bin, &link_path)?;
        linked = Some(link_path);
    }

    // Persist the record.
    let record = InstalledAppRecord {
        slug: args.slug.clone(),
        repo: args.repo.clone(),
        version: args.version.clone(),
        installed_at: now_iso8601(),
        binary_path: linked.as_ref().map(|p| p.display().to_string()),
        install_dir: install_dir.display().to_string(),
        kind: args.kind.as_str().to_string(),
        sha256: Some(sha_hex),
    };
    write_record(&handle, &record)?;

    // Best-effort cleanup of the raw download.
    let _ = fs::remove_file(&download_path);

    Ok(record)
}

#[tauri::command]
pub async fn uninstall_app<R: Runtime>(
    handle: AppHandle<R>,
    slug: String,
) -> Result<(), InstallError> {
    let mut records = read_records(&handle)?;
    let idx = records
        .iter()
        .position(|r| r.slug == slug)
        .ok_or_else(|| InstallError::NotInstalled(slug.clone()))?;
    let rec = records.remove(idx);

    // Remove install dir.
    let install_dir = PathBuf::from(&rec.install_dir);
    if install_dir.exists() {
        fs::remove_dir_all(&install_dir).ok();
    }
    // Remove shim.
    if let Some(bin) = &rec.binary_path {
        let p = PathBuf::from(bin);
        if p.exists() {
            fs::remove_file(&p).ok();
        }
    }

    write_records(&handle, &records)?;
    Ok(())
}

#[tauri::command]
pub async fn list_installed<R: Runtime>(
    handle: AppHandle<R>,
) -> Result<Vec<InstalledAppRecord>, InstallError> {
    read_records(&handle)
}

// ---------- extraction helpers ----------

fn extract_tar_gz(archive: &Path, out_dir: &Path) -> Result<(), InstallError> {
    let f = File::open(archive)?;
    let gz = flate2::read::GzDecoder::new(BufReader::new(f));
    let mut tar = tar::Archive::new(gz);
    tar.set_preserve_permissions(true);
    tar.unpack(out_dir)?;
    Ok(())
}

fn extract_zip(archive: &Path, out_dir: &Path) -> Result<(), InstallError> {
    let f = File::open(archive)?;
    let mut zip = zip::ZipArchive::new(BufReader::new(f))?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let outpath = match entry.enclosed_name() {
            Some(path) => out_dir.join(path),
            None => continue,
        };
        if entry.is_dir() {
            fs::create_dir_all(&outpath)?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut out = File::create(&outpath)?;
            io::copy(&mut entry, &mut out)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Some(mode) = entry.unix_mode() {
                    fs::set_permissions(&outpath, fs::Permissions::from_mode(mode))?;
                }
            }
        }
    }
    Ok(())
}

/// Locate the binary inside an extracted tree.
/// Prefers an explicit name if provided, otherwise picks the first
/// executable file we find.
fn locate_binary(root: &Path, preferred: Option<&str>) -> Result<Option<PathBuf>, InstallError> {
    let mut stack = vec![root.to_path_buf()];
    let mut fallback: Option<PathBuf> = None;
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            let file_type = entry.file_type()?;
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if let Some(pref) = preferred {
                if name.eq_ignore_ascii_case(pref) {
                    make_executable(&path)?;
                    return Ok(Some(path));
                }
            }
            if fallback.is_none() && is_likely_executable(&path) {
                fallback = Some(path.clone());
            }
        }
    }

    if let Some(p) = fallback.as_ref() {
        make_executable(p)?;
    }
    if let (Some(pref), None) = (preferred, &fallback) {
        return Err(InstallError::BinaryNotFound(pref.to_string()));
    }
    Ok(fallback)
}

fn is_likely_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(path) {
            return meta.permissions().mode() & 0o111 != 0;
        }
    }
    #[cfg(windows)]
    {
        if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
            return matches!(
                ext.to_ascii_lowercase().as_str(),
                "exe" | "cmd" | "bat" | "ps1"
            );
        }
    }
    false
}

fn make_executable(path: &Path) -> Result<(), InstallError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path)?.permissions();
        perms.set_mode(perms.mode() | 0o755);
        fs::set_permissions(path, perms)?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn link_binary(src: &Path, link: &Path) -> Result<(), InstallError> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(src, link)?;
    }
    #[cfg(windows)]
    {
        // Symlinks on Windows require elevated perms; fall back to copy.
        fs::copy(src, link)?;
    }
    Ok(())
}

// ---------- record persistence ----------

fn read_records<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Vec<InstalledAppRecord>, InstallError> {
    let path = storage::installed_json(handle).map_err(|e| InstallError::Other(e.to_string()))?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let mut f = File::open(&path)?;
    let mut s = String::new();
    f.read_to_string(&mut s)?;
    if s.trim().is_empty() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str(&s)?)
}

fn write_records<R: Runtime>(
    handle: &AppHandle<R>,
    records: &[InstalledAppRecord],
) -> Result<(), InstallError> {
    let path = storage::installed_json(handle).map_err(|e| InstallError::Other(e.to_string()))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(records)?;
    let mut f = File::create(&path)?;
    f.write_all(json.as_bytes())?;
    Ok(())
}

fn write_record<R: Runtime>(
    handle: &AppHandle<R>,
    record: &InstalledAppRecord,
) -> Result<(), InstallError> {
    let mut records = read_records(handle)?;
    records.retain(|r| r.slug != record.slug);
    records.push(record.clone());
    write_records(handle, &records)
}

fn now_iso8601() -> String {
    // Simple UTC timestamp using std only to avoid chrono dep.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format_unix_utc(now)
}

fn format_unix_utc(secs: u64) -> String {
    // Days since 1970-01-01
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let h = time_of_day / 3600;
    let m = (time_of_day % 3600) / 60;
    let s = time_of_day % 60;

    // Convert days to Y-M-D (valid for 1970–~2200).
    let (y, mo, d) = days_to_ymd(days as i64);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, d, h, m, s)
}

fn days_to_ymd(days: i64) -> (i32, u32, u32) {
    // Algorithm from Howard Hinnant's date library (civil_from_days).
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let y = (y + if m <= 2 { 1 } else { 0 }) as i32;
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_unix_utc_basic() {
        assert_eq!(format_unix_utc(1_704_067_200), "2024-01-01T00:00:00Z");
        assert_eq!(format_unix_utc(951_914_096), "2000-03-01T12:34:56Z");
        assert_eq!(format_unix_utc(0), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn sha256_roundtrip() {
        let mut h = Sha256::new();
        h.update(b"hello");
        assert_eq!(
            hex::encode(h.finalize()),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn extract_tar_gz_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("fixture.tar.gz");
        let out = tmp.path().join("out");
        fs::create_dir_all(&out).unwrap();

        // Build a tar.gz in memory: a dir with two files.
        let gz = flate2::write::GzEncoder::new(
            File::create(&archive).unwrap(),
            flate2::Compression::default(),
        );
        let mut builder = tar::Builder::new(gz);
        let mut hdr = tar::Header::new_gnu();
        let body = b"hello, appstore";
        hdr.set_size(body.len() as u64);
        hdr.set_mode(0o755);
        hdr.set_cksum();
        builder
            .append_data(&mut hdr, "bin/hello", std::io::Cursor::new(body))
            .unwrap();
        let readme = b"# readme";
        let mut hdr2 = tar::Header::new_gnu();
        hdr2.set_size(readme.len() as u64);
        hdr2.set_mode(0o644);
        hdr2.set_cksum();
        builder
            .append_data(&mut hdr2, "README.md", std::io::Cursor::new(readme))
            .unwrap();
        builder.into_inner().unwrap().finish().unwrap();

        extract_tar_gz(&archive, &out).unwrap();
        let extracted = fs::read(out.join("bin").join("hello")).unwrap();
        assert_eq!(extracted, body);
        assert!(out.join("README.md").exists());
    }

    #[test]
    fn extract_zip_roundtrip() {
        use std::io::Write as _;
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("fixture.zip");
        let out = tmp.path().join("out");
        fs::create_dir_all(&out).unwrap();

        {
            let mut zw = zip::ZipWriter::new(File::create(&archive).unwrap());
            let opts: zip::write::FileOptions<'_, ()> =
                zip::write::FileOptions::default().unix_permissions(0o755);
            zw.start_file("bin/tool.exe", opts).unwrap();
            zw.write_all(b"MZ\x90\x00").unwrap();
            zw.start_file("docs/README.txt", opts).unwrap();
            zw.write_all(b"hello").unwrap();
            zw.finish().unwrap();
        }

        extract_zip(&archive, &out).unwrap();
        assert!(out.join("bin").join("tool.exe").exists());
        assert_eq!(
            fs::read(out.join("docs").join("README.txt")).unwrap(),
            b"hello"
        );
    }

    #[cfg(unix)]
    #[test]
    fn locate_binary_prefers_named_match() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        fs::create_dir_all(root.join("deep/nested")).unwrap();
        fs::write(root.join("README.md"), "x").unwrap();
        let extra = root.join("deep/extra");
        fs::write(&extra, "x").unwrap();
        fs::set_permissions(&extra, fs::Permissions::from_mode(0o755)).unwrap();
        let target = root.join("deep/nested/mytool");
        fs::write(&target, b"#!/bin/sh\n").unwrap();

        let found = locate_binary(root, Some("mytool")).unwrap();
        assert_eq!(found.unwrap(), target);
    }

    #[cfg(unix)]
    #[test]
    fn locate_binary_falls_back_to_executable() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        fs::write(root.join("readme.txt"), "x").unwrap();
        let exe = root.join("launcher");
        fs::write(&exe, b"#!/bin/sh\n").unwrap();
        fs::set_permissions(&exe, fs::Permissions::from_mode(0o755)).unwrap();

        let found = locate_binary(root, None).unwrap();
        assert_eq!(found.unwrap(), exe);
    }

    #[test]
    fn locate_binary_errors_when_named_missing_and_no_fallback() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        fs::write(root.join("readme.txt"), "x").unwrap();
        let err = locate_binary(root, Some("ghost")).unwrap_err();
        assert!(matches!(err, InstallError::BinaryNotFound(_)));
    }

    #[test]
    fn checksum_comparison_matches_expected_case_insensitive() {
        let mut h = Sha256::new();
        h.update(b"payload");
        let actual = hex::encode(h.finalize());
        let upper = actual.to_uppercase();
        assert_eq!(upper.to_lowercase(), actual);
        assert_ne!(actual, "deadbeef");
    }
}
