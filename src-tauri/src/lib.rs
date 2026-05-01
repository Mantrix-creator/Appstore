mod installer;
mod storage;

pub use installer::{InstallArgs, InstalledAppRecord};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::try_init().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();
            storage::ensure_dirs(&handle).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            installer::install_app,
            installer::uninstall_app,
            installer::list_installed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
