import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { localServiceUrls, type LocalServiceState, type LocalServicesStatus } from '../../src/domain/local-services';

const runnerRoot = 'C:\\Data\\proya-creative-studio\\runtime\\runner';
const runnerScript = join(runnerRoot, 'start-runner.ps1');
const windowsPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const comfyInstallRoot = 'C:\\Users\\lbbch\\AppData\\Local\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI';
const comfyRoot = join(comfyInstallRoot, 'ComfyUI');
const comfyPython = join(comfyRoot, '.venv', 'Scripts', 'python.exe');
const comfyModelPaths = 'C:\\Users\\lbbch\\AppData\\Roaming\\Comfy Desktop\\instance-model-paths\\inst-1787860388281.yaml';
const comfyInput = 'C:\\Users\\lbbch\\AppData\\Local\\Comfy-Desktop\\ComfyUI-Shared\\input';
const comfyOutput = 'C:\\Users\\lbbch\\AppData\\Local\\Comfy-Desktop\\ComfyUI-Shared\\output';

const checking = (message: string): LocalServiceState => ({ phase: 'checking', message });
const starting = (message: string): LocalServiceState => ({ phase: 'starting', message });
const ready = (): LocalServiceState => ({ phase: 'ready', message: 'Ready' });
const unavailable = (message: string): LocalServiceState => ({ phase: 'unavailable', message });

async function response(url: string, timeoutMs = 2_000): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { signal: controller.signal, cache: 'no-store' }); }
  catch { return null; }
  finally { clearTimeout(timer); }
}

async function runnerIsReady(): Promise<boolean> {
  const [version, capabilities] = await Promise.all([
    response(`${localServiceUrls.runner}/proya/auto/version`),
    response(`${localServiceUrls.runner}/proya/auto/capabilities`)
  ]);
  if (!version?.ok || !capabilities?.ok) return false;
  try {
    const value = await capabilities.json() as { mode?: unknown; generationEnabled?: unknown; maxJobsPerSession?: unknown };
    return value.mode === 'production' && value.generationEnabled === true && value.maxJobsPerSession === null;
  } catch { return false; }
}

async function comfyIsReady(): Promise<boolean> {
  return (await response(`${localServiceUrls.comfy}/object_info`, 5_000))?.status === 200;
}

async function lmStudioIsReady(): Promise<boolean> {
  const primary = await response(`${localServiceUrls.lmStudio}/api/v1/models`);
  if (primary?.ok) return true;
  return Boolean((await response(`${localServiceUrls.lmStudio}/v1/models`))?.ok);
}

async function waitUntil(probe: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await probe()) return true;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 1_000));
  } while (Date.now() < deadline);
  return false;
}

async function launchRunner(): Promise<void> {
  if (!existsSync(runnerScript) || !existsSync(windowsPowerShell)) throw new Error('Runner start command is missing.');
  await new Promise<void>((resolveLaunch, rejectLaunch) => {
    const child = spawn(windowsPowerShell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runnerScript], {
      cwd: runnerRoot,
      stdio: 'ignore',
      windowsHide: true
    });
    const timeout = setTimeout(() => {
      child.kill();
      rejectLaunch(new Error('Runner start command timed out.'));
    }, 30_000);
    child.once('error', reason => {
      clearTimeout(timeout);
      rejectLaunch(reason);
    });
    child.once('exit', code => {
      clearTimeout(timeout);
      if (code === 0) resolveLaunch();
      else rejectLaunch(new Error(`Runner start command exited with code ${code ?? 'unknown'}.`));
    });
  });
}

function launchComfy(): void {
  const required = [comfyPython, join(comfyInstallRoot, 'ComfyUI', 'main.py'), comfyModelPaths, comfyInput, comfyOutput];
  if (required.some(path => !existsSync(path))) throw new Error('The active ComfyUI installation is incomplete.');
  const child = spawn(comfyPython, [
    '-s', 'ComfyUI\\main.py',
    '--feature-flag', 'show_signin_button=true',
    '--feature-flag', 'enable_telemetry=true',
    '--enable-manager',
    '--extra-model-paths-config', comfyModelPaths,
    '--input-directory', comfyInput,
    '--output-directory', comfyOutput
  ], {
    cwd: comfyInstallRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
}

export class LocalServicesManager {
  private startup: Promise<void> | null = null;
  private state: LocalServicesStatus = {
    runner: checking('Checking...'),
    comfy: checking('Checking...'),
    lmStudio: checking('Checking...'),
    overallReady: false,
    checkedAt: new Date().toISOString()
  };

  ensureStarted(): Promise<void> {
    this.startup ??= this.startRequiredServices();
    return this.startup;
  }

  async status(): Promise<LocalServicesStatus> {
    const [runnerReady, comfyReady, lmStudioReady] = await Promise.all([runnerIsReady(), comfyIsReady(), lmStudioIsReady()]);
    if (runnerReady) this.state.runner = ready();
    else if (this.state.runner.phase !== 'starting') this.state.runner = unavailable('Runner unavailable');
    if (comfyReady) this.state.comfy = ready();
    else if (this.state.comfy.phase !== 'starting') this.state.comfy = unavailable('ComfyUI unavailable');
    this.state.lmStudio = lmStudioReady ? ready() : unavailable('LM Studio unavailable');
    return this.snapshot();
  }

  private snapshot(): LocalServicesStatus {
    const next = {
      ...this.state,
      overallReady: this.state.runner.phase === 'ready' && this.state.comfy.phase === 'ready' && this.state.lmStudio.phase === 'ready',
      checkedAt: new Date().toISOString()
    };
    this.state = next;
    return structuredClone(next);
  }

  private async startRequiredServices(): Promise<void> {
    const runnerTask = (async () => {
      if (await runnerIsReady()) { this.state.runner = ready(); return; }
      this.state.runner = starting('Runner starting...');
      try {
        await launchRunner();
        this.state.runner = await waitUntil(runnerIsReady, 60_000) ? ready() : unavailable('Runner unavailable');
      } catch (reason) {
        this.state.runner = unavailable(reason instanceof Error ? reason.message : 'Runner unavailable');
      }
    })();
    const comfyTask = (async () => {
      if (await comfyIsReady()) { this.state.comfy = ready(); return; }
      this.state.comfy = starting('ComfyUI starting...');
      try {
        launchComfy();
        this.state.comfy = await waitUntil(comfyIsReady, 180_000) ? ready() : unavailable('ComfyUI unavailable');
      } catch (reason) {
        this.state.comfy = unavailable(reason instanceof Error ? reason.message : 'ComfyUI unavailable');
      }
    })();
    this.state.lmStudio = await lmStudioIsReady() ? ready() : unavailable('LM Studio unavailable');
    await Promise.all([runnerTask, comfyTask]);
    await this.status();
  }
}
