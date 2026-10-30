import importlib.util
import hashlib
import json
import re
import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_JSON = REPO_ROOT / "package.json"
PACKAGE_LOCK = REPO_ROOT / "package-lock.json"
WORKFLOW_FILE = REPO_ROOT / ".github" / "workflows" / "perf-pr-gate.yml"
MEASUREMENT_WORKFLOW_FILE = REPO_ROOT / ".github" / "workflows" / "perf-measure.yml"
BASELINE_MD = REPO_ROOT / "docs" / "perf" / "baseline_2026-07-30.md"
BASELINE_JSON = REPO_ROOT / "docs" / "perf" / "baseline_2026-07-30.json"
BASELINE_RATIFICATION = REPO_ROOT / "docs" / "perf" / "baseline_2026-07-30-ratification.json"
BASELINE_SOURCE_GIT_HEAD = "3eb5b07fd4e6338be17c018434b45e3c9a87d4bd"
PREVIOUS_BASELINE_SOURCE_GIT_HEAD = "9879a828841d892823f576680d55a28697d77bcd"
PERF_SCRIPT = REPO_ROOT / "tools" / "perf" / "run_baseline.mjs"
STANDARD_PERF_ADMISSION = REPO_ROOT / "tools" / "perf" / "standard_perf_admission.mjs"
RENDER_SAMPLE_ROLE_POLICY = REPO_ROOT / "tools" / "perf" / "render_sample_role_policy.mjs"
RENDER_SAMPLE_ROLE_ANALYZER = REPO_ROOT / "tools" / "perf" / "analyze_render_sample_roles.mjs"
EDITOR_BENCHMARK_SCRIPT = REPO_ROOT / "ops" / "browser-mcp" / "editor-performance-benchmark.py"


def load_editor_benchmark_module():
    spec = importlib.util.spec_from_file_location("editor_performance_benchmark", EDITOR_BENCHMARK_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def canonical_text_sha256(path):
    canonical_bytes = path.read_text(encoding="utf-8").encode("utf-8")
    return hashlib.sha256(canonical_bytes).hexdigest()


def canonical_json_sha256(payload):
    canonical_bytes = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical_bytes).hexdigest()


@unittest.skipUnless(shutil.which("pwsh"), "workflow classifier requires PowerShell 7")
class PerfWorkflowClassifierTest(unittest.TestCase):
    def classify(self, files, *, event="pull_request", base=None, head=None, diff_failure=False, labels=None):
        workflow = WORKFLOW_FILE.read_text(encoding="utf-8")
        script = textwrap.dedent(workflow.split("        run: |\n", 1)[1].split("\n      - name:", 1)[0])
        runtime = REPO_ROOT / ".runtime" / "tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="perf-classifier-", dir=runtime) as directory:
            root = Path(directory)
            (root / "tools/ci").mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO_ROOT / "tools/ci/perf_policy.mjs", root / "tools/ci/perf_policy.mjs")
            fixture = {
                "files": files, "diffFailure": diff_failure,
                "base": json.dumps(base or {"scripts": {"test:isolated": "node test.mjs"}}),
                "head": head if isinstance(head, str) else json.dumps(head or base or {"scripts": {"test:isolated": "node test.mjs"}}),
            }
            (root / "fixture.json").write_text(json.dumps(fixture), encoding="utf-8")
            (root / "event.json").write_text(json.dumps({"pull_request": {"base": {"sha": "base"}, "head": {"sha": "head"}, "labels": [{"name": label} for label in (labels or [])]}}), encoding="utf-8")
            stub = r'''
$ErrorActionPreference = 'Stop'
$fixture = Get-Content -Raw fixture.json | ConvertFrom-Json
function git {
  $global:LASTEXITCODE = 0
  switch ($args[0]) {
    'rev-parse' { if ($args[1] -eq 'HEAD^') { 'parent' } else { 'candidate' } }
    'cat-file' { }
    'show' { if ($args[1] -eq 'base:package.json') { $fixture.base } else { $fixture.head } }
    'diff' { if ($fixture.diffFailure) { $global:LASTEXITCODE = 1 } else {
      $outputArg = $args | Where-Object { $_ -like '--output=*' } | Select-Object -First 1
      [IO.File]::WriteAllText($outputArg.Substring(9), ($fixture.files -join [char]0))
    } }
    default { throw "Unexpected git call: $args" }
  }
}
'''
            (root / "classify.ps1").write_text(stub + script, encoding="utf-8")
            result = subprocess.run(
                [shutil.which("pwsh"), "-NoProfile", "-File", str(root / "classify.ps1")],
                cwd=root, env={**os.environ, "GITHUB_EVENT_PATH": str(root / "event.json"),
                               "GITHUB_EVENT_NAME": event, "GITHUB_OUTPUT": str(root / "output"),
                               "GITHUB_STEP_SUMMARY": str(root / "summary")},
                capture_output=True, text=True, encoding="utf-8", timeout=30,
            )
            if diff_failure:
                self.assertNotEqual(result.returncode, 0)
                return None
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            audit = json.loads((root / ".runtime/reports/generated/perf-pr-gate-classifier.json").read_text(encoding="utf-8-sig"))
            outputs = dict(line.split("=", 1) for line in (root / "output").read_text(encoding="utf-8-sig").splitlines())
            for field in ("should_run_perf", "required_for_merge", "diagnostic_only", "should_enforce_regressions"):
                self.assertEqual(outputs[field], str(audit[field]).lower())
            return audit

    def test_scheduled_and_manual_runs_force_measurement_with_parent_baseline(self):
        for event in ("schedule", "workflow_dispatch"):
            with self.subTest(event=event):
                audit = self.classify([], event=event)
                self.assertTrue(audit["should_run_perf"])
                self.assertTrue(audit["should_enforce_regressions"])
                self.assertTrue(audit["required_for_merge"])
                self.assertFalse(audit["diagnostic_only"])
                self.assertEqual(audit["base_sha"], "parent")

    def test_path_classification_preserves_runtime_coverage_with_sampled_pr_mode(self):
        for path, runs, mode in (
            ("docs/perf/notes.md", False, "skip"),
            ("docs/perf/baseline.json", True, "sample"),
            ("js/any_module.js", True, "sample"),
            ("package-lock.json", True, "sample"),
        ):
            with self.subTest(path=path):
                audit = self.classify([path])
                self.assertEqual(audit["should_run_perf"], runs)
                self.assertEqual(audit["perf_mode"], mode)
                self.assertFalse(audit["should_enforce_regressions"])
                self.assertEqual(audit["scenario_matrix"], [] if mode == "skip" else ["hoi4_1939"])

    def test_explicit_strict_and_expected_change_labels_control_enforcement(self):
        strict = self.classify(["js/core/map_renderer.js"], labels=["ci:perf-strict"])
        self.assertEqual(strict["perf_mode"], "strict")
        self.assertTrue(strict["should_enforce_regressions"])
        self.assertEqual(strict["scenario_matrix"], ["tno_1962", "hoi4_1939"])

        expected = self.classify(["js/core/map_renderer.js"], labels=["ci:perf-expected"])
        self.assertEqual(expected["perf_mode"], "sample")
        self.assertFalse(expected["should_enforce_regressions"])
        self.assertTrue(expected["expected_performance_change"])

    def test_bounded_ui_observes_without_merge_waiting_but_mixed_and_strict_changes_wait(self):
        files = ["js/ui/styled_selects.js", "tests/styled_selects_behavior.test.mjs", "docs/ui/guide.md"]
        for extra, labels, required in (([], [], False), (["js/core/map_renderer.js"], [], False),
                                        (["data/unknown.json"], [], False), ([], ["ci:perf-strict"], True)):
            with self.subTest(extra=extra, labels=labels):
                audit = self.classify(files + extra, labels=labels)
                self.assertTrue(audit["should_run_perf"])
                self.assertEqual(audit["required_for_merge"], required)
                self.assertEqual(audit["diagnostic_only"], not required)

    def test_manifest_exempts_only_isolated_nonperf_test_scripts(self):
        base = {"scripts": {"test:isolated": "node test.mjs", "perf:gate": "node tools/perf/run.mjs"}, "engines": {"node": ">=18"}}
        for head, runs in (
            ({**base, "scripts": {**base["scripts"], "test:isolated": "node other.mjs"}}, False),
            ({**base, "engines": {"node": ">=22"}}, True),
            ({**base, "dependencies": {"example": "1"}}, True),
            ({**base, "scripts": {**base["scripts"], "perf:gate": "node changed.mjs"}}, True),
            ({**base, "scripts": {**base["scripts"], "preinstall": "node setup.mjs"}}, True),
            ("{invalid", True),
        ):
            with self.subTest(head=head):
                self.assertEqual(self.classify(["package.json"], base=base, head=head)["should_run_perf"], runs)
        referenced = {"scripts": {"test:isolated": "node test.mjs", "perf:gate": "npm run test:isolated"}}
        changed = {"scripts": {**referenced["scripts"], "test:isolated": "node changed.mjs"}}
        self.assertTrue(self.classify(["package.json"], base=referenced, head=changed)["should_run_perf"])

    def test_native_git_preserves_renamed_unicode_paths_and_both_sides(self):
        workflow = WORKFLOW_FILE.read_text(encoding="utf-8")
        script = textwrap.dedent(workflow.split("        run: |\n", 1)[1].split("\n      - name:", 1)[0])
        runtime = REPO_ROOT / ".runtime" / "tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="perf-native-classifier-", dir=runtime) as directory:
            root = Path(directory)
            (root / "tools/ci").mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO_ROOT / "tools/ci/perf_policy.mjs", root / "tools/ci/perf_policy.mjs")

            def git(*args):
                return subprocess.run(["git", *args], cwd=root, check=True,
                                      capture_output=True, text=True, encoding="utf-8").stdout.strip()

            git("init")
            git("config", "user.name", "test")
            git("config", "user.email", "test@example.invalid")
            old_path = "js/\u5730\u56fe module.js"
            new_path = "docs/moved module.md"
            (root / "js").mkdir()
            (root / old_path).write_text("unchanged content", encoding="utf-8")
            git("add", ".")
            git("commit", "-m", "base")
            base_sha = git("rev-parse", "HEAD")
            (root / "docs").mkdir()
            git("mv", old_path, new_path)
            git("commit", "-m", "rename")
            head_sha = git("rev-parse", "HEAD")
            (root / "event.json").write_text(json.dumps({"pull_request": {
                "base": {"sha": base_sha}, "head": {"sha": head_sha}}}), encoding="utf-8")
            (root / "classify.ps1").write_text("$ErrorActionPreference = 'Stop'\n" + script, encoding="utf-8")
            completed = subprocess.run([shutil.which("pwsh"), "-NoProfile", "-File", "classify.ps1"],
                cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=30,
                env={**os.environ, "GITHUB_EVENT_PATH": str(root / "event.json"),
                     "GITHUB_EVENT_NAME": "pull_request", "GITHUB_OUTPUT": str(root / "output"),
                     "GITHUB_STEP_SUMMARY": str(root / "summary")})
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            audit = json.loads((root / ".runtime/reports/generated/perf-pr-gate-classifier.json").read_text(encoding="utf-8-sig"))
            self.assertCountEqual(audit["changed_files"], [old_path, new_path])
            self.assertTrue(audit["should_run_perf"])
            self.assertEqual(audit["perf_mode"], "sample")
            self.assertFalse(audit["should_enforce_regressions"])
            self.assertEqual(audit["scenario_matrix"], ["hoi4_1939"])
            self.assertEqual(audit["candidate_sha"], head_sha)

    def test_diff_failure_does_not_become_successful_skip(self):
        self.classify([], diff_failure=True)


