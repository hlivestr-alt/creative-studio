# SPDX-License-Identifier: GPL-3.0-only

from __future__ import annotations

import json
import socket

import pytest

import prompt_enhancer


VALID_PROMPT = """integrated_multimodal_description: [Shot 1] Live-action, cinematic, a knight crosses a wet alley.

overall_soundscape: Rain falls while armor plates move with each step.

non_diegetic_music: N/A"""


NATIVE_URL = "http://127.0.0.1:1234/api/v1/chat"
CHAT_URL = "http://127.0.0.1:1234/v1/chat/completions"
MESSAGES = [{"role": "system", "content": "rules"}, {"role": "user", "content": "request"}]


@pytest.fixture(autouse=True)
def _forget_probed_native_endpoints():
    """The native-endpoint probe cache is process-wide; keep every test order-independent."""
    prompt_enhancer._reset_native_chat_cache()
    yield
    prompt_enhancer._reset_native_chat_cache()


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def _transport_payload(payload, status=200):
    return status, json.dumps(payload).encode("utf-8")


def _record_completions(monkeypatch, calls, native_error=None):
    """Run `calls` identical completions and return every requested URL in order."""
    urls = []

    def fake_request(url, _body, _headers, connect_timeout, read_timeout):
        assert connect_timeout <= read_timeout
        urls.append(url)
        if url.endswith("/api/v1/chat"):
            if native_error is not None:
                return _transport_payload({}, native_error)
            return _transport_payload({"output": [{"type": "message", "content": VALID_PROMPT}]})
        return _transport_payload({"choices": [{"message": {"content": VALID_PROMPT}}]})

    monkeypatch.setattr(prompt_enhancer, "_direct_http_request", fake_request)
    for _ in range(calls):
        assert prompt_enhancer._completion(
            "http://127.0.0.1:1234/v1", "qwen", MESSAGES, "", 0.1, 500, 30, True,
        ) == VALID_PROMPT
    return urls


def test_enhancer_auto_discovers_model_and_never_puts_api_key_in_manifest(monkeypatch):
    calls = []

    def fake_request(url, _body, _headers, connect_timeout, read_timeout):
        calls.append((url, connect_timeout, read_timeout))
        if url.endswith("/api/v1/models"):
            return _transport_payload({"models": [{
                "key": prompt_enhancer.PROMPT_ENGINE_MODEL_ID,
                "loaded_instances": [{"id": "qwen-instance"}],
            }]})
        if url.endswith("/models"):
            return _transport_payload({"data": [{"id": prompt_enhancer.PROMPT_ENGINE_MODEL_ID}]})
        if url.endswith("/api/v1/chat"):
            return _transport_payload({
                "model_instance_id": "qwen-instance",
                "output": [{"type": "message", "content": VALID_PROMPT}],
            })
        return _transport_payload({"choices": [{"message": {"content": VALID_PROMPT}}]})

    monkeypatch.setattr(prompt_enhancer, "_direct_http_request", fake_request)
    result, validation, manifest = prompt_enhancer.enhance_prompt(
        "A knight crosses a wet alley. No music.", "t2va", 5.0, "",
        "http://127.0.0.1:1234/v1", "", "super-secret", 0.2, 4096, 30, 1, False,
    )
    assert result == VALID_PROMPT
    assert validation["valid"]
    assert manifest["model"] == prompt_enhancer.PROMPT_ENGINE_MODEL_ID
    assert "super-secret" not in json.dumps(manifest)
    assert len(calls) == 3
    assert manifest["repairAttemptsUsed"] == 1


