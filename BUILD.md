# 中标狗 · 出安装包指南（macOS / Windows）

## 拿到安装包的三条路(按省事程度排序)
1. **GitHub Actions(推荐,不需要 Windows 机器)**:把本目录推到一个 GitHub 仓库(.github/workflows/build.yml 已备好),Actions 自动在 macOS 与 Windows 云机上构建,Artifacts 里直接下载 .dmg(Apple Silicon) 与 -setup.exe。
2. **本机构建**:在 Mac 上按下文命令出 .dmg;在任一台 Windows 上出 .msi/.exe。每端约 5–10 分钟。
3. **交给 Claude Code**:打开本目录,说"按 BUILD.md 出安装包"。

工程目录:
- app/ — Tauri v2 桌面工程(前端 src/index.html,真实调用引擎 API,未连引擎时自动进演示模式)
- server/engine_v1.py — 本地引擎(FastAPI,/v1 协议:任务、SSE 事件流、对话、回答、模型接入、素材库;mock 与 AGENT_CMD 真实 agent 双模式)
- site/ — 官网静态站(零依赖,Vercel/Pages 双线部署,见根目录 vercel.json 与 .github/workflows/pages.yml)

## 先跑起来(开发态)
```bash
pip install fastapi uvicorn python-multipart python-docx pypdf certifi
python3 server/engine_v1.py        # 127.0.0.1:8080,同时也直接托管了前端
```
浏览器开 http://127.0.0.1:8080 即是完整功能:拖招标文件建任务 → SSE 实时进度 → agent 提问点按钮回答 → 交付物下载 → 模型接入可添加并测通。

接真实 agent 有两条路,**推荐第一条**:
1. **应用内绑定(不需要环境变量)**:启动后进「设置 · 模型接入」,粘 Key 点「一键接入并测试」即可——引擎会自己生成隔离的执行外壳配置。
2. **环境变量接管**:`AGENT_CMD='<你的 CLI 命令模板>' python3 server/engine_v1.py`。
   模板里可用的占位符:`{tender}`(招标文件绝对路径)、`{out}`(任务目录)、`{materials}`(素材目录)、
   `{skill}`(技能包目录)、`{jobid}`。技能包需先解压 `bidmultiagenttao_v5.3.zip` 得到 `bid-multiagent-tao/`
   (引擎首次启动也会自动解压到数据目录)。注意 claude CLI 在 root 环境会拒绝 `--dangerously-skip-permissions`,
   改用 `--settings <权限白名单.json>` 显式授权。

## 一次性环境准备
1. 安装 Node.js ≥ 18
2. 安装 Rust:https://rustup.rs (`rustup default stable`)
3. Windows 额外装:Visual Studio Build Tools(含 C++ 与 Windows SDK)、WebView2 运行时(Win11 自带)

## 构建
```bash
cd app
npm ci
npx tauri icon app-icon.png   # 由 app-icon.png 生成全套图标(icns/ico/png)
# macOS：先按 CI 的 PyInstaller 步骤生成 bid-engine sidecar，再打包。
# 当前公开包是 ad-hoc 签名；tauri.conf 因 PyInstaller onefile 关闭 hardenedRuntime，
# CI 会从最终 DMG 内实际启动引擎验证（不等于商业签名/公证）。
APPLE_SIGNING_IDENTITY=- npm run build -- --bundles dmg

# Windows：在 Windows 机器上执行
npm run build -- --bundles nsis
```

正式出包前的 CI 闸门当前会收集离线 Python 332 项（macOS 跳过 1 项 Windows 原生元数据检查）、前端 Node 逻辑 46 项、官网契约 1 项和 Chromium 真实点击 10 项，共 389 项；任一项失败都不进入 dmg/exe 构建。桌面 Rust 项数以当次 `cargo test` 输出为准。这些回归只验证发布链路与既定行为，不等同于三份独立真实招标文件的严格出件验收。

