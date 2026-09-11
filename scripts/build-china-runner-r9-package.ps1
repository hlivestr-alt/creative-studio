$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$source = Join-Path $repoRoot 'deploy\china-auto-runner-two-job-canary'
$shared = Join-Path $repoRoot 'deploy\china-auto-runner-shadow'
$output = Join-Path $repoRoot 'release\china-auto-runner-two-job-canary-20260909-r9.1'
$runtime = Join-Path $output 'runtime'
$zip = Join-Path $repoRoot 'release\PROYA-China-Auto-Runner-TwoJobCanary-20260909-r9.1.zip'
$deploymentManifest = Join-Path $repoRoot 'release\PROYA-China-Auto-Runner-TwoJobCanary-20260909-r9.1.manifest.json'
function Hash([string]$path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
if ((Test-Path $zip) -or (Test-Path $deploymentManifest)) { throw 'Refusing to overwrite an existing r9.1 artifact.' }
if (Test-Path $output) { Remove-Item -LiteralPath $output -Recurse -Force }
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
foreach ($name in @('runner.cjs','runner.cjs.map','package-smoke.cjs','package-smoke.cjs.map')) { Copy-Item -LiteralPath (Join-Path $repoRoot "dist-china-runner\$name") -Destination $runtime }
Copy-Item -LiteralPath (Get-Command node).Source -Destination (Join-Path $runtime 'node.exe')
Copy-Item -LiteralPath (Join-Path $source 'config.template.json') -Destination (Join-Path $output 'config.template.json')
Copy-Item -LiteralPath (Join-Path $source 'config.template.json') -Destination (Join-Path $output 'config.json')
Copy-Item -LiteralPath (Join-Path $source 'README.md') -Destination $output
Copy-Item -LiteralPath (Join-Path $source 'start-runner.ps1') -Destination $output
foreach ($name in @('stop-runner.ps1','status-runner.ps1','install-login-autostart.ps1')) { Copy-Item -LiteralPath (Join-Path $shared $name) -Destination $output }
$timestamp=(Get-Date).ToUniversalTime().ToString('o')
$manifest=[ordered]@{ filename=(Split-Path -Leaf $zip); runnerVersion='1.3.0-two-job-canary.20260909'; packageRelease='20260909-r9.1'; mode='two-job-canary'; maxJobsPerSession=2; buildTimestamp=$timestamp; listenAddress='127.0.0.1:8787'; comfyUrl='http://127.0.0.1:8188'; lmStudioUrl='http://127.0.0.1:1234'; cloudflareRequiredAfterStart=$false; canaryStartEnabled=$true; stopAfterCurrentEnabled=$true; stopNowEnabled=$true; continuousAutoRunEnabled=$false }
$manifest|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $output 'manifest.json') -Encoding UTF8
Compress-Archive -Path (Join-Path $output '*') -DestinationPath $zip -CompressionLevel Optimal
$hash=Hash $zip; Set-Content -LiteralPath "$zip.sha256" -Value "$hash  $(Split-Path -Leaf $zip)" -Encoding Ascii
$manifest['sha256']=$hash; $manifest|ConvertTo-Json|Set-Content -LiteralPath $deploymentManifest -Encoding UTF8
Write-Output $zip; Write-Output $hash; Write-Output $deploymentManifest
