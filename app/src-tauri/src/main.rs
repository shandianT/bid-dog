#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop_state;

use desktop_state::{
    aggregate_progress, close_action, should_send_shutdown, CloseAction, JobNotification,
    JobSnapshot, NotificationKind, NotificationTracker, ProgressKind,
};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_notification::NotificationExt;

// v0.19.2 使用版本专属端口：覆盖安装时旧 PyInstaller onefile 进程可能仍驻留，
// 不能因历史端口“有人监听”就复用旧引擎。下一次不兼容升级也应换新端口。
const ENGINE_PORT: u16 = 18901;
const JOB_POLL_INTERVAL: Duration = Duration::from_secs(3);
const TRAY_ID: &str = "bid-dog-main";
const TRAY_OPEN_ID: &str = "open-main-window";
const TRAY_QUIT_ID: &str = "quit-bid-dog";

struct DesktopRuntime {
    engine: Mutex<Option<Child>>,
    primary_instance: AtomicBool,
    explicit_quit: AtomicBool,
    shutdown_sent: AtomicBool,
    jobs_known: AtomicBool,
    active_jobs: AtomicUsize,
}

impl Default for DesktopRuntime {
    fn default() -> Self {
        Self {
            engine: Mutex::new(None),
            primary_instance: AtomicBool::new(false),
            explicit_quit: AtomicBool::new(false),
            shutdown_sent: AtomicBool::new(false),
            jobs_known: AtomicBool::new(false),
            active_jobs: AtomicUsize::new(0),
        }
    }
}

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
        if !has_user_data(&new) && has_user_data(&old) {
            old
        } else {
            new
        }
    } else if old.exists() {
        if fs::rename(&old, &new).is_ok() {
            new
        } else {
            old
        }
    } else {
        new
    };
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn resolve_engine_sidecar(app_executable: &Path) -> Result<PathBuf, String> {
    let dir = app_executable
        .parent()
        .ok_or_else(|| format!("桌面程序路径没有父目录: {}", app_executable.display()))?;
    let name = if cfg!(windows) {
        "bid-engine.exe"
    } else {
        "bid-engine"
    };
    let path = dir.join(name);
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!("找不到本地引擎，已检查: {}", path.display()))
    }
}

fn append_bootstrap_log(data: Option<&Path>, message: &str) {
    let Some(dir) = data else { return };
    let path = dir.join("engine-bootstrap.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", message);
    }
}

