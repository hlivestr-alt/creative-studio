# Autonomous continuous H3 generation

## Implementation

1. **Auto Run UI:** H3 includes Single Video / Auto Run, ordered multiselections, existing Creative Variety, repeat forever, optional shuffles, output roots and laptop folder picker. All products and every current registry entry are selected initially. The registry currently includes eight entries, including Custom.
2. **State model:** `AutoH3Session` and `AutoH3Job` are persisted in SQLite tables `auto_h3_sessions` and `auto_h3_jobs`. The session stores selection/order, cycle/seed/cursor, counters, stop intent, current/last-successful identity, output roots, and errors. Terminal result and cursor advancement are committed together. SQLite exports use flushed temporary files followed by atomic replacement.
3. **Traversal:** product outer loop, content type inner loop, then a new cycle indefinitely. Only the current job is submitted to the existing `ComputeService.submitH3` engine. Cycle/product shuffles are optional and do not change selection membership.
4. **Transport:** main-process scheduler and download retry ticks run every 5 seconds. Existing WebSocket monitoring reconnects indefinitely every 5 seconds, with queue/history polling fallback and progress reconciliation. Offline jobs retain their identities and remain pending.
5. **Idempotency:** full identity is saved before `/prompt`, embedded in the SaveVideo filename prefix and metadata, and reconciled in queue/history after ambiguous responses. A known prompt UUID is monitored directly. An empty queue/history response cannot prove nonacceptance, so an unresolved ambiguous job is held for reconciliation; it is never blindly reposted. Definitive validation failures have bounded job retries.
6. **China archive:** the bundled extension copies output locally to `D:\AI Videos` by default. It verifies a nonzero matching size and preserves the original. Archive failure is separate from render failure and retries independently. The server configuration controls the allowed root.
7. **Laptop queue:** defaults to `C:\Users\HYPE AMD\Videos\04 AI Model Work\MiniMax`. A single background worker downloads from the verified archive, checks byte count, then promotes the temporary file. Network errors remain `PENDING_DOWNLOAD`; explicit cancellation aborts the active transfer. A slow download does not occupy the generation slot.
8. **Folder layout:** both machines mirror `<date>/<product>/<content-type>/<timestamp>__<product>__<content-type>__<fingerprint-hash>__<seed>__<job-id-suffix>.mp4`. The database holds full identity and both absolute paths.
9. **Stop:** Stop After Current saves stop intent immediately, drains the current render, attempts archive, completes VRAM release, and schedules no next video. Archive/download retries can continue separately. Advanced Stop Now targets only the current prompt and suppresses rerender retries. A queued prompt is allowed to drain; unrelated work is never interrupted.
10. **Recovery:** reopening displays “Previous Auto Run interrupted” with Resume / Stop Session. No GPU generation starts automatically. Resume reconciles the saved current job. Pending downloads resume automatically, including output captured immediately before a crash. Stop Session drains a known in-flight job; it does not pretend an unreachable remote job has stopped.
11. **Variety:** each attempt receives a new creative seed, CreativeGenome selection, fingerprint calculation, and random H3 seed when Random is selected. Cycle seeds are fresh and persistent. A larger same-product/content history window and candidate search discourage repeats while preserving coherent concepts and existing truth/constraints. Finite compatible creative pools can still require the existing least-repeated fallback.
12. **Validation:** see the validation record below. All execution tests use simulated providers; no continuous generation or GPU render is started as part of development or packaging.
13. **Laptop package:** `release/auto-h3-20260907/win-unpacked/PROYA Creative Studio.exe`.
14. **China package:** `release/auto-h3-20260907/PROYA-China-Auto-H3-20260907.zip`. Deployment instructions are in `AUTO-RUN.md` inside the package. The package is prepared locally; it has not been installed on the China PC by this task.

## Failure and handoff details

Prompt/planning failures allow two job-level retries; H3 failures allow one. Each retry has its own identity, fresh creative plan and diagnostics. Exhausted combinations advance normally. VRAM release failure is a handoff barrier, so retries or the next product cannot start Qwen until cleanup is verified by the existing engine.

The successful path remains Qwen → rewrite/validate → exact Qwen instance unload → H3 → SaveVideo → persist descriptor → China archive attempt → existing `/free` and release verification → next job. An archive-copy failure retains the original descriptor and retries separately; it does not consume a rerender retry.

If a POST response is lost and ComfyUI subsequently loses both queue and history (for example, the China server restarts), acceptance can remain unknowable. The session stays pending with a diagnostic instead of risking a duplicate render. Stop After Current also needs connectivity to confirm that an in-flight remote job and its cleanup have completed.

Single Video continues to use its existing Generate action and engine. While an Auto Session is active or interrupted, a main-process guard prevents competing single-video submissions. The fixed Qwen model, LM Studio output-token ownership, 600-second timeout, system prompt, verified product truth, reference mapping and H3 settings/VRAM rules remain unchanged.

## Validation record

- `npm run typecheck`: passed.
- `npm run lint`: passed with zero warnings.
- `npm test`: 292 tests passed across 23 files, including the scheduler, transport, existing single-video engine, and GPU handoff regressions.
- Scheduler simulations: 3 products × 7 selected types × 2 cycles = 42 executions; all 8 current registry types = 48 executions. Ordering, fresh random seeds, fixed seeds, shuffling, bounded failures, both stop modes, 30-second outage with 5-second retries, ambiguous submission adoption, archive retries, independent downloads, cancellation, concurrency one, SQLite restart recovery, and unverified VRAM barriers covered.
- China package: `py -m pytest tests -q` from the node package directory: 1,081 passed, 5 existing skips. `py test_auto_archive.py`: 3 passed, 1 skipped because the Windows account cannot create symlinks. The traversal, source escape, empty-file, root override, copy verification, and idempotency tests passed.
- Production build: Windows unpacked application built successfully. Vite reports a non-fatal bundle-size advisory (583 KB main renderer chunk).
- Packaged UI smoke: Single Video controls and H3 stage rail present; Auto Run Start present; 15 selections checked (7 products + 8 types); no horizontal overflow; zero Auto Sessions created. Screenshot: `release/auto-h3-20260907/verification/auto-h3.png`.
- Mandatory packaged H3 workflow verification: source and packaged SHA-256 both `ba51289ee2a4d77dcebf9081a45a9842e3994abd637b3a90f5dae48564177bb0`; no stale output-token controls.
- China ZIP CRC and Python module compilation verified. ZIP SHA-256: `bdad3901f1c5d03c638dfd2ac3ec39e075fe3bde37023bad47641e5982928de6`.

Package audit also found a pre-existing duplicate `max_tokens` argument in the checked-in enhancer node. Removing only that duplicate restores the same signature as the prior `china-final-token-managed-20260904-180809` deployment, preserving LM Studio token ownership. Stale upstream tests and README counts were aligned with the already-existing PROYA override and exact-instance telemetry contract; the rewrite engine and its system prompt were not redesigned.

No real GPU generation or China installation was performed. Live end-to-end rendering remains untested, as requested; install the supplied China extension before starting Auto Run.
