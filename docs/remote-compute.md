# Remote Compute

Remote Compute is the execution boundary for autonomous MiniMax H3 jobs. The
laptop calls only the configured HTTPS ComfyUI server. The China RTX 5090 PC
runs ComfyUI, the patched prompt-enhancer nodes, LM Studio, Qwen, and the H3
graph. The laptop never calls `127.0.0.1:1234` and never runs an LLM.

## Control plane and execution plane

Creative Studio owns the product, content family, Creative Diversity choice,
user idea/instructions, references, language, audio/text flags, duration,
aspect ratio, megapixels, multiple, FPS, steps, scheduler, seed,
`ref_image_size`, output folder, history, status, download, and playback.

The execution PC owns LM Studio, the exact discovered Qwen model ID, prompt
rewriting, validation and repair attempts, temporary ComfyUI files, VRAM
handoff, MiniMax H3 sampling, and remote output metadata.

The visible ChatGPT browser remains available to the unrelated Images tab. It
is not rendered, opened, called, or used by the H3 page.

## Configuration

Settings → Remote compute configures the HTTPS ComfyUI URL, API-format workflow
path, laptop output folder, and automatic download. Autonomous H3 always uses
the remote provider, even if the legacy Local compute option is selected; the
legacy option exists only for development/troubleshooting.

The H3 Prompt Engine section is a compact read-only status surface:

- `LM Studio Connected` (or unavailable).
- `Model` — `Qwen 3.8 27B` (`qwen/qwen3.8-27b`).
- `Status Ready` (or the actionable discovery error).

The target model ID is fixed by the autonomous contract. Its context length,
GPU/offload, tensor placement, quantization, flash attention, chat template, and
reasoning configuration remain exclusively in LM Studio. Creative Studio does
not offer a model selector or send model-management overrides. The internal request contract keeps the bounded completion budget,
rewrite/repair timeout, repair count, and temperature out of the normal UI.

The advanced connection detail is `http://127.0.0.1:1234/v1`. That address is
local to the remote China compute PC. It is sent as a ComfyUI node setting;
the laptop does not open that address. ComfyUI calls LM Studio locally.

`prompts/minimax-h3-lmstudio-system.md` is authoritative. The Electron main
process reads its exact UTF-8 contents, hashes the bytes with SHA-256, and
injects them as `system_prompt_override`. A missing or empty file fails closed
before `POST /prompt`; Creative Studio does not rewrite, summarize, or replace
the supplied system prompt.

Use **Test Prompt Engine** to inspect the remote graph and model discovery.
The result reports:

- Prompt Enhancer: Installed / Missing.
- Prompt Validator: Installed / Missing.
- LM Studio: Connected / Unreachable.
- Model: `Qwen 3.8 27B` (`qwen/qwen3.8-27b`).
- Qwen: Ready / not ready.

If `qwen/qwen3.8-27b` is missing, the request fails before reference upload or
H3 queueing with `qwen/qwen3.8-27b is not available in LM Studio on the remote
PC.` Every other LM Studio model is ignored; Creative Studio never asks the
user to select a model.

## Data contract

The H3 page first runs Creative Diversity and then sends an
`H3GenerationBrief`, its deterministic text serialization, a separate
reference context, direct workflow settings, and prompt-engine settings. The
brief contains the selected `CreativeGenome` direction, product-specific
corrections, ordered reference roles, language, audio/text flags, and user
instructions. It is deliberately not the final six-section H3 prompt.

The main-process request includes no final prompt for autonomous jobs. The
remote nodes produce the final prompt. Direct values remain direct workflow
inputs: Qwen may use duration/aspect ratio as writing context, but it cannot
change resolution, FPS, sampling, scheduler, seed, or reference sizing.

## Workflow topology

The checked-in API graph is `workflows/minimax-h3-api.json`. The active prompt
path is:

```text
H3GenerationBrief
  → 147 PrimitiveStringMultiline
  → 149 MiniMaxH3PromptEnhancer
  → 150 MiniMaxH3PromptValidator
  → 152 MiniMaxH3UnloadLMStudioModel
  → 151 MiniMaxH3PromptValidityGate
  → 136 MiniMaxH3ReferenceToVideo.prompt
```

Reference tensors stay separate from text:

```text
product/reference file
  → POST /upload/image
  → 137 LoadImage
  → 136 ref_images.ref_image_0

optional second reference
  → 139 LoadImage
  → 136 ref_images.ref_image_1
```

Node `148` carries the separate reference context into the enhancer and
validator. Node `153` carries the exact legacy-compatible `media_manifest`
string into both nodes. The manifest and context are derived from the same
ordered concrete-reference mapping: a single product is `<Picture 1>` and
`<Subject 1>`; a text-only custom style note is not promoted to a connected
picture. Node `138` is retained only as a disconnected migration input for old
direct-development requests; it is not on the production prompt path.

### Active node IDs

