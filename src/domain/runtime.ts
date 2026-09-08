export const h3LifecycleSchemaVersion = 'authoritative-classifier-v1';

export interface RuntimeDiagnostics {
  runningExecutable: string;
  buildTimestamp: string;
  appVersion: string;
  buildId: string;
  appAsarPath: string;
  appAsarSha256: string;
  userDataDirectory: string;
  activeDatabasePath: string;
  databaseSchemaVersion: number;
  lifecycleSchemaVersion: string;
  currentAutoSessionId: string | null;
  currentAutoJobId: string | null;
  currentComputeJobId: string | null;
  currentComfyPromptId: string | null;
}
