# Desktop build of the collector (simulator), core tests and scenario runner.
#
# Uses the C# compiler that ships with Windows (.NET Framework 4.x) restricted to C# 3
# (/langversion:3), the language level of Visual Studio 2008 / .NET Compact Framework 3.5.
# This verifies syntax and the shared code paths; it does NOT prove every API exists in the
# Compact Framework. The real device build must be done with VS2008 + CF 3.5 (see README).
#
# Usage:  powershell -ExecutionPolicy Bypass -File build-desktop.ps1 [-RunTests]
param([switch]$RunTests)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc" }

$src = Join-Path $root "src\GivovaCollector"
$out = Join-Path $root "build\desktop"
New-Item -ItemType Directory -Force $out | Out-Null

$all = Get-ChildItem -Path $src -Recurse -Filter *.cs | ForEach-Object { $_.FullName }
$core = $all | Where-Object { $_ -notmatch '\\UI\\' -and $_ -notmatch '\\Program\.cs$' -and $_ -notmatch '\\CollectorApp\.cs$' -and $_ -notmatch '\\Scanner\\' -and $_ -notmatch '\\Properties\\' }

# Check that the Smart Device project lists every source file.
$csproj = Get-Content (Join-Path $src "GivovaCollector.csproj") -Raw
$missing = $all | ForEach-Object { $_.Substring($src.Length + 1) } | Where-Object { $csproj -notmatch [regex]::Escape("Include=`"$_`"") }
if ($missing) { throw "Files missing from GivovaCollector.csproj: $($missing -join ', ')" }

$common = @("/nologo", "/langversion:3", "/codepage:65001", "/warn:4", "/optimize+", "/debug:pdbonly")

function Invoke-Csc([string[]]$arguments) {
    & $csc @arguments
    if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }
}

Write-Host "== Collector simulator (WinForms, C# 3)"
Invoke-Csc ($common + @("/target:winexe", "/define:DESKTOP", "/out:$out\GivovaCollector.exe",
    "/r:System.dll", "/r:System.Drawing.dll", "/r:System.Windows.Forms.dll") + $all)

Write-Host "== Core tests"
$tests = Get-ChildItem -Path (Join-Path $root "tests\CollectorCoreTests") -Filter *.cs | ForEach-Object { $_.FullName }
Invoke-Csc ($common + @("/target:exe", "/define:DESKTOP", "/out:$out\CollectorCoreTests.exe", "/r:System.dll") + $core + $tests)

Write-Host "== Scenario runner"
$runner = Get-ChildItem -Path (Join-Path $root "tools\ScenarioRunner") -Filter *.cs | ForEach-Object { $_.FullName }
Invoke-Csc ($common + @("/target:exe", "/define:DESKTOP", "/out:$out\ScenarioRunner.exe", "/r:System.dll") + $core + $runner)

$ini = Join-Path $out "collector.ini"
if (-not (Test-Path $ini)) { Copy-Item (Join-Path $root "collector.ini.example") $ini }

Write-Host "Build OK -> $out"
if ($RunTests) {
    & "$out\CollectorCoreTests.exe"
    if ($LASTEXITCODE -ne 0) { throw "core tests failed" }
}