class PerfGateContractTest(unittest.TestCase):
    def test_performance_lock_is_pinned_and_aligned_with_development_environment(self):
        def read_lock(name):
            return {line.strip() for line in (REPO_ROOT / name).read_text(encoding="utf-8").splitlines()
                    if line.strip() and not line.lstrip().startswith("#")}
        perf = read_lock("requirements-perf.lock.txt")
        dev = read_lock("requirements-dev.lock.txt")
        self.assertTrue(perf)
        self.assertTrue(perf < dev, perf - dev)
        self.assertTrue(all(re.fullmatch(r"[A-Za-z0-9_.-]+==[A-Za-z0-9_.+-]+", item) for item in perf))
        names = {item.split("==")[0] for item in perf}
        self.assertTrue({"geopandas", "numpy", "pandas", "pyogrio", "pyproj", "shapely", "topojson", "requests", "six"} <= names)
        self.assertFalse({"matplotlib", "rasterio", "scikit-learn", "pytest"} & names)


    def test_perf_aggregator_rejects_failed_cancelled_skipped_or_missing_matrix(self):
        workflow = WORKFLOW_FILE.read_text(encoding="utf-8")
        script = textwrap.dedent(workflow.rsplit("          node <<'NODE'\n", 1)[1].split("          NODE", 1)[0])
        cases = []
        policies = [
            {"should_run_perf": "false", "required_for_merge": "false", "diagnostic_only": "false", "perf_mode": "skip", "scenario_matrix": "[]", "should_enforce_regressions": "false"},
            {"should_run_perf": "true", "required_for_merge": "false", "diagnostic_only": "true", "perf_mode": "sample", "scenario_matrix": '["hoi4_1939"]', "should_enforce_regressions": "false"},
            {"should_run_perf": "true", "required_for_merge": "true", "diagnostic_only": "false", "perf_mode": "sample", "scenario_matrix": '["hoi4_1939"]', "should_enforce_regressions": "false"},
            {"should_run_perf": "true", "required_for_merge": "true", "diagnostic_only": "false", "perf_mode": "strict", "scenario_matrix": '["tno_1962","hoi4_1939"]', "should_enforce_regressions": "true"},
        ]
        for classification in ("success", "failure", "cancelled", "skipped", "unknown"):
            for policy in policies:
                for state in ("success", "failure", "cancelled", "skipped", "unknown"):
                    expected_state = "success" if policy["required_for_merge"] == "true" else "skipped"
                    cases.append(({
                        "classify": {"result": classification, "outputs": policy},
                        "perf-scenarios": {"result": state},
                    }, classification == "success" and state == expected_state))
        cases.extend([({}, False), ({"perf-scenarios": {"result": "success"}}, False),
                      ({"classify": {"result": "success"}, "perf-scenarios": {"result": "success"}}, False),
                      ({"classify": {"result": "success", "outputs": policies[2]},
                        "perf-scenarios": {"result": "success"}, "extra": {}}, False)])
        for results, expected in cases:
            with self.subTest(results=results):
                completed = subprocess.run(["node", "-e", script], capture_output=True, text=True,
                                           env={**os.environ, "PERF_SCENARIO_RESULTS": json.dumps(results)})
                self.assertEqual(completed.returncode == 0, expected, completed.stdout + completed.stderr)

    def test_package_perf_gate_uses_real_gate_scenarios(self):
        package_payload = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
        perf_baseline_script = package_payload["scripts"]["perf:baseline"]
        perf_gate_script = package_payload["scripts"]["perf:gate"]
        self.assertEqual(
            package_payload["scripts"].get("verify:perf-gate-contract"),
            "npm run python -- -m unittest tests.test_perf_gate_contract -q",
        )
        self.assertEqual(
            package_payload["scripts"].get("bench:editor-performance"),
            "npm run python -- ops/browser-mcp/editor-performance-benchmark.py --out .runtime/output/perf/editor-performance-benchmark.json --screenshot-dir .runtime/browser/mcp-artifacts/perf",
        )
        baseline_scenarios = re.search(r"--scenarios\s+(\S+)", perf_baseline_script)
        gate_scenarios = re.search(r"--scenarios\s+(\S+)", perf_gate_script)
        self.assertIsNotNone(baseline_scenarios)
        self.assertIsNotNone(gate_scenarios)
        self.assertEqual(baseline_scenarios.group(1), "tno_1962,hoi4_1939")
        self.assertEqual(gate_scenarios.group(1), baseline_scenarios.group(1))
        for command in (perf_baseline_script, perf_gate_script):
            self.assertIn("--runs 5", command)
            self.assertIn("--warmups 3", command)
            self.assertNotIn("blank_base", command)


    def test_baseline_markdown_declares_gate_vs_observation_roles(self):
        markdown = BASELINE_MD.read_text(encoding="utf-8")
        self.assertIn("- Architecture: x64", markdown)
        self.assertIn(
            "- CPU: Intel(R) Core(TM) Ultra 9 285HX (24 logical processors)",
            markdown,
        )
        self.assertIn("- Memory class: 64 GiB", markdown)
        self.assertIn(
            '- Runner: {"provider":"local","environment":"local","os":"win32","arch":"x64","imageOs":"win32","imageVersion":"10.0.26200"}',
            markdown,
        )
        self.assertIn("- Gate scenarios: tno_1962, hoi4_1939", markdown)
        self.assertIn("- Observation samples: none", markdown)
        self.assertNotIn("## Scenario: blank_base", markdown)
        self.assertRegex(markdown, r"## Scenario: tno_1962\s+- sample_role: gate")
        self.assertRegex(markdown, r"## Scenario: hoi4_1939\s+- sample_role: gate")
        self.assertTrue(markdown.endswith("\n"))
        self.assertFalse(markdown.endswith("\n\n"))


    def test_checked_in_baseline_keeps_report_identity_and_worker_summary_fields(self):
        baseline_payload = json.loads(BASELINE_JSON.read_text(encoding="utf-8"))
        ratification = json.loads(BASELINE_RATIFICATION.read_text(encoding="utf-8"))
        self.assertEqual(baseline_payload.get("schemaVersion"), 3)
        self.assertEqual(baseline_payload.get("benchmarkMetricsSchemaVersion"), "3.3")
        self.assertEqual(baseline_payload.get("probeSchema"), "mc_perf_snapshot")
        self.assertEqual(baseline_payload.get("baselineDate"), "2026-07-30")
        self.assertEqual(baseline_payload.get("gitHead"), BASELINE_SOURCE_GIT_HEAD)
        self.assertEqual(baseline_payload.get("config", {}).get("scenarios"), ["tno_1962", "hoi4_1939"])
        self.assertEqual(baseline_payload.get("config", {}).get("runs"), 5)
        self.assertEqual(baseline_payload.get("config", {}).get("warmups"), 3)
        self.assertEqual(
            baseline_payload.get("environmentAdmission", {}).get("policyId"),
            "standard-perf-admission-v1",
        )
        self.assertEqual(baseline_payload.get("environmentAdmission", {}).get("status"), "admitted")
        self.assertEqual(
            baseline_payload.get("generationFence", {}).get("policyId"),
            "standard-perf-generation-fence-v1",
        )
        self.assertEqual(baseline_payload.get("generationFence", {}).get("status"), "stable")
        self.assertEqual(
            baseline_payload.get("environmentAdmission", {}).get("git", {}).get("head"),
            BASELINE_SOURCE_GIT_HEAD,
        )
        self.assertEqual(
            baseline_payload.get("generationFence", {}).get("git", {}).get("head"),
            BASELINE_SOURCE_GIT_HEAD,
        )
        self.assertEqual(set(baseline_payload.get("scenarios", {})), {"tno_1962", "hoi4_1939"})
        self.assertEqual(
            set(baseline_payload.get("workloadIdentity", {}).get("scenarios", {})),
            {"tno_1962", "hoi4_1939"},
        )
        environment = baseline_payload.get("environment", {})
        self.assertEqual(environment.get("arch"), "x64")
        self.assertEqual(environment.get("cpuCount"), 24)
        self.assertEqual(environment.get("memoryGiB"), 64)
        self.assertEqual(environment.get("runnerIdentity", {}).get("provider"), "local")
        self.assertRegex(str(environment.get("browserVersion", "")), r"\d+")
        self.assertEqual(
            environment.get("packageLockSha256"),
            canonical_text_sha256(PACKAGE_LOCK),
        )
        role_policy = baseline_payload.get("renderSampleRolePolicy", {})
        self.assertEqual(role_policy.get("policyId"), "render-sample-role-v2")
        self.assertEqual(role_policy.get("canonicalRoleId"), "last-post-promotion-idle-scenario-frame-v1")
        raw_evidence = baseline_payload.get("rawEvidence", {})
        self.assertEqual(raw_evidence.get("schemaVersion"), 1)
        self.assertEqual(raw_evidence.get("policyId"), "standard-perf-raw-window-v1")
        self.assertEqual(raw_evidence.get("mode"), "baseline")
        self.assertEqual(
            raw_evidence.get("root"),
            ".runtime/output/perf/baseline_2026-07-30/baseline",
        )
        self.assertEqual(raw_evidence.get("measuredRunCount"), 10)

        def serialized_raw_sha256(payload):
            serialized = json.dumps(
                payload,
                ensure_ascii=False,
                indent=2,
                separators=(",", ": "),
            ) + "\n"
            return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

        self.assertEqual(
            serialized_raw_sha256(baseline_payload.get("environmentAdmission", {})),
            raw_evidence.get("environmentAdmission", {}).get("rawSha256"),
        )
        self.assertEqual(
            serialized_raw_sha256(baseline_payload.get("generationFence", {})),
            raw_evidence.get("generationFence", {}).get("rawSha256"),
        )
        raw_paths = set()
        for scenario_id in ("tno_1962", "hoi4_1939"):
            scenario = baseline_payload.get("scenarios", {}).get(scenario_id, {})
            summary = scenario.get("summary", {})
            self.assertIn("workerDecodeMs", summary)
            self.assertIn("workerMetaBuildMs", summary)
            self.assertIsInstance(summary.get("workerDecodeMs"), (int, float))
            self.assertIsInstance(summary.get("workerMetaBuildMs"), (int, float))
            identity = baseline_payload.get("workloadIdentity", {}).get("scenarios", {}).get(scenario_id, {})
            self.assertEqual(scenario.get("workloadIdentity"), identity)
            manifest_path = REPO_ROOT / "data" / "scenarios" / scenario_id / "manifest.json"
            self.assertEqual(identity.get("manifestPath"), manifest_path.relative_to(REPO_ROOT).as_posix())
            self.assertEqual(
                identity.get("manifestSha256"),
                # This immutable report describes its ratified source revision;
                # candidate manifests are compared by the live workload gate.
                ratification["workloadIdentityChanges"][scenario_id]["ratifiedManifestSha256"],
            )
            self.assertRegex(str(identity.get("manifestSha256", "")), r"^[0-9a-f]{64}$")
            self.assertGreater(int(identity.get("featureCount", 0)), 0)
            role_summary = scenario.get("renderSampleRoleSummary", {})
            self.assertEqual(role_summary.get("matchedRunCount"), 5)
            self.assertEqual(role_summary.get("mismatchCount"), 0)
            runs = scenario.get("runs", [])
            self.assertEqual(len(runs), 5)
            for run in runs:
                raw_path = run.get("rawPath")
                self.assertIsInstance(raw_path, str)
                self.assertTrue(raw_path.startswith(f"{raw_evidence.get('root')}/{scenario_id}/run-"))
                self.assertNotIn(raw_path, raw_paths)
                raw_paths.add(raw_path)
                embedded_raw = dict(run)
                embedded_raw.pop("rawPath")
                expected_raw_sha256 = embedded_raw.pop("rawSha256")
                self.assertRegex(str(expected_raw_sha256), r"^[0-9a-f]{64}$")
                self.assertEqual(serialized_raw_sha256(embedded_raw), expected_raw_sha256)
        self.assertEqual(len(raw_paths), 10)

    def test_baseline_ratification_receipt_binds_workload_update_and_evidence(self):
        baseline_payload = json.loads(BASELINE_JSON.read_text(encoding="utf-8"))
        receipt = json.loads(BASELINE_RATIFICATION.read_text(encoding="utf-8"))
        ratified = receipt.get("ratifiedBaseline", {})

        self.assertEqual(receipt.get("schemaVersion"), 1)
        self.assertEqual(receipt.get("policyId"), "standard-perf-baseline-ratification-v1")
        self.assertEqual(receipt.get("decision"), "accepted-scenario-workload-update")
        self.assertFalse(receipt.get("commonModeDriftAccepted"))
        self.assertNotIn("common-mode", " ".join(receipt.get("basis", [])).lower())
        self.assertEqual(ratified.get("sourceGitHead"), BASELINE_SOURCE_GIT_HEAD)
        self.assertEqual(ratified.get("generatedAt"), baseline_payload.get("generatedAt"))
        self.assertEqual(
            ratified.get("jsonSha256"),
            canonical_text_sha256(BASELINE_JSON),
        )
        self.assertEqual(ratified.get("jsonBytes"), len(BASELINE_JSON.read_text(encoding="utf-8").encode("utf-8")))
        self.assertEqual(
            ratified.get("markdownSha256"),
            canonical_text_sha256(BASELINE_MD),
        )
        self.assertEqual(ratified.get("markdownBytes"), len(BASELINE_MD.read_text(encoding="utf-8").encode("utf-8")))
        self.assertEqual(ratified.get("rawEvidence"), baseline_payload.get("rawEvidence"))

        raw_inventory = [
            baseline_payload["rawEvidence"]["environmentAdmission"],
            baseline_payload["rawEvidence"]["generationFence"],
        ]
        raw_inventory.extend(
            {"rawPath": run["rawPath"], "rawSha256": run["rawSha256"]}
            for scenario in baseline_payload["scenarios"].values()
            for run in scenario["runs"]
        )
        raw_inventory.sort(key=lambda entry: entry["rawPath"])
        serialized_inventory = json.dumps(
            raw_inventory,
            ensure_ascii=False,
            indent=2,
            separators=(",", ": "),
        ) + "\n"
        self.assertEqual(ratified.get("rawInventoryCount"), 12)
        self.assertEqual(ratified.get("rawInventoryCount"), len(raw_inventory))
        self.assertEqual(
            ratified.get("rawInventorySha256"),
            hashlib.sha256(serialized_inventory.encode("utf-8")).hexdigest(),
        )

        previous = receipt.get("previousCanonical", {})
        self.assertEqual(previous.get("sourceGitHead"), PREVIOUS_BASELINE_SOURCE_GIT_HEAD)
        self.assertEqual(previous.get("jsonSha256"), "8c8586404e6fce38773330411e88c79174df37651adc4848fca718f9a61a5e4a")
        self.assertEqual(previous.get("jsonBytes"), 821175)
        self.assertEqual(previous.get("markdownSha256"), "58d4ee161882ce903690b9bb792aa1337f4e16400a051c08ac29d10836b97bb6")
        self.assertEqual(previous.get("markdownBytes"), 3996)

        identity_changes = receipt.get("workloadIdentityChanges", {})
        self.assertEqual(set(identity_changes), {"tno_1962", "hoi4_1939"})
        self.assertEqual(identity_changes.get("tno_1962"), {
            "changedFields": ["manifestSha256"],
            "previousManifestSha256": "64a12a587f39dc1e38a632c68d8d46eb6eb40068598b129dc5578332b61f10e4",
            "ratifiedManifestSha256": "63a2ee11be2c75c7fd419de6887376adc79b1acff52ef017c6d6f54b823869fd",
            "previousIdentitySha256": "cc76f5310231f2ba1cf00f9372e606493eeb8064ab0afea85e9a5421bca52117",
            "ratifiedIdentitySha256": "68c1ecbf4fb7a6d39a56fb31dbd141fea592f3f0f9554507cb1630859e657df0",
            "stableFieldsSha256": "8fdfed9b162909ef7ce63d2bc87345693444ee3228674f94259763cb86d175e5",
            "identityUnchanged": False,
        })
        self.assertEqual(identity_changes.get("hoi4_1939"), {
            "changedFields": [],
            "previousManifestSha256": "a38b78b184e410dc836ccb7ab62002739115ce9cd913f4dea26b0bb51c385260",
            "ratifiedManifestSha256": "a38b78b184e410dc836ccb7ab62002739115ce9cd913f4dea26b0bb51c385260",
            "previousIdentitySha256": "63ae8569f2aeb94357028c5b8a9084c66644ed7b11699d693219432152b07045",
            "ratifiedIdentitySha256": "63ae8569f2aeb94357028c5b8a9084c66644ed7b11699d693219432152b07045",
            "identityUnchanged": True,
        })
        for scenario_id, change in identity_changes.items():
            current_identity = baseline_payload["workloadIdentity"]["scenarios"][scenario_id]
            self.assertEqual(change["ratifiedManifestSha256"], current_identity["manifestSha256"])
            self.assertEqual(change["ratifiedIdentitySha256"], canonical_json_sha256(current_identity))
        tno_stable_identity = dict(baseline_payload["workloadIdentity"]["scenarios"]["tno_1962"])
        tno_stable_identity.pop("manifestSha256")
        self.assertEqual(
            identity_changes["tno_1962"]["stableFieldsSha256"],
            canonical_json_sha256(tno_stable_identity),
        )

        expected_previous_metrics = {
            "tno_1962": {
                "totalStartupMs": 22807.099999997765,
                "scenarioAppliedMs": 8874.10000000149,
                "applyScenarioBundleMs": 1920,
                "refreshScenarioApplyMs": 962.8000000007451,
                "renderSampleMedianMs": 2228.6500000003725,
            },
            "hoi4_1939": {
                "totalStartupMs": 20303.5,
                "scenarioAppliedMs": 8924.699999999255,
                "applyScenarioBundleMs": 1961.6000000014901,
                "refreshScenarioApplyMs": 1118.300000000745,
                "renderSampleMedianMs": 1999.25,
            },
        }
        comparison = receipt.get("sameMachinePreviousCanonicalComparison", {})
        self.assertEqual(comparison.get("decision"), "accepted-scenario-workload-update")
        self.assertEqual(comparison.get("previousSourceGitHead"), PREVIOUS_BASELINE_SOURCE_GIT_HEAD)
        self.assertEqual(comparison.get("ratifiedSourceGitHead"), BASELINE_SOURCE_GIT_HEAD)
        self.assertEqual(comparison.get("metricOrder"), [
            "totalStartupMs",
            "scenarioAppliedMs",
            "applyScenarioBundleMs",
            "refreshScenarioApplyMs",
            "renderSampleMedianMs",
        ])
        self.assertEqual(set(comparison.get("scenarios", {})), set(expected_previous_metrics))
        comparison_ratios = []
        for scenario_id, scenario_metrics in comparison.get("scenarios", {}).items():
            self.assertEqual(set(scenario_metrics), set(comparison["metricOrder"]))
            baseline_summary = baseline_payload.get("scenarios", {}).get(scenario_id, {}).get("summary", {})
            for metric_name, metric in scenario_metrics.items():
                self.assertEqual(metric["previous"], expected_previous_metrics[scenario_id][metric_name])
                self.assertEqual(metric["ratified"], baseline_summary.get(metric_name))
                self.assertAlmostEqual(metric["ratio"], metric["ratified"] / metric["previous"], places=12)
                comparison_ratios.append(metric["ratio"])
        self.assertEqual(len(comparison_ratios), 10)
        self.assertTrue(all(ratio < 1 for ratio in comparison_ratios))


    def test_editor_benchmark_output_paths_stay_inside_runtime(self):
        benchmark = load_editor_benchmark_module()
        inside = benchmark.resolve_runtime_output_path(".runtime/output/perf/report.json", label="test")
        self.assertEqual(inside, (REPO_ROOT / ".runtime" / "output" / "perf" / "report.json").resolve())
        with self.assertRaises(ValueError):
            benchmark.resolve_runtime_output_path("../outside.json", label="test")

    def test_repeated_zoom_regions_metric_summarizes_degradation_black_longtask_and_memory(self):
        benchmark = load_editor_benchmark_module()
        suite = {
            "scenarioId": "tno_1962",
            "scenarioApply": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
            },
            "repeatedZoomRegions": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
                "interactionProbeSchema": "mc_repeated_zoom_regions_v1",
                "passAttributionSchema": "mc_pass_attribution_v1",
                "cyclesPerRegion": 2,
                "wheelsPerCycle": 5,
                "regions": {
                    "europe": {
                        "cycles": [
                            {
                                "firstIdleAfterLastWheelMs": 100,
                                "passAttribution": {
                                    "passes": {
                                        "politicalBg": {"durationMs": 12},
                                    },
                                },
                                "longTaskAttribution": {
                                    "schema": "mc_long_task_attribution_v1",
                                    "unknownLongTaskCount": 0,
                                    "topOwner": "render-pass",
                                    "categoryCounts": {"render-pass": 1},
                                    "tasks": [
                                        {
                                            "category": "render-pass",
                                            "subOwner": "render-pass:politicalBg",
                                            "subOwnerEvidence": {
                                                "metricName": "politicalBg",
                                                "metricDurationMs": 900,
                                                "metricRecordedAt": 1000,
                                                "taskWindowMs": [900, 1900],
                                                "matchReason": "dominant-render-pass-overlap",
                                                "renderPass": "politicalBg",
                                            },
                                            "subOwnerConfidence": "high",
                                            "durationMs": 900,
                                            "startTime": 123,
                                            "evidence": ["politicalBg=900ms"],
                                            "confidence": "high",
                                        }
                                    ],
                                },
                                "blackPixelAttribution": {
                                    "classification": "normal",
                                },
                            },
                            {
                                "firstIdleAfterLastWheelMs": 125,
                                "passAttribution": {
                                    "passes": {
                                        "politicalBg": {"durationMs": 18},
                                    },
                                },
                                "longTaskAttribution": {
                                    "schema": "mc_long_task_attribution_v1",
                                    "unknownLongTaskCount": 1,
                                    "topOwner": "unknown",
                                    "categoryCounts": {"unknown": 1},
                                    "tasks": [
                                        {
                                            "category": "unknown",
                                            "subOwner": "unknown",
                                            "subOwnerEvidence": {
                                                "metricName": "unknown",
                                                "metricDurationMs": 800,
                                                "metricRecordedAt": 1200,
                                                "taskWindowMs": [1000, 1800],
                                                "matchReason": "no-subowner-match",
                                            },
                                            "subOwnerConfidence": "low",
                                            "durationMs": 800,
                                            "startTime": 456,
                                            "evidence": ["no-pass-or-browser-attribution"],
                                            "confidence": "low",
                                        }
                                    ],
                                },
                                "unknownLongTaskCount": 1,
                                "blackPixelAttribution": {
                                    "classification": "dark-content-candidate",
                                },
                            },
                        ],
                        "degradation": {"ratio": 1.25},
                        "maxBlackPixelRatio": 0.02,
                        "maxLongTaskMs": 30,
                        "memoryDelta": {"usedJSHeapSize": 2048},
                        "passAttributionSchema": "mc_pass_attribution_v1",
                    }
                },
            },
        }
        metric = benchmark.build_suite_benchmark_metrics(suite)["repeatedZoomRegions"]
        self.assertTrue(metric["present"])
        self.assertEqual(metric["durationMs"], 125)
        self.assertEqual(metric["count"], 1.25)
        self.assertTrue(metric["details"]["sameScenario"])
        self.assertEqual(metric["details"]["interactionProbeSchema"], "mc_repeated_zoom_regions_v1")
        self.assertEqual(metric["details"]["passAttributionSchema"], "mc_pass_attribution_v1")
        self.assertEqual(metric["details"]["regions"]["europe"]["degradation"]["ratio"], 1.25)
        self.assertEqual(metric["details"]["passAttribution"]["politicalBg"]["max"], 18)
        self.assertEqual(metric["details"]["longTask"]["attribution"]["schema"], "mc_long_task_attribution_v1")
        self.assertEqual(metric["details"]["longTask"]["attribution"]["subOwnerSchema"], "mc_long_task_subowner_v1")
        self.assertEqual(metric["details"]["longTask"]["attribution"]["unknownLongTaskCount"], 1)
        self.assertEqual(metric["details"]["longTask"]["attribution"]["categoryCounts"]["render-pass"], 1)
        self.assertEqual(metric["details"]["longTask"]["attribution"]["categoryCounts"]["unknown"], 1)
        self.assertEqual(metric["details"]["longTask"]["attribution"]["subOwnerCounts"]["render-pass:politicalBg"], 1)
        self.assertEqual(metric["details"]["longTask"]["attribution"]["subOwnerCounts"]["unknown"], 1)
        self.assertFalse(metric["details"]["longTask"]["attribution"]["gate"]["passed"])
        self.assertEqual(metric["details"]["longTask"]["attribution"]["gate"]["unknownLongTaskCount"], 1)
        self.assertEqual(metric["details"]["longTask"]["attribution"]["gate"]["unknownTopOwnerCount"], 1)
        self.assertEqual(metric["details"]["longTask"]["attribution"]["gate"]["unknownSubOwnerCount"], 1)
        self.assertEqual(metric["details"]["longTask"]["attribution"]["gate"]["missingSubOwnerEvidenceCount"], 0)
        self.assertEqual(metric["details"]["longTask"]["attribution"]["gate"]["missingSubOwnerConfidenceCount"], 0)
        self.assertEqual(metric["details"]["longTask"]["attribution"]["gate"]["invalidCategoryCount"], 0)
        self.assertEqual(metric["details"]["regions"]["europe"]["longTaskAttribution"]["unknownLongTaskCount"], 1)
        self.assertEqual(metric["details"]["regions"]["europe"]["longTaskAttribution"]["subOwnerSchema"], "mc_long_task_subowner_v1")
        self.assertEqual(metric["details"]["regions"]["europe"]["longTaskAttribution"]["subOwnerCounts"]["render-pass:politicalBg"], 1)
        self.assertEqual(metric["details"]["regions"]["europe"]["longTaskAttribution"]["subOwnerCounts"]["unknown"], 1)
        self.assertEqual(metric["details"]["regions"]["europe"]["longTaskAttribution"]["gate"]["unknownSubOwnerCount"], 1)
        self.assertFalse(metric["details"]["regions"]["europe"]["longTaskAttribution"]["gate"]["passed"])
        self.assertEqual(metric["details"]["blackPixelClassification"]["normal"], 1)
        self.assertEqual(metric["details"]["blackPixelClassification"]["dark-content-candidate"], 1)

    def test_repeated_zoom_regions_longtask_subowners_pass_when_all_tasks_are_owned(self):
        benchmark = load_editor_benchmark_module()
        suite = {
            "scenarioId": "tno_1962",
            "scenarioApply": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
            },
            "repeatedZoomRegions": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
                "interactionProbeSchema": "mc_repeated_zoom_regions_v1",
                "passAttributionSchema": "mc_pass_attribution_v1",
                "cyclesPerRegion": 1,
                "wheelsPerCycle": 1,
                "shortArtifactPass": True,
                "fullArtifactPass": True,
                "regions": {
                    "europe": {
                        "cycles": [
                            {
                                "firstIdleAfterLastWheelMs": 100,
                                "longTaskAttribution": {
                                    "schema": "mc_long_task_attribution_v1",
                                    "subOwnerSchema": "mc_long_task_subowner_v1",
                                    "unknownLongTaskCount": 0,
                                    "unknownSubOwnerCount": 0,
                                    "topOwner": "render-pass",
                                    "topSubOwner": "render-pass:politicalBg",
                                    "categoryCounts": {"render-pass": 1},
                                    "subOwnerCounts": {"render-pass:politicalBg": 1},
                                    "tasks": [
                                        {
                                            "category": "render-pass",
                                            "subOwner": "render-pass:politicalBg",
                                            "subOwnerEvidence": {
                                                "metricName": "politicalBg",
                                                "metricDurationMs": 900,
                                                "metricRecordedAt": 1000,
                                                "taskWindowMs": [900, 1900],
                                                "matchReason": "dominant-render-pass-overlap",
                                                "renderPass": "politicalBg",
                                            },
                                            "subOwnerConfidence": "high",
                                            "durationMs": 900,
                                            "startTime": 123,
                                            "evidence": ["politicalBg=900ms"],
                                            "confidence": "high",
                                        }
                                    ],
                                },
                            }
                        ],
                        "degradation": {"ratio": 1.0},
                        "maxLongTaskMs": 900,
                    }
                },
            },
        }

        metric = benchmark.build_suite_benchmark_metrics(suite)["repeatedZoomRegions"]
        attribution = metric["details"]["longTask"]["attribution"]

        self.assertEqual(attribution["subOwnerSchema"], "mc_long_task_subowner_v1")
        self.assertEqual(attribution["subOwnerCounts"]["render-pass:politicalBg"], 1)
        self.assertTrue(attribution["gate"]["passed"])
        self.assertEqual(attribution["gate"]["unknownSubOwnerCount"], 0)
        self.assertEqual(attribution["gate"]["missingSubOwnerEvidenceCount"], 0)
        self.assertEqual(attribution["gate"]["missingSubOwnerConfidenceCount"], 0)
        self.assertTrue(attribution["gate"]["topSubOwnerActionable"])
        self.assertTrue(metric["details"]["artifactPassMarkers"]["shortArtifactPass"])
        self.assertTrue(metric["details"]["artifactPassMarkers"]["fullArtifactPass"])

    def test_repeated_zoom_regions_without_long_tasks_does_not_fail_top_subowner_gate(self):
        benchmark = load_editor_benchmark_module()
        suite = {
            "scenarioId": "tno_1962",
            "scenarioApply": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
            },
            "repeatedZoomRegions": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
                "interactionProbeSchema": "mc_repeated_zoom_regions_v1",
                "passAttributionSchema": "mc_pass_attribution_v1",
                "cyclesPerRegion": 1,
                "wheelsPerCycle": 1,
                "shortArtifactPass": True,
                "fullArtifactPass": True,
                "regions": {
                    "europe": {
                        "cycles": [
                            {
                                "firstIdleAfterLastWheelMs": 80,
                                "longTaskAttribution": {
                                    "schema": "mc_long_task_attribution_v1",
                                    "subOwnerSchema": "mc_long_task_subowner_v1",
                                    "thresholdMs": 750,
                                    "unknownLongTaskCount": 0,
                                    "unknownSubOwnerCount": 0,
                                    "topOwner": "",
                                    "topSubOwner": "",
                                    "categoryCounts": {},
                                    "subOwnerCounts": {},
                                    "tasks": [],
                                },
                            }
                        ],
                        "degradation": {"ratio": 1.0},
                        "maxLongTaskMs": 0,
                    }
                },
            },
        }

        metric = benchmark.build_suite_benchmark_metrics(suite)["repeatedZoomRegions"]
        attribution = metric["details"]["longTask"]["attribution"]
        region_attribution = metric["details"]["regions"]["europe"]["longTaskAttribution"]

        self.assertTrue(attribution["gate"]["passed"])
        self.assertEqual(attribution["gate"]["taskCount"], 0)
        self.assertEqual(attribution["gate"]["unknownTopSubOwnerCount"], 0)
        self.assertEqual(attribution["gate"]["unknownSubOwnerCount"], 0)
        self.assertTrue(region_attribution["gate"]["passed"])
        self.assertEqual(region_attribution["gate"]["taskCount"], 0)
        self.assertEqual(region_attribution["gate"]["unknownTopSubOwnerCount"], 0)

    def test_repeated_zoom_regions_missing_artifact_markers_stay_unknown(self):
        benchmark = load_editor_benchmark_module()
        suite = {
            "scenarioId": "tno_1962",
            "scenarioApply": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
            },
            "repeatedZoomRegions": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
                "interactionProbeSchema": "mc_repeated_zoom_regions_v1",
                "regions": {},
            },
        }

        metric = benchmark.build_suite_benchmark_metrics(suite)["repeatedZoomRegions"]

        selfIsNone = self.assertIsNone
        selfIsNone(metric["details"]["artifactPassMarkers"]["shortArtifactPass"])
        selfIsNone(metric["details"]["artifactPassMarkers"]["fullArtifactPass"])
        selfIsNone(metric["details"]["longTask"]["attribution"]["gate"]["shortArtifactPassed"])
        selfIsNone(metric["details"]["longTask"]["attribution"]["gate"]["fullArtifactPassed"])

    def test_repeated_zoom_regions_artifact_markers_require_real_booleans(self):
        benchmark = load_editor_benchmark_module()
        suite = {
            "scenarioId": "tno_1962",
            "scenarioApply": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
            },
            "repeatedZoomRegions": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
                "interactionProbeSchema": "mc_repeated_zoom_regions_v1",
                "shortArtifactPass": "false",
                "fullArtifactPass": "0",
                "regions": {},
            },
        }

        metric = benchmark.build_suite_benchmark_metrics(suite)["repeatedZoomRegions"]

        self.assertIsNone(metric["details"]["artifactPassMarkers"]["shortArtifactPass"])
        self.assertIsNone(metric["details"]["artifactPassMarkers"]["fullArtifactPass"])
        self.assertIsNone(metric["details"]["longTask"]["attribution"]["gate"]["shortArtifactPassed"])
        self.assertIsNone(metric["details"]["longTask"]["attribution"]["gate"]["fullArtifactPassed"])

    def test_repeated_zoom_regions_naked_subowner_is_not_actionable(self):
        benchmark = load_editor_benchmark_module()
        suite = {
            "scenarioId": "tno_1962",
            "scenarioApply": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
            },
            "repeatedZoomRegions": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
                "interactionProbeSchema": "mc_repeated_zoom_regions_v1",
                "regions": {
                    "europe": {
                        "cycles": [
                            {
                                "firstIdleAfterLastWheelMs": 100,
                                "longTaskAttribution": {
                                    "schema": "mc_long_task_attribution_v1",
                                    "unknownLongTaskCount": 0,
                                    "topOwner": "chunk-promotion",
                                    "topSubOwner": "post-commit-replay",
                                    "categoryCounts": {"chunk-promotion": 1},
                                    "subOwnerCounts": {"post-commit-replay": 1},
                                    "tasks": [
                                        {
                                            "category": "chunk-promotion",
                                            "subOwner": "post-commit-replay",
                                            "subOwnerEvidence": {"matchReason": "legacy-naked-subowner"},
                                            "subOwnerConfidence": "medium",
                                            "durationMs": 900,
                                            "evidence": ["chunkMetric=zoomEndToChunkVisibleMs:900ms"],
                                            "confidence": "medium",
                                        }
                                    ],
                                },
                            }
                        ],
                        "degradation": {"ratio": 1.0},
                        "maxLongTaskMs": 900,
                    }
                },
            },
        }

        attribution = benchmark.build_suite_benchmark_metrics(suite)["repeatedZoomRegions"]["details"]["longTask"]["attribution"]

        self.assertFalse(attribution["gate"]["passed"])
        self.assertFalse(attribution["gate"]["topSubOwnerActionable"])
        self.assertEqual(attribution["gate"]["unknownSubOwnerCount"], 1)
        self.assertEqual(attribution["gate"]["unknownTopSubOwnerCount"], 1)

    def test_repeated_zoom_regions_uses_aggregate_gate_when_tasks_are_truncated(self):
        benchmark = load_editor_benchmark_module()
        suite = {
            "scenarioId": "tno_1962",
            "scenarioApply": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
            },
            "repeatedZoomRegions": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
                "interactionProbeSchema": "mc_repeated_zoom_regions_v1",
                "regions": {
                    "europe": {
                        "cycles": [],
                        "longTaskAttribution": [
                            {
                                "schema": "mc_long_task_attribution_v1",
                                "subOwnerSchema": "mc_long_task_subowner_v1",
                                "unknownLongTaskCount": 2,
                                "topOwner": "unknown",
                                "topSubOwner": "unknown",
                                "categoryCounts": {"unknown": 2},
                                "subOwnerCounts": {"unknown": 2},
                                "subOwnerMaxMs": {"unknown": 1200},
                                "gate": {
                                    "schema": "mc_long_task_attribution_gate_v1",
                                    "taskCount": 25,
                                    "unknownLongTaskCount": 2,
                                    "unknownTopOwnerCount": 1,
                                    "unknownSubOwnerCount": 2,
                                    "unknownTopSubOwnerCount": 1,
                                    "invalidCategoryCount": 0,
                                    "missingEvidenceCount": 0,
                                    "missingConfidenceCount": 0,
                                    "missingSubOwnerEvidenceCount": 0,
                                    "missingSubOwnerConfidenceCount": 0,
                                },
                                "tasks": [
                                    {
                                        "category": "render-pass",
                                        "subOwner": "render-pass:politicalBg",
                                        "subOwnerEvidence": {"matchReason": "dominant-render-pass-overlap"},
                                        "subOwnerConfidence": "high",
                                        "durationMs": 800,
                                        "evidence": ["politicalBg=800ms"],
                                        "confidence": "high",
                                    }
                                ],
                            }
                        ],
                        "degradation": {"ratio": 1.0},
                        "maxLongTaskMs": 1200,
                    }
                },
            },
        }

        region_gate = benchmark.build_suite_benchmark_metrics(suite)["repeatedZoomRegions"]["details"]["regions"]["europe"]["longTaskAttribution"]["gate"]

        self.assertFalse(region_gate["passed"])
        self.assertEqual(region_gate["taskCount"], 25)
        self.assertEqual(region_gate["unknownLongTaskCount"], 2)
        self.assertEqual(region_gate["unknownSubOwnerCount"], 2)

    def test_repeated_zoom_regions_aggregate_gate_sums_region_unknowns(self):
        benchmark = load_editor_benchmark_module()

        def cycle_with_unknown(render_duration, unknown_duration):
            return {
                "firstIdleAfterLastWheelMs": 100,
                "longTaskAttribution": {
                    "schema": "mc_long_task_attribution_v1",
                    "subOwnerSchema": "mc_long_task_subowner_v1",
                    "unknownLongTaskCount": 1,
                    "unknownSubOwnerCount": 1,
                    "topOwner": "render-pass",
                    "topSubOwner": "render-pass:contextScenario",
                    "categoryCounts": {"render-pass": 1, "unknown": 1},
                    "subOwnerCounts": {"render-pass:contextScenario": 1, "unknown": 1},
                    "tasks": [
                        {
                            "category": "render-pass",
                            "subOwner": "render-pass:contextScenario",
                            "subOwnerEvidence": {"matchReason": "dominant-render-pass-overlap"},
                            "subOwnerConfidence": "high",
                            "durationMs": render_duration,
                            "evidence": ["contextScenario=900ms"],
                            "confidence": "high",
                        },
                        {
                            "category": "unknown",
                            "subOwner": "unknown",
                            "subOwnerEvidence": {"matchReason": "no-subowner-match"},
                            "subOwnerConfidence": "low",
                            "durationMs": unknown_duration,
                            "evidence": ["no-pass-or-browser-attribution"],
                            "confidence": "low",
                        },
                    ],
                },
            }

        suite = {
            "scenarioId": "tno_1962",
            "scenarioApply": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
            },
            "repeatedZoomRegions": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
                "interactionProbeSchema": "mc_repeated_zoom_regions_v1",
                "regions": {
                    "europe": {
                        "cycles": [cycle_with_unknown(1000, 800)],
                        "degradation": {"ratio": 1.0},
                        "maxLongTaskMs": 1000,
                    },
                    "east_asia": {
                        "cycles": [cycle_with_unknown(1100, 850)],
                        "degradation": {"ratio": 1.0},
                        "maxLongTaskMs": 1100,
                    },
                },
            },
        }

        metric = benchmark.build_suite_benchmark_metrics(suite)["repeatedZoomRegions"]
        attribution = metric["details"]["longTask"]["attribution"]

        self.assertFalse(attribution["gate"]["passed"])
        self.assertEqual(attribution["gate"]["unknownLongTaskCount"], 2)
        self.assertEqual(attribution["gate"]["unknownSubOwnerCount"], 2)
        self.assertTrue(metric["details"]["regions"]["europe"]["longTaskAttribution"]["gate"]["passed"])
        self.assertTrue(metric["details"]["regions"]["east_asia"]["longTaskAttribution"]["gate"]["passed"])

    def test_repeated_zoom_regions_metric_requires_active_scenario_match(self):
        benchmark = load_editor_benchmark_module()
        suite = {
            "scenarioId": "tno_1962",
            "scenarioApply": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "hoi4_1939",
            },
            "repeatedZoomRegions": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "hoi4_1939",
                "interactionProbeSchema": "mc_repeated_zoom_regions_v1",
                "passAttributionSchema": "mc_pass_attribution_v1",
                "cyclesPerRegion": 1,
                "wheelsPerCycle": 1,
                "regions": {
                    "europe": {
                        "cycles": [{"firstIdleAfterLastWheelMs": 100}],
                        "degradation": {"ratio": 1.0},
                    }
                },
            },
        }

        metric = benchmark.build_suite_benchmark_metrics(suite)["repeatedZoomRegions"]
        self.assertTrue(metric["present"])
        self.assertFalse(metric["details"]["sameScenario"])

        del suite["repeatedZoomRegions"]["activeScenarioId"]
        missing_active_metric = benchmark.build_suite_benchmark_metrics(suite)["repeatedZoomRegions"]
        self.assertFalse(missing_active_metric["details"]["sameScenario"])

    def test_fill_action_metrics_carry_black_pixel_ratio(self):
        benchmark = load_editor_benchmark_module()
        suite = {
            "scenarioId": "tno_1962",
            "scenarioApply": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
            },
            "singleFill": {
                "lastActionDurationMs": 11,
                "lastAction": "single-fill",
                "blackPixelRatio": 0.12,
            },
            "doubleClickFill": {
                "lastActionDurationMs": 22,
                "lastAction": "double-click-fill",
                "blackPixelRatio": 0.34,
            },
        }
        metrics = benchmark.build_suite_benchmark_metrics(suite)["firstInteraction"]
        self.assertEqual(metrics["singleFillAction"]["details"]["blackPixelRatio"], 0.12)
        self.assertEqual(metrics["doubleClickFillAction"]["details"]["blackPixelRatio"], 0.34)
        self.assertTrue(metrics["singleFillAction"]["details"]["validity"]["valid"])
        self.assertTrue(metrics["doubleClickFillAction"]["details"]["validity"]["valid"])

    def test_fill_action_metric_is_invalid_without_last_action(self):
        benchmark = load_editor_benchmark_module()
        suite = {
            "scenarioId": "tno_1962",
            "scenarioApply": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
            },
            "singleFill": {
                "lastActionDurationMs": 11,
                "blackPixelRatio": 0.12,
            },
        }

        metric = benchmark.build_suite_benchmark_metrics(suite)["firstInteraction"]["singleFillAction"]
        self.assertFalse(metric["present"])
        self.assertIsNone(metric["durationMs"])
        self.assertEqual(metric["details"]["validity"]["reason"], "missing-last-action")

    def test_editor_metric_validity_report_groups_interaction_validity(self):
        benchmark = load_editor_benchmark_module()
        suites = {
            "tno_1962": {
                "benchmarkMetrics": {
                    "firstInteraction": {
                        "singleFillAction": {
                            "details": {"validity": {"valid": False, "reason": "missing-last-action"}}
                        },
                        "doubleClickFillAction": {
                            "details": {"validity": {"valid": True, "reason": "recorded-action"}}
                        },
                    }
                }
            }
        }

        validity = benchmark.build_metric_validity_by_scenario(suites)
        self.assertFalse(validity["tno_1962"]["firstInteraction"]["singleFillAction"]["valid"])
        self.assertEqual(
            validity["tno_1962"]["firstInteraction"]["singleFillAction"]["reason"],
            "missing-last-action",
        )

    def test_wheel_anchor_metric_prefers_last_wheel_clock_and_keeps_legacy_fallback(self):
        benchmark = load_editor_benchmark_module()
        suite = {
            "scenarioId": "tno_1962",
            "scenarioApply": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
            },
            "wheelAnchorTrace": {
                "requestedScenarioId": "tno_1962",
                "firstIdleAfterWheelMs": 900,
                "firstIdleAfterLastWheelMs": 123,
                "maxBlackPixelRatio": 0.1,
            },
        }

        metric = benchmark.build_suite_benchmark_metrics(suite)["wheelAnchorTrace"]
        self.assertEqual(metric["durationMs"], 123)
        self.assertEqual(metric["details"]["firstIdleAfterWheelMs"], 900)
        self.assertEqual(metric["details"]["firstIdleAfterLastWheelMs"], 123)
        self.assertEqual(metric["details"]["maxBlackPixelRatio"], 0.1)
        self.assertTrue(metric["details"]["sameScenario"])

        del suite["wheelAnchorTrace"]["firstIdleAfterLastWheelMs"]
        fallback_metric = benchmark.build_suite_benchmark_metrics(suite)["wheelAnchorTrace"]
        self.assertEqual(fallback_metric["durationMs"], 900)
        self.assertIsNone(fallback_metric["details"]["firstIdleAfterLastWheelMs"])

    def test_zoom_end_chunk_visible_metric_preserves_end_to_visible_duration(self):
        benchmark = load_editor_benchmark_module()
        suite = {
            "scenarioId": "tno_1962",
            "scenarioApply": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
            },
            "zoomEndChunkVisible": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
                "renderMetrics": {
                    "scenarioChunkPromotionVisualStage": {
                        "durationMs": 12,
                        "recordedAt": 300,
                        "activeScenarioId": "tno_1962",
                        "reason": "zoom-end",
                    },
                    "zoomEndToChunkVisibleMs": {
                        "durationMs": 850,
                        "recordedAt": 200,
                        "scenarioId": "tno_1962",
                    },
                },
                "runtimeChunkLoadState": {
                    "lastZoomEndToChunkVisibleMetric": {
                        "durationMs": 910,
                        "recordedAt": 190,
                        "scenarioId": "tno_1962",
                    },
                },
                "metricBaselines": {
                    "scenarioChunkPromotionVisualStageRecordedAt": 0,
                    "zoomEndToChunkVisibleRecordedAt": 0,
                    "lastZoomEndToChunkVisibleRecordedAt": 0,
                },
            },
        }

        metric = benchmark.build_suite_benchmark_metrics(suite)["zoomEndToChunkVisible"]
        self.assertEqual(metric["durationMs"], 850)
        self.assertEqual(metric["source"], "zoomEndChunkVisible.renderMetrics.zoomEndToChunkVisibleMs")
        self.assertEqual(metric["details"]["selectedVia"], "fresh-same-scenario")
        self.assertIn(
            "zoomEndChunkVisible.renderMetrics.scenarioChunkPromotionVisualStage",
            metric["details"]["candidateSources"],
        )

        del suite["zoomEndChunkVisible"]["renderMetrics"]["zoomEndToChunkVisibleMs"]
        runtime_metric = benchmark.build_suite_benchmark_metrics(suite)["zoomEndToChunkVisible"]
        self.assertEqual(runtime_metric["durationMs"], 910)
        self.assertEqual(
            runtime_metric["source"],
            "zoomEndChunkVisible.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric",
        )

        del suite["zoomEndChunkVisible"]["runtimeChunkLoadState"]["lastZoomEndToChunkVisibleMetric"]
        visual_fallback_metric = benchmark.build_suite_benchmark_metrics(suite)["zoomEndToChunkVisible"]
        self.assertEqual(visual_fallback_metric["durationMs"], 12)
        self.assertEqual(visual_fallback_metric["source"], "zoomEndChunkVisible.renderMetrics.scenarioChunkPromotionVisualStage")
        self.assertEqual(visual_fallback_metric["details"]["selectedVia"], "visual-stage-fallback")

