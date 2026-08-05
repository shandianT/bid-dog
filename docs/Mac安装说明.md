# Mac 提示「中标狗已损坏,无法打开」的原因与解决

**dmg 文件本身没有坏**(CI 构建完整、带 SHA256 校验)。这是 macOS Gatekeeper 对
**未签名、未公证**应用的标准拦截文案:从浏览器下载的文件被打上 `com.apple.quarantine`
隔离标记,应用没有 Apple 开发者签名时,新版 macOS(尤其 macOS 15 Sequoia)直接显示
「已损坏,应移到废纸篓」,连右键→打开都不再放行。

## 解决(任选其一)

**方法一 · 终端一条命令(推荐)**
1. 打开 dmg,把「中标狗」拖入「应用程序」
2. 终端执行:
   ```bash
   sudo xattr -rd com.apple.quarantine /Applications/中标狗.app
   ```
3. 正常双击打开

**方法二 · 系统设置放行**
1. 双击应用,弹「已损坏/无法打开」后关掉弹窗
2. 系统设置 → 隐私与安全性 → 底部「安全性」区域会出现「已阻止"中标狗"」→ 点「仍要打开」
   (旧版 macOS 可用:右键应用 →「打开」→ 再点「打开」)

## 先确认芯片型号

 → 关于本机:
- **Apple 芯片(M1/M2/M3/M4)** → 下载 `bid-dog_<版本>_aarch64.dmg` ✓
  ([最新版在 Releases](https://github.com/shandianT/bid-dog/releases/latest))
- **Intel 芯片** → 当前 Release 没有 Intel 包(构建矩阵已精简)。需要的话在
  `.github/workflows/build.yml` 的 matrix 里加回一项即可自动构建:
  ```yaml
          - platform: macos-13          # Intel .dmg
            artifact: installer-macos-intel
            build_args: "-- --bundles dmg"
            artifact_paths: |
              app/src-tauri/target/release/bundle/dmg/*.dmg
  ```

## 长期方案(对外分发前)

加入 Apple Developer Program(99 美元/年),在 `tauri.conf.json` 配
`bundle.macOS.signingIdentity` 并开启公证(notarization),用户即可直接双击打开,
不再出现任何拦截。Windows 同理可配代码签名证书消除 SmartScreen 提示。
