# 自动更新清单托管位

Tauri updater 端点(按优先级):
1. `https://bid-dog.vercel.app/updater/{{target}}-{{arch}}.json`(本目录;国内可达,发布后手动/脚本同步)
2. `https://github.com/shandianT/bid-dog/releases/latest/download/latest.json`(CI 自动产出的兜底)

发布流程:CI 在配置了 `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` 时自动产出
`latest.json` + 签名更新包并附到 Release。要启用国内直连通道,把该次发布的
`latest.json` 复制到本目录,按平台命名:
- `darwin-aarch64.json`
- `windows-x86_64.json`
(内容同 latest.json;也可直接放同一份完整 latest.json 并让两个文件都指向它的内容。)

清单和更新包都经私钥签名,篡改会导致客户端校验失败——托管位不需要是可信的。
