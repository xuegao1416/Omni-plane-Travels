@echo off
REM build-android-apk.bat
REM One-shot Tauri Android aarch64 debug APK builder (CMD version).
REM Run from project root in cmd.exe:
REM   scripts\build-android-apk.bat
REM Options (after the command):
REM   -skip-cargo   skip cargo build, only re-pack via gradle
REM   -skip-dev    skip dev mode enable attempt
REM

setlocal enabledelayedexpansion
set "ROOT=%~dp0.."
pushd "%ROOT%"

set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot"
set "ANDROID_HOME=G:\Android\Sdk"
set "ANDROID_SDK_ROOT=G:\Android\Sdk"
set "NDK_HOME=G:\Android\Sdk\ndk\28.2.13676358"
set "CARGO_INCREMENTAL=0"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"

set "SKIP_CARGO=0"
set "SKIP_DEV=0"
for %%a in (%*) do (
    if /i "%%a"=="-skip-cargo" set "SKIP_CARGO=1"
    if /i "%%a"=="-skip-dev" set "SKIP_DEV=1"
)

echo === kill stale build processes ===
taskkill /F /IM java.exe 2>nul
taskkill /F /IM cargo.exe 2>nul
taskkill /F /IM tauri.exe 2>nul
del /f /q "%ROOT%\src-tauri\target\debug\.cargo-*.lock" 2>nul
del /f /q "%ROOT%\src-tauri\target\aarch64-linux-android\debug\.cargo-*.lock" 2>nul
del /f /q "%USERPROFILE%\.gradle\daemon\8.14.3\*.lock" 2>nul
del /f /q "%USERPROFILE%\.android\*.lock" 2>nul

if exist "%USERPROFILE%\.gradle\caches\8.14.3\transforms" (
    echo === clear transforms cache ===
    rmdir /s /q "%USERPROFILE%\.gradle\caches\8.14.3\transforms"
)

echo === ensure skip-frontend config ===
if not exist "%ROOT%\src-tauri\tauri.android-skip-frontend.conf.json" (
    > "%ROOT%\src-tauri\tauri.android-skip-frontend.conf.json" echo { "build": { "beforeBuildCommand": "" } }
)

if "!SKIP_CARGO!"=="0" (
    echo === compile Rust cargo ===
    call "%ROOT%\node_modules\.bin\tauri.exe" android build --debug --apk --target aarch64 --ci --config src-tauri/tauri.android-skip-frontend.conf.json
    if errorlevel 1 (
        echo cargo build FAILED
        popd
        exit /b 1
    )
) else (
    echo === [-skip-cargo] skip cargo ===
)

echo === copy .so to jniLibs/arm64-v8a ===
if not exist "%ROOT%\src-tauri\target\aarch64-linux-android\debug\libapp_lib.so" (
    echo ERROR: libapp_lib.so not built
    popd
    exit /b 1
)
if not exist "%ROOT%\src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a" mkdir "%ROOT%\src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a"
copy /Y "%ROOT%\src-tauri\target\aarch64-linux-android\debug\libapp_lib.so" "%ROOT%\src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\libapp_lib.so" >nul

echo === gradle pack APK (skip rust tasks) ===
cd /d "%ROOT%\src-tauri\gen\android"
call gradlew.bat :app:assembleDebug -x rustBuildArm64Debug -x rustBuildArmDebug -x rustBuildX86Debug -x rustBuildX86_64Debug -x rustBuildUniversalDebug -x rustBuildArm64Release -x rustBuildArmRelease -x rustBuildX86Release -x rustBuildX86_64Release -x rustBuildUniversalRelease --console=plain
if errorlevel 1 (
    echo gradle FAILED
    popd
    exit /b 1
)

cd /d "%ROOT%"
popd
echo === APK output ===
if exist "%ROOT%\src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk" (
    echo %ROOT%\src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk
)
endlocal