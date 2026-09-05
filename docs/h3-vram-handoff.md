# H3 → Qwen GPU handoff

The service serializes Creative Studio generations. It captures completed
ComfyUI history and SaveVideo descriptors, enters `RELEASING_H3_VRAM`, sends
`POST /free` with `{"unload_models":true,"free_memory":true}`, and waits for
cleanup before downloading the MP4. Automatic download being disabled does
not disable cleanup.

Execution completion must be explicit in history. Intermediate outputs,
including SaveVideo metadata alone, cannot mark an executing graph complete.
The release path also handles finished failures, which can retain models.

## Verification and persistence

ComfyUI's native endpoint only sets executor flags. The worker later unloads
models, resets executor caches, collects garbage, and empties the device cache.
See the upstream [endpoint](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py)
and [executor worker](https://github.com/Comfy-Org/ComfyUI/blob/master/main.py).

The provider requires both running and pending queue arrays to be empty. It
rechecks immediately before `/free`, after the pre-release telemetry read.
A busy or unreadable queue prevents the request. After acknowledgement it
polls queue and `/system_stats` at one-second intervals for up to 15 seconds,
with a 20-second overall bound including transport and pre-release checks.

Verification requires two consecutive samples showing no more than 256 MiB
of Torch reservations on every reported GPU, with the queue still idle.
Device usage must also be no greater than 2 GiB or 10% of total capacity,
whichever is larger, allowing display/OS overhead. This checks device headroom
as well as Torch accounting; CUDA malloc async pools and other processes may
occupy VRAM that is absent from Torch reservations.
This is a conservative reservation threshold, not an exact model-count API.
The global `vram_free` value alone is insufficient: ComfyUI can include Torch
cache in that figure. Both before/after device snapshots are retained for
comparison and diagnosis.

The following fields persist in `remote_h3_jobs.stateJson`, survive SQLite
reopen, and are exposed on the job record and live state:

- `h3VramReleaseRequested`: whether the POST was attempted.
- `h3VramReleaseSucceeded`: `true` when GPU reservations meet the criterion;
  `false` for busy queues, transport/HTTP failure, or occupied GPU memory;
  `null` when the acknowledged request and bounded idle wait finished but
  telemetry could not verify release.
- `h3VramReleaseDurationMs`: elapsed duration, including unsuccessful attempts.
- `h3VramReleaseError`: failure or unverified-release warning; `null` on verification.
- `h3VramBeforeRelease` / `h3VramAfterRelease`: timestamped GPU snapshots.

A release failure or unavailable telemetry never changes a successfully
downloaded video into a failed download. The status card shows the release
result, duration, and warning separately.

## Subsequent generations and recovery

The main process acquires its submission guard before the first async call.
Concurrent submissions are rejected. An executing prior job prevents a new
submission; an ongoing completion/release is awaited. The server queue is
checked even if the local app has no history.

Before the next workflow containing Qwen is submitted, the latest generation's
release must have finished. Failed release attempts are retried while idle;
a repeat failure blocks submission. An unverified release permits submission
only after its acknowledged request and bounded idle wait have finished, with
the warning retained. Restart recovery resumes interrupted cleanup, including
when automatic downloading is off. Polling, duplicate completion callbacks,
and manual downloads share the same in-flight release.

This serializes submissions from this Creative Studio service. Native ComfyUI
does not provide an atomic cross-client queue reservation; another client
submitting work is detected by queue rechecks and causes release verification
to fail.

LM Studio configuration and the workflow's Qwen/H3 inputs are unchanged.
The model remains `qwen/qwen3.8-27b`, the prompt timeout remains 600 seconds,
and node 152 continues to unload and verify the exact emitted Qwen instance
before H3 executes.

## Hardware validation, 2026-09-05

Status: validation complete. Classified as **ComfyUI/H3 retained VRAM**: the
native release returned 20.76 GiB of device memory, the next Qwen prompt
returned to normal throughput, and the completed video downloaded successfully.

The configured server initially returned one running prompt:
`5e3d7ecd-f86c-4f3e-9a08-968d1e69d512`, with no pending prompts. A read-only
`/system_stats` sample reported:

| Field | Bytes |
| --- | ---: |
| GPU | NVIDIA GeForce RTX 5090, CUDA malloc async |
| `vram_total` | 34,190,458,880 |
| `vram_free` | 14,203,469,043 |
| `torch_vram_total` | 7,046,430,720 |
| `torch_vram_free` | 6,855,146,739 |

This sample was obtained while work was active, not after verified H3
completion, so it cannot establish retained post-render memory. History reads
then timed out. At 10:40 WIB the queue and history endpoints returned
Cloudflare Tunnel error 1033; a subsequent queue request also timed out.
The tunnel briefly recovered at 10:51 WIB. The queue was idle and the observed
job's history confirmed successful completion with SaveVideo output
`PROYA_H3_20260905033201_0_00001_.mp4`. The post-completion sample reported
`vram_free = 9,982,661,576`, `torch_vram_total = 100,663,296`, and
`torch_vram_free = 59,986,888` bytes. Thus Torch reservations were only 96 MiB
while overall free VRAM was about 9.3 GiB. This motivated the regression test
requiring both device headroom and small Torch reservations. It does not
identify which process or allocator held the remaining memory.

Three initial live attempts through the implemented release method timed out on
the required history check, before any `/free` POST. Each persisted
`h3VramReleaseRequested = false`, `h3VramReleaseSucceeded = false`, duration,
and the transport error.

Using IPv4 for the standalone test process then allowed the implemented method
to finish at 11:02 WIB. The history and idle-queue checks passed, the native
POST was acknowledged, and two GPU samples verified the release in 7,208 ms:

| Measurement | Before `/free` | After verified release |
| --- | ---: | ---: |
| Free device VRAM | 9,982,661,576 bytes (9.30 GiB) | 32,269,926,400 bytes (30.05 GiB) |
| Torch reservations | 100,663,296 bytes (96 MiB) | 67,108,864 bytes (64 MiB) |

The POST returned 22,287,264,824 bytes (20.76 GiB) of GPU memory to the device.
`h3VramReleaseRequested` and `h3VramReleaseSucceeded` were both `true` and
`h3VramReleaseError` was `null`. No LM Studio/runtime settings were changed.

The user supplied baseline LM Studio logs from the original prompt at
11:32:29 and 11:32:34 on the execution PC: 633 output tokens per response,
6,263 input tokens, and 124.8046 / 124.5772 tokens/sec. Those are two responses
within the original prompt stage, not two H3 generations.

A prompt-only test graph was prepared by copying node 152 and all of its
ancestors unchanged from the completed production graph, with `PreviewAny`
as its output. This would run Qwen, validation, and exact-instance unload
without a second H3 render. Its pre-submission queue check timed out; follow-up
queue/system requests returned HTTP 502. The service later recovered, and the
prompt-only test was submitted once as
`0f6146d2-5530-4113-9deb-52e41362dd63`. It successfully executed node 149
from 12:10:26.309 to 12:11:01.430 China time (35,121 ms), then validation,
the exact-instance unload, and the text preview. Full completion took 45,255 ms.
No second H3 render was submitted. All copied node inputs were checked against
the original graph and remained identical.

The original MP4 also downloaded successfully after VRAM release: 2,711,239
bytes, with an MP4 file-type header. Thus the remote output survived model and
cache cleanup and could be retrieved without H3 resident on the GPU.
The observed enhancer diagnostics contain character/word budgets rather than
runtime token counts or generation speed, so they cannot supply baseline
tokens/sec. See [machine-readable observations](h3-vram-handoff-canary.json).

| Required comparison | Result |
| --- | --- |
| First Qwen tokens/sec | 124.8046 / 124.5772, user-supplied original-stage logs |
| H3 complete / SaveVideo capture | Confirmed after temporary tunnel recovery |
| Post-H3 release / GPU confirmation | Passed: 9.30 → 30.05 GiB free in 7.208 s |
| Second Qwen prompt after release | Passed: prompt stage 35.121 s; first response 68.8441 tokens/sec; later responses 131.7884 / 131.9709 tokens/sec |
| Video download after release | Passed: original 2,711,239-byte MP4 retrieved |
| Root-cause classification | ComfyUI/H3 retained VRAM |

The user supplied the second run's LM Studio counters, matching the observed
execution interval. Its first response at 12:10:47 generated 637 tokens at
68.8441 tokens/sec; the model separately reported 13.12 seconds of load time
and 2.1568 seconds to first token. Later responses at 12:10:52 and 12:10:57
each generated 637 tokens at 131.7884 and 131.9709 tokens/sec. Those later
responses are comparable to the provided 124.6–124.8 tokens/sec baseline.
This records the slower first response after reload as well as subsequent
throughput; it does not imply every response ran at 132 tokens/sec.

The exact Qwen instance was verified unloaded after the second prompt in
6,486 ms. No prompt timed out. The 35.121-second prompt-stage duration includes
loading, generation, and repairs and is not used to calculate tokens/sec.
The speed comparison uses the runtime counters supplied by the user. No
additional H3 render or LLM runtime change was needed.

## Local validation

`npm test`: 253 tests passed in 19 files. Targeted ESLint passed for all changed
TypeScript files. The normal build's typecheck and compilation passed; its
default Windows output directory was locked (`EBUSY`). The complete build
passed with `npm run build -- --config.directories.output=release/h3-vram-handoff`,
producing the updated Windows app in a separate directory. Inspection of its
packaged `app.asar` confirmed the release stage, native POST body, headroom
check, and submission guard. Packaged workflow and system-prompt hashes match
the unchanged source files.
