param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root '.output' }
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$staging = Join-Path $OutputDirectory ('updater-package-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $staging
try {
    Copy-Item -LiteralPath (Join-Path $root 'updater\target\release\asterveil-updater.exe') -Destination $staging
    foreach ($name in @('install.ps1', 'install.cmd', 'README.md', 'release-public-key.hex')) {
        Copy-Item -LiteralPath (Join-Path $root ('updater\' + $name)) -Destination $staging
    }
    Copy-Item -LiteralPath (Join-Path $root 'LICENSE') -Destination $staging
    node (Join-Path $PSScriptRoot 'licenses.mjs') (Join-Path $staging 'THIRD_PARTY_LICENSES.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Could not collect dependency licenses.' }
    $archive = Join-Path $OutputDirectory 'Asterveil-Updater-windows-x64.zip'
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $archive -Force
    Write-Host $archive
} finally {
    $resolvedStaging = [IO.Path]::GetFullPath($staging)
    if (-not $resolvedStaging.StartsWith($OutputDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe staging path.' }
    Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
}
