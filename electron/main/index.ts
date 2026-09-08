import { AutoH3Service } from './auto-h3-service';
import type { AutoH3Config } from '../../src/domain/auto-h3';
import { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, screen, shell, WebContentsView } from 'electron';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HistoryDatabase, loadSqlite } from './database';
import { SettingsStore } from './settings-store';
import { ComputeService } from './compute-service';
import { ExplicitReferenceAuthorizationStore } from './reference-authorization';
import { defaultSettings, getChatWorkspaceUrl } from '../../src/domain/settings';
import type { AppSettings, ChatPanelBounds, ComfyOutputFile, H3PromptEngineSettings, H3PromptInput, H3PromptUpdate, H3VideoBrief, HistoryInput, HistoryUpdate, RemoteH3GenerationRequest } from '../../src/domain/types';
import { windowChannels, windowStateFromMaximized, type WindowState } from '../../src/domain/window';
import { calculateChatViewBounds, hiddenChatViewBounds, type LayoutRect, type WindowContentSize } from './chat-bounds';
import { h3LifecycleSchemaVersion, type RuntimeDiagnostics } from '../../src/domain/runtime';

protocol.registerSchemesAsPrivileged([{ scheme: 'proya-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let mainWindow: BrowserWindow | null = null;
let chatView: WebContentsView | null = null;
let database: HistoryDatabase | null = null;
let settingsStore: SettingsStore | null = null;
let computeService: ComputeService | null = null;
let autoH3Service: AutoH3Service | null = null;
let runtimeDatabasePath: string | null = null;
let runtimeStaticDiagnostics: Omit<RuntimeDiagnostics, 'databaseSchemaVersion' | 'currentAutoSessionId' | 'currentAutoJobId' | 'currentComputeJobId' | 'currentComfyPromptId'> | null = null;
const referenceAuthorization = new ExplicitReferenceAuthorizationStore();
let lastChatPanelBounds: ChatPanelBounds | null = null;
const smokeOutput = process.argv.find((argument) => argument.startsWith('--smoke-test-output='))?.split('=').slice(1).join('=');
const smokeMaximized = process.argv.includes('--smoke-test-maximized');
const smokeWindowControls = process.argv.includes('--smoke-test-window-controls');
const smokeChat = process.argv.includes('--smoke-test-chat');
const smokeLongContent = process.argv.includes('--smoke-test-long-content');
const smokeLayouts = process.argv.includes('--smoke-test-layouts');
const smokeRoute = process.argv.find((argument) => argument.startsWith('--smoke-test-route='))?.split('=').slice(1).join('=');
const smokeH3 = process.argv.includes('--smoke-test-h3');
const smokeAutoH3 = process.argv.includes('--smoke-test-auto-h3');
if (smokeOutput) {
  const profile = join(dirname(resolve(smokeOutput)), 'smoke-profile');
  mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
}
const smokeCarousel = process.argv.includes('--smoke-test-carousel');
const smokePrepared = process.argv.includes('--smoke-test-prepared');
const smokeChatVisible = process.argv.includes('--smoke-test-chat-visible');
const smokeChatFullscreen = process.argv.includes('--smoke-test-chat-fullscreen');

const appRoot = app.isPackaged ? app.getAppPath() : resolve(dirname(__filename), '..');
const assetRoot = app.isPackaged ? process.resourcesPath : appRoot;
const appIconPath = app.isPackaged ? join(process.resourcesPath, 'app-icon.ico') : join(appRoot, 'assets', 'app-icon.ico');
const h3SystemPromptPath = app.isPackaged
  ? join(process.resourcesPath, 'prompts', 'minimax-h3-lmstudio-system.md')
  : join(appRoot, 'prompts', 'minimax-h3-lmstudio-system.md');
const preloadPath = join(dirname(__filename), 'preload.cjs');

if (process.platform === 'win32') app.setAppUserModelId('com.proya.creativestudio');

function currentSettings(): AppSettings {
  if (!settingsStore) throw new Error('Settings unavailable');
  return { ...settingsStore.get(), h3SystemPromptPath };
}

function createRuntimeStaticDiagnostics(): NonNullable<typeof runtimeStaticDiagnostics> {
  const artifactPath = app.isPackaged ? app.getAppPath() : __filename;
  let buildTimestamp = 'unavailable';
  let appAsarSha256 = 'unavailable';
  try {
    buildTimestamp = statSync(artifactPath).mtime.toISOString();
    appAsarSha256 = createHash('sha256').update(readFileSync(artifactPath)).digest('hex');
  } catch { /* A development app path can be a directory; keep explicit unavailable values. */ }
  const appVersion = app.getVersion();
  return {
    runningExecutable: process.execPath,
    buildTimestamp,
    appVersion,
    buildId: `${appVersion}-${appAsarSha256.slice(0, 12)}`,
    appAsarPath: artifactPath,
    appAsarSha256,
    userDataDirectory: app.getPath('userData'),
    activeDatabasePath: runtimeDatabasePath ?? 'unavailable',
    lifecycleSchemaVersion: h3LifecycleSchemaVersion
  };
}

function runtimeDiagnostics(): RuntimeDiagnostics {
  runtimeStaticDiagnostics ??= createRuntimeStaticDiagnostics();
  const autoSnapshot = autoH3Service?.snapshot();
  const autoSession = autoSnapshot?.sessions.find((session) => session.status !== 'STOPPED') ?? null;
  const autoJob = autoSnapshot?.jobs.find((job) => job.autoJobId === autoSession?.currentJobId) ?? null;
  const computeJob = autoSession ? autoJob?.state ?? null : computeService?.listJobs(1)[0]?.state ?? null;
  return {
    ...runtimeStaticDiagnostics,
    databaseSchemaVersion: database?.getSchemaVersion() ?? 0,
    currentAutoSessionId: autoSession?.sessionId ?? null,
    currentAutoJobId: autoJob?.autoJobId ?? autoSession?.currentJobId ?? null,
    currentComputeJobId: computeJob?.localJobId ?? null,
    currentComfyPromptId: computeJob?.remotePromptId ?? null
  };
}

function isAllowedChatUrl(value: string): boolean {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function createChatView(): void {
  if (!mainWindow || chatView) return;
  chatView = new WebContentsView({
    webPreferences: {
      partition: 'persist:proya-chatgpt',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });
  mainWindow.contentView.addChildView(chatView);
  chatView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  chatView.webContents.setWindowOpenHandler(({ url }) => isAllowedChatUrl(url)
    ? { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } } }
    : { action: 'deny' });
  chatView.webContents.on('did-start-loading', () => mainWindow?.webContents.send('chat:state', { loading: true }));
  chatView.webContents.on('did-stop-loading', () => mainWindow?.webContents.send('chat:state', { loading: false, url: chatView?.webContents.getURL() }));
  chatView.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) mainWindow?.webContents.send('chat:state', { loading: false, error: `${description} (${code})`, url });
  });
}

