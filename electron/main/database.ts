import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { createRequire } from "node:module";
import type {
  CaptionMode,
  H3ContentType,
  H3PromptInput,
  H3PromptRecord,
  H3PromptUpdate,
  H3VideoBrief,
  H3GenerationStatus,
  HistoryInput,
  HistoryRecord,
  HistoryUpdate,
  RemoteH3JobRecord,
  RequestedSlideCount,
} from "../../src/domain/types";
import { normalizeH3LockedProductPlateMode } from "../../src/domain/locked-product-plate";

import type { AutoH3Session, AutoH3Job, ChinaAutoSessionMirror } from "../../src/domain/auto-h3";

const localRequire = createRequire(__filename);

type StoredHistoryRecord = Omit<
  HistoryRecord,
  "workflowMode" | "postStructure" | "requestedSlideCount" | "captionMode"
> & {
  workflowMode: string;
  postStructure: string;
  requestedSlideCount: string | number | null;
  captionMode: string;
};

type StoredH3PromptRecord = {
  id: number;
  createdAt: string;
  product: string;
  contentType?: string | null;
  briefJson: string;
  conceptJson: string | null;
  resolvedMode: string;
  referencePlanJson: string;
  timelineJson: string;
  chatGptRequest?: string | null;
  recommendedSettingsJson?: string | null;
  prompt: string;
  generationJobId?: string | null;
  generationStatus?: string | null;
  creativeSeed?: number | string | null;
  creativeGenomeJson?: string | null;
  creativeFingerprintJson?: string | null;
  conceptSummary?: string | null;
  noveltyScore?: number | string | null;
  repetitionPenaltySourcesJson?: string | null;
  diversityFallbackUsed?: number | string | null;
  diversityFallbackReason?: string | null;
  rerollsUsed?: number | string | null;
  noveltyThresholdMissed?: number | string | null;
  creativeDiversityDiagnosticsJson?: string | null;
  generationBriefJson?: string | null;
  generationBriefText?: string | null;
  referenceContext?: string | null;
  promptEngineJson?: string | null;
  systemPromptHash?: string | null;
  lmStudioModelId?: string | null;
  llmModelId?: string | null;
  temperature?: number | string | null;
  llmModel?: string | null;
  llmTemperature?: number | string | null;
  llmMaxTokens?: number | string | null;
  llmTimeoutSeconds?: number | string | null;
  llmRepairAttempts?: number | string | null;
  llmDisableThinking?: number | string | boolean | null;
  repairAttemptsConfigured?: number | string | null;
  repairAttemptsUsed?: number | string | null;
  enhancementManifest?: string | null;
  rewriteDiagnostics?: string | null;
  finalEnhancedPrompt?: string | null;
  validationReport?: string | null;
  promptCaptureSource?: string | null;
  validationCaptureSource?: string | null;
  referenceMapJson?: string | null;
  timingsJson?: string | null;
  remotePromptId?: string | null;
  outputPath?: string | null;
  pipelineStage?: string | null;
  llmUnloadRequested?: number | string | null;
  llmUnloadSucceeded?: number | string | null;
  llmUnloadError?: string | null;
  llmInstanceId?: string | null;
  llmUnloadDurationMs?: number | string | null;
};

type StoredRemoteH3JobRecord = {
  jobId: string;
  localJobId?: string | null;
  remotePromptId?: string | null;
  createdAt: string;
  updatedAt: string;
  promptRecordId: number | null;
  product: string | null;
  workflowMode: string;
  prompt: string;
  requestJson: string;
  localSourceReferencePath: string | null;
  remoteUploadedFilename: string | null;
  outputMetadataJson: string;
  localDownloadedPath: string | null;
  status: string;
  stateJson: string;
};

type StoredRemoteH3State = Partial<RemoteH3JobRecord["state"]> & {
  jobId?: string | null;
};

const h3ContentTypeValues: readonly H3ContentType[] = [
  "Cinematic Product Ad",
  "UGC Content",
  "Product Demo",
  "Product B-Roll",
  "Product Transformation",
  "Educational",
  "Ingredient / Texture",
  "Custom",
];

const normalizeH3ContentType = (
  value: string | null | undefined,
  brief: H3VideoBrief,
): H3ContentType => {
  const candidate = value ?? brief.contentType;
  return h3ContentTypeValues.includes(candidate as H3ContentType)
    ? (candidate as H3ContentType)
    : "Cinematic Product Ad";
};

const normalizeH3Brief = (brief: H3VideoBrief): H3VideoBrief => {
  const musicOnly =
    typeof brief.musicOnly === "boolean"
      ? brief.musicOnly
      : brief.sound === "Music Only";
  return {
    ...brief,
    language: brief.language === "English" ? "English" : "Indonesian",
    musicOnly,
    captions: brief.captions === true,
    subtitles: musicOnly ? false : brief.subtitles === true,
    creativeVariety:
      brief.creativeVariety === "Consistent" ||
      brief.creativeVariety === "Exploratory"
        ? brief.creativeVariety
        : "Balanced",
    lockedProductPlateMode: normalizeH3LockedProductPlateMode(
      brief.lockedProductPlateMode,
    ),
  };
};

const normalizeRequestedSlideCount = (
  value: string | number | null,
): RequestedSlideCount | null => {
  if (value === null || value === "") return null;
  if (value === "AUTO") return "AUTO";
  const numeric = Number(value);
  return [3, 4, 5, 6, 7, 8].includes(numeric)
    ? (numeric as RequestedSlideCount)
    : null;
};

const normalizeCaptionMode = (value: string | null | undefined): CaptionMode =>
  value === "SHORT" || value === "DETAILED" || value === "NONE"
    ? value
    : "STANDARD";

const normalizeHistoryRecord = (row: StoredHistoryRecord): HistoryRecord => ({
  ...row,
  workflowMode:
    row.workflowMode === "DIRECT_IMAGE" ? "DIRECT_IMAGE" : "EXPLORE_IDEAS",
  postStructure: row.postStructure === "CAROUSEL" ? "CAROUSEL" : "SINGLE_IMAGE",
  requestedSlideCount: normalizeRequestedSlideCount(row.requestedSlideCount),
  captionMode: normalizeCaptionMode(row.captionMode),
});

const parseJson = <T>(value: string | null, label: string): T => {
  if (!value) throw new Error(`Missing H3 ${label}`);
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Invalid H3 ${label}`);
  }
};

const parseOptionalJson = <T>(
  value: string | null | undefined,
  label: string,
): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Invalid H3 ${label}`);
  }
};

const normalizeH3GenerationStatus = (
  value: string | null | undefined,
): H3GenerationStatus => {
  const statuses: readonly H3GenerationStatus[] = [
    "planned",
    "prepared",
    "queued",
    "running",
    "completed",
    "failed",
    "rejected",
    "archived",
  ];
  return statuses.includes(value as H3GenerationStatus)
    ? (value as H3GenerationStatus)
    : "planned";
};

const numericOrNull = (
  value: number | string | null | undefined,
): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const booleanOrNull = (
  value: number | string | boolean | null | undefined,
): boolean | null => {
  if (value === null || value === undefined || value === "") return null;
  if (value === true || value === 1 || value === "1" || value === "true")
    return true;
  if (value === false || value === 0 || value === "0" || value === "false")
    return false;
  return null;
};

