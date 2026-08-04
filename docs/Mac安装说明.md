# Mac 提示“中标狗已损坏，无法打开”

当前安装包尚未进行 Apple 签名和公证。macOS 会拦截从网络下载的未签名应用，并不代表 DMG 文件损坏。

## 放行方法

1. 打开 DMG，把“中标狗”拖入“应用程序”。
2. 打开“终端”，执行：

   ```bash
   sudo xattr -rd com.apple.quarantine /Applications/中标狗.app
   ```

3. 再次双击“中标狗”。

也可以在首次拦截后进入“系统设置 → 隐私与安全性”，找到中标狗并选择“仍要打开”。

当前 DMG 适用于 Apple Silicon（M1 / M2 / M3 / M4），暂不提供 Intel Mac 安装包。

[返回产品首页](../README.md)
