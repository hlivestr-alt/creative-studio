$ErrorActionPreference = 'Stop'
$runnerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$config = Get-Content -Raw -LiteralPath (Join-Path $runnerRoot 'config.json') | ConvertFrom-Json
if ($config.mode -ne 'production' -or $null -ne $config.maxJobsPerSession) { throw 'PROYA Local Generation Runner requires production mode.' }
if ($config.listenAddress -ne '127.0.0.1' -or [int]$config.listenPort -ne 8787) { throw 'Runner must bind to 127.0.0.1:8787.' }
if ($config.stateRoot -ne 'D:\AI Videos\.proya-auto' -or $config.archiveRoot -ne 'D:\AI Videos') { throw 'Unexpected production state or archive path.' }
$env:RUNNER_MODE = 'production'
$env:PROYA_AUTO_STATE_ROOT = [string]$config.stateRoot
$env:PROYA_H3_ARCHIVE_ROOT = [string]$config.archiveRoot
$active = $null
try { $active = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/proya/auto/version' -TimeoutSec 2 } catch { }
if ($active) { Write-Output "PROYA Local Generation Runner already active: $($active.version)"; exit 0 }
$logs = Join-Path ([string]$config.stateRoot) 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$node = Join-Path $runnerRoot 'node.exe'
$bundle = Join-Path $runnerRoot 'runner.cjs'
if (!(Test-Path -LiteralPath $node -PathType Leaf) -or !(Test-Path -LiteralPath $bundle -PathType Leaf)) { throw 'Local runner runtime is incomplete.' }
$process = Start-Process -FilePath $node -ArgumentList @($bundle) -WorkingDirectory $runnerRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'runner.stdout.log') -RedirectStandardError (Join-Path $logs 'runner.stderr.log') -PassThru
Write-Output "Started PROYA Local Generation Runner PID $($process.Id)."
