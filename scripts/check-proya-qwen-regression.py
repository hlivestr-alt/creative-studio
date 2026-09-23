"""Prompt-only replay of the exact failed Cleanser/Benefits job; never submits H3."""

from __future__ import annotations

import json
import sqlite3
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "deploy" / "ComfyUI-MiniMax-H3-Prompt-Enhancer"))

import prompt_enhancer  # noqa: E402


PROMPT_ID = "7ce6b0a5-ef0b-43be-86e2-7e4217d4b98e"
JOB_ID = "h3-auto-e8d1d464-65b3-4233-86b4-5c10800500a3-1-cleanser-Benefits-b6395ca6-7dcf-4d46-b846-eb45dd775e76"


def main() -> None:
    with urllib.request.urlopen(f"http://127.0.0.1:8188/history/{PROMPT_ID}") as response:
        history = json.load(response)[PROMPT_ID]
    nodes = history["prompt"][2]
    source = nodes["147"]["inputs"]["value"]
    assert "Soft fine foam" in source and "Content type: Benefits" in source
    assert '"soft fine foam"' not in source
    source = source.replace(
        "Human speech is permitted only when explicitly requested by the creative direction.",
        "SPEECH MODE: NONE. The user did not request spoken audio. No dialogue, voiceover, "
        "narration, speaker IDs, <d> blocks, quoted speech, or invented spoken lines. "
        "Dialogue language is metadata only and does not authorize speech.",
    ).replace(
        "CONTENT TYPE CONTRACT\n",
        "For REF2VA enhanced production, make detailed_description at least 350 English words "
        "(aim for 370–400) using meaningful product-reference fidelity, spatial layout, physical "
        "texture behavior, camera path, and lighting continuity. Describe an observable cause, "
        "physical response, and settled visual result within the one shot; do not merely say the "
        "benefit is implied by lighting. This is a shot-design brief, not spoken copy. Do not pad "
        "with dialogue, claims, repeated adjectives, or irrelevant spectacle.\n\n"
        "CONTENT TYPE CONTRACT\n",
    ).replace(
        "Visual storytelling only; no medical claims or fake scientific labels.\n",
        "Visual storytelling only; no medical claims or fake scientific labels.\n"
        "Show a clear product or texture action, its observable physical response, and a settled "
        "final visual result in the continuous shot. Do not claim a benefit is visible merely "
        "because of color grading or lighting.\n",
    ).replace(
        "SPECIAL INSTRUCTIONS\n",
        "Quotation marks denote literal source-authorized spoken or written words only. "
        "Never quote texture, ingredient, benefit, visual, or camera descriptions.\n\n"
        "SPECIAL INSTRUCTIONS\n",
    )
    db = sqlite3.connect("file:D:/AI Videos/.proya-auto/runner.sqlite3?mode=ro", uri=True)
    try:
        row = db.execute("SELECT json FROM jobs WHERE id = ?", (JOB_ID,)).fetchone()
        assert row is not None
        old_output = json.loads(row[0])["executionState"]["finalEnhancedPrompt"]
    finally:
        db.close()

    system_prompt = (ROOT / "prompts" / "minimax-h3-lmstudio-system.md").read_text(encoding="utf-8")
    calls = 0
    fresh = "--fresh" in sys.argv

    def complete(messages: list[dict]) -> str:
        nonlocal calls
        calls += 1
        if calls == 1 and not fresh:
            return old_output
        print(f"Qwen {'rewrite' if calls == 1 else 'repair'} call {calls}...", flush=True)
        return prompt_enhancer._completion(
            "http://127.0.0.1:1234/v1", "qwen/qwen3.8-27b", messages, "",
            0.2, None, 600, True,
        )

    output, report, manifest = prompt_enhancer.enhance_prompt_with_completion(
        source, "ref2va", 15.0, nodes["148"]["inputs"]["value"], complete,
        2, {"provider": "local_replay"}, aspect_ratio="9:16",
        media_manifest=nodes["153"]["inputs"]["value"], frame_count=362,
        delivery_target="api_v2", dialogue_language="Indonesian",
        system_prompt_override=system_prompt,
    )
    print(json.dumps({
        "promptId": PROMPT_ID,
        "freshRewrite": fresh,
        "calls": calls,
        "repairAttemptsUsed": manifest["repairAttemptsUsed"],
        "valid": report["valid"],
        "qualityValid": report["qualityValid"],
        "errors": report["errors"],
        "coverageGaps": report["coverageGaps"],
        "inventedSoftFineFoamQuote": '"soft fine foam"' in output.casefold(),
        "voiceover": "voiceover" in output.casefold(),
        "dialogueBlocks": output.count("<d>"),
        "descriptionWords": report.get("promptBudget", {}).get("descriptionBudget", {}).get("actualWords"),
    }, indent=2))
    if not report["qualityValid"]:
        print(output)


if __name__ == "__main__":
    main()
