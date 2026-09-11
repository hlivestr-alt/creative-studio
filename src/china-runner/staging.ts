import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { validateMiniMaxH3ApiWorkflowTemplate } from '../domain/minimax-h3-workflow';
import { h3ContentTypeOptions } from '../domain/h3';
import { ChinaRunnerStore, newPersistedSession } from './store';
import { CHINA_RUNNER_VERSION, SESSION_BUNDLE_SCHEMA_VERSION, type ChinaSessionBundle, type SessionAssetBundle, type StageResult } from './types';
import type { LocalComfyClient, LocalLmStudioClient } from './localhost-comfy';

export const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');

export function resolveArchivePath(root: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath) || relativePath.replaceAll('\\', '/').split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw new Error('Invalid archive relative path.');
  const target = resolve(root, relativePath);
  const relation = relative(resolve(root), target);
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) throw new Error('Archive path escapes configured root.');
  return target;
}

export function canonicalBundleHash(bundle: Omit<ChinaSessionBundle, 'bundleSha256'> | ChinaSessionBundle): string {
  const canonical = { ...bundle } as Partial<ChinaSessionBundle>;
  delete canonical.bundleSha256;
  return sha256(JSON.stringify(canonical));
}

export class SessionBundleConflictError extends Error {}

function requireSafeName(value: string, label: string): void {
  if (!value || basename(value) !== value || value.includes('..') || /[\\/:*?"<>|]/.test(value)) throw new Error(`${label} is unsafe.`);
}

function imageDimensions(bytes: Buffer, mimeType: SessionAssetBundle['mimeType']): { width: number; height: number } {
  if (mimeType === 'image/png') {
    if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG image signature.');
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mimeType === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Invalid JPEG image signature.');
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      offset += Math.max(2, length + 2);
    }
    throw new Error('JPEG dimensions could not be decoded.');
  }
  if (bytes.length < 30 || bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') throw new Error('Invalid WebP image signature.');
  const kind = bytes.subarray(12, 16).toString('ascii');
  if (kind === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  throw new Error('Only extended WebP headers are supported for staging verification.');
}

function validateBundle(bundle: ChinaSessionBundle, archiveRoot: string): void {
  if (bundle.schemaVersion !== SESSION_BUNDLE_SCHEMA_VERSION) throw new Error(`Unsupported bundle schema version ${bundle.schemaVersion}.`);
  if (bundle.expectedRunnerVersion !== CHINA_RUNNER_VERSION) throw new Error(`Bundle expects runner ${bundle.expectedRunnerVersion}; installed runner is ${CHINA_RUNNER_VERSION}.`);
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(bundle.sessionId)) throw new Error('Session ID must be a UUID.');
  if (!bundle.selectedProducts.length || !bundle.selectedContentTypes.length) throw new Error('Bundle must select products and content types.');
  if (new Set(bundle.selectedProducts).size !== bundle.selectedProducts.length || new Set(bundle.selectedContentTypes).size !== bundle.selectedContentTypes.length) throw new Error('Bundle selections contain duplicates.');
  if (bundle.selectedContentTypes.some(type => !h3ContentTypeOptions.includes(type))) throw new Error('Bundle contains an unsupported content type.');
  if (bundle.ordering.productOrder.length !== bundle.selectedProducts.length || bundle.ordering.productOrder.some(id => !bundle.selectedProducts.includes(id))) throw new Error('Product order does not match product selection.');
  if (bundle.ordering.contentTypeOrder.length !== bundle.selectedContentTypes.length || bundle.ordering.contentTypeOrder.some(type => !bundle.selectedContentTypes.includes(type))) throw new Error('Content order does not match content selection.');
  if (resolve(bundle.archiveRoot).toLowerCase() !== resolve(archiveRoot).toLowerCase()) throw new Error(`Archive root must be ${archiveRoot}.`);
  if (!/^[0-9a-f]{64}$/.test(bundle.bundleSha256) || canonicalBundleHash(bundle) !== bundle.bundleSha256) throw new Error('Bundle SHA-256 mismatch.');
  if (!bundle.systemPrompt.trim() || sha256(bundle.systemPrompt) !== bundle.systemPromptSha256.toLowerCase()) throw new Error('System prompt hash mismatch.');
  if (sha256(JSON.stringify(bundle.workflow)) !== bundle.workflowSha256.toLowerCase()) throw new Error('Workflow hash mismatch.');
  validateMiniMaxH3ApiWorkflowTemplate(bundle.workflow);
  const products = new Map(bundle.products.map(product => [product.id, product]));
  const assets = new Map(bundle.assets.map(asset => [asset.id, asset]));
  const bindings = new Map(bundle.productReferences.map(binding => [binding.productId, binding.assetIds]));
  for (const id of bundle.selectedProducts) {
    const product = products.get(id);
    if (!product) throw new Error(`Missing product metadata for ${id}.`);
    const requiredPaths = [product.imagePath, ...(product.referenceImagePaths ?? [])].map(path => path.replaceAll('\\', '/').toLowerCase());
    const assetIds = bindings.get(id);
    if (!assetIds?.length) throw new Error(`Missing product asset mapping for ${id}.`);
    const mapped = assetIds.map(assetId => assets.get(assetId) ?? (() => { throw new Error(`Missing product asset ${assetId}.`); })());
    if (mapped.some(asset => asset.productId !== id)) throw new Error(`Product ${id} references an asset owned by another product.`);
    for (const required of requiredPaths) if (!mapped.some(asset => asset.sourcePath.replaceAll('\\', '/').toLowerCase() === required)) throw new Error(`Product ${id} is missing required verified master ${required}.`);
  }
}

function verifyArchiveWritable(archiveRoot: string): void {
  mkdirSync(archiveRoot, { recursive: true });
  const probe = join(archiveRoot, `.proya-shadow-write-${randomUUID()}`);
  writeFileSync(probe, 'shadow-readiness');
  rmSync(probe);
}

export interface StageDependencies {
  store: ChinaRunnerStore;
  stateRoot: string;
  archiveRoot: string;
  comfy: LocalComfyClient;
  lmStudio: LocalLmStudioClient;
}

export async function stageSessionBundle(bundle: ChinaSessionBundle, dependencies: StageDependencies): Promise<StageResult> {
  validateBundle(bundle, dependencies.archiveRoot);
  const existing = dependencies.store.getSession(bundle.sessionId);
  const bundleHash = canonicalBundleHash(bundle);
  if (existing) {
    if (existing.bundleHash !== bundleHash) throw new SessionBundleConflictError('Session ID already exists with a different bundle hash.');
    return { staged: true, sessionId: existing.sessionId, revision: existing.revision, bundleHash, sessionDirectory: existing.sessionDirectory, mode: 'shadow' };
  }

  const [comfy, lmStudio] = await Promise.all([dependencies.comfy.readiness(), dependencies.lmStudio.readiness()]);
  if (!comfy.ready) throw new Error(`ComfyUI unavailable: ${comfy.error}`);
  if (!lmStudio.ready) throw new Error(`LM Studio unavailable: ${lmStudio.error}`);
  verifyArchiveWritable(dependencies.archiveRoot);

  const sessionsRoot = join(dependencies.stateRoot, 'sessions');
  mkdirSync(sessionsRoot, { recursive: true });
  const temporary = join(sessionsRoot, `.stage-${bundle.sessionId}-${randomUUID()}`);
  const destination = join(sessionsRoot, bundle.sessionId);
  mkdirSync(join(temporary, 'assets'), { recursive: true });
  mkdirSync(join(temporary, 'logs'), { recursive: true });
  const assetRows: Array<{ id: string; productId: string; path: string; sha256: string; size: number }> = [];
  try {
    for (const asset of bundle.assets) {
      requireSafeName(asset.id, 'Asset ID');
      requireSafeName(asset.filename, 'Asset filename');
      const bytes = Buffer.from(asset.base64, 'base64');
      if (bytes.length !== asset.size || sha256(bytes) !== asset.sha256.toLowerCase()) throw new Error(`Asset hash or size mismatch for ${asset.id}.`);
      const dimensions = imageDimensions(bytes, asset.mimeType);
      if (dimensions.width <= 0 || dimensions.height <= 0) throw new Error(`Asset ${asset.id} has invalid dimensions.`);
      const path = join(temporary, 'assets', `${asset.id}__${asset.filename}`);
      writeFileSync(path, bytes, { flush: true });
      if (statSync(path).size !== asset.size || sha256(readFileSync(path)) !== asset.sha256.toLowerCase()) throw new Error(`Staged asset verification failed for ${asset.id}.`);
      assetRows.push({ id: asset.id, productId: asset.productId, path: join(destination, 'assets', `${asset.id}__${asset.filename}`), sha256: asset.sha256.toLowerCase(), size: asset.size });
    }
    writeFileSync(join(temporary, 'manifest.json'), JSON.stringify({ ...bundle, assets: bundle.assets.map(asset => ({ id: asset.id, productId: asset.productId, sourcePath: asset.sourcePath, filename: asset.filename, mimeType: asset.mimeType, size: asset.size, sha256: asset.sha256 })), bundleHash }, null, 2), { flush: true });
    writeFileSync(join(temporary, 'workflow.json'), JSON.stringify(bundle.workflow, null, 2), { flush: true });
    writeFileSync(join(temporary, 'system-prompt.md'), bundle.systemPrompt, { flush: true });
    renameSync(temporary, destination);
    const session = dependencies.store.stageSession(newPersistedSession(bundle, bundleHash, destination), assetRows);
    return { staged: true, sessionId: session.sessionId, revision: session.revision, bundleHash, sessionDirectory: destination, mode: 'shadow' };
  } catch (reason) {
    rmSync(temporary, { recursive: true, force: true });
    if (!dependencies.store.getSession(bundle.sessionId)) rmSync(destination, { recursive: true, force: true });
    throw reason;
  }
}
