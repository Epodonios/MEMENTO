# ============================================================
# Download xray-core for MEMENTO (Windows PowerShell)
# Run this script ONCE before building the Tauri .exe
# Now extracts into src-tauri/resources/xray/ to preserve companion files
# ============================================================

$XrayVersion = "v25.1.1"
$Platform = "windows-64"
$DownloadUrl = "https://github.com/XTLS/Xray-core/releases/download/$XrayVersion/Xray-$Platform.zip"

$ResourcesDir = "src-tauri\resources\xray"
$TempZip = "$env:TEMP\xray.zip"

if (!(Test-Path $ResourcesDir)) {
    New-Item -ItemType Directory -Path $ResourcesDir -Force | Out-Null
}

Write-Host "Downloading xray-core $XrayVersion for $Platform..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempZip -UseBasicParsing

Write-Host "Extracting all files to $ResourcesDir..." -ForegroundColor Cyan

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($TempZip)

foreach ($entry in $zip.Entries) {
    # Skip directories
    if ([string]::IsNullOrEmpty($entry.Name)) { continue; }
    $destPath = Join-Path $ResourcesDir $entry.Name
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destPath, $true)
    Write-Host "  Extracted: $($entry.Name)" -ForegroundColor Green
}

$zip.Dispose()
Remove-Item $TempZip -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "xray-core ready at: $ResourcesDir\" -ForegroundColor Green
Get-ChildItem $ResourcesDir | ForEach-Object { Write-Host "  - $($_.Name)" -ForegroundColor Gray }
Write-Host "Now run: npx tauri build" -ForegroundColor Yellow
