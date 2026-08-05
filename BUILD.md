# 标书助手 · 出安装包指南(Mac / Windows)

## 拿到安装包的三条路(按省事程度排序)
1. **GitHub Actions(推荐,不需要 Windows 机器)**:把本目录推到一个 GitHub 仓库(.github/workflows/build.yml 已备好),Actions 自动在 macOS 与 Windows 云机上构建,Artifacts 里直接下载 .dmg(Apple Silicon) 与 -setup.exe。
2. **本机构建**:在 Mac 上按下文命令出 .dmg;在任一台 Windows 上出 .msi/.exe。每端约 5–10 分钟。
3. **交给 Claude Code**:打开本目录,说"按 BUILD.md 出安装包"。

工程目录:
- app/ — Tauri v2 桌面工程(前端 src/index.html,真实调用引擎 API,未连引擎时自动进演示模式)
- server/engine_v1.py — 本地引擎(FastAPI,/v1 协议:任务、SSE 事件流、对话、回答、模型接入、素材库;mock 与 AGENT_CMD 真实 agent 双模式)
- design/高保真原型.html — 设计参考

## 先跑起来(开发态)
```bash
pip install fastapi uvicorn python-multipart
python3 server/engine_v1.py        # 127.0.0.1:8080,同时也直接托管了前端
```
浏览器开 http://127.0.0.1:8080 即是完整功能:拖招标文件建任务 → SSE 实时进度 → agent 提问点按钮回答 → 交付物下载 → 模型接入可添加并测通。
接真实 agent(推荐用包装脚本,已处理权限与事件上报;需先解压 bidmultiagenttao_v5.5.zip 得到 bid-multiagent-tao/ 目录):
`AGENT_CMD='bash server/run_claude_agent.sh {tender} {out} {materials}' python3 server/engine_v1.py`
(注:`--dangerously-skip-permissions` 在 root 环境会被 claude CLI 拒绝,包装脚本改用 --settings 显式授权,见 server/agent_settings.json)

## 一次性环境准备
1. 安装 Node.js ≥ 18
2. 安装 Rust:https://rustup.rs (`rustup default stable`)
3. Windows 额外装:Visual Studio Build Tools(含 C++ 与 Windows SDK)、WebView2 运行时(Win11 自带)

## 构建
```bash
cd app
npm install
npx tauri icon app-icon.png   # 由 app-icon.png 生成全套图标(icns/ico/png)
npm run build                  # = tauri build
```

产物位置(app/src-tauri/target/release/bundle/):
- macOS:dmg/标书助手_0.9.0_aarch64.dmg(在 Mac 上构建)
- Windows:nsis/*-setup.exe(在 Windows 上构建)

注意:Tauri 不支持跨平台交叉编译——Mac 包在 Mac 上打,Windows 包在 Windows 上打(或用 GitHub Actions 双平台流水线,tauri-action 官方模板即可)。

## 开发调试
```bash
npm run dev   # 带热重载起桌面窗口
```

## 签名(正式分发前)
- macOS:Apple Developer 证书 + 公证(tauri.conf.json 的 bundle.macOS 段配 signingIdentity)
- Windows:代码签名证书(bundle.windows.certificateThumbprint),否则 SmartScreen 会拦

## 把 mock 换成真实 agent(只动协作层,UI 零改动)
当前 index.html 内为演示逻辑(进度自动推进、canned 回复)。接真实 agent 时按既定协议替换数据源:
- POST /v1/jobs · POST /v1/jobs/{id}/messages · GET /v1/jobs/{id}/events(SSE)· POST /v1/jobs/{id}/answers · POST /v1/jobs/{id}/control · GET /v1/jobs/{id}/artifacts
- 模型接入:GET/POST /v1/providers · POST /v1/providers/{id}/test · PUT /v1/routing
- 本地引擎:把现有 FastAPI(app_server.py)用 PyInstaller 打成 sidecar,在 tauri.conf.json 的 bundle.externalBin 里声明,应用启动时拉起并连 127.0.0.1
- 语音:本机转写(如 whisper.cpp sidecar),失败降级 /v1/transcribe

## 引擎已内置进安装包(sidecar,默认开启)
**从当前版本起,CI 构建的安装包自带引擎二进制,客户免装 Python,双击即完整功能。**实现:
- CI 在每个平台先跑 `pyinstaller -F -n bid-engine server/engine_v1.py --collect-all uvicorn`,按 Rust 目标三元组命名放入 `app/src-tauri/binaries/`;
- `tauri.conf.json` 的 `bundle.externalBin` 声明 `binaries/bid-engine`;
- `main.rs` 启动时检测 127.0.0.1:8080——没有引擎在跑才拉起内置引擎(手动起的引擎优先),退出时自动关闭;引擎日志写到 `~/Documents/标书助手/engine.log`;
- 前端启动先等内置引擎就绪(约 8 秒),等不到才降级演示模式,之后探测到引擎会自动切回真实模式。
本机手动构建同理:先按上面 pyinstaller 命令产出二进制放进 `app/src-tauri/binaries/<名字>-<host triple>[.exe]` 再 `npm run build`;不放 sidecar 也能构建,应用为演示模式。

**v0.12.1 起 externalBin 还声明了 `binaries/codex-cli`(S2 引擎执行外壳)**:CI 会从 npm registry 下载
`@openai/codex@0.146.0-<平台>` 的 tgz,抽出 `package/vendor/<triple>/bin/codex[.exe]` 重命名为
`codex-cli-<host triple>[.exe]` 放进 binaries/(见 build.yml「bundle Codex CLI」步骤)。本机手动构建安装包时
需照做一次,否则 tauri bundle 会因缺 externalBin 文件报错;只跑 `tauri dev` 不受影响。
版本钉 0.146.0(与引擎 CODEX_PIN 一致,升级前先跑全量回归)。Codex 为 Apache-2.0 许可,可随包分发。
真实 agent 生成(可选,内置引擎默认 mock 演示流程):本机装好 claude CLI 后
`AGENT_CMD='bash server/run_claude_agent.sh {tender} {out} {materials}'` 起引擎(见 server/run_claude_agent.sh 头部说明)。

## 交给 Claude Code 一句话
"打开 design_handoff_bid_assistant_desktop/app,按构建指南.md 出 Mac 和 Windows 安装包;然后把 index.html 里的 mock 数据层换成 构建指南.md 列出的 /v1 协议,后端起 app_server.py。"
