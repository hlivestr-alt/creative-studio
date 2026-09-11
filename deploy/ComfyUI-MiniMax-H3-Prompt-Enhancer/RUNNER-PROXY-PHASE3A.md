# PROYA China Runner Proxy — Phase 3A

This is an overlay for the existing `ComfyUI-MiniMax-H3-Prompt-Enhancer`
custom-node directory. Copy the enclosed directory over that existing extension
and restart ComfyUI. Install the separately versioned r7 runner before staging.

The proxy is stateless and forwards only the documented Phase 3A status and
staging allowlist to `http://127.0.0.1:8787`. It does not expose runner port
8787, `/prompt`, `/free`, start/generation routes, or LM Studio controls.

No deployment is performed by this package.
