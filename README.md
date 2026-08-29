# PROYA Creative Studio

PROYA Creative Studio is a local Windows desktop application for planning Instagram creative sessions for the PROYA 5X Vitamin C skincare series. It combines verified local product knowledge, conservative claim rules, posting history, and a visible human-operated ChatGPT browser workspace. It does not use the OpenAI API or any other AI backend.

## Architecture

- **Desktop shell:** Electron with a hardened preload bridge (`contextIsolation`, sandboxing, no renderer Node access).
- **Local UI:** React, TypeScript, Vite, and React Router.
- **ChatGPT workspace:** a visible Electron `WebContentsView` using the persistent `persist:proya-chatgpt` browser partition.
- **Local data:** typed, Zod-validated JSON in `data/`.
- **Persistence:** SQLite through `better-sqlite3`, stored under Electron's per-user application-data directory.
- **Business logic:** standalone brief builder, settings validation, and deterministic Smart Rotation modules in `src/domain/`.
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

- `electron/main/` — application window, SQLite repository, settings store, browser view, IPC, clipboard, and filesystem integration.
- `electron/preload/` — narrow typed bridge available to React.
- `src/domain/` — types, validation, normalized-data loader, Smart Rotation, brief generation, and unit tests.
- `src/ui/` — Today, History, Settings, product cards, and ChatGPT workspace UI.
- `data/` — normalized brand, product, post-type, style, and claim data.
- `prompts/` — reusable ChatGPT creative-director template.
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

## ChatGPT login and session behavior

Click **Open ChatGPT** or **Open ChatGPT + Copy Brief**. ChatGPT appears in the right-hand browser panel. Log in normally inside that panel. Electron owns the persistent browser session using `persist:proya-chatgpt`, so the session can survive application restarts unless ChatGPT expires it or the local Electron profile is cleared. PROYA Creative Studio does not see or store the credentials itself.

The ChatGPT workspace target is configurable in **Settings → ChatGPT**. Paste the URL of the existing Creative Project to make it the default for **Open ChatGPT**, **Open ChatGPT + Copy Brief**, and **New chat**. The normal `https://chatgpt.com/` home URL remains available as the safe fallback; a project-specific URL cannot be prefilled without the user's account URL.

The primary workflow is:

1. Choose a product, workflow mode, post structure, creative settings, and caption length. **Direct Image Prompt**, **Single Image**, and **Standard** captions are the defaults.
2. Click **Prepare Image Session** and review the source-grounded brief, structure, slide count, caption setting, exact-count approval note, and reference-file panel.
3. For Direct Single Image, drag the selected product PNG into ChatGPT before sending. For Direct Carousel, the planning brief may be sent first; attach the official product PNG (or relevant Full Series PNGs) together with **APPROVE** for generation.
4. Click **Open ChatGPT + Copy Brief**, paste the brief, review it, and press Send manually.
5. For a Direct Single Image brief, ChatGPT returns one concept, production-ready prompt, ready-to-post caption, and hashtags; reply exactly **APPROVE** to generate one image. For a Direct Carousel brief, ChatGPT first states the final slide count and returns the full slide plan, one prompt per slide, one overall caption, and hashtags; attach the official reference PNG(s) and reply exactly **APPROVE** once to run one independent image generation per slide in the same response—never a collage or extra variants. Selecting **None** omits the caption and hashtags sections.
6. Record the concept title, headline, structure, caption setting, and status in History when appropriate.

**Explore 3 Ideas** remains available as an explicit secondary workflow mode. It preserves the three-direction brief and also supports concise exploratory carousel outlines.

## Fallback workflow

If embedded ChatGPT is unavailable or its website changes, use **Open in default browser**, **Copy Brief**, and **Open Product Folder**. Planning, history, Smart Rotation, and brief generation remain fully functional without ChatGPT.

## Known limitations

- V1 does not inspect, capture, or import ChatGPT responses. Chosen concepts and headlines are entered manually.
- V1 does not automate ChatGPT file uploads; it exposes the exact master file and path for drag-and-drop.
- Authentication popups and enterprise login policies are controlled by ChatGPT and the user's organization.
- The supplied skin-cream master shows an open jar. Normalized packaging rules avoid inventing an unseen lid design.
- Updating original source documents does not automatically rewrite normalized JSON; data updates should be reviewed deliberately against the source-of-truth hierarchy.

## V1 boundaries

There is no OpenAI API key, API billing, local LLM, image-generation API, response scraping, hidden automation, Instagram publishing/scheduling, Meta API, n8n, Google Drive, PostgreSQL, Docker, cloud account, or integration with any other local project.