function currentWindowContentSize(): WindowContentSize {
  if (!mainWindow || mainWindow.isDestroyed()) return { width: 0, height: 0 };
  const { width, height } = mainWindow.getContentBounds();
  return { width, height };
}

function applyChatPanelBounds(): void {
  if (!chatView || !lastChatPanelBounds) return;
  const bounds = lastChatPanelBounds.visible
    ? calculateChatViewBounds(lastChatPanelBounds, currentWindowContentSize())
    : hiddenChatViewBounds();
  chatView.setBounds(bounds);
}

function requestChatBoundsRefresh(): void {
  applyChatPanelBounds();
  mainWindow?.webContents.send('chat:bounds-refresh');
}

function currentWindowState(): WindowState {
  return windowStateFromMaximized(Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()));
}

function sendWindowState(): void {
  mainWindow?.webContents.send(windowChannels.state, currentWindowState());
}

async function navigateChat(newChat = false): Promise<void> {
  createChatView();
  const url = getChatWorkspaceUrl(currentSettings());
  if (!isAllowedChatUrl(url)) throw new Error('ChatGPT URL must use HTTPS');
  if (newChat || chatView?.webContents.getURL() !== url) await chatView?.webContents.loadURL(url);
  chatView?.webContents.focus();
}

async function waitForRendererSelector(selector: string): Promise<boolean> {
  if (!mainWindow) return false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const present = await mainWindow.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`).catch(() => false);
    if (present) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return false;
}

function registerIpc(): void {
  ipcMain.handle('runtime:get-diagnostics', () => runtimeDiagnostics());
  ipcMain.handle('history:list', (_event, limit?: number) => database?.list(limit ?? 100) ?? []);
  ipcMain.handle('history:create', (_event, input: HistoryInput) => database?.create(input));
  ipcMain.handle('history:update', (_event, id: number, update: HistoryUpdate) => database?.update(id, update));
  ipcMain.handle('h3-history:list', (_event, limit?: number) => database?.listH3(limit ?? 100) ?? []);
  ipcMain.handle('h3-history:create', (_event, input: H3PromptInput) => database?.createH3(input));
  ipcMain.handle('h3-history:update', (_event, id: number, update: H3PromptUpdate) => database?.updateH3(id, update));
  ipcMain.handle('settings:get', () => currentSettings());
  ipcMain.handle('settings:set', (_event, settings: AppSettings) => settingsStore?.set(settings));
  ipcMain.handle('compute:test-connection', (_event, url: string) => computeService?.testConnection(url));
  ipcMain.handle('compute:test-prompt-engine', (_event, url: string, settings?: H3PromptEngineSettings) => computeService?.testPromptEngine(url, settings ?? currentSettings().h3PromptEngine));
  ipcMain.handle('compute:get-workflow-defaults', () => computeService?.getWorkflowDefaults());
  ipcMain.handle('auto-h3:snapshot', () => autoH3Service?.snapshot());
  ipcMain.handle('auto-h3:start', (_event, config: AutoH3Config) => autoH3Service?.start(config));
  ipcMain.handle('auto-h3:resume', (_event, id: string, brief?: H3VideoBrief) => autoH3Service?.resume(id, brief));
  ipcMain.handle('auto-h3:update-current-brief', (_event, brief: H3VideoBrief) => { autoH3Service?.updateCurrentBrief(brief); });
  ipcMain.handle('auto-h3:stop', (_event, id: string, immediately: boolean) => autoH3Service?.stop(id, immediately));
  ipcMain.handle('auto-h3:cancel-download', (_event, id: string) => autoH3Service?.cancelDownload(id));
  ipcMain.handle('auto-h3:pick-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('compute:submit-h3', (event, request: RemoteH3GenerationRequest) => {
    if (autoH3Service?.snapshot().sessions.some(session => session.status !== 'STOPPED')) throw new Error('Stop the Auto Session before generating a single video.');
    if (request.autoJobId) throw new Error('Auto jobs must be created by the scheduler.');
    return computeService?.submitH3(request, event.sender.id);
  });
  ipcMain.handle('compute:get-job-state', (_event, localJobId: string) => computeService?.getJobState(localJobId));
  ipcMain.handle('compute:list-jobs', (_event, limit?: number) => computeService?.listJobs(limit ?? 100) ?? []);
  ipcMain.handle('compute:download-result', (_event, localJobId: string) => computeService?.downloadResult(localJobId));
  ipcMain.handle('compute:open-result', (_event, localJobId: string) => {
    const path = computeService?.getLocalResultPath(localJobId);
    if (!path) throw new Error('Compute service unavailable');
    return shell.openPath(path);
  });
  ipcMain.handle('compute:open-output', async (_event, output: ComfyOutputFile) => {
    const url = computeService?.getOutputUrl(output);
    if (!url) throw new Error('Compute service unavailable');
    const configuredOrigin = new URL(currentSettings().remoteComfyUrl).origin;
    if (new URL(url).origin !== configuredOrigin) throw new Error('Output URL does not belong to the configured ComfyUI server');
    await shell.openExternal(url);
  });
  ipcMain.handle('clipboard:write', (_event, text: string) => clipboard.writeText(text));
  ipcMain.handle(windowChannels.minimize, () => { mainWindow?.minimize(); });
  ipcMain.handle(windowChannels.toggleMaximize, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return currentWindowState();
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
    return currentWindowState();
  });
  ipcMain.handle(windowChannels.close, () => { mainWindow?.close(); });
  ipcMain.handle(windowChannels.getState, () => currentWindowState());
  ipcMain.handle('chat:open', async () => navigateChat(false));
  ipcMain.handle('chat:new', async () => navigateChat(true));
  ipcMain.handle('chat:external', async () => shell.openExternal(getChatWorkspaceUrl(currentSettings())));
  ipcMain.handle('chat:bounds', (_event, value: unknown) => {
    if (!isChatPanelBounds(value)) return;
    const bounds = value;
    lastChatPanelBounds = bounds;
    createChatView();
    if (!chatView) return;
    applyChatPanelBounds();
  });
  ipcMain.handle('files:show-product', (_event, relativePath?: string) => {
    const settings = currentSettings();
    const target = relativePath ? resolve(assetRoot, relativePath) : settings.productAssetsDirectory;
    return existsSync(target) ? shell.showItemInFolder(target) : shell.openPath(settings.productAssetsDirectory);
  });
  ipcMain.handle('files:open-folder', (_event, kind: 'products' | 'references' | 'remote-output') => shell.openPath(kind === 'products' ? currentSettings().productAssetsDirectory : kind === 'references' ? currentSettings().referencesDirectory : currentSettings().remoteOutputDirectory));
  ipcMain.handle('files:authorize-reference', (event, sourcePath: unknown) => {
    if (typeof sourcePath !== 'string') throw new Error('Reference selection did not provide a valid local file.');
    return referenceAuthorization.authorize(event.sender.id, sourcePath);
  });
  ipcMain.handle('files:clear-reference', (event) => { referenceAuthorization.clear(event.sender.id); });
  ipcMain.handle('files:copy-path', (_event, relativePath: string) => clipboard.writeText(resolve(assetRoot, relativePath)));
  ipcMain.handle('files:copy-paths', (_event, relativePaths: string[]) => clipboard.writeText(relativePaths.map((relativePath) => resolve(assetRoot, relativePath)).join('\n')));
}

function isChatPanelBounds(value: unknown): value is ChatPanelBounds {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (['x', 'y', 'width', 'height'] as const).every((key) => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]))
    && typeof candidate.visible === 'boolean';
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1500, height: 960, minWidth: 1100, minHeight: 720,
    frame: false, thickFrame: true, show: !smokeOutput,
    backgroundColor: '#0a0a0a', title: 'PROYA Creative Studio',
    icon: existsSync(appIconPath) ? appIconPath : undefined,
    webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  const sessionId = mainWindow.webContents.id;
  mainWindow.removeMenu();
  if (smokeOutput) {
    mainWindow.webContents.on('console-message', (_event, level, message) => console.log(`[renderer:${level}] ${message}`));
    mainWindow.webContents.on('render-process-gone', (_event, details) => console.error(`Renderer process gone: ${details.reason}`));
  }
  mainWindow.on('resize', requestChatBoundsRefresh);
  mainWindow.on('maximize', () => { requestChatBoundsRefresh(); sendWindowState(); });
  mainWindow.on('unmaximize', () => { requestChatBoundsRefresh(); sendWindowState(); });
  mainWindow.on('enter-full-screen', requestChatBoundsRefresh);
  mainWindow.on('leave-full-screen', requestChatBoundsRefresh);
  mainWindow.webContents.on('did-finish-load', sendWindowState);
  mainWindow.on('closed', () => { referenceAuthorization.clear(sessionId); chatView = null; mainWindow = null; lastChatPanelBounds = null; });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await mainWindow.loadURL(devUrl); else await mainWindow.loadFile(join(appRoot, 'dist', 'index.html'));
  if (smokeOutput) {
    let ready = false;
    for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
      ready = await mainWindow.webContents.executeJavaScript("Boolean(document.querySelector('.controls-pane'))").catch(() => false);
      if (!ready) await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
    console.log(`Smoke renderer ready: ${ready}`);
    if (!ready) console.log(`Smoke renderer text: ${await mainWindow.webContents.executeJavaScript('document.body.innerText').catch(() => 'unavailable')}`);
    if (ready) console.log(`Smoke images: ${JSON.stringify(await mainWindow.webContents.executeJavaScript("Array.from(document.images).map((image) => ({ alt: image.alt, width: image.naturalWidth, height: image.naturalHeight, complete: image.complete }))").catch(() => []))}`);
    if (smokeWindowControls && ready) {
      const initial = { isMaximized: mainWindow.isMaximized(), isMinimized: mainWindow.isMinimized() };
      const beforeLabels = await mainWindow.webContents.executeJavaScript("Array.from(document.querySelectorAll('.window-control')).map((button) => button.getAttribute('aria-label'))").catch(() => []);
      await mainWindow.webContents.executeJavaScript("document.querySelector('.window-control:nth-child(2)')?.click()");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      const toggled = { isMaximized: mainWindow.isMaximized() };
      const afterMaximizeLabels = await mainWindow.webContents.executeJavaScript("Array.from(document.querySelectorAll('.window-control')).map((button) => button.getAttribute('aria-label'))").catch(() => []);
      await mainWindow.webContents.executeJavaScript("document.querySelector('.window-control:nth-child(2)')?.click()");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      const roundTrip = { isMaximized: mainWindow.isMaximized() };
      await mainWindow.webContents.executeJavaScript("document.querySelector('.window-control:first-child')?.click()");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      const minimized = mainWindow.isMinimized();
      if (minimized) mainWindow.restore();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
      console.log(`Window-control smoke: ${JSON.stringify({ initial, beforeLabels, toggled, afterMaximizeLabels, roundTrip, minimized, resizable: mainWindow.isResizable(), minimumSize: mainWindow.getMinimumSize() })}`);
    }
    if (smokeChat) {
      createChatView();
      const chatHostRect = await mainWindow.webContents.executeJavaScript(`(() => {
        const host = document.querySelector('.chat-browser-host');
        if (!host) return null;
        const rect = host.getBoundingClientRect();
        return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      })()`).catch(() => null) as LayoutRect | null;
      lastChatPanelBounds = chatHostRect ? { ...chatHostRect, visible: true } : { x: 790, y: 54, width: 710, height: 906, visible: true };
      applyChatPanelBounds();
      await navigateChat(false);
      console.log(`Chat smoke bounds: ${JSON.stringify(chatView?.getBounds())}`);
      console.log(`Chat smoke URL: ${chatView?.webContents.getURL()}`);
      if (smokeChatVisible || smokeChatFullscreen) {
        await mainWindow.webContents.executeJavaScript("document.querySelector('.chat-welcome .button.secondary')?.click()");
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
      }
      if (smokeChatFullscreen) {
        await mainWindow.webContents.executeJavaScript("document.querySelector('.chat-toolbar button[title=\\\"ChatGPT full screen\\\"]')?.click()");
        await waitForRendererSelector('.studio-split.layout-chatgpt');
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
        console.log(`Chat fullscreen chrome: ${JSON.stringify(await mainWindow.webContents.executeJavaScript("(() => { const controls = document.querySelector('.window-controls'); const host = document.querySelector('.chat-browser-host'); if (!controls || !host) return null; const controlRect = controls.getBoundingClientRect(); const hostRect = host.getBoundingClientRect(); const style = getComputedStyle(controls); return { controlRect: { x: controlRect.x, y: controlRect.y, width: controlRect.width, height: controlRect.height }, hostRect: { x: hostRect.x, y: hostRect.y, width: hostRect.width, height: hostRect.height }, display: style.display, visibility: style.visibility, zIndex: style.zIndex }; })()").catch(() => null))}`);
      }
    }
    if (smokeLongContent && ready) {
      const metrics = await mainWindow.webContents.executeJavaScript(`(() => {
        const pane = document.querySelector('.controls-pane');
        if (!pane) return null;
        const fixture = document.createElement('section');
        fixture.setAttribute('data-smoke-long-content', 'true');
        fixture.style.cssText = 'height: 2400px; margin-top: 20px; padding: 20px; background: #111111;';
        const brief = document.createElement('textarea');
        brief.setAttribute('aria-label', 'Smoke long creative brief');
        brief.value = Array.from({ length: 360 }, (_, index) => 'SMOKE BRIEF LINE ' + String(index + 1).padStart(3, '0')).join('\\n') + '\\nSMOKE BRIEF FINAL LINE';
        brief.style.cssText = 'display: block; width: 100%; height: 280px;';
        fixture.appendChild(brief);
        pane.appendChild(fixture);
        const scrollToBottom = (element) => {
          if (!element) return null;
          element.scrollTop = element.scrollHeight;
          return { scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, scrollTop: element.scrollTop, bottomReachable: element.scrollTop + element.clientHeight >= element.scrollHeight - 1 };
        };
        const result = { pane: scrollToBottom(pane), brief: scrollToBottom(brief) };
        fixture.remove();
        return result;
      })()`).catch(() => null);
      console.log(`Long-content smoke: ${JSON.stringify(metrics)}`);
    }
    if (smokeLayouts && ready) {
      const routeMetrics: Record<string, unknown> = {};
      for (const [route, selector] of Object.entries({ history: '.history-page', settings: '.settings-page', today: '.studio-split' })) {
        await mainWindow.webContents.executeJavaScript(`window.location.hash = '#/${route}'`);
        const loaded = await waitForRendererSelector(selector);
        routeMetrics[route] = loaded ? await mainWindow.webContents.executeJavaScript(`(() => {
          const scrollable = document.querySelector('.page-scroll') || document.querySelector('.controls-pane');
          if (!scrollable) return null;
          const fixture = document.createElement('div');
          fixture.style.height = '1600px';
          fixture.setAttribute('data-smoke-route-content', 'true');
          scrollable.appendChild(fixture);
          scrollable.scrollTop = scrollable.scrollHeight;
          const result = { scrollHeight: scrollable.scrollHeight, clientHeight: scrollable.clientHeight, scrollTop: scrollable.scrollTop, bottomReachable: scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1 };
          fixture.remove();
          return result;
        })()`).catch(() => null) : null;
      }

      const originalContentSize = mainWindow.getContentSize();
      await mainWindow.webContents.executeJavaScript("document.querySelector('.controls-pane .icon-button')?.click()");
      await waitForRendererSelector('.studio-split.layout-controls');
      const controlsFullscreen = await mainWindow.webContents.executeJavaScript("(() => { const pane = document.querySelector('.controls-pane'); return { width: pane?.getBoundingClientRect().width ?? 0, height: pane?.getBoundingClientRect().height ?? 0 }; })()").catch(() => null);
      await mainWindow.webContents.executeJavaScript("document.querySelector('.controls-pane .icon-button')?.click()");
      await waitForRendererSelector('.studio-split.layout-split');
      await mainWindow.webContents.executeJavaScript("document.querySelector('.chat-toolbar button[title=\"ChatGPT full screen\"]')?.click()");
      await waitForRendererSelector('.studio-split.layout-chatgpt');
      const chatFullscreen = await mainWindow.webContents.executeJavaScript("(() => { const host = document.querySelector('.chat-browser-host'); return { x: host?.getBoundingClientRect().x ?? 0, y: host?.getBoundingClientRect().y ?? 0, width: host?.getBoundingClientRect().width ?? 0, height: host?.getBoundingClientRect().height ?? 0 }; })()").catch(() => null);
      await mainWindow.webContents.executeJavaScript("document.querySelector('.chat-toolbar button[title=\"Split view\"]')?.click()");
      await waitForRendererSelector('.studio-split.layout-split');
      mainWindow.setContentSize(1100, 720);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      const narrowSplit = await mainWindow.webContents.executeJavaScript("(() => { const split = document.querySelector('.studio-split'); const host = document.querySelector('.chat-browser-host'); return { splitWidth: split?.getBoundingClientRect().width ?? 0, hostWidth: host?.getBoundingClientRect().width ?? 0, hostHeight: host?.getBoundingClientRect().height ?? 0 }; })()").catch(() => null);
      mainWindow.setContentSize(originalContentSize[0], originalContentSize[1]);
      console.log(`Layout smoke: ${JSON.stringify({ routes: routeMetrics, controlsFullscreen, chatFullscreen, narrowSplit })}`);
    }
    if (smokeRoute && ready) {
      const routePath = smokeRoute.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
      await mainWindow.webContents.executeJavaScript(`document.querySelector('.sidebar a[href="#/${routePath}"]')?.click()`);
      const selector = routePath === 'today' ? '.studio-split' : routePath === 'h3-video-prompts' ? '.h3-page' : `.${routePath}-page`;
      const routeReady = await waitForRendererSelector(selector);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
      await mainWindow.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))').catch(() => undefined);
      console.log(`Smoke route: ${routePath}, ready=${routeReady}, hash=${await mainWindow.webContents.executeJavaScript('window.location.hash').catch(() => 'unavailable')}, heading=${await mainWindow.webContents.executeJavaScript('document.querySelector(\'h1\')?.textContent').catch(() => 'unavailable')}`);
    }
    if (smokeH3 && ready) {
      await mainWindow.webContents.executeJavaScript("document.querySelector('.sidebar a[href=\"#/h3-video-prompts\"]')?.click()");
      const h3Ready = await waitForRendererSelector('.h3-page');
      if (h3Ready) {
        const result = await mainWindow.webContents.executeJavaScript(`(() => {
          const root = document.querySelector('.h3-page');
          const text = root?.textContent ?? '';
          return {
            routeReady: Boolean(root),
            hasChatPane: Boolean(root?.querySelector('.chat-browser-host')),
            hasChatHandoff: Boolean(root?.querySelector('.h3-handoff-card')),
            hasChatCopyAction: text.includes('ChatGPT'),
            hasSingleGenerateButton: root?.querySelectorAll('[aria-label="Generate H3 video"]').length === 1,
            hasRef2vaLock: text.includes('REF2VA'),
            hasPromptEngine: text.includes('Prompt Engine'),
            hasStageRail: root?.querySelectorAll('.h3-stage').length === 10,
            finalPromptIsReadonly: !root?.querySelector('.h3-final-prompt[contenteditable="true"]')
          };
        })()`).catch(() => null);
        console.log(`H3 smoke: ${JSON.stringify(result)}`);
      } else {
        console.log('H3 smoke: route did not render');
      }
    }

    if (smokeAutoH3 && ready) {
      await mainWindow.webContents.executeJavaScript("document.querySelector('.sidebar a[href=\"#/h3-video-prompts\"]')?.click()");
      await waitForRendererSelector('.auto-h3-panel');
      await mainWindow.webContents.executeJavaScript(`(() => {
        const select = document.querySelector('[aria-label="H3 generation mode"]');
        select.value = 'auto'; select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
      console.log('Auto H3 smoke: ' + await mainWindow.webContents.executeJavaScript(`JSON.stringify({
        start: document.querySelector('.auto-h3-panel')?.textContent.includes('START AUTO GENERATION'),
        selected: document.querySelectorAll('.auto-selections input:checked').length,
        overflow: document.querySelector('.auto-h3-panel').scrollWidth > document.querySelector('.auto-h3-panel').clientWidth
      })`));
      console.log(`Auto H3 smoke active sessions: ${autoH3Service?.snapshot().sessions.length}`);
    }

    if ((smokeCarousel || smokePrepared) && ready) {
      await mainWindow.webContents.executeJavaScript("window.location.hash = '#/today'");
      await waitForRendererSelector('.studio-split');
      if (smokeCarousel) {
        await mainWindow.webContents.executeJavaScript("Array.from(document.querySelectorAll('.workflow-mode-card')).find((button) => button.textContent?.includes('Carousel'))?.click()");
        await mainWindow.webContents.executeJavaScript("document.querySelector('.slide-count-control')?.scrollIntoView({ block: 'center' })");
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
        console.log(`Smoke carousel: ${await mainWindow.webContents.executeJavaScript("Boolean(document.querySelector('.slide-count-control'))").catch(() => false)}`);
      }
      if (smokePrepared) {
        await mainWindow.webContents.executeJavaScript("document.querySelector('.prepare-button')?.click()");
        const preparedReady = await waitForRendererSelector('.prepared-summary');
        await mainWindow.webContents.executeJavaScript("document.querySelector('.controls-pane')?.scrollTo(0, document.querySelector('.controls-pane')?.scrollHeight ?? 0)");
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
        console.log(`Smoke prepared: ${preparedReady}`);
      }
    }
    if (smokeMaximized && ready) {
      mainWindow.maximize();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
      console.log(`Smoke window state: ${JSON.stringify({ isMaximized: mainWindow.isMaximized(), contentSize: mainWindow.getContentSize() })}`);
    }
    mainWindow.showInactive();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
    const image = await mainWindow.webContents.capturePage();
    writeFileSync(smokeOutput, image.toPNG());
    app.quit();
  }
}

