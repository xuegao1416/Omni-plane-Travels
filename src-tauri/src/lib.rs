mod mod_system;

use mod_system::registry::ModRegistry;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let registry = ModRegistry::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .manage(registry)
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Ensure the mods storage dir exists and load the persisted
            // registry into the managed state.
            let handle = app.handle();
            let mods_dir = mod_system::mods_root(handle)?;
            std::fs::create_dir_all(&mods_dir)
                .map_err(|e| tauri::Error::Io(e))?;
            app.state::<ModRegistry>().load(handle)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            mod_system::commands::discover_events,
            mod_system::commands::list_events,
            mod_system::commands::validate_event,
            mod_system::commands::install_event,
            mod_system::commands::uninstall_event,
            mod_system::commands::enable_event,
            mod_system::commands::disable_event,
            mod_system::commands::import_event,
            mod_system::commands::export_event,
            mod_system::commands::get_event_detail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
