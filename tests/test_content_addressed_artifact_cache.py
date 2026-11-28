from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from map_builder.content_addressed_artifact_cache import (
    ArtifactCacheValidationError,
    ContentAddressedArtifactCache,
)


class ContentAddressedArtifactCacheTest(unittest.TestCase):
    def test_restores_complete_source_tree(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            source = root / "source"
            source.mkdir()
            (source / "z.json").write_bytes(b"z")
            (source / "nested").mkdir()
            (source / "nested" / "a.json").write_bytes(b"alpha")
            cache = ContentAddressedArtifactCache(root / "cache")

            admitted = cache.admit(
                source,
                source_identity="source-v1",
                builder_identity="builder-v1",
            )
            target = root / "restored"
            target.mkdir()
            (target / "old.txt").write_text("old", encoding="utf-8")
            restored = cache.restore(
                admitted["manifestDigest"],
                target,
                source_identity="source-v1",
                builder_identity="builder-v1",
                tree_digest=admitted["treeDigest"],
            )
            self.assertEqual(restored, admitted)
            self.assertFalse((target / "old.txt").exists())
            self.assertEqual((target / "nested" / "a.json").read_bytes(), b"alpha")
            self.assertEqual((target / "z.json").read_bytes(), b"z")

    def test_corrupt_or_missing_object_never_changes_existing_restore_target(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            source = root / "source"
            source.mkdir()
            (source / "one.txt").write_text("one", encoding="utf-8")
            cache = ContentAddressedArtifactCache(root / "cache")
            admitted = cache.admit(source, source_identity="source", builder_identity="builder")
            target = root / "target"
            target.mkdir()
            (target / "sentinel.txt").write_text("keep", encoding="utf-8")
            object_path = cache._object_path(admitted["files"][0]["sha256"])

            object_path.write_bytes(b"damaged")
            with self.assertRaises(ArtifactCacheValidationError):
                cache.restore(
                    admitted["manifestDigest"],
                    target,
                    source_identity="source",
                    builder_identity="builder",
                    tree_digest=admitted["treeDigest"],
                )
            self.assertEqual((target / "sentinel.txt").read_text(encoding="utf-8"), "keep")
            self.assertEqual(sorted(path.name for path in target.iterdir()), ["sentinel.txt"])

            object_path.unlink()
            with self.assertRaises(ArtifactCacheValidationError):
                cache.restore(
                    admitted["manifestDigest"],
                    target,
                    source_identity="source",
                    builder_identity="builder",
                    tree_digest=admitted["treeDigest"],
                )
            self.assertEqual((target / "sentinel.txt").read_text(encoding="utf-8"), "keep")

    def test_replace_failure_rolls_back_existing_restore_target(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            source = root / "source"
            source.mkdir()
            (source / "one.txt").write_text("one", encoding="utf-8")
            cache = ContentAddressedArtifactCache(root / "cache")
            admitted = cache.admit(source, source_identity="source", builder_identity="builder")
            target = root / "target"
            target.mkdir()
            (target / "sentinel.txt").write_text("keep", encoding="utf-8")
            real_replace = os.replace

            def fail_staged_replace(source_path, destination_path) -> None:
                if Path(source_path).name == "artifact" and Path(destination_path) == target:
                    raise OSError("simulated replace failure")
                real_replace(source_path, destination_path)

            with patch(
                "map_builder.content_addressed_artifact_cache.os.replace",
                side_effect=fail_staged_replace,
            ), self.assertRaises(OSError):
                cache.restore(
                    admitted["manifestDigest"],
                    target,
                    source_identity="source",
                    builder_identity="builder",
                    tree_digest=admitted["treeDigest"],
                )

            self.assertEqual((target / "sentinel.txt").read_text(encoding="utf-8"), "keep")
            self.assertEqual(sorted(path.name for path in target.iterdir()), ["sentinel.txt"])


if __name__ == "__main__":
    unittest.main()