app.whenReady().then(async () => {
  const root = app.isPackaged ? process.resourcesPath : appRoot;
  settingsStore = new SettingsStore(join(app.getPath('userData'), 'settings.json'), defaultSettings(root));
  runtimeDatabasePath = resolve(app.getPath('userData'), 'proya-creative-studio.sqlite');
  database = new HistoryDatabase(runtimeDatabasePath, await loadSqlite());
  computeService = new ComputeService(currentSettings, (state) => mainWindow?.webContents.send('compute:job-state', state), !app.isPackaged, database, [join(root, 'product-assets'), join(root, 'references')], referenceAuthorization);
  autoH3Service = new AutoH3Service(database, computeService, currentSettings);
  runtimeStaticDiagnostics = createRuntimeStaticDiagnostics();
  console.info(`PROYA runtime provenance ${JSON.stringify(runtimeDiagnostics())}`);
  protocol.handle('proya-asset', (request) => {
    const url = new URL(request.url);
    const relative = normalize(`${url.host}${decodeURIComponent(url.pathname)}`).replace(/^[/\\]+/, '');
    const absolute = resolve(root, relative);
    const allowedRoot = resolve(root, 'product-assets');
    if (!absolute.startsWith(`${allowedRoot}\\`) && absolute !== allowedRoot) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(absolute).toString());
  });
  registerIpc();
  screen.on('display-metrics-changed', requestChatBoundsRefresh);
  await createWindow();
  if (!smokeOutput) {
    autoH3Service?.activate();
    void computeService?.restoreJobs().catch((reason) => {
      console.error(`Remote H3 job restore failed: ${reason instanceof Error ? reason.message : String(reason)}`);
    });
  }
  app.on('activate', async () => { if (BrowserWindow.getAllWindows().length === 0) await createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { autoH3Service?.dispose(); computeService?.dispose(); database?.close(); });