| Node | Class | Responsibility |
| --- | --- | --- |
| `147` | `PrimitiveStringMultiline` | Serialized `H3GenerationBrief` |
| `148` | `PrimitiveStringMultiline` | Separate reference context |
| `153` | `PrimitiveStringMultiline` | Exact `media_manifest` shared by enhancer and validator |
| `149` | `MiniMaxH3PromptEnhancer` | Qwen rewrite, exact system prompt, bounded repairs |
| `150` | `MiniMaxH3PromptValidator` | Returns `prompt`, `valid`, `validation_report` |
| `151` | `MiniMaxH3PromptValidityGate` | Final blocking decision after cleanup; raises on invalid prompt or unload failure |
| `152` | `MiniMaxH3UnloadLMStudioModel` | Unloads and verifies only the exact model instance emitted by node `149`, including invalid prompts |
| `137` | `LoadImage` | `<Picture 1>` → `ref_image_0` |
| `139` | `LoadImage` | `<Picture 2>` → `ref_image_1` when supplied |
| `136` | `MiniMaxH3ReferenceToVideo` | Locked `REF2VA` image/video/audio generation |
| `92` | `SaveVideo` | Remote MP4 output |

Creative Studio validates these links and placeholders before upload or queue.
An unresolved token, wrong node class, wrong critical link, wrong mode, or
direct-setting mismatch stops the job locally.

Node `149` receives temperature, timeout, and repair-attempt count, but no
output-token limit. LM Studio remains authoritative for output length and model
runtime settings, including reasoning and chat template. The production
rewrite and every repair retain the 600-second read timeout; `context_size` is
a separate local-GGUF control and cannot create an LM Studio token limit. The
timeout does not cap the overall H3 generation or the ComfyUI watcher.

## Direct settings

The app is the source of truth for the direct H3 values:

| Studio setting | Graph destination |
| --- | --- |
| Duration | frame formula → node `131` → node `136.length` |
| Aspect ratio | node `115.aspect_ratio` (`ResolutionSelector`) |
| Megapixels | node `115.megapixels` |
| Multiple | node `115.multiple` |
| FPS | node `130.fps` |
| Steps | node `143` → node `142` → node `124.steps` |
| Scheduler | node `124.scheduler` |
| Seed | node `129.noise_seed` |
| Ref image size | node `136.ref_image_size` |

Frames use the H3 grid `5 + 17 × ceil((duration × 24 − 5) / 17)`. The current
graph is Ref2VA only; the request and graph both lock `REF2VA`. Qwen is told
that it must not switch to T2VA, I2VA, FL2VA, or L2VA.

The deterministic brief also carries a single-shot timing contract: numeric
event times are not written inside shot prose unless the user supplied them;
chronology is described with words such as begins, then, gradually, toward the
end, and finally. The validator's `valid` result remains the hard gate;
`qualityValid` and word-count coverage are diagnostic signals only.

## Reference uploads

The main process resolves local references only inside authorized product or
reference roots, checks the extension, size, and non-empty file content, then
uploads them as multipart `POST /upload/image`. The returned ComfyUI filename,
not a laptop path, is placed in `LoadImage`. Uploading happens before
`POST /prompt`; a failed upload cannot queue H3. Unused reference links are
removed so an empty `LoadImage` is never executed.

## Prompt validation and VRAM handoff

The production order is:

```text
LM Studio exposes qwen/qwen3.8-27b
  → Qwen rewrite and repairs, if needed
  → validator
  → unload the exact emitted model instance
  → verify instance is gone
  → validity gate
  → queue MiniMax H3
```

`MiniMaxH3UnloadLMStudioModel` runs before the final decision, including when
the validator returns `valid = false`. It receives the exact model and instance
IDs emitted by node `149`, verifies that pairing against LM Studio
`/api/v1/models`, posts only that instance ID to `/api/v1/models/unload`, and
rechecks the model list. It does not unload unrelated models. The gate then
blocks invalid prompts with `PROMPT_VALIDATION_FAILED`, or blocks a valid prompt
when cleanup could not be verified with `LLM_UNLOAD_FAILED`. The original
validation or generation error remains the primary failure while cleanup
telemetry persists separately in `llmUnloadRequested`, `llmUnloadSucceeded`,
`llmUnloadError`, `llmInstanceId`, and `llmUnloadDurationMs`.

Before a new autonomous prompt job, the ComfyUI extension also checks the queue
under its mutex, identifies only stale `qwen/qwen3.8-27b` instances, unloads one
exact instance when safe, and calls ComfyUI `/free` when Qwen or excessive VRAM
is present. Active or queued prompts never trigger a guessed unload. Recovery
telemetry is persisted with the job (`staleQwenDetected`,
`staleQwenInstanceId`, `staleQwenUnloadAttempted`,
`staleQwenUnloadSucceeded`, `comfyFreeAttempted`, and `observedFreeVram`).