const normalizeH3PromptRecord = (row: StoredH3PromptRecord): H3PromptRecord => {
  const storedBrief = parseJson<H3VideoBrief>(row.briefJson, "brief");
  const contentType = normalizeH3ContentType(row.contentType, storedBrief);
  const creativeGenome =
    parseOptionalJson<NonNullable<H3PromptRecord["creativeGenome"]>>(
      row.creativeGenomeJson,
      "creative genome",
    ) ??
    storedBrief.creativeGenome ??
    null;
  const creativeSeed =
    numericOrNull(row.creativeSeed) ?? storedBrief.creativeSeed ?? null;
  const brief = normalizeH3Brief({
    ...storedBrief,
    contentType,
    creativeGenome,
    creativeSeed: creativeSeed ?? undefined,
  });
  const promptEngine = parseOptionalJson<
    NonNullable<H3PromptRecord["promptEngine"]>
  >(row.promptEngineJson, "prompt engine");
  return {
    id: row.id,
    createdAt: row.createdAt,
    product: row.product as H3PromptRecord["product"],
    contentType,
    brief: { ...brief, contentType },
    concept: row.conceptJson ? parseJson(row.conceptJson, "concept") : null,
    resolvedMode: row.resolvedMode as H3PromptRecord["resolvedMode"],
    referencePlan: parseJson(row.referencePlanJson, "reference plan"),
    timeline: parseJson(row.timelineJson, "timeline"),
    chatGptRequest: row.chatGptRequest ?? "",
    recommendedSettings: row.recommendedSettingsJson
      ? parseJson(row.recommendedSettingsJson, "recommended settings")
      : null,
    prompt: row.prompt,
    generationJobId: row.generationJobId?.trim() || `h3-generation-${row.id}`,
    generationStatus: normalizeH3GenerationStatus(row.generationStatus),
    creativeSeed,
    creativeGenome,
    creativeFingerprint: parseOptionalJson<
      NonNullable<H3PromptRecord["creativeFingerprint"]>
    >(row.creativeFingerprintJson, "creative fingerprint"),
    conceptSummary: row.conceptSummary ?? null,
    noveltyScore: numericOrNull(row.noveltyScore),
    repetitionPenaltySources:
      parseOptionalJson<
        NonNullable<H3PromptRecord["repetitionPenaltySources"]>
      >(row.repetitionPenaltySourcesJson, "repetition penalty sources") ?? [],
    diversityFallbackUsed: booleanOrNull(row.diversityFallbackUsed),
    diversityFallbackReason:
      row.diversityFallbackReason === "compatible_pool_exhausted" ||
      row.diversityFallbackReason === "novelty_threshold_missed"
        ? row.diversityFallbackReason
        : null,
    rerollsUsed: numericOrNull(row.rerollsUsed),
    noveltyThresholdMissed: booleanOrNull(row.noveltyThresholdMissed),
    creativeDiversityDiagnostics: parseOptionalJson<
      NonNullable<H3PromptRecord["creativeDiversityDiagnostics"]>
    >(row.creativeDiversityDiagnosticsJson, "creative diversity diagnostics"),
    generationBrief: parseOptionalJson<
      NonNullable<H3PromptRecord["generationBrief"]>
    >(row.generationBriefJson, "generation brief"),
    generationBriefText: row.generationBriefText ?? null,
    referenceContext: row.referenceContext ?? null,
    promptEngine,
    systemPromptHash: row.systemPromptHash ?? null,
    lmStudioModelId: row.lmStudioModelId ?? null,
    llmModelId:
      row.llmModelId ??
      row.llmModel ??
      promptEngine?.model ??
      row.lmStudioModelId ??
      null,
    temperature: numericOrNull(row.temperature),
    llmModel:
      row.llmModel ?? promptEngine?.model ?? row.lmStudioModelId ?? null,
    llmTemperature:
      numericOrNull(row.llmTemperature) ??
      numericOrNull(promptEngine?.temperature) ??
      numericOrNull(row.temperature),
    llmTimeoutSeconds:
      numericOrNull(row.llmTimeoutSeconds) ??
      numericOrNull(promptEngine?.timeoutSeconds),
    llmRepairAttempts:
      numericOrNull(row.llmRepairAttempts) ??
      numericOrNull(promptEngine?.repairAttempts),
    repairAttemptsConfigured:
      numericOrNull(row.repairAttemptsConfigured) ??
      numericOrNull(row.llmRepairAttempts) ??
      numericOrNull(promptEngine?.repairAttempts),
    llmDisableThinking:
      booleanOrNull(row.llmDisableThinking) ??
      (promptEngine ? promptEngine.disableThinking : null),
    repairAttemptsUsed: numericOrNull(row.repairAttemptsUsed),
    enhancementManifest: row.enhancementManifest ?? null,
    rewriteDiagnostics: row.rewriteDiagnostics ?? null,
    finalEnhancedPrompt: row.finalEnhancedPrompt ?? null,
    validationReport: row.validationReport ?? null,
    promptCaptureSource:
      row.promptCaptureSource === "structured" ||
      row.promptCaptureSource === "fallback_raw_history"
        ? row.promptCaptureSource
        : null,
    validationCaptureSource:
      row.validationCaptureSource === "structured" ||
      row.validationCaptureSource === "fallback_raw_history"
        ? row.validationCaptureSource
        : null,
    referenceMap:
      parseOptionalJson<NonNullable<H3PromptRecord["referenceMap"]>>(
        row.referenceMapJson,
        "reference map",
      ) ?? [],
    timings: parseOptionalJson<NonNullable<H3PromptRecord["timings"]>>(
      row.timingsJson,
      "timings",
    ),
    remotePromptId: row.remotePromptId ?? null,
    outputPath: row.outputPath ?? null,
    pipelineStage:
      (row.pipelineStage as H3PromptRecord["pipelineStage"]) ?? null,
    llmUnloadRequested: booleanOrNull(row.llmUnloadRequested),
    llmUnloadSucceeded: booleanOrNull(row.llmUnloadSucceeded),
    llmUnloadError: row.llmUnloadError ?? null,
    llmInstanceId: row.llmInstanceId ?? null,
    llmUnloadDurationMs: numericOrNull(row.llmUnloadDurationMs),
  };
};

