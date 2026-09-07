import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("proya_auto_archive_test", Path(__file__).with_name("auto_archive.py"))
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)


class ArchiveTests(unittest.TestCase):
    def test_copy_verify_idempotency_and_original_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "comfy"
            source.mkdir()
            (source / "result.mp4").write_bytes(b"video bytes")
            destination = root / "archive"
            with patch.dict(os.environ, {"PROYA_H3_ARCHIVE_ROOT": str(destination)}):
                args = (source, {"filename": "result.mp4", "type": "output"}, str(destination), "2026-09-07/Cleanser/Product-B-Roll/job.mp4")
                first = archive.copy_verified(*args)
                self.assertEqual(first, archive.copy_verified(*args))
                self.assertEqual(Path(first["path"]).read_bytes(), b"video bytes")
                self.assertTrue((source / "result.mp4").exists())
                self.assertEqual(first["size"], 11)

    def test_traversal_absolute_ads_and_root_override_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for bad in [r"..\..\Windows", "../escape.mp4", "safe/../../escape.mp4", r"C:\Windows\x.mp4", "/etc/passwd", r"\\server\share", "video.mp4:stream", "a//b.mp4"]:
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    archive.within(root, bad)
            with patch.dict(os.environ, {"PROYA_H3_ARCHIVE_ROOT": str(root)}), self.assertRaises(ValueError):
                archive.check_root(str(root / "arbitrary"))

    def test_source_escape_empty_and_destination_mismatch_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "comfy"; source.mkdir()
            destination = root / "archive"; destination.mkdir()
            (source / "empty.mp4").write_bytes(b"")
            (source / "result.mp4").write_bytes(b"abc")
            (destination / "result.mp4").write_bytes(b"x")
            with patch.dict(os.environ, {"PROYA_H3_ARCHIVE_ROOT": str(destination)}):
                for filename in ["../escape.mp4", "empty.mp4", "result.mp4"]:
                    with self.subTest(filename=filename), self.assertRaises((ValueError, FileNotFoundError)):
                        archive.copy_verified(source, {"filename": filename}, str(destination), "result.mp4")

    def test_symlink_escape_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "root"; root.mkdir()
            outside = Path(directory) / "outside"; outside.mkdir()
            try:
                (root / "link").symlink_to(outside, target_is_directory=True)
            except OSError:
                self.skipTest("Windows account cannot create symlinks")
            with self.assertRaises(ValueError):
                archive.within(root, "link/video.mp4")


if __name__ == "__main__":
    unittest.main()
