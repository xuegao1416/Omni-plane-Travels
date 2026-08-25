# 原生构建指南

本项目使用 Tauri 2 同时构建 Windows 桌面端和 Android 客户端。Web 前端由同一套 `bun run build` 生成。

## Windows

依赖：

- Bun
- Rust stable（MSVC toolchain）
- Visual Studio 2022 Build Tools，包含“使用 C++ 的桌面开发”工作负载
- Windows 10/11 SDK

验证 Rust 后端：

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

构建 NSIS 安装包：

```powershell
bun install
bun run tauri:build
```

产物位于 `src-tauri/target/release/bundle/nsis/`。

## Android

依赖：

- Bun
- Rust stable，以及 `aarch64-linux-android` target
- JDK 17
- Android SDK Platform 36、Build Tools 36.0.0
- Android NDK 27.2.12479018
- Windows“开发者模式”（Tauri 需要为 Rust 动态库创建符号链接）

Windows PowerShell 环境示例：

```powershell
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\27.2.12479018"
```

首次构建或删除生成目录后，先初始化再构建：

```powershell
bun install
bun run tauri:android:init
bun run tauri:android:build:debug
```

可安装的 ARM64 APK 位于 `src-tauri/gen/android/app/build/outputs/apk/`。`src-tauri/gen/` 是可再生目录，不进入版本控制；CI 也会在构建前执行初始化。

连接已启用 USB 调试的设备或启动模拟器后，可运行：

```powershell
bun run tauri:android:dev
```

## 自动构建

推送 `v*` 标签或手动触发 `.github/workflows/release.yml` 时：

- Windows job 创建 Tauri NSIS 发布草稿。
- Android job 生成可安装的 ARM64 debug APK，并作为 GitHub Actions artifact 上传。

正式商店分发前仍需配置 Android release keystore；调试 APK 不用于商店上架。