const normalizeRemoteH3JobRecord = (
  row: StoredRemoteH3JobRecord,
): RemoteH3JobRecord => {
  const request = parseJson<RemoteH3JobRecord["request"]>(
    row.requestJson,
    "remote job request",
  );
  const parsedState = parseJson<StoredRemoteH3State>(
    row.stateJson,
    "remote job state",
  );
  const stateWithoutLegacyJobId = { ...parsedState };
  delete stateWithoutLegacyJobId.jobId;
  const localJobId =
    row.localJobId?.trim() ||
    request.localJobId?.trim() ||
    request.clientJobId?.trim() ||
    row.jobId;
  const remotePromptId =
    row.remotePromptId?.trim() || parsedState.remotePromptId?.trim() || null;
  const promptEngine = parsedState.promptEngine ?? request.promptEngine ?? null;
  const llmModel = parsedState.llmModel ?? promptEngine?.model ?? null;
  const llmTemperature =
    parsedState.llmTemperature ?? promptEngine?.temperature ?? null;
  const llmTimeoutSeconds =
    parsedState.llmTimeoutSeconds ?? promptEngine?.timeoutSeconds ?? null;
  const llmRepairAttempts =
    parsedState.llmRepairAttempts ?? promptEngine?.repairAttempts ?? null;
  const repairAttemptsConfigured =
    parsedState.repairAttemptsConfigured ?? llmRepairAttempts;
  const llmModelId =
    parsedState.llmModelId ??
    parsedState.llmModel ??
    parsedState.lmStudioModelId ??
    promptEngine?.model ??
    null;
  const llmDisableThinking =
    parsedState.llmDisableThinking ?? promptEngine?.disableThinking ?? null;
  const state: RemoteH3JobRecord["state"] = {
    ...stateWithoutLegacyJobId,
    localJobId,
    remotePromptId,
    status:
      parsedState.status ??
      (row.status as RemoteH3JobRecord["state"]["status"]),
    progress: parsedState.progress ?? null,
    currentNode: parsedState.currentNode ?? null,
    queuePosition: parsedState.queuePosition ?? null,
    queueRemaining: parsedState.queueRemaining ?? null,
    referenceUploads: parsedState.referenceUploads ?? [],
    remoteUploadedFilename:
      parsedState.remoteUploadedFilename ?? row.remoteUploadedFilename ?? null,
    localResultPath:
      parsedState.localResultPath ?? row.localDownloadedPath ?? null,
    downloadError: parsedState.downloadError ?? null,
    outputs: parsedState.outputs ?? [],
    error: parsedState.error ?? null,
    connectionError: parsedState.connectionError ?? null,
    serverUrl: parsedState.serverUrl ?? "",
    updatedAt: parsedState.updatedAt ?? row.updatedAt,
    pipelineStage: parsedState.pipelineStage,
    failureStage: parsedState.failureStage,
    generationBrief:
      parsedState.generationBrief ?? request.generationBrief ?? null,
    referenceMap:
      parsedState.referenceMap ?? request.generationBrief?.references ?? [],
    mediaManifest:
      parsedState.mediaManifest ??
      request.mediaManifest ??
      request.generationBrief?.mediaManifest ??
      null,
    allowedReferenceLabels:
      parsedState.allowedReferenceLabels ??
      request.allowedReferenceLabels ??
      request.generationBrief?.allowedReferenceLabels ??
      null,
    physicalReferenceMap: parsedState.physicalReferenceMap ?? [],
    systemPromptHash: parsedState.systemPromptHash ?? null,
    lmStudioModelId:
      parsedState.lmStudioModelId ?? request.promptEngine?.model ?? null,
    llmModelId,
    temperature:
      parsedState.temperature ?? request.promptEngine?.temperature ?? null,
    llmModel,
    llmTemperature,
    llmTimeoutSeconds,
    llmRepairAttempts,
    repairAttemptsConfigured,
    llmDisableThinking,
    repairAttemptsUsed: parsedState.repairAttemptsUsed ?? null,
    enhancementManifest: parsedState.enhancementManifest ?? null,
    rewriteDiagnostics: parsedState.rewriteDiagnostics ?? null,
    finalEnhancedPrompt: parsedState.finalEnhancedPrompt ?? null,
    validationReport: parsedState.validationReport ?? null,
    promptCaptureSource: parsedState.promptCaptureSource ?? null,
    validationCaptureSource: parsedState.validationCaptureSource ?? null,
    promptEngine,
    llmUnloadRequested: parsedState.llmUnloadRequested,
    llmUnloadSucceeded: parsedState.llmUnloadSucceeded,
    llmUnloadError: parsedState.llmUnloadError ?? null,
    llmInstanceId: parsedState.llmInstanceId ?? null,
    llmUnloadDurationMs: parsedState.llmUnloadDurationMs ?? null,
    stageTimings: parsedState.stageTimings ?? {},
  };
  const outputMetadata = row.outputMetadataJson
    ? parseJson<RemoteH3JobRecord["outputMetadata"]>(
        row.outputMetadataJson,
        "remote output metadata",
      )
    : state.outputs;
  return {
    localJobId,
    remotePromptId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    promptRecordId: row.promptRecordId ?? request.promptRecordId ?? null,
    product: (row.product ??
      request.product ??
      null) as RemoteH3JobRecord["product"],
    workflowMode: row.workflowMode as RemoteH3JobRecord["workflowMode"],
    prompt: row.prompt || request.prompt || request.generationBriefText || "",
    generationBrief: request.generationBrief ?? state.generationBrief ?? null,
    generationBriefText: request.generationBriefText ?? null,
    referenceContext: request.referenceContext ?? null,
    promptEngine: state.promptEngine ?? request.promptEngine ?? null,
    systemPromptHash: state.systemPromptHash ?? null,
    lmStudioModelId:
      state.lmStudioModelId ?? request.promptEngine?.model ?? null,
    llmModelId: state.llmModelId ?? promptEngine?.model ?? null,
    llmModel: state.llmModel ?? promptEngine?.model ?? null,
    llmTemperature: state.llmTemperature ?? promptEngine?.temperature ?? null,
    llmTimeoutSeconds:
      state.llmTimeoutSeconds ?? promptEngine?.timeoutSeconds ?? null,
    llmRepairAttempts:
      state.llmRepairAttempts ?? promptEngine?.repairAttempts ?? null,
    llmDisableThinking:
      state.llmDisableThinking ?? promptEngine?.disableThinking ?? null,
    repairAttemptsConfigured:
      state.repairAttemptsConfigured ??
      state.llmRepairAttempts ??
      promptEngine?.repairAttempts ??
      null,
    repairAttemptsUsed: state.repairAttemptsUsed ?? null,
    enhancementManifest: state.enhancementManifest ?? null,
    rewriteDiagnostics: state.rewriteDiagnostics ?? null,
    finalEnhancedPrompt: state.finalEnhancedPrompt ?? null,
    validationReport: state.validationReport ?? null,
    promptCaptureSource: state.promptCaptureSource ?? null,
    validationCaptureSource: state.validationCaptureSource ?? null,
    referenceMap:
      state.referenceMap ?? request.generationBrief?.references ?? [],
    mediaManifest:
      state.mediaManifest ??
      request.mediaManifest ??
      request.generationBrief?.mediaManifest ??
      null,
    allowedReferenceLabels:
      state.allowedReferenceLabels ??
      request.allowedReferenceLabels ??
      request.generationBrief?.allowedReferenceLabels ??
      null,
    physicalReferenceMap: state.physicalReferenceMap ?? [],
    timings: state.stageTimings ?? {},
    pipelineStage: state.pipelineStage ?? null,
    llmUnloadRequested: state.llmUnloadRequested ?? null,
    llmUnloadSucceeded: state.llmUnloadSucceeded ?? null,
    llmUnloadError: state.llmUnloadError ?? null,
    llmInstanceId: state.llmInstanceId ?? null,
    llmUnloadDurationMs: state.llmUnloadDurationMs ?? null,
    h3VramReleaseRequested: state.h3VramReleaseRequested,
    h3VramReleaseSucceeded: state.h3VramReleaseSucceeded,
    h3VramReleaseDurationMs: state.h3VramReleaseDurationMs,
    h3VramReleaseError: state.h3VramReleaseError,
    h3VramBeforeRelease: state.h3VramBeforeRelease,
    h3VramAfterRelease: state.h3VramAfterRelease,
    request,
    workflowSettings: request.workflowSettings,
    localSourceReferencePath:
      row.localSourceReferencePath ?? request.productReferencePath ?? null,
    remoteUploadedFilename:
      row.remoteUploadedFilename ?? state.remoteUploadedFilename,
    outputMetadata,
    localDownloadedPath: row.localDownloadedPath ?? state.localResultPath,
    status: row.status as RemoteH3JobRecord["status"],
    state,
  };
};

const storedSlideCount = (value: RequestedSlideCount | null): string | null =>
  value === null ? null : String(value);

export async function loadSqlite(): Promise<SqlJsStatic> {
  const wasmPath = localRequire.resolve("sql.js/dist/sql-wasm.wasm");
  return initSqlJs({ locateFile: () => wasmPath });
}

export class HistoryDatabase {
  private readonly database: Database;

