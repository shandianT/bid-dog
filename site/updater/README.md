# 自动更新清单托管位

Tauri updater 端点(按优先级,见 `app/src-tauri/tauri.conf.json`):

1. `https://bid-dog.vercel.app/updater/{{target}}-{{arch}}.json`
2. `https://github.com/shandianT/bid-dog/releases/latest/download/latest.json`

## 第 1 条是怎么工作的

**由 `vercel.json` 的 rewrites 代理转发到第 2 条,本目录不放清单文件。**

原来的设计是「发布后把 latest.json 手动拷进本目录」。这种每次发版都要记得做一遍
的步骤迟早会被忘掉,而且忘掉之后是静默失效:端点 404、客户端悄悄退回 GitHub,
没有任何地方会报错。改成代理之后,清单永远等于最新发布的那一份,发版不需要
任何额外动作。

对国内用户的意义:查更新这一步只跟 Vercel 通信,不依赖 GitHub 可达。
但清单里的下载地址仍然指向 GitHub Releases,**安装包本身还是从 GitHub 下载**。
要让下载也走国内,需要另外做安装包镜像,不在本文件范围内。

## 加新平台时

在 `vercel.json` 的 rewrites 里加一条对应的 source(例如 Intel Mac 是
`/updater/darwin-x86_64.json`)。故意写成逐条列举而不是通配:新增平台是一次
需要被看见、被评审的改动,不该悄悄生效。

## 签名

清单和更新包都经私钥签名(minisign,公钥指纹 53DCAC41BBFF51AF,内置在应用里)。
篡改会导致客户端校验失败——所以托管位不需要是可信的,代理也不会削弱安全性。
