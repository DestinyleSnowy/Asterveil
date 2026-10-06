param(
    [ValidateSet('chrome', 'edge')][string]$Browser,
    [string]$ExtensionId,
    [string]$Directory,
    [ValidateSet('Install', 'Repair', 'Unbind')][string]$Action = 'Install'
)
$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitOperatingSystem) { throw '需要 Windows x64。' }
if (-not $ExtensionId) { $ExtensionId = Read-Host '扩展 ID（在 chrome://extensions 或 edge://extensions 查看）' }
if ($ExtensionId -cnotmatch '^[a-p]{32}$') { throw '扩展 ID 无效。' }

if ($Action -eq 'Install') {
    if (-not $Browser) { $Browser = Read-Host '浏览器（chrome / edge）' }
    if ($Browser -notin @('chrome', 'edge')) { throw '请选择 chrome 或 edge。' }
    if (-not $Directory) { $Directory = Read-Host '当前加载的扩展目录' }
    $Directory = (Resolve-Path -LiteralPath $Directory.Trim('"')).Path
    $executable = Join-Path $PSScriptRoot 'asterveil-updater.exe'
    $arguments = @('--install', $Browser, $ExtensionId, $Directory)
} else {
    $hostManifest = Join-Path $env:LOCALAPPDATA 'Asterveil\Updater\cn.asterveil.updater.json'
    $executable = (Get-Content -Raw -LiteralPath $hostManifest | ConvertFrom-Json).path
    $arguments = @($(if ($Action -eq 'Repair') { '--repair' } else { '--unbind' }), $ExtensionId)
}
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw '找不到更新器，请先完整解压安装包。' }
# Capture stderr from the hidden native process and wait for its exit.
$errorFile = [IO.Path]::GetTempFileName()
try {
    $quotedArguments = ($arguments | ForEach-Object {
        if ($_ -match '["\r\n]') { throw 'Invalid argument.' }
        '"' + $_.TrimEnd('\') + '"'
    }) -join ' '
    $process = Start-Process -FilePath $executable -ArgumentList $quotedArguments -PassThru -Wait -WindowStyle Hidden -RedirectStandardError $errorFile
    if ($process.ExitCode -ne 0) {
        throw ([IO.File]::ReadAllText($errorFile, [Text.Encoding]::UTF8))
    }
} finally { Remove-Item -LiteralPath $errorFile -Force }
if ($Action -eq 'Install') { Write-Host '安装完成。请在 Asterveil「关于」中开启自动更新。' }
elseif ($Action -eq 'Repair') { Write-Host '已恢复旧版文件，请在浏览器中重新加载扩展。' }
else { Write-Host '已解除绑定。扩展文件、设置和草稿已保留。' }
