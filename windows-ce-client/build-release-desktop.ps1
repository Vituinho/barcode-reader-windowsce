# Builds the distributable desktop simulator package:
#   build\release\GivovaCollector-Simulator-v<version>.zip
# Contains ONLY: GivovaCollector.exe, collector.ini.example, README-INSTALL.txt
# (no source, .pdb, tests, scripts, local collector.ini, data/journal, logs, .env, tokens).
#
# Usage:  powershell -ExecutionPolicy Bypass -File build-release-desktop.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Version: single source of truth in AppInfo.Version
$appSource = Get-Content (Join-Path $root "src\GivovaCollector\CollectorApp.cs") -Raw
$match = [regex]::Match($appSource, 'public const string Version = "(\d+\.\d+\.\d+)";')
if (-not $match.Success) { throw "AppInfo.Version not found" }
$version = $match.Groups[1].Value

# 1-2. Rebuild simulator and run collector tests (aborts on failure)
& powershell -ExecutionPolicy Bypass -File (Join-Path $root "build-desktop.ps1") -RunTests
if ($LASTEXITCODE -ne 0) { throw "build/tests failed" }

# 3. Clean staging directory
$releaseDir = Join-Path $root "build\release"
$stage = Join-Path $releaseDir "stage"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null

# 4. Copy only the allowed files
Copy-Item (Join-Path $root "build\desktop\GivovaCollector.exe") $stage
Copy-Item (Join-Path $root "release\collector.ini.example") $stage
$readme = (Get-Content (Join-Path $root "release\README-INSTALL.txt") -Raw).Replace("{VERSION}", $version)
[IO.File]::WriteAllText((Join-Path $stage "README-INSTALL.txt"), $readme.Replace("`r`n", "`n").Replace("`n", "`r`n"))

$allowed = @("GivovaCollector.exe", "collector.ini.example", "README-INSTALL.txt")
$staged = Get-ChildItem -Recurse -Force $stage
foreach ($f in $staged) {
    if ($f.PSIsContainer -or $allowed -notcontains $f.Name) { throw "Unexpected file in package: $($f.FullName)" }
}
# The example config must never carry credentials or local state
$ini = Get-Content (Join-Path $stage "collector.ini.example") -Raw
if ($ini -match '(?im)^\s*(AdminPinHash\s*=\s*\S|Token|Password|Senha\s*=)') { throw "collector.ini.example contains secrets" }

# 6. Zip
$zip = Join-Path $releaseDir "GivovaCollector-Simulator-v$version.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -CompressionLevel Optimal

# 5/7. Checksum and summary
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item $zip).Length
Set-Content -Path "$zip.sha256" -Value "$hash  GivovaCollector-Simulator-v$version.zip" -Encoding ascii

Write-Host ""
Write-Host "Package : $zip"
Write-Host "Version : $version"
Write-Host "Size    : $size bytes"
Write-Host "SHA-256 : $hash"
