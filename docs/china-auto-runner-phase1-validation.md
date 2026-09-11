# China Auto Runner Phase 1 validation

Date: 2026-09-09

## Result

The persistent China Auto Runner is implemented in hard `shadow` mode as a
logged-in user-session process. The existing laptop Auto Run production path
was not rewired or changed.

The runner binds to `127.0.0.1:8787`, uses native SQLite with WAL at
`D:\AI Videos\.proya-auto\runner.sqlite3`, and has fixed local dependency
origins for ComfyUI (`http://127.0.0.1:8188`) and LM Studio
(`http://127.0.0.1:1234`).

Shadow mode rejects generation submission and `/free` below the HTTP API layer.
No H3 workflow was submitted or executed during implementation or validation.

## Validation

- TypeScript typecheck: passed.
- ESLint: passed with zero warnings.
- Vitest: 25 files passed; 365 tests passed.
- Runner-specific tests: 32 passed.
- Six products × eight content types: 48 shadow jobs simulated.
- Compiled runner Cloudflare scan: zero occurrences of
  `comfy.proyaofficial.com` and zero occurrences of `https://comfy`.
- Compiled runner contains only the fixed generation-side origins
  `http://127.0.0.1:8188` and `http://127.0.0.1:1234`.
- Package was created locally and was not installed on the China PC.

## Package

- ZIP: `release/PROYA-China-Auto-Runner-Shadow-20260909-r6.zip`
- SHA-256: `bd4c293dcef9ea08cd55d0874ea08480fef88e0939a181d1e5ec21cbc3122fe6`
- Deployment manifest: `release/PROYA-China-Auto-Runner-Shadow-20260909-r6.manifest.json`
- Package manifest: `release/china-auto-runner-shadow-20260909-r6/manifest.json`

The r6 packaged smoke fixture reproduces LM Studio's China response with
`key = "qwen/qwen3.8-27b"`. It reports LM Studio ready, Qwen available, an
exact `key` match, one read-only `GET /api/v1/models`, prompt submission
disabled, and autonomous `/free` disabled.
