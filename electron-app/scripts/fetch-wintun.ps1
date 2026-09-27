# MEMENTO — wintun.dll fetch + verify (Phase B0, Windows variant).
#
# Mirrors the reference project's fetch pattern: download the OFFICIAL
# wintun zip, verify the zip digest, extract bin/amd64/wintun.dll, verify
# the dll digest, verify the Authenticode publisher, THEN place the dll
# + the license text. Refuses EVERY mismatch (a version bump that misses
# a constant fails at build time, not on a user's machine).
#
# Keep the digests in lockstep with electron/wintunPin.ts (the ONE place).

$ErrorActionPreference = "Stop"

$WintunZipUrl   = "https://www.wintun.net/builds/wintun-0.14.1.zip"
$WintunZipSha   = "07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51"
$WintunDllSha   = "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce"
$WintunPublisher = "WireGuard LLC"

$AppRoot  = Join-Path $PSScriptRoot ".."
$DestDir  = Join-Path $AppRoot "resources\wintun\bin\amd64"
$Temp     = Join-Path ([System.IO.Path]::GetTempPath()) "memento-wintun-$([guid]::NewGuid())"

try {
  New-Item -ItemType Directory -Force $Temp | Out-Null
  $Archive = Join-Path $Temp "wintun-0.14.1.zip"

  Write-Host "[fetch-wintun] downloading $WintunZipUrl"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $WintunZipUrl -OutFile $Archive -UseBasicParsing

  $ActualZip = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualZip -ne $WintunZipSha) {
    throw "[fetch-wintun] REFUSED: zip sha256 mismatch (expected $WintunZipSha, got $ActualZip)"
  }
  Write-Host "[fetch-wintun] zip sha256 OK: $ActualZip"

  $Expanded = Join-Path $Temp "expanded"
  Expand-Archive -LiteralPath $Archive -DestinationPath $Expanded

  $SourceDll = Join-Path $Expanded "wintun\bin\amd64\wintun.dll"
  if (-not (Test-Path -LiteralPath $SourceDll)) {
    throw "[fetch-wintun] REFUSED: bin/amd64/wintun.dll not found in the official zip"
  }

  $ActualDll = (Get-FileHash -LiteralPath $SourceDll -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualDll -ne $WintunDllSha) {
    throw "[fetch-wintun] REFUSED: dll sha256 mismatch (expected $WintunDllSha, got $ActualDll)"
  }
  Write-Host "[fetch-wintun] dll sha256 OK: $ActualDll"

  # Authenticode: the signer MUST be WireGuard LLC (B0 gate; B1 re-checks
  # at runtime via the spawn-integrity gate).
  $Sig = Get-AuthenticodeSignature -LiteralPath $SourceDll
  if ($Sig.Status -ne "Valid" -or $Sig.SignerCertificate.Subject -notlike "*$WintunPublisher*") {
    throw ("[fetch-wintun] REFUSED: Authenticode check failed (status={0}, subject='{1}')" -f
      $Sig.Status, $Sig.SignerCertificate.Subject)
  }
  Write-Host "[fetch-wintun] Authenticode OK: signed by $WintunPublisher"

  New-Item -ItemType Directory -Force $DestDir | Out-Null
  Copy-Item -LiteralPath $SourceDll -Destination (Join-Path $DestDir "wintun.dll") -Force
  Copy-Item -LiteralPath (Join-Path $Expanded "wintun\LICENSE.txt") `
    -Destination (Join-Path $AppRoot "resources\wintun\wintun-LICENSE.txt") -Force
  Write-Host "[fetch-wintun] placed verified wintun.dll -> resources\wintun\bin\amd64\wintun.dll"
  Write-Host "[fetch-wintun] DONE"
}
finally {
  if (Test-Path -LiteralPath $Temp) { Remove-Item -LiteralPath $Temp -Recurse -Force }
}
