# PROYA Creative Studio

PROYA Creative Studio is a local Windows desktop application for planning Instagram creative sessions for the PROYA 5X Vitamin C skincare series. It combines verified local product knowledge, conservative claim rules, posting history, a visible human-operated ChatGPT browser workspace for the image workflow, and an autonomous MiniMax H3 video control plane. It does not use the OpenAI API. H3 generation runs through the configured remote ComfyUI execution plane on the China RTX 5090 PC; the laptop owns configuration, creative direction, job state, history, download, and playback.

## Architecture

- **Desktop shell:** Electron with a hardened preload bridge (`contextIsolation`, sandboxing, no renderer Node access).
- **Local UI:** React, TypeScript, Vite, and React Router.
- **ChatGPT workspace:** a visible Electron `WebContentsView` using the persistent `persist:proya-chatgpt` browser partition.
- **Compute:** The H3 production path uses an Electron-main-process ComfyUI HTTP/WebSocket provider. The legacy Local option remains only for development/troubleshooting and is not an autonomous H3 provider.
- **Local data:** typed, Zod-validated JSON in `data/`.
- **Persistence:** SQLite through `better-sqlite3`, stored under Electron's per-user application-data directory.
- **Business logic:** standalone image brief builder, Creative Diversity/CreativeGenome planning, typed `H3GenerationBrief` serialization, ComfyUI graph validation, settings validation, and deterministic Smart Rotation modules in `src/domain/`.
- **Packaging:** Electron Builder for a Windows installer or unpacked application.

The application never scrapes ChatGPT, reads its DOM, sends messages unattended, extracts cookies, stores credentials, or calls undocumented endpoints. The user logs in, reviews/pastes the brief, and presses Send.

## Source-of-truth order

1. Master product PNG for packaging appearance.
2. Official PROYA logo for wordmark appearance.
3. Product knowledge document for facts, ingredients, size, use, and benefits.
4. PROYA branding guide for visual direction and claim safety.
5. Current creative selections for campaign direction.

Original files under `references/` and `product-assets/` are source materials and must not be edited. Runtime behavior uses the normalized records in `data/` rather than repeatedly parsing the source documents.

## Project folders

- `electron/main/` — application window, SQLite repository, settings store, browser view, isolated compute providers, IPC, clipboard, and filesystem integration.
- `electron/preload/` — narrow typed bridge available to React.
- `src/domain/` — types, validation, normalized-data loader, Smart Rotation, image/H3 brief generation, and unit tests.
- `src/ui/` — Today, H3 Video Prompts, History, Settings, product cards, and ChatGPT workspace UI.
- `data/` — normalized brand, product, post-type, style, and claim data.
- `prompts/` — image-workflow templates and the authoritative `minimax-h3-lmstudio-system.md` file consumed by the remote H3 prompt engine.
- `product-assets/` — untouched master PNGs.
- `references/` — untouched human-readable source documents.

## Install and run

Requirements: Windows 10/11, Node.js 22+, and npm.

```powershell
npm install
npm run dev
```

The development command starts Vite and Electron together.

## Quality and production commands

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run build` produces an unpacked Windows application under `release/`. To create the NSIS installer:

```powershell
npm run dist
```

## Database behavior

The SQLite database is created automatically as `proya-creative-studio.sqlite` in Electron's application-data folder for the current Windows user. The app uses the SQLite engine compiled to WebAssembly and exports a standard SQLite file after each write, avoiding a native compiler dependency. It records prepared sessions, workflow mode, and manual status/concept/headline/notes updates. The app does not connect to a remote database.

Smart Rotation considers only posts marked **Used**. It scores each individual product using days since last use, count during the last 30 days, and an immediate-repeat penalty. The highest deterministic score is suggested, with a plain-language reason shown in Today.

## ChatGPT login and session behavior (Images only)

The visible ChatGPT workspace belongs to the unrelated Images workflow. Click **Open ChatGPT** or **Open ChatGPT + Copy Brief** in Images when a human-reviewed image handoff is needed. ChatGPT appears in the right-hand browser panel. Log in normally inside that panel. Electron owns the persistent browser session using `persist:proya-chatgpt`, so the session can survive application restarts unless ChatGPT expires it or the local Electron profile is cleared. PROYA Creative Studio does not see or store the credentials itself. The H3 page never opens this panel, sends a ChatGPT message, or asks the user to copy a prompt.

The ChatGPT workspace target is configurable in **Settings → ChatGPT**. Paste the URL of the existing Creative Project to make it the default for **Open ChatGPT**, **Open ChatGPT + Copy Brief**, and **New chat**. The normal `https://chatgpt.com/` home URL remains available as the safe fallback; a project-specific URL cannot be prefilled without the user's account URL.

