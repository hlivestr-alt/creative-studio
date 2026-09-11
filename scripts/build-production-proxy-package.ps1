$ErrorActionPreference='Stop'
$repoRoot=Resolve-Path (Join-Path $PSScriptRoot '..')
$extension=Join-Path $repoRoot 'deploy\ComfyUI-MiniMax-H3-Prompt-Enhancer'
$stage=Join-Path $repoRoot 'release\china-runner-proxy-production-20260910-r10'
$payload=Join-Path $stage 'ComfyUI-MiniMax-H3-Prompt-Enhancer'
$zip=Join-Path $repoRoot 'release\PROYA-China-Runner-Proxy-Production-20260910-r10.zip'
$manifestPath=Join-Path $repoRoot 'release\PROYA-China-Runner-Proxy-Production-20260910-r10.manifest.json'
if ((Test-Path $zip) -or (Test-Path $manifestPath)) { throw 'Refusing to overwrite an existing production proxy artifact.' }
if(Test-Path $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
New-Item -ItemType Directory -Force -Path $payload|Out-Null
foreach($name in @('__init__.py','runner_proxy.py','runner_proxy_contract.py')){Copy-Item -LiteralPath (Join-Path $extension $name) -Destination $payload}
$timestamp=(Get-Date).ToUniversalTime().ToString('o')
$manifest=[ordered]@{filename=(Split-Path -Leaf $zip);buildTimestamp=$timestamp;release='production-r10';runnerOrigin='http://127.0.0.1:8787';stateless=$true;startProxied=$true;settingsVersionProxied=$true;artifactProxied=$true;laptopSyncAcknowledgementProxied=$true;stopAfterCurrentProxied=$true;stopNowProxied=$true;promptProxied=$false;freeProxied=$false;promptGuidesIncluded=$false}
$manifest|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $stage 'manifest.json') -Encoding UTF8
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
$hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$zip.sha256" -Value "$hash  $(Split-Path -Leaf $zip)" -Encoding Ascii
$manifest['sha256']=$hash
$manifest|ConvertTo-Json|Set-Content -LiteralPath $manifestPath -Encoding UTF8
Write-Output $zip
Write-Output $hash
Write-Output $manifestPath
