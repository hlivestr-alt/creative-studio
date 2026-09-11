import importlib.util
from pathlib import Path

_path = Path(__file__).with_name("runner_proxy_contract.py")
_spec = importlib.util.spec_from_file_location("runner_proxy_contract", _path)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
resolve_runner_target = _module.resolve_runner_target


def test_phase3a_allowlist():
    assert resolve_runner_target("GET", "/capabilities") == "/proya/auto/capabilities"
    assert resolve_runner_target("GET", "/health") == "/proya/auto/health"
    assert resolve_runner_target("POST", "/stage") == "/proya/auto/stage"
    assert resolve_runner_target("POST", "/start") == "/proya/auto/start"
    session_id = "72a7435a-629f-4574-9601-a60e4ee770d2"
    assert resolve_runner_target("POST", f"/session/{session_id}/stop-after-current") == f"/proya/auto/session/{session_id}/stop-after-current"
    assert resolve_runner_target("POST", f"/session/{session_id}/stop-now") == f"/proya/auto/session/{session_id}/stop-now"
    assert resolve_runner_target("POST", f"/session/{session_id}/settings") == f"/proya/auto/session/{session_id}/settings"
    assert resolve_runner_target("GET", "/jobs/h3-auto-safe/artifact") == "/proya/auto/jobs/h3-auto-safe/artifact"
    assert resolve_runner_target("POST", "/jobs/h3-auto-safe/laptop-synced") == "/proya/auto/jobs/h3-auto-safe/laptop-synced"


def test_generation_and_unknown_routes_are_denied():
    assert resolve_runner_target("POST", "/prompt") is None
    assert resolve_runner_target("POST", "/free") is None
    assert resolve_runner_target("GET", "/unknown") is None
    assert resolve_runner_target("POST", "/health") is None
