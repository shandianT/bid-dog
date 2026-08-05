# 中标狗（bid-dog）

**这是什么** — 一款跑在你自己电脑上的桌面应用：把招标文件拖进去，它按 12 个阶段读标、拆解、分章撰写、逐条应答，最后出一份格式合规、可直接交付的 Word 投标文件。
**给谁用** — ① 拿到 Key 的同事与客户：装上、粘 Key、拖文件，全程不需要注册或登录任何账号；② 路过的技术人：文末有架构小节。
**怎么开始** — 到 [Releases](https://github.com/shandianT/bid-dog/releases/latest) 下载 dmg / exe → 打开后粘一串 Key、选一个模式 → 把招标文件拖进窗口。

[![release](https://img.shields.io/badge/release-v0.17.0-0a63c9)](https://github.com/shandianT/bid-dog/releases/latest)
[![build](https://github.com/shandianT/bid-dog/actions/workflows/build.yml/badge.svg)](https://github.com/shandianT/bid-dog/actions/workflows/build.yml)
![platform](https://img.shields.io/badge/macOS%20Apple%20Silicon%20%7C%20Windows%20x64-111111)

**官网 / 在线体验**：https://bid-dog.vercel.app · 备用镜像 https://shandiant.github.io/bid-dog/
官网上有产品演示、成品 Word 页面，以及**不用安装就能点着玩的在线体验版**。

---

## 它出的 Word，就长这样

下面四张都是成品 docx 直接渲染截取的真实页面，未经修饰、未做美化。看能力请先看这四张，而不是应用界面。

<table>
<tr>
<td width="50%" valign="top">
<img src="site/assets/word-cover.png" alt="成品 Word 封面页">
<p><b>封面页</b> —— 项目名称、文件性质、投标人落款一次到位，黑体居中版式。<br>
证明：封面、目录、页眉页脚、分节页码这类“格式分”不用人再排一遍。</p>
</td>
<td width="50%" valign="top">
<img src="site/assets/word-body.png" alt="成品 Word 图文正文页">
<p><b>图文正文页</b> —— 产品截图插在对应章节，图注连续编号，正文首行缩进两字符，页眉带项目名。<br>
证明：图文混排是自动完成的，图片按素材库《图片索引》的落位锚点各就各位。</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="site/assets/word-deviation.png" alt="成品 Word 技术应答偏离表">
<p><b>技术应答偏离表</b> —— 招标要求 → 我方应答 → 满足情况 → 说明，逐条对上，表头跨页重复。<br>
证明：评标现场最容易丢分的一页有人盯着，应答覆盖率会被核验。</p>
</td>
<td width="50%" valign="top">
<img src="site/assets/word-xinchuang.png" alt="成品 Word 章节图文页">
<p><b>章节图文页</b> —— 标题层级清楚，内容是成段的实质论述而不是要点罗列，配图落在它该在的那一章。<br>
证明：篇幅和图位都过了门禁，不是“写满就交”。</p>
</td>
</tr>
</table>

---

## 下载

**[前往 Releases 下载最新版](https://github.com/shandianT/bid-dog/releases/latest)**

| 系统 | 安装包 | 说明 |
|---|---|---|
| macOS | [`bid-dog_0.17.0_aarch64.dmg`](https://github.com/shandianT/bid-dog/releases/download/desktop-v0.17.0/bid-dog_0.17.0_aarch64.dmg) | Apple Silicon（M 系列） |
| Windows | [`bid-dog_0.17.0_x64-setup.exe`](https://github.com/shandianT/bid-dog/releases/download/desktop-v0.17.0/bid-dog_0.17.0_x64-setup.exe) | Windows 10 / 11 64 位 |

安装包目前未做商业代码签名，两个系统各有一次放行动作，做完就再也不会提示：

- **macOS** 若提示“已损坏，无法打开”：把应用拖进「应用程序」后，终端执行
  ```bash
  xattr -cr /Applications/中标狗.app
  ```
  也可以在「系统设置 → 隐私与安全性」里点「仍要打开」。
- **Windows** 若弹出 SmartScreen 蓝色提示：点「更多信息」→「仍要运行」。

---

## 三步上手

1. **装** —— 双击安装包打开，等左下角显示「本地引擎 · 已连接」。引擎和执行外壳都已经打进安装包里了。
2. **粘 Key、选模式** —— 打开「设置 · 模型接入」，把发给你的 Key 粘进快速接入卡，选**标准**（写正式标书）或**极速**（试跑更快、更省额度），点一键接入。生成、对话、识图三件事一次全配好，四步实时打勾，配完当场测通。
3. **拖招标文件** —— 把招标文件（PDF / DOCX / Markdown）拖进窗口任意位置，按向导确认一下哪份是招标文件，点开始。跑的过程中可以随时提要求、补材料、暂停或重跑。

向导里的「你的要求」**已经预填了一份投标方案专家提示词**（角色、篇幅目标、逐条对齐评分点、承诺函、不编造），不用自己想怎么写，改两句就能用，也可以整段换成你自己的。它会原样存进任务目录的《你的要求.md》，agent 开工先读它，并在自检报告里逐条回执。

**你不需要**：注册账号、登录任何 AI 服务、装 Node.js、装 Python、开终端敲命令。想先白嫖看效果的，不填任何配置也能走完内置演示流程。

跑起来之后，对话区常驻一块「它正在做什么」：读了哪个文件、跑了什么脚本、写出什么产物、字数够不够、图片搬没搬正，逐行流出来；旁边给预计等待时间，第一步就有数，用得越多越准。跑完自动折叠成回放。

---

## 它保证什么

写得快是基本功，敢交出去才是本事。每一册出 Word 之前都要过门禁，**不过不交付**——而且不是提示你去改，是交付前自动修复、用修复稿重出 Word，再给你一份《成品质检报告》说明改了什么、还差什么。

| 关卡 | 你拿到的实际好处 |
|---|---|
| **图片落位** | 放错章节的图自动搬回去，该配图却漏配的自动补上，模型凭空编出来的图直接剔除。不会出现“图不对文”，更不会出现一张根本不存在的图。 |
| **查重** | 同一段话换个说法反复灌注、逐字打散的碎片，自动折叠合并。评委不会翻三页发现都是车轱辘话。 |
| **篇幅** | 按章核验字数，太薄的章节直接标出来。不会某一章两页纸就结束，让人一眼看出没干活。 |
| **应答覆盖率** | 拿偏离表逐条对招标文件的评分点，漏答的列清单。实质性响应不漏项。 |
| **格式门禁** | 字体、页边距、页码、表格列宽等三十多项统一核验，宽表自动转横排、表头跨页重复。格式分不该丢在排版上。 |

另外两条同样重要：

- **不编造。** 素材库（公司资料、资质案例、图片索引）是唯一事实来源。资质、案例、报价缺了就统一标〔需补充〕并进补料清单，宁可留空，也不在评标现场给你埋雷。
- **不替你签字。** 投标人名称、报价、资质有效期、承诺与签章一律留给人确认，出件前检查里红色项不处理就拦住不让交付。

---

## 两种额度，别搞混

生成标书这件事花谁的钱，取决于你用的是哪条路：

| 你用的 | 花谁的额度 | 什么时候用 |
|---|---|---|
| **发给你的那串 Key**（标准 / 极速两种模式） | 发放方的 token 套餐 | 默认路径。不用注册、不用登录，装完粘上就能产真实标书 |
| **你自己的 Claude Code / Codex CLI 订阅** | 你自己的订阅 | 你本来就有订阅，想用自己的模型跑 |
| 本机已登录的 SoWork | 你本机那个账号 | 公司内部已经铺了 SoWork |

用发给你的 Key 时，**不消耗你自己的任何订阅额度**，也不会改动你本机原有的 CLI 登录态和配置——它用的是应用自己数据目录里的一套独立配置。

Key 只存在你本机的引擎配置里，页面永不回显；执行外壳拿到的是一串本机随机口令，真 Key 只在引擎进程内使用。任务文件、产物、素材默认全部留在「文稿/中标狗」，删掉应用文件还在。

---

## 给技术读者：架构

```
Tauri 壳(Rust + Web)  ──拉起/守护──▶  本地引擎(FastAPI, PyInstaller 单文件 sidecar, 127.0.0.1)
      ▲                                        │
      └────────── SSE 事件流(阶段/产出/台词/进度) ┘
                                               │
                                     执行外壳(随包分发) ──▶ 技能包(流程 + 确定性出件脚本)
```

- **桌面壳**：Tauri v2。负责窗口、拖拽、拉起并守护引擎、调系统默认应用直接打开产物。
- **本地引擎 sidecar**：FastAPI 用 PyInstaller 打成单文件二进制随安装包分发，客户机上没有 Python 也能跑；协议翻译、任务编排、门禁调度都在这一层。
- **事件流即真相**：任务状态不靠前端猜，引擎按 SSE 推事件，前端只做渲染。事件流改成 async 生成器后不再占死线程，页面重新可见时自动补一次同步并重挂流，后台标签被挂起也不假死。
- **技能包**：招投标流程 + 出件脚本（建 Word、格式核验、成品质检）。门禁是确定性脚本、零 token，不依赖模型自觉——模型没跑，引擎也会在完成后补审计并按需重出 Word。

目录：`app/` 桌面壳 · `server/` 本地引擎 · `site/` 官网 · `docs/` 文档。构建见 [BUILD.md](BUILD.md)。

**源码可读，版权保留。** 本仓库公开代码供阅读、评估与问题复现；著作权归作者所有，未经许可请勿用于商业分发、再发布或衍生产品。

---

## 官网怎么上线的

`site/` 是一个零依赖静态站（无构建步骤、无外部资源），两条线同时在跑，挂了一条另一条还在：

| 线路 | 地址 | 怎么发 |
|---|---|---|
| Vercel（主） | https://bid-dog.vercel.app | 在 Vercel 里 Import 本仓库，**Root Directory 保持仓库根**（不要改成 `site`），其余全留空——根目录的 `vercel.json` 里 `outputDirectory: "site"` 会接管。推 main 自动重新部署 |
| GitHub Pages（备） | https://shandiant.github.io/bid-dog/ | `.github/workflows/pages.yml`，改动 `site/**` 推 main 即自动上线。首次需在 Settings → Pages → Source 选一次「GitHub Actions」（或配一个 `PAGES_PAT` 让它全自动开启） |

站上的「下载 macOS / Windows 版」是**直指安装包的直链**：HTML 里写死当前版本，打开页面时再问一次 Releases 接口，有更新就自动换成最新包——发新版不用改官网。同时按访客系统把对应的包排到第一个。

想自己开一份来试：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FshandianT%2Fbid-dog)

---

## 文档与反馈

- [使用与绑定指南](docs/使用与绑定指南.md) —— 接入、模式选择、日常排查、端口与证书问题
- [发 Key 接入方案](docs/让别人用S2模型.md) —— 面向发放方：Key 怎么发、安全边界、故障对照表
- [Mac 安装说明](docs/Mac安装说明.md) —— 提示「已损坏」时怎么放行
- [构建说明](BUILD.md) —— 自己出 dmg / exe
- [更新日志](CHANGELOG.md) —— 每版做了什么

遇到问题或有建议，欢迎提 [Issue](https://github.com/shandianT/bid-dog/issues)：请附系统版本、中标狗版本、现象和复现步骤；**请勿附带 API Key、客户机密或完整涉密标书**。

中标狗用于辅助分析与撰写，不保证中标，也不能代替投标负责人、法务或专业人员的最终审核。请以招标文件原文和正式澄清文件为准。

---

作者：FDE-家涛