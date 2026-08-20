# Windows 生成链路恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Windows 客户首装后的自动模板、生成进度、诊断、自愈和 Word 导出链路。

**Architecture:** 后端成为模板选择和生成预检的单一事实来源；前端只展示推荐和确定性启动阶段；Tauri 壳层负责记录本地 sidecar 启动证据；CI 对最终安装载荷执行真实 Word 导出烟测。

**Tech Stack:** Python 3.12、FastAPI、python-docx、PyInstaller、原生 JavaScript、Playwright、Rust/Tauri 2、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-08-20-windows-generation-recovery-design.md`

## Global Constraints

- 保留当前工作区全部未提交模板系统改动，不覆盖无关文件。
- 桌面默认链路不得依赖客户安装 Python、Node、Codex 或 SoWork。
- 自动修复只写应用数据目录，并校验固定版本 OpenCode 1.18.13。
- 没有有效正文 Word 的任务不得标记完成。
- 不提交、不推送、不发布，除非用户另行明确授权。

---

### Task 1: 自动模板兼容与单次决策

**Files:**
- Modify: `server/engine_v1.py`
- Modify: `app/src/index.html`
- Test: `tests/test_product_backend.py`
- Test: `tests/check_noword_badge.spec.js`

**Interfaces:**
- Produces: `normalize_template_request(value: str) -> str`，返回 `auto` 或显式模板 ID。
- Produces: `/v1/jobs` 对 `auto`、`default`、空值的一致任务快照。

- [ ] 写三个模板值创建任务的失败测试，断言都冻结存在的 `template_snapshot`。
- [ ] 运行目标测试并确认 `default` 返回 400、空值没有快照。
- [ ] 实现模板值归一化，并让后端成为唯一自动推荐决策点。
- [ ] 移除 `njStart()` 对推荐接口的阻塞等待，保留异步预览。
- [ ] 运行后端和浏览器目标测试确认通过。

### Task 2: 生成预检、自愈与用户可见阶段

**Files:**
- Modify: `server/engine_v1.py`
- Modify: `app/src/index.html`
- Test: `tests/test_product_backend.py`
- Test: `tests/test_stall_cli.py`
- Test: `tests/check_noword_badge.spec.js`

**Interfaces:**
- Produces: `generation_preflight(job: str, conf: dict) -> dict`，包含 `ok`、`phase`、`checks`、`repair`。
- Produces: `ensure_default_shell(job: str, eng: dict) -> tuple[bool, str]`，必要时启动固定版本自愈并返回可读状态。

- [ ] 写默认模式不依赖 SoWork、缺 OpenCode 时进入修复状态的失败测试。
- [ ] 写任务在 step 0 展示预检阶段、随后才进入 step 1 的失败测试。
- [ ] 实现快速预检和默认外壳自愈；显式外部引擎只给出对应检查。
- [ ] 发出“保存文件、识别模板、检查组件、建立连接、读取文件”的结构化工作台词。
- [ ] 前端展示最后活动时间、预检阶段和自动修复进度。
- [ ] 运行目标测试确认通过。

### Task 3: 一键诊断立即反馈

**Files:**
- Modify: `app/src/index.html`
- Modify: `server/engine_v1.py`
- Test: `tests/check_noword_badge.spec.js`
- Test: `tests/test_product_backend.py`

**Interfaces:**
- Extends: `/v1/diagnostics` 返回任务最后活动时间、执行路径、外壳来源和修复状态。
- Produces: `runDiagnostics()` 在网络请求前同步呈现面板与运行态。

- [ ] 写点击错误卡片“一键诊断”后立即看见诊断面板和“正在检查”的浏览器失败测试。
- [ ] 写诊断快照包含 preflight/runtime/provision 信息的后端失败测试。
- [ ] 提升诊断面板层级、隐藏当前错误卡片并设置按钮运行态。
- [ ] 扩展脱敏诊断快照；离线失败使用明确的人话反馈。
- [ ] 运行浏览器和后端目标测试确认通过。

### Task 4: 桌面壳引擎定位与启动证据

**Files:**
- Modify: `app/src-tauri/src/main.rs`
- Modify: `app/src-tauri/src/desktop_state.rs`
- Test: `app/src-tauri/src/desktop_state.rs`

**Interfaces:**
- Produces: `resolve_engine_sidecar(exe: &Path) -> Result<PathBuf, EngineStartError>`。
- Produces: 数据目录 `engine-bootstrap.log`，记录候选路径、spawn 结果和健康等待结果。

- [ ] 写缺失 sidecar 与合法同目录 sidecar 的 Rust 失败测试。
- [ ] 实现显式路径解析错误类型和脱敏启动日志。
- [ ] `spawn_engine` 记录 spawn OS 错误，不再静默丢弃。
- [ ] 运行 `cargo test` 确认 Rust 测试通过。

### Task 5: python-docx 打包与最终载荷 Word 烟测

**Files:**
- Modify: `.github/workflows/build.yml`
- Modify: `BUILD.md`
- Test: CI Windows/macOS installer verification steps

**Interfaces:**
- Produces: 包含 `docx/templates/default-header.xml` 的 PyInstaller sidecar。
- Produces: 最终安装载荷真实生成的非空 `.docx`。

- [ ] 先用当前 PyInstaller 参数构建最小 sidecar，确认运行 `Document()` 复现缺资源或检查收集清单缺 `docx` 数据。
- [ ] 在 PyInstaller 命令加入 `--collect-all docx`。
- [ ] 在最终 DMG/NSIS 载荷烟测中创建 Markdown、调用引擎导出接口并断言 Word 非空。
- [ ] 更新构建说明，明确桌面安装版无需系统 Python/Node/SoWork。
- [ ] 运行可在本机执行的打包/资源检查。

### Task 6: 完整回归与交付验收

**Files:**
- Verify only; repair only failures caused by this plan.

**Interfaces:**
- Consumes: Tasks 1–5 的全部行为。

- [ ] 运行目标 Python 测试并读取完整结果。
- [ ] 运行 Node 静态稳定性检查与 Playwright 浏览器测试。
- [ ] 运行 `cargo test` 与前端/Tauri 构建检查。
- [ ] 运行 `bash tests/run_all.sh` 完整回归。
- [ ] 对照设计文档逐条检查验收标准，报告本地已验证和只能由 Windows CI 验证的边界。
