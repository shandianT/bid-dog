#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop_state;

use desktop_state::{
    aggregate_progress, close_action, should_send_shutdown, CloseAction, JobNotification,
    JobSnapshot, NotificationKind, NotificationTracker, ProgressKind,
};
use serde::Serialize;
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

// 桌面版只连这一个明确端口。覆盖升级时若还是可验证的中标狗旧引擎，
// 壳层会请它安全收尾后自动接管；未知进程永远不会被关闭。
const ENGINE_PORT: u16 = 18901;
const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
const ENGINE_AUTHOR: &str = "FDE-家涛";
const JOB_POLL_INTERVAL: Duration = Duration::from_secs(3);
const HANDOVER_RECHECK_INTERVAL: Duration = Duration::from_secs(3);
const TRAY_ID: &str = "bid-dog-main";
const TRAY_OPEN_ID: &str = "open-main-window";
const TRAY_QUIT_ID: &str = "quit-bid-dog";

struct DesktopRuntime {
    engine: Mutex<Option<Child>>,
    engine_starting: AtomicBool,
    trusted_engine: AtomicBool,
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
            engine_starting: AtomicBool::new(false),
            trusted_engine: AtomicBool::new(false),
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EngineHandover {
    ReuseCurrent,
    ReplaceTrustedOld,
    BlockedForeign,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EngineRepairDecision {
    ReuseCurrent,
    ReplaceTrustedOld,
    RestartOwned,
    RestartVerifiedStale,
    StartFresh,
    BlockedUnverified,
}

fn classify_repair(
    has_owned_child: bool,
    busy: bool,
    probe: Option<EngineHandover>,
    has_verified_stale_listener: bool,
) -> EngineRepairDecision {
    match probe {
        Some(EngineHandover::ReuseCurrent) => EngineRepairDecision::ReuseCurrent,
        Some(EngineHandover::ReplaceTrustedOld) => EngineRepairDecision::ReplaceTrustedOld,
        Some(EngineHandover::BlockedForeign) => EngineRepairDecision::BlockedUnverified,
        None if has_owned_child => EngineRepairDecision::RestartOwned,
        None if has_verified_stale_listener => EngineRepairDecision::RestartVerifiedStale,
        None if !busy => EngineRepairDecision::StartFresh,
        None => EngineRepairDecision::BlockedUnverified,
    }
}

#[derive(Serialize)]
struct EngineRepairResult {
    ok: bool,
    action: &'static str,
    message: String,
    detail: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ShutdownState {
    ExitingNow,
    Draining { running: u64 },
}

fn release_version(value: &str) -> Option<[u64; 3]> {
    let core = value
        .trim()
        .strip_prefix('v')
        .unwrap_or(value.trim())
        .split(['-', '+'])
        .next()?;
    let parts = core
        .split('.')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    (parts.len() == 3).then(|| [parts[0], parts[1], parts[2]])
}

fn classify_engine_health(health: &serde_json::Value) -> EngineHandover {
    let ok = health.get("ok").and_then(|value| value.as_bool()) == Some(true);
    let version = health.get("version").and_then(|value| value.as_str());
    let author = health.get("author").and_then(|value| value.as_str());
    let features = health.get("features").and_then(|value| value.as_array());
    let has_feature = |name: &str| {
        features.is_some_and(|items| items.iter().any(|item| item.as_str() == Some(name)))
    };
    if !ok
        || author != Some(ENGINE_AUTHOR)
        || !has_feature("job_start")
        || !has_feature("job_delete")
    {
        return EngineHandover::BlockedForeign;
    }
    if version == Some(ENGINE_VERSION) {
        EngineHandover::ReuseCurrent
    } else {
        match (
            version.and_then(release_version),
            release_version(ENGINE_VERSION),
        ) {
            (Some(found), Some(current)) if found < current => EngineHandover::ReplaceTrustedOld,
            _ => EngineHandover::BlockedForeign,
        }
    }
}

fn shutdown_state(reply: &serde_json::Value) -> Option<ShutdownState> {
    if reply.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        return None;
    }
    let running = reply
        .get("running")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    if reply.get("exiting").and_then(|value| value.as_bool()) == Some(true) {
        Some(ShutdownState::ExitingNow)
    } else {
        Some(ShutdownState::Draining { running })
    }
}

fn engine_http_json(port: u16, method: &str, path: &str) -> Option<serde_json::Value> {
    let addr = format!("127.0.0.1:{port}").parse().ok()?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(700)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    stream
        .set_write_timeout(Some(Duration::from_millis(700)))
        .ok()?;
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
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

fn probe_engine(port: u16) -> Option<(EngineHandover, serde_json::Value)> {
    let health = engine_http_json(port, "GET", "/v1/health")?;
    Some((classify_engine_health(&health), health))
}

fn attach_engine(port: u16) -> bool {
    engine_http_json(port, "POST", "/v1/attach")
        .and_then(|reply| reply.get("ok").and_then(|value| value.as_bool()))
        == Some(true)
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

// 内置引擎随应用启动；端口处理由 start_engine_with_handover 先做身份验证。
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

fn spawn_and_store_engine(runtime: &DesktopRuntime, data: Option<&Path>) -> bool {
    if runtime
        .engine_starting
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        append_bootstrap_log(data, "已有引擎启动流程在进行，复用本次启动。");
        return true;
    }
    struct StartingGuard<'a>(&'a AtomicBool);
    impl Drop for StartingGuard<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }
    let _starting = StartingGuard(&runtime.engine_starting);
    let mut spawned = spawn_engine();
    let mut ready = spawned.is_some();
    if let Some(child) = spawned.as_mut() {
        let started = std::time::Instant::now();
        while started.elapsed() < Duration::from_secs(2) && !port_busy(ENGINE_PORT) {
            if child.try_wait().ok().flatten().is_some() {
                ready = false;
                spawned = None;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    if let Ok(mut child) = runtime.engine.lock() {
        *child = spawned;
    }
    runtime.trusted_engine.store(ready, Ordering::Release);
    if !ready {
        append_bootstrap_log(data, "端口已可用，但新版引擎启动失败；请运行一键诊断。");
    }
    ready
}

fn wait_for_port_then_spawn(
    runtime: Arc<DesktopRuntime>,
    data: Option<PathBuf>,
    refresh_trusted_shutdown: bool,
) {
    std::thread::spawn(move || loop {
        if runtime.explicit_quit.load(Ordering::Acquire) {
            return;
        }
        if !port_busy(ENGINE_PORT) {
            let _ = spawn_and_store_engine(&runtime, data.as_deref());
            return;
        }

        std::thread::sleep(HANDOVER_RECHECK_INTERVAL);
        if !refresh_trusted_shutdown {
            continue;
        }
        // 旧版 health 会把“退出后自动关闭”视为用户重新打开应用而撤销。
        // 因此每次先重新验证身份，再恢复一次优雅退出；绝不对未知进程发关闭请求。
        match probe_engine(ENGINE_PORT) {
            Some((EngineHandover::ReplaceTrustedOld, _)) => {
                if engine_http_json(ENGINE_PORT, "POST", "/v1/shutdown")
                    .as_ref()
                    .and_then(shutdown_state)
                    .is_none()
                {
                    append_bootstrap_log(data.as_deref(), "旧引擎中止了安全退出交接；未强制结束。");
                    return;
                }
            }
            Some((EngineHandover::ReuseCurrent, _)) => {
                if attach_engine(ENGINE_PORT) {
                    runtime.trusted_engine.store(true, Ordering::Release);
                    return;
                }
                append_bootstrap_log(
                    data.as_deref(),
                    "同版本引擎未确认桌面接管；等待端口安全释放。",
                );
            }
            _ => {
                append_bootstrap_log(
                    data.as_deref(),
                    "交接期间端口服务身份发生变化；为保护其他程序，只等待端口自行释放。",
                );
                // 不再对该进程发任何请求，但它若自行退出，仍可安全启动新引擎。
                wait_for_port_then_spawn(runtime, data, false);
                return;
            }
        }
    });
}

fn start_engine_with_handover(runtime: Arc<DesktopRuntime>) {
    if !port_busy(ENGINE_PORT) {
        let _ = spawn_and_store_engine(&runtime, data_dir().as_deref());
        return;
    }

    let data = data_dir();
    let Some((decision, health)) = probe_engine(ENGINE_PORT) else {
        append_bootstrap_log(
            data.as_deref(),
            "端口 18901 已被占用，但无法验证为中标狗引擎；不会关闭它，将等待端口自行释放。",
        );
        wait_for_port_then_spawn(runtime, data, false);
        return;
    };
    match decision {
        EngineHandover::ReuseCurrent => {
            if attach_engine(ENGINE_PORT) {
                runtime.trusted_engine.store(true, Ordering::Release);
                append_bootstrap_log(data.as_deref(), "已连接同版本本地引擎，无需重复启动。");
            } else {
                append_bootstrap_log(
                    data.as_deref(),
                    "同版本引擎未确认桌面接管；等待端口安全释放。",
                );
                wait_for_port_then_spawn(runtime, data, false);
            }
        }
        EngineHandover::BlockedForeign => {
            append_bootstrap_log(
                data.as_deref(),
                "端口 18901 上的服务未通过中标狗身份验证；不会关闭它，将等待端口自行释放。",
            );
            wait_for_port_then_spawn(runtime, data, false);
        }
        EngineHandover::ReplaceTrustedOld => {
            let old_version = health
                .get("version")
                .and_then(|value| value.as_str())
                .unwrap_or("未知");
            let Some(state) = engine_http_json(ENGINE_PORT, "POST", "/v1/shutdown")
                .as_ref()
                .and_then(shutdown_state)
            else {
                append_bootstrap_log(
                    data.as_deref(),
                    &format!("已识别旧版引擎 {old_version}，但它未接受安全退出请求；未强制结束。"),
                );
                return;
            };
            let status = match state {
                ShutdownState::ExitingNow => "旧引擎已空闲，正在退出",
                ShutdownState::Draining { running: 0 } => "旧引擎正在收尾",
                ShutdownState::Draining { running } => {
                    append_bootstrap_log(
                        data.as_deref(),
                        &format!(
                            "旧版引擎 {old_version} 仍有 {running} 个任务；收尾后将自动启动新版。"
                        ),
                    );
                    ""
                }
            };
            if !status.is_empty() {
                append_bootstrap_log(
                    data.as_deref(),
                    &format!("已识别旧版引擎 {old_version}；{status}，随后自动启动新版。"),
                );
            }

            wait_for_port_then_spawn(runtime, data, true);
        }
    }
}

fn wait_until_port_free(timeout: Duration) -> bool {
    let started = std::time::Instant::now();
    while started.elapsed() < timeout {
        if !port_busy(ENGINE_PORT) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    !port_busy(ENGINE_PORT)
}

fn wait_until_current_engine(timeout: Duration) -> bool {
    let started = std::time::Instant::now();
    while started.elapsed() < timeout {
        if matches!(
            probe_engine(ENGINE_PORT),
            Some((EngineHandover::ReuseCurrent, _))
        ) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

fn parse_listener_pids(output: &str) -> Vec<u32> {
    let mut pids = Vec::new();
    for line in output.lines() {
        if let Ok(pid) = line.trim().parse::<u32>() {
            if pid > 0 && !pids.contains(&pid) {
                pids.push(pid);
            }
        }
    }
    pids
}

#[cfg(target_os = "macos")]
fn listening_pids(port: u16) -> Vec<u32> {
    let port_arg = format!("-iTCP:{port}");
    Command::new("/usr/sbin/lsof")
        .args(["-nP", &port_arg, "-sTCP:LISTEN", "-t"])
        .output()
        .ok()
        .map(|output| parse_listener_pids(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn listening_pids(port: u16) -> Vec<u32> {
    let script = format!(
        "(Get-NetTCPConnection -State Listen -LocalPort {port} -ErrorAction SilentlyContinue).OwningProcess"
    );
    Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .ok()
        .map(|output| parse_listener_pids(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn listening_pids(_port: u16) -> Vec<u32> {
    Vec::new()
}

#[cfg(target_os = "macos")]
fn process_executable(pid: u32) -> Option<PathBuf> {
    let pid_arg = pid.to_string();
    let output = Command::new("/usr/sbin/lsof")
        .args(["-a", "-p", &pid_arg, "-d", "txt", "-Fn"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| line.strip_prefix('n').map(PathBuf::from))
}

#[cfg(target_os = "windows")]
fn process_executable(pid: u32) -> Option<PathBuf> {
    let script = format!(
        "(Get-CimInstance Win32_Process -Filter \"ProcessId = {pid}\" -ErrorAction SilentlyContinue).ExecutablePath"
    );
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .ok()?;
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!value.is_empty()).then(|| PathBuf::from(value))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn process_executable(_pid: u32) -> Option<PathBuf> {
    None
}

fn same_executable(observed: &Path, expected: &Path) -> bool {
    let observed = fs::canonicalize(observed).unwrap_or_else(|_| observed.to_path_buf());
    let expected = fs::canonicalize(expected).unwrap_or_else(|_| expected.to_path_buf());
    #[cfg(target_os = "windows")]
    {
        observed
            .to_string_lossy()
            .eq_ignore_ascii_case(&expected.to_string_lossy())
    }
    #[cfg(not(target_os = "windows"))]
    {
        observed == expected
    }
}

fn verified_stale_listener(expected: &Path) -> Option<(u32, PathBuf)> {
    listening_pids(ENGINE_PORT).into_iter().find_map(|pid| {
        let observed = process_executable(pid)?;
        same_executable(&observed, expected).then_some((pid, observed))
    })
}

#[cfg(target_os = "macos")]
fn terminate_verified_listener(pid: u32) -> bool {
    Command::new("/bin/kill")
        .args(["-TERM", &pid.to_string()])
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(target_os = "macos")]
fn force_terminate_verified_listener(pid: u32) -> bool {
    Command::new("/bin/kill")
        .args(["-KILL", &pid.to_string()])
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(target_os = "windows")]
fn terminate_verified_listener(pid: u32) -> bool {
    Command::new("taskkill.exe")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(target_os = "windows")]
fn force_terminate_verified_listener(pid: u32) -> bool {
    terminate_verified_listener(pid)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn terminate_verified_listener(_pid: u32) -> bool {
    false
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn force_terminate_verified_listener(_pid: u32) -> bool {
    false
}

fn repair_local_engine_blocking(runtime: &DesktopRuntime) -> EngineRepairResult {
    let data = data_dir();
    let has_owned_child = runtime
        .engine
        .lock()
        .ok()
        .is_some_and(|guard| guard.is_some());
    let busy = port_busy(ENGINE_PORT);
    let probed = probe_engine(ENGINE_PORT).map(|(decision, _)| decision);
    let expected = std::env::current_exe()
        .ok()
        .and_then(|exe| resolve_engine_sidecar(&exe).ok());
    let verified_stale = expected.as_deref().and_then(verified_stale_listener);
    let decision = classify_repair(has_owned_child, busy, probed, verified_stale.is_some());

    append_bootstrap_log(
        data.as_deref(),
        &format!("用户执行检查并修复: {decision:?}"),
    );

    match decision {
        EngineRepairDecision::ReuseCurrent => {
            let attached = attach_engine(ENGINE_PORT);
            runtime.trusted_engine.store(attached, Ordering::Release);
            return EngineRepairResult {
                ok: attached,
                action: if attached {
                    "reconnected"
                } else {
                    "attach_failed"
                },
                message: if attached {
                    "本地引擎正常，已重新连接。".into()
                } else {
                    "引擎已响应，但桌面端接管失败。".into()
                },
                detail: "已验证 127.0.0.1:18901 的版本和产品身份。".into(),
            };
        }
        EngineRepairDecision::BlockedUnverified => {
            append_bootstrap_log(
                data.as_deref(),
                "检查并修复未结束未验证的端口进程，避免误杀其他软件。",
            );
            return EngineRepairResult {
                ok: false,
                action: "blocked_unverified",
                message: "18901 端口被无法验证身份的进程占用，为避免误关其他软件，未强制结束。".into(),
                detail: "请先退出旧版中标狗；若仍未恢复，重启电脑后再打开当前版本。详情已写入 engine-bootstrap.log。".into(),
            };
        }
        EngineRepairDecision::ReplaceTrustedOld => {
            let accepted = engine_http_json(ENGINE_PORT, "POST", "/v1/shutdown")
                .as_ref()
                .and_then(shutdown_state)
                .is_some();
            if !accepted || !wait_until_port_free(Duration::from_secs(12)) {
                return EngineRepairResult {
                    ok: false,
                    action: "waiting_for_old_engine",
                    message: "旧版引擎正在安全收尾，不会强制中断正在生成的任务。".into(),
                    detail: "收尾完成后应用会自动启动新版引擎。".into(),
                };
            }
        }
        EngineRepairDecision::RestartOwned => {
            if let Ok(mut guard) = runtime.engine.lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            runtime.trusted_engine.store(false, Ordering::Release);
            if !wait_until_port_free(Duration::from_secs(5)) {
                return EngineRepairResult {
                    ok: false,
                    action: "restart_timeout",
                    message: "已结束无响应的内置引擎，但端口没有及时释放。".into(),
                    detail: "任务文件保留在本地；请退出应用后重新打开。".into(),
                };
            }
        }
        EngineRepairDecision::RestartVerifiedStale => {
            let Some((pid, observed)) = verified_stale else {
                return EngineRepairResult {
                    ok: false,
                    action: "stale_identity_changed",
                    message: "端口进程身份在修复前发生变化，已停止自动处理。".into(),
                    detail: "未结束任何无法验证的进程。".into(),
                };
            };
            let still_same_engine = expected.as_deref().is_some_and(|expected| {
                process_executable(pid)
                    .as_deref()
                    .is_some_and(|current| same_executable(current, expected))
            });
            if !still_same_engine {
                return EngineRepairResult {
                    ok: false,
                    action: "stale_identity_changed",
                    message: "端口进程身份在修复前发生变化，已停止自动处理。".into(),
                    detail: "未结束任何无法验证的进程。".into(),
                };
            }
            append_bootstrap_log(
                data.as_deref(),
                &format!(
                    "已确认遗留引擎占用 {ENGINE_PORT}: pid={pid}, path={}",
                    observed.display()
                ),
            );
            let requested = terminate_verified_listener(pid);
            let graceful = requested && wait_until_port_free(Duration::from_secs(3));
            let still_verified = expected.as_deref().is_some_and(|expected| {
                process_executable(pid)
                    .as_deref()
                    .is_some_and(|observed| same_executable(observed, expected))
            });
            let forced = !graceful
                && still_verified
                && force_terminate_verified_listener(pid)
                && wait_until_port_free(Duration::from_secs(5));
            if !graceful && !forced {
                return EngineRepairResult {
                    ok: false,
                    action: "stale_process_did_not_exit",
                    message: "已确认是中标狗遗留引擎，但进程未及时退出。".into(),
                    detail: "请退出所有中标狗窗口后重试；任务文件不会删除。".into(),
                };
            }
        }
        EngineRepairDecision::StartFresh => {}
    }

    if !spawn_and_store_engine(runtime, data.as_deref()) {
        return EngineRepairResult {
            ok: false,
            action: "spawn_failed",
            message: "内置引擎重新启动失败。".into(),
            detail: "请查看 engine-bootstrap.log 中记录的实际启动路径和系统错误。".into(),
        };
    }
    let ready = wait_until_current_engine(Duration::from_secs(30));
    if ready {
        let _ = attach_engine(ENGINE_PORT);
        runtime.trusted_engine.store(true, Ordering::Release);
    }
    EngineRepairResult {
        ok: ready,
        action: if ready { "restarted" } else { "health_timeout" },
        message: if ready {
            "已重启内置引擎并通过健康检查，正在恢复任务连接。".into()
        } else {
            "内置引擎已启动，但 30 秒内未通过健康检查。".into()
        },
        detail: if ready {
            "任务文件和已生成内容均未删除。".into()
        } else {
            "请查看 engine.log 与 engine-bootstrap.log。".into()
        },
    }
}

#[tauri::command]
async fn repair_local_engine(
    runtime: tauri::State<'_, Arc<DesktopRuntime>>,
) -> Result<EngineRepairResult, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || repair_local_engine_blocking(&runtime))
        .await
        .map_err(|error| error.to_string())
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
    engine_http_json(port, "POST", "/v1/shutdown")
        .as_ref()
        .and_then(shutdown_state)
        .is_some()
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

    // 只关闭本次已启动或已校验的同版本引擎。未知端口占用者绝不发 shutdown。
    if !runtime.trusted_engine.load(Ordering::Acquire) {
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
    let managed_runtime = runtime.clone();
    let setup_runtime = runtime.clone();
    let window_runtime = runtime.clone();
    let exit_runtime = runtime.clone();

    tauri::Builder::default()
        .manage(managed_runtime)
        .invoke_handler(tauri::generate_handler![repair_local_engine])
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
            start_engine_with_handover(setup_runtime.clone());
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
    use std::net::TcpListener;
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

    #[test]
    fn current_bundled_engine_is_reused_without_shutdown() {
        let health = serde_json::json!({
            "ok": true,
            "version": ENGINE_VERSION,
            "author": ENGINE_AUTHOR,
            "features": ["job_start", "job_delete"]
        });

        assert_eq!(
            classify_engine_health(&health),
            EngineHandover::ReuseCurrent
        );
    }

    #[test]
    fn trusted_older_bid_dog_engine_is_gracefully_replaced() {
        let health = serde_json::json!({
            "ok": true,
            "version": "0.19.1",
            "author": ENGINE_AUTHOR,
            "features": ["job_start", "job_delete"]
        });

        assert_eq!(
            classify_engine_health(&health),
            EngineHandover::ReplaceTrustedOld
        );
    }

    #[test]
    fn unknown_listener_is_never_asked_to_shutdown() {
        let foreign = serde_json::json!({
            "ok": true,
            "version": "7.4.2",
            "author": "another product",
            "features": ["job_start"]
        });
        let malformed = serde_json::json!({"ok": true, "version": "0.19.1"});

        assert_eq!(
            classify_engine_health(&foreign),
            EngineHandover::BlockedForeign
        );
        assert_eq!(
            classify_engine_health(&malformed),
            EngineHandover::BlockedForeign
        );
    }

    #[test]
    fn newer_or_non_numeric_bid_dog_engine_is_not_replaced_by_an_older_shell() {
        for version in ["0.20.3", "1.0.0", "development-build"] {
            let health = serde_json::json!({
                "ok": true,
                "version": version,
                "author": ENGINE_AUTHOR,
                "features": ["job_start", "job_delete"]
            });
            assert_eq!(
                classify_engine_health(&health),
                EngineHandover::BlockedForeign,
                "must not replace {version}"
            );
        }
    }

    #[test]
    fn shutdown_reply_distinguishes_idle_exit_from_active_drain() {
        assert_eq!(
            shutdown_state(&serde_json::json!({"ok": true, "exiting": true, "running": 0})),
            Some(ShutdownState::ExitingNow)
        );
        assert_eq!(
            shutdown_state(&serde_json::json!({"ok": true, "exiting": false, "running": 2})),
            Some(ShutdownState::Draining { running: 2 })
        );
        assert_eq!(
            shutdown_state(&serde_json::json!({"ok": false, "error": "shared service"})),
            None
        );
    }

    #[test]
    fn health_probe_uses_the_real_local_http_protocol() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let size = stream.read(&mut request).unwrap();
            assert!(String::from_utf8_lossy(&request[..size]).starts_with("GET /v1/health "));
            let body = serde_json::json!({
                "ok": true,
                "version": ENGINE_VERSION,
                "author": ENGINE_AUTHOR,
                "features": ["job_start", "job_delete"]
            })
            .to_string();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });

        let (decision, health) = probe_engine(port).unwrap();

        assert_eq!(decision, EngineHandover::ReuseCurrent);
        assert_eq!(health["author"], ENGINE_AUTHOR);
        server.join().unwrap();
    }

    #[test]
    fn untrusted_port_is_not_sent_a_shutdown_on_app_exit() {
        let runtime = DesktopRuntime::default();
        runtime.primary_instance.store(true, Ordering::Release);
        runtime.explicit_quit.store(true, Ordering::Release);

        shutdown_owned_engine(&runtime);

        assert!(!runtime.trusted_engine.load(Ordering::Acquire));
        assert!(runtime.shutdown_sent.load(Ordering::Acquire));
    }

    #[test]
    fn repair_restarts_only_an_owned_unhealthy_engine() {
        assert_eq!(
            classify_repair(true, true, None, false),
            EngineRepairDecision::RestartOwned
        );
        assert_eq!(
            classify_repair(false, true, None, true),
            EngineRepairDecision::RestartVerifiedStale
        );
        assert_eq!(
            classify_repair(false, true, None, false),
            EngineRepairDecision::BlockedUnverified
        );
        assert_eq!(
            classify_repair(false, true, Some(EngineHandover::BlockedForeign), true),
            EngineRepairDecision::BlockedUnverified
        );
    }

    #[test]
    fn listener_pid_parser_ignores_noise_and_duplicates() {
        assert_eq!(
            parse_listener_pids("123\nnoise\n456\n123\n"),
            vec![123, 456]
        );
    }
}
