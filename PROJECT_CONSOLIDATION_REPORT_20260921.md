# PROYA Creative Studio Project Consolidation Report

Date: 2026-09-21 (Asia/Shanghai)

## Outcome

The authoritative contents from `C:\Data\proya-creative-studio-local` were preserved and consolidated at `C:\Data\proya-creative-studio`. The legacy canonical tree was audited before deletion, and no older source was allowed to overwrite the authoritative source. The only unique legacy material retained was the Git repository metadata/history (`.git`).

The prior canonical tree and its temporary staging tree were deleted. The former `-local` tree has no contents, but its empty directory entry is still held open by the Codex desktop task that performed this move. Windows will not remove or rename that directory until the task releases its working-directory handle. It is not a second source tree or clone. A constrained background cleanup process is waiting to remove that exact path after the handle is released; it exits without deleting anything if the directory ever becomes non-empty.

## Audit baseline

| Tree | Files | Bytes |
|---|---:|---:|
| Old `C:\Data\proya-creative-studio` | 22,940 | 5,223,614,542 |
| Authoritative `C:\Data\proya-creative-studio-local` | 21,962 | 2,482,467,920 |
| Combined baseline | 44,902 | 7,706,082,462 |

The recursive manifests are preserved in:

- `docs/consolidation-audit/PROJECT_MANIFEST_OLD_20260921.csv`
- `docs/consolidation-audit/PROJECT_MANIFEST_LOCAL_20260921.csv`

Each manifest records relative path, byte size, UTC modified time, SHA-256 where useful, and the requested classification. Comparison found no unique active old source, workflow, product master, test, or current configuration that was newer than or absent from the authoritative tree.

## Merge decisions

Unique old material migrated:

- `.git` only: 880 files, 292,579,059 bytes. This preserves commit history and the configured remote.

Unique old release trees, runner packages, backups, installers, generated evidence, and diagnostics were classified as historical/generated rather than migrated.

## Removed material

Removed categories include:

- obsolete `release*`, `dist*`, Electron Builder, portable-build, and packaging output;
- old runner packages, duplicate runner bundles, stale runner backups, and old proxy/tunnel material;
- old installers, migration/deployment artifacts, and superseded packaging scripts;
- `.cta-test`, CTA examples/visual QA, smoke profiles, generated outputs, and temporary staging trees;
- obsolete evidence, traces, screenshots, GUI/test diagnostics, cached files, and generated QA samples;
- the complete legacy project tree after validation.

One current `node_modules` installation was retained. There is one active dependency tree under the canonical project.

## Renames and path consolidation

- `src/china-runner` → `src/local-runner`
- `tsup.china-runner.config.ts` → `tsup.local-runner.config.ts`
- `electron/main/china-auto-h3-*` → `electron/main/local-auto-h3-*`
- active runner class/store/bundle/controller names → `LocalGenerationRunner`, `LocalRunnerStore`, `LocalSessionBundle`, and `LocalAutoH3*`
- runtime root → `C:\Data\proya-creative-studio\runtime\runner`
- permanent executable → `C:\Data\proya-creative-studio\PROYA-Creative-Studio.exe`

Active absolute references to `C:\Data\proya-creative-studio-local` and obsolete China runner paths were removed. The retained README documents the local-only architecture.

## Naming audit and compatibility

User-visible execution architecture now uses `Local Engine`, `Local Generation Runner`, `Auto Run`, and `Archive`. User-facing runtime messages sanitize historical China/Laptop/Remote wording before display.

There are **127 case-insensitive `china` occurrences** in current non-generated source/test text (source maps, Git history, `node_modules`, and audit manifests excluded). None is an active product/module/path name. They remain for exact backward compatibility or tests of that compatibility:

- persisted SQLite table `china_auto_session_mirror`;
- serialized fields including `chinaRoot`, `chinaArchivePath`, `chinaArchiveSucceeded`, `chinaArchiveError`, and `chinaArchived`;
- persisted enum/event values including `china_archive` and `CHINA_ARCHIVE`;
- tests that construct and verify those persisted compatibility values;
- UI/database sanitizers that recognize old stored error text and translate it to local wording.

The same compatibility rule applies to persisted `laptop*` fields and legacy `remote*` job/settings/protocol identifiers. These cannot be blindly renamed without a database/state migration that could make the existing 8.39 GB runner database unreadable. They are internal compatibility keys, not user-visible architectural labels. Historical Git commits were not rewritten.

