"""Auto Run routes run on the China PC, alongside the existing prompt nodes."""
import asyncio
from pathlib import Path
from aiohttp import web
import folder_paths
import comfy.model_management
from server import PromptServer
from .auto_archive import check_root, copy_verified, within
from .prompt_enhancer import inspect_prompt_model, unload_prompt_model_instance

_archive_lock = asyncio.Lock()


def _qwen_recovery(endpoint, api_key):
    """Inspect/unload Qwen while the ComfyUI queue mutex prevents a new job."""
    queue = PromptServer.instance.prompt_queue
    with queue.mutex:
        running = list(getattr(queue, "currently_running", {}).values())
        pending_queue = getattr(queue, "queue", ())
        pending = list(pending_queue) if pending_queue is not None else []
        if running or pending:
            return {
                "activePromptJob": True,
                "staleQwenDetected": False,
                "staleQwenInstanceId": None,
                "staleQwenUnloadAttempted": False,
                "staleQwenUnloadSucceeded": None,
                "staleQwenUnloadError": "An active or queued ComfyUI prompt owns the execution queue; Qwen cleanup was skipped.",
            }
        observation = inspect_prompt_model(endpoint, api_key, 20)
        instance_ids = observation["instance_ids"]
        result = {
            "activePromptJob": False,
            "staleQwenDetected": bool(instance_ids),
            "staleQwenInstanceId": instance_ids[0] if len(instance_ids) == 1 else None,
            "staleQwenUnloadAttempted": False,
            "staleQwenUnloadSucceeded": None,
            "staleQwenUnloadError": None,
        }
        if len(instance_ids) > 1:
            result["staleQwenUnloadError"] = "Multiple loaded canonical Qwen instances were found; refusing to guess which stale instance to unload."
            return result
        if len(instance_ids) == 1:
            result["staleQwenUnloadAttempted"] = True
            unloaded = unload_prompt_model_instance(endpoint, instance_ids[0], api_key, 20)
            result["staleQwenUnloadSucceeded"] = bool(unloaded["unload_succeeded"])
            result["staleQwenUnloadError"] = unloaded["unload_error"]
        return result


@PromptServer.instance.routes.post("/proya/auto/qwen-recovery")
async def qwen_recovery(request):
    try:
        body = await request.json()
        result = await asyncio.to_thread(
            _qwen_recovery,
            body.get("endpoint", "http://127.0.0.1:1234/v1"),
            body.get("api_key", ""),
        )
        return web.json_response(result)
    except Exception as exc:
        return web.json_response({
            "activePromptJob": False,
            "staleQwenDetected": False,
            "staleQwenInstanceId": None,
            "staleQwenUnloadAttempted": False,
            "staleQwenUnloadSucceeded": None,
            "staleQwenUnloadError": None,
            "qwenRecoveryError": str(exc),
        })


@PromptServer.instance.routes.post("/proya/auto/archive/check")
async def check_archive(request):
    try:
        body = await request.json()
        root = await asyncio.to_thread(check_root, body["root"])
        return web.json_response({"root": str(root), "ready": True})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=400)


@PromptServer.instance.routes.post("/proya/auto/archive")
async def archive(request):
    try:
        body = await request.json()
        async with _archive_lock:
            result = await asyncio.to_thread(copy_verified, Path(folder_paths.get_output_directory()), body["output"], body["root"], body["relativePath"])
        return web.json_response(result)
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=400)


@PromptServer.instance.routes.post("/proya/auto/interrupt")
async def interrupt(request):
    body = await request.json()
    prompt_id = body.get("promptId")
    queue = PromptServer.instance.prompt_queue
    # Hold ComfyUI's queue mutex so another job cannot take over between check and interrupt.
    with queue.mutex:
        running = list(queue.currently_running.values())
        if any(item[1] == prompt_id for item in running):
            comfy.model_management.interrupt_current_processing()
            return web.json_response({"interrupted": True})
    return web.json_response({"interrupted": False})


@PromptServer.instance.routes.get("/proya/auto/archive/file")
async def archived_file(request):
    try:
        root = check_root(request.query["root"])
        path = within(root, request.query["relativePath"])
        if path.suffix.lower() != ".mp4" or not path.is_file():
            raise ValueError("Archived MP4 not found")
        return web.FileResponse(path)
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=400)
