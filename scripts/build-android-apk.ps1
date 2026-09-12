# build-android-apk.ps1
# One-shot Tauri Android aarch64 debug APK builder.
# Bypasses Windows symlink restriction (dev mode off) by copying .so and skipping rust gradle tasks.
#
# Usage (project root, PowerShell):
#   .\scripts\build-android-apk.ps1           # full build (cargo + gradle)
#   .\scripts\build-android-apk.ps1 -SkipCargo  # skip cargo if .so already built
#
# Strategy:
#   1. Kill stale java/cargo/tauri processes
#   2. Clear stale .cargo-*.lock and gradle daemon lock files
#   3. Clear transforms cache if exists (avoid metadata.bin corruption)
#   4. Optionally enable Windows dev mode (admin required, else fallback)
#   5. Run cargo via cmd /c (so build survives PowerShell wrapper lifetime)
#   6. Copy .so to jniLibs/arm64-v8a (bypass symlink)
#   7. Run gradle via cmd /c (skip rust tasks) to produce APK
#
[CmdletBinding()]
param(
    [switch]$SkipCargo = $false,
    [switch]$SkipDevMode = $false
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
$AndroidRoot = Join-Path $ProjectRoot 'src-tauri\gen\android'
$CargoTarget = Join-Path $ProjectRoot 'src-tauri\target\aarch64-linux-android\debug\libapp_lib.so'
$JniLibsArm64 = Join-Path $AndroidRoot 'app\src\main\jniLibs\arm64-v8a'
$SkipFrontendConf = Join-Path $ProjectRoot 'src-tauri\tauri.android-skip-frontend.conf.json'

# Env
$Env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot'
$Env:ANDROID_HOME = 'G:\Android\Sdk'
$Env:ANDROID_SDK_ROOT = 'G:\Android\Sdk'
$Env:NDK_HOME = 'G:\Android\Sdk\ndk\28.2.13676358'
$Env:CARGO_INCREMENTAL = '0'

function Step([string]$msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Note([string]$msg) { Write-Host "  $msg" -ForegroundColor Green }
function Warn([string]$msg) { Write-Host "  $msg" -ForegroundColor Yellow }

function Is-Administrator {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Enable-DevMode {
    if ($SkipDevMode) { Warn "[-SkipDevMode] skip"; return $false }
    if (-not (Is-Administrator)) { Warn "not admin, fallback to bypass"; return $false }
    try {
        $regPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
        if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
        Set-ItemProperty -Path $regPath -Name 'AllowDevelopmentWithoutDevLicense' -Value 1 -Type DWord -Force
        $userPath = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
        if (-not (Test-Path $userPath)) { New-Item -Path $userPath -Force | Out-Null }
        Set-ItemProperty -Path $userPath -Name 'AllowDevelopmentWithoutDevLicense' -Value 1 -Type DWord -Force
        Note "dev mode registry written"
        return $true
    }
    catch {
        Warn "dev mode failed: $($_.Exception.Message). fallback."
        return $false
    }
}

function Kill-Stale {
    Step "kill stale build processes"
    Get-Process -Name java,cargo,rustc,clang,tauri -ErrorAction SilentlyContinue | ForEach-Object {
        try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
    Start-Sleep -Seconds 1
    cmd /c "del /f /q `"$ProjectRoot\src-tauri\target\debug\.cargo-*.lock`" 2>nul" | Out-Null
    cmd /c "del /f /q `"$ProjectRoot\src-tauri\target\aarch64-linux-android\debug\.cargo-*.lock`" 2>nul" | Out-Null
    $daemonDir = Join-Path $env:USERPROFILE '.gradle\daemon\8.14.3'
    if (Test-Path $daemonDir) {
        cmd /c "del /f /q `"$daemonDir\*.lock`" 2>nul" | Out-Null
    }
    $androidCache = Join-Path $env:USERPROFILE '.android'
    if (Test-Path $androidCache) {
        cmd /c "del /f /q `"$androidCache\*.lock`" 2>nul" | Out-Null
    }
    Note "stale cleared"
}

function Clear-Transforms {
    $transforms = Join-Path $env:USERPROFILE '.gradle\caches\8.14.3\transforms'
    if (Test-Path $transforms) {
        Step "clear transforms cache"
        cmd /c "rmdir /s /q `"$transforms`"" | Out-Null
        Note "transforms cleared"
    }
}

function Ensure-SkipFrontendConf {
    Step "ensure skip-frontend config"
    if (-not (Test-Path $SkipFrontendConf)) {
        @'
{
  "build": {
    "beforeBuildCommand": ""
  }
}
'@ | Set-Content -Path $SkipFrontendConf -Encoding utf8
        Note "created $SkipFrontendConf"
    }
    else { Note "exists" }
}

function Invoke-CargoBuild {
    Step "compile Rust (cargo + NDK, aarch64-linux-android)"
    $cargoLog = Join-Path $ProjectRoot 'build-android-cargo.log'
    Note "log: $cargoLog"
    Push-Location $ProjectRoot
    try {
        # Build a single cmd.exe command with env vars set inline
        $cmd = "set JAVA_HOME=$Env:JAVA_HOME && set ANDROID_HOME=$Env:ANDROID_HOME && set ANDROID_SDK_ROOT=$Env:ANDROID_SDK_ROOT && set NDK_HOME=$Env:NDK_HOME && set CARGO_INCREMENTAL=0 && .\node_modules\.bin\tauri.exe android build --debug --apk --target aarch64 --ci --config src-tauri/tauri.android-skip-frontend.conf.json > `"$cargoLog`" 2>&1"
        $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd -WindowStyle Hidden -PassThru
        Note "pid = $($proc.Id), waiting..."
        $proc.WaitForExit()
        Note "exit = $($proc.ExitCode)"
        if ($proc.ExitCode -ne 0) {
            Get-Content $cargoLog -Tail 30 -ErrorAction SilentlyContinue | Write-Host
            throw "cargo/tauri build exit $($proc.ExitCode)"
        }
    }
    finally {
        Pop-Location
    }
}

function Copy-SoToJniLibs {
    Step "copy .so to jniLibs/arm64-v8a (bypass symlink)"
    if (-not (Test-Path $CargoTarget)) {
        throw "not found: $CargoTarget"
    }
    New-Item -ItemType Directory -Path $JniLibsArm64 -Force | Out-Null
    Copy-Item -Path $CargoTarget -Destination $JniLibsArm64 -Force
    $size = (Get-Item (Join-Path $JniLibsArm64 'libapp_lib.so')).Length
    Note ("copied ({0}MB)" -f [math]::Round($size/1MB,1))
}

function Invoke-GradlePack {
    Step "gradle pack APK (skip rust tasks)"
    $gradleLog = Join-Path $ProjectRoot 'build-android-gradle.log'
    Note "log: $gradleLog"
    Push-Location $AndroidRoot
    try {
        $gradleCmd = '.\gradlew.bat :app:assembleDebug ' +
            '-x rustBuildArm64Debug -x rustBuildArmDebug ' +
            '-x rustBuildX86Debug -x rustBuildX86_64Debug -x rustBuildUniversalDebug ' +
            '-x rustBuildArm64Release -x rustBuildArmRelease ' +
            '-x rustBuildX86Release -x rustBuildX86_64Release -x rustBuildUniversalRelease ' +
            '--console=plain'
        $cmd = "set JAVA_HOME=$Env:JAVA_HOME && set ANDROID_HOME=$Env:ANDROID_HOME && set ANDROID_SDK_ROOT=$Env:ANDROID_SDK_ROOT && set NDK_HOME=$Env:NDK_HOME && $gradleCmd > `"$gradleLog`" 2>&1"
        $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd -WindowStyle Hidden -PassThru
        Note "pid = $($proc.Id), waiting..."
        $proc.WaitForExit()
        Note "exit = $($proc.ExitCode)"
        if ($proc.ExitCode -ne 0) {
            Get-Content $gradleLog -Tail 40 -ErrorAction SilentlyContinue | Write-Host
            throw "gradle exit $($proc.ExitCode)"
        }
    }
    finally {
        Pop-Location
    }
}

function Show-Output {
    Step "APK output"
    $outDir = Join-Path $AndroidRoot 'app\build\outputs\apk\arm64\debug'
    if (Test-Path $outDir) {
        Get-ChildItem -Path $outDir -Filter '*.apk' | ForEach-Object {
            Note ("{0}  {1}MB" -f $_.FullName, [math]::Round($_.Length/1MB,1))
        }
    }
}

# ============ main ============
Write-Host "ProjectRoot = $ProjectRoot"

Enable-DevMode
Kill-Stale
Ensure-SkipFrontendConf

if (-not $SkipCargo) {
    Invoke-CargoBuild
}
else {
    Step "[-SkipCargo] skip cargo"
}

Copy-SoToJniLibs
Clear-Transforms
Invoke-GradlePack
Show-Output

Write-Host "`nbuild done." -ForegroundColor Green