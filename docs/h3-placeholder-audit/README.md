# H3 stale placeholder regression — 2026-09-05

READY TO RETRY GENERATION: YES. H3 was not run.

## Root cause and occurrences before edits

The saved `remoteComfyWorkflowPath` in `%APPDATA%/proya-creative-studio/settings.json` points to `C:/Data/proya-creative-studio/release/win-unpacked/resources/workflows/minimax-h3-api.json`, not the resources beside the `h3-vram-handoff` executable. That selected workflow retained `"max_tokens": "{{H3_MAX_TOKENS}}"` at node 149, line 317. The current injector intentionally has no replacement, so generic unresolved-input validation rejected the job. Template validation previously checked that known mappings were present, but did not reject extra placeholders.

The exact stale JSON line occurred in these six files (line 317 in each):

- `release/win-unpacked/resources/workflows/minimax-h3-api.json`
- `release-build-check-4/win-unpacked/resources/workflows/minimax-h3-api.json`
- `release-build-check-5/win-unpacked/resources/workflows/minimax-h3-api.json`
- `release-build-check-6/win-unpacked/resources/workflows/minimax-h3-api.json`
- `release-build-check-7/win-unpacked/resources/workflows/minimax-h3-api.json`
- `release-build-check-8/win-unpacked/resources/workflows/minimax-h3-api.json`

All six inputs were removed entirely. Source and the specified handoff workflow were already correct at the start, with identical hashes; no source workflow edit was needed. No `minimax-h3-ui.json` exists, including in the deployment ZIP.

Before-edit inventories, reported before implementation changes:

- [Repository text, fixtures, patches, migration and workflow matches](repo-before.txt): 325 matching lines, including legitimate manual/local token support and historical patch removals.
- [Embedded application bundle matches](asar-before.txt): 148 individual matches, with archive paths, member paths, offsets and context. Obsolete mappings/defaults remain in historical `release-build-check-4` through `-8` bundles and `release/h3-vram-handoff/previous-app-20260905-112227/resources/app.asar`. These historical application bundles were not rewritten or used for the fresh build.
- [Deployment ZIP inspection](zip-inventory.txt): 40 matching lines; zero obsolete H3 placeholders. This supplemental archive inspection was performed after the JSON edits; the ZIP itself was not changed.

Node dependencies, Git internals, and token strings inside the Electron executable are not application workflow contracts. Test assertions and these audit files intentionally mention the forbidden token name.

## Files changed by this fix

- `src/domain/comfy-workflow.ts`: expose input-placeholder enumeration using the unresolved-input scanner.
- `src/domain/minimax-h3-workflow.ts`: complete the production mapping inventory with the existing duration, language and unload placeholders; derive the exact 27-placeholder required set; reject contract drift and node 149 output-token inputs.
- `src/domain/comfy-workflow.test.ts`: actual-workflow/injector contract regression tests, obsolete-input rejection, no token mapping/default/migration assertions.
- `scripts/verify-h3-package.cjs`: mandatory package/source byte equality and hash verification, absent node 149 token inputs, and packaged injector/settings inspection.
- `electron/main/h3-package.test.ts`: actual package check and stale-package rejection regression.
- `package.json`: register the Electron builder `afterPack` verification hook. Existing resource entries were preserved.
- `eslint.config.js`: exclude generated release directories and vendored deployment code from Creative Studio lint.
- `deploy/ComfyUI-MiniMax-H3-Prompt-Enhancer/tests/test_prompt_enhancer.py`: repair mock keyword names, check both omitted token fields in fallback, and correct the authentication test to expect the existing fail-closed behavior. Runtime Python files were not changed.
- The six JSON files listed above: delete only the stale input line.
- `dist/`, `dist-electron/`, and `release/h3-vram-handoff/win-unpacked/`: regenerated production artifacts.
- This audit directory: occurrence inventories, report, and direct verification results.

Source settings, persistence, LM Studio configuration, Qwen model, the 600-second timeout, and VRAM release lifecycle code were not changed. No token field or dummy value was restored.

## Verification

- `npm run typecheck`: PASS.
- `npm run lint`: PASS after excluding deployment/generated files; initial run encountered 3,336 vendored-code errors.
- `npm test`: PASS, 20 files / 261 tests, including settings and VRAM lifecycle coverage. Final run occurred after packaging and exercised the real package.
- Mocked `pytest tests/test_prompt_enhancer.py -q`: PASS, 27 tests. Native and OpenAI-compatible requests omit token-limit fields for autonomous calls and preserve the 600-second timeout. No network generation was performed.
- `npm run build -- --config.directories.output=release/h3-vram-handoff`: PASS, including mandatory afterPack verification. Vite reported a nonblocking chunk-size warning.
- Direct fresh package inspection: PASS. Main/preload/renderer bundles contain zero `H3_MAX_TOKENS` or `maxTokens` occurrences.

SHA-256 for source `workflows/minimax-h3-api.json`:

`ba51289ee2a4d77dcebf9081a45a9842e3994abd637b3a90f5dae48564177bb0`

SHA-256 for freshly packaged `release/h3-vram-handoff/win-unpacked/resources/workflows/minimax-h3-api.json`:

`ba51289ee2a4d77dcebf9081a45a9842e3994abd637b3a90f5dae48564177bb0`

The saved-path `release/win-unpacked` workflow has the same hash. All three contain zero `H3_MAX_TOKENS` occurrences and no node 149 `max_tokens`/`max_output_tokens` input. See [machine-readable final verification](verification.json).

Use the freshly rebuilt `release/h3-vram-handoff/win-unpacked/PROYA Creative Studio.exe`. Settings were not changed; its existing saved workflow path now resolves to the corrected, source-identical workflow.
