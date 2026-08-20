# 生成流程台与断线恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在任务过程页提供基于真实证据的六段生成流程台，并在 Windows 首装、事件流断开和组件缺失时自动恢复或明确诊断。

**Architecture:** 后端从现有任务持久化文件计算唯一 `flow` 状态；前端把任务事实与连接状态分离展示；EventSource 使用有界退避并以任务列表轮询兜底；桌面壳层继续负责确定性 sidecar 定位与启动证据。

**Tech Stack:** Python 3.12、FastAPI、原生 JavaScript、EventSource、Playwright、Rust/Tauri 2、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-08-21-generation-flow-console-design.md`

## Global Constraints

- 保留工作区已有模板和 Windows 修复改动。
- 进度只来自持久化事件、检查点和产物，不制造虚假百分比。
- 断线恢复不得创建新任务、覆盖产物或暗中重跑。
- 默认桌面链路不得依赖 SoWork、系统 Python、Node 或 Codex。
- 完整本地测试与 GitHub macOS/Windows 构件验收通过后才更新下载入口。

### Task 1: 后端六段流程合同

**Files:**
- Modify: `server/engine_v1.py`
- Test: `tests/test_generation_bootstrap.py`

- [ ] 写 step 0 预检、正文检查点、失败可恢复和旧任务兼容的失败测试。
- [ ] 实现从 preflight/progress/meta/outcome 计算 `flow` 的纯函数。
- [ ] 在任务列表和诊断快照中返回 `flow`。
- [ ] 运行目标 Python 测试确认通过。

### Task 2: 紧凑生成流程台

**Files:**
- Modify: `app/src/index.html`
- Sync: `site/app/index.html`
- Sync: `site/demo.html`
- Test: `tests/check_frontend_stability.js`
- Test: `tests/check_noword_badge.spec.js`

- [ ] 写六阶段、当前证据、检查点和连接状态的失败测试。
- [ ] 增加流程台 DOM、响应式样式和纯展示映射函数。
- [ ] 在任务切换、事件更新和轮询刷新时更新流程台。
- [ ] 同步三份前端并运行静态与浏览器目标测试。

### Task 3: 事件流重连与轮询保障

**Files:**
- Modify: `app/src/index.html`
- Test: `tests/check_frontend_stability.js`
- Test: `tests/check_noword_badge.spec.js`

- [ ] 写连续三次失败进入轮询、恢复后停止轮询、切换任务清理连接的失败测试。
- [ ] 实现单任务连接状态机和 3/4/6/10 秒有界退避。
- [ ] 连续三次失败时启用 4 秒任务状态轮询，恢复时清理。
- [ ] 确认轮询不调用创建、重跑或继续接口。

### Task 4: Windows 路径与诊断证据

**Files:**
- Modify: `app/src-tauri/src/main.rs`
- Modify: `server/engine_v1.py`
- Test: `app/src-tauri/src/main.rs`
- Test: `tests/test_generation_bootstrap.py`

- [ ] 写中文和空格路径定位 sidecar 的 Rust 测试。
- [ ] 扩展诊断快照，加入流程检查点和脱敏运行时来源。
- [ ] 确认组件缺失仍走固定版本自愈且不检查 SoWork。
- [ ] 运行 Rust 与后端目标测试。

### Task 5: 完整回归与构件发布

**Files:**
- Verify all changed files and release workflow.

- [ ] 运行完整 Python、Node、Playwright、Rust 和前端同步检查。
- [ ] 本机运行 PyInstaller sidecar Word 导出烟测。
- [ ] 审查差异并提交 `v0.19.1` 修复。
- [ ] 推送 GitHub，等待 macOS/Windows 构建及最终安装载荷烟测。
- [ ] 下载构件核对哈希与可运行性；成功后再更新网站下载入口。
