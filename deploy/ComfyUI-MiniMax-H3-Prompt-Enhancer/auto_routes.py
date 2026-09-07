"""Auto Run routes run on the China PC, alongside the existing prompt nodes."""
import asyncio
from pathlib import Path
from aiohttp import web
import folder_paths
import comfy.model_management
from server import PromptServer
from .auto_archive import check_root, copy_verified, within

_archive_lock = asyncio.Lock()


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