The primary workflow is:

1. Choose a product, workflow mode, post structure, creative settings, and caption length. **Direct Image Prompt**, **Single Image**, and **Standard** captions are the defaults.
2. Click **Prepare Image Session** and review the source-grounded brief, structure, slide count, caption setting, exact-count approval note, and reference-file panel.
3. For Direct Single Image, drag the selected product PNG into ChatGPT before sending. For Direct Carousel, the planning brief may be sent first; attach the official product PNG (or relevant Full Series PNGs) together with **APPROVE** for generation.
4. Click **Open ChatGPT + Copy Brief**, paste the brief, review it, and press Send manually.
5. For a Direct Single Image brief, ChatGPT returns one concept, production-ready prompt, ready-to-post caption, and hashtags; reply exactly **APPROVE** to generate one image. For a Direct Carousel brief, ChatGPT first states the final slide count and returns the full slide plan, one prompt per slide, one overall caption, and hashtags; attach the official reference PNG(s) and reply exactly **APPROVE** once to run one independent image generation per slide in the same response—never a collage or extra variants. Selecting **None** omits the caption and hashtags sections.
6. Record the concept title, headline, structure, caption setting, and status in History when appropriate.

**Explore 3 Ideas** remains available as an explicit secondary workflow mode. It preserves the three-direction brief and also supports concise exploratory carousel outlines.

The H3 workflow is autonomous: choose a verified product, content type, idea/instructions, creative variety, references, language, duration, aspect ratio, direct H3 settings, and Music Only/Captions/Subtitles, then click **Generate H3 video**. Creative Diversity selects a `CreativeGenome`; Creative Studio serializes that direction as an intermediate `H3GenerationBrief`; the remote ComfyUI graph sends the brief to the fixed `qwen/qwen3.8-27b` prompt engine, runs its rewrite/repair loop and validation, unloads only the exact Qwen instance used, and queues the locked **REF2VA** MiniMax H3 graph. References upload automatically, generated MP4 output downloads to the configured laptop folder, and the result appears in the right-side status/preview rail. The final prompt is available afterward only in a read-only debug panel. See [docs/h3-remote-autonomous-generation.md](docs/h3-remote-autonomous-generation.md).

## Fallback workflow

If embedded ChatGPT is unavailable or its website changes, use **Open in default browser**, **Copy Brief**, and **Open Product Folder**. Planning, history, Smart Rotation, and brief generation remain fully functional without ChatGPT.

## Known limitations

- The exact supplied `prompts/minimax-h3-lmstudio-system.md` file is not present in this checkout. Autonomous H3 therefore fails closed until that user-supplied file is restored at the configured path; Creative Studio does not invent or rewrite it.
- The China RTX 5090 canary requires the patched third-party node, `qwen/qwen3.8-27b` available in LM Studio, ComfyUI installation, and network access. This repository includes the graph, patch, contract tests, and failure-path tests, but cannot claim a hardware canary without that execution PC.
- Remote H3 requires the pinned MiniMax H3 API-format workflow and patched node pack described in [docs/h3-remote-autonomous-generation.md](docs/h3-remote-autonomous-generation.md). Reference upload, local job persistence, automatic download, retry, and read-only prompt diagnostics are implemented.
- V1 does not automate ChatGPT file uploads; it exposes the exact master file and path for drag-and-drop.
- Authentication popups and enterprise login policies are controlled by ChatGPT and the user's organization.
- The supplied skin-cream master shows an open jar. Normalized packaging rules avoid inventing an unseen lid design.
- Updating original source documents does not automatically rewrite normalized JSON; data updates should be reviewed deliberately against the source-of-truth hierarchy.

## V1 boundaries

There is no OpenAI API key, API billing, laptop-side LLM, ChatGPT response scraping, hidden ChatGPT automation in H3, Instagram publishing/scheduling, Meta API, n8n, Google Drive, PostgreSQL, Docker, or remote desktop/filesystem dependency. Remote H3 is limited to the explicitly configured ComfyUI HTTP/WebSocket API; LM Studio remains loopback-only on the China execution PC. See [docs/h3-remote-autonomous-generation.md](docs/h3-remote-autonomous-generation.md) and [docs/remote-compute.md](docs/remote-compute.md).

## Continuous Auto H3

H3 now includes an ordered, persistent Auto Run mode with independent China archive and laptop download recovery. See [implementation and validation](docs/auto-h3-continuous-generation.md) and [China extension deployment](deploy/ComfyUI-MiniMax-H3-Prompt-Enhancer/AUTO-RUN.md). Starting the packaged app never automatically starts continuous generation.