def test_autonomous_model_is_fixed_to_the_production_qwen_id(monkeypatch):
    def fake_request(url, _body, _headers, connect_timeout, read_timeout):
        if url.endswith("/api/v1/models"):
            return _transport_payload({"models": [{
                "key": prompt_enhancer.PROMPT_ENGINE_MODEL_ID,
                "loaded_instances": [{"id": "qwen-instance"}],
            }]})
        if url.endswith("/api/v1/chat"):
            return _transport_payload({
                "model_instance_id": "qwen-instance",
                "output": [{"type": "message", "content": VALID_PROMPT}],
            })
        return _transport_payload({"choices": [{"message": {"content": VALID_PROMPT}}]})

    monkeypatch.setattr(prompt_enhancer, "_direct_http_request", fake_request)
    _result, _validation, manifest = prompt_enhancer.enhance_prompt(
        "A knight crosses a wet alley. No music.", "t2va", 5.0, "",
        "http://127.0.0.1:1234/v1", "", "", 0.2, 4096, 30, 0, False,
    )
    assert manifest["modelId"] == prompt_enhancer.PROMPT_ENGINE_MODEL_ID


def test_autonomous_native_request_omits_output_token_limit(monkeypatch):
    payloads = []

    def fake_request(url, body, _headers, connect_timeout, read_timeout):
        assert connect_timeout == 30
        assert read_timeout == 600
        payloads.append((url, json.loads(body)))
        return _transport_payload({"output": [{"type": "message", "content": VALID_PROMPT}]})

    monkeypatch.setattr(prompt_enhancer, "_direct_http_request", fake_request)
    assert prompt_enhancer._completion(
        "http://127.0.0.1:1234/v1", prompt_enhancer.PROMPT_ENGINE_MODEL_ID,
        MESSAGES, "", 0.2, None, 600,
    ) == VALID_PROMPT
    assert payloads[0][0] == NATIVE_URL
    assert "max_output_tokens" not in payloads[0][1]
    assert "max_tokens" not in payloads[0][1]
    assert not ({"context_length", "gpu", "offload", "quantization", "flash_attention", "chat_template", "reasoning"} & payloads[0][1].keys())


def test_autonomous_fallback_omits_limit_but_manual_limit_remains_supported(monkeypatch):
    payloads = []

    def fake_request(url, body, _headers, connect_timeout, read_timeout):
        assert connect_timeout == 30
        assert read_timeout == 600
        payloads.append((url, json.loads(body)))
        return _transport_payload({"choices": [{"message": {"content": VALID_PROMPT}}]})

    monkeypatch.setattr(prompt_enhancer, "_direct_http_request", fake_request)
    for limit in (None, 4096):
        assert prompt_enhancer._completion(
            "http://127.0.0.1:1234/v1", prompt_enhancer.PROMPT_ENGINE_MODEL_ID,
            MESSAGES, "", 0.2, limit, 600, prefer_lm_studio_native=False,
        ) == VALID_PROMPT
    assert payloads[0][0] == CHAT_URL
    assert "max_tokens" not in payloads[0][1]
    assert "max_output_tokens" not in payloads[0][1]
    assert payloads[1][1]["max_tokens"] == 4096


def test_remote_endpoint_requires_explicit_opt_in():
    with pytest.raises(ValueError, match="Remote LLM endpoints are disabled"):
        prompt_enhancer.enhance_prompt(
            "A basic prompt", "t2va", 5.0, "", "https://example.com/v1", "model", "", 0.2,
            4096, 30, 0, False,
        )


def test_frontend_model_discovery_filters_models_and_enforces_endpoint_policy(monkeypatch):
    monkeypatch.setattr(
        prompt_enhancer,
        "_request_json",
        lambda *_args, **_kwargs: {"models": [{"key": prompt_enhancer.PROMPT_ENGINE_MODEL_ID}]},
    )
    assert prompt_enhancer.discover_models("http://127.0.0.1:1234/v1") == [prompt_enhancer.PROMPT_ENGINE_MODEL_ID]
    with pytest.raises(ValueError, match="Remote LLM endpoints are disabled"):
        prompt_enhancer.discover_models("https://example.com/v1")


