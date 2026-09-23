import { isTransientTransport, type AutoH3Config, type LocalAutoSessionMirror, type LocalRunnerObserver, type LocalRunnerReadiness, type LocalRunnerDraftIdentity, type LocalRunnerStageReport } from '../../src/domain/auto-h3';
import type { AppSettings } from '../../src/domain/types';
import type { HistoryDatabase } from './database';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildLocalSessionBundle, localBundleSettingsIdentity } from './local-auto-h3-bundle';
import { LocalAutoH3Client, LocalRunnerTransportError } from './local-auto-h3-client';
import { h3WorkflowSettingsFromBrief } from '../../src/domain/h3';
import { validateH3WorkflowSettings } from '../../src/domain/minimax-h3-workflow';
import type { H3VideoBrief } from '../../src/domain/types';
import type { LocalSessionBundle, PersistedSession, RunnerMode, StageResult } from '../../src/local-runner/types';
import { RUNNER_BASE_URL } from '../../src/domain/settings';

function assertLocalServicesAvailable(health: Record<string, unknown>): void {
  const comfy = health.comfy as { ready?: boolean; error?: unknown } | undefined;
  const lmStudio = health.lmStudio as { ready?: boolean; error?: unknown } | undefined;
  // Older compatible runners/tests may omit a nested probe. A service is
  // unavailable only when the authoritative runner explicitly reports false.
  if (comfy?.ready === false) throw new Error(`ComfyUI unavailable${comfy?.error ? `: ${String(comfy.error)}` : ''}`);
  if (lmStudio?.ready === false) throw new Error(`LM Studio unavailable${lmStudio?.error ? `: ${String(lmStudio.error)}` : ''}`);
}

