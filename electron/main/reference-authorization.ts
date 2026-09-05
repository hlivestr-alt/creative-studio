import { realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';

export const maxLocalReferenceUploadBytes = 25 * 1024 * 1024;

const supportedReferenceExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export type ReferenceSessionId = number | string;

function sessionKey(sessionId: ReferenceSessionId): string {
  return String(sessionId);
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'Unknown file-system error';
}

function resolveSelectedFile(sourcePath: string): string {
  if (!sourcePath.trim() || !isAbsolute(sourcePath)) throw new Error('Reference selection must provide an absolute local file path.');
  try {
    return realpathSync(sourcePath);
  } catch (reason) {
    throw new Error(`Reference selection could not find ${sourcePath}: ${errorMessage(reason)}`, { cause: reason });
  }
}

function validateSelectedFile(sourcePath: string): string {
  const resolvedPath = resolveSelectedFile(sourcePath);
  let fileInfo;
  try {
    fileInfo = statSync(resolvedPath);
  } catch (reason) {
    throw new Error(`Reference selection could not inspect ${resolvedPath}: ${errorMessage(reason)}`, { cause: reason });
  }
  if (!fileInfo.isFile()) throw new Error('Reference selection requires a regular image file.');
  if (fileInfo.size <= 0) throw new Error('Reference selection rejected an empty image file.');
  if (fileInfo.size > maxLocalReferenceUploadBytes) throw new Error('Reference selection is too large. The maximum is 25 MiB.');
  if (!supportedReferenceExtensions.has(extname(resolvedPath).toLowerCase())) throw new Error('Reference selection rejected: only PNG, JPEG, and WebP images are supported.');
  return resolvedPath;
}

/**
 * Main-process authorization for the one explicitly selected Product Reference
 * associated with a renderer session. The value is an exact canonical file,
 * never a directory or a parent-folder grant.
 */
export class ExplicitReferenceAuthorizationStore {
  private readonly selectedFiles = new Map<string, string>();

  authorize(sessionId: ReferenceSessionId, sourcePath: string): string {
    const resolvedPath = validateSelectedFile(sourcePath);
    this.selectedFiles.set(sessionKey(sessionId), resolvedPath);
    return resolvedPath;
  }

  clear(sessionId: ReferenceSessionId): void {
    this.selectedFiles.delete(sessionKey(sessionId));
  }

  /**
   * Returns the trusted canonical path only when the request matches the
   * currently selected exact file. A null result means no explicit selection
   * exists, so the provider may apply its configured-root policy instead.
   */
  getAuthorizedPath(sessionId: ReferenceSessionId, sourcePath: string): string | null {
    const selectedPath = this.selectedFiles.get(sessionKey(sessionId));
    if (!selectedPath) return null;
    if (!sourcePath.trim() || !isAbsolute(sourcePath)) throw new Error('Reference upload was blocked because the source file was not the explicitly selected file.');

    let candidatePath: string;
    try {
      candidatePath = realpathSync(sourcePath);
    } catch {
      // Let the existing provider produce its normal missing-file error when
      // the selected file was deleted after the user chose it.
      candidatePath = resolve(sourcePath);
    }
    if (!samePath(candidatePath, selectedPath)) throw new Error('Reference upload was blocked because the source file was not the explicitly selected file.');
    return selectedPath;
  }
}
