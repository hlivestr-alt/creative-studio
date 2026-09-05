# Autonomous MiniMax H3 generation

This document is the production contract for the H3 Video tab. The laptop is
the control plane. The China RTX 5090 PC is the execution plane. ChatGPT is
not part of this generation path; the visible ChatGPT workspace remains only
for unrelated image workflows.

## Responsibility split

Creative Studio on the laptop owns:

- product and content-family selection;
- Creative Diversity and the selected `CreativeGenome`;
- user idea/instructions, references, language, and audio/text flags;
- duration, aspect ratio, megapixels, multiple, FPS, steps, scheduler, seed,
  and `ref_image_size`;
- remote output preferences, history, job status, download, and playback.

The China PC owns:

- ComfyUI and the MiniMax H3 Ref2VA graph;
- LM Studio and the exact loaded Qwen model;
- prompt rewriting, repair attempts, and prompt validation;
- temporary remote reference files, the Qwen-to-H3 VRAM handoff, GPU
  execution, and remote output metadata.

The laptop has no LLM runtime for H3 and never calls LM Studio directly.

## End-to-end flow

```text
user controls
  → Creative Diversity / CreativeGenome
  → H3GenerationBrief + deterministic serialization
  → reference upload through ComfyUI
  → MiniMaxH3PromptEnhancer / Qwen
  → MiniMaxH3PromptValidator
  → validity gate
  → unload the exact emitted Qwen instance
  → MiniMax H3 Ref2VA
  → ComfyUI output metadata
  → laptop download and video preview
```

There is one normal action: **Generate H3 video**. There is no ChatGPT pane,
ChatGPT handoff, copy-to-ChatGPT action, or manual final-prompt step.

## H3GenerationBrief

Creative Studio does not construct the final six-section H3 prompt for an
LM-Studio-enabled job. It creates a typed intermediate object containing the
selected direction and only relevant verified product corrections:

```ts
type H3GenerationBrief = {
  schemaVersion: 1;
  workflowMode: 'REF2VA';
  product: ProductId;
  contentType: H3ContentType;
  contentFamily: H3ContentType;
  duration: number;
  aspectRatio: H3WorkflowAspectRatio;
  language: 'English' | 'Indonesian';
  videoIdea: string;
  creativeDirection: H3CreativeDirection; // selected CreativeGenome projection
  productCorrections: string[];
  references: H3GenerationBriefReference[];
  musicOnly: boolean;
  captions: boolean;
  subtitles: boolean;
  sound: H3Sound;
  specialInstructions: string;
};
```

The serializer starts with the exact mode lock:

```text
WORKFLOW MODE LOCK: REF2VA.
Format the result as REF2VA.
Do not switch generation modes.
```

It is concise, deterministic, human-readable input for Qwen. It is not the
final `subject_definitions` / `summary` / `retention_analysis` /
`detailed_description` / `overall_soundscape` /
`non_diegetic_music` prompt. Qwen translates the selected direction into the
official H3 syntax.

Creative Diversity runs before serialization. Its seed, genome, fingerprint,
novelty score, and penalty sources are stored with the job so autonomous runs
remain varied and reproducible.

## Product and reference contract

The selected product image is uploaded by the main process before queueing.
Only authorized local product/reference folders are accepted. The returned
ComfyUI filename is placed in `LoadImage`; a laptop filesystem path is never
sent to the graph.

The first image is always:

```text
<Picture 1> / product identity and packaging truth
  → node 137 LoadImage
  → MiniMaxH3ReferenceToVideo.ref_images.ref_image_0
```

An optional second style/reference image is `<Picture 2>` and maps to node
`139` / `ref_image_1`. Unused reference links are removed. Reference pixels
remain authoritative for visible product appearance; style references cannot
change product identity.

Relevant corrections are injected into the brief only when applicable. The
current product knowledge rules include: the cleanser tube body is opaque;
the toner orange body is opaque and only the protective outer cap is
transparent; the serum bottle is opaque/coated and any visible liquid is
clear/colorless. Blank rear/side rules are included only as conditional
surface corrections when those surfaces are exposed.

## ComfyUI graph

The checked-in graph is `workflows/minimax-h3-api.json`. Its active topology
is:

```text
147 H3GenerationBrief ───────┐
                             ├→ 149 MiniMaxH3PromptEnhancer
148 reference context ───────┘             │
                                           ↓
                         150 MiniMaxH3PromptValidator
                                           ↓
                         151 MiniMaxH3PromptValidityGate
                                           ↓
                         152 MiniMaxH3UnloadLMStudioModel
                                           ↓
                         136 MiniMaxH3ReferenceToVideo.prompt
```

Image inputs remain separate:

```text
uploaded product → 137 LoadImage → 136 ref_image_0
uploaded optional style → 139 LoadImage → 136 ref_image_1
```

The active prompt-engine node IDs are:

