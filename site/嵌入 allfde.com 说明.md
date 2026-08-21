# 部署到 allfde.com/demos.html

> 作者:FDE-家涛 · 配套本目录使用

## 目录结构(上传到你网站的任意位置,例如 /bid-dog/)

```
bid-dog/
├─ index.html          ← 中标狗产品页(深色现代风 + 自动播放的 UI 动画)
├─ app/index.html      ← 在线体验版(完整可交互,加 ?demo=1 参数)
└─ assets/             ← 图标与真实截图
```

纯静态,零依赖,任何静态托管都能跑(你网站现有的空间、Nginx、Vercel、Netlify、GitHub Pages 均可)。

## 一、在 demos.html 里加一张作品卡片

把下面这段贴进你的作品列表(class 名按你站点现有样式改)。

```html
<a class="demo-card" href="/bid-dog/" target="_blank">
  <img src="/bid-dog/assets/icon.png" alt="中标狗" width="56" height="56">
  <h3>中标狗 · 投标文件生成工作台</h3>
  <p>拖入招标文件,12 阶段流水线产出技术标与自检报告,出件前红黄绿门禁把关。本地运行,数据不出电脑。</p>
  <span class="tags">Tauri · FastAPI · 多 Agent 编排 · 文档门禁</span>
  <span class="actions">在线体验 · 下载桌面版</span>
</a>
```

## 二、想在 demos.html 里直接内嵌可玩的界面

```html
<div style="border:1px solid #e5e5e5;border-radius:14px;overflow:hidden;max-width:1100px;margin:24px auto">
  <iframe src="/bid-dog/app/index.html?demo=1"
          style="width:100%;height:720px;border:0;display:block"
          title="中标狗在线体验" loading="lazy"></iframe>
</div>
<p style="text-align:center;color:#888;font-size:13px">
  在线体验版:交互与流程完全真实,产出为样例;不上传任何文件、不调用模型。
</p>
```

`?demo=1` 是关键:强制在线体验模式——**不会去探测访客本机端口、不上传文件、不调用任何模型、不产生费用**。

当前桌面版为 v0.19.6：安装后的 WebView 使用独立会话和版本入口，只连接经身份校验的 `127.0.0.1:18901` 引擎；旧版「标书助手」数据会迁移到「中标狗」目录。任务列表支持五态分组、项目、归档和批量操作，完成页优先展示最终 Word 与出件检查。在线体验页只演示这些交互，不会删除访客本机文件。

## 三、"让大家一起使用"的三种形态(按投入排序)

| 形态 | 访客能做什么 | 你要准备什么 | 费用/风险 |
|---|---|---|---|
| **A. 在线体验版**(推荐先上这个) | 完整走一遍流程与交互,产出是样例 | 只要静态托管 | 零成本、零风险、零维护 |
| **B. 下载桌面版** | 真产标书,接自己的模型/CLI | 只要 Release 链接(已就绪) | 零成本;额度烧访客自己的 |
| **C. 云端真跑(多用户)** | 上传真实招标文件、真产 Word | 一台服务器 + Docker + 在服务器上装好并登录生成引擎 CLI | **烧你的模型额度**;访客文件落在你服务器上 |

**先 A + B,C 按需给特定客户开。** 理由:
- C 里生成引擎要跑在**服务器**上。SoWork CLI 是 macOS 桌面应用的一部分,Linux 服务器上装不了;能上服务器的是 Claude Code / Codex CLI,那就得用**你自己的账号**——公开给所有人 = 所有人烧你的额度。
- 访客把真实招标文件传到你服务器,数据责任就转到你身上了(这恰好与产品主打的"数据不出电脑"相反)。

### 真要开 C:最小可控做法

```bash
# 服务器上(已内置 Docker 配置)
cd deploy
BID_PASSWORD='给客户的口令' docker compose up -d      # 口令必设,别裸奔公网
```
- 口令只发给具体客户,不写在网页上;
- 每位访客自动分到独立工作区(已实现隔离);
- 网页端默认禁止修改生成引擎命令(防远程执行),要放开才设 `BID_ALLOW_AGENT_CONFIG=1`;
- 反向代理配 HTTPS,并对上传大小、并发做限制。

## 四、上线检查清单

- [ ] `/bid-dog/` 能打开产品页,首屏动画自动播放
- [ ] `/bid-dog/app/index.html?demo=1` 能完整走完 12 阶段并出体检结论
- [ ] 产品页里的下载按钮指向 https://github.com/shandianT/bid-dog/releases/latest 且有安装包
- [ ] 下载页和作品卡片标注的当前桌面版本为 v0.19.6
- [ ] demos.html 卡片文案与站点风格一致
- [ ] 手机上打开不横向滚动(已做响应式)


## 反向代理(nginx)配置要点——长任务断流就是这里没配

中标狗的进度是 SSE 长连接。nginx 默认会**缓冲响应**并在 60 秒无数据时掐断,表现为"页面转很久没反应,然后断开"。
v0.13.0 引擎已带 `X-Accel-Buffering: no` 响应头自动关缓冲;若你的 nginx 配置里显式覆盖过,请确保:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;            # SSE 必须关缓冲
    proxy_read_timeout 3600s;       # 长任务不掐
    client_max_body_size 200m;      # 素材包上传
}
```