  constructor(
    private readonly path: string,
    SQL: SqlJsStatic,
  ) {
    this.database = existsSync(path)
      ? new SQL.Database(readFileSync(path))
      : new SQL.Database();
    this.database.run(`
      CREATE TABLE IF NOT EXISTS auto_h3_sessions (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auto_h3_jobs (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS china_auto_session_mirror (
        sessionId TEXT PRIMARY KEY,
        lastKnownRevision INTEGER NOT NULL,
        bundleHash TEXT NOT NULL,
        runnerVersion TEXT NOT NULL,
        connectionState TEXT NOT NULL CHECK(connectionState IN ('connected','disconnected')),
        lastSuccessfulSync TEXT,
        settingsVersionIdentity TEXT NOT NULL DEFAULT '',
        stagingState TEXT NOT NULL DEFAULT 'STAGED_READY',
        createdTimestamp TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS creative_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        product TEXT NOT NULL,
        workflowMode TEXT NOT NULL DEFAULT 'EXPLORE_IDEAS' CHECK(workflowMode IN ('DIRECT_IMAGE','EXPLORE_IDEAS')),
        postStructure TEXT NOT NULL DEFAULT 'SINGLE_IMAGE' CHECK(postStructure IN ('SINGLE_IMAGE','CAROUSEL')),
        requestedSlideCount TEXT DEFAULT NULL CHECK(requestedSlideCount IS NULL OR requestedSlideCount IN ('AUTO','3','4','5','6','7','8')),
        captionMode TEXT NOT NULL DEFAULT 'STANDARD' CHECK(captionMode IN ('SHORT','STANDARD','DETAILED','NONE')),
        postType TEXT NOT NULL,
        topic TEXT NOT NULL,
        visualStyle TEXT NOT NULL,
        creativityLevel TEXT NOT NULL,
        format TEXT NOT NULL,
        language TEXT NOT NULL,
        preparedBrief TEXT NOT NULL,
        conceptTitle TEXT,
        headline TEXT,
        status TEXT NOT NULL CHECK(status IN ('Prepared','Used','Rejected','Archived')),
        notes TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_history_created_at ON creative_history(createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_history_status_product ON creative_history(status, product);
      CREATE TABLE IF NOT EXISTS h3_prompt_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        product TEXT NOT NULL,
        contentType TEXT NOT NULL DEFAULT 'Cinematic Product Ad',
        briefJson TEXT NOT NULL,
        conceptJson TEXT,
        resolvedMode TEXT NOT NULL CHECK(resolvedMode IN ('T2VA','I2VA','FL2VA','L2VA','REF2VA')),
        referencePlanJson TEXT NOT NULL,
        timelineJson TEXT NOT NULL,
        chatGptRequest TEXT NOT NULL DEFAULT '',
        recommendedSettingsJson TEXT,
        prompt TEXT NOT NULL,
        generationJobId TEXT,
        generationStatus TEXT NOT NULL DEFAULT 'planned',
        creativeSeed INTEGER,
        creativeGenomeJson TEXT,
        creativeFingerprintJson TEXT,
        conceptSummary TEXT,
        noveltyScore REAL,
        repetitionPenaltySourcesJson TEXT,
        diversityFallbackUsed INTEGER,
        diversityFallbackReason TEXT,
        rerollsUsed INTEGER,
        noveltyThresholdMissed INTEGER,
        creativeDiversityDiagnosticsJson TEXT,
        generationBriefJson TEXT,
        generationBriefText TEXT,
        referenceContext TEXT,
        promptEngineJson TEXT,
        systemPromptHash TEXT,
        lmStudioModelId TEXT,
        llmModelId TEXT,
        temperature REAL,
        llmModel TEXT,
        llmTemperature REAL,
        llmMaxTokens INTEGER,
        llmTimeoutSeconds INTEGER,
        llmRepairAttempts INTEGER,
        llmDisableThinking INTEGER,
        repairAttemptsConfigured INTEGER,
        repairAttemptsUsed INTEGER,
        enhancementManifest TEXT,
        rewriteDiagnostics TEXT,
        finalEnhancedPrompt TEXT,
        validationReport TEXT,
        promptCaptureSource TEXT,
        validationCaptureSource TEXT,
        referenceMapJson TEXT,
        timingsJson TEXT,
        remotePromptId TEXT,
        outputPath TEXT,
        pipelineStage TEXT,
        llmUnloadRequested INTEGER,
        llmUnloadSucceeded INTEGER,
        llmUnloadError TEXT,
        llmInstanceId TEXT,
        llmUnloadDurationMs INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_h3_prompt_created_at ON h3_prompt_history(createdAt DESC);
      CREATE TABLE IF NOT EXISTS remote_h3_jobs (
        /* jobId remains the physical primary key for migrations and equals localJobId. */
        jobId TEXT PRIMARY KEY,
        localJobId TEXT,
        remotePromptId TEXT,
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
      CREATE INDEX IF NOT EXISTS idx_remote_h3_jobs_updated_at ON remote_h3_jobs(updatedAt DESC);
    `);
    const chinaMirrorColumns = this.query<{ name: string }>('PRAGMA table_info(china_auto_session_mirror)');
    if (!chinaMirrorColumns.some(column => column.name === 'settingsVersionIdentity')) this.database.run("ALTER TABLE china_auto_session_mirror ADD COLUMN settingsVersionIdentity TEXT NOT NULL DEFAULT ''");
    if (!chinaMirrorColumns.some(column => column.name === 'stagingState')) this.database.run("ALTER TABLE china_auto_session_mirror ADD COLUMN stagingState TEXT NOT NULL DEFAULT 'STAGED_READY'");
    if (!chinaMirrorColumns.some(column => column.name === 'createdTimestamp')) this.database.run("ALTER TABLE china_auto_session_mirror ADD COLUMN createdTimestamp TEXT NOT NULL DEFAULT ''");
    const columns = this.query<{ name: string }>(
      "PRAGMA table_info(creative_history)",
    );
    if (!columns.some((column) => column.name === "workflowMode")) {
      this.database.run(
        "ALTER TABLE creative_history ADD COLUMN workflowMode TEXT NOT NULL DEFAULT 'EXPLORE_IDEAS'",
      );
    }
    if (!columns.some((column) => column.name === "postStructure")) {
      this.database.run(
        "ALTER TABLE creative_history ADD COLUMN postStructure TEXT NOT NULL DEFAULT 'SINGLE_IMAGE'",
      );
    }
    if (!columns.some((column) => column.name === "requestedSlideCount")) {
      this.database.run(
        "ALTER TABLE creative_history ADD COLUMN requestedSlideCount TEXT DEFAULT NULL",
      );
    }
    if (!columns.some((column) => column.name === "captionMode")) {
      this.database.run(
        "ALTER TABLE creative_history ADD COLUMN captionMode TEXT NOT NULL DEFAULT 'STANDARD'",
      );
    }
    const h3Columns = this.query<{ name: string }>(
      "PRAGMA table_info(h3_prompt_history)",
    );
    if (!h3Columns.some((column) => column.name === "contentType")) {
      this.database.run(
        "ALTER TABLE h3_prompt_history ADD COLUMN contentType TEXT NOT NULL DEFAULT 'Cinematic Product Ad'",
      );
    }
    if (!h3Columns.some((column) => column.name === "chatGptRequest")) {
      this.database.run(
        "ALTER TABLE h3_prompt_history ADD COLUMN chatGptRequest TEXT NOT NULL DEFAULT ''",
      );
    }
    if (
      !h3Columns.some((column) => column.name === "recommendedSettingsJson")
    ) {
      this.database.run(
        "ALTER TABLE h3_prompt_history ADD COLUMN recommendedSettingsJson TEXT",
      );
    }
    if (!h3Columns.some((column) => column.name === "generationJobId")) {
      this.database.run(
        "ALTER TABLE h3_prompt_history ADD COLUMN generationJobId TEXT",
      );
    }
    if (!h3Columns.some((column) => column.name === "generationStatus")) {
      this.database.run(
        "ALTER TABLE h3_prompt_history ADD COLUMN generationStatus TEXT NOT NULL DEFAULT 'planned'",
      );
    }
    if (!h3Columns.some((column) => column.name === "creativeSeed")) {
      this.database.run(
        "ALTER TABLE h3_prompt_history ADD COLUMN creativeSeed INTEGER",
      );
    }
    if (!h3Columns.some((column) => column.name === "creativeGenomeJson")) {
      this.database.run(
        "ALTER TABLE h3_prompt_history ADD COLUMN creativeGenomeJson TEXT",
      );
    }
    if (
      !h3Columns.some((column) => column.name === "creativeFingerprintJson")
    ) {
      this.database.run(
        "ALTER TABLE h3_prompt_history ADD COLUMN creativeFingerprintJson TEXT",
      );
    }
    if (!h3Columns.some((column) => column.name === "conceptSummary")) {
      this.database.run(
        "ALTER TABLE h3_prompt_history ADD COLUMN conceptSummary TEXT",
      );
    }
    if (!h3Columns.some((column) => column.name === "noveltyScore")) {
      this.database.run(
        "ALTER TABLE h3_prompt_history ADD COLUMN noveltyScore REAL",
      );
    }
    if (
      !h3Columns.some(
        (column) => column.name === "repetitionPenaltySourcesJson",
      )
    ) {
      this.database.run(
        "ALTER TABLE h3_prompt_history ADD COLUMN repetitionPenaltySourcesJson TEXT",
      );
    }
    const h3Additions: Array<[string, string]> = [
      ["diversityFallbackUsed", "INTEGER"],
      ["diversityFallbackReason", "TEXT"],
      ["rerollsUsed", "INTEGER"],
      ["noveltyThresholdMissed", "INTEGER"],
      ["creativeDiversityDiagnosticsJson", "TEXT"],
      ["generationBriefJson", "TEXT"],
      ["generationBriefText", "TEXT"],
      ["referenceContext", "TEXT"],
      ["promptEngineJson", "TEXT"],
      ["systemPromptHash", "TEXT"],
      ["lmStudioModelId", "TEXT"],
      ["llmModelId", "TEXT"],
      ["temperature", "REAL"],
      ["llmModel", "TEXT"],
      ["llmTemperature", "REAL"],
      ["llmMaxTokens", "INTEGER"],
      ["llmTimeoutSeconds", "INTEGER"],
      ["llmRepairAttempts", "INTEGER"],
      ["llmDisableThinking", "INTEGER"],
      ["repairAttemptsConfigured", "INTEGER"],
      ["repairAttemptsUsed", "INTEGER"],
      ["enhancementManifest", "TEXT"],
      ["rewriteDiagnostics", "TEXT"],
      ["finalEnhancedPrompt", "TEXT"],
      ["validationReport", "TEXT"],
      ["promptCaptureSource", "TEXT"],
      ["validationCaptureSource", "TEXT"],
      ["referenceMapJson", "TEXT"],
      ["timingsJson", "TEXT"],
      ["remotePromptId", "TEXT"],
      ["outputPath", "TEXT"],
      ["pipelineStage", "TEXT"],
      ["llmUnloadRequested", "INTEGER"],
      ["llmUnloadSucceeded", "INTEGER"],
      ["llmUnloadError", "TEXT"],
      ["llmInstanceId", "TEXT"],
      ["llmUnloadDurationMs", "INTEGER"],
    ];
    for (const [name, definition] of h3Additions) {
      if (!h3Columns.some((column) => column.name === name))
        this.database.run(
          `ALTER TABLE h3_prompt_history ADD COLUMN ${name} ${definition}`,
        );
    }
    const remoteH3Columns = this.query<{ name: string }>(
      "PRAGMA table_info(remote_h3_jobs)",
    );
    if (!remoteH3Columns.some((column) => column.name === "localJobId")) {
      this.database.run(
        "ALTER TABLE remote_h3_jobs ADD COLUMN localJobId TEXT",
      );
    }
    if (!remoteH3Columns.some((column) => column.name === "remotePromptId")) {
      this.database.run(
        "ALTER TABLE remote_h3_jobs ADD COLUMN remotePromptId TEXT",
      );
    }
    this.database.run(
      "UPDATE remote_h3_jobs SET localJobId = jobId WHERE localJobId IS NULL OR TRIM(localJobId) = ''",
    );
    this.persist();
  }

