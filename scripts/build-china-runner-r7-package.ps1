$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$source = Join-Path $repoRoot 'deploy\china-auto-runner-shadow'
$output = Join-Path $repoRoot 'release\china-auto-runner-shadow-20260909-r7'
$runtime = Join-Path $output 'runtime'
$zip = Join-Path $repoRoot 'release\PROYA-China-Auto-Runner-Shadow-20260909-r7.zip'
$deploymentManifest = Join-Path $repoRoot 'release\PROYA-China-Auto-Runner-Shadow-20260909-r7.manifest.json'
function Get-ProyaSha256([string]$path) { return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
if (Test-Path -LiteralPath $zip) { throw "Refusing to overwrite existing package $zip" }
if (Test-Path -LiteralPath $deploymentManifest) { throw "Refusing to overwrite existing manifest $deploymentManifest" }
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Recurse -Force }
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot 'dist-china-runner\runner.cjs') -Destination $runtime
Copy-Item -LiteralPath (Join-Path $repoRoot 'dist-china-runner\runner.cjs.map') -Destination $runtime
Copy-Item -LiteralPath (Join-Path $repoRoot 'dist-china-runner\package-smoke.cjs') -Destination $runtime
Copy-Item -LiteralPath (Join-Path $repoRoot 'dist-china-runner\package-smoke.cjs.map') -Destination $runtime
Copy-Item -LiteralPath (Get-Command node).Source -Destination (Join-Path $runtime 'node.exe')
foreach ($name in @('config.template.json','README.md','start-runner.ps1','stop-runner.ps1','status-runner.ps1','install-login-autostart.ps1')) { Copy-Item -LiteralPath (Join-Path $source $name) -Destination $output }
$buildTimestamp = (Get-Date).ToUniversalTime().ToString('o')
$files = Get-ChildItem -LiteralPath $output -File -Recurse | Sort-Object FullName
$checksums = foreach ($file in $files) { "$(Get-ProyaSha256 $file.FullName)  $($file.FullName.Substring($output.Length + 1).Replace('\','/'))" }
Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Value $checksums -Encoding Ascii
$manifest = [ordered]@{ name='PROYA China Auto Runner Shadow'; filename=(Split-Path -Leaf $zip); runnerVersion='1.1.0-shadow.20260909'; packageRelease='20260909-r7'; mode='shadow'; buildTimestamp=$buildTimestamp; changes=@('Phase 3A declared bundle SHA-256 verification','HTTP 409 for same session ID with different bundle hash'); listenAddress='127.0.0.1:8787'; promptSubmissionEnabled=$false; generationEnabled=$false; freeAutonomousActionEnabled=$false }
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'manifest.json') -Encoding UTF8
Compress-Archive -Path (Join-Path $output '*') -DestinationPath $zip -CompressionLevel Optimal
$hash = Get-ProyaSha256 $zip
Set-Content -LiteralPath "$zip.sha256" -Value "$hash  $(Split-Path -Leaf $zip)" -Encoding Ascii
$manifest['sha256'] = $hash
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $deploymentManifest -Encoding UTF8
Write-Output $zip
Write-Output $hash
Write-Output $deploymentManifest
