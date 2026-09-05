# Proya autonomous H3 patches

Creative Studio pins the upstream `main` branch at commit `66858ebd55a52924d4b113fcd518726b2038a77c` and expects this small patch on the China RTX 5090 execution PC.

The patch does eight things:

- adds `system_prompt_override` as the final optional `MiniMaxH3PromptEnhancer` input;
- keeps blank override behavior identical to upstream and passes populated text verbatim to the LM Studio system message, including bounded repair attempts;
- adds Indonesian language aliases (`Indonesian`, `Bahasa Indonesia`, `bahasa`, and `id-ID`);
- adds `MiniMaxH3PromptValidityGate` and `MiniMaxH3UnloadLMStudioModel` nodes. The latter receives the model and instance IDs emitted by the enhancer, calls LM Studio's native `/api/v1/models/unload` endpoint for that exact instance only, and verifies the instance is gone.
- hardcodes the autonomous prompt-engine model to `qwen/qwen3.8-27b`, ignores every other LM Studio model, and fails before H3 with the required missing-model message when that exact ID is unavailable. LM Studio's existing JIT/load configuration is used without model-runtime overrides.
- emits the fixed model ID and exact model-instance ID in the enhancer manifest and append-only outputs so Creative Studio can persist runtime identity without turning it into user configuration.
- sets the remote prompt rewrite/repair timeout default to 600 seconds;
- omits output-token limits from autonomous native and OpenAI-compatible LM Studio requests while retaining explicitly supplied limits for manual upstream use;
- converts socket/request timeouts into a distinct timeout error and serializes the full remote rewrite plus bounded repair sequence so a second Qwen request cannot overlap the first;
- leaves H3 sampling and the Electron job watcher outside this prompt-engine timeout.

Apply it from the cloned upstream node directory:

```powershell
git checkout 66858ebd55a52924d4b113fcd518726b2038a77c
git apply C:\Data\proya-creative-studio\patches\ComfyUI-MiniMax-H3-Prompt-Enhancer\0001-proya-autonomous-h3.patch
git apply C:\Data\proya-creative-studio\patches\ComfyUI-MiniMax-H3-Prompt-Enhancer\0002-proya-direct-qwen-timeout.patch
git apply C:\Data\proya-creative-studio\patches\ComfyUI-MiniMax-H3-Prompt-Enhancer\0003-proya-lmstudio-managed-output-tokens.patch
```

Restart ComfyUI after applying the patch. Do not edit `prompts/minimax-h3-lmstudio-system.md`: Creative Studio reads that exact file from the laptop and injects it through the workflow. If the file is absent, H3 fails closed before the remote POST.

The endpoint remains `http://127.0.0.1:1234/v1` inside the execution PC. The laptop talks only to ComfyUI; it never calls LM Studio directly. The autonomous model ID is fixed to `qwen/qwen3.8-27b`; keep its context, GPU/offload, quantization, template, reasoning, and other runtime configuration in LM Studio.

If the enhancer reports a timeout, Creative Studio records `PROMPT_GENERATION_TIMEOUT`. Connection refusal, an unavailable model, or an unavailable endpoint are recorded as `LLM_UNAVAILABLE`; they are not mislabeled as a generic HTTP 503 or an H3 sampling failure.
