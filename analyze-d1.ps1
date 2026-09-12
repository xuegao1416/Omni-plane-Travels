$ErrorActionPreference = 'Stop'

# UTF-8 输出修复
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 无 BOM 的 UTF-8 写出（GetBytes 不会产生 BOM 前导符）
function Write-Utf8($Path, $Text) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    [System.IO.File]::WriteAllBytes($Path, $bytes)
}

$scriptRoot = $PSScriptRoot
$database   = 'omni-travels'

# ---- 解析 wrangler 路径（修复 bunx 失效问题）----
$ManagedNode = 'C:\Users\MECHREVO\.workbuddy\binaries\node\versions\22.22.2\node.exe'
if (Test-Path -LiteralPath $ManagedNode) {
    $nodeExe = $ManagedNode
}
else {
    $nodeExe = 'node'
}
$wranglerJs = Join-Path $scriptRoot 'node_modules\wrangler\bin\wrangler.js'
if (-not (Test-Path -LiteralPath $wranglerJs)) {
    throw "找不到 wrangler：$wranglerJs"
}

$sqlPath = Join-Path $scriptRoot 'd1-analytics.sql'
if (-not (Test-Path -LiteralPath $sqlPath)) {
    throw "找不到 SQL 文件：$sqlPath"
}

$sqlText = [System.Text.Encoding]::UTF8.GetString(
    [System.IO.File]::ReadAllBytes($sqlPath)
)

$queryMatches = [regex]::Matches(
    $sqlText,
    '(?ms)^\s*--\s*BEGIN\s+([^\r\n]+)\r?\n(.*?)\r?\n\s*--\s*END\s*$'
)
if ($queryMatches.Count -eq 0) {
    throw 'No BEGIN/END query blocks were found in the SQL file.'
}

# 输出目录
$reportDir = Join-Path $scriptRoot 'reports'
if (-not (Test-Path -LiteralPath $reportDir)) {
    New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
}

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$genTime = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

Write-Host ''
Write-Host '====================================' -ForegroundColor Cyan
Write-Host " Remote D1 database: $database" -ForegroundColor Cyan
Write-Host ' World Travel Guide - play analytics report' -ForegroundColor Cyan
Write-Host '====================================' -ForegroundColor Cyan
Write-Host ''

$data = @{}
foreach ($match in $queryMatches) {
    $title = $match.Groups[1].Value.Trim()
    $query = ($match.Groups[2].Value -replace '\s+', ' ').Trim()
    $jsonKey = $title

    Write-Host "----- running: $title -----" -ForegroundColor Yellow

    $cmdArgs = @(
        $wranglerJs,
        'd1', 'execute', $database,
        '--remote', '--json',
        "--command=$query"
    )

    # 带重试的查询（Cloudflare 偶发 fetch failed）
    # PS5.1 兼容：用 .NET Process 绕过 native command stderr 处理问题
    $maxAttempts = 3
    $ok = $false
    $rawOutput = ''
    $argString = '"' + $wranglerJs + '"'
    foreach ($a in ($cmdArgs | Select-Object -Skip 1)) {
        $argString += ' "' + ($a -replace '"', '\"') + '"'
    }
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $nodeExe
        $psi.Arguments = $argString
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.CreateNoWindow = $true
        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $psi
        [void]$proc.Start()
        $rawOutput = $proc.StandardOutput.ReadToEnd()
        $proc.WaitForExit()
        $exitCode = $proc.ExitCode
        if ($exitCode -eq 0) {
            $payload = $rawOutput | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($payload -and $payload[0] -and $payload[0].results) {
                $ok = $true
                break
            }
        }
        if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds 3 }
    }

    if ($ok) {
        # 逐行序列化后手工拼成 JSON 数组，彻底规避 PowerShell 对嵌套/单元素数组的破坏
        $rows = @($payload[0].results)
        $rowJsons = $rows | ForEach-Object { $_ | ConvertTo-Json -Depth 10 -Compress }
        $arrJson = '[' + ($rowJsons -join ',') + ']'
        $data[$jsonKey] = $arrJson
        Write-Host ("  {0} rows" -f $rows.Count)
    }
    else {
        Write-Host '(query failed after retries / no data)'
        $data[$jsonKey] = '[]'
    }
}

# ---- 手工拼装最终 JSON（键名用 ConvertTo-Json 安全转义，值用原始数组文本）----
$sb = New-Object System.Text.StringBuilder
$sb.Append('{') | Out-Null
$first = $true
foreach ($kv in $data.GetEnumerator()) {
    if (-not $first) { $sb.Append(',') | Out-Null }
    $first = $false
    $keyJson = ($kv.Key | ConvertTo-Json -Compress).Trim()
    $sb.Append($keyJson) | Out-Null
    $sb.Append(':') | Out-Null
    $sb.Append($kv.Value) | Out-Null
}
$sb.Append('}') | Out-Null
$json = $sb.ToString()

# ---- 写出 JSON 数据（带日期 + latest）----
$jsonName = 'analytics-data-' + $stamp + '.json'
$jsonFileDated = Join-Path $reportDir $jsonName
$jsonFileLatest = Join-Path $reportDir 'analytics-data.json'
Write-Utf8 $jsonFileDated $json
Write-Utf8 $jsonFileLatest $json

Write-Host ''
Write-Host '====================================' -ForegroundColor Green
Write-Host ' data collected, building report...' -ForegroundColor Green
Write-Host '====================================' -ForegroundColor Green

# ---- 读取 HTML 报表模板并注入数据 ----
$templatePath = Join-Path $scriptRoot 'report-template.html'
if (-not (Test-Path -LiteralPath $templatePath)) {
    throw "找不到报表模板：$templatePath"
}
$template = [System.IO.File]::ReadAllText($templatePath, [System.Text.Encoding]::UTF8)

$reportHtml = $template.Replace('__DATA_JSON__', $json)
$reportHtml = $reportHtml.Replace('__GEN_TIME__', $genTime)
$ovArr = $data['overview'] | ConvertFrom-Json
$ovRow = if ($ovArr -and $ovArr.Count -gt 0) { $ovArr[0] } else { $null }
$rangeStr = if ($ovRow -and $ovRow.first_day) { ($ovRow.first_day + ' ~ ' + $ovRow.last_day) } else { 'n/a' }
$reportHtml = $reportHtml.Replace('__DATE_RANGE__', $rangeStr)

$htmlName = 'play-report-' + $stamp + '.html'
$htmlDated = Join-Path $reportDir $htmlName
$htmlLatest = Join-Path $reportDir 'play-report.html'
Write-Utf8 $htmlDated $reportHtml
Write-Utf8 $htmlLatest $reportHtml

Write-Host ''
Write-Host '====================================' -ForegroundColor Green
Write-Host ' report generated:' -ForegroundColor Green
Write-Host "   $htmlLatest"
Write-Host "   $htmlDated"
Write-Host '====================================' -ForegroundColor Green