// 内置引擎随应用启动;端口被占=本应用的另一个实例已在跑,不重复拉起
fn spawn_engine() -> Option<Child> {
    if port_busy(ENGINE_PORT) {
        return None;
    }
    let data = data_dir();
    let exe = match std::env::current_exe() {
        Ok(value) => value,
        Err(error) => {
            append_bootstrap_log(data.as_deref(), &format!("读取桌面程序路径失败: {error}"));
            return None;
        }
    };
    let path = match resolve_engine_sidecar(&exe) {
        Ok(value) => value,
        Err(error) => {
            append_bootstrap_log(data.as_deref(), &error);
            return None;
        }
    };
    append_bootstrap_log(
        data.as_deref(),
        &format!("找到本地引擎: {}", path.display()),
    );
    let mut cmd = Command::new(&path);
    cmd.env("PORT", ENGINE_PORT.to_string());
    if let Some(data) = data.as_ref() {
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
    match cmd.spawn() {
        Ok(child) => {
            append_bootstrap_log(
                data.as_deref(),
                &format!("本地引擎已启动，端口 {ENGINE_PORT}"),
            );
            Some(child)
        }
        Err(error) => {
            append_bootstrap_log(data.as_deref(), &format!("本地引擎启动失败: {error}"));
            None
        }
    }
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

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn install_tray(
    app: &mut tauri::App,
    runtime: Arc<DesktopRuntime>,
) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, TRAY_OPEN_ID, "打开中标狗", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "退出中标狗", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let quit_runtime = runtime.clone();
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("中标狗")
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            if event.id() == TRAY_OPEN_ID {
                show_main_window(app);
            } else if event.id() == TRAY_QUIT_ID {
                // Only this explicit action (or a normal OS quit request) is allowed to
                // enter the engine shutdown path. A secondary instance never reaches setup.
                quit_runtime.explicit_quit.store(true, Ordering::Release);
                app.exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn fetch_jobs(port: u16) -> Option<Vec<JobSnapshot>> {
    let addr = format!("127.0.0.1:{port}").parse().ok()?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(700)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    stream
        .set_write_timeout(Some(Duration::from_millis(700)))
        .ok()?;
    let request = format!(
        "GET /v1/jobs HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).ok()?;
    let header_end = response.windows(4).position(|part| part == b"\r\n\r\n")?;
    let headers = std::str::from_utf8(&response[..header_end]).ok()?;
    if !headers.lines().next()?.contains(" 200 ") {
        return None;
    }
    serde_json::from_slice(&response[header_end + 4..]).ok()
}

fn send_job_notification(app: &tauri::AppHandle, notice: JobNotification) {
    // Deliberately omit customer/project names from OS notifications. They may be visible
    // on a locked screen; the job id is only used internally for transition de-duplication.
    let (title, body) = match notice.kind {
        NotificationKind::NeedsAttention => (
            "有一项需要你确认",
            "中标狗已在后台暂停此任务，打开应用即可处理。",
        ),
        NotificationKind::Done => (
            "标书已生成完成",
            "中标狗已完成一项任务，可以打开应用检查交付文件。",
        ),
        NotificationKind::Failed => (
            "任务未完成",
            "请打开中标狗查看原因，已经生成的内容仍会保留。",
        ),
    };
    let _ = app.notification().builder().title(title).body(body).show();
}

fn update_desktop_progress(app: &tauri::AppHandle, jobs: &[JobSnapshot]) -> usize {
    let summary = aggregate_progress(jobs);
    let status = match summary.kind {
        ProgressKind::None => ProgressBarStatus::None,
        ProgressKind::Normal => ProgressBarStatus::Normal,
        ProgressKind::Paused => ProgressBarStatus::Paused,
        ProgressKind::Indeterminate => ProgressBarStatus::Indeterminate,
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_progress_bar(ProgressBarState {
            status: Some(status),
            progress: summary.percent,
        });
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let tooltip = if summary.active_jobs == 0 {
            "中标狗".to_string()
        } else {
            format!("中标狗 · {} 项处理中", summary.active_jobs)
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
    summary.active_jobs
}

fn start_job_monitor(app: tauri::AppHandle, runtime: Arc<DesktopRuntime>) {
    std::thread::spawn(move || {
        let mut tracker = NotificationTracker::default();
        loop {
            if let Some(jobs) = fetch_jobs(ENGINE_PORT) {
                let notices = tracker.observe(&jobs);
                let active_jobs = update_desktop_progress(&app, &jobs);
                runtime.active_jobs.store(active_jobs, Ordering::Release);
                runtime.jobs_known.store(true, Ordering::Release);
                for notice in notices {
                    send_job_notification(&app, notice);
                }
            }
            std::thread::sleep(JOB_POLL_INTERVAL);
        }
    });
}

fn shutdown_owned_engine(runtime: &DesktopRuntime) {
    let is_primary = runtime.primary_instance.load(Ordering::Acquire);
    let explicit_quit = runtime.explicit_quit.load(Ordering::Acquire);
    let already_sent = runtime.shutdown_sent.load(Ordering::Acquire);
    if !should_send_shutdown(is_primary, explicit_quit, already_sent)
        || runtime
            .shutdown_sent
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
    {
        return;
    }

    let asked = ask_engine_to_shutdown(ENGINE_PORT);
    if let Ok(mut guard) = runtime.engine.lock() {
        if let Some(child) = guard.as_mut() {
            if asked {
                // The engine may deliberately remain alive to finish and settle active work.
                std::thread::sleep(Duration::from_millis(300));
                let _ = child.try_wait();
            } else {
                // Explicit quit and an unreachable owned engine: do not leave a dead child.
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn main() {
    let runtime = Arc::new(DesktopRuntime::default());
    let setup_runtime = runtime.clone();
    let window_runtime = runtime.clone();
    let exit_runtime = runtime.clone();

    tauri::Builder::default()
        // Keep this first. Secondary processes are terminated before setup, so they can
        // neither spawn an engine nor enter this process's shutdown path.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            setup_runtime
                .primary_instance
                .store(true, Ordering::Release);
            if let Ok(mut child) = setup_runtime.engine.lock() {
                *child = spawn_engine();
            }
            install_tray(app, setup_runtime.clone())?;
            start_job_monitor(app.handle().clone(), setup_runtime.clone());
            Ok(())
        })
        .on_window_event(move |window, event| {
            if window.label() != "main" || window_runtime.explicit_quit.load(Ordering::Acquire) {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let action = close_action(
                    window_runtime.jobs_known.load(Ordering::Acquire),
                    window_runtime.active_jobs.load(Ordering::Acquire),
                );
                match action {
                    CloseAction::HideToTray => {
                        // Do not destroy active (or not-yet-observed) work. It stays available
                        // from the tray and native progress/notifications continue.
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    CloseAction::Exit => {
                        // Known-idle close is a normal explicit exit. Drive it through the same
                        // guarded shutdown path on macOS and Windows instead of destroying only
                        // the webview and leaving an invisible process behind.
                        api.prevent_close();
                        window_runtime.explicit_quit.store(true, Ordering::Release);
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running bid-assistant")
        .run(move |app, event| match event {
            RunEvent::ExitRequested { .. }
                if exit_runtime.primary_instance.load(Ordering::Acquire) =>
            {
                // Cmd+Q / normal OS quit is explicit. Window close with active work was
                // intercepted above, while a secondary instance never reaches setup.
                exit_runtime.explicit_quit.store(true, Ordering::Release);
            }
            RunEvent::Exit => shutdown_owned_engine(&exit_runtime),
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_main_window(app),
            _ => {}
        });
}

#[cfg(test)]
mod engine_sidecar_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("bid-dog-{label}-{}-{stamp}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_engine_sidecar_returns_the_checked_path() {
        let dir = temp_dir("missing-engine");
        let app = dir.join(if cfg!(windows) {
            "bid-assistant.exe"
        } else {
            "bid-assistant"
        });

        let error = resolve_engine_sidecar(&app).unwrap_err();

        assert!(error.contains("bid-engine"));
        assert!(error.contains(dir.to_string_lossy().as_ref()));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn engine_sidecar_resolves_next_to_the_desktop_executable() {
        let dir = temp_dir("found-engine");
        let app = dir.join(if cfg!(windows) {
            "bid-assistant.exe"
        } else {
            "bid-assistant"
        });
        let expected = dir.join(if cfg!(windows) {
            "bid-engine.exe"
        } else {
            "bid-engine"
        });
        fs::write(&expected, b"fixture").unwrap();

        assert_eq!(resolve_engine_sidecar(&app).unwrap(), expected);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn engine_sidecar_resolves_in_unicode_and_space_install_path() {
        let root = temp_dir("unicode-engine");
        let dir = root.join("客户资料 空格").join("中标狗 安装目录");
        fs::create_dir_all(&dir).unwrap();
        let app = dir.join(if cfg!(windows) {
            "中标狗.exe"
        } else {
            "中标狗"
        });
        let expected = dir.join(if cfg!(windows) {
            "bid-engine.exe"
        } else {
            "bid-engine"
        });
        fs::write(&expected, b"fixture").unwrap();

        assert_eq!(resolve_engine_sidecar(&app).unwrap(), expected);
        let _ = fs::remove_dir_all(root);
    }
}
