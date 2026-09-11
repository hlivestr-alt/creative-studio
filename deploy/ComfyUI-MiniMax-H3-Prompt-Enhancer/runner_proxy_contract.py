"""Pure Phase 3C runner-proxy allowlist contract."""

import re

_GET_PATHS = {
    "/capabilities": "/proya/auto/capabilities",
    "/health": "/proya/auto/health",
    "/version": "/proya/auto/version",
    "/session/current": "/proya/auto/session/current",
    "/jobs": "/proya/auto/jobs",
}
_SESSION = re.compile(r"^/session/([0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})$")
_ARTIFACT = re.compile(r"^/jobs/([A-Za-z0-9_-]{1,220})/artifact$")
_STOP_AFTER = re.compile(r"^/session/([0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})/stop-after-current$")
_STOP_NOW = re.compile(r"^/session/([0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})/stop-now$")
_SETTINGS = re.compile(r"^/session/([0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})/settings$")
_LAPTOP_SYNCED = re.compile(r"^/jobs/([A-Za-z0-9_-]{1,220})/laptop-synced$")


def resolve_runner_target(method: str, suffix: str):
    """Return the localhost path, or None for an explicitly denied request."""
    if method == "GET":
        if suffix in _GET_PATHS:
            return _GET_PATHS[suffix]
        match = _SESSION.fullmatch(suffix)
        if match:
            return f"/proya/auto/session/{match.group(1)}"
        artifact = _ARTIFACT.fullmatch(suffix)
        if artifact:
            return f"/proya/auto/jobs/{artifact.group(1)}/artifact"
    if method == "POST" and suffix == "/stage":
        return "/proya/auto/stage"
    if method == "POST" and suffix == "/start":
        return "/proya/auto/start"
    if method == "POST":
        stop_after = _STOP_AFTER.fullmatch(suffix)
        if stop_after:
            return f"/proya/auto/session/{stop_after.group(1)}/stop-after-current"
        stop_now = _STOP_NOW.fullmatch(suffix)
        if stop_now:
            return f"/proya/auto/session/{stop_now.group(1)}/stop-now"
        settings = _SETTINGS.fullmatch(suffix)
        if settings:
            return f"/proya/auto/session/{settings.group(1)}/settings"
        laptop_synced = _LAPTOP_SYNCED.fullmatch(suffix)
        if laptop_synced:
            return f"/proya/auto/jobs/{laptop_synced.group(1)}/laptop-synced"
    return None
