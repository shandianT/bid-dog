#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

// 应用自带引擎用专属端口:8080 上若有旧版/手动引擎也绝不会被误用
const ENGINE_PORT: u16 = 8848;

fn port_busy(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(400),
    )
    .is_ok()
}

fn data_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    let dir = PathBuf::from(home).join("Documents").join("标书助手");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

// 内置引擎随应用启动;端口被占=本应用的另一个实例已在跑,不重复拉起
fn spawn_engine() -> Option<Child> {
    if port_busy(ENGINE_PORT) {
        return None;
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = if cfg!(windows) { "bid-engine.exe" } else { "bid-engine" };
    let path = dir.join(name);
    if !path.exists() {
        return None; // 未打包 sidecar 的开发态:前端自动进演示模式
    }
    let mut cmd = Command::new(&path);
    cmd.env("PORT", ENGINE_PORT.to_string());
    if let Some(data) = data_dir() {
        if let Ok(log) = fs::File::create(data.join("engine.log")) {
            if let Ok(log2) = log.try_clone() {
                cmd.stdout(Stdio::from(log)).stderr(Stdio::from(log2));
            }
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW:不闪黑窗
    }
    cmd.spawn().ok()
}

fn main() {
    let engine: Mutex<Option<Child>> = Mutex::new(spawn_engine());
    tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("error while running bid-assistant")
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Ok(mut guard) = engine.lock() {
                    if let Some(child) = guard.as_mut() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        });
}