| Node | Class | Role |
| --- | --- | --- |
| `147` | `PrimitiveStringMultiline` | serialized intermediate brief |
| `148` | `PrimitiveStringMultiline` | separate reference context |
| `153` | `PrimitiveStringMultiline` | exact `media_manifest` shared by enhancer and validator |
| `149` | `MiniMaxH3PromptEnhancer` | Qwen rewrite, system prompt, repairs |
| `150` | `MiniMaxH3PromptValidator` | `prompt`, `valid`, `validation_report` |
| `151` | `MiniMaxH3PromptValidityGate` | blocks invalid output |
| `152` | `MiniMaxH3UnloadLMStudioModel` | unloads/verifies the exact node-149 model instance |
| `136` | `MiniMaxH3ReferenceToVideo` | locked Ref2VA generation |
| `92` | `SaveVideo` | remote video output |

Node `138` is a disconnected migration input retained for old development
requests. It is not connected to node `136` and is not used by the normal H3
page.

## LM Studio and Qwen

The ComfyUI-side enhancer uses LM Studio at
`http://127.0.0.1:1234/v1`, which is local to the China PC. The laptop calls
the remote HTTPS ComfyUI API for model discovery; ComfyUI contacts LM Studio
locally. Port `1234` is never exposed publicly and is never opened from the
laptop.

Creative Studio exposes a compact read-only Prompt Engine status:

```text
Prompt Engine
LM Studio Connected
Model: Qwen 3.8 27B
Status: Ready
Test Prompt Engine
```

**Test Prompt Engine** reports node installation, LM Studio connectivity, the
fixed `qwen/qwen3.8-27b` availability, and readiness. If that exact model is
missing, the request fails before reference upload or H3 queueing with
`qwen/qwen3.8-27b is not available in LM Studio on the remote PC.` Every other
LM Studio model is ignored and there is no model selector.

The autonomous contract always addresses `qwen/qwen3.8-27b`. LM Studio owns its
context, GPU/offload, tensor placement, quantization, flash attention, chat
template, reasoning, and other runtime configuration. Creative Studio sends no
model-management overrides; the internal request contract retains only the
bounded completion budget, rewrite/repair timeout, repair count, and
temperature needed by the enhancer.

The authoritative system prompt is the exact file
`prompts/minimax-h3-lmstudio-system.md`. The main process reads it as UTF-8,
hashes the exact bytes, and injects it as the final
`system_prompt_override` input. Blank override retains upstream behavior;
populated override is passed verbatim and remains in effect for repair
attempts. A missing or empty file blocks autonomous H3 before the remote
workflow is submitted.

### Timeout and token ownership

The production failure occurred when node `149` stopped the LM Studio request
after roughly 120 seconds. The timeout owner is the pinned enhancer's direct
HTTP transport: the same `timeout_seconds` value is used as its read timeout
for the initial rewrite and every bounded repair. Electron's 10-second timer
only protects the `/system_stats` health check, and the ComfyUI job watcher has
no 120-second or 600-second whole-job deadline. The old 120-second effective
value and the interim 300-second app/node default migrate to 600 seconds; the
new timeout is `PROMPT_GENERATION_TIMEOUT` when node `149` reports a timeout.

Creative Studio does not own the Qwen output-token limit. Autonomous node 149
omits `max_tokens`, the native LM Studio request omits `max_output_tokens`, and
the OpenAI-compatible fallback omits `max_tokens`. No limit is derived from
`context_size`, and history does not claim that Creative Studio configured an
effective token budget. LM Studio's existing configuration remains authoritative.

Remote prompt rewrites and their sequential repairs are serialized by the
patched node. Creative Studio does not launch a concurrent retry while the
first Qwen request is still active.

No `mmproj` or model-loading auto-selection behavior was changed. If the
China PC still shows multimodal-load delays after this fix, investigate the
matching Qwen/mmproj pair manually on that machine before changing the graph;
this checkout does not claim an mmproj canary.

## Language, audio, and direct settings

The canonical language value is `Indonesian`. The patched validator accepts
`Indonesian`, `Bahasa Indonesia`, `Bahasa`, and `id-ID`, and normalizes them
for validation so `<d>[Indonesian] ...</d>` is valid. English remains
available.

The brief carries Music Only, Captions, Subtitles, and sound direction. When
Music Only is enabled, Qwen receives:

```text
No dialogue, voiceover, narration, creator speech, or other human speech.
```

When captions or subtitles are disabled, Qwen receives the corresponding
negative instruction. Visible packaging text is explicitly not treated as a
generated caption or subtitle.

Duration, aspect ratio, megapixels, multiple, FPS, steps, scheduler, seed, and
`ref_image_size` are direct control-plane values. The brief may describe
duration and aspect ratio to Qwen, but Qwen cannot override graph settings.
The current workflow is Ref2VA only, with H3 frames calculated as
`5 + 17 × ceil((duration × 24 − 5) / 17)`.

