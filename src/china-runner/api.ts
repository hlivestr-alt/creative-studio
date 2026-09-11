import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ChinaAutoRunner } from './runner';
import type { ChinaSessionBundle } from './types';
import { SessionBundleConflictError } from './staging';

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage, maximumBytes = 128 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBytes) throw new Error('Request body exceeds the staging limit.');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function createRunnerApi(runner: ChinaAutoRunner): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${runner.address}:${runner.port}`);
      const method = request.method ?? 'GET';
      if (method === 'GET' && url.pathname === '/proya/auto/capabilities') return json(response, 200, runner.capabilities());
      if (method === 'GET' && url.pathname === '/proya/auto/version') return json(response, 200, { version: runner.capabilities().runnerVersion, mode: runner.mode });
      if (method === 'GET' && url.pathname === '/proya/auto/health') return json(response, 200, await runner.health());
      if (method === 'GET' && url.pathname === '/proya/auto/session/current') return json(response, 200, { session: runner.currentSession() });
      const sessionMatch = method === 'GET' ? url.pathname.match(/^\/proya\/auto\/session\/([0-9a-f-]+)$/i) : null;
      if (sessionMatch) {
        const session = runner.session(sessionMatch[1]);
        return json(response, session ? 200 : 404, { session, persistence: session ? runner.stagingPersistence(sessionMatch[1]) : null });
      }
      if (method === 'GET' && url.pathname === '/proya/auto/jobs') {
        const afterRevision = Number(url.searchParams.get('afterRevision') ?? 0);
        return json(response, 200, { jobs: runner.jobs(url.searchParams.get('sessionId') ?? undefined, Number.isSafeInteger(afterRevision) ? afterRevision : 0) });
      }
      if (method === 'POST' && url.pathname === '/proya/auto/stage') return json(response, 201, await runner.stage(await body(request) as ChinaSessionBundle));
      if (method === 'POST' && url.pathname === '/proya/auto/start') {
        if (runner.mode === 'shadow') return json(response, 405, { error: 'Canary Start is disabled in shadow mode.' });
        const input = await body(request) as { sessionId?: unknown; bundleHash?: unknown };
        if (typeof input.sessionId !== 'string' || typeof input.bundleHash !== 'string') return json(response, 400, { error: 'Start requires sessionId and bundleHash.' });
        return json(response, 202, await runner.startCanary(input.sessionId, input.bundleHash));
      }
      const settingsMatch = method === 'POST' ? url.pathname.match(/^\/proya\/auto\/session\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\/settings$/i) : null;
      if (settingsMatch) {
        const input = await body(request) as { version?: unknown; settings?: unknown };
        if (!Number.isSafeInteger(input.version) || Number(input.version) < 1 || !input.settings || typeof input.settings !== 'object') return json(response, 400, { error: 'Settings update requires a positive integer version and settings object.' });
        return json(response, 200, { session: runner.updateSettings(settingsMatch[1], Number(input.version), input.settings as never) });
      }
      const stopAfterMatch = method === 'POST' ? url.pathname.match(/^\/proya\/auto\/session\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\/stop-after-current$/i) : null;
      if (stopAfterMatch) return json(response, 202, { session: runner.requestStopAfterCurrent(stopAfterMatch[1]) });
      const stopNowMatch = method === 'POST' ? url.pathname.match(/^\/proya\/auto\/session\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\/stop-now$/i) : null;
      if (stopNowMatch) return json(response, 202, { session: runner.requestStopNow(stopNowMatch[1]) });
      const syncMatch = method === 'POST' ? url.pathname.match(/^\/proya\/auto\/jobs\/([^/]+)\/laptop-synced$/) : null;
      if (syncMatch) {
        const input = await body(request) as { path?: unknown };
        if (typeof input.path !== 'string' || !input.path) return json(response, 400, { error: 'Laptop sync acknowledgement requires a path.' });
        return json(response, 200, { job: runner.acknowledgeLaptopSync(decodeURIComponent(syncMatch[1]), input.path) });
      }
      const artifactMatch = method === 'GET' ? url.pathname.match(/^\/proya\/auto\/jobs\/([^/]+)\/artifact$/) : null;
      if (artifactMatch) {
        const job = runner.jobs().find(candidate => candidate.jobId === decodeURIComponent(artifactMatch[1]));
        if (!job || job.phase !== 'COMPLETED' || !job.archivePath || !job.archiveSha256 || !existsSync(job.archivePath)) return json(response, 404, { error: 'Completed job artifact not found.' });
        const root = resolve(runner.archiveRoot); const path = resolve(job.archivePath); const relation = relative(root, path);
        if (!relation || relation.startsWith('..') || isAbsolute(relation)) return json(response, 403, { error: 'Artifact path is outside the authoritative archive.' });
        const size = statSync(path).size; const match = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        const start = match ? Number(match[1]) : 0; const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (start < 0 || end < start || start >= size) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }); return response.end(); }
        const headers: Record<string, string> = { 'Content-Type': 'video/mp4', 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'X-PROYA-SHA256': job.archiveSha256, 'Cache-Control': 'no-store' };
        if (match) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
        response.writeHead(match ? 206 : 200, headers);
        createReadStream(path, { start, end }).pipe(response); return;
      }
      if (url.pathname.startsWith('/proya/auto/')) return json(response, 405, { error: 'Runner route or method is not enabled.' });
      return json(response, 404, { error: 'Not found.' });
    } catch (reason) {
      return json(response, reason instanceof SessionBundleConflictError ? 409 : 400, { error: reason instanceof Error ? reason.message : String(reason) });
    }
  });
}
