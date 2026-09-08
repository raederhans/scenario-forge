from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from tools import editor_checkout_profile as profile


def editor_fixture():
    payloads = {
        "data/scenarios/index.json": {
            "public_baseline_ids": ["hoi4_1936", "modern_world"],
            "scenarios": [{"scenario_id": name, "manifest_url": f"data/scenarios/{name}/manifest.json"}
                          for name in ("hoi4_1936", "modern_world")],
        },
        "data/runtime_asset_registry.json": {"assets": {"extra": {"url": "data/extra-runtime.json"}}},
        "data/scenarios/hoi4_1936/manifest.json": {
            "detail_chunk_manifest_url": "data/scenarios/hoi4_1936/detail_chunks.manifest.json",
            "topology_url": "data/scenarios/hoi4_1936/runtime_topology.topo.json",
            "audit_url": "data/scenarios/hoi4_1936/audit.json",
        },
        "data/scenarios/modern_world/manifest.json": {},
        "data/scenarios/hoi4_1936/detail_chunks.manifest.json": {
            "chunks": [{"url": "data/scenarios/hoi4_1936/chunks/a.json"}],
        },
    }
    paths = set(payloads) | {
        "index.html", "start_dev.bat", "run_server.bat", "tools/dev_server.py",
        "data/CATALOG.json", "data/manifest.json", "data/extra-runtime.json",
        "data/scenarios/hoi4_1936/runtime_topology.topo.json", "data/scenarios/hoi4_1936/audit.json",
        "data/scenarios/hoi4_1936/chunks/a.json", "data/unneeded-source.zip", "dist/index.html",
    }
    entries = {p: {"path": p, "bytes": 17, "gitBlob": "a" * 40, "mode": "100644"} for p in paths}
    return entries, payloads


class EditorCheckoutProfileTests(unittest.TestCase):
    def test_source_metadata_closure_restores_full_topology_and_audit(self):
        entries, payloads = editor_fixture()
        selected, refs = profile.select_editor_files(entries, payloads.__getitem__)
        for p in ("data/scenarios/hoi4_1936/runtime_topology.topo.json",
                  "data/scenarios/hoi4_1936/audit.json", "data/scenarios/hoi4_1936/chunks/a.json",
                  "data/extra-runtime.json"):
            self.assertIn(p, selected)
        self.assertNotIn("dist/index.html", selected)
        self.assertNotIn("data/unneeded-source.zip", selected)
        self.assertIn("data/scenarios/hoi4_1936/detail_chunks.manifest.json", refs)

    def test_missing_referenced_asset_or_entrypoint_fails_closed(self):
        for path in ("data/scenarios/hoi4_1936/runtime_topology.topo.json", "index.html"):
            with self.subTest(path=path):
                entries, payloads = editor_fixture()
                del entries[path]
                with self.assertRaisesRegex(ValueError, "Required editor references"):
                    profile.select_editor_files(entries, payloads.__getitem__)

    def test_unsafe_metadata_reference_and_selected_symlink_are_rejected(self):
        entries, payloads = editor_fixture()
        payloads["data/runtime_asset_registry.json"] = {"url": "data/../private.json"}
        with self.assertRaisesRegex(ValueError, "Unsafe repository path"):
            profile.select_editor_files(entries, payloads.__getitem__)
        entries, payloads = editor_fixture()
        entries["index.html"]["mode"] = "120000"
        with self.assertRaisesRegex(ValueError, "not a regular Git file"):
            profile.select_editor_files(entries, payloads.__getitem__)

    def test_sparse_patterns_escape_wildcards_and_reject_unrepresentable_paths(self):
        self.assertEqual(profile.sparse_pattern("a/[b]*?!#.txt"), "/a/\\[b\\]\\*\\?\\!\\#.txt")
        for value in ("/absolute", "a/../b", "a//b", "a\\b", "a\nb", "a\rb", "a "):
            with self.subTest(value=value), self.assertRaises(ValueError):
                profile.sparse_pattern(value)

    def test_prepare_requires_an_immutable_commit(self):
        with self.assertRaisesRegex(ValueError, "exact 40-character"):
            profile.prepare_profile(profile.ROOT, "HEAD")

    def test_real_git_sparse_checkout_materializes_only_literal_selected_files(self):
        runtime = profile.ROOT / ".runtime" / "tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="editor-profile-", dir=runtime) as folder:
            root = Path(folder)
            source, sparse = root / "source", root / "sparse"
            source.mkdir()
            selected = ["#root.txt", "!root.txt", "space dir/[one].txt", "space dir/é.txt"]
            excluded = ["root.txt", "space dir/o.txt", "space dir/one.txt", "dist/index.html"]
            if os.name != "nt":
                selected += ["literal*.txt", "literal?.txt"]
                excluded += ["literalX.txt"]
            for name in selected + excluded:
                target = source / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(name + "\n", encoding="utf-8")
            def run(repo, *args, input=None):
                return subprocess.run(["git", *args], cwd=repo, input=input, text=True,
                                      encoding="utf-8", check=True, capture_output=True).stdout.strip()
            run(source, "init", "-q")
            run(source, "-c", "core.autocrlf=false", "add", ".")
            run(source, "-c", "user.name=Profile Test", "-c", "user.email=profile@example.invalid",
                "commit", "-qm", "fixture")
            sha = run(source, "rev-parse", "HEAD")
            tree = profile.read_tree(source, sha)
            run(source, "worktree", "add", "--detach", "--no-checkout", str(sparse), sha)
            patterns = "\n".join(profile.sparse_pattern(p) for p in selected) + "\n"
            run(sparse, "sparse-checkout", "set", "--no-cone", "--stdin", input=patterns)
            run(sparse, "checkout", "--detach", sha)
            candidate = {
                "source": {"commit": sha}, "selected": [tree[p] for p in selected],
                "excluded": [tree[p] for p in excluded],
                "totals": {"selected": {"bytes": sum(tree[p]["bytes"] for p in selected)}},
            }
            observed = profile.check_materialization(sparse, candidate)
            self.assertEqual(observed["files"], len(selected))
            self.assertEqual(observed["excludedPresent"], 0)
            self.assertEqual(observed["logicalGitBytes"], sum(tree[p]["bytes"] for p in selected))
            self.assertTrue(all((source / p).is_file() for p in excluded))
            candidate["source"]["commit"] = "0" * 40
            with self.assertRaisesRegex(ValueError, "HEAD differs"):
                profile.check_materialization(sparse, candidate)
            candidate["source"]["commit"] = sha
            (sparse / selected[0]).unlink()
            with self.assertRaisesRegex(ValueError, "Materialization mismatch"):
                profile.check_materialization(sparse, candidate)
            run(sparse, "restore", "--", selected[0])
            run(sparse, "sparse-checkout", "disable")
            self.assertTrue(all((sparse / p).is_file() for p in excluded))
            with self.assertRaisesRegex(ValueError, "excludedPresent"):
                profile.check_materialization(sparse, candidate)


if __name__ == "__main__":
    unittest.main()
