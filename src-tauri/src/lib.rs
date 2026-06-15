mod stats;

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

    let distro = env::var("WSL_DISTRO").unwrap_or_else(|_| "Ubuntu".to_string());
    let clean_path = path.replace('\\', "/");
    if let Some((drive, rest)) = clean_path.split_once(':') {
        let drive_letter = drive.to_lowercase();
        let unix_path = format!("/mnt/{}{}", drive_letter, rest);
        return (distro, unix_path);
    }

    (distro, clean_path)
}


// Converts a Windows local path to a WSL network share path so Windows native IDEs can open it directly
fn get_wsl_network_path(path: &str) -> String {
    if path.starts_with(r"\\wsl.localhost\") || path.starts_with(r"\\wsl$\") {
        return path.to_string();
    }

    let distro = env::var("WSL_DISTRO").unwrap_or_else(|_| "Ubuntu".to_string());
    let clean_path = path.replace('\\', "/");
    if let Some((drive, rest)) = clean_path.split_once(':') {
        let drive_letter = drive.to_lowercase();
        return format!(r"\\wsl.localhost\{}\mnt\{}{}", distro, drive_letter, rest.replace('/', "\\"));
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
        .args(&[
            "-NoProfile",
            "-Command",
            &format!(
                "Start-Process powershell.exe -ArgumentList '-NoExit -Command Set-Location -LiteralPath \"{}\"'",
                path.replace('"', "`\"")
            ),
        ])
        .spawn()
        .map_err(|e| e.to_string())?;
    hide_window(&app);
    Ok(())
}

#[tauri::command]
fn open_wsl(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let (distro, unix_path) = get_wsl_distro_and_unix_path(&path);

    let wt_result = Command::new("wt.exe")
        .args(&["new-tab", "--", "wsl.exe", "-d", &distro, "--", "bash", "-c", &format!("cd '{}' && exec bash", unix_path.replace('\'', "'\\''"))])
        .spawn();

    if wt_result.is_err() {
        Command::new("cmd.exe")
            .args(&["/C", "start", "WSL", "wsl.exe", "-d", &distro, "--", "bash", "-c", &format!("cd '{}' && exec bash", unix_path.replace('\'', "'\\''"))])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    hide_window(&app);
    Ok(())
}

#[tauri::command]
fn open_cmd(app: tauri::AppHandle, path: String) -> Result<(), String> {
    Command::new("cmd.exe")
        .args(&[
            "/C",
            "start",
            "cmd.exe",
            "/K",
            &format!("cd /d \"{}\"", path),
        ])
        .spawn()
        .map_err(|e| e.to_string())?;
    hide_window(&app);
    Ok(())
}

fn resolve_vscode() -> String {
    if let Ok(val) = env::var("VSCODE_BIN") {
        if val != "code" { return val; }
    }
    if let Ok(local) = env::var("LOCALAPPDATA") {
        let p = Path::new(&local).join(r"Programs\Microsoft VS Code\Code.exe");
        if p.exists() { return p.to_string_lossy().to_string(); }
    }
    let sys = Path::new(r"C:\Program Files\Microsoft VS Code\Code.exe");
    if sys.exists() { return sys.to_string_lossy().to_string(); }
    "code".to_string()
}

fn resolve_antigravity() -> String {
    if let Ok(val) = env::var("ANTIGRAVITY_PATH") { return val; }
    if let Ok(home) = env::var("USERPROFILE") {
        let p = Path::new(&home)
            .join(r"AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Antigravity IDE\Antigravity.exe");
        if p.exists() { return p.to_string_lossy().to_string(); }
    }
    let candidates: [&str; 5] = [
        r"C:\Users\User\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Antigravity IDE\Antigravity.exe",
        r"D:\Program Files\Antigravity IDE\Antigravity IDE.exe",
        r"C:\Program Files\Antigravity IDE\Antigravity IDE.exe",
        r"C:\Program Files\Antigravity IDE\Antigravity.exe",
        "antigravity",
    ];
    for c in &candidates {
        let p = Path::new(c);
        if p.exists() { return p.to_string_lossy().to_string(); }
    }
    candidates[0].to_string()
}

#[tauri::command]
fn open_vscode(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let vscode_bin = resolve_vscode();
    if path.starts_with(r"\\wsl.localhost\") || path.starts_with(r"\\wsl$\") {
        let clean_path = path
            .replace(r"\\wsl.localhost\", "")
            .replace(r"\\wsl$\", "");

        if let Some((distro, internal)) = clean_path.split_once('\\') {
            let unix_path = format!("/{}", internal.replace('\\', "/"));
            let uri = format!("vscode-remote://wsl+{}{}", distro, unix_path);

            Command::new(&vscode_bin)
                .args(&["--folder-uri", &uri])
                .spawn()
                .map_err(|e| e.to_string())?;
            hide_window(&app);
            return Ok(());
        }
    }

    Command::new(&vscode_bin)
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    hide_window(&app);
    Ok(())
}

#[tauri::command]
fn open_wsl_opencode(app: tauri::AppHandle, path: String, prompt: String) -> Result<(), String> {
    let (distro, unix_path) = get_wsl_distro_and_unix_path(&path);
    let opencode_bin = env::var("OPENCODE_BIN").unwrap_or_else(|_| "$HOME/.opencode/bin/opencode".to_string());

    let shell_cmd = format!(
        "cd '{}' && {}",
        unix_path.replace('\'', "'\\''"),
        opencode_bin
    );

    let wt_result = Command::new("wt.exe")
        .args(&[
            "new-tab", "--",
            "wsl.exe", "-d", &distro,
            "--", "bash", "-c", &shell_cmd,
        ])
        .spawn();

    if wt_result.is_err() {
        Command::new("cmd.exe")
            .args(&[
                "/C", "start", "OpenCode",
                "wsl.exe", "-d", &distro,
                "--", "bash", "-c", &shell_cmd,
            ])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    if !prompt.is_empty() {
        let clean_prompt = prompt
            .replace('{', "{{}}")
            .replace('}', "{}}")
            .replace('(', "{(}")
            .replace(')', "{)}")
            .replace('+', "{+}")
            .replace('^', "{^}")
            .replace('%', "{%}")
            .replace('~', "{~}")
            .replace('[', "{[}")
            .replace(']', "{]}");

        // "OpenCode" matches the exact tab title shown in Windows Terminal
        let ps_script = format!(
            "$wshell = New-Object -ComObject wscript.shell; \
             Start-Sleep -Milliseconds 3000; \
             [void] $wshell.AppActivate('OpenCode'); \
             Start-Sleep -Milliseconds 500; \
             $wshell.SendKeys('{}~');",
            clean_prompt
        );

        Command::new("powershell.exe")
            .args(&["-NoProfile", "-WindowStyle", "Hidden", "-Command", &ps_script])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

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
    let vscode_bin = resolve_vscode();
    let antigravity_bin = resolve_antigravity();
    let visualstudio_bin = env::var("VISUALSTUDIO_PATH").unwrap_or_else(|_| r"C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\devenv.exe".to_string());

    if env == "wsl" {
        let (distro, unix_path) = get_wsl_distro_and_unix_path(&path);

        match editor.as_str() {
            "vscode" => {
                let uri = format!("vscode-remote://wsl+{}{}", distro, unix_path);
                Command::new(&vscode_bin)
                    .args(&["--folder-uri", &uri])
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            "antigravity" => {
                Command::new(&antigravity_bin)
                    .args(&["--remote", &format!("wsl+{}", distro), &unix_path])
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            "visualstudio" => {
                let wsl_net_path = get_wsl_network_path(&path);
                Command::new(&visualstudio_bin)
                    .arg(&wsl_net_path)
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            _ => return Err(format!("Editor '{}' does not support WSL", editor)),
        }
    } else {
        match editor.as_str() {
            "vscode" => {
                Command::new(&vscode_bin)
                    .arg(&path)
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            "antigravity" => {
                Command::new(&antigravity_bin)
                    .arg(&path)
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            "visualstudio" => {
                Command::new(&visualstudio_bin)
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

#[tauri::command]
fn record_navigate(path: String, name: String, is_dir: bool, state: tauri::State<'_, stats::StatsDb>) -> Result<(), String> {
    state.record_navigate(&path, &name, is_dir)
}

#[tauri::command]
fn record_pass_through(path: String, name: String, state: tauri::State<'_, stats::StatsDb>) -> Result<(), String> {
    state.record_pass_through(&path, &name)
}

#[tauri::command]
fn record_select(path: String, name: String, is_dir: bool, state: tauri::State<'_, stats::StatsDb>) -> Result<(), String> {
    state.record_select(&path, &name, is_dir)
}

#[tauri::command]
fn record_tool(
    tool_name: String,
    editor_name: Option<String>,
    env: Option<String>,
    path: String,
    name: String,
    state: tauri::State<'_, stats::StatsDb>,
) -> Result<(), String> {
    state.record_tool(&tool_name, editor_name.as_deref(), env.as_deref(), &path, &name)
}

#[tauri::command]
fn get_frequent_nodes(limit: i64, state: tauri::State<'_, stats::StatsDb>) -> Result<Vec<stats::NodeStat>, String> {
    state.get_frequent_nodes(limit)
}

#[tauri::command]
fn get_frequent_tools(limit: i64, state: tauri::State<'_, stats::StatsDb>) -> Result<Vec<stats::ToolStat>, String> {
    state.get_frequent_tools(limit)
}

fn load_env() {
    if let Ok(exe) = std::env::current_exe() {
        let mut root = exe.parent();
        for _ in 0..3 {
            root = root.and_then(|p| p.parent());
        }
        if let Some(dir) = root {
            let candidate = dir.join(".env");
            if candidate.exists() {
                dotenvy::from_path(candidate).ok();
                return;
            }
        }
    }
    dotenvy::dotenv().ok();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_env();
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
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

            let stats_db = app.path().app_data_dir()
                .map(|d| d.join("stats.db"))
                .ok()
                .and_then(|p| stats::StatsDb::new(p).ok())
                .or_else(|| {
                    let tmp = std::env::temp_dir().join("bubble-nav-stats.db");
                    stats::StatsDb::new(tmp).ok()
                })
                .unwrap_or_else(|| {
                    let conn = rusqlite::Connection::open_in_memory()
                        .expect("Failed to create in-memory DB");
                    stats::StatsDb::with_connection(conn)
                });
            app.manage(stats_db);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_directory,
            open_powershell,
            open_cmd,
            open_wsl,
            open_vscode,
            open_wsl_opencode,
            launch_editor,
            record_navigate,
            record_pass_through,
            record_select,
            record_tool,
            get_frequent_nodes,
            get_frequent_tools
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── get_wsl_distro_and_unix_path ─────────────────────────────────────────

    #[test]
    fn test_wsl_path_local_drive() {
        let (distro, unix) = get_wsl_distro_and_unix_path(r"C:\Users\test\file.txt");
        assert_eq!(distro, "Ubuntu");
        assert_eq!(unix, "/mnt/c/Users/test/file.txt");
    }

    #[test]
    fn test_wsl_path_local_drive_trailing_slash() {
        let (distro, unix) = get_wsl_distro_and_unix_path(r"D:\Projects\");
        assert_eq!(unix, "/mnt/d/Projects/");
    }

    #[test]
    fn test_wsl_path_wsl_localhost() {
        let (distro, unix) = get_wsl_distro_and_unix_path(r"\\wsl.localhost\Ubuntu\home\user\file.rs");
        assert_eq!(distro, "Ubuntu");
        assert_eq!(unix, "/home/user/file.rs");
    }

    #[test]
    fn test_wsl_path_wsl_dollar() {
        let (distro, unix) = get_wsl_distro_and_unix_path(r"\\wsl$\Debian\var\log");
        assert_eq!(distro, "Debian");
        assert_eq!(unix, "/var/log");
    }

    #[test]
    fn test_wsl_path_already_unix() {
        let (distro, unix) = get_wsl_distro_and_unix_path("/home/user");
        assert_eq!(distro, "Ubuntu");
        assert_eq!(unix, "/home/user");
    }

    // ── get_wsl_network_path ──────────────────────────────────────────────────

    #[test]
    fn test_network_path_local_drive() {
        let net = get_wsl_network_path(r"C:\Users\test");
        assert_eq!(net, r"\\wsl.localhost\Ubuntu\mnt\c\Users\test");
    }

    #[test]
    fn test_network_path_wsl_localhost_passthrough() {
        let net = get_wsl_network_path(r"\\wsl.localhost\Ubuntu\home");
        assert_eq!(net, r"\\wsl.localhost\Ubuntu\home");
    }

    #[test]
    fn test_network_path_wsl_dollar_passthrough() {
        let net = get_wsl_network_path(r"\\wsl$\Debian\tmp");
        assert_eq!(net, r"\\wsl$\Debian\tmp");
    }

    #[test]
    fn test_network_path_drive_letter_d() {
        let net = get_wsl_network_path(r"D:\data\file.txt");
        assert_eq!(net, r"\\wsl.localhost\Ubuntu\mnt\d\data\file.txt");
    }

    #[test]
    fn test_network_path_no_drive() {
        let net = get_wsl_network_path(r"\share\folder");
        assert_eq!(net, r"\share\folder");
    }

    // ── FileItem ordering ────────────────────────────────────────────────────

    #[test]
    fn test_file_item_sort_dirs_first_then_alpha() {
        let mut items = vec![
            FileItem { name: "zed.txt".into(), path: "/z".into(), is_dir: false },
            FileItem { name: "alpha".into(),   path: "/a".into(), is_dir: true },
            FileItem { name: "Beta".into(),     path: "/b".into(), is_dir: true },
            FileItem { name: "gamma.txt".into(),path: "/g".into(), is_dir: false },
        ];
        items.sort_by(|a, b| {
            if a.is_dir != b.is_dir {
                b.is_dir.cmp(&a.is_dir)
            } else {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            }
        });
        assert_eq!(items[0].name, "alpha");   // dir, a
        assert_eq!(items[1].name, "Beta");    // dir, b
        assert_eq!(items[2].name, "gamma.txt");
        assert_eq!(items[3].name, "zed.txt");
    }
}
