$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$source = Join-Path $repoRoot 'deploy\china-auto-runner-production'
$shared = Join-Path $repoRoot 'deploy\china-auto-runner-shadow'
$output = Join-Path $repoRoot 'release\china-auto-runner-production-20260910-r10'
$runtime = Join-Path $output 'runtime'
$zip = Join-Path $repoRoot 'release\PROYA-China-Auto-Runner-Production-20260910-r10.zip'
$deploymentManifest = Join-Path $repoRoot 'release\PROYA-China-Auto-Runner-Production-20260910-r10.manifest.json'
function Hash([string]$path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
if ((Test-Path $zip) -or (Test-Path $deploymentManifest)) { throw 'Refusing to overwrite an existing r10 artifact.' }
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
$manifest=[ordered]@{ filename=(Split-Path -Leaf $zip); runnerVersion='2.0.0-production.20260910'; packageRelease='20260910-r10'; mode='production'; maxJobsPerSession=$null; buildTimestamp=$timestamp; listenAddress='127.0.0.1:8787'; stateDatabase='D:\AI Videos\.proya-auto\runner.sqlite3'; journalMode='WAL'; comfyUrl='http://127.0.0.1:8188'; lmStudioUrl='http://127.0.0.1:1234'; archiveRoot='D:\AI Videos'; cloudflareRequiredAfterStart=$false; oneGpuJobAtATime=$true; continuousUntilStopped=$true; validatorPromptGuidesSha256='6d53c021163fefc5b5409fb07015d113cc6166e34ae82109278d5998562693b8'; basedOn='r9.2 / 1.3.1-two-job-canary.20260910' }
$manifest|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $output 'manifest.json') -Encoding UTF8
Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $output | ForEach-Object FullName) -DestinationPath $zip -CompressionLevel Optimal
$hash=Hash $zip
Set-Content -LiteralPath "$zip.sha256" -Value "$hash  $(Split-Path -Leaf $zip)" -Encoding Ascii
$manifest['sha256']=$hash
$manifest|ConvertTo-Json|Set-Content -LiteralPath $deploymentManifest -Encoding UTF8
Write-Output $zip
Write-Output $hash
Write-Output $deploymentManifest
