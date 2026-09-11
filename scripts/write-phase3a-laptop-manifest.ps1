$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$exe = Join-Path $repoRoot 'release\PROYA-Creative-Studio-ChinaController-Phase3A-20260909.exe'
$manifestPath = Join-Path $repoRoot 'release\PROYA-Creative-Studio-ChinaController-Phase3A-20260909.manifest.json'
if (-not (Test-Path -LiteralPath $exe)) { throw "Missing laptop artifact $exe" }
if (Test-Path -LiteralPath $manifestPath) { throw "Refusing to overwrite $manifestPath" }
$hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{ filename=(Split-Path -Leaf $exe); sha256=$hash; buildTimestamp=(Get-Date).ToUniversalTime().ToString('o'); phase='3A'; feature='China shadow session controller'; generationEnabled=$false }
$manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Set-Content -LiteralPath "$exe.sha256" -Value "$hash  $(Split-Path -Leaf $exe)" -Encoding Ascii
Write-Output $exe
Write-Output $hash
Write-Output $manifestPath
