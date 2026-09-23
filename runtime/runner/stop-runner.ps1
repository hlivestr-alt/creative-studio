$ErrorActionPreference = 'Stop'
$config = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'config.json') | ConvertFrom-Json
$session = (Invoke-RestMethod -Uri 'http://127.0.0.1:8787/proya/auto/session/current' -TimeoutSec 5).session
$queue = Invoke-RestMethod -Uri 'http://127.0.0.1:8188/queue' -TimeoutSec 5
if ($session -and ($session.status -ne 'STOPPED' -or $session.currentJobId)) { throw 'Refusing to stop an active production session.' }
if ($queue.queue_running.Count -ne 0 -or $queue.queue_pending.Count -ne 0) { throw 'Refusing to stop while the Comfy queue is non-empty.' }
$lockPath = Join-Path ([string]$config.stateRoot) 'runner.lock'
if (!(Test-Path -LiteralPath $lockPath)) { Write-Output 'PROYA Local Generation Runner is not active.'; exit 0 }
$lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$lock.pid)"
if (!$process) { Write-Output 'Runner process is already stopped; stale lock will be reclaimed at start.'; exit 0 }
if ($process.CommandLine -notlike '*proya-creative-studio\runtime\runner\runner.cjs*') { throw 'Lock PID does not belong to the stable local runner.' }
Stop-Process -Id $process.ProcessId
Write-Output "Stopped PROYA Local Generation Runner PID $($process.ProcessId)."