def test_one_repair_attempt_fixes_invalid_first_completion(monkeypatch):
    payloads = iter(("not structured", VALID_PROMPT))

    def fake_request(url, _body, _headers, connect_timeout, read_timeout):
        if url.endswith("/api/v1/models"):
            return _transport_payload({"models": [{
                "key": prompt_enhancer.PROMPT_ENGINE_MODEL_ID,
                "loaded_instances": [{"id": "qwen-instance"}],
            }]})
        return _transport_payload({
            "model_instance_id": "qwen-instance",
            "output": [{"type": "message", "content": next(payloads)}],
        })

    monkeypatch.setattr(prompt_enhancer, "_direct_http_request", fake_request)
    _result, validation, manifest = prompt_enhancer.enhance_prompt(
        "A knight crosses a wet alley. No music.", "t2va", 5.0, "",
        "http://localhost:8000/v1", "already-loaded", "", 0.2, 4096, 30, 1, False,
    )
    assert validation["valid"]
    assert manifest["repairAttemptsUsed"] == 1


def test_simulated_121_second_rewrite_and_repair_share_600_second_read_timeout(monkeypatch):
    """Use a fake clock/transport contract; this test never sleeps."""
    simulated_durations = iter((121, 121))
    responses = iter(("not structured", VALID_PROMPT))
    observed_read_timeouts = []

    def fake_request(_url, _body, _headers, connect_timeout, read_timeout):
        elapsed = next(simulated_durations)
        observed_read_timeouts.append(read_timeout)
        if elapsed > read_timeout:
            raise socket.timeout(f"simulated {elapsed}-second response")
        return _transport_payload({"choices": [{"message": {"content": next(responses)}}]})

    monkeypatch.setattr(prompt_enhancer, "_direct_http_request", fake_request)

    def complete(messages):
        return prompt_enhancer._completion(
            "http://127.0.0.1:1234/v1", "qwen", messages, "", 0.2, None, 600,
            prefer_lm_studio_native=False,
        )

    result, validation, manifest = prompt_enhancer.enhance_prompt_with_completion(
        "A knight crosses a wet alley. No music.", "t2va", 5.0, "", complete, 1,
        {"provider": "test"},
    )
    assert result == VALID_PROMPT
    assert validation["valid"]
    assert manifest["repairAttemptsUsed"] == 1
    assert "maxTokens" not in manifest
    assert observed_read_timeouts == [600, 600]


def test_context_size_does_not_derive_an_output_limit():
    result, validation, manifest = prompt_enhancer.enhance_prompt_with_completion(
        "A knight crosses a wet alley. No music.", "t2va", 5.0, "",
        lambda _messages: VALID_PROMPT, 0, {"provider": "test", "contextSize": 1},
    )
    assert result == VALID_PROMPT
    assert validation["valid"]
    assert "maxTokens" not in manifest


def test_simulated_response_over_600_seconds_times_out_without_sleeping(monkeypatch):
    def fake_request(_url, _body, _headers, connect_timeout, read_timeout):
        simulated_elapsed = 601
        if simulated_elapsed > read_timeout:
            raise socket.timeout(f"simulated {simulated_elapsed}-second response")
        raise AssertionError("the simulated response should have exceeded its read timeout")

    monkeypatch.setattr(prompt_enhancer, "_direct_http_request", fake_request)
    with pytest.raises(RuntimeError, match="timed out after 600 seconds"):
        prompt_enhancer._request_json(CHAT_URL, {"messages": MESSAGES}, "", 600)


def test_repair_loop_keeps_the_best_candidate_when_repair_is_worse():
    first = """integrated_multimodal_description:
[Shot 1] A middle-aged woman monitors a laboratory console.

overall_soundscape:
Laboratory hum.

non_diegetic_music:
N/A"""
    completions = iter([first, "not structured at all"])
    result, validation, manifest = prompt_enhancer.enhance_prompt_with_completion(
        "An older woman monitors a laboratory console. No music.",
        "t2va", 5.0, "", lambda _messages: next(completions), 1, {"provider": "test"},
    )
    assert result == first
    assert len(validation["errors"]) == 1
    assert "older woman" in validation["errors"][0]
    assert manifest["repairAttemptsUsed"] == 1


