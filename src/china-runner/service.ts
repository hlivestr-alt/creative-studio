import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface LockRecord { pid: number; startedAt: string }

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export class RunnerSingletonLock {
  readonly path: string;
  private owned = false;

  constructor(stateRoot: string) {
    mkdirSync(stateRoot, { recursive: true });
    this.path = join(stateRoot, 'runner.lock');
  }

  acquire(): void {
    if (this.owned) return;
    if (existsSync(this.path)) {
      try {
        const record = JSON.parse(readFileSync(this.path, 'utf8')) as LockRecord;
        if (Number.isSafeInteger(record.pid) && processAlive(record.pid)) throw new Error(`China Auto Runner is already active as PID ${record.pid}.`);
      } catch (reason) {
        if (reason instanceof Error && reason.message.startsWith('China Auto Runner is already active')) throw reason;
      }
      rmSync(this.path, { force: true });
    }
    let descriptor: number | null = null;
    try {
      descriptor = openSync(this.path, 'wx');
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { flush: true });
      this.owned = true;
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
  }

  release(): void {
    if (!this.owned) return;
    try {
      const record = JSON.parse(readFileSync(this.path, 'utf8')) as LockRecord;
      if (record.pid === process.pid) rmSync(this.path, { force: true });
    } finally { this.owned = false; }
  }
}
