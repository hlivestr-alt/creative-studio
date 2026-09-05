import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryDatabase, loadSqlite } from './database';
import { createH3ReferencePlan } from '../../src/domain/h3';
import { validateH3WorkflowSettings } from '../../src/domain/minimax-h3-workflow';
import { planCreativeGenome } from '../../src/domain/creative-diversity';
import { getProduct } from '../../src/domain/data';
import type { ComputeJobState, H3VideoBrief, RemoteH3JobRecord } from '../../src/domain/types';

let temporaryDirectory: string | undefined;
afterEach(() => { if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true }); temporaryDirectory = undefined; });

describe('SQLite history repository', () => {
  it('persists a prepared session and a later Used update across reopen', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-history-'));
    const path = join(temporaryDirectory, 'history.sqlite');
    const SQL = await loadSqlite();
    const database = new HistoryDatabase(path, SQL);
    const created = database.create({
      product: 'serum', postType: 'Product Hero', topic: 'Brightening hero', visualStyle: 'Citrus Light',
      workflowMode: 'DIRECT_IMAGE', postStructure: 'CAROUSEL', requestedSlideCount: 5, captionMode: 'STANDARD', creativityLevel: 'Balanced', format: 'Instagram Feed 4:5', language: 'Indonesian', preparedBrief: '# ROLE',
      conceptTitle: null, headline: null, status: 'Prepared', notes: null
    });
    database.update(created.id, { status: 'Used', conceptTitle: 'Vitamin C Sunrise', headline: 'START BRIGHT.' });
    database.close();

    const reopened = new HistoryDatabase(path, SQL);
    expect(reopened.list()).toMatchObject([{ id: created.id, workflowMode: 'DIRECT_IMAGE', postStructure: 'CAROUSEL', requestedSlideCount: 5, captionMode: 'STANDARD', status: 'Used', conceptTitle: 'Vitamin C Sunrise', headline: 'START BRIGHT.' }]);
    reopened.close();
  });

  it('migrates existing history rows to the legacy Explore 3 Ideas mode', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-history-'));
    const path = join(temporaryDirectory, 'history.sqlite');
    const SQL = await loadSqlite();
    const legacy = new SQL.Database();
    legacy.run(`
      CREATE TABLE creative_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        product TEXT NOT NULL,
        postType TEXT NOT NULL,
        topic TEXT NOT NULL,
        visualStyle TEXT NOT NULL,
        creativityLevel TEXT NOT NULL,
        format TEXT NOT NULL,
        language TEXT NOT NULL,
        preparedBrief TEXT NOT NULL,
        conceptTitle TEXT,
        headline TEXT,
        status TEXT NOT NULL,
        notes TEXT
      );
      INSERT INTO creative_history (product, postType, topic, visualStyle, creativityLevel, format, language, preparedBrief, status)
      VALUES ('serum', 'Product Hero', 'Brightening hero', 'Citrus Light', 'Balanced', 'Instagram Feed 4:5', 'Indonesian', '# ROLE', 'Prepared');
    `);
    writeFileSync(path, Buffer.from(legacy.export()));
    legacy.close();

    const database = new HistoryDatabase(path, SQL);
    expect(database.list()[0]).toMatchObject({ workflowMode: 'EXPLORE_IDEAS', postStructure: 'SINGLE_IMAGE', requestedSlideCount: null, captionMode: 'STANDARD' });
    database.close();
  });

  it('persists H3 prompt settings, timeline, references, and edits across reopen', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-history-'));
    const path = join(temporaryDirectory, 'history.sqlite');
    const SQL = await loadSqlite();
    const product = getProduct('skin-cream')!;
    const references = createH3ReferencePlan(product);
    const brief = {
      product: product.id,
      videoIdea: 'A building resolves into the product.',
      language: 'English' as const,
      musicOnly: true,
      captions: true,
      subtitles: false,
      goal: 'Transformation',
      customGoal: '',
      duration: 15,
      aspectRatio: '9:16' as const,
      customAspectRatio: '',
      qualityPreset: 'Final' as const,
      megapixels: 0.98,
      multiple: 32,
      fps: 24,
      workflowMode: 'AUTO' as const,
      cameraMotion: 'Cinematic' as const,
      actionIntensity: 'High' as const,
      pacing: 'Balanced' as const,
      productFidelity: 'Exact' as const,
      ending: 'Hero Shot' as const,
      customEnding: '',
      sound: 'Sound Design + Music' as const,
      promptDetail: 'Production' as const,
      specialInstructions: '',
      references
    };
    const database = new HistoryDatabase(path, SQL);
    const created = database.createH3({
      product: product.id,
      contentType: 'UGC Content',
      brief,
      concept: null,
      resolvedMode: 'L2VA',
      referencePlan: references,
      timeline: [{ start: 0, end: 2.5, label: 'Establish', detail: 'Open on the planned scene.' }],
      chatGptRequest: '# H3 REQUEST',
      recommendedSettings: { mode: 'L2VA', modeReason: 'Ending reference is available.', duration: 15, aspectRatio: '9:16', quality: 'Final', megapixels: 0.98, multiple: 32, fps: 24, frames: 362, productFidelity: 'Exact', audio: 'Auto', references: ['Last Frame: exact product'] },
      prompt: 'h3_workflow: L2VA',
      promptEngine: { provider: 'lmstudio-remote' as const, endpoint: 'http://127.0.0.1:1234/v1', model: 'qwen/qwen3.8-27b', temperature: 0.2, repairAttempts: 2, disableThinking: true, unloadModelBeforeH3: true, timeoutSeconds: 600 },
      llmModel: 'qwen/qwen3.8-27b',
      llmModelId: 'qwen/qwen3.8-27b',
      llmTemperature: 0.2,
      llmTimeoutSeconds: 600,
      llmRepairAttempts: 2,
      repairAttemptsConfigured: 2,
      repairAttemptsUsed: 0,
      enhancementManifest: '{"repairAttemptsUsed":0}',
      rewriteDiagnostics: '{"valid":true}',
      promptCaptureSource: 'structured',
      validationCaptureSource: 'structured',
      llmUnloadRequested: true,
      llmUnloadSucceeded: true,
      llmUnloadError: null,
      llmInstanceId: 'lmstudio-instance-1',
      llmUnloadDurationMs: 321,
      llmDisableThinking: true
    });
    database.updateH3(created.id, { prompt: 'h3_workflow: L2VA\nrevision_notes: stronger accuracy' });
    database.close();

    const reopened = new HistoryDatabase(path, SQL);
    expect(reopened.listH3()).toMatchObject([{
      id: created.id,
      product: 'skin-cream',
      contentType: 'UGC Content',
      resolvedMode: 'L2VA',
      brief: { duration: 15, aspectRatio: '9:16', megapixels: 0.98, multiple: 32, fps: 24, language: 'English', musicOnly: true, captions: true, subtitles: false },
      referencePlan: { lastFrame: { source: 'selected-product' } },
      timeline: [{ start: 0, end: 2.5 }],
      chatGptRequest: '# H3 REQUEST',
      recommendedSettings: { mode: 'L2VA', frames: 362 },
      prompt: 'h3_workflow: L2VA\nrevision_notes: stronger accuracy',
      promptEngine: { model: 'qwen/qwen3.8-27b', timeoutSeconds: 600 },
      llmModel: 'qwen/qwen3.8-27b', llmModelId: 'qwen/qwen3.8-27b', llmTemperature: 0.2, llmTimeoutSeconds: 600, llmRepairAttempts: 2, repairAttemptsConfigured: 2, repairAttemptsUsed: 0, enhancementManifest: '{"repairAttemptsUsed":0}', rewriteDiagnostics: '{"valid":true}', promptCaptureSource: 'structured', validationCaptureSource: 'structured', llmUnloadRequested: true, llmUnloadSucceeded: true, llmUnloadError: null, llmInstanceId: 'lmstudio-instance-1', llmUnloadDurationMs: 321, llmDisableThinking: true
    }]);
    reopened.close();
  });

  it('backfills language and text/audio options for legacy H3 records', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-history-'));
    const path = join(temporaryDirectory, 'history.sqlite');
    const SQL = await loadSqlite();
    const legacy = new SQL.Database();
    legacy.run(`
      CREATE TABLE h3_prompt_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        product TEXT NOT NULL,
        briefJson TEXT NOT NULL,
        conceptJson TEXT,
        resolvedMode TEXT NOT NULL,
        referencePlanJson TEXT NOT NULL,
        timelineJson TEXT NOT NULL,
        prompt TEXT NOT NULL
      );
      INSERT INTO h3_prompt_history (product, briefJson, conceptJson, resolvedMode, referencePlanJson, timelineJson, prompt)
      VALUES ('skin-cream', '{"product":"skin-cream","sound":"Music Only"}', NULL, 'T2VA', '{"firstFrame":{"source":"none"}}', '[]', 'legacy prompt');
    `);
    writeFileSync(path, Buffer.from(legacy.export()));
    legacy.close();

    const database = new HistoryDatabase(path, SQL);
    expect(database.listH3()[0].brief).toMatchObject({ language: 'Indonesian', musicOnly: true, captions: false, subtitles: false });
    database.close();
  });

  it('persists the creative genome, fingerprint, seed, job id, and failed status across reopen', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-history-'));
    const path = join(temporaryDirectory, 'history.sqlite');
    const SQL = await loadSqlite();
    const product = getProduct('cleanser')!;
    const references = createH3ReferencePlan(product);
    const plan = planCreativeGenome({ product, contentFamily: 'Product B-Roll', seed: 4422, now: new Date('2026-01-01T12:00:00.000Z'), generationJobId: 'h3-failed-job', options: { noveltyThreshold: 101, maxRerolls: 0 } });
    const brief: H3VideoBrief = {
      product: product.id,
      contentType: 'Product B-Roll',
      creativeVariety: 'Balanced',
      creativeSeed: plan.creativeSeed,
      creativeGenome: plan.genome,
      videoIdea: '',
      language: 'English',
      musicOnly: true,
      captions: false,
      subtitles: false,
      goal: 'Product reveal',
      customGoal: '',
      duration: 8,
      aspectRatio: '9:16',
      customAspectRatio: '',
      qualityPreset: 'Final',
      megapixels: 0.98,
      multiple: 32,
      fps: 24,
      workflowMode: 'REF2VA',
      cameraMotion: 'Cinematic',
      actionIntensity: 'Medium',
      pacing: 'Balanced',
      productFidelity: 'Exact',
      ending: 'Hero Shot',
      customEnding: '',
      sound: 'Music Only',
      promptDetail: 'Production',
      specialInstructions: '',
      references
    };
    const database = new HistoryDatabase(path, SQL);
    const created = database.createH3({
      product: product.id,
      contentType: 'Product B-Roll',
      brief,
      concept: null,
      resolvedMode: 'REF2VA',
      referencePlan: references,
      timeline: [],
      chatGptRequest: 'creative direction',
      recommendedSettings: null,
      prompt: '',
      generationJobId: 'h3-failed-job',
      generationStatus: 'planned',
      creativeSeed: plan.creativeSeed,
      creativeGenome: plan.genome,
      creativeFingerprint: plan.fingerprint,
      conceptSummary: plan.conceptSummary,
      noveltyScore: plan.noveltyScore,
      repetitionPenaltySources: plan.repetitionPenaltySources,
      diversityFallbackUsed: plan.diversityFallbackUsed,
      diversityFallbackReason: plan.diversityFallbackReason,
      rerollsUsed: plan.rerollsUsed,
      noveltyThresholdMissed: plan.noveltyThresholdMissed,
      creativeDiversityDiagnostics: plan.diversityDiagnostics
    });
    database.updateH3(created.id, { generationStatus: 'failed', llmUnloadRequested: true, llmUnloadSucceeded: false, llmUnloadError: 'LM Studio unload failed', llmInstanceId: 'lmstudio-failed-instance', llmUnloadDurationMs: 1204 });
    database.close();

    const reopened = new HistoryDatabase(path, SQL);
    expect(reopened.listH3()).toMatchObject([{
      generationJobId: 'h3-failed-job',
      generationStatus: 'failed',
      creativeSeed: plan.creativeSeed,
      creativeGenome: { contentFamily: 'Product B-Roll', creativeArchetype: plan.genome.creativeArchetype, visualHook: plan.genome.visualHook },
      creativeFingerprint: { signature: plan.fingerprint.signature },
      conceptSummary: plan.conceptSummary,
      diversityFallbackUsed: true,
      diversityFallbackReason: 'novelty_threshold_missed',
      rerollsUsed: 0,
      noveltyThresholdMissed: true,
      creativeDiversityDiagnostics: { selectedContentType: 'Product B-Roll', candidateFamilySearched: 'Product B-Roll', hardCompatibleCandidateCount: plan.diversityDiagnostics.hardCompatibleCandidateCount, noveltyScore: plan.noveltyScore },
      llmUnloadRequested: true,
      llmUnloadSucceeded: false,
      llmUnloadError: 'LM Studio unload failed',
      llmInstanceId: 'lmstudio-failed-instance',
      llmUnloadDurationMs: 1204
    }]);
    reopened.close();
  });

  it('persists remote H3 job state and result metadata across reopen', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-history-'));
    const path = join(temporaryDirectory, 'history.sqlite');
    const SQL = await loadSqlite();
    const localResultPath = join(temporaryDirectory, 'PROYA_H3_result.mp4');
    const releaseAudit = {
      "h3VramReleaseRequested": true,
      "h3VramReleaseSucceeded": false,
      "h3VramReleaseDurationMs": 15000,
      "h3VramReleaseError": "GPU memory remains reserved",
      "h3VramBeforeRelease": {
        "capturedAt": "2026-09-05T00:00:00Z",
        "devices": [
          {
            "name": "RTX 5090",
            "type": "cuda",
            "vramTotalBytes": 32000000000,
            "vramFreeBytes": 2000000000,
            "torchReservedBytes": 27000000000
          }
        ]
      }
    };
    const state: ComputeJobState = {
      ...releaseAudit,
      localJobId: 'local-h3-job-123', remotePromptId: '550e8400-e29b-41d4-a716-446655440000', status: 'completed', progress: 1, currentNode: null, queuePosition: null, queueRemaining: 0,
      outputs: [{ nodeId: '92', kind: 'video', filename: 'PROYA_H3_result.mp4', subfolder: '', type: 'output', url: 'https://comfy.example.test/view?filename=PROYA_H3_result.mp4' }],
      referenceUploads: [{ sourcePath: 'product-assets/serum.png', filename: 'PROYA_H3_REF_serum_hash.png', subfolder: '', type: 'input' }],
      remoteUploadedFilename: 'PROYA_H3_REF_serum_hash.png', localResultPath, downloadError: null, error: null, connectionError: null,
      serverUrl: 'https://comfy.example.test', updatedAt: '2026-08-31T00:00:00.000Z',
      llmModel: 'qwen/qwen3.8-27b', llmModelId: 'qwen/qwen3.8-27b', llmTemperature: 0.2, llmTimeoutSeconds: 600, llmRepairAttempts: 2, repairAttemptsConfigured: 2, repairAttemptsUsed: 2, enhancementManifest: '{"repairAttemptsUsed":2}', rewriteDiagnostics: '{"valid":true}', promptCaptureSource: 'structured', validationCaptureSource: 'structured', llmUnloadRequested: true, llmUnloadSucceeded: true, llmUnloadError: null, llmInstanceId: 'lmstudio-instance-1', llmUnloadDurationMs: 321, llmDisableThinking: true
    };
    const workflowSettings = validateH3WorkflowSettings({ durationSeconds: 4, aspectRatio: '9:16', megapixels: 0.98, multiple: 32, fps: 24, steps: 36, scheduler: 'beta', seedMode: 'fixed', seed: 424242, refImageSize: 'max' });
    const request = { prompt: 'Final prompt', mode: 'REF2VA' as const, duration: 4, aspectRatio: '9:16', fps: 24, frames: 107, megapixels: 0.98, multiple: 32, steps: 36, seed: 424242, firstFrame: null, lastFrame: null, productReference: null, productReferencePath: 'product-assets/serum.png', refImageSize: 'max' as const, scheduler: 'beta' as const, workflowSettings, product: 'serum' as const, promptEngine: { provider: 'lmstudio-remote' as const, endpoint: 'http://127.0.0.1:1234/v1', model: 'qwen/qwen3.8-27b', temperature: 0.2, repairAttempts: 2, disableThinking: true, unloadModelBeforeH3: true, timeoutSeconds: 600 }, promptRecordId: 7, localJobId: 'local-h3-job-123' };
    const record: RemoteH3JobRecord = {
      localJobId: 'local-h3-job-123', remotePromptId: state.remotePromptId, createdAt: '2026-08-31T00:00:00.000Z', updatedAt: state.updatedAt, promptRecordId: 7, product: 'serum', workflowMode: 'REF2VA', prompt: request.prompt, request, workflowSettings,
      promptEngine: request.promptEngine, llmModel: state.llmModel, llmModelId: state.llmModelId, llmTemperature: state.llmTemperature, llmTimeoutSeconds: state.llmTimeoutSeconds, llmRepairAttempts: state.llmRepairAttempts, repairAttemptsConfigured: state.repairAttemptsConfigured, repairAttemptsUsed: state.repairAttemptsUsed, enhancementManifest: state.enhancementManifest, rewriteDiagnostics: state.rewriteDiagnostics, promptCaptureSource: state.promptCaptureSource, validationCaptureSource: state.validationCaptureSource, llmUnloadRequested: state.llmUnloadRequested, llmUnloadSucceeded: state.llmUnloadSucceeded, llmUnloadError: state.llmUnloadError, llmInstanceId: state.llmInstanceId, llmUnloadDurationMs: state.llmUnloadDurationMs, llmDisableThinking: state.llmDisableThinking,
      localSourceReferencePath: request.productReferencePath, remoteUploadedFilename: state.remoteUploadedFilename, outputMetadata: state.outputs, localDownloadedPath: localResultPath, status: state.status, state
    };
    const database = new HistoryDatabase(path, SQL);
    database.upsertRemoteH3Job(record);
    database.close();

    const reopened = new HistoryDatabase(path, SQL);
    expect(reopened.listRemoteH3Jobs()[0]).toMatchObject({
      ...releaseAudit,
      llmModelId: 'qwen/qwen3.8-27b',
      repairAttemptsConfigured: 2,
      repairAttemptsUsed: 2,
      enhancementManifest: '{"repairAttemptsUsed":2}',
      rewriteDiagnostics: '{"valid":true}',
      promptCaptureSource: 'structured',
      validationCaptureSource: 'structured',
      llmUnloadRequested: true,
      llmUnloadSucceeded: true,
      llmUnloadError: null,
      llmInstanceId: 'lmstudio-instance-1',
      llmUnloadDurationMs: 321,
      state: {
        ...releaseAudit,
        llmModelId: 'qwen/qwen3.8-27b',
        repairAttemptsConfigured: 2,
        repairAttemptsUsed: 2,
        llmInstanceId: 'lmstudio-instance-1',
        llmUnloadDurationMs: 321
      }
    });
    expect(reopened.listRemoteH3Jobs()).toMatchObject([{ localJobId: 'local-h3-job-123', remotePromptId: state.remotePromptId, promptRecordId: 7, product: 'serum', workflowMode: 'REF2VA', llmModel: 'qwen/qwen3.8-27b', llmTemperature: 0.2, llmTimeoutSeconds: 600, llmRepairAttempts: 2, llmDisableThinking: true, workflowSettings: { durationSeconds: 4, frameLength: 107, resolvedWidth: 768, resolvedHeight: 1344, steps: 36, scheduler: 'beta', seed: 424242, refImageSize: 'max' }, request: { workflowSettings: { seed: 424242, steps: 36 }, promptEngine: { timeoutSeconds: 600 } }, localSourceReferencePath: 'product-assets/serum.png', remoteUploadedFilename: 'PROYA_H3_REF_serum_hash.png', localDownloadedPath: localResultPath, status: 'completed', outputMetadata: [{ nodeId: '92', filename: 'PROYA_H3_result.mp4' }], state: { localJobId: 'local-h3-job-123', remotePromptId: state.remotePromptId, localResultPath, remoteUploadedFilename: 'PROYA_H3_REF_serum_hash.png', llmModel: 'qwen/qwen3.8-27b', llmTimeoutSeconds: 600, llmRepairAttempts: 2, llmDisableThinking: true } }]);
    reopened.close();
  });

  it('migrates legacy remote jobs without treating their old jobId as a ComfyUI prompt UUID', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-history-'));
    const path = join(temporaryDirectory, 'history.sqlite');
    const SQL = await loadSqlite();
    const legacy = new SQL.Database();
    legacy.run(`
      CREATE TABLE remote_h3_jobs (
        jobId TEXT PRIMARY KEY,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        promptRecordId INTEGER,
        product TEXT,
        workflowMode TEXT NOT NULL,
        prompt TEXT NOT NULL,
        requestJson TEXT NOT NULL,
        localSourceReferencePath TEXT,
        remoteUploadedFilename TEXT,
        outputMetadataJson TEXT NOT NULL,
        localDownloadedPath TEXT,
        status TEXT NOT NULL,
        stateJson TEXT NOT NULL
      );
      INSERT INTO remote_h3_jobs (jobId, createdAt, updatedAt, promptRecordId, product, workflowMode, prompt, requestJson, localSourceReferencePath, remoteUploadedFilename, outputMetadataJson, localDownloadedPath, status, stateJson)
      VALUES ('legacy-local-job', '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z', NULL, 'serum', 'REF2VA', 'legacy prompt', '{"prompt":"legacy prompt","mode":"REF2VA","duration":4,"aspectRatio":"9:16","fps":24,"frames":107,"megapixels":0.98,"multiple":32,"firstFrame":null,"lastFrame":null,"productReference":null}', NULL, NULL, '[]', NULL, 'queued', '{"jobId":"legacy-local-job","status":"queued","progress":null,"currentNode":null,"queuePosition":1,"queueRemaining":null,"outputs":[],"referenceUploads":[],"remoteUploadedFilename":null,"localResultPath":null,"downloadError":null,"error":null,"connectionError":null,"serverUrl":"https://comfy.example.test","updatedAt":"2026-08-31T00:00:00.000Z"}');
    `);
    writeFileSync(path, Buffer.from(legacy.export()));
    legacy.close();

    const database = new HistoryDatabase(path, SQL);
    expect(database.listRemoteH3Jobs()[0]).toMatchObject({ localJobId: 'legacy-local-job', remotePromptId: null, state: { localJobId: 'legacy-local-job', remotePromptId: null } });
    database.close();
  });
});
