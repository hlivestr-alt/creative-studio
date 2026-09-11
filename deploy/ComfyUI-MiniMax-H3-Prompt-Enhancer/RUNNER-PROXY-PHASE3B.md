# PROYA China Runner Proxy — Phase 3B

Overlay these files onto the existing PROYA ComfyUI extension and restart
ComfyUI. The proxy remains stateless. Phase 3B adds only the canary Start and
completed-job artifact routes to the existing staging/status allowlist.

It does not forward `/prompt`, `/free`, arbitrary runner paths, or LM Studio
controls. Internal generation remains localhost-owned by runner r8.
