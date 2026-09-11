# PROYA China Runner Proxy — Phase 3C

Overlay these files onto the existing PROYA ComfyUI extension and restart
ComfyUI. The proxy remains stateless. Phase 3C adds only the two runner-owned
stop commands to the Phase 3B staging, Start, status, and artifact allowlist.

It does not forward `/prompt`, `/free`, arbitrary runner paths, or LM Studio
controls. Both autonomous jobs remain localhost-owned by runner r9 after one
durable Start acknowledgement.
