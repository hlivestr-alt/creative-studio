"""Stateless, explicit allowlist proxy to the localhost-only China runner."""

from aiohttp import ClientSession, ClientTimeout, web
from server import PromptServer

from .runner_proxy_contract import resolve_runner_target

_RUNNER_ORIGIN = "http://127.0.0.1:8787"
_MAX_STAGE_BYTES = 128 * 1024 * 1024


@PromptServer.instance.routes.route("*", "/proya/runner/{suffix:.*}")
async def runner_proxy(request):
    suffix = "/" + request.match_info.get("suffix", "").lstrip("/")
    target = resolve_runner_target(request.method, suffix)
    if target is None:
        allowed_path = resolve_runner_target("GET", suffix) or resolve_runner_target("POST", suffix)
        status = 405 if allowed_path else 404
        return web.json_response({"error": "Runner proxy route or method is not allowed."}, status=status)
    body = None
    if request.method == "POST":
        if request.content_length is not None and request.content_length > _MAX_STAGE_BYTES:
            return web.json_response({"error": "Staging body exceeds the proxy limit."}, status=413)
        body = await request.read()
        if len(body) > _MAX_STAGE_BYTES:
            return web.json_response({"error": "Staging body exceeds the proxy limit."}, status=413)
    query = request.query_string
    url = f"{_RUNNER_ORIGIN}{target}" + (f"?{query}" if query else "")
    try:
        async with ClientSession(timeout=ClientTimeout(total=180)) as session:
            request_headers = {"Content-Type": request.headers.get("Content-Type", "application/json")}
            if "Range" in request.headers:
                request_headers["Range"] = request.headers["Range"]
            async with session.request(request.method, url, data=body, headers=request_headers, allow_redirects=False) as upstream:
                headers = {name: value for name, value in upstream.headers.items() if name.lower() in {"content-type", "content-length", "content-range", "accept-ranges", "x-proya-sha256"}}
                if target.endswith("/artifact"):
                    downstream = web.StreamResponse(status=upstream.status, headers=headers)
                    await downstream.prepare(request)
                    async for chunk in upstream.content.iter_chunked(256 * 1024):
                        await downstream.write(chunk)
                    await downstream.write_eof()
                    return downstream
                payload = await upstream.read()
                return web.Response(body=payload, status=upstream.status, headers=headers)
    except Exception as error:
        return web.json_response({"error": f"Local China runner unavailable: {type(error).__name__}"}, status=502)
