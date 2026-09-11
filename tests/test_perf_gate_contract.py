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
    def classify(self, files, *, event="pull_request", base=None, head=None, diff_failure=False):
        workflow = WORKFLOW_FILE.read_text(encoding="utf-8")
        script = textwrap.dedent(workflow.split("        run: |\n", 1)[1].split("\n      - name:", 1)[0])
        runtime = REPO_ROOT / ".runtime" / "tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="perf-classifier-", dir=runtime) as directory:
            root = Path(directory)
            fixture = {
                "files": files, "diffFailure": diff_failure,
                "base": json.dumps(base or {"scripts": {"test:isolated": "node test.mjs"}}),
                "head": head if isinstance(head, str) else json.dumps(head or base or {"scripts": {"test:isolated": "node test.mjs"}}),
            }
            (root / "fixture.json").write_text(json.dumps(fixture), encoding="utf-8")
            (root / "event.json").write_text(json.dumps({"pull_request": {"base": {"sha": "base"}, "head": {"sha": "head"}}}), encoding="utf-8")
            stub = r'''
$ErrorActionPreference = 'Stop'
$fixture = Get-Content -Raw fixture.json | ConvertFrom-Json
function git {
  $global:LASTEXITCODE = 0
  switch ($args[0]) {
    'rev-parse' { if ($args[1] -eq 'HEAD^') { 'parent' } else { 'candidate' } }
    'cat-file' { }
    'show' { if ($args[1] -eq 'base:package.json') { $fixture.base } else { $fixture.head } }
    'diff' { if ($fixture.diffFailure) { $global:LASTEXITCODE = 1 } else { $fixture.files } }
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
            return json.loads((root / ".runtime/reports/generated/perf-pr-gate-classifier.json").read_text(encoding="utf-8-sig"))

    def test_scheduled_and_manual_runs_force_measurement_with_parent_baseline(self):
        workflow = WORKFLOW_FILE.read_text(encoding="utf-8")
        self.assertIn("  schedule:", workflow)
        self.assertIn("  workflow_dispatch:", workflow)
        self.assertNotIn("  push:", workflow)
        for event in ("schedule", "workflow_dispatch"):
            with self.subTest(event=event):
                audit = self.classify([], event=event)
                self.assertTrue(audit["should_run_perf"])
                self.assertTrue(audit["should_enforce_regressions"])
                self.assertEqual(audit["base_sha"], "parent")

    def test_path_classification_preserves_runtime_and_baseline_coverage(self):
        for path, runs, enforces in (
            ("docs/perf/notes.md", False, False),
            ("docs/perf/baseline.json", True, False),
            ("js/any_module.js", True, True),
            ("package-lock.json", True, False),
        ):
            with self.subTest(path=path):
                audit = self.classify([path])
                self.assertEqual(audit["should_run_perf"], runs)
                self.assertEqual(audit["should_enforce_regressions"], enforces)

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

    def test_diff_failure_does_not_become_successful_skip(self):
        self.classify([], diff_failure=True)


class PerfGateContractTest(unittest.TestCase):
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

    def test_workflow_matches_checked_in_baseline_environment(self):
        workflow_content = WORKFLOW_FILE.read_text(encoding="utf-8")
        baseline_payload = json.loads(BASELINE_JSON.read_text(encoding="utf-8"))
        baseline_os = str(baseline_payload["environment"]["os"])
        baseline_node = str(baseline_payload["environment"]["node"])
        self.assertTrue(baseline_os.startswith("win32 "), baseline_os)
        self.assertTrue(baseline_node.startswith("v22."), baseline_node)
        self.assertIn("runs-on: windows-latest", workflow_content)
        self.assertRegex(workflow_content, r'node-version:\s*[\"\']22[\"\']')
        self.assertRegex(workflow_content, r'python-version:\s*[\"\']3\.12[\"\']')
        self.assertIn("cache: 'pip'", workflow_content)
        self.assertIn("python -m pip install -r requirements-dev.lock.txt", workflow_content)
        self.assertIn("npx playwright install chromium", workflow_content)
        self.assertIn("npm run perf:gate", workflow_content)
        self.assertIn(
            '"should_enforce_regressions=$($shouldEnforceRegressions.ToString().ToLowerInvariant())"',
            workflow_content,
        )
        rule_block = workflow_content[
            workflow_content.index("$rules = @("):
            workflow_content.index("$ruleHits = @()")
        ]
        policy_pairs = dict(
            re.findall(
                r"name = '([^']+)'[\s\S]*?regression_policy = '(enforce|diagnostic)'[\s\S]*?patterns = @\(",
                rule_block,
            )
        )
        for enforced_rule in (
            "runtime-js",
            "app-shell",
        ):
            self.assertEqual(policy_pairs.get(enforced_rule), "enforce")
        for diagnostic_rule in (
            "perf-workflow",
            "perf-baseline-docs",
            "scenario-registry",
            "perf-scenario-data",
            "playwright-app-support",
            "perf-tools",
            "dev-server",
            "node-manifests",
        ):
            self.assertEqual(policy_pairs.get(diagnostic_rule), "diagnostic")
        self.assertEqual(len(policy_pairs), 10)
        self.assertIn("regression_policy = $rule.regression_policy", workflow_content)
        self.assertIn(
            "Where-Object { $_.regression_policy -eq 'enforce' }",
            workflow_content,
        )
        self.assertIn(
            "$regressionMode = if ('${{ steps.classify.outputs.should_enforce_regressions }}' -eq 'true')",
            workflow_content,
        )
        self.assertIn("--regression-mode $regressionMode", workflow_content)
        self.assertLess(
            workflow_content.index("python -m pip install -r requirements-dev.lock.txt"),
            workflow_content.index("      - name: Run perf gate"),
        )

    def test_workflow_generates_base_baseline_on_the_same_runner(self):
        workflow_content = WORKFLOW_FILE.read_text(encoding="utf-8")
        self.assertIn('"base_sha=$baseSha"', workflow_content)
        self.assertIn('"diff_head_sha=$diffHeadSha"', workflow_content)
        self.assertIn('"candidate_sha=$candidateSha"', workflow_content)
        self.assertIn("$candidateSha = (git rev-parse HEAD).Trim()", workflow_content)
        self.assertIn(
            '$diffRange = if ($baseSha) { "$baseSha...$diffHeadSha" } else { $diffHeadSha }',
            workflow_content,
        )
        self.assertIn("Generate same-runner base baseline", workflow_content)
        self.assertIn("git worktree add --detach", workflow_content)
        self.assertIn("perf-pr-gate-base.json", workflow_content)
        self.assertIn("--mode baseline", workflow_content)
        self.assertIn("--scenarios tno_1962,hoi4_1939", workflow_content)
        self.assertIn("--runs 5", workflow_content)
        self.assertNotIn("--scenarios blank_base", workflow_content)
        self.assertIn("--baseline-json", workflow_content)
        same_runner_step = workflow_content[
            workflow_content.index("      - name: Generate same-runner base baseline"):
            workflow_content.index("      - name: Run perf gate")
        ]
        self.assertIn(
            "$candidateSha = '${{ steps.classify.outputs.candidate_sha }}'",
            same_runner_step,
        )
        self.assertIn("$governedHeadInputs = @(", same_runner_step)
        for governed_input in (
            "package.json",
            "package-lock.json",
            "data/scenarios/index.json",
            "data/scenarios/tno_1962",
            "data/scenarios/hoi4_1939",
            "tools/dev_server.py",
        ):
            self.assertIn(f"'{governed_input}'", same_runner_step)
        self.assertNotIn("'tools/perf'", same_runner_step)
        self.assertIn(
            "$candidateHarness = Join-Path $env:GITHUB_WORKSPACE 'tools/perf/run_baseline.mjs'",
            same_runner_step,
        )
        self.assertIn(
            "node $candidateHarness --measured-repo-root $baseWorktree --mode baseline",
            same_runner_step,
        )
        self.assertIn(
            "git -C $baseWorktree restore --source=$candidateSha --staged --worktree -- $governedHeadInputs",
            same_runner_step,
        )
        self.assertIn("$projectedChangedFiles = @(", same_runner_step)
        self.assertIn("$unexpectedProjectedFiles = @(", same_runner_step)
        self.assertIn("commit --no-verify --no-gpg-sign", same_runner_step)
        self.assertIn("projected_base_sha = $projectedBaseSha", same_runner_step)
        self.assertIn("perf-pr-gate-base-projection.json", same_runner_step)
        self.assertIn(
            "git -C $baseWorktree diff --quiet $candidateSha -- $governedHeadInputs",
            same_runner_step,
        )
        self.assertIn("git -C $baseWorktree status --porcelain", same_runner_step)
        self.assertNotIn("restore --source=$diffHeadSha", same_runner_step)
        self.assertIn("$baseEvidenceDir", same_runner_step)
        self.assertIn("perf-baseline-dev-server.out.log", same_runner_step)
        self.assertIn("perf-baseline-dev-server.err.log", same_runner_step)
        self.assertIn("tests/playwright/perf-baseline", same_runner_step)
        self.assertLess(
            same_runner_step.index("$baseEvidenceDir"),
            same_runner_step.index("git worktree remove --force"),
        )
        self.assertLess(
            same_runner_step.index("git -C $baseWorktree restore"),
            same_runner_step.index("npm ci"),
        )
        self.assertLess(
            same_runner_step.index("commit --no-verify --no-gpg-sign"),
            same_runner_step.index("npm ci"),
        )
        self.assertLess(
            same_runner_step.index("git -C $baseWorktree status --porcelain"),
            same_runner_step.index("npm ci"),
        )

    def test_workflow_persists_perf_evidence_for_diagnostic_successes(self):
        workflow_content = WORKFLOW_FILE.read_text(encoding="utf-8")
        self.assertIn("- name: Upload perf evidence", workflow_content)
        self.assertIn(
            "if: always() && steps.classify.outputs.should_run_perf == 'true'",
            workflow_content,
        )
        self.assertIn("name: perf-pr-gate-evidence", workflow_content)
        self.assertIn(".runtime/output/perf/**", workflow_content)
        self.assertNotIn("Upload perf failure artifacts", workflow_content)
        self.assertLess(
            workflow_content.index("Generate same-runner base baseline"),
            workflow_content.index("      - name: Run perf gate"),
        )

    def test_workflow_retries_only_typed_environment_admission_rejections(self):
        workflow_content = WORKFLOW_FILE.read_text(encoding="utf-8")
        base_step = workflow_content[
            workflow_content.index("      - name: Generate same-runner base baseline"):
            workflow_content.index("      - name: Run perf gate")
        ]
        gate_step = workflow_content[
            workflow_content.index("      - name: Run perf gate"):
            workflow_content.index("      - name: Upload perf evidence")
        ]

        for step in (base_step, gate_step):
            self.assertIn("$maxAdmissionAttempts = 3", step)
            self.assertIn("$perfExitCode -ne 3", step)
            self.assertIn("Start-Sleep -Seconds 20", step)
            self.assertIn("$attempt -eq $maxAdmissionAttempts", step)

        self.assertNotIn("cpuPeakMaxPercent", workflow_content)
        self.assertNotIn("topProcessSingleCoreMaxPercent", workflow_content)

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

    def test_perf_script_locks_hardening_contract(self):
        script = PERF_SCRIPT.read_text(encoding="utf-8")
        self.assertIn('benchmarkMetricsSchemaVersion: "3.3"', script)
        self.assertIn('probeSchema: "mc_perf_snapshot"', script)
        self.assertIn('`- Architecture: ${report.environment.arch}`', script)
        self.assertIn('`- CPU: ${report.environment.cpuModel} (${report.environment.cpuCount} logical processors)`', script)
        self.assertIn('`- Memory class: ${report.environment.memoryGiB} GiB`', script)
        self.assertIn('`- Runner: ${JSON.stringify(report.environment.runnerIdentity)}`', script)
        self.assertIn('const PERF_REPORT_CONTRACT_FIELDS = [', script)
        self.assertIn(
            "collectBaselineContractMismatches(report, baselineReportForGate)",
            script,
        )
        self.assertIn('getPerfReportContractMismatches(baselineReport, "baseline", "baseline")', script)
        self.assertIn('getPerfReportContractMismatches(currentReport, "current", "gate")', script)
        self.assertIn("sha256JsonArtifact(report?.[artifactKey])", script)
        self.assertIn("sha256JsonArtifact(rawPayload)", script)
        self.assertIn("const CURRENT_PERF_REPORT_SCHEMA_VERSION = 3;", script)
        self.assertNotIn("const LEGACY_PERF_REPORT_SCHEMA_VERSION", script)
        self.assertIn('from "./render_sample_role_policy.mjs";', script)
        self.assertIn("canonicalRenderSampleMs", script)
        self.assertIn("renderSampleRoleSummary", script)
        self.assertIn("collectGovernedRenderSampleRoleMismatches", script)
        self.assertIn("Perf gate render sample role mismatch.", script)
        self.assertIn("renderSampleRoleMismatches", script)
        self.assertIn("normalizePerfRegressionMode", script)
        self.assertIn("shouldBlockOnPerfRegressions", script)
        self.assertIn("regressionsEnforced", script)
        self.assertIn("runWithTransientPerfNetworkRetry", script)
        self.assertIn("getTransientNetworkFailure", script)
        self.assertIn("net::ERR_NETWORK_CHANGED", script)
        self.assertIn("net::ERR_CONNECTION_FAILED", script)
        self.assertIn("getTransientNetworkFailure: diagnostics.getTransientNetworkFailure", script)
        self.assertIn('const DEFAULT_GATE_SCENARIOS = ["tno_1962", "hoi4_1939"];', script)
        self.assertIn("const MIN_GATE_WARMUPS = 3;", script)
        self.assertIn("const DEFAULT_WARMUPS = MIN_GATE_WARMUPS;", script)
        self.assertIn('throw new Error(`[perf-baseline] Gate warmups must be at least ${MIN_GATE_WARMUPS}; received ${options.warmups}.`);', script)
        self.assertIn("warmups mismatch: baseline=", script)
        self.assertIn("runs mismatch: baseline=", script)
        self.assertIn("browser version mismatch: baseline=", script)
        self.assertIn("package lock mismatch: baseline=", script)
        self.assertIn("manifestSha256 mismatch", script)
        self.assertIn("featureCount mismatch", script)
        self.assertIn('if (activeScenarioId !== normalizeScenarioId(scenarioId)) {', script)
        self.assertIn('{ key: "scenarioAppliedMs", label: "scenarioAppliedMs" }', script)
        self.assertIn('{ key: "applyScenarioBundleMs", label: "applyScenarioBundleMs" }', script)
        self.assertIn('{ key: "refreshScenarioApplyMs", label: "refreshScenarioApplyMs" }', script)
        self.assertIn('{ key: "renderSampleMedianMs", label: "renderSampleMedianMs", threshold: 1.25 }', script)
        self.assertIn("function summarizeSampleSpread", script)
        self.assertIn("function buildReportWorkloadIdentity", script)
        self.assertIn("sampleSpread: buildAggregateSampleSpread(runs)", script)
        self.assertIn("workloadIdentity: buildScenarioWorkloadIdentity", script)
        self.assertIn("workloadIdentity: buildReportWorkloadIdentity(options, measurement)", script)
        self.assertIn("function activeServerMetadataMatchesRepo(metadata, { expectedPid = null } = {})", script)
        self.assertIn("function resolveDevServerPythonCommand()", script)
        self.assertIn('import { spawn, spawnSync } from "node:child_process";', script)
        self.assertIn("process.env.pythonLocation || process.env.Python_ROOT_DIR || process.env.Python3_ROOT_DIR", script)
        self.assertIn('path.join(setupPythonRoot, process.platform === "win32" ? "python.exe" : "bin/python")', script)
        self.assertIn('const pythonExecutable = resolveWindowsPythonExecutable();', script)
        self.assertIn('return { command: pythonExecutable, args: ["tools/dev_server.py"] };', script)
        self.assertIn('return { command: "python3", args: ["tools/dev_server.py"] };', script)
        self.assertIn(
            'const pythonProbe = spawnSync("py", ["-3", "-c", "import sys; print(sys.executable)"], {\n'
            "    cwd: REPO_ROOT,\n"
            '    encoding: "utf8",\n'
            "    windowsHide: true,\n"
            "  });",
            script,
        )
        self.assertIn("pythonProbe.error", script)
        self.assertIn("pythonProbe.status === null", script)
        self.assertIn("pythonProbe.status !== 0", script)
        self.assertIn("!pythonExecutable", script)
        self.assertIn("truncateStderr(pythonProbe.stderr)", script)
        self.assertNotIn('return { command: "py", args: ["-3", "tools/dev_server.py"] };', script)
        self.assertIn("expectedPid = null", script)
        self.assertIn("const metadataPid = Number(metadata?.pid);", script)
        self.assertIn("isProcessIdRunning(metadataPid)", script)
        self.assertIn("Number.isInteger(expectedNumericPid)", script)
        self.assertIn("metadataPid === expectedNumericPid", script)
        self.assertIn("normalizeMetadataPath(metadataCwd) === normalizeMetadataPath(REPO_ROOT)", script)
        self.assertIn('MAPCREATOR_RUNTIME_ROOT: PERF_SERVER_RUNTIME_ROOT', script)
        self.assertIn("function shouldReuseActiveServer()", script)
        self.assertIn("process.env.PERF_REUSE_ACTIVE_SERVER", script)
        self.assertIn("resolveExistingServerBaseUrl(PERF_SERVER_ACTIVE_SERVER_PATH, {", script)
        self.assertIn("expectedPid: serverOwner.child.pid", script)
        self.assertIn("if (!activeServerMetadataMatchesRepo(metadata, options))", script)
        self.assertIn("async function ensureMeasurementServer(serverLease)", script)
        self.assertIn("serverLeaseRef.current = await ensureMeasurementServer(serverLeaseRef.current)", script)
        self.assertIn("async function readPerfRuntimeState(page)", script)
        self.assertIn('globalThis.__mapcreator__?.snapshot', script)
        self.assertNotIn('new URL("./js/core/state.js"', script)
        self.assertIn('path.join(REPO_ROOT, ".runtime", "tests", "playwright", "perf-baseline")', script)
        self.assertIn("function createPerfBrowserDiagnostics(page,", script)
        self.assertIn('page.on("console"', script)
        self.assertIn('page.on("pageerror"', script)
        self.assertIn('page.on("requestfailed"', script)
        self.assertIn('kind: "http-error"', script)
        self.assertIn("[perf-baseline] Browser diagnostics:", script)
        self.assertIn("runLabel: `warmup-${String(index + 1).padStart(2, \"0\")}`", script)
        self.assertIn("runLabel: `run-${String(index + 1).padStart(2, \"0\")}`", script)
        self.assertIn("manifestSha256", script)
        self.assertIn("function validateGateCurrentReport(currentReport, scenarioIds", script)
        self.assertIn("Current report has invalid gate metrics for scenarios", script)
        self.assertIn('validateGateCurrentReport(report, options.scenarios, "current report")', script)
        for field_name in (
            "scenarioFullHydrateMs",
            "interactionInfraMs",
            "scenarioChunkPromotionInfraStageMs",
            "scenarioChunkPromotionVisualStageMs",
            "zoomEndToChunkVisibleMs",
            "interactionRecoveryWindowMs",
            "interactionRecoveryTaskMs",
            "visibleFrameTransactionMs",
            "visibleFrameTransactionCount",
            "visibleFrameRejectedCount",
            "visibleFrameMissingCount",
            "continuityFrameStaleAgeMs",
            "missingVisibleFrameCount",
            "fillPatchInputToFirstPixelMs",
            "postReadyMaxPendingAgeMs",
            "postReadyMaxRetryCount",
            "startupBundleSource",
            "startupShellApplyReadyMs",
            "loadScenarioBundleMs",
            "drawContextScenarioPassMs",
            "setMapDataFirstPaintMs",
            "buildHitCanvasMs",
            "settleExactRefreshMs",
            "settleExactRefreshApplyMs",
            "settleExactRefreshPassesMs",
            "settleExactRefreshWaitForPaintMs",
            "settleExactRefreshFinalizeMs",
            "settleExactRefreshPhaseBreakdownMs",
        ):
            self.assertIn(field_name, script)
        self.assertIn('bootMetrics["scenario-apply"]?.source', script)
        self.assertIn("workerDecodeMs", script)
        self.assertIn("workerMetaBuildMs", script)
        self.assertIn("Perf gate baseline contract mismatch.", script)

    def test_standard_perf_admission_precedes_browser_measurement_and_stays_independent_from_williams(self):
        runner = PERF_SCRIPT.read_text(encoding="utf-8")
        admission = STANDARD_PERF_ADMISSION.read_text(encoding="utf-8")

        self.assertIn('from "./standard_perf_admission.mjs";', runner)
        self.assertIn('path.join(options.rawDir, "perf-admission.json")', runner)
        self.assertLess(
            runner.index('const baselineOracle = await readJsonAndSha256Strict(options.baselineJson, "baseline report");'),
            runner.index("validateGateBaselineReport(baselineReportForGate, options.scenarios, options.baselineJson, options.renderSampleRunProfileId);"),
        )
        self.assertLess(
            runner.index("validateGateBaselineReport(baselineReportForGate, options.scenarios, options.baselineJson, options.renderSampleRunProfileId);"),
            runner.index("const environmentAdmission = await runStandardPerfAdmission(options);"),
        )
        self.assertIn("baselineReportForGate = baselineOracle.payload;", runner)
        self.assertIn("baselineOracleBeforeSha256 = baselineOracle.sha256;", runner)
        self.assertLess(
            runner.index("const environmentAdmission = await runStandardPerfAdmission(options);"),
            runner.index("const measurement = await runMeasurements(options);"),
        )
        self.assertLess(
            runner.index("const measurement = await runMeasurements(options);"),
            runner.index("const generationFence = await runStandardPerfGenerationFence("),
        )
        self.assertIn("environmentAdmission,", runner)
        self.assertIn("generationFence,", runner)
        self.assertIn("PerfEnvironmentAdmissionError", runner)
        self.assertIn("PerfGenerationFenceError", runner)
        self.assertIn("Number.isInteger(error?.exitCode)", runner)
        self.assertIn("STANDARD_PERF_ADMISSION_EXIT_CODES.gateFailure", runner)

        self.assertIn('policyId: "standard-perf-admission-v1"', admission)
        self.assertIn("sampleCount: 7", admission)
        self.assertIn("cpuAverageMaxPercent: 20", admission)
        self.assertIn("cpuPeakMaxPercent: 35", admission)
        self.assertIn("topProcessSingleCoreMaxPercent: 25", admission)
        self.assertIn('runtimePrefixes: Object.freeze(["js/", "css/", "vendor/", "data/"])', admission)
        self.assertIn('harnessPrefixes: Object.freeze(["tools/perf/", "tests/e2e/support/", "docs/perf/baseline_"])', admission)
        self.assertIn('spawnSyncFn("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"]', admission)
        self.assertIn('this.exitCode = STANDARD_PERF_ADMISSION_EXIT_CODES.admissionRejected;', admission)
        self.assertIn('STANDARD_PERF_GENERATION_FENCE_POLICY_ID = "standard-perf-generation-fence-v1"', admission)
        self.assertIn('failure("git-head-changed"', admission)
        self.assertIn('failure("baseline-oracle-changed"', admission)
        self.assertNotIn("williams_crossover", admission)

    def test_render_sample_role_policy_and_governed_analyzer_are_explicit_contracts(self):
        policy = RENDER_SAMPLE_ROLE_POLICY.read_text(encoding="utf-8")
        analyzer = RENDER_SAMPLE_ROLE_ANALYZER.read_text(encoding="utf-8")
        package_payload = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))

        self.assertIn('RENDER_SAMPLE_ROLE_POLICY_ID = "render-sample-role-v2"', policy)
        self.assertIn('CANONICAL_RENDER_SAMPLE_ROLE_ID = "last-post-promotion-idle-scenario-frame-v1"', policy)
        self.assertIn('GOVERNED_RENDER_SAMPLE_SCENARIOS = Object.freeze(["tno_1962", "hoi4_1939"])', policy)
        for contract_token in (
            '"declared-sample-count"',
            '"sample-array-count"',
            '"sample-sequence"',
            '"canonical-candidate-unique"',
            '"canonical-candidate-is-last"',
            '"all-pre-canonical-samples-before-promotion"',
            '"last-active-scenario"',
            '"last-phase-idle"',
            '"last-political-bg-progressive"',
            '"last-context-scenario-positive"',
            '"last-recorded-after-promotion"',
        ):
            self.assertIn(contract_token, policy)
        self.assertIn("buildGovernedCompanionReport", analyzer)
        self.assertIn("accepted-with-governed-reanalysis", analyzer)
        self.assertIn("blocked-rerun-required", analyzer)
        self.assertIn("DEFAULT_EXPECTED_SOURCE_SHA256", analyzer)
        self.assertIn("rawFileCount", analyzer)
        self.assertIn("roleMatches", analyzer)
        self.assertIn("legacyDecision", analyzer)
        self.assertIn("pathToFileURL", analyzer)
        self.assertEqual(
            package_payload["scripts"].get("test:node:render-sample-role-policy"),
            "node --test tests/render_sample_role_policy_behavior.test.mjs tests/perf_role_governed_report_behavior.test.mjs tests/standard_perf_settlement_role_behavior.test.mjs",
        )
        self.assertEqual(
            package_payload["scripts"].get("perf:analyze-render-sample-roles"),
            "node tools/perf/analyze_render_sample_roles.mjs",
        )

    def test_new_standard_profile_observes_initial_promotion_through_real_settlement(self):
        runner = PERF_SCRIPT.read_text(encoding="utf-8")
        policy = RENDER_SAMPLE_ROLE_POLICY.read_text(encoding="utf-8")
        self.assertIn('SETTLED_STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID = "standard-perf-5-run-v2"', policy)
        self.assertIn('SETTLED_RENDER_SAMPLE_ROLE_POLICY_ID = "render-sample-role-v3"', policy)
        self.assertIn('SETTLED_CANONICAL_RENDER_SAMPLE_ROLE_ID = "initial-scenario-frame-through-startup-settlement-v1"', policy)
        self.assertIn("renderSampleRunProfileId: SETTLED_STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID", runner)
        # The old profile remains the default for historical analysis, while
        # new CLI measurements explicitly opt into the versioned settled role.
        self.assertIn("runProfileId = STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID", policy)
        for token in (
            '"initial-promotion-bound"',
            '"initial-frame-anchor"',
            '"initial-sample-prefix-unchanged"',
            '"promotion-observation-history"',
            '"post-canonical-same-scenario-idle"',
            '"settlement-binds-samples"',
            '"settlement-after-last-frame"',
            "candidate.durationMs + subsequentRenderCpuMs",
        ):
            self.assertIn(token, policy)
        measurement = runner.split("async function measureOneRun(", 1)[1].split("async function waitForPerfSnapshotReady(", 1)[0]
        settled_branch, legacy_branch = measurement.split("} else {", 1)
        self.assertIn("waitForStandardPerfSettlement(", settled_branch)
        self.assertNotIn("waitForPerfSnapshotReady(", settled_branch)
        self.assertIn("waitForPerfSnapshotReady(", legacy_branch)
        self.assertIn("initialPromotion, initialFrameSequence, initialSamplePrefix, promotionObservations", runner)
        self.assertIn("inspectStandardPerfSettlement(settlement?.status, scenarioId)", runner)
        self.assertIn("same measurement contract", runner)
        self.assertIn("canonicalRenderSampleMs: renderSampleRole.canonicalRenderSampleMs", runner)
        self.assertIn('key: "canonicalRenderSampleMs", label: "scenario render CPU through settlement"', runner)
        self.assertIn('key: "renderSampleMedianMs", label: "renderSampleMedianMs", threshold: 1.25', runner)
        self.assertIn("threshold: 1.15", runner)

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

    def test_editor_benchmark_locks_identity_and_fill_black_pixel_contract(self):
        script = EDITOR_BENCHMARK_SCRIPT.read_text(encoding="utf-8")
        self.assertIn('"schemaVersion": 1', script)
        self.assertIn('"probeSchema": "mc_perf_snapshot"', script)
        self.assertIn('"interactionProbeSchema": "mc_repeated_zoom_regions_v1"', script)
        self.assertIn('"passAttributionSchema": "mc_pass_attribution_v1"', script)
        self.assertIn('"benchmarkMetricsSchemaVersion": "3.3"', script)
        self.assertIn('"servedRuntimeIdentity": build_served_runtime_identity', script)
        self.assertIn('"metricValidity": build_metric_validity_by_scenario', script)
        self.assertIn('"argv": sys.argv', script)
        self.assertIn('"processId": os.getpid()', script)
        self.assertIn("--repeated-zoom-regions", script)
        self.assertIn("--repeated-zoom-cycles", script)
        self.assertIn("--repeated-zoom-wheels-per-cycle", script)
        self.assertIn('"repeatedZoomRegions": repeated_zoom_regions_probe', script)
        self.assertIn('runtime_chunk_perf="1"', script)
        self.assertIn("sample_canvas_black_pixel_details_js", script)
        self.assertIn("usedJSHeapSize", script)
        self.assertIn("const memoryBefore = await page.evaluate(() => {{ return", script)
        self.assertIn("const memoryAfter = await page.evaluate(() => {{ return", script)
        self.assertIn("timeout_sec = max(300, (len(regions) * cycles * max(20, wheels_per_cycle * 2)) + 240)", script)
        self.assertIn("return run_code_json(js, timeout_sec=timeout_sec)", script)
        self.assertIn("clone_runtime_chunk_load_state_summary_js", script)
        self.assertIn("clone_repeated_zoom_render_metrics_summary_js", script)
        self.assertIn("clone_repeated_zoom_pass_attribution_js", script)
        self.assertIn("mc_black_pixel_attribution_v1", script)
        self.assertIn("blank-frame-candidate", script)
        self.assertIn("mergedLayerPayloadCacheLayerCount", script)
        self.assertIn("includeHeavyMetrics: false", script)
        self.assertIn("includeHeavyMetrics: true", script)
        self.assertIn("includeBlackPixels: false", script)
        self.assertIn("const includeBlackPixels = payload.includeBlackPixels !== false;", script)
        self.assertIn("blackPixelRatio: blackPixelSamples?.ratio ?? null", script)
        self.assertIn("payload.includeBlackPixels === false ? null", script)
        self.assertIn("const readIdleState = async () => page.evaluate", script)
        self.assertIn("const chunkState = state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === 'object'", script)
        self.assertIn("chunkState.promotionCommitInFlight", script)
        self.assertIn("chunkState.pendingPostCommitRefresh", script)
        self.assertIn("chunkActive: !!snapshot.chunkActive", script)
        self.assertIn("const postReadyActive = !!state.interactionInfrastructureBuildInFlight", script)
        self.assertIn("postReadyActive: !!snapshot.postReadyActive", script)
        self.assertIn("timedOut: !snapshot.settled", script)
        self.assertIn("firstIdleAfterLastWheelMs = idleState?.timedOut", script)
        self.assertIn("const attributionSampleContext = {{", script)
        self.assertIn("firstIdleAfterLastWheelMs,", script)
        self.assertIn("attributionSampleContext,", script)
        self.assertIn("result.finalReset = await waitForIdle(7000)", script)
        self.assertIn("activeScenarioId: await readActiveScenarioId()", script)
        self.assertIn("result.activeScenarioId = await readActiveScenarioId()", script)
        self.assertIn("attribution: Array.from(entry.attribution || [])", script)
        self.assertIn("mc_long_task_attribution_v1", script)
        self.assertIn("mc_long_task_attribution_gate_v1", script)
        self.assertIn("mc_long_task_subowner_v1", script)
        self.assertIn("LONG_TASK_ATTRIBUTION_ALLOWED_CATEGORIES", script)
        self.assertIn("subOwner", script)
        self.assertIn("subOwnerCounts", script)
        self.assertIn("unknownSubOwnerCount", script)
        self.assertIn("missingSubOwnerEvidenceCount", script)
        self.assertIn("topSubOwnerActionable", script)
        self.assertIn("shortArtifactPassed", script)
        self.assertIn("fullArtifactPassed", script)
        self.assertIn("category: 'render-pass'", script)
        self.assertIn("schedulerMetric=${{schedulerEntry.metricName}}", script)
        self.assertIn("scheduler-duration-overlap", script)
        self.assertIn("scheduler:deferred-exact-context-pass", script)
        self.assertIn("scheduler-label-observed", script)
        self.assertRegex(
            script,
            r"const schedulerEntry = metricEntry\([\s\S]*?schedulerDeferredExactLabel \? 'scheduler:deferred-exact-context-pass' : 'scheduler:queue-depth'[\s\S]*?schedulerDeferredExactLabel \? 'scheduler-label-observed' : 'scheduler-duration-overlap'[\s\S]*?\);[\s\S]*?schedulerEntry\.durationMs >= 350 \|\| schedulerEntry\.durationMs >= durationMs \* 0\.25",
        )
        self.assertIn("partial-render-pass-overlap", script)
        self.assertNotIn("if (schedulerDepth > 0) {{", script)
        self.assertIn("hasMeaningfulBrowserAttribution", script)
        self.assertNotIn("if (attribution.length) {{", script)
        self.assertIn("unknownLongTaskCount", script)
        self.assertIn("evidence: evidence.length ? [...evidence, 'no-pass-or-browser-attribution'] : ['no-pass-or-browser-attribution']", script)
        self.assertIn('"git", "rev-parse", "HEAD"', script)
        self.assertIn('SCENARIO_IDS = ["none", "hoi4_1939", "tno_1962"]', script)
        self.assertIn('"politicalRasterWorker": political_raster_worker', script)
        self.assertIn("def resolve_runtime_output_path", script)
        self.assertIn("resolved.relative_to(runtime_root)", script)
        self.assertIn("acceptedCount: Number(source.acceptedCount || 0)", script)
        self.assertIn("rejectedStaleCount: Number(source.rejectedStaleCount || 0)", script)
        self.assertIn("fallbackCount: Number(source.fallbackCount || 0)", script)
        self.assertIn('"missing-last-action"', script)
        self.assertIn("const sampleRegions = [", script)
        self.assertIn("sampleContext.drawImage(canvas, sourceX, sourceY", script)
        self.assertIn("const sampleEpochMs = (sampleContext = null) =>", script)
        self.assertIn("return timeOrigin && sampledAt ? timeOrigin + sampledAt : sampledAt;", script)
        self.assertNotIn("metricRecordedAt: sampleContext?.sampledAt || 0", script)
        self.assertNotIn("metricRecordedAt: Math.max(0, Number(sampleContext?.sampledAt || 0))", script)

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
        script = EDITOR_BENCHMARK_SCRIPT.read_text(encoding="utf-8")
        self.assertIn("settlePoliticalFastExactSkipped", script)
        self.assertNotIn('"zoomSettleFullRedraw.renderMetrics.settlePoliticalFastExact"', script)


if __name__ == "__main__":
    unittest.main()
