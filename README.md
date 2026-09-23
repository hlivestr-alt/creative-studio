# PROYA Creative Studio

PROYA Creative Studio is a one-PC Windows desktop application for planning image campaigns and running autonomous MiniMax H3 video generation for the PROYA 5X Vitamin C skincare series. The desktop app, Local Generation Runner, ComfyUI, LM Studio, product masters, workflow definition, and archive coordination all run on this PC.

The image workflow can open a visible, human-operated ChatGPT workspace. The application does not scrape ChatGPT, read its DOM, send messages unattended, extract cookies, store credentials, or use the OpenAI API.

## Architecture

- Electron desktop shell with context isolation, sandboxing, and a narrow preload bridge.
- React, TypeScript, Vite, and React Router UI.
- Local Generation Runner under `runtime/runner`, bound to loopback only.
- ComfyUI at `http://127.0.0.1:8188` and LM Studio at `http://127.0.0.1:1234`.
- SQLite application data in Electron's per-user application-data directory.
- Production archive and runner state under `D:\AI Videos` and `D:\AI Videos\.proya-auto`.
- Electron Builder portable packaging to the canonical root executable.

The external production locations above, the Comfy Desktop installation, LM Studio configuration/models, and `C:\ffmpeg\bin\ffmpeg.exe` are intentionally outside this repository.

## Project folders

- `electron/main` — desktop lifecycle, persistence, local services, compute orchestration, and IPC.
- `electron/preload` — typed renderer bridge.
- `src/domain` — validation, creative planning, workflows, and compatibility types.
- `src/local-runner` — Local Generation Runner source and tests.
- `src/ui` — application UI.
- `runtime/runner` — stable bundled local runner runtime.
- `data` — normalized brand and product data.
- `product-assets` — six individual product masters plus the series master.
- `workflows` — pinned MiniMax H3 API workflow.
- `prompts` — image and H3 prompt resources.
- `deploy/ComfyUI-MiniMax-H3-Prompt-Enhancer` — checked-in ComfyUI extension source.
- `docs/consolidation-audit` — pre-consolidation manifests.

## Source-of-truth order

1. Master product PNG for packaging appearance.
2. Official PROYA logo for wordmark appearance.
3. Product knowledge document for facts, ingredients, size, use, and benefits.
4. PROYA branding guide for visual direction and claim safety.
5. Current creative selections for campaign direction.

Files under `references` and `product-assets` are source materials and should not be edited casually. Runtime behavior uses reviewed normalized records in `data`.

## Development

Requirements: Windows 10/11, Node.js 22+, and npm.

```powershell
npm install
npm run dev
```

Quality and packaging commands:

```powershell
npm run typecheck
npm run validate
npm run build:local-runner
npm run build:portable
```

`npm run build:portable` builds the application and atomically replaces `PROYA-Creative-Studio.exe` in the project root. Temporary Electron Builder output is removed after a successful build.

## Local H3 generation

Choose a verified product, content type, creative direction, references, language, duration, aspect ratio, and H3 settings, then generate a single video or start Auto Run. The app creates a structured `H3GenerationBrief`; the local ComfyUI graph uses the fixed Qwen model in LM Studio for prompt enhancement and validation, unloads the exact model instance, and queues the locked MiniMax H3 graph. Results are archived under `D:\AI Videos`.

Starting the app never starts Auto Run by itself. Interrupted work is recovered from persisted state, and historical serialized field names are read through compatibility handling.

## Image workflow

The Images page prepares a source-grounded brief and can open the visible ChatGPT workspace. The user reviews the brief, attaches the exact product master where required, pastes the brief, and sends it manually. If the embedded workspace is unavailable, use the default-browser and copy controls.

## Compatibility notes

Some internal database columns, serialized fields, lifecycle values, and loopback API paths retain legacy names. They are not shown as execution-architecture labels. They remain solely so existing application data and `D:\AI Videos\.proya-auto\runner.sqlite3` continue to load without a destructive migration.