export class LocalAutoH3Controller {
  private productionStart: Promise<LocalRunnerObserver> | null = null;
  private settingsUpdates = new Map<string, Promise<void>>();
  constructor(
    private db: HistoryDatabase,
    private settings: () => AppSettings,
    private clientFactory = (url: string) => new LocalAutoH3Client(url, fetch, 180_000),
    private productionPreflightTimeoutMs = 20_000,
    private productionPreflightRetryMs = 2_000,
    private wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)),
    private stageReconciliationTimeoutMs = 90_000,
    private stageReconciliationRetryMs = 2_000
  ) {}

  private mirror(bundle: ReturnType<typeof buildLocalSessionBundle>['bundle'], runnerVersion: string, createdTimestamp: string, stagingState: LocalAutoSessionMirror['stagingState'], connectionState: LocalAutoSessionMirror['connectionState'], revision = 0, lastSuccessfulSync: string | null = null): LocalAutoSessionMirror {
    return { sessionId: bundle.sessionId, lastKnownRevision: revision, bundleHash: bundle.bundleSha256, runnerVersion, connectionState, lastSuccessfulSync, settingsVersionIdentity: localBundleSettingsIdentity(bundle), stagingState, createdTimestamp };
  }

  async newDraft(config: AutoH3Config): Promise<LocalRunnerDraftIdentity> {
    const settings = this.settings();
    const client = this.clientFactory(RUNNER_BASE_URL);
    const capabilities = await client.capabilities();
    if (!['shadow', 'canary', 'two-job-canary', 'production'].includes(capabilities.mode)) throw new Error('Runner mode is not supported by this controller.');
    const { bundle } = buildLocalSessionBundle(config, settings, capabilities.runnerVersion);
    const createdTimestamp = new Date().toISOString();
    const mirror = this.mirror(bundle, capabilities.runnerVersion, createdTimestamp, 'DRAFT', 'connected');
    this.db.saveLocalAutoMirror(mirror);
    return { sessionId: mirror.sessionId, bundleSha256: mirror.bundleHash, settingsVersionIdentity: mirror.settingsVersionIdentity, stagingState: mirror.stagingState, createdTimestamp };
  }

  async stage(config: AutoH3Config, stageUpdated = false, forceNew = false): Promise<LocalRunnerStageReport> {
    const settings = this.settings();
    const client = this.clientFactory(RUNNER_BASE_URL);
    const capabilities = await client.capabilities();
    if (!['shadow', 'canary', 'two-job-canary', 'production'].includes(capabilities.mode)) throw new Error('Runner mode is not supported by this controller.');
    const existing = forceNew ? null : this.db.getLatestLocalAutoDraft();
    let built = buildLocalSessionBundle(config, settings, capabilities.runnerVersion, existing?.sessionId);
    const identity = localBundleSettingsIdentity(built.bundle);
    const unchanged = Boolean(existing && (existing.settingsVersionIdentity === identity || existing.bundleHash === built.bundle.bundleSha256));
    if (existing && !unchanged) {
      if (!stageUpdated) throw new Error('The staging draft changed. Create a new immutable session before starting.');
      built = buildLocalSessionBundle(config, settings, capabilities.runnerVersion);
    }
    const { bundle } = built;
    const createdTimestamp = unchanged && existing ? existing.createdTimestamp : new Date().toISOString();
    // Durable identity is committed before POST so an ambiguous response can only reconcile this exact ID/hash.
    this.db.saveLocalAutoMirror(this.mirror(bundle, capabilities.runnerVersion, createdTimestamp, 'STAGING', 'connected', existing?.lastKnownRevision ?? 0, existing?.lastSuccessfulSync ?? null));
    try {
      const staged = await this.stageWithReconciliation(client, bundle, capabilities.mode, capabilities.runnerVersion, createdTimestamp, existing);
      const [persistedResponse, health] = await Promise.all([client.session(bundle.sessionId), client.health()]);
      const persisted = persistedResponse.session;
      if (!persisted || persisted.bundleHash !== bundle.bundleSha256) throw new Error('Local persistence verification failed: session or bundle hash mismatch.');
      if (persisted.settingsVersion !== bundle.initialSettingsVersion || persisted.bundle.workflowSha256 !== bundle.workflowSha256 || persisted.bundle.systemPromptSha256 !== bundle.systemPromptSha256) throw new Error('Local persistence verification failed: settings/workflow/system prompt mismatch.');
      if (persisted.bundle.assets.length !== bundle.assets.length || persisted.bundle.selectedProducts.join('\0') !== bundle.selectedProducts.join('\0') || persisted.bundle.selectedContentTypes.join('\0') !== bundle.selectedContentTypes.join('\0')) throw new Error('Local persistence verification failed: assets or selections mismatch.');
      if (persistedResponse.persistence?.assetRecordCount !== bundle.assets.length || !persistedResponse.persistence.settingsVersions.includes(bundle.initialSettingsVersion)) throw new Error('Local persistence verification failed: durable asset/settings records mismatch.');
      const comfy = health.comfy as { ready?: boolean } | undefined;
      const archiveReady = typeof staged.sessionDirectory === 'string' && staged.sessionDirectory.length > 0;
      if (health.ready !== true || comfy?.ready !== true || health.qwenModelAvailable !== true || !archiveReady) throw new Error('The local session is staged but archive, ComfyUI, or LM Studio readiness did not pass.');
      this.db.saveLocalAutoMirror(this.mirror(bundle, capabilities.runnerVersion, createdTimestamp, 'STAGED_READY', 'connected', persisted.revision, new Date().toISOString()));
      return { runnerConnection: 'connected', runnerVersion: capabilities.runnerVersion, bundleId: bundle.sessionId, bundleSha256: bundle.bundleSha256, selectedProducts: bundle.selectedProducts, selectedContentTypes: bundle.selectedContentTypes, settingsVersion: persisted.settingsVersion, assetsStaged: persisted.bundle.assets.length, assetsExpected: bundle.assets.length, workflowSha256: bundle.workflowSha256, systemPromptSha256: bundle.systemPromptSha256, archiveReady, comfyReady: comfy?.ready === true, qwenReady: health.qwenModelAvailable === true, stageStatus: 'STAGED / READY', canaryStartEnabled: capabilities.canaryStartEnabled === true };
    } catch (reason) {
      const ambiguous = reason instanceof LocalRunnerTransportError || isTransientTransport(reason);
      this.db.saveLocalAutoMirror(this.mirror(bundle, capabilities.runnerVersion, createdTimestamp, ambiguous ? 'STAGING_DISCONNECTED' : 'DRAFT', ambiguous ? 'disconnected' : 'connected', existing?.lastKnownRevision ?? 0, existing?.lastSuccessfulSync ?? null));
      throw reason;
    }
  }

  private async stageWithReconciliation(
    client: LocalAutoH3Client,
    bundle: LocalSessionBundle,
    mode: RunnerMode,
    runnerVersion: string,
    createdTimestamp: string,
    existing: LocalAutoSessionMirror | null
  ): Promise<StageResult> {
    let lastAmbiguousError: unknown = null;
    for (let stageAttempt = 0; stageAttempt < 2; stageAttempt += 1) {
      try {
        const staged = await client.stageSession(bundle);
        if (staged.sessionId !== bundle.sessionId || staged.bundleHash !== bundle.bundleSha256) throw new Error('Stage acknowledgement conflicts with the locally persisted session identity.');
        return staged;
      } catch (reason) {
        if (!(reason instanceof LocalRunnerTransportError) && !isTransientTransport(reason)) throw reason;
        lastAmbiguousError = reason;
        this.db.saveLocalAutoMirror(this.mirror(bundle, runnerVersion, createdTimestamp, 'STAGING_DISCONNECTED', 'disconnected', existing?.lastKnownRevision ?? 0, existing?.lastSuccessfulSync ?? null));
        const persisted = await this.reconcileAmbiguousStage(client, bundle);
        if (persisted) {
          return { staged: true, sessionId: persisted.sessionId, revision: persisted.revision, bundleHash: persisted.bundleHash, sessionDirectory: persisted.sessionDirectory, mode };
        }
        // The only retry uses the exact same immutable bundle identity. The local runner
        // runner's Stage contract is idempotent for sessionId + bundleHash.
      }
    }
    throw new Error(`Stage remained ambiguous after local reconciliation: ${lastAmbiguousError instanceof Error ? lastAmbiguousError.message : String(lastAmbiguousError)}`);
  }

  private async reconcileAmbiguousStage(client: LocalAutoH3Client, bundle: LocalSessionBundle): Promise<PersistedSession | null> {
    const polls = Math.max(1, Math.ceil(this.stageReconciliationTimeoutMs / Math.max(1, this.stageReconciliationRetryMs)));
    for (let poll = 0; poll < polls; poll += 1) {
      try {
        const persisted = (await client.session(bundle.sessionId)).session;
        if (persisted) {
          if (persisted.sessionId !== bundle.sessionId) throw new Error('Stage reconciliation returned a conflicting sessionId.');
          if (persisted.bundleHash !== bundle.bundleSha256) throw new Error(`Stage reconciliation found conflicting bundleHash ${persisted.bundleHash} for session ${bundle.sessionId}.`);
          if (persisted.status !== 'STAGED') throw new Error(`Stage reconciliation found incompatible session status ${persisted.status} for session ${bundle.sessionId}.`);
          return persisted;
        }
      } catch (reason) {
        if (!(reason instanceof LocalRunnerTransportError) && !isTransientTransport(reason)) throw reason;
      }
      if (poll + 1 < polls) await this.wait(this.stageReconciliationRetryMs);
    }
    return null;
  }

  async startCanary(sessionId: string, bundleHash: string): Promise<LocalRunnerObserver> {
    const client = this.clientFactory(RUNNER_BASE_URL);
    const capabilities = await client.capabilities();
    if (capabilities.mode !== 'canary' || capabilities.canaryStartEnabled !== true || capabilities.maxJobsPerSession !== 1) throw new Error('Local runner does not advertise the one-job canary capability.');
    const persisted = (await client.session(sessionId)).session;
    if (!persisted || persisted.status !== 'STAGED' || persisted.bundleHash !== bundleHash) throw new Error('Canary Start requires the matching authoritative STAGED / READY session.');
    await client.startCanary(sessionId, bundleHash);
    return this.canaryStatus(sessionId);
  }

  async startTwoJobCanary(sessionId: string, bundleHash: string): Promise<LocalRunnerObserver> {
    const client = this.clientFactory(RUNNER_BASE_URL);
    const capabilities = await client.capabilities();
    if (capabilities.mode !== 'two-job-canary' || capabilities.canaryStartEnabled !== true || capabilities.maxJobsPerSession !== 2) throw new Error('Local runner does not advertise the two-job canary capability.');
    const persisted = (await client.session(sessionId)).session;
    if (!persisted || persisted.status !== 'STAGED' || persisted.bundleHash !== bundleHash) throw new Error('Two-job Canary Start requires the matching authoritative STAGED / READY session.');
    await client.startCanary(sessionId, bundleHash);
    return this.canaryStatus(sessionId);
  }

  startProduction(config: AutoH3Config): Promise<LocalRunnerObserver> {
    if (this.productionStart) return this.productionStart;
    this.productionStart = this.commitProductionStart(config).finally(() => { this.productionStart = null; });
    return this.productionStart;
  }

  private async commitProductionStart(config: AutoH3Config): Promise<LocalRunnerObserver> {
    if (!config.selectedProducts.length || !config.selectedContentTypes.length) throw new Error('Select at least one product and one content type.');
    const settings = this.settings();
    const client = this.clientFactory(RUNNER_BASE_URL);
    const capabilities = await this.productionPreflight(client);
    const mirror = this.db.getLatestLocalAutoDraft();
    let forceNew = false;
    if (mirror) {
      const candidate = buildLocalSessionBundle(config, settings, capabilities.runnerVersion, mirror.sessionId).bundle;
      if (localBundleSettingsIdentity(candidate) === mirror.settingsVersionIdentity) {
        const persisted = (await client.session(mirror.sessionId)).session;
        if (persisted && ['PRODUCTION_STARTING', 'PRODUCTION_RUNNING', 'STOPPING'].includes(persisted.status)) return this.canaryStatus(persisted.sessionId);
        forceNew = persisted?.status === 'STOPPED' || persisted?.status === 'FAILED';
      }
    }
    const staged = await this.stage(config, true, forceNew);
    try {
      await client.startCanary(staged.bundleId, staged.bundleSha256);
    } catch (reason) {
      if (!(reason instanceof LocalRunnerTransportError)) throw reason;
      const persisted = (await client.session(staged.bundleId)).session;
      if (!persisted || !['PRODUCTION_STARTING', 'PRODUCTION_RUNNING'].includes(persisted.status)) throw reason;
    }
    return this.canaryStatus(staged.bundleId);
  }

  private async productionPreflight(client: LocalAutoH3Client) {
    const startedAt = Date.now();
    let lastError: unknown = new Error('Production runner readiness has not been verified.');
    while (Date.now() - startedAt <= this.productionPreflightTimeoutMs) {
      try {
        const [capabilities, health] = await Promise.all([client.capabilities(), client.health()]);
        if (capabilities.mode !== 'production' || capabilities.generationEnabled !== true || capabilities.maxJobsPerSession !== null) throw new Error('INCOMPATIBLE_PRODUCTION_RUNNER: live runner does not advertise production mode, generation, and unlimited scheduling.');
        assertLocalServicesAvailable(health);
        if (health.ready === true) return capabilities;
        lastError = new Error('Local engine unavailable.');
      } catch (reason) {
        if (reason instanceof Error && reason.message.startsWith('INCOMPATIBLE_PRODUCTION_RUNNER:')) throw reason;
        lastError = reason;
      }
      const remaining = this.productionPreflightTimeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) break;
      await this.wait(Math.min(this.productionPreflightRetryMs, remaining));
    }
    throw new Error(`Local production preflight could not establish authoritative readiness within ${Math.round(this.productionPreflightTimeoutMs / 1000)} seconds: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  updateProductionSettings(sessionId: string, brief: H3VideoBrief): Promise<void> {
    const previous = this.settingsUpdates.get(sessionId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const client = this.clientFactory(RUNNER_BASE_URL);
      const persisted = (await client.session(sessionId)).session;
      if (!persisted || !['PRODUCTION_STARTING', 'PRODUCTION_RUNNING', 'STOPPING'].includes(persisted.status)) return;
      const next = structuredClone(persisted.bundle.settings);
      const sanitized = structuredClone(brief);
      sanitized.references = { firstFrame: { source: 'none', description: '', path: null }, lastFrame: { source: 'none', description: '', path: null }, productReference: { source: 'none', description: '', path: null }, styleReference: { source: 'none', description: '', path: null }, referenceImages: [] };
      next.brief = sanitized;
      next.h3 = validateH3WorkflowSettings(h3WorkflowSettingsFromBrief(sanitized));
      next.language = sanitized.language; next.musicOnly = sanitized.musicOnly; next.captions = sanitized.captions; next.subtitles = sanitized.subtitles;
      if (JSON.stringify(next) === JSON.stringify(persisted.bundle.settings) && persisted.settingsVersion === persisted.bundle.initialSettingsVersion) return;
      const current = (await client.session(sessionId)).session;
      if (!current) return;
      const currentSettings = current.settingsVersion === persisted.settingsVersion ? next : next;
      if (JSON.stringify(currentSettings) === JSON.stringify(current.bundle.settings) && current.settingsVersion === current.bundle.initialSettingsVersion) return;
      await client.updateSettings(sessionId, current.settingsVersion + 1, currentSettings);
    }).finally(() => { if (this.settingsUpdates.get(sessionId) === operation) this.settingsUpdates.delete(sessionId); });
    this.settingsUpdates.set(sessionId, operation);
    return operation;
  }

  async canaryReadiness(): Promise<LocalRunnerReadiness> {
    const client = this.clientFactory(RUNNER_BASE_URL);
    const [capabilities, health] = await Promise.all([client.capabilities(), client.health()]);
    assertLocalServicesAvailable(health);
    const mirror = this.db.getLatestLocalAutoDraft();
    let persisted = null;
    try {
      const response = mirror ? await client.session(mirror.sessionId) : await client.currentSession();
      persisted = response.session;
    } catch {
      // Historical session discovery is optional for production readiness.
      // Live capabilities + health remain authoritative for Start safety.
    }
    const plannedJobs: NonNullable<LocalRunnerReadiness['session']>['plannedJobs'] = [];
    if (persisted) {
      let productIndex = persisted.productIndex;
      let contentTypeIndex = persisted.contentTypeIndex;
      for (let index = 0; index < (capabilities.maxJobsPerSession ?? Math.min(6, persisted.bundle.ordering.productOrder.length * persisted.bundle.ordering.contentTypeOrder.length)); index++) {
        plannedJobs.push({ product: persisted.bundle.ordering.productOrder[productIndex], contentType: persisted.bundle.ordering.contentTypeOrder[contentTypeIndex] });
        contentTypeIndex++;
        if (contentTypeIndex >= persisted.bundle.ordering.contentTypeOrder.length) {
          contentTypeIndex = 0;
          productIndex = (productIndex + 1) % persisted.bundle.ordering.productOrder.length;
        }
      }
    }
    const session = persisted ? { sessionId: persisted.sessionId, bundleHash: persisted.bundleHash, status: persisted.status, plannedJobs } : null;
    const proxyStartEndpointAvailable = capabilities.canaryStartEnabled === true;
    const stagedReady = session?.status === 'STAGED'
      && health.ready === true
      && (!mirror || (mirror.stagingState === 'STAGED_READY' && mirror.bundleHash === session.bundleHash));
    return {
      runner: {
        runnerVersion: capabilities.runnerVersion,
        mode: capabilities.mode,
        generationEnabled: capabilities.generationEnabled,
        promptSubmissionEnabled: capabilities.promptSubmissionEnabled,
        canaryStartEnabled: capabilities.canaryStartEnabled,
        maxJobsPerSession: capabilities.maxJobsPerSession
      },
      proxyStartEndpointAvailable,
      healthReady: health.ready === true,
      session,
      stagedReady
    };
  }

  async canaryStatus(sessionId: string): Promise<LocalRunnerObserver> {
    const mirror = this.db.getLocalAutoMirror(sessionId);
    try {
      const client = this.clientFactory(RUNNER_BASE_URL);
      const [sessionResponse, jobsResponse] = await Promise.all([client.session(sessionId), client.jobs(sessionId)]);
      const session = sessionResponse.session;
      if (!session) throw new Error('Local session not found.');
      const job = jobsResponse.jobs.at(-1) ?? null;
      const jobs = jobsResponse.jobs.map(candidate => ({
        jobId: candidate.jobId,
        product: candidate.product,
        contentType: candidate.contentType,
        phase: candidate.phase,
        promptId: candidate.promptId,
        archivePath: candidate.archivePath,
        archiveSha256: candidate.archiveSha256,
        vramVerified: candidate.vramAudit?.h3VramReleaseSucceeded === true && candidate.vramAudit?.h3VramPostMeasurementFresh === true,
        revision: candidate.revision
      }));
      const syncedAt = new Date().toISOString();
      if (mirror) this.db.saveLocalAutoMirror({ ...mirror, lastKnownRevision: Math.max(session.revision, job?.revision ?? 0), connectionState: 'connected', lastSuccessfulSync: syncedAt });
      return { connection: 'connected', sessionId, sessionStatus: session.status, revision: session.revision, jobId: session.currentJobId ?? job?.jobId ?? null, jobPhase: session.currentJobId ? jobs.find(candidate => candidate.jobId === session.currentJobId)?.phase ?? null : job?.phase ?? null, promptId: session.currentJobId ? jobs.find(candidate => candidate.jobId === session.currentJobId)?.promptId ?? null : job?.promptId ?? null, archivePath: job?.archivePath ?? null, archiveSha256: job?.archiveSha256 ?? null, vramVerified: job?.vramAudit?.h3VramReleaseSucceeded === true && job.vramAudit.h3VramPostMeasurementFresh === true, lastAuthoritativeUpdate: session.updatedAt, completedCount: jobs.filter(candidate => candidate.phase === 'COMPLETED').length, failedCount: jobs.filter(candidate => candidate.phase === 'FAILED').length, currentProduct: session.bundle.ordering.productOrder[session.productIndex] ?? null, currentContentType: session.bundle.ordering.contentTypeOrder[session.contentTypeIndex] ?? null, currentCycle: session.cycleNumber, settingsVersion: session.settingsVersion, jobs };
    } catch (reason) {
      return { connection: 'disconnected', sessionId, sessionStatus: 'UNKNOWN', revision: mirror?.lastKnownRevision ?? 0, jobId: null, jobPhase: null, promptId: null, archivePath: null, archiveSha256: null, vramVerified: false, lastAuthoritativeUpdate: mirror?.lastSuccessfulSync ?? null, completedCount: 0, failedCount: 0, currentProduct: null, currentContentType: null, currentCycle: 0, settingsVersion: 0, jobs: [], message: `Local engine unavailable. ${reason instanceof Error ? reason.message : String(reason)}` };
    }
  }

  async stopAfterCurrent(sessionId: string): Promise<LocalRunnerObserver> {
    await this.clientFactory(RUNNER_BASE_URL).stopAfterCurrent(sessionId);
    return this.canaryStatus(sessionId);
  }

  async stopNow(sessionId: string): Promise<LocalRunnerObserver> {
    await this.clientFactory(RUNNER_BASE_URL).stopNow(sessionId);
    return this.canaryStatus(sessionId);
  }

  async downloadCanaryArtifact(sessionId: string, jobId: string, destinationRoot: string): Promise<{ path: string; size: number; sha256: string }> {
    const client = this.clientFactory(RUNNER_BASE_URL);
    const job = (await client.jobs(sessionId)).jobs.find(candidate => candidate.jobId === jobId);
    if (!job || job.phase !== 'COMPLETED' || !job.archiveSha256) throw new Error('Only an authoritative completed local canary artifact can be downloaded.');
    const downloaded = await client.downloadArtifact(jobId, job.archiveSha256, destinationRoot);
    if (job.archiveSize !== null && job.archiveSize !== undefined && downloaded.size !== job.archiveSize) throw new Error('Downloaded local artifact failed authoritative file-size verification.');
    return downloaded;
  }

  async syncCanaryArtifacts(sessionId: string, destinationRoot: string): Promise<Array<{ jobId: string; path: string; size: number; sha256: string; downloaded: boolean }>> {
    const client = this.clientFactory(RUNNER_BASE_URL);
    const jobs = (await client.jobs(sessionId)).jobs.filter(job => job.phase === 'COMPLETED' && job.archiveSha256);
    const results: Array<{ jobId: string; path: string; size: number; sha256: string; downloaded: boolean }> = [];
    for (const job of jobs) {
      const target = join(destinationRoot, `${job.jobId}.mp4`);
      if (existsSync(target) && (job.archiveSize === null || job.archiveSize === undefined || statSync(target).size === job.archiveSize) && createHash('sha256').update(readFileSync(target)).digest('hex') === job.archiveSha256) {
        await client.acknowledgeLocalOutputSync(job.jobId, target);
        results.push({ jobId: job.jobId, path: target, size: statSync(target).size, sha256: job.archiveSha256!, downloaded: false });
        continue;
      }
      const downloaded = await client.downloadArtifact(job.jobId, job.archiveSha256!, destinationRoot);
      if (job.archiveSize !== null && job.archiveSize !== undefined && downloaded.size !== job.archiveSize) throw new Error(`Downloaded local artifact ${job.jobId} failed authoritative file-size verification.`);
      results.push({ jobId: job.jobId, ...downloaded, downloaded: true });
    }
    return results;
  }
}
