import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExplicitReferenceAuthorizationStore } from './reference-authorization';

let temporaryDirectory: string | undefined;
afterEach(() => { if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true }); temporaryDirectory = undefined; });

function createFixture(relativePath: string, contents = 'reference-image-fixture'): string {
  if (!temporaryDirectory) temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-reference-auth-'));
  const filePath = join(temporaryDirectory, relativePath);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, contents);
  return filePath;
}

describe('ExplicitReferenceAuthorizationStore', () => {
  it('accepts the exact explicitly selected file outside configured folders', () => {
    const selectedPath = createFixture('Desktop/selected.png');
    const otherPath = createFixture('Desktop/other.png');
    const store = new ExplicitReferenceAuthorizationStore();

    const authorizedPath = store.authorize('h3-window', selectedPath);

    expect(store.getAuthorizedPath('h3-window', selectedPath)).toBe(authorizedPath);
    expect(() => store.getAuthorizedPath('h3-window', otherPath)).toThrow(/not the explicitly selected file/);
  });

  it('cannot be bypassed by tampering with the renderer-supplied productReference.path', () => {
    const selectedPath = createFixture('Desktop/selected.webp');
    const tamperedPath = createFixture('Desktop/tampered.webp');
    const store = new ExplicitReferenceAuthorizationStore();
    store.authorize(42, selectedPath);

    expect(() => store.getAuthorizedPath(42, tamperedPath)).toThrow(/not the explicitly selected file/);
  });

  it('replaces and clears the previous exact-file authorization', () => {
    const firstPath = createFixture('Desktop/first.jpg');
    const replacementPath = createFixture('Desktop/replacement.jpeg');
    const store = new ExplicitReferenceAuthorizationStore();

    store.authorize('h3-window', firstPath);
    store.authorize('h3-window', replacementPath);
    expect(() => store.getAuthorizedPath('h3-window', firstPath)).toThrow(/not the explicitly selected file/);
    expect(store.getAuthorizedPath('h3-window', replacementPath)).toBeTruthy();

    store.clear('h3-window');
    expect(store.getAuthorizedPath('h3-window', replacementPath)).toBeNull();
  });

  it('validates existence, regular-file type, supported extension, non-empty content, and the 25 MiB limit', () => {
    const directoryPath = join(temporaryDirectory ?? (temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-reference-auth-'))), 'folder.png');
    mkdirSync(directoryPath, { recursive: true });
    const emptyPath = createFixture('empty.png', '');
    const unsupportedPath = createFixture('reference.gif');
    const largePath = createFixture('large.png', 'x'.repeat(25 * 1024 * 1024 + 1));
    const missingPath = join(temporaryDirectory, 'missing.png');
    const store = new ExplicitReferenceAuthorizationStore();

    expect(() => store.authorize('session', directoryPath)).toThrow(/regular image file/);
    expect(() => store.authorize('session', emptyPath)).toThrow(/empty image file/);
    expect(() => store.authorize('session', unsupportedPath)).toThrow(/PNG, JPEG, and WebP/);
    expect(() => store.authorize('session', largePath)).toThrow(/25 MiB/);
    expect(() => store.authorize('session', missingPath)).toThrow(/could not find/);
  });
});
