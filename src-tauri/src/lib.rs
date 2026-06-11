use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::Path;
use std::process::Command;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Serialize, Deserialize, Clone)]
struct FileItem {
    name: String,
    path: String,
    is_dir: bool,
}

fn env_config(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

fn get_wsl_distro_and_unix_path(path: &str) -> (String, String) {
    if path.starts_with(r"\\wsl.localhost\") || path.starts_with(r"\\wsl$\") {
        let clean = path
            .replace(r"\\wsl.localhost\", "")
            .replace(r"\\wsl$\", "");
        if let Some((distro, internal)) = clean.split_once('\\') {
            let unix_path = format!("/{}", internal.replace('\\', "/"));
            return (distro.to_string(), unix_path);
        }
    }

    let clean_path = path.replace('\\', "/");
    if let Some((drive, rest)) = clean_path.split_once(':') {
        let drive_letter = drive.to_lowercase();
        let unix_path = format!("/mnt/{}{}", drive_letter, rest);
        return (env_config("WSL_DISTRO", "Ubuntu"), unix_path);
    }

    (env_config("WSL_DISTRO", "Ubuntu"), clean_path)
}

fn get_wsl_network_path(path: &str) -> String {
    if path.starts_with(r"\\wsl.localhost\") || path.starts_with(r"\\wsl$\") {
        return path.to_string();
    }

    let clean_path = path.replace('\\', "/");
    if let Some((drive, rest)) = clean_path.split_once(':') {
        let drive_letter = drive.to_lowercase();
        return format!(
            r"\\wsl.localhost\Ubuntu\mnt\{}{}",
            drive_letter,
            rest.replace('/', "\\")
        );
    }

    path.to_string()
}

fn hide_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn read_directory(path: String) -> Result<Vec<FileItem>, String> {
    let target_path = Path::new(&path);
    if !target_path.exists() {
        return Err("Path does not exist".to_string());
    }

    let mut items = Vec::new();
    if let Ok(entries) = fs::read_dir(target_path) {
        for entry in entries {
            if let Ok(entry) = entry {
                let file_name = entry.file_name().to_string_lossy().to_string();

                if file_name.starts_with('$') || (file_name.starts_with('.') && file_name != ".git")
                {
                    continue;
                }

                let file_path = entry.path().to_string_lossy().to_string();
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                items.push(FileItem {
                    name: file_name,
                    path: file_path,
                    is_dir,
                });
            }
        }
    }

    items.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(items)
}

#[tauri::command]
fn open_powershell(app: tauri::AppHandle, path: String) -> Result<(), String> {
    Command::new("powershell.exe")
        .args(&["-NoExit", "-Command", &format!("Set-Location -LiteralPath \"{}\"", path.replace('"', "`\""))])
        .spawn()
        .map_err(|e| e.to_string())?;
    hide_window(&app);
    Ok(())
}

#[tauri::command]
fn open_cmd(app: tauri::AppHandle, path: String) -> Result<(), String> {
    Command::new("cmd.exe")
        .args(&["/K", "cd", "/d", &format!("\"{}\"", path)])
        .spawn()
        .map_err(|e| e.to_string())?;
    hide_window(&app);
    Ok(())
}

#[tauri::command]
fn open_vscode(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let vscode_bin = env_config("VSCODE_BIN", "code");

    if path.starts_with(r"\\wsl.localhost\") || path.starts_with(r"\\wsl$\") {
        let clean_path = path
            .replace(r"\\wsl.localhost\", "")
            .replace(r"\\wsl$\", "");

        if let Some((distro, internal)) = clean_path.split_once('\\') {
            let unix_path = format!("/{}", internal.replace('\\', "/"));
            let uri = format!("vscode-remote://wsl+{}{}", distro, unix_path);

            Command::new("cmd.exe")
                .args(&["/C", &vscode_bin, "--folder-uri", &uri])
                .spawn()
                .map_err(|e| e.to_string())?;
            hide_window(&app);
            return Ok(());
        }
    }

    Command::new("cmd.exe")
        .args(&["/C", &vscode_bin, &format!("\"{}\"", path)])
        .spawn()
        .map_err(|e| e.to_string())?;
    hide_window(&app);
    Ok(())
}

#[tauri::command]
fn open_wsl_opencode(app: tauri::AppHandle, path: String, prompt: String) -> Result<(), String> {
    let (distro, unix_path) = get_wsl_distro_and_unix_path(&path);

    let command_payload = format!(
        "if command -v zsh >/dev/null; then exec zsh -l -i -c 'opencode {}; exec zsh'; else exec bash -l -i -c 'opencode {}; exec bash'; fi",
        prompt, prompt
    );

    Command::new("cmd.exe")
        .args(&[
            "/C", "start", "wsl.exe", "-d", &distro, "--cd", &unix_path, "-e", "sh", "-c", &command_payload,
        ])
        .spawn()
        .map_err(|e| e.to_string())?;

    hide_window(&app);
    Ok(())
}

#[tauri::command]
fn launch_editor(
    app: tauri::AppHandle,
    editor: String,
    env: String,
    path: String,
) -> Result<(), String> {
    let antigravity_path = env_config("ANTIGRAVITY_PATH", r"D:\Program Files\Antigravity IDE\Antigravity IDE.exe");
    let visualstudio_path = env_config(
        "VISUALSTUDIO_PATH",
        r"C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\devenv.exe",
    );
    let vscode_bin = env_config("VSCODE_BIN", "code");

    if env == "wsl" {
        let (distro, unix_path) = get_wsl_distro_and_unix_path(&path);

        match editor.as_str() {
            "vscode" => {
                let uri = format!("vscode-remote://wsl+{}{}", distro, unix_path);
                Command::new("cmd.exe")
                    .args(&["/C", &vscode_bin, "--folder-uri", &uri])
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            "antigravity" => {
                Command::new(&antigravity_path)
                    .args(&["--remote", &format!("wsl+{}", distro), &unix_path])
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            "visualstudio" => {
                let wsl_net_path = get_wsl_network_path(&path);
                Command::new(&visualstudio_path)
                    .arg(&wsl_net_path)
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            _ => return Err(format!("Editor '{}' does not support WSL", editor)),
        }
    } else {
        match editor.as_str() {
            "vscode" => {
                Command::new("cmd.exe")
                    .args(&["/C", &vscode_bin, &format!("\"{}\"", path)])
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            "antigravity" => {
                Command::new(&antigravity_path)
                    .arg(&path)
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            "visualstudio" => {
                Command::new(&visualstudio_path)
                    .arg(&path)
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            _ => return Err("Unknown editor".to_string()),
        }
    }

    hide_window(&app);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let shortcut =
                Shortcut::new(Some(Modifiers::ALT), Code::Space);

            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut(shortcut, move |_app, s, event| {
                if s == &shortcut && event.state() == ShortcutState::Pressed {
                    if let Some(window) = handle.get_webview_window("main") {
                        let is_visible = window.is_visible().unwrap_or(false);
                        if is_visible {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
            })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_directory,
            open_powershell,
            open_cmd,
            open_vscode,
            open_wsl_opencode,
            launch_editor
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