  getSchemaVersion(): number {
    const rows = this.database.exec('PRAGMA user_version');
    return Number(rows[0]?.values[0]?.[0] ?? 0);
  }

  listAutoSessions(): AutoH3Session[] {
    return this.query<{ json: string }>("SELECT json FROM auto_h3_sessions ORDER BY rowid DESC").map(row => JSON.parse(row.json) as AutoH3Session);
  }

  listAutoJobs(): AutoH3Job[] {
    return this.query<{ json: string }>("SELECT json FROM auto_h3_jobs ORDER BY rowid DESC").map(row => JSON.parse(row.json) as AutoH3Job);
  }

  saveAuto(session: AutoH3Session, job?: AutoH3Job): void {
    this.database.run('BEGIN');
    try {
      this.database.run('INSERT OR REPLACE INTO auto_h3_sessions (id,json) VALUES (?,?)', [session.sessionId, JSON.stringify(session)]);
      if (job) this.database.run('INSERT OR REPLACE INTO auto_h3_jobs (id,json) VALUES (?,?)', [job.autoJobId, JSON.stringify(job)]);
      this.database.run('COMMIT');
    } catch (error) { this.database.run('ROLLBACK'); throw error; }
    this.persist();
  }

  saveChinaAutoMirror(mirror: ChinaAutoSessionMirror): void {
    this.database.run(`INSERT OR REPLACE INTO china_auto_session_mirror
      (sessionId,lastKnownRevision,bundleHash,runnerVersion,connectionState,lastSuccessfulSync,settingsVersionIdentity,stagingState,createdTimestamp)
      VALUES (?,?,?,?,?,?,?,?,?)`, [mirror.sessionId, mirror.lastKnownRevision, mirror.bundleHash, mirror.runnerVersion, mirror.connectionState, mirror.lastSuccessfulSync, mirror.settingsVersionIdentity, mirror.stagingState, mirror.createdTimestamp]);
    this.persist();
  }

  getChinaAutoMirror(sessionId: string): ChinaAutoSessionMirror | null {
    return this.query<ChinaAutoSessionMirror>('SELECT sessionId,lastKnownRevision,bundleHash,runnerVersion,connectionState,lastSuccessfulSync,settingsVersionIdentity,stagingState,createdTimestamp FROM china_auto_session_mirror WHERE sessionId=?', [sessionId])[0] ?? null;
  }

  getLatestChinaAutoDraft(): ChinaAutoSessionMirror | null {
    return this.query<ChinaAutoSessionMirror>('SELECT sessionId,lastKnownRevision,bundleHash,runnerVersion,connectionState,lastSuccessfulSync,settingsVersionIdentity,stagingState,createdTimestamp FROM china_auto_session_mirror ORDER BY createdTimestamp DESC, rowid DESC LIMIT 1')[0] ?? null;
  }

  private query<T>(
    sql: string,
    params: Array<string | number | null> = [],
  ): T[] {
    const statement = this.database.prepare(sql);
    try {
      statement.bind(params);
      const rows: T[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as T);
      return rows;
    } finally {
      statement.free();
    }
  }

  private persist(): void {
    writeFileSync(`${this.path}.tmp`, Buffer.from(this.database.export()), { flush: true });
    renameSync(`${this.path}.tmp`, this.path);
  }

  list(limit = 100): HistoryRecord[] {
    return this.query<StoredHistoryRecord>(
      "SELECT * FROM creative_history ORDER BY datetime(createdAt) DESC LIMIT ?",
      [limit],
    ).map(normalizeHistoryRecord);
  }

