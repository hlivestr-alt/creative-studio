$ErrorActionPreference='Stop'
$repoRoot=Resolve-Path (Join-Path $PSScriptRoot '..')
$filename='PROYA-Creative-Studio-ChinaAutoRun-Production-20260910-r10.3.exe'
$exe=Join-Path $repoRoot "release\$filename"
$manifestPath=Join-Path $repoRoot 'release\PROYA-Creative-Studio-ChinaAutoRun-Production-20260910-r10.3.manifest.json'
if(-not(Test-Path $exe)){throw "Missing $exe"}
if((Test-Path $manifestPath) -or (Test-Path "$exe.sha256")){throw 'Refusing to overwrite production controller metadata.'}
$hash=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest=[ordered]@{filename=$filename;sha256=$hash;buildTimestamp=(Get-Date).ToUniversalTime().ToString('o');release='production-20260910';feature='One-button China-owned continuous Auto Run';laptopSchedulerAuthority=$false;directComfyLifecycleCalls=$false;legacyStartPrimary=$false;artifactSyncIndependent=$true}
$manifest|ConvertTo-Json|Set-Content -LiteralPath $manifestPath -Encoding UTF8
Set-Content -LiteralPath "$exe.sha256" -Value "$hash  $filename" -Encoding Ascii
Write-Output $exe
Write-Output $hash
Write-Output $manifestPath
