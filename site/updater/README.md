# 自动更新清单托管位

Tauri updater 端点(按优先级,见 `app/src-tauri/tauri.conf.json`):

1. `https://bid-dog.vercel.app/updater/{{target}}-{{arch}}.json` ← 本目录的静态文件
2. `https://github.com/shandianT/bid-dog/releases/latest/download/latest.json`

## 本目录的文件由 CI 自动提交,不要手改

`build.yml` 的 release 作业在发布成功后,把该次发布的 `latest.json` 原样复制成
`darwin-aarch64.json` 和 `windows-x86_64.json`,提交并推回 main。发版无需任何
人工动作;清单永远等于最新发布的那一份。

只动 `site/**` 的提交不会触发安装包构建(`build.yml` 的 push 触发器对它
`paths-ignore`),所以不会有构建回环;`pages.yml` 与 Vercel 照常部署。

## 为什么不是让 vercel.json 转发到 Release

试过,不行,实测过程记录在此以免有人再走一遍:

GitHub 的 `/releases/download/...` 会 **302** 到
`release-assets.githubusercontent.com`,而 Vercel 的 rewrite 把这个 302
**原样透传**给客户端:

```
$ curl -sS -D - https://bid-dog.vercel.app/updater/darwin-aarch64.json
HTTP/2 302
location: https://github.com/shandianT/bid-dog/releases/download/desktop-v0.20.6/latest.json
```

内容拿得到(Tauri 会跟随重定向),但客户端**仍然必须连上 GitHub**——
「查更新不依赖 GitHub 可达」这个唯一目的一点没达到,还白添一跳。
清单只有 1.3 KB,落成静态文件由 Vercel 200 直出才是对的。

## 这条通道买到了什么,没买到什么

- **买到**:查更新这一步只跟 Vercel 通信。它小、频繁,每次启动都要做。
- **没买到**:清单里的下载地址仍然指向 GitHub Releases,所以**装更新**依然
  需要 GitHub 可达。要让下载也走国内,需要另做安装包镜像(每版约 70 MB × 2 平台),
  不在本目录范围内。

## 加新平台时

在 release 作业的「publish the update manifest to the site」步骤里加一行
`cp`(例如 Intel Mac 是 `darwin-x86_64.json`)。故意写成逐条列举而不是循环:
新增平台是一次需要被看见、被评审的改动。

## 签名

清单和更新包都经私钥签名(minisign,公钥指纹 53DCAC41BBFF51AF,内置在应用里)。
篡改会导致客户端校验失败——托管位不需要是可信的。