def test_api_v2_delivery_target_repairs_an_oversized_candidate():
    oversized = VALID_PROMPT.replace(
        "a knight crosses a wet alley.",
        "a knight crosses a wet alley. " + ("Unique visible masonry detail remains stable. " * 190),
    )
    completions = iter((oversized, VALID_PROMPT))
    result, validation, manifest = prompt_enhancer.enhance_prompt_with_completion(
        "A knight crosses a wet alley. No music.", "t2va", 5.0, "",
        lambda _messages: next(completions), 1, {"provider": "test"},
        delivery_target="api_v2",
    )
    assert result == VALID_PROMPT
    assert validation["valid"] and validation["apiCompatible"]
    assert manifest["deliveryTarget"] == "api_v2"
    assert manifest["repairAttemptsUsed"] == 1


def test_native_lm_studio_request_does_not_override_reasoning_settings(monkeypatch):
    captured = {}

    def fake_request(_url, body, _headers, connect_timeout, read_timeout):
        captured.update(json.loads(body.decode("utf-8")))
        return _transport_payload({"output": [{"type": "message", "content": VALID_PROMPT}]})

    monkeypatch.setattr(prompt_enhancer, "_direct_http_request", fake_request)
    result = prompt_enhancer._completion(
        "http://127.0.0.1:1234/v1", "qwen", [{"role": "system", "content": "rules"},
        {"role": "user", "content": "request"}], "", 0.1, 500, 30, True,
    )
    assert result == VALID_PROMPT
    assert "reasoning" not in captured
    assert captured["store"] is False


def test_pipeline_restores_omitted_catalan_dialogue_before_validation():
    source = (
        'Luffy enters a restaurant and asks in catalonian language '
        '"A ver, cabrones, quiero flaó de ese".'
    )
    omitted = """integrated_multimodal_description:
[Shot 1] Live-action Luffy enters a restaurant in Ibiza with an arrogant expression.

overall_soundscape:
Restaurant chatter and clinking dishes.

non_diegetic_music:
N/A"""
    result, validation, _manifest = prompt_enhancer.enhance_prompt_with_completion(
        source, "t2va", 5.0, "", lambda _messages: omitted, 0, {"provider": "test"},
    )
    assert '<d>[Catalan] A ver, cabrones, quiero flaó de ese</d>' in result
    assert validation["valid"]


def test_pipeline_repairs_omitted_requested_dialogue_and_keeps_multiple_shot_beats():
    source = (
        "An arabic influencer with her cellphone goes back in time to the Alhambra at Granada during 1492, "
        "and explains in spanish what she sees. She walks around the garden and the fountain, although some "
        "muslim men look at her suspiciously. Generate the dialogue for her based on the scenario."
    )
    omitted = """integrated_multimodal_description:
[Shot 1] An Arabic influencer records herself while walking through the Alhambra gardens in 1492. Several local men watch her suspiciously.

overall_soundscape:
Water trickles through the fountain and leaves rustle.

non_diegetic_music:
N/A"""
    repaired = """integrated_multimodal_description:
[Shot 1] An Arabic influencer records herself beside the Alhambra garden fountain in 1492. The influencer (S1) says brightly: <d>[Spanish] Estoy en la Alhambra, en pleno 1492.</d>.
[Shot 2] At 00:04.000, she walks past the fountain as several local Muslim men watch her suspiciously. The influencer (S1) whispers: <d>[Spanish] Esta fuente es increíble; creo que me están observando.</d>.

overall_soundscape:
Water trickles, leaves rustle, and footsteps cross the stone path.

non_diegetic_music:
N/A"""
    ledger = json.dumps({"lines": [
        {"language": "Spanish", "text": "Estoy en la Alhambra, en pleno 1492."},
        {"language": "Spanish", "text": "Esta fuente es increíble; creo que me están observando."},
    ]}, ensure_ascii=False)
    completions = iter((ledger, omitted, repaired))
    requests = []

    def complete(messages):
        requests.append(messages[-1]["content"])
        return next(completions)

    result, validation, manifest = prompt_enhancer.enhance_prompt_with_completion(
        source, "t2va", 8.0, "", complete, 1, {"provider": "test"},
    )
    assert validation["valid"], validation
    assert manifest["repairAttemptsUsed"] == 1
    assert manifest["dialogueLedgerLineCount"] == 2
    assert manifest["dialoguePlanningRepairAttemptsUsed"] == 0
    assert result.count("<d>[Spanish]") == 2
    assert "[Shot 2] At 00:04.000," in result
    assert "After the final tagged line" not in result
    assert "MAXIMUM LINES: 2" in requests[0]
    assert "AUTHORITATIVE DIALOGUE LEDGER" in requests[1]
    assert "MANDATORY DIALOGUE LEDGER REPAIR" in requests[-1]


