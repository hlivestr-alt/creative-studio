"""Local China archive operations; never accepts a caller-selected source root."""
from __future__ import annotations

import os
from pathlib import Path, PureWindowsPath
import shutil
import uuid


def archive_root() -> Path:
    return Path(os.environ.get("PROYA_H3_ARCHIVE_ROOT", r"D:\AI Videos")).resolve()


def within(root: Path, value: str) -> Path:
    # Handle both separators even when regression tests run on Linux.
    windows = PureWindowsPath(value)
    if windows.is_absolute() or windows.drive or value.startswith(("/", "\\")):
        raise ValueError("Absolute paths are forbidden")
    parts = value.replace("\\", "/").split("/")
    if any(part in ("", ".", "..") or ":" in part for part in parts):
        raise ValueError("Invalid relative path")
    target = root.joinpath(*parts).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError("Path escapes configured root")
    return target


def check_root(requested: str) -> Path:
    root = archive_root()
    if Path(requested).resolve() != root:
        raise ValueError("Archive root must match China PROYA_H3_ARCHIVE_ROOT configuration")
    root.mkdir(parents=True, exist_ok=True)
    probe = root / (".proya-write-" + uuid.uuid4().hex)
    try:
        probe.write_bytes(b"ok")
    finally:
        probe.unlink(missing_ok=True)
    return root


def copy_verified(output_root: Path, output: dict, requested_root: str, relative_path: str) -> dict:
    root = check_root(requested_root)
    if output.get("type", "output") != "output":
        raise ValueError("Only ComfyUI output files may be archived")
    source_name = "/".join(filter(None, [output.get("subfolder", ""), output.get("filename", "")]))
    source = within(output_root.resolve(), source_name)
    destination = within(root, relative_path)
    if source.suffix.lower() != ".mp4" or destination.suffix.lower() != ".mp4":
        raise ValueError("Only MP4 output is supported")
    size = source.stat().st_size
    if size <= 0:
        raise ValueError("Source MP4 is empty")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # resolve again after mkdir; reject symlink/junction escapes on both sides.
    destination = within(root, relative_path)
    if destination.exists():
        if destination.stat().st_size != size:
            raise ValueError("Existing archive size mismatch; refusing to overwrite")
        return {"path": str(destination), "size": size}
    temporary = destination.with_name(destination.name + "." + uuid.uuid4().hex + ".part")
    try:
        shutil.copy2(source, temporary)
        if temporary.stat().st_size != size or source.stat().st_size != size:
            raise ValueError("Archive size verification failed")
        os.replace(temporary, destination)
        if not destination.exists() or destination.stat().st_size != size:
            raise ValueError("Archive verification failed")
    finally:
        temporary.unlink(missing_ok=True)
    return {"path": str(destination), "size": size}
