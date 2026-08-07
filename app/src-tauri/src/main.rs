#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

// v0.18.2 使用版本专属端口：覆盖安装时旧 PyInstaller onefile 进程可能仍驻留，
// 不能因历史端口“有人监听”就复用旧引擎。下一次不兼容升级也应换新端口。
const ENGINE_PORT: u16 = 18802;

fn port_busy(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(400),
    )
    .is_ok()
}

fn data_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    let base = PathBuf::from(home).join("Documents");
    let new = base.join("中标狗");
    let old = base.join("标书助手");
    let has_user_data = |dir: &PathBuf| {
        dir.join("config.json").is_file()
            || dir.join("jobs").is_dir()
            || dir.join("素材库").is_dir()
    };
    // 壳层会先创建 engine.log，所以数据目录迁移必须在打开日志之前完成。
    // 若两边都存在，绝不合并或覆盖：优先已有新目录；只有新目录没有用户数据时才继续用旧目录。
    let dir = if new.exists() {
        if !has_user_data(&new) && has_user_data(&old) { old } else { new }
    } else if old.exists() {
        if fs::rename(&old, &new).is_ok() { new } else { old }
    } else {
        new
    };
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
        cmd.env("BID_HOME", &data);
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

/// 关窗时先礼后兵:请引擎自己收尾。
///
/// 以前这里是无条件 `child.kill()`。但 agent 是引擎用 `start_new_session=True` 起的
/// 独立进程组 —— **杀得掉引擎，杀不掉 agent**。结果是 agent 还在后台写文件，
/// 而负责收尾的那段代码（拼册、出 Word、质检、完成播报）已经跟着引擎一起死了：
/// 用户关窗去开个会，回来看到的是一个永远没有结局的任务。
///
/// 现在改成发一个最小 HTTP 请求给 /v1/shutdown（手写，不为这一件事引入 reqwest）：
/// - 没有任务在跑 → 引擎立刻退出，行为跟以前一样；
/// - 还有任务在跑 → 引擎留下来把它跑完、收好尾，然后自己退。
///
/// 返回 true 表示引擎收到了请求（不管它选择立刻退还是留下），此时不要再 kill。
fn ask_engine_to_shutdown(port: u16) -> bool {
    let addr = match format!("127.0.0.1:{}", port).parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut s = match TcpStream::connect_timeout(&addr, Duration::from_millis(600)) {
        Ok(s) => s,
        Err(_) => return false, // 引擎已经不在了,没什么可关的
    };
    let _ = s.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = s.set_write_timeout(Some(Duration::from_millis(600)));
    let req = format!(
        "POST /v1/shutdown HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        port
    );
    if s.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 256];
    // 读到任何响应都算送达;读不到也不强杀——宁可留一个引擎进程,也不要留一个
    // 永远没有结局的任务(引擎自己有空闲自退逻辑)
    matches!(s.read(&mut buf), Ok(n) if n > 0)
}

fn main() {
    let engine: Mutex<Option<Child>> = Mutex::new(spawn_engine());
    tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("error while running bid-assistant")
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                let asked = ask_engine_to_shutdown(ENGINE_PORT);
                if let Ok(mut guard) = engine.lock() {
                    if let Some(child) = guard.as_mut() {
                        if asked {
                            // 引擎收到了收尾请求:给它一点时间自己走,不强杀
                            std::thread::sleep(Duration::from_millis(300));
                            if let Ok(Some(_)) = child.try_wait() {
                                return; // 已经退了(说明没有任务在跑)
                            }
                            return; // 还没退 = 它在把任务跑完,让它继续
                        }
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        });
}