def test_invalid_dialogue_ledger_fails_before_a_silent_main_prompt_can_be_accepted():
    calls = []

    def complete(messages):
        calls.append(messages)
        return "not json"

    with pytest.raises(RuntimeError, match="Dialogue planning failed: ledger must be valid JSON"):
        prompt_enhancer.enhance_prompt_with_completion(
            "Generate short Spanish dialogue for a presenter.",
            "t2va", 5.0, "", complete, 0, {"provider": "test"},
        )
    assert len(calls) == 1


def test_dialogue_ledger_can_repair_once_before_the_main_generation():
    ledger = '{"lines":[{"language":"Spanish","text":"Bienvenidos al jardín."}]}'
    final_prompt = """integrated_multimodal_description:
[Shot 1] A presenter (S1) says warmly: <d>[Spanish] Bienvenidos al jardín.</d>.

overall_soundscape:
Water trickles nearby.

non_diegetic_music:
N/A"""
    completions = iter(("invalid ledger", ledger, final_prompt, final_prompt))
    result, validation, manifest = prompt_enhancer.enhance_prompt_with_completion(
        "Generate short Spanish dialogue for a presenter. No music.",
        "t2va", 5.0, "", lambda _messages: next(completions), 1, {"provider": "test"},
    )
    assert validation["valid"], validation
    assert "<d>[Spanish] Bienvenidos al jardín.</d>" in result
    assert manifest["dialoguePlanningRepairAttemptsUsed"] == 1
    assert manifest["repairAttemptsUsed"] == 1


def test_dialogue_ledger_cannot_relabel_a_source_quote_as_new_authored_text():
    with pytest.raises(ValueError, match="duplicates source-provided dialogue"):
        prompt_enhancer._parse_dialogue_ledger(
            '{"lines":[{"language":"Spanish","text":"Hola."}]}',
            "Spanish", 2, 10,
            'The presenter says in Spanish "Hola." Then generate another Spanish line.',
        )


def test_non_authoring_pipeline_keeps_the_original_single_completion_path():
    calls = []

    def complete(messages):
        calls.append(messages)
        return VALID_PROMPT

    _result, validation, manifest = prompt_enhancer.enhance_prompt_with_completion(
        "A knight crosses a wet alley. No music.",
        "t2va", 5.0, "", complete, 0, {"provider": "test"},
    )
    assert validation["valid"]
    assert len(calls) == 1
    assert manifest["dialogueLedgerLineCount"] == 0


def test_pipeline_applies_silent_audio_policy_and_records_manifest():
    source = 'A presenter says in Spanish "Esto funciona", then smiles. No music.'
    completion = """integrated_multimodal_description:
[Shot 1] A presenter faces the camera and says: <d>[Spanish] Esto funciona</d>.

overall_soundscape:
The presenter voice is clear over quiet room tone.

non_diegetic_music:
A dramatic orchestral score."""
    result, validation, manifest = prompt_enhancer.enhance_prompt_with_completion(
        source, "t2va", 5.0, "", lambda _messages: completion, 0, {"provider": "test"},
        True, "off", "off", "silent_mouth_acting_experimental",
    )
    assert "Esto funciona" not in result
    assert "<d>" not in result
    assert "silently performs natural speech-like lip and jaw articulation" in result
    assert "overall_soundscape:\nN/A" in result
    assert "non_diegetic_music:\nN/A" in result
    assert validation["valid"]
    assert validation["warnings"]
    assert manifest["referenceSemanticsVersion"] == 2
    assert manifest["audioPolicyVersion"] == 1
    assert manifest["ambienceFoleyPolicy"] == "off"
    assert manifest["backgroundScorePolicy"] == "off"
    assert manifest["voicePerformance"] == "silent_mouth_acting_experimental"
    assert manifest["silentMouthActingExperimental"] is True
    assert manifest["suppressedDialogueCount"] == 1
    assert manifest["voiceControlGuarantee"] == "best_effort_prompt_only"


