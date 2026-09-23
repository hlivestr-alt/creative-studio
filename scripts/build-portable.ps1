$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$permanentExe = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'PROYA-Creative-Studio.exe'))
$buildDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectRoot '.portable-build'))
$candidateExe = [System.IO.Path]::GetFullPath((Join-Path $buildDirectory 'PROYA-Creative-Studio.portable.exe'))
$sevenZip = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'node_modules\electron-winstaller\vendor\7z.exe'))
$resourceCheckDirectory = [System.IO.Path]::GetFullPath((Join-Path $buildDirectory 'resource-check'))
$replacementExe = "$permanentExe.new"
$backupExe = "$permanentExe.previous"

if ($buildDirectory -notlike "$projectRoot\*") {
  throw "Portable build directory resolved outside the project: $buildDirectory"
}

function Assert-PermanentExecutableAvailable {
  $running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and [System.IO.Path]::GetFullPath($_.ExecutablePath) -eq $permanentExe }
  if ($running) {
    throw 'Close PROYA-Creative-Studio.exe before rebuilding.'
  }

  if (Test-Path -LiteralPath $permanentExe) {
    try {
      $stream = [System.IO.File]::Open($permanentExe, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
      $stream.Dispose()
    } catch {
      throw 'Close PROYA-Creative-Studio.exe before rebuilding.'
    }
  }
}

function Invoke-BuildStep {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Label
  )
  Write-Host "`n== $Label =="
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE. The permanent EXE was not replaced."
  }
}

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '')
  } finally {
    $stream.Dispose()
    $algorithm.Dispose()
  }
}

Push-Location $projectRoot
try {
  Assert-PermanentExecutableAvailable

  if (Test-Path -LiteralPath $buildDirectory) {
    Remove-Item -LiteralPath $buildDirectory -Recurse -Force
  }
  Remove-Item -LiteralPath $replacementExe, $backupExe -Force -ErrorAction SilentlyContinue

  Invoke-BuildStep -Command 'npm.cmd' -Arguments @('run', 'typecheck') -Label 'Typecheck'
  Invoke-BuildStep -Command 'npm.cmd' -Arguments @('run', 'build:app') -Label 'Application build'
  Invoke-BuildStep -Command 'npx.cmd' -Arguments @('electron-builder', '--win', 'portable', '--x64') -Label 'Portable packaging'

  if (!(Test-Path -LiteralPath $candidateExe -PathType Leaf)) {
    throw "Portable packaging completed but the expected EXE does not exist: $candidateExe. The permanent EXE was not replaced."
  }
  $candidate = Get-Item -LiteralPath $candidateExe
  if ($candidate.Length -le 0) {
    throw "Portable packaging produced an empty EXE. The permanent EXE was not replaced."
  }

  # Inspect the final NSIS portable payload, not only electron-builder's unpacked staging directory.
  if (!(Test-Path -LiteralPath $sevenZip -PathType Leaf)) {
    throw "The bundled 7-Zip verifier is unavailable: $sevenZip. The permanent EXE was not replaced."
  }
  New-Item -ItemType Directory -Path $resourceCheckDirectory | Out-Null
  Invoke-BuildStep -Command $sevenZip -Arguments @('e', '-y', "-o$resourceCheckDirectory", $candidateExe, '$PLUGINSDIR\app-64.7z') -Label 'Extract portable payload index'
  $payloadArchive = Join-Path $resourceCheckDirectory 'app-64.7z'
  if (!(Test-Path -LiteralPath $payloadArchive -PathType Leaf)) {
    throw 'The portable EXE has no app-64.7z payload. The permanent EXE was not replaced.'
  }
  $payloadDirectory = Join-Path $resourceCheckDirectory 'payload'
  $requiredPortableResources = @(
    'resources\workflows\minimax-h3-api.json',
    'resources\product-assets\cleanser.png',
    'resources\product-assets\toner.png',
    'resources\product-assets\serum.png',
    'resources\product-assets\eye-cream.png',
    'resources\product-assets\skin-cream.png',
    'resources\product-assets\mask.png'
  )
  Invoke-BuildStep -Command $sevenZip -Arguments (@('x', '-y', "-o$payloadDirectory", $payloadArchive) + $requiredPortableResources) -Label 'Extract packaged workflow and product resources'
  $packagedWorkflow = Join-Path $payloadDirectory 'resources\workflows\minimax-h3-api.json'
  $sourceWorkflow = Join-Path $projectRoot 'workflows\minimax-h3-api.json'
  if (!(Test-Path -LiteralPath $packagedWorkflow -PathType Leaf)) {
    throw 'The final portable EXE is missing workflows\minimax-h3-api.json. The permanent EXE was not replaced.'
  }
  if ((Get-Sha256 -Path $packagedWorkflow) -ne (Get-Sha256 -Path $sourceWorkflow)) {
    throw 'The final portable EXE workflow differs from the canonical source. The permanent EXE was not replaced.'
  }
  $null = Get-Content -Raw -LiteralPath $packagedWorkflow | ConvertFrom-Json -ErrorAction Stop
  foreach ($relativeResource in $requiredPortableResources | Where-Object { $_ -like 'resources\product-assets\*' }) {
    $packagedAsset = Join-Path $payloadDirectory $relativeResource
    $sourceAsset = Join-Path $projectRoot ($relativeResource -replace '^resources\\', '')
    if (!(Test-Path -LiteralPath $packagedAsset -PathType Leaf)) {
      throw "The final portable EXE is missing $relativeResource. The permanent EXE was not replaced."
    }
    if ((Get-Sha256 -Path $packagedAsset) -ne (Get-Sha256 -Path $sourceAsset)) {
      throw "The final portable EXE resource differs from source: $relativeResource. The permanent EXE was not replaced."
    }
  }
  Write-Host 'Verified final portable workflow and all required product resources.'

  $candidateHash = Get-Sha256 -Path $candidateExe
  Copy-Item -LiteralPath $candidateExe -Destination $replacementExe -Force
  $replacementHash = Get-Sha256 -Path $replacementExe
  if ($replacementHash -ne $candidateHash) {
    throw "Portable EXE copy verification failed. The permanent EXE was not replaced."
  }

  Assert-PermanentExecutableAvailable
  if (Test-Path -LiteralPath $permanentExe) {
    [System.IO.File]::Replace($replacementExe, $permanentExe, $backupExe, $true)
    Remove-Item -LiteralPath $backupExe -Force -ErrorAction SilentlyContinue
  } else {
    Move-Item -LiteralPath $replacementExe -Destination $permanentExe
  }

  $permanentHash = Get-Sha256 -Path $permanentExe
  if ($permanentHash -ne $candidateHash) {
    throw "Permanent EXE verification failed after replacement."
  }

  Write-Host "`nPortable build complete."
  Write-Host "Permanent EXE: $permanentExe"
  Write-Host "Size: $((Get-Item -LiteralPath $permanentExe).Length) bytes"
  Write-Host "SHA-256: $permanentHash"
} finally {
  Remove-Item -LiteralPath $replacementExe -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $buildDirectory) {
    Remove-Item -LiteralPath $buildDirectory -Recurse -Force
  }
  Pop-Location
}