产物位置(app/src-tauri/target/release/bundle/):
- macOS:dmg/中标狗_0.20.0_aarch64.dmg(在 Mac 上构建)
- Windows:nsis/*-setup.exe(在 Windows 上构建)

注意:Tauri 不支持跨平台交叉编译——Mac 包在 Mac 上打,Windows 包在 Windows 上打(或用 GitHub Actions 双平台流水线,tauri-action 官方模板即可)。

## 开发调试
```bash
npm run dev   # 带热重载起桌面窗口
```

## 签名(正式分发前)
- macOS:没有完整凭据时，CI 使用 `APPLE_SIGNING_IDENTITY=-` 做 ad-hoc 签名，确保应用和 sidecar 的签名结构有效，但仍未获得系统信任。只有 Apple Developer 证书与公证凭据全部就绪时，CI 才叠加 hardened-runtime 配置并执行系统信任与 stapler 校验；最终 DMG 内的 PyInstaller 引擎仍须实际启动成功。
- Windows:只有 PFX 与密码同时就绪时才导入证书并叠加 thumbprint 配置；半套凭据直接阻止发版。没有证书时 SmartScreen 仍可能拦截。
- 凭据名、构建分支与验证命令见 [`app/src-tauri/SIGNING.md`](app/src-tauri/SIGNING.md)。

## 引擎已内置进安装包(sidecar,默认开启)
**从当前版本起,CI 构建的安装包自带引擎二进制,客户免装 Python,双击即完整功能。**实现:
- CI 在每个平台先跑 `pyinstaller -F -n bid-engine server/engine_v1.py --collect-all uvicorn --collect-all docx`，把 `python-docx` 的 XML 模板资源一起打入 sidecar，再按 Rust 目标三元组命名放入 `app/src-tauri/binaries/`；
- `tauri.conf.json` 的 `bundle.externalBin` 声明 `binaries/bid-engine`;
- `main.rs` 在 `127.0.0.1:18901` 拉起内置引擎：同版本直接复用，经身份校验的旧版先安全收尾再自动接管，未知进程绝不关闭；退出时请求已校验引擎安全收尾，引擎日志写到 `~/Documents/中标狗/engine.log`；
- Tauri WebView 使用 incognito 会话，并以 `index.html?desktop=0.20.0-18901` 作为版本入口；前端启动时清除旧 `localStorage.bid_api`，避免覆盖安装继续执行历史页面缓存或连回旧引擎；
- 首次启动会把 `~/Documents/标书助手` 中的存量数据迁移到 `~/Documents/中标狗`，Rust 壳显式设置 `BID_HOME`，保证 sidecar、任务、素材和日志始终落在同一数据目录；
- 前端启动先等内置引擎就绪（约 8 秒）；等不到会明确显示“本地引擎未启动、无法生成真实文件”，并提供诊断入口，之后探测到引擎会自动切回真实模式。
- macOS DMG 与 Windows NSIS 的发布校验不仅检查健康接口，还会从最终安装载荷创建正文并导出一份真实 `.docx`；缺少 `docx/templates/default-header.xml` 等运行资源时构建直接失败，不允许上传安装包。
本机手动构建同理：必须先按上面步骤把 `bid-engine-<host triple>[.exe]` 与 `opencode-cli-<host triple>[.exe]` 都放进 `app/src-tauri/binaries/`，再运行 `npm run build`；缺任一 `externalBin` 都会直接构建失败，不能产生一个看似完整的空壳安装包。

**v0.18.0 起 externalBin 默认声明 `binaries/opencode-cli`（S2 引擎执行外壳）**：CI 会从 npm registry 下载
OpenCode 1.18.18 对应平台包，抽出 `package/bin/opencode[.exe]`，重命名为
`opencode-cli-<host triple>[.exe]` 放进 `binaries/`（见 `build.yml` 的「bundle OpenCode CLI」步骤）。
Windows x64 固定使用 `opencode-windows-x64-baseline`，兼容不支持 AVX2 的旧 CPU；macOS 使用
`opencode-darwin-arm64`。CI 会在打包前运行 `--version`，外壳不能执行就立即失败，不发布安装包。
本机手动构建安装包时也需按工作流准备该 sidecar，否则 Tauri 会因缺少 `externalBin` 文件报错；
只跑 `tauri dev` 不受影响。版本必须与 `server/engine_v1.py` 的 `OPENCODE_PIN` 保持一致。
真实 agent 生成(可选,没配任何 Key 时引擎走内置 mock 演示流程):见上文「先跑起来(开发态)」里的两条路。

## 官网(site/)
零依赖静态站,没有构建步骤。本地预览:`python3 -m http.server 8090 -d site`。
线上两条线:Vercel(根目录 `vercel.json`,Root Directory 必须保持仓库根)+ GitHub Pages
(`.github/workflows/pages.yml`,改 `site/**` 推 main 自动上线)。详见 README「官网怎么上线的」。