def test_pipeline_records_only_an_active_instrumental_description():
    captured = {}

    def complete(messages):
        captured["request"] = messages[-1]["content"]
        return VALID_PROMPT.replace("N/A", "A slow instrumental cello pulse with no vocals.")

    _result, _validation, manifest = prompt_enhancer.enhance_prompt_with_completion(
        "A knight crosses a wet alley.", "t2va", 5.0, "", complete, 0,
        {"provider": "test"}, True, "auto", "add_instrumental", "audible",
        "Slow cello pulse, sparse and tense.",
    )
    assert "Slow cello pulse, sparse and tense." in captured["request"]
    assert manifest["instrumentalDescription"] == "Slow cello pulse, sparse and tense."


def test_pipeline_records_requested_and_applied_instrumental_style():
    def complete(_messages):
        return VALID_PROMPT.replace("N/A", "A restrained jazz-informed cello score with no vocals.")

    _result, _validation, active = prompt_enhancer.enhance_prompt_with_completion(
        "A knight crosses a wet alley.", "t2va", 5.0, "", complete, 0,
        {"provider": "test"}, background_score_policy="add_instrumental",
        instrumental_description="Cello, 72 BPM.", instrumental_style="jazz",
    )
    _result, _validation, inactive = prompt_enhancer.enhance_prompt_with_completion(
        "A knight crosses a wet alley.", "t2va", 5.0, "", complete, 0,
        {"provider": "test"}, background_score_policy="off", instrumental_style="jazz",
    )
    assert active["instrumentalStyleRequested"] == "jazz"
    assert active["instrumentalStyleApplied"] == "jazz"
    assert inactive["instrumentalStyleRequested"] == "jazz"
    assert inactive["instrumentalStyleApplied"] == "none"


def test_a_missing_native_endpoint_is_probed_once_per_root(monkeypatch):
    urls = _record_completions(monkeypatch, 2, native_error=404)
    assert urls == [NATIVE_URL, CHAT_URL, CHAT_URL]


def test_a_server_exposing_the_native_endpoint_keeps_using_it(monkeypatch):
    assert _record_completions(monkeypatch, 2) == [NATIVE_URL, NATIVE_URL]


def test_an_authentication_failure_does_not_mark_the_root_as_non_native(monkeypatch):
    # 401/403/407 answer the credential question, not the endpoint-shape question, so the root
    # is probed again on the next call instead of being remembered as OpenAI-compatible only.
    urls = []

    def fake_request(url, _body, _headers, connect_timeout, read_timeout):
        assert connect_timeout <= read_timeout
        urls.append(url)
        return _transport_payload({}, 401)

    monkeypatch.setattr(prompt_enhancer, "_direct_http_request", fake_request)
    for _ in range(2):
        with pytest.raises(RuntimeError, match="HTTP 401"):
            prompt_enhancer._completion(
                "http://127.0.0.1:1234/v1", "qwen", MESSAGES, "", 0.1, None, 600,
            )
    assert urls == [NATIVE_URL, NATIVE_URL]


def test_a_native_root_that_stops_answering_falls_back_and_stops_being_probed(monkeypatch):
    assert _record_completions(monkeypatch, 1) == [NATIVE_URL]
    urls = _record_completions(monkeypatch, 2, native_error=405)
    assert urls == [NATIVE_URL, CHAT_URL, CHAT_URL]


def test_resetting_the_probe_cache_restores_native_probing(monkeypatch):
    assert _record_completions(monkeypatch, 2, native_error=404) == [NATIVE_URL, CHAT_URL, CHAT_URL]
    prompt_enhancer._reset_native_chat_cache()
    assert _record_completions(monkeypatch, 1, native_error=404) == [NATIVE_URL, CHAT_URL]