  create(input: HistoryInput): HistoryRecord {
    this.database.run(
      `
      INSERT INTO creative_history (product, workflowMode, postStructure, requestedSlideCount, captionMode, postType, topic, visualStyle, creativityLevel, format, language, preparedBrief, conceptTitle, headline, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        input.product,
        input.workflowMode,
        input.postStructure,
        storedSlideCount(input.requestedSlideCount),
        input.captionMode,
        input.postType,
        input.topic,
        input.visualStyle,
        input.creativityLevel,
        input.format,
        input.language,
        input.preparedBrief,
        input.conceptTitle,
        input.headline,
        input.status,
        input.notes,
      ],
    );
    const id = this.query<{ id: number }>("SELECT last_insert_rowid() AS id")[0]
      .id;
    this.persist();
    return normalizeHistoryRecord(
      this.query<StoredHistoryRecord>(
        "SELECT * FROM creative_history WHERE id = ?",
        [id],
      )[0],
    );
  }

  update(id: number, update: HistoryUpdate): HistoryRecord {
    const existingRow = this.query<StoredHistoryRecord>(
      "SELECT * FROM creative_history WHERE id = ?",
      [id],
    )[0];
    if (!existingRow) throw new Error("History record not found");
    const existing = normalizeHistoryRecord(existingRow);
    const merged = { ...existing, ...update };
    this.database.run(
      "UPDATE creative_history SET status=?, conceptTitle=?, headline=?, notes=? WHERE id=?",
      [merged.status, merged.conceptTitle, merged.headline, merged.notes, id],
    );
    this.persist();
    return normalizeHistoryRecord(
      this.query<StoredHistoryRecord>(
        "SELECT * FROM creative_history WHERE id = ?",
        [id],
      )[0],
    );
  }

  listH3(limit = 100): H3PromptRecord[] {
    return this.query<StoredH3PromptRecord>(
      "SELECT * FROM h3_prompt_history ORDER BY datetime(createdAt) DESC LIMIT ?",
      [limit],
    ).map(normalizeH3PromptRecord);
  }

  listRemoteH3Jobs(limit = 100): RemoteH3JobRecord[] {
    return this.query<StoredRemoteH3JobRecord>(
      "SELECT * FROM remote_h3_jobs ORDER BY datetime(updatedAt) DESC LIMIT ?",
      [limit],
    ).map(normalizeRemoteH3JobRecord);
  }

  upsertRemoteH3Job(record: RemoteH3JobRecord): RemoteH3JobRecord {
    this.database.run(
      `
      INSERT INTO remote_h3_jobs (jobId, localJobId, remotePromptId, createdAt, updatedAt, promptRecordId, product, workflowMode, prompt, requestJson, localSourceReferencePath, remoteUploadedFilename, outputMetadataJson, localDownloadedPath, status, stateJson)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(jobId) DO UPDATE SET
        localJobId=excluded.localJobId,
        remotePromptId=excluded.remotePromptId,
        updatedAt=excluded.updatedAt,
        promptRecordId=excluded.promptRecordId,
        product=excluded.product,
        workflowMode=excluded.workflowMode,
        prompt=excluded.prompt,
        requestJson=excluded.requestJson,
        localSourceReferencePath=excluded.localSourceReferencePath,
        remoteUploadedFilename=excluded.remoteUploadedFilename,
        outputMetadataJson=excluded.outputMetadataJson,
        localDownloadedPath=excluded.localDownloadedPath,
        status=excluded.status,
        stateJson=excluded.stateJson
    `,
      [
        record.localJobId,
        record.localJobId,
        record.remotePromptId,
        record.createdAt,
        record.updatedAt,
        record.promptRecordId,
        record.product,
        record.workflowMode,
        record.prompt,
        JSON.stringify(record.request),
        record.localSourceReferencePath,
        record.remoteUploadedFilename,
        JSON.stringify(record.outputMetadata),
        record.localDownloadedPath,
        record.status,
        JSON.stringify(record.state),
      ],
    );
    this.persist();
    return normalizeRemoteH3JobRecord(
      this.query<StoredRemoteH3JobRecord>(
        "SELECT * FROM remote_h3_jobs WHERE jobId = ?",
        [record.localJobId],
      )[0],
    );
  }

  createH3(input: H3PromptInput): H3PromptRecord {
    const contentType =
      input.contentType ?? input.brief.contentType ?? "Cinematic Product Ad";
    const creativeGenome =
      input.creativeGenome ?? input.brief.creativeGenome ?? null;
    const creativeSeed = input.creativeSeed ?? input.brief.creativeSeed ?? null;
    const brief = normalizeH3Brief({
      ...input.brief,
      contentType,
      creativeGenome,
      creativeSeed: creativeSeed ?? undefined,
    });
    const generationJobId =
      input.generationJobId?.trim() ||
      `h3-generation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const generationStatus = input.generationStatus ?? "planned";
    const conceptSummary =
      input.conceptSummary ?? input.concept?.description ?? null;
    const llmModel = input.llmModel ?? input.promptEngine?.model ?? null;
    const llmTemperature =
      input.llmTemperature ?? input.promptEngine?.temperature ?? null;
    const llmTimeoutSeconds =
      input.llmTimeoutSeconds ?? input.promptEngine?.timeoutSeconds ?? null;
    const llmRepairAttempts =
      input.llmRepairAttempts ?? input.promptEngine?.repairAttempts ?? null;
    const repairAttemptsConfigured =
      input.repairAttemptsConfigured ?? llmRepairAttempts;
    const llmModelId =
      input.llmModelId ??
      input.llmModel ??
      input.lmStudioModelId ??
      input.promptEngine?.model ??
      null;
    const llmDisableThinking =
      input.llmDisableThinking ?? input.promptEngine?.disableThinking ?? null;
    const optionalJson = (value: unknown): string | null =>
      value === null || value === undefined ? null : JSON.stringify(value);
    this.database.run(
      `
      INSERT INTO h3_prompt_history (product, contentType, briefJson, conceptJson, resolvedMode, referencePlanJson, timelineJson, chatGptRequest, recommendedSettingsJson, prompt, generationJobId, generationStatus, creativeSeed, creativeGenomeJson, creativeFingerprintJson, conceptSummary, noveltyScore, repetitionPenaltySourcesJson, diversityFallbackUsed, diversityFallbackReason, rerollsUsed, noveltyThresholdMissed, creativeDiversityDiagnosticsJson, generationBriefJson, generationBriefText, referenceContext, promptEngineJson, systemPromptHash, lmStudioModelId, llmModelId, temperature, llmModel, llmTemperature, llmMaxTokens, llmTimeoutSeconds, llmRepairAttempts, repairAttemptsConfigured, llmDisableThinking, repairAttemptsUsed, enhancementManifest, rewriteDiagnostics, finalEnhancedPrompt, validationReport, promptCaptureSource, validationCaptureSource, referenceMapJson, timingsJson, remotePromptId, outputPath, pipelineStage, llmUnloadRequested, llmUnloadSucceeded, llmUnloadError, llmInstanceId, llmUnloadDurationMs)
      VALUES (${Array(55).fill("?").join(", ")})
    `,
      [
        input.product,
        contentType,
        JSON.stringify(brief),
        input.concept ? JSON.stringify(input.concept) : null,
        input.resolvedMode,
        JSON.stringify(input.referencePlan),
        JSON.stringify(input.timeline),
        input.chatGptRequest ?? "",
        input.recommendedSettings
          ? JSON.stringify(input.recommendedSettings)
          : null,
        input.prompt,
        generationJobId,
        generationStatus,
        creativeSeed,
        creativeGenome ? JSON.stringify(creativeGenome) : null,
        input.creativeFingerprint
          ? JSON.stringify(input.creativeFingerprint)
          : null,
        conceptSummary,
        input.noveltyScore ?? null,
        input.repetitionPenaltySources
          ? JSON.stringify(input.repetitionPenaltySources)
          : null,
        input.diversityFallbackUsed === undefined ||
        input.diversityFallbackUsed === null
          ? null
          : input.diversityFallbackUsed
            ? 1
            : 0,
        input.diversityFallbackReason ?? null,
        input.rerollsUsed ?? null,
        input.noveltyThresholdMissed === undefined ||
        input.noveltyThresholdMissed === null
          ? null
          : input.noveltyThresholdMissed
            ? 1
            : 0,
        optionalJson(input.creativeDiversityDiagnostics),
        optionalJson(input.generationBrief),
        input.generationBriefText ?? null,
        input.referenceContext ?? null,
        optionalJson(input.promptEngine),
        input.systemPromptHash ?? null,
        input.lmStudioModelId ?? null,
        llmModelId,
        input.temperature ?? null,
        llmModel,
        llmTemperature,
        null,
        llmTimeoutSeconds,
        llmRepairAttempts,
        repairAttemptsConfigured,
        llmDisableThinking === null ? null : llmDisableThinking ? 1 : 0,
        input.repairAttemptsUsed ?? null,
        input.enhancementManifest ?? null,
        input.rewriteDiagnostics ?? null,
        input.finalEnhancedPrompt ?? null,
        input.validationReport ?? null,
        input.promptCaptureSource ?? null,
        input.validationCaptureSource ?? null,
        optionalJson(input.referenceMap),
        optionalJson(input.timings),
        input.remotePromptId ?? null,
        input.outputPath ?? null,
        input.pipelineStage ?? null,
        input.llmUnloadRequested === undefined ||
        input.llmUnloadRequested === null
          ? null
          : input.llmUnloadRequested
            ? 1
            : 0,
        input.llmUnloadSucceeded === undefined ||
        input.llmUnloadSucceeded === null
          ? null
          : input.llmUnloadSucceeded
            ? 1
            : 0,
        input.llmUnloadError ?? null,
        input.llmInstanceId ?? null,
        input.llmUnloadDurationMs ?? null,
      ],
    );
    const id = this.query<{ id: number }>("SELECT last_insert_rowid() AS id")[0]
      .id;
    this.persist();
    return normalizeH3PromptRecord(
      this.query<StoredH3PromptRecord>(
        "SELECT * FROM h3_prompt_history WHERE id = ?",
        [id],
      )[0],
    );
  }

  updateH3(id: number, update: H3PromptUpdate): H3PromptRecord {
    const existingRow = this.query<StoredH3PromptRecord>(
      "SELECT * FROM h3_prompt_history WHERE id = ?",
      [id],
    )[0];
    if (!existingRow) throw new Error("H3 prompt record not found");
    const existing = normalizeH3PromptRecord(existingRow);
    const creativeGenome =
      update.creativeGenome === undefined
        ? (existing.creativeGenome ?? existing.brief.creativeGenome ?? null)
        : update.creativeGenome;
    const creativeSeed =
      update.creativeSeed === undefined
        ? (existing.creativeSeed ?? existing.brief.creativeSeed ?? null)
        : update.creativeSeed;
    const mergedBrief = normalizeH3Brief({
      ...(update.brief ?? existing.brief),
      contentType:
        update.contentType ?? update.brief?.contentType ?? existing.contentType,
      creativeGenome,
      creativeSeed: creativeSeed ?? undefined,
    });
    const merged: H3PromptRecord = {
      ...existing,
      ...update,
      contentType: update.contentType ?? existing.contentType,
      brief: mergedBrief,
      concept: update.concept === undefined ? existing.concept : update.concept,
      resolvedMode: update.resolvedMode ?? existing.resolvedMode,
      referencePlan: update.referencePlan ?? existing.referencePlan,
      timeline: update.timeline ?? existing.timeline,
      chatGptRequest: update.chatGptRequest ?? existing.chatGptRequest,
      recommendedSettings:
        update.recommendedSettings === undefined
          ? existing.recommendedSettings
          : update.recommendedSettings,
      prompt: update.prompt ?? existing.prompt,
      generationJobId:
        update.generationJobId ??
        existing.generationJobId ??
        `h3-generation-${id}`,
      generationStatus:
        update.generationStatus ?? existing.generationStatus ?? "planned",
      creativeSeed,
      creativeGenome,
      creativeFingerprint:
        update.creativeFingerprint === undefined
          ? (existing.creativeFingerprint ?? null)
          : update.creativeFingerprint,
      conceptSummary:
        update.conceptSummary === undefined
          ? (existing.conceptSummary ?? null)
          : update.conceptSummary,
      noveltyScore:
        update.noveltyScore === undefined
          ? (existing.noveltyScore ?? null)
          : update.noveltyScore,
      repetitionPenaltySources:
        update.repetitionPenaltySources === undefined
          ? (existing.repetitionPenaltySources ?? [])
          : update.repetitionPenaltySources,
      diversityFallbackUsed:
        update.diversityFallbackUsed === undefined
          ? (existing.diversityFallbackUsed ?? null)
          : update.diversityFallbackUsed,
      diversityFallbackReason:
        update.diversityFallbackReason === undefined
          ? (existing.diversityFallbackReason ?? null)
          : update.diversityFallbackReason,
      rerollsUsed:
        update.rerollsUsed === undefined
          ? (existing.rerollsUsed ?? null)
          : update.rerollsUsed,
      noveltyThresholdMissed:
        update.noveltyThresholdMissed === undefined
          ? (existing.noveltyThresholdMissed ?? null)
          : update.noveltyThresholdMissed,
      creativeDiversityDiagnostics:
        update.creativeDiversityDiagnostics === undefined
          ? (existing.creativeDiversityDiagnostics ?? null)
          : update.creativeDiversityDiagnostics,
      generationBrief:
        update.generationBrief === undefined
          ? (existing.generationBrief ?? null)
          : update.generationBrief,
      generationBriefText:
        update.generationBriefText === undefined
          ? (existing.generationBriefText ?? null)
          : update.generationBriefText,
      referenceContext:
        update.referenceContext === undefined
          ? (existing.referenceContext ?? null)
          : update.referenceContext,
      promptEngine:
        update.promptEngine === undefined
          ? (existing.promptEngine ?? null)
          : update.promptEngine,
      systemPromptHash:
        update.systemPromptHash === undefined
          ? (existing.systemPromptHash ?? null)
          : update.systemPromptHash,
      lmStudioModelId:
        update.lmStudioModelId === undefined
          ? (existing.lmStudioModelId ?? null)
          : update.lmStudioModelId,
      llmModelId:
        update.llmModelId === undefined
          ? (existing.llmModelId ?? null)
          : update.llmModelId,
      temperature:
        update.temperature === undefined
          ? (existing.temperature ?? null)
          : update.temperature,
      llmModel:
        update.llmModel === undefined
          ? (existing.llmModel ?? null)
          : update.llmModel,
      llmTemperature:
        update.llmTemperature === undefined
          ? (existing.llmTemperature ?? null)
          : update.llmTemperature,
      llmTimeoutSeconds:
        update.llmTimeoutSeconds === undefined
          ? (existing.llmTimeoutSeconds ?? null)
          : update.llmTimeoutSeconds,
      llmRepairAttempts:
        update.llmRepairAttempts === undefined
          ? (existing.llmRepairAttempts ?? null)
          : update.llmRepairAttempts,
      repairAttemptsConfigured:
        update.repairAttemptsConfigured === undefined
          ? (existing.repairAttemptsConfigured ??
            existing.llmRepairAttempts ??
            null)
          : update.repairAttemptsConfigured,
      llmDisableThinking:
        update.llmDisableThinking === undefined
          ? (existing.llmDisableThinking ?? null)
          : update.llmDisableThinking,
      repairAttemptsUsed:
        update.repairAttemptsUsed === undefined
          ? (existing.repairAttemptsUsed ?? null)
          : update.repairAttemptsUsed,
      enhancementManifest:
        update.enhancementManifest === undefined
          ? (existing.enhancementManifest ?? null)
          : update.enhancementManifest,
      rewriteDiagnostics:
        update.rewriteDiagnostics === undefined
          ? (existing.rewriteDiagnostics ?? null)
          : update.rewriteDiagnostics,
      finalEnhancedPrompt:
        update.finalEnhancedPrompt === undefined
          ? (existing.finalEnhancedPrompt ?? null)
          : update.finalEnhancedPrompt,
      validationReport:
        update.validationReport === undefined
          ? (existing.validationReport ?? null)
          : update.validationReport,
      promptCaptureSource:
        update.promptCaptureSource === undefined
          ? (existing.promptCaptureSource ?? null)
          : update.promptCaptureSource,
      validationCaptureSource:
        update.validationCaptureSource === undefined
          ? (existing.validationCaptureSource ?? null)
          : update.validationCaptureSource,
      referenceMap:
        update.referenceMap === undefined
          ? (existing.referenceMap ?? [])
          : update.referenceMap,
      timings:
        update.timings === undefined
          ? (existing.timings ?? null)
          : update.timings,
      remotePromptId:
        update.remotePromptId === undefined
          ? (existing.remotePromptId ?? null)
          : update.remotePromptId,
      outputPath:
        update.outputPath === undefined
          ? (existing.outputPath ?? null)
          : update.outputPath,
      pipelineStage:
        update.pipelineStage === undefined
          ? (existing.pipelineStage ?? null)
          : update.pipelineStage,
      llmUnloadRequested:
        update.llmUnloadRequested === undefined
          ? (existing.llmUnloadRequested ?? null)
          : update.llmUnloadRequested,
      llmUnloadSucceeded:
        update.llmUnloadSucceeded === undefined
          ? (existing.llmUnloadSucceeded ?? null)
          : update.llmUnloadSucceeded,
      llmUnloadError:
        update.llmUnloadError === undefined
          ? (existing.llmUnloadError ?? null)
          : update.llmUnloadError,
      llmInstanceId:
        update.llmInstanceId === undefined
          ? (existing.llmInstanceId ?? null)
          : update.llmInstanceId,
      llmUnloadDurationMs:
        update.llmUnloadDurationMs === undefined
          ? (existing.llmUnloadDurationMs ?? null)
          : update.llmUnloadDurationMs,
    };
    this.database.run(
      `
      UPDATE h3_prompt_history
      SET product=?, contentType=?, briefJson=?, conceptJson=?, resolvedMode=?, referencePlanJson=?, timelineJson=?, chatGptRequest=?, recommendedSettingsJson=?, prompt=?, generationJobId=?, generationStatus=?, creativeSeed=?, creativeGenomeJson=?, creativeFingerprintJson=?, conceptSummary=?, noveltyScore=?, repetitionPenaltySourcesJson=?, diversityFallbackUsed=?, diversityFallbackReason=?, rerollsUsed=?, noveltyThresholdMissed=?, creativeDiversityDiagnosticsJson=?, generationBriefJson=?, generationBriefText=?, referenceContext=?, promptEngineJson=?, systemPromptHash=?, lmStudioModelId=?, llmModelId=?, temperature=?, llmModel=?, llmTemperature=?, llmMaxTokens=?, llmTimeoutSeconds=?, llmRepairAttempts=?, repairAttemptsConfigured=?, llmDisableThinking=?, repairAttemptsUsed=?, enhancementManifest=?, rewriteDiagnostics=?, finalEnhancedPrompt=?, validationReport=?, promptCaptureSource=?, validationCaptureSource=?, referenceMapJson=?, timingsJson=?, remotePromptId=?, outputPath=?, pipelineStage=?, llmUnloadRequested=?, llmUnloadSucceeded=?, llmUnloadError=?, llmInstanceId=?, llmUnloadDurationMs=?
      WHERE id=?
    `,
      [
        merged.product,
        merged.contentType,
        JSON.stringify({ ...merged.brief, contentType: merged.contentType }),
        merged.concept ? JSON.stringify(merged.concept) : null,
        merged.resolvedMode,
        JSON.stringify(merged.referencePlan),
        JSON.stringify(merged.timeline),
        merged.chatGptRequest,
        merged.recommendedSettings
          ? JSON.stringify(merged.recommendedSettings)
          : null,
        merged.prompt,
        merged.generationJobId ?? null,
        merged.generationStatus ?? "planned",
        merged.creativeSeed ?? null,
        merged.creativeGenome ? JSON.stringify(merged.creativeGenome) : null,
        merged.creativeFingerprint
          ? JSON.stringify(merged.creativeFingerprint)
          : null,
        merged.conceptSummary ?? null,
        merged.noveltyScore ?? null,
        merged.repetitionPenaltySources
          ? JSON.stringify(merged.repetitionPenaltySources)
          : null,
        merged.diversityFallbackUsed === undefined ||
        merged.diversityFallbackUsed === null
          ? null
          : merged.diversityFallbackUsed
            ? 1
            : 0,
        merged.diversityFallbackReason ?? null,
        merged.rerollsUsed ?? null,
        merged.noveltyThresholdMissed === undefined ||
        merged.noveltyThresholdMissed === null
          ? null
          : merged.noveltyThresholdMissed
            ? 1
            : 0,
        merged.creativeDiversityDiagnostics
          ? JSON.stringify(merged.creativeDiversityDiagnostics)
          : null,
        merged.generationBrief ? JSON.stringify(merged.generationBrief) : null,
        merged.generationBriefText ?? null,
        merged.referenceContext ?? null,
        merged.promptEngine ? JSON.stringify(merged.promptEngine) : null,
        merged.systemPromptHash ?? null,
        merged.lmStudioModelId ?? null,
        merged.llmModelId ?? null,
        merged.temperature ?? null,
        merged.llmModel ?? null,
        merged.llmTemperature ?? null,
        null,
        merged.llmTimeoutSeconds ?? null,
        merged.llmRepairAttempts ?? null,
        merged.repairAttemptsConfigured ?? null,
        merged.llmDisableThinking === undefined ||
        merged.llmDisableThinking === null
          ? null
          : merged.llmDisableThinking
            ? 1
            : 0,
        merged.repairAttemptsUsed ?? null,
        merged.enhancementManifest ?? null,
        merged.rewriteDiagnostics ?? null,
        merged.finalEnhancedPrompt ?? null,
        merged.validationReport ?? null,
        merged.promptCaptureSource ?? null,
        merged.validationCaptureSource ?? null,
        merged.referenceMap ? JSON.stringify(merged.referenceMap) : null,
        merged.timings ? JSON.stringify(merged.timings) : null,
        merged.remotePromptId ?? null,
        merged.outputPath ?? null,
        merged.pipelineStage ?? null,
        merged.llmUnloadRequested === undefined ||
        merged.llmUnloadRequested === null
          ? null
          : merged.llmUnloadRequested
            ? 1
            : 0,
        merged.llmUnloadSucceeded === undefined ||
        merged.llmUnloadSucceeded === null
          ? null
          : merged.llmUnloadSucceeded
            ? 1
            : 0,
        merged.llmUnloadError ?? null,
        merged.llmInstanceId ?? null,
        merged.llmUnloadDurationMs ?? null,
        id,
      ],
    );
    this.persist();
    return normalizeH3PromptRecord(
      this.query<StoredH3PromptRecord>(
        "SELECT * FROM h3_prompt_history WHERE id = ?",
        [id],
      )[0],
    );
  }

  close(): void {
    this.persist();
    this.database.close();
  }
}
