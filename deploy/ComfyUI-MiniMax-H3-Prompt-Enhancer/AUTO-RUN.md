# PROYA Continuous H3 archive extension

This package retains the existing prompt enhancer, exact-instance Qwen unload, validator, and H3 workflow. Prompt finalization now runs as validator → exact Qwen unload → validity gate, so an invalid prompt cannot bypass cleanup. Enhancer/timeout failures carry a best-effort exact-instance cleanup result, and the additional `auto_archive.py` and `auto_routes.py` register archive, targeted interruption, and stale-Qwen recovery routes in the China ComfyUI process.

## Install on the China PC

1. Stop ComfyUI normally and back up its existing `custom_nodes/ComfyUI-MiniMax-H3-Prompt-Enhancer` folder.
2. Extract the supplied ZIP. Copy its `ComfyUI-MiniMax-H3-Prompt-Enhancer` directory into `ComfyUI/custom_nodes`, replacing the previous package files.
3. Ensure the Windows account running ComfyUI can create and write `D:\AI Videos`.
4. Restart ComfyUI. No LM Studio changes, model changes, prompt changes, or token-limit changes are required.
5. Open the new laptop app, select H3 → Auto Run, choose products/content types, and press Start when ready. Start checks the archive route and both output roots before creating the session.

For a different archive location, set `PROYA_H3_ARCHIVE_ROOT` in the China ComfyUI process environment before startup and enter the same absolute path under Auto Run → Output on the laptop. A laptop request cannot change the server's allowed archive root.

## Routes

- `POST /proya/auto/archive/check`: verifies the configured root and performs a temporary write probe.
- `POST /proya/auto/archive`: copies a SaveVideo MP4 from the configured ComfyUI output directory into the configured archive root, using a temporary file and size verification. Repeated requests for the same destination are idempotent. Original output remains intact.
- `GET /proya/auto/archive/file`: serves only MP4 files inside the configured archive root for resumable laptop download attempts.
- `POST /proya/auto/interrupt`: interrupts only the specified prompt if it currently owns the GPU, holding the ComfyUI queue mutex across the check and interruption. It does not interrupt an unrelated job or delete queued jobs.
- `POST /proya/auto/qwen-recovery`: while holding the ComfyUI queue mutex, inspects only `qwen/qwen3.8-27b` through LM Studio's native `/api/v1/models` endpoint and unloads one exact stale instance. It refuses to guess when multiple instances exist or when any prompt is active/queued.

All routes use the existing ComfyUI server/authentication boundary. Absolute relative paths, `..`, alternate separators, Windows drive/ADS syntax, and resolved symlink/junction escapes are rejected. The source is restricted to ComfyUI's output directory; the destination is restricted to the server-configured archive root.

The targeted interruption implementation follows the queue mutex and running-item contract in [ComfyUI execution.py](https://github.com/comfyanonymous/ComfyUI/blob/master/execution.py).

## Output and verification

Both machines use `<date>/<product>/<content-type>/<timestamp>__<product>__<content-type>__<fingerprint-hash>__<seed>__<job-id-suffix>.mp4`.

The full globally unique job ID remains in the ComfyUI SaveVideo prefix, workflow metadata, and Creative Studio SQLite records. The archive/laptop filename contains its 12-character unique suffix to keep Windows paths short. The job record maps both final paths to the full identity.

Archive copy failure is recorded separately and retried; it never requests another render. Laptop downloads read the archive rather than depending on the original output. Downloaded files must be nonempty and match the archived byte count before promotion from a temporary file. One laptop download runs at a time.

Run local archive regression checks with `py test_auto_archive.py`. No ComfyUI or GPU is required for these tests. A symlink test is skipped when the Windows account lacks permission to create symlinks.
