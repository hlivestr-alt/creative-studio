$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$source = Join-Path $repoRoot 'deploy\china-auto-runner-shadow'
$output = Join-Path $repoRoot 'release\china-auto-runner-shadow-20260909-r6'
$runtime = Join-Path $output 'runtime'
$zip = Join-Path $repoRoot 'release\PROYA-China-Auto-Runner-Shadow-20260909-r6.zip'
$deploymentManifest = Join-Path $repoRoot 'release\PROYA-China-Auto-Runner-Shadow-20260909-r6.manifest.json'
function Get-ProyaSha256([string]$path) {
  $stream = [System.IO.File]::OpenRead($path)
  try {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try { return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
  } finally { $stream.Dispose() }
}
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Recurse -Force }
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot 'dist-china-runner\runner.cjs') -Destination $runtime
Copy-Item -LiteralPath (Join-Path $repoRoot 'dist-china-runner\runner.cjs.map') -Destination $runtime
Copy-Item -LiteralPath (Join-Path $repoRoot 'dist-china-runner\package-smoke.cjs') -Destination $runtime
Copy-Item -LiteralPath (Join-Path $repoRoot 'dist-china-runner\package-smoke.cjs.map') -Destination $runtime
Copy-Item -LiteralPath (Get-Command node).Source -Destination (Join-Path $runtime 'node.exe')
Copy-Item -LiteralPath (Join-Path $source 'config.template.json') -Destination (Join-Path $output 'config.template.json')
Copy-Item -LiteralPath (Join-Path $source 'config.template.json') -Destination (Join-Path $output 'config.json')
Copy-Item -LiteralPath (Join-Path $source 'README.md') -Destination $output
Copy-Item -LiteralPath (Join-Path $source 'start-runner.ps1') -Destination $output
Copy-Item -LiteralPath (Join-Path $source 'stop-runner.ps1') -Destination $output
Copy-Item -LiteralPath (Join-Path $source 'status-runner.ps1') -Destination $output
Copy-Item -LiteralPath (Join-Path $source 'install-login-autostart.ps1') -Destination $output
$payloadFiles = Get-ChildItem -LiteralPath $output -File -Recurse | Sort-Object FullName
$checksumLines = foreach ($file in $payloadFiles) {
  "$(Get-ProyaSha256 $file.FullName)  $($file.FullName.Substring($output.Length + 1).Replace('\','/'))"
}
Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Value $checksumLines -Encoding Ascii
$files = Get-ChildItem -LiteralPath $output -File -Recurse | Sort-Object FullName
$manifestFiles = foreach ($file in $files) {
  [ordered]@{ path = $file.FullName.Substring($output.Length + 1).Replace('\','/'); size = $file.Length; sha256 = (Get-ProyaSha256 $file.FullName) }
}
$buildTimestamp = (Get-Date).ToUniversalTime().ToString('o')
$runnerVersion = '1.0.1-shadow.20260909'
$compatibilityStatement = 'LM Studio `key` model-discovery compatibility fix included'
$manifest = [ordered]@{
  name = 'PROYA China Auto Runner Shadow'
  filename = 'PROYA-China-Auto-Runner-Shadow-20260909-r6.zip'
  version = $runnerVersion
  packageRelease = '20260909-r6'
  mode = 'shadow'
  builtAt = $buildTimestamp
  statement = $compatibilityStatement
  listenAddress = '127.0.0.1:8787'
  comfyUrl = 'http://127.0.0.1:8188'
  lmStudioUrl = 'http://127.0.0.1:1234'
  promptSubmissionEnabled = $false
  files = $manifestFiles
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output 'manifest.json') -Encoding UTF8
if (Test-Path -LiteralPath $zip) { throw "Refusing to overwrite existing package $zip" }
if (Test-Path -LiteralPath $deploymentManifest) { throw "Refusing to overwrite existing deployment manifest $deploymentManifest" }
Compress-Archive -Path (Join-Path $output '*') -DestinationPath $zip -CompressionLevel Optimal
$hash = Get-ProyaSha256 $zip
Set-Content -LiteralPath "$zip.sha256" -Value "$hash  $(Split-Path -Leaf $zip)" -Encoding ascii
$release = [ordered]@{
  filename = (Split-Path -Leaf $zip)
  sha256 = $hash
  buildTimestamp = $buildTimestamp
  runnerVersion = $runnerVersion
  mode = 'shadow'
  statement = $compatibilityStatement
  promptSubmissionEnabled = $false
  generationEnabled = $false
  freeAutonomousActionEnabled = $false
}
$release | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $deploymentManifest -Encoding UTF8
Write-Output $zip
Write-Output $hash
Write-Output $deploymentManifest
