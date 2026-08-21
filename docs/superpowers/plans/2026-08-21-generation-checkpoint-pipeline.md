# 分段生成与检查点续跑 Implementation Plan

**Goal:** 默认 OpenCode 新任务由本地解析和可恢复短节点驱动，断流仅重试当前节点，UI 展示真实节点与耗时，并能稳定汇总成 Word。

**Approach:** 新增独立 `generation_pipeline` 模块保存节点状态、解析主件和验证输出；`engine_v1` 负责 OpenCode 短会话适配、准入、事件和最终出件。仅 `s2/opencode` 新任务启用 pipeline v1，旧任务与显式外部 CLI 保持原路径。

## Steps

### Task 1: 流水线状态合同与检查点

**Files:**
- Create: `server/generation_pipeline.py`
- Create: `tests/test_generation_pipeline.py`

- [x] 先写 pipeline 初始化、原子节点转换、完成节点幂等复用、遗留 running 恢复的失败测试。
- [x] 实现节点状态机、输入摘要、节点摘要和恢复逻辑。
- [x] 验证 `pipeline.json` 不包含凭据或客户正文。

### Task 2: 本地主件解析与单次复用

**Files:**
- Modify: `server/generation_pipeline.py`
- Modify: `server/engine_v1.py`
- Test: `tests/test_generation_pipeline.py`

- [x] 写 DOCX 表格、TXT、PDF、空文件、压缩炸弹边界的失败测试。
- [x] 实现本地解析、`source_manifest.json` 和解析文件验证。
- [x] 模板推荐的截断预览不再冒充完整解析；流水线固化一次完整、有预算的本地解析。

### Task 3: OpenCode 短节点执行与模型路由

**Files:**
- Modify: `server/engine_v1.py`
- Modify: `server/generation_pipeline.py`
- Test: `tests/test_generation_pipeline.py`
- Test: `tests/test_mode_runtime.py`
- Test: `tests/test_session_lifecycle.py`

- [x] 写极速默认、标准仅复核、当前节点两次重试、已完成节点不重放的失败测试。
- [x] 实现响应规划、章节写作、偏离表、汇总、质检、Word 和交付门禁节点编排。
- [x] 为每个模型节点创建独立、受限 OpenCode 短会话，停滞只返回节点错误，不切整单 CLI。
- [x] 停止任务回收所有节点会话，任务重启从 `pipeline.json` 继续。

### Task 4: 节点接口、恢复与进度映射

**Files:**
- Modify: `server/engine_v1.py`
- Test: `tests/test_product_backend.py`
- Test: `tests/test_generation_bootstrap.py`

- [x] 写 pipeline 详情、节点重试上限、新旧 resume 分流和 flow 节点摘要的失败测试。
- [x] 实现只读 pipeline 接口、显式节点重试、恢复入口和诊断信息。
- [x] 把节点事实映射到现有 12 步及六段流程台，不改变旧任务字段。

### Task 5: 前端节点级反馈

**Files:**
- Modify: `app/src/index.html`
- Sync: `site/app/index.html`
- Sync: `site/demo.html`
- Test: `tests/check_frontend_stability.js`
- Test: `tests/check_noword_badge.spec.js`

- [x] 写当前章节、完成数量、重试次数和阶段耗时区间的失败测试。
- [x] 扩展流程台视图模型和紧凑展示。
- [x] pipeline v1 不再显示“稳定模式”，改为具体节点重试或模型限流说明。

### Task 6: 回归、真实链路与发布

**Files:**
- Modify release/version files only after behavior passes.

- [x] 运行目标测试并保留每个红—绿证据。
- [x] 运行完整 Python、Node、Playwright、Rust 和前端同步检查。
- [x] 用真实 OpenCode 1.18.18 验证短会话合同与上游 429 分类；实际模型额度不足，未取得正文输出。
- [ ] 更新版本与说明，推送 GitHub，等待 macOS/Windows 最终安装载荷冒烟和 Release。

## Risks / Unknowns

- OpenCode 多会话并发的上游网关吞吐存在套餐差异；第一期并发上限固定为 2，429 时降为 1。
- PDF 扫描件可能没有文本层；第一期明确阻断并提示 OCR，不静默生成空稿。
- 旧技能包导出脚本的正文命名规则较宽；流水线统一生成 `投标文件_<任务名>.md`，继续复用现有 `ensure_docx`。
- 标准模型质量收益尚无真实 A/B 证据；第一期只输出复核报告，不自动覆盖正文。

## Validation

- Targeted: `pytest -q tests/test_generation_pipeline.py tests/test_mode_runtime.py tests/test_session_lifecycle.py tests/test_product_backend.py tests/test_generation_bootstrap.py`
- Full: `PATH="$PWD/.venv/bin:$PATH" tests/run_all.sh`
- Rust: `cargo test --manifest-path app/src-tauri/Cargo.toml`
- Hygiene: `git diff --check`、三份前端同步、敏感信息扫描。
- Release: GitHub Actions 离线回归、OpenCode server contract、macOS DMG、Windows 安装后 OpenCode/引擎/Word 冒烟、Release 资产校验全部成功。
