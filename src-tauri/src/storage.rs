//! Filesystem layout for AppStore-managed installs.
//!
//! ```text
//!   {data_dir}/AppStore/                     ← all state lives here
//!     installed.json                         ← index of installed apps
//!     apps/<slug>/<version>/                 ← extracted app payload
//!     bin/                                   ← shim/symlink to each app's binary
//!     cache/downloads/                       ← raw download cache
//! ```
//!
//! On Linux/macOS, `bin/` is added to `PATH` via a one-time snippet the user
//! can paste into their shell profile (see README). On Windows we print
//! a note telling the user to add it to their user PATH.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};

pub const APP_DIR_NAME: &str = "AppStore";

pub fn root<R: Runtime>(handle: &AppHandle<R>) -> Result<PathBuf, io::Error> {
    if let Ok(p) = handle.path().app_data_dir() {
        return Ok(p);
    }
    let base = dirs::data_dir().ok_or_else(|| io::Error::other("no data_dir"))?;
    Ok(base.join(APP_DIR_NAME))
}

pub fn apps_dir<R: Runtime>(handle: &AppHandle<R>) -> Result<PathBuf, io::Error> {
    Ok(root(handle)?.join("apps"))
}

pub fn bin_dir<R: Runtime>(handle: &AppHandle<R>) -> Result<PathBuf, io::Error> {
    Ok(root(handle)?.join("bin"))
}

pub fn cache_dir<R: Runtime>(handle: &AppHandle<R>) -> Result<PathBuf, io::Error> {
    Ok(root(handle)?.join("cache").join("downloads"))
}

pub fn installed_json<R: Runtime>(handle: &AppHandle<R>) -> Result<PathBuf, io::Error> {
    Ok(root(handle)?.join("installed.json"))
}

pub fn ensure_dirs<R: Runtime>(handle: &AppHandle<R>) -> Result<(), io::Error> {
    for d in [apps_dir(handle)?, bin_dir(handle)?, cache_dir(handle)?] {
        fs::create_dir_all(d)?;
    }
    Ok(())
}

pub fn app_version_dir<R: Runtime>(
    handle: &AppHandle<R>,
    slug: &str,
    version: &str,
) -> Result<PathBuf, io::Error> {
    let p = apps_dir(handle)?.join(slug).join(version);
    fs::create_dir_all(&p)?;
    Ok(p)
}

pub fn remove_if_exists(path: &Path) -> Result<(), io::Error> {
    if path.exists() {
        if path.is_dir() {
            fs::remove_dir_all(path)?;
        } else {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}