See [H3 → Qwen VRAM handoff](h3-vram-handoff.md) for bounded release verification,
serialization, persisted diagnostics, and the hardware comparison status.

## Lifecycle and failure states

Successful stages are:

`PREPARING` → `UPLOADING_REFERENCES` → `WRITING_PROMPT` →
`VALIDATING_PROMPT` → `UNLOADING_LLM` → `QUEUED_H3` → `GENERATING_H3` →
`RELEASING_H3_VRAM` → `DOWNLOADING` → `COMPLETE`.

The persisted failure stages are:

`REFERENCE_UPLOAD_FAILED`, `LLM_UNAVAILABLE`, `PROMPT_GENERATION_FAILED`,
`PROMPT_GENERATION_TIMEOUT`, `PROMPT_VALIDATION_FAILED`, `LLM_UNLOAD_FAILED`, `H3_QUEUE_FAILED`,
`H3_GENERATION_FAILED`, and `DOWNLOAD_FAILED`.

Connection refusal, missing/unavailable models, and unavailable LLM endpoints
are classified as `LLM_UNAVAILABLE`; a timeout is classified separately.

The UI shows the current stage and friendly diagnostic. A generation failure
keeps the final prompt and validation report when they exist. A download
failure does not regenerate H3; **Download result** can be retried against the
stored remote output metadata.

## Persistence and result return

Each job stores its local ID, authoritative ComfyUI prompt UUID, product,
content family, CreativeGenome, `H3GenerationBrief`, system-prompt hash, exact
LM Studio model ID, temperature, `llmModel`, `llmTemperature`,
`llmTimeoutSeconds`, `llmRepairAttempts`,
`llmDisableThinking`, repair count, final enhanced prompt,
validation report, ordered reference map, exact media manifest, allowed labels,
physical uploaded filename/slot bindings, all direct H3 settings, output path,
status, stage timings, and unload diagnostics. `remote_h3_jobs` is reconciled
after restart; H3 history stores the same generation audit fields through the
persisted generation brief.

After completion, the provider selects the video from SaveVideo node `92` and
downloads it to the configured laptop folder using the ComfyUI output
descriptor. The right rail shows the remote preview, downloaded path, status,
and playback/open actions. The final H3 prompt is expandable and read-only.

## ComfyUI endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /system_stats` | ComfyUI/GPU connection check |
| `GET /object_info` | Confirm enhancer/validator/gate/unload nodes |
| `POST /minimax_h3_prompt_enhancer/models` | ComfyUI-mediated LM Studio model discovery |
| `POST /proya/auto/qwen-recovery` | Queue-safe stale canonical-Qwen inspection and exact cleanup |
| `POST /upload/image` | Reference upload |
| `POST /prompt` | Queue the validated API graph |
| `WS /ws?clientId=...` | Live execution/progress events |
| `GET /queue` | Queue fallback/reconciliation |
| `POST /free` | Unload H3 models and executor caches after completed execution |
| `GET /history/{prompt_id}` | Completion, errors, output descriptors |
| `GET /view?...` | Output download/preview |

The laptop never calls LM Studio's `/v1` endpoint or model-management API.
Those requests are made by the patched ComfyUI-side node on the execution PC.

## Third-party node patch

The dependency is pinned to upstream commit
`66858ebd55a52924d4b113fcd518726b2038a77c` from
[ComfyUI-MiniMax-H3-Prompt-Enhancer](https://github.com/hyukudan/ComfyUI-MiniMax-H3-Prompt-Enhancer).
The documented patch is in
`patches/ComfyUI-MiniMax-H3-Prompt-Enhancer/0001-proya-autonomous-h3.patch`.
It appends `system_prompt_override` as the final enhancer input, preserves
upstream behavior when blank, carries the override through repairs, adds
Indonesian aliases, and adds the validity-gate and exact-emitted-instance unload
nodes. Apply `0001`, `0002`, `0003`, and `0004-proya-qwen-finalization.patch`
in order after checking out the pinned SHA and restart ComfyUI. The final patch
puts exact Qwen cleanup before the validity gate, adds error-path cleanup and
the queue-safe stale-Qwen recovery route.

## Future 24/7 generation

The persisted brief, genome, settings snapshot, prompt-engine audit, remote
UUID, output metadata, failure stage, and timings provide the data needed for
future unattended generation analysis. A later scheduler can select a new
Creative Diversity seed, submit the same typed contract, and analyze novelty,
failure rates, prompt repair counts, VRAM handoff time, generation time, and
download reliability. Scheduler/worker policy is intentionally outside this
H3 UI migration.

## Current blockers

The exact system-prompt file is present at
`prompts/minimax-h3-lmstudio-system.md` and is verified byte-for-byte before
submission. The physical China PC canary remains to be run with the pinned
node pack, patch, LM Studio Qwen model, ComfyUI graph, and a real reference
image.