class SettleExactMetricOwnershipTest(unittest.TestCase):
    def test_settle_exact_metric_ignores_legacy_fast_exact_and_keeps_skip_probe(self):
        benchmark = load_editor_benchmark_module()
        suite = {
            "scenarioId": "tno_1962",
            "scenarioApply": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
            },
            "zoomSettleFullRedraw": {
                "requestedScenarioId": "tno_1962",
                "activeScenarioId": "tno_1962",
                "metricBaselines": {
                    "settleExactRefreshRecordedAt": 100,
                    "settlePoliticalFastExactRecordedAt": 100,
                    "settlePoliticalFastExactSkippedRecordedAt": 100,
                },
                "renderMetrics": {
                    "settleExactRefresh": {
                        "durationMs": 320,
                        "recordedAt": 200,
                        "activeScenarioId": "tno_1962",
                    },
                    "settlePoliticalFastExact": {
                        "durationMs": 12,
                        "recordedAt": 300,
                        "activeScenarioId": "tno_1962",
                    },
                    "settlePoliticalFastExactSkipped": {
                        "durationMs": 0,
                        "recordedAt": 250,
                        "activeScenarioId": "tno_1962",
                        "reason": "defer-to-sliced-exact-refresh",
                    },
                },
            },
        }
        metric = benchmark.build_suite_benchmark_metrics(suite)["fullySettled"]["settleExactRefresh"]
        self.assertEqual(metric["durationMs"], 320)
        self.assertEqual(metric["source"], "zoomSettleFullRedraw.renderMetrics.settleExactRefresh")
        self.assertNotIn("settlePoliticalFastExact", metric["details"].get("candidateSources", []))


if __name__ == "__main__":
    unittest.main()