## External production systems preserved

- `D:\AI Videos`
- `D:\AI Videos\.proya-auto\runner.sqlite3`
- Comfy Desktop installation under `C:\Users\lbbch\AppData\Local\Comfy-Desktop`
- LM Studio models and configuration
- `C:\ffmpeg\bin\ffmpeg.exe`

The production runner database and WAL were unchanged by the runtime verification (database 8,391,045,120 bytes; WAL 29,375,632 bytes; both retained their 2026-09-21 03:20:12 UTC modification time).

## Validation

- Pre-move typecheck: pass.
- Post-move `npm run validate`: pass — 37 test files passed, 1 skipped; 474 tests passed, 2 skipped; ESLint passed with zero warnings.
- `npm run build:portable`: pass.
- Portable packaging verification: workflow plus all six individual product assets resolved and hash-matched.
- Final portable executable: 457,554,384 bytes.
- Portable SHA-256: `320E184404369A818538B250DEFEAEFC24480187B5B22A2770E4946991A22E0C`.
- Actual final portable runtime: pass.
- Local Generation Runner launched from the canonical `runtime\runner` path in production mode.
- Runner health: READY; generation enabled; session STOPPED; no current job; Comfy queue 0 running / 0 pending.
- ComfyUI loopback `127.0.0.1:8188`: pass during runtime check.
- LM Studio loopback `127.0.0.1:1234`: pass; required `qwen/qwen3.8-27b` model found.
- Network audit: runner/app used loopback services only; no Cloudflare request.
- Safe isolated stage-only Auto Run test: pass; no H3 render was started.
- Diagnostic app/runner/Comfy processes were retired afterward; LM Studio was left intact.

## Required summary

OLD PROJECT SIZE:
5,223,614,542 bytes

LOCAL PROJECT SIZE:
2,482,467,920 bytes

FINAL PROJECT ROOT:
`C:\Data\proya-creative-studio`

FINAL PROJECT SIZE:
1,530,354,256 bytes

SPACE RECLAIMED:
6,175,728,206 bytes

FILES DELETED:
22,707

UNIQUE OLD FILES MIGRATED:
`.git` (880 files, 292,579,059 bytes); no legacy source/build/runtime copy migrated

OLD PROJECT ROOT REMOVED:
yes

LOCAL-SUFFIX ROOT REMOVED:
no — contents removed; the empty directory entry is locked by this active Codex desktop task

FINAL PROJECT FOLDERS UNDER `C:\Data`:
`C:\Data\proya-creative-studio` (canonical project) plus an empty, locked `C:\Data\proya-creative-studio-local` directory entry

ACTIVE "CHINA" NAMING REMOVED:
yes — remaining identifiers are persistence compatibility keys/tests/sanitizers only

ACTIVE "LAPTOP" NAMING REMOVED:
yes — remaining identifiers are persistence compatibility keys only

ACTIVE "REMOTE" NAMING REMOVED:
yes — remaining identifiers are persisted protocol/settings/job keys and internal compatibility names only

REMAINING "CHINA" REFERENCES:
127 non-generated source/test occurrences, all explicitly justified in “Naming audit and compatibility” above

LOCAL RUNNER:
`C:\Data\proya-creative-studio\runtime\runner`

PORTABLE EXE:
`C:\Data\proya-creative-studio\PROYA-Creative-Studio.exe`

PORTABLE SHA-256:
`320E184404369A818538B250DEFEAEFC24480187B5B22A2770E4946991A22E0C`

D:\AI VIDEOS PRESERVED:
yes

RUNNER DB PRESERVED:
yes

COMFY INSTALLATION PRESERVED:
yes

LM STUDIO PRESERVED:
yes

TYPECHECK:
pass

TESTS:
pass — 37 files passed, 1 skipped; 474 tests passed, 2 skipped

PORTABLE BUILD:
pass

FINAL APP RUNTIME:
pass

CLEANUP REPORT:
`C:\Data\proya-creative-studio\PROJECT_CONSOLIDATION_REPORT_20260921.md`

READY:
yes — the canonical project is ready for daily use; only the empty self-locked suffix directory entry awaits release of the current Codex task handle