The same ordered concrete-reference contract drives the physical `LoadImage`
connections, node `148` text, and node `153` manifest. The pinned node's
legacy-compatible manifest parser assigns picture labels from input order and
accepts explicit subject definitions; Creative Studio therefore declares only
the selected product as `<Subject 1>` for a normal one-product job. No OCR dump
or unverified packaging copy is added.

The serialized brief includes the single-shot timing contract and a repair
contract. Repairs keep the exact system override, mode, manifest, context, and
validator issues because the pinned enhancer owns the bounded repair loop and
receives those same node inputs on every attempt.

## VRAM handoff

The graph enforces this order:

```text
LM Studio discovery → rewrite → repair attempts → validate → gate
  → unload exact emitted loaded Qwen instance → verify unload → queue H3
```

The enhancer emits the fixed model ID and exact instance ID returned by LM
Studio. The unload
node verifies that exact pairing against LM Studio's model list, posts only that
instance ID to `/api/v1/models/unload`, and confirms that the emitted instance
is no longer loaded. It does not unload unrelated models. The job persists
`llmUnloadRequested`, `llmUnloadSucceeded`, `llmUnloadError`, and
`llmUnloadDurationMs`.

## Status and failure handling

The successful pipeline stages are:

`PREPARING`, `UPLOADING_REFERENCES`, `WRITING_PROMPT`,
`VALIDATING_PROMPT`, `UNLOADING_LLM`, `QUEUED_H3`, `GENERATING_H3`, `RELEASING_H3_VRAM`,
`DOWNLOADING`, `COMPLETE`.

Failure stages are:

`REFERENCE_UPLOAD_FAILED`, `LLM_UNAVAILABLE`, `PROMPT_GENERATION_FAILED`,
`PROMPT_GENERATION_TIMEOUT`, `PROMPT_VALIDATION_FAILED`, `LLM_UNLOAD_FAILED`, `H3_QUEUE_FAILED`,
`H3_GENERATION_FAILED`, `DOWNLOAD_FAILED`.

`LLM_UNAVAILABLE` covers connection refusal, a missing/unavailable target model,
and unavailable endpoints. Other LM Studio models never affect this decision.
It is not a raw HTTP 503 stage by itself.

The validity gate prevents any H3 GPU execution when validation is false after
all configured repairs. A generation failure preserves the final prompt and
validation report when available. A download failure retains the remote
output descriptor and can be retried without regenerating H3.

## History and reproducibility

Every generation records product, content family, CreativeGenome,
`H3GenerationBrief`, exact system-prompt SHA-256, the fixed model ID and exact
LM Studio instance ID, temperature,
`llmModel`, `llmTemperature`, `llmTimeoutSeconds`,
`llmRepairAttempts`, `llmDisableThinking`, repair count, final enhanced prompt,
validation report, ordered reference map,
duration, aspect ratio, megapixels, multiple, FPS, steps, scheduler, seed,
`refImageSize`, remote prompt UUID, output path, status, stage timings, and
unload diagnostics. The final H3 prompt is shown in a read-only expandable
debug panel with prompt-engine, rewrite, validation, and repair metadata.

## Third-party dependency and patch

The node pack is pinned to upstream commit
`66858ebd55a52924d4b113fcd518726b2038a77c` from
[ComfyUI-MiniMax-H3-Prompt-Enhancer](https://github.com/hyukudan/ComfyUI-MiniMax-H3-Prompt-Enhancer).
The patch and application instructions are in
`patches/ComfyUI-MiniMax-H3-Prompt-Enhancer/`.

The patch is intentionally append-only for the new enhancer input so
positionally stored ComfyUI widget values stay compatible. It adds the
system-prompt override, repair propagation, Indonesian aliases, validity
gate, exact-emitted-instance LM Studio unload node, timeout classification, the
600-second default, exact max-token handling, and serialized remote rewrites.
The patch was checked with `git apply --check` against the pinned upstream
commit. It leaves LM Studio's model/runtime configuration and normal JIT or
autoload behavior under China-side control.

## Canary and current blockers

The requested canary settings are represented by the UI and contract tests:

```text
Cleanser · Product B-Roll · 8 sec · 9:16 · 0.98 MP · multiple 32
24 FPS · 20 steps · simple scheduler · ref_image_size max
Music Only on · English
```

The exact local brief can be generated deterministically after Creative
Diversity selects its seed/genome. A real end-to-end result—remote upload,
Qwen rewrite, validation, unload, H3 MP4, download path, and playback—cannot
be truthfully reported from this checkout because the China PC and its
services are not connected here. The exact system-prompt file is present and
is still read and hashed from the repository; the remote canary remains the
next operational step.

Once available, the canary should verify: no ChatGPT interaction, reference
upload before `POST /prompt`, CreativeGenome selection, brief serialization,
Ref2VA validation pass, exact emitted-instance unload verification, H3 completion,
MP4 download to the laptop, and playback in the H3 right rail.
