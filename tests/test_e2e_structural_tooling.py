from __future__ import annotations

import itertools
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
TMP_BASE = REPO_ROOT / ".runtime" / "tmp" / "test_e2e_structural_tooling"


def run_command(*command: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(command),
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
        env=None if env is None else {**os.environ, **env},
    )


def parse_workflow_job_blocks(workflow: str) -> dict[str, str]:
    lines = workflow.splitlines()
    jobs_headers = [index for index, line in enumerate(lines) if line == "jobs:"]
    if len(jobs_headers) != 1:
        raise AssertionError(f"workflow must contain exactly one jobs block, found {len(jobs_headers)}")

    job_header = re.compile(r"^  (?P<job_id>[A-Za-z_][A-Za-z0-9_-]*):(?:\s+#.*)?$")
    jobs: dict[str, str] = {}
    current_job: str | None = None
    current_block: list[str] = []

    def finish_current_job() -> None:
        nonlocal current_job, current_block
        if current_job is None:
            return
        jobs[current_job] = "\n".join(current_block)
        current_job = None
        current_block = []

    for line_number, line in enumerate(lines[jobs_headers[0] + 1:], start=jobs_headers[0] + 2):
        if line and not line[0].isspace() and not line.startswith("#"):
            break
        if not line.strip() or line.lstrip().startswith("#"):
            if current_job is not None:
                current_block.append(line)
            continue

        indentation = len(line) - len(line.lstrip(" "))
        if indentation == 2:
            stripped_header = line.strip()
            if stripped_header.startswith(('"', "'")):
                raise AssertionError(f"quoted job header is unsupported at line {line_number}: {stripped_header}")
            match = job_header.fullmatch(line)
            if match is None:
                raise AssertionError(f"unparseable job header at line {line_number}: {stripped_header}")
            finish_current_job()
            job_id = match.group("job_id")
            if job_id in jobs:
                raise AssertionError(f"duplicate job id at line {line_number}: {job_id}")
            current_job = job_id
            continue

        if indentation < 4 or current_job is None:
            raise AssertionError(f"unparseable jobs content at line {line_number}: {line.strip()}")
        current_block.append(line)

    finish_current_job()
    return jobs


def parse_required_pr_workflow_jobs(workflow: str) -> dict[str, str]:
    jobs = parse_workflow_job_blocks(workflow)
    expected_jobs = {"pr-verify-fast", "pr-verify-smoke", "pr-verify-required"}
    if set(jobs) != expected_jobs:
        raise AssertionError(f"workflow job set mismatch: expected {sorted(expected_jobs)}, found {sorted(jobs)}")
    return jobs


def parse_job_scalar(job_block: str, key: str) -> str | list[str] | None:
    match = re.search(rf"(?m)^    {re.escape(key)}:\s*(.+?)\s*$", job_block)
    if match is None:
        return None
    value = match.group(1)
    if value.startswith("["):
        parsed = json.loads(value)
        if not isinstance(parsed, list) or not all(isinstance(entry, str) for entry in parsed):
            raise AssertionError(f"{key} must be a string list")
        return parsed
    return value


def parse_job_steps(job_block: str) -> list[dict[str, object]]:
    lines = job_block.splitlines()
    steps_header = [index for index, line in enumerate(lines) if line == "    steps:"]
    if len(steps_header) != 1:
        raise AssertionError(f"job must contain exactly one steps block, found {len(steps_header)}")
    steps: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    for line in lines[steps_header[0] + 1:]:
        if line.startswith("      - name: "):
            if current is not None:
                steps.append(current)
            current = {"name": line.removeprefix("      - name: ").strip(), "lines": []}
            continue
        if line.startswith("      - "):
            raise AssertionError(f"workflow step must have an explicit name: {line.strip()}")
        if line and not line.startswith("        "):
            raise AssertionError(f"unparseable workflow step content: {line.strip()}")
        if current is not None:
            current["lines"].append(line)
    if current is not None:
        steps.append(current)
    if not steps:
        raise AssertionError("job steps block is empty")
    return steps


def parse_job_env(job_block: str) -> dict[str, str]:
    lines = job_block.splitlines()
    env_headers = [index for index, line in enumerate(lines) if line == "    env:"]
    if len(env_headers) != 1:
        raise AssertionError(f"job must contain exactly one env block, found {len(env_headers)}")
    result: dict[str, str] = {}
    for line in lines[env_headers[0] + 1:]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line.startswith("      "):
            break
        match = re.fullmatch(r"      ([A-Z][A-Z0-9_]*):\s*(.+)", line)
        if match is None:
            raise AssertionError(f"unparseable job env entry: {line.strip()}")
        key, value = match.groups()
        if key in result:
            raise AssertionError(f"duplicate job env key: {key}")
        result[key] = value.strip()
    return result


def parse_step_run(step: dict[str, object]) -> str:
    lines = [str(line) for line in step["lines"]]
    run_indexes = [index for index, line in enumerate(lines) if line.startswith("        run:")]
    if len(run_indexes) != 1:
        raise AssertionError(f"step must contain exactly one run field, found {len(run_indexes)}")
    run_line = lines[run_indexes[0]]
    scalar = run_line.removeprefix("        run:").strip()
    if scalar and scalar != "|":
        return scalar
    if scalar != "|":
        raise AssertionError("step run field must be a scalar or literal block")
    body: list[str] = []
    for line in lines[run_indexes[0] + 1:]:
        if line.startswith("          "):
            body.append(line[10:])
        elif not line:
            body.append("")
        else:
            break
    if not body:
        raise AssertionError("step literal run block is empty")
    return "\n".join(body)


def parse_workflow_dispatch_inputs(workflow: str) -> dict[str, dict[str, str]]:
    lines = workflow.splitlines()
    dispatch_headers = [index for index, line in enumerate(lines) if line == "  workflow_dispatch:"]
    if len(dispatch_headers) != 1:
        raise AssertionError(f"workflow must contain exactly one workflow_dispatch block, found {len(dispatch_headers)}")
    start = dispatch_headers[0]
    if start + 1 >= len(lines) or lines[start + 1] != "    inputs:":
        raise AssertionError("workflow_dispatch must contain an inputs block")
    inputs: dict[str, dict[str, str]] = {}
    current: str | None = None
    for line in lines[start + 2:]:
        if line and not line.startswith("      "):
            break
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        input_match = re.fullmatch(r"      ([a-z][a-z0-9_]*):", line)
        if input_match:
            current = input_match.group(1)
            inputs[current] = {}
            continue
        field_match = re.fullmatch(r"        ([a-z][a-z0-9_-]*):\s*(.+)", line)
        if current is None or field_match is None:
            raise AssertionError(f"unparseable workflow_dispatch input: {line.strip()}")
        key, value = field_match.groups()
        inputs[current][key] = value.strip()
    return inputs


def extract_required_aggregator_script(job_block: str) -> str:
    lines = job_block.splitlines()
    try:
        run_index = lines.index("        run: |")
    except ValueError:
        raise AssertionError("required aggregator must contain one literal run block")
    body_lines: list[str] = []
    for line in lines[run_index + 1:]:
        if line.startswith("          "):
            body_lines.append(line[10:])
        elif line == "":
            body_lines.append("")
        else:
            break
    shell_body = "\n".join(body_lines)
    heredoc = re.fullmatch(r"node <<'NODE'\n(?P<script>.*)\nNODE", shell_body, re.DOTALL)
    if heredoc is None:
        raise AssertionError("required aggregator must execute one bounded Node heredoc")
    return heredoc.group("script")


def validate_p4_nightly_selective_repair_workflow(workflow: str) -> None:
    inputs = parse_workflow_dispatch_inputs(workflow)
    if set(inputs) != {"source_run_id", "rerun_scope"}:
        raise AssertionError("selective repair input set drifted")
    if inputs["source_run_id"].get("required") != "true":
        raise AssertionError("source_run_id must be required")
    if inputs["rerun_scope"].get("default") != "failed":
        raise AssertionError("rerun_scope must default to failed")

    jobs = parse_workflow_job_blocks(workflow)
    if set(jobs) != {"plan", "reuse", "execute", "closeout"}:
        raise AssertionError("selective repair job set drifted")
    if parse_job_scalar(jobs["closeout"], "needs") != ["plan", "reuse", "execute"]:
        raise AssertionError("closeout dependency set drifted")
    if "needs.plan.outputs.execute_count != '0'" not in jobs["execute"]:
        raise AssertionError("execute lane lost zero-spawn guard")
    if "matrix: ${{ fromJSON(needs.plan.outputs.execute_matrix) }}" not in jobs["execute"]:
        raise AssertionError("execute lane lost planner-owned matrix")

    plan_steps = {str(step["name"]): step for step in parse_job_steps(jobs["plan"])}
    if "actions/download-artifact@" in jobs["plan"]:
        raise AssertionError("plan job cannot download its own future artifact")
    fetch_run = parse_step_run(plan_steps["Fetch exact source run metadata"])
    for fragment in (
        "/actions/runs/$SOURCE_RUN_ID/jobs?filter=latest&per_page=100",
        "/actions/runs/$SOURCE_RUN_ID/artifacts?per_page=100",
    ):
        if fragment not in fetch_run:
            raise AssertionError(f"source REST snapshot contract missing: {fragment}")
    plan_run = parse_step_run(plan_steps["Build fail-closed repair plan"])
    for fragment in (
        '--source-run-id "$SOURCE_RUN_ID"',
        '--rerun-scope "$RERUN_SCOPE"',
        '--expected-sha "$EXPECTED_SHA"',
        "git rev-parse 'HEAD^{tree}'",
        "p4_nightly_receipt_resolver.mjs",
        "p4_nightly_closeout.mjs",
    ):
        if fragment not in plan_run:
            raise AssertionError(f"repair planner binding missing: {fragment}")

    reuse_steps = parse_job_steps(jobs["reuse"])
    reuse_names = [str(step["name"]) for step in reuse_steps]
    if reuse_names.count("Download exact repair plan") != 1:
        raise AssertionError("reuse job requires exactly one repair plan download")
    if reuse_names.index("Download exact repair plan") >= reuse_names.index("Validate exact checker receipt"):
        raise AssertionError("reuse repair plan download must precede receipt resolution")
    reuse_source = "\n".join(str(line) for step in reuse_steps for line in step["lines"])
    expected_reuse_counts = {
        "p4_nightly_receipt_resolver.mjs": 3,
        "run-id: ${{ inputs.source_run_id }}": 3,
        "github-token: ${{ github.token }}": 3,
        "--repair-plan .runtime/repair/plan/p4-repair-plan.json": 3,
        '--current-run-id "${{ github.run_id }}"': 3,
        ".resolved.json": 3,
    }
    for fragment, expected_count in expected_reuse_counts.items():
        if reuse_source.count(fragment) != expected_count:
            raise AssertionError(f"reuse binding count drifted for {fragment}")

    execute_steps = {str(step["name"]): step for step in parse_job_steps(jobs["execute"])}
    execute_names = list(execute_steps)
    if execute_names.count("Download exact repair plan") != 1:
        raise AssertionError("execute job requires exactly one repair plan download")
    for step_name in (
        "Download checker Python dependencies",
        "Install checker Python dependencies",
        "Execute selected authority once",
        "Bind executed receipt to current repair run",
    ):
        if step_name not in execute_steps:
            raise AssertionError(f"execute contract step missing: {step_name}")
    if execute_names.index("Download checker Python dependencies") >= execute_names.index("Install checker Python dependencies"):
        raise AssertionError("checker wheel download must precede install")
    if execute_names.index("Install checker Python dependencies") >= execute_names.index("Execute selected authority once"):
        raise AssertionError("checker install must precede authority execution")
    if execute_names.index("Download exact repair plan") >= execute_names.index("Bind executed receipt to current repair run"):
        raise AssertionError("execute repair plan download must precede receipt resolution")
    download_run = parse_step_run(execute_steps["Download checker Python dependencies"])
    install_run = parse_step_run(execute_steps["Install checker Python dependencies"])
    if "python -m pip download -r requirements-dev.lock.txt --dest $env:WHEELHOUSE_DIR" not in download_run:
        raise AssertionError("checker wheelhouse download drifted")
    if "python -m pip install --no-index --find-links $env:WHEELHOUSE_DIR -r requirements-dev.lock.txt" not in install_run:
        raise AssertionError("checker offline install drifted")
    execute_run = parse_step_run(execute_steps["Execute selected authority once"])
    if '--role "${{ matrix.role }}"' not in execute_run:
        raise AssertionError("authority execution lost matrix role binding")
    bind_run = parse_step_run(execute_steps["Bind executed receipt to current repair run"])
    for fragment in (
        "p4_nightly_receipt_resolver.mjs",
        '--role "${{ matrix.role }}"',
        "--repair-plan .runtime/repair/plan/p4-repair-plan.json",
        '--current-run-id "${{ github.run_id }}"',
        ".resolved.json",
    ):
        if fragment not in bind_run:
            raise AssertionError(f"executed receipt binding missing: {fragment}")

    closeout_steps = {str(step["name"]): step for step in parse_job_steps(jobs["closeout"])}
    closeout_names = list(closeout_steps)
    if closeout_names.count("Download repair plan") != 1:
        raise AssertionError("closeout job requires exactly one repair plan download")
    if closeout_names.index("Download repair plan") >= closeout_names.index("Validate mixed-origin exact closeout"):
        raise AssertionError("closeout repair plan download must precede closeout")
    closeout_run = parse_step_run(closeout_steps["Validate mixed-origin exact closeout"])
    if closeout_run.count("--authority ") != 3:
        raise AssertionError("closeout authority count drifted")
    if closeout_run.count("--resolved-authority ") != 3:
        raise AssertionError("closeout resolved authority count drifted")
    for fragment in ("--repair-plan ", '--current-run-id "${{ github.run_id }}"'):
        if fragment not in closeout_run:
            raise AssertionError(f"closeout repair binding missing: {fragment}")
    for forbidden in ("verify:nightly", "linux-core", "scenario-heavy"):
        if forbidden in workflow:
            raise AssertionError(f"selective repair expanded into forbidden lane: {forbidden}")


class E2eStructuralToolingContractTest(unittest.TestCase):
    def setUp(self) -> None:
        TMP_BASE.mkdir(parents=True, exist_ok=True)
        self._temp_dir = tempfile.TemporaryDirectory(
            prefix=f"{self._testMethodName}-",
            dir=TMP_BASE,
        )
        self.addCleanup(self._temp_dir.cleanup)
        self.tmp_root = Path(self._temp_dir.name)

    def assert_command_ok(self, result: subprocess.CompletedProcess[str]) -> None:
        if result.returncode == 0:
            return
        details = "\n".join(part for part in [result.stdout.strip(), result.stderr.strip()] if part)
        self.fail(details or "command failed")

    def test_timeout_inventory_writes_schema(self) -> None:
        json_out = self.tmp_root / "timeout-inventory.json"
        md_out = self.tmp_root / "timeout-inventory.md"
        result = run_command(
            "node",
            "tools/test_timeout_inventory.mjs",
            "--json-out",
            str(json_out),
            "--md-out",
            str(md_out),
        )
        self.assert_command_ok(result)
        payload = json.loads(json_out.read_text(encoding="utf-8"))
        self.assertEqual(payload["schemaVersion"], 1)
        self.assertGreaterEqual(payload["summary"]["specFileCount"], 44)
        self.assertTrue(any(entry["specPath"] == "tests/e2e/city_lights_layer_regression.spec.js" for entry in payload["entries"]))
        self.assertTrue(md_out.exists())

    def test_import_graph_writes_schema(self) -> None:
        graph_out = self.tmp_root / "test-import-graph.json"
        summary_json = self.tmp_root / "test-import-graph-summary.json"
        summary_md = self.tmp_root / "test-import-graph-summary.md"
        result = run_command(
            "node",
            "tools/build_test_import_graph.mjs",
            "--graph-out",
            str(graph_out),
            "--summary-json-out",
            str(summary_json),
            "--summary-md-out",
            str(summary_md),
        )
        self.assert_command_ok(result)
        payload = json.loads(graph_out.read_text(encoding="utf-8"))
        self.assertEqual(payload["schemaVersion"], 1)
        self.assertGreaterEqual(payload["summary"]["specCount"], 44)
        self.assertIn("tests/e2e/main_shell_i18n.spec.js", payload["specs"])
        self.assertIn("tests/e2e/support/playwright-app.js", payload["reverseIndex"])
        self.assertTrue(summary_json.exists())
        self.assertTrue(summary_md.exists())

    def test_visual_color_readiness_keeps_shared_interaction_infra_gate(self) -> None:
        support_source = (REPO_ROOT / "tests" / "e2e" / "support" / "playwright-app.js").read_text(encoding="utf-8")
        scenario_source = (
            REPO_ROOT
            / "tests"
            / "e2e"
            / "dev"
            / "scenario_chunk_exact_after_settle_regression.dev.spec.js"
        ).read_text(encoding="utf-8")

        shared_chunk_idle = support_source[
            support_source.index("async function waitForChunkIdle"):
            support_source.index("async function waitForRenderIdle")
        ]
        political_color_wait = scenario_source[
            scenario_source.index("async function waitForFullPoliticalColorCoverage"):
            scenario_source.index("async function collectPostEditPoliticalSnapshot")
        ]
        post_edit_paint_wait = scenario_source[
            scenario_source.index("async function waitForPostEditPoliticalPaint"):
            scenario_source.index("async function startChunkPromotionProbe")
        ]

        self.assertIn("requireInfra = true", shared_chunk_idle)
        self.assertIn("&& (!requiresInfra || !loadState.pendingInfraPromotion)", shared_chunk_idle)
        self.assertNotIn("&& !loadState.pendingInfraPromotion", political_color_wait)
        self.assertNotIn("&& !loadState.pendingInfraPromotion", post_edit_paint_wait)
        self.assertIn("pendingInfraPromotion: !!loadState.pendingInfraPromotion", political_color_wait)

        fixtures_source = (REPO_ROOT / "tests" / "e2e" / "support" / "fixtures.js").read_text(encoding="utf-8")
        city_label_source = (REPO_ROOT / "tests" / "e2e" / "city_label_i18n_redraw.spec.js").read_text(encoding="utf-8")
        city_lights_source = (REPO_ROOT / "tests" / "e2e" / "city_lights_layer_regression.spec.js").read_text(encoding="utf-8")
        self.assertIn("sharedCityRequireInfraIdle: [true", fixtures_source)
        self.assertIn('}, { scope: "worker", timeout: SHARED_CITY_BOOT_TIMEOUT_MS }]', fixtures_source)
        self.assertIn("test.use({ sharedCityRequireInfraIdle: false })", city_label_source)
        self.assertIn("requireInfraIdle: true", city_label_source)
        self.assertNotIn("async function ensureScenario", city_label_source)
        self.assertNotIn("async function ensureBaseCityDataLoaded", city_label_source)
        self.assertNotIn("async function setZoomPercent", city_label_source)
        self.assertIn("test.use({ sharedCityRequireInfraIdle: false })", city_lights_source)
        self.assertIn("requireInfraIdle: true", city_lights_source)
        self.assertIn("async function waitForVisualRenderIdle(page, options = {})", city_lights_source)
        self.assertIn("await waitForRenderIdle(page, { ...options, requireInfra: false });", city_lights_source)
        self.assertNotIn("async function waitForScenarioInteractionsReady", city_lights_source)
        self.assertNotIn("async function waitForDefaultScenario", city_lights_source)
        self.assertNotIn("async function ensureScenario", city_lights_source)

        appearance_wait_caller = city_lights_source[
            city_lights_source.index("async function configureCityLights"):
            city_lights_source.index("async function setMapZoom")
        ]
        self.assertIn("await waitForVisualRenderIdle(page", appearance_wait_caller)
        self.assertNotIn("await waitForRenderIdle(page", appearance_wait_caller)

        final_visual_wait_caller = city_lights_source[
            city_lights_source.index("async function setMapZoom"):
            city_lights_source.index("async function sampleWindowLuminance")
        ]
        self.assertIn("await waitForRenderIdle(page", final_visual_wait_caller)
        self.assertNotIn("await waitForVisualRenderIdle(page", final_visual_wait_caller)

    def test_pages_public_release_gate_requires_explicit_candidate_url(self) -> None:
        package_json = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
        scripts = package_json["scripts"]
        spec = (REPO_ROOT / "tests" / "e2e" / "release" / "pages_public_release_gate.spec.js").read_text(encoding="utf-8")
        web_server = (REPO_ROOT / "tests" / "e2e" / "support" / "playwright-web-server.js").read_text(encoding="utf-8")

        self.assertIn("test:e2e:pages-public-release-gate", scripts)
        self.assertIn("test:e2e:pages-public-release-gate:deployed", scripts)
        self.assertIn("SCENARIO_FORGE_PAGES_URL", spec)
        self.assertIn("PLAYWRIGHT_TEST_BASE_URL", spec)
        self.assertIn("process.env.SCENARIO_FORGE_PAGES_URL", web_server)
        self.assertIn("SCENARIO_FORGE_ALLOW_DEFAULT_PAGES_URL", spec)
        self.assertIn('npm_lifecycle_event === "test:e2e:pages-public-release-gate:deployed"', spec)
        self.assertIn("Set SCENARIO_FORGE_PAGES_URL or PLAYWRIGHT_TEST_BASE_URL", spec)
        self.assertIn("../support/release-smoke", spec)
        self.assertIn("runReleaseSmokePreflight", spec)
        self.assertIn("RELEASE_SMOKE_RETRY_DELAY_MS", spec)
        self.assertIn("browser.newContext()", spec)
        config_probe = """
const lifecycleEvent = process.argv[1];
if (lifecycleEvent) process.env.npm_lifecycle_event = lifecycleEvent;
else delete process.env.npm_lifecycle_event;
const config = require('./playwright.config.cjs');
const ignores = (Array.isArray(config.testIgnore) ? config.testIgnore : [config.testIgnore])
  .filter(Boolean)
  .map((entry) => String(entry));
process.stdout.write(JSON.stringify(ignores));
"""
        default_config = run_command("node", "-e", config_probe, "")
        release_config = run_command("node", "-e", config_probe, "test:e2e:pages-public-release-gate")
        deployed_config = run_command("node", "-e", config_probe, "test:e2e:pages-public-release-gate:deployed")
        self.assert_command_ok(default_config)
        self.assert_command_ok(release_config)
        self.assert_command_ok(deployed_config)
        self.assertTrue(any("release" in entry for entry in json.loads(default_config.stdout)))
        self.assertFalse(any("release" in entry for entry in json.loads(release_config.stdout)))
        self.assertFalse(any("release" in entry for entry in json.loads(deployed_config.stdout)))
        self.assertIn("issueSummary.unexpectedNetworkFailures.length > 0", spec)
        self.assertIn("originalPhase", spec)
        landing_phase_index = spec.index("await withReleaseSmokePhase(RELEASE_SMOKE_PHASES.LANDING_PREFLIGHT")
        landing_assertion_index = spec.index("await expect.poll(() => readLandingSampleDownloadState(page)", landing_phase_index)
        landing_phase_block = spec[landing_phase_index:landing_assertion_index]
        self.assertIn('await page.goto(publicUrl(""), { waitUntil: "domcontentloaded" });', landing_phase_block)
        self.assertIn('await page.waitForLoadState("networkidle", { timeout: 30000 });', landing_phase_block)
        self.assertNotIn("const landingSampleState = await readLandingSampleDownloadState(page);", landing_phase_block)

    def test_deploy_workflow_smokes_deployed_pages_url(self) -> None:
        workflow = (REPO_ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")

        deployment_step = "uses: actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e # v4"
        smoke_step = "name: Smoke deployed Pages URL"
        self.assertIn(deployment_step, workflow)
        self.assertIn(smoke_step, workflow)
        self.assertGreater(workflow.index(smoke_step), workflow.index(deployment_step))
        self.assertIn("PLAYWRIGHT_BROWSERS_PATH: .runtime/browser/ms-playwright", workflow)
        self.assertIn("uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4", workflow)
        self.assertIn("uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4", workflow)
        self.assertIn("npx playwright install chromium", workflow)
        self.assertIn("SCENARIO_FORGE_PAGES_URL: ${{ steps.deployment.outputs.page_url }}", workflow)
        self.assertIn("PLAYWRIGHT_TEST_BASE_URL: ${{ steps.deployment.outputs.page_url }}", workflow)
        self.assertIn("npm run test:e2e:pages-public-release-gate", workflow)

    def test_scenario_contract_matrix_pushes_create_a_real_skip_job(self) -> None:
        workflow = (REPO_ROOT / ".github" / "workflows" / "scenario-contract-matrix.yml").read_text(encoding="utf-8")
        transport_workflow = (REPO_ROOT / ".github" / "workflows" / "transport-contract-required.yml").read_text(encoding="utf-8")

        self.assertIn("  push:", workflow)
        self.assertIn("      - main", workflow)
        self.assertIn('event_name="$GITHUB_EVENT_NAME"', workflow)
        self.assertNotIn("github.event.pull_request", workflow)
        self.assertNotIn("github.event.pull_request", transport_workflow)
        self.assertIn("GITHUB_EVENT_PATH", workflow)
        self.assertIn("GITHUB_EVENT_PATH", transport_workflow)
        self.assertIn('if [ "$event_name" = "workflow_dispatch" ]; then', workflow)
        self.assertIn('elif [ "$event_name" = "push" ]; then', workflow)
        self.assertIn('payload.get("before")', workflow)
        self.assertIn('git diff --name-only "$base_sha..$head_sha"', workflow)
        self.assertIn('cache: "pip"', workflow)
        self.assertIn("python -m pip install -r requirements-dev.lock.txt", workflow)
        self.assertIn('run: |\n          echo "Scenario contract matrix skipped:', workflow)
        self.assertIn('run: |\n          echo "Transport contract skipped:', transport_workflow)

    def test_gitignore_policy_keeps_local_state_ignored_and_templates_trackable(self) -> None:
        expectations = {
            ".env": True,
            ".env.local": True,
            ".env.example": False,
            ".env.template": False,
            ".vercel/project.json": True,
        }

        for path, should_be_ignored in expectations.items():
            with self.subTest(path=path):
                result = run_command("git", "check-ignore", "--no-index", "-q", "--", path)
                self.assertIn(result.returncode, {0, 1}, result.stderr)
                self.assertEqual(
                    should_be_ignored,
                    result.returncode == 0,
                    f"{path} ignore status drifted",
                )

    def test_console_allowlist_decay_passes_without_exceptions(self) -> None:
        result = run_command("node", "tools/check_console_allowlist_decay.mjs")
        self.assert_command_ok(result)
        self.assertIn("Console allowlist passed with 0 entries.", result.stdout)

    def test_timeout_guardrails_pass(self) -> None:
        result = run_command("node", "tools/check_test_timeout_guardrails.mjs")
        self.assert_command_ok(result)
        self.assertIn("Test timeout guardrails passed", result.stdout)

    def test_ui_contract_smoke_wait_budget_fits_inside_test_timeout(self) -> None:
        source = (REPO_ROOT / "tests" / "e2e" / "ui_contract_foundation.spec.js").read_text(encoding="utf-8")
        self.assertIn("test.setTimeout(60_000);", source)
        self.assertIn("waitForAppInteractive(page, { timeout: 45_000 });", source)

    def test_verification_selector_routes_bootstrap_detail_promotion_changes(self) -> None:
        script = """
const { buildRecommendation } = await import('./tools/select_verification_targets.mjs');
const report = buildRecommendation(['js/bootstrap/deferred_detail_promotion.js']);
const commands = report.recommendedCommands.map((entry) => entry.commandRef);
if (!commands.includes('node tools/e2e_layering.mjs run-spec tests/e2e/startup_bundle_recovery_contract.spec.js')) {
  throw new Error(`missing startup route: ${commands.join(', ')}`);
}
if (!commands.includes('node tools/e2e_layering.mjs run-spec tests/e2e/tno_startup_visible_context_layers_contract.spec.js')) {
  throw new Error(`missing tno-startup route: ${commands.join(', ')}`);
}
if (!commands.includes('node tools/e2e_layering.mjs run-spec tests/e2e/city_label_i18n_redraw.spec.js')) {
  throw new Error(`missing city-runtime route: ${commands.join(', ')}`);
}
if (!commands.includes('python -m unittest tests.test_main_deferred_detail_promotion_boundary_contract tests.test_scenario_chunk_refresh_contracts tests.test_scenario_renderer_bridge_boundary_contract -q')) {
  throw new Error(`missing deferred-detail python contract: ${commands.join(', ')}`);
}
if (commands.some((command) => command.includes('run-domain'))) {
  throw new Error(`fallback set should stay spec-level: ${commands.join(', ')}`);
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_adaptive_runner_discovers_workspace_only_by_default(self) -> None:
        script = """
const calls = [];
const nul = String.fromCharCode(0);
const fakeRunner = (_bin, args) => {
  calls.push(args.join(' '));
  const joined = args.join(' ');
  if (joined === 'status --porcelain=v1 -z --untracked-files=all') {
    return { status: 0, stdout: [
      ' M js/ui/sidebar.js',
      'M  tests/test_startup_shell.py',
      '?? tools/run_adaptive_tests.mjs',
      '',
    ].join(nul) };
  }
  throw new Error(`unexpected workspace discovery command: ${joined}`);
};
const { discoverChangedFiles } = await import('./tools/run_adaptive_tests.mjs');
const files = discoverChangedFiles({ runner: fakeRunner });
if (calls.length !== 1) {
  throw new Error(`workspace discovery should use one coherent status snapshot: ${calls.join(' | ')}`);
}
if (calls.some((entry) => entry.includes('origin/main...HEAD') || entry.includes('HEAD^'))) {
  throw new Error(`history-based discovery should stay disabled by default: ${calls.join(' | ')}`);
}
if (files.join(',') !== 'js/ui/sidebar.js,tests/test_startup_shell.py,tools/run_adaptive_tests.mjs') {
  throw new Error(`unexpected discovered files: ${files.join(',')}`);
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_adaptive_runner_import_has_no_top_level_side_effects(self) -> None:
        script = """
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adaptive-runner-import-'));
const jsonOut = path.join(tempRoot, '.runtime', 'reports', 'generated', 'test-adaptive-selection.json');
const mdOut = path.join(tempRoot, '.runtime', 'reports', 'generated', 'test-adaptive-selection.md');
process.chdir(tempRoot);
await import(pathToFileURL(path.join(repoRoot, 'tools', 'run_adaptive_tests.mjs')).href);
if (fs.existsSync(jsonOut) || fs.existsSync(mdOut)) {
  throw new Error(`import should stay side-effect free: ${jsonOut}, ${mdOut}`);
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)
        self.assertEqual(result.stdout.strip(), "")
        self.assertEqual(result.stderr.strip(), "")

    def test_adaptive_runner_history_discovery_includes_deleted_files(self) -> None:
        script = """
const calls = [];
const fakeRunner = (_bin, args) => {
  calls.push(args.join(' '));
  return { status: 0, stdout: '' };
};
const { discoverChangedFiles } = await import('./tools/run_adaptive_tests.mjs');
discoverChangedFiles({ runner: fakeRunner, includeBranchHistory: true });
const requiredCalls = [
  'diff --name-only origin/main...HEAD --diff-filter=ACMRD -z',
];
for (const expected of requiredCalls) {
  if (!calls.some((entry) => entry.includes(expected))) {
    throw new Error(`missing history diff-filter call ${expected}: ${calls.join(' | ')}`);
  }
}
if (calls.some((entry) => entry.includes('HEAD^ HEAD'))) {
  throw new Error(`branch history must not shrink to the latest commit: ${calls.join(' | ')}`);
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_adaptive_runner_accepts_an_exact_history_base(self) -> None:
        script = """
const calls = [];
const fakeRunner = (_bin, args) => {
  calls.push(args.join(' '));
  return { status: 0, stdout: '' };
};
const { discoverChangedFiles } = await import('./tools/run_adaptive_tests.mjs');
discoverChangedFiles({ runner: fakeRunner, historyBase: 'HEAD^' });
const exactCall = 'diff --name-only HEAD^ HEAD --diff-filter=ACMRD -z';
if (!calls.some((entry) => entry.includes(exactCall))) {
  throw new Error(`missing exact phase-boundary call ${exactCall}: ${calls.join(' | ')}`);
}
if (calls.some((entry) => entry.includes('origin/main...HEAD'))) {
  throw new Error(`exact phase boundary must exclude broad branch history: ${calls.join(' | ')}`);
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_adaptive_runner_normalizes_nul_delimited_git_paths(self) -> None:
        script = """
const { parseGitPathOutput } = await import('./tools/run_adaptive_tests.mjs');
const files = parseGitPathOutput('js/ui/sidebar.js\\0\\"tests/e2e/dev/tno_ready_state_contract.dev.spec.js\\"\\0\\0');
if (files.length !== 2) {
  throw new Error(`expected 2 files, got ${files.length}`);
}
if (files[0] !== 'js/ui/sidebar.js' || files[1] !== 'tests/e2e/dev/tno_ready_state_contract.dev.spec.js') {
  throw new Error(`unexpected normalized files: ${files.join(',')}`);
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_adaptive_runner_uses_project_python_wrapper_on_windows(self) -> None:
        script = """
import process from 'node:process';
const { commandToProcess } = await import('./tools/run_adaptive_tests.mjs');
const cases = [
  {
    commandRef: 'python -m unittest tests.test_e2e_structural_tooling -q',
    args: ['-m', 'unittest', 'tests.test_e2e_structural_tooling', '-q'],
  },
  {
    commandRef: 'python tools/check_state_writer_policy.py --report "C:/Temp Path/report.json"',
    args: ['tools/check_state_writer_policy.py', '--report', 'C:/Temp Path/report.json'],
  },
  {
    commandRef: 'python -m pytest "tests/path with spaces.py" -q',
    args: ['-m', 'pytest', 'tests/path with spaces.py', '-q'],
  },
];
for (const testCase of cases) {
  const windowsCommand = commandToProcess(testCase.commandRef, 'win32');
  const expectedWindowsCommand = {
    bin: process.execPath,
    args: ['tools/run_python.mjs', ...testCase.args],
  };
  if (JSON.stringify(windowsCommand) !== JSON.stringify(expectedWindowsCommand)) {
    throw new Error(`unexpected Windows Python command: ${JSON.stringify(windowsCommand)}`);
  }
  const linuxCommand = commandToProcess(testCase.commandRef, 'linux');
  if (JSON.stringify(linuxCommand) !== JSON.stringify({ bin: 'python', args: testCase.args })) {
    throw new Error(`unexpected Linux Python command: ${JSON.stringify(linuxCommand)}`);
  }
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_adaptive_execute_plan_blocks_main_thread_by_default(self) -> None:
        script = """
const { buildExecutionPlan } = await import('./tools/run_adaptive_tests.mjs');
const tnoWaterCommand = 'python tools/validate_tno_water_geometries.py --scenario-dir data/scenarios/tno_1962 --report-path .runtime/reports/generated/tno_1962.polar_coverage_report.json';
const authority = (commandRef, disposition, resourceLocks, ciProfiles) => ({
  commandRef,
  executionOwner: disposition,
  executionOwners: [disposition],
  sourceRefs: ['tests/synthetic.test.mjs'],
  domains: ['test-routing'],
  ownerHints: ['test-infra'],
  cost: disposition === 'main-thread' ? 'heavy' : 'contract',
  platforms: [process.platform],
  resourceLocks,
  tiers: [disposition === 'main-thread' ? 'heavy' : 'contract'],
  ciProfiles,
  routeIds: [`synthetic:${disposition}:${commandRef}`],
  safetyContributorRouteIds: [`synthetic:${disposition}:${commandRef}`],
  entrypointPolicy: {
    schemaVersion: 1,
    eligibleEntrypoints: disposition === 'child-safe' ? ['pr'] : ['nightly'],
    minimumDepth: disposition === 'child-safe' ? 'pr' : 'nightly',
    executionTarget: disposition === 'child-safe' ? 'child-safe' : 'main-thread',
    deferredReason: disposition === 'child-safe' ? 'requires-pr-verification' : 'requires-nightly-verification',
    plannerDisposition: 'planned',
    blockedReason: null,
    localProjection: null,
  },
  provenance: {
    routeIds: [`synthetic:${disposition}:${commandRef}`],
    safetyContributorRouteIds: [`synthetic:${disposition}:${commandRef}`],
  },
  disposition,
  batchSafe: false,
  isolation: 'process',
  maxLeaves: 64,
  maxArgvBytes: process.platform === 'win32' ? 30000 : 131072,
});
const selected = authority('verify:test:e2e-layers', 'child-safe', [], ['pr-fast']);
const mainThread = authority(tnoWaterCommand, 'main-thread', ['.runtime-output'], ['full']);
const report = {
  schemaVersion: 1,
  selectionPlatform: process.platform,
  changedFiles: ['tests/synthetic.test.mjs'],
  recommendedCommands: [selected, mainThread],
  childAgentStaticTasks: [selected],
  mainThreadSerialVerification: [mainThread],
  ciOnlyVerification: [],
  blockedVerification: [],
  matchedByFile: [],
  unmatchedChangedFiles: [],
};
const plan = buildExecutionPlan(report, { includeMainThread: false });
if (plan.routeGaps.length !== 0 || plan.executionCommands.length !== 1) {
  throw new Error(`child-safe plan must be executable: ${JSON.stringify(plan.routeGaps)}`);
}
if (plan.commandsToRun.join(',') !== 'verify:test:e2e-layers') {
  throw new Error(`unexpected runnable commands: ${plan.commandsToRun.join(',')}`);
}
if (plan.blockedMainThreadCommands.join(',') !== tnoWaterCommand) {
  throw new Error(`main-thread command should stay blocked by default: ${plan.blockedMainThreadCommands.join(',')}`);
}
const mainThreadPlan = buildExecutionPlan(report, { includeMainThread: true });
if (mainThreadPlan.routeGaps.length !== 0 || mainThreadPlan.executionCommands.length !== 2) {
  throw new Error(`main-thread plan must be executable: ${JSON.stringify(mainThreadPlan.routeGaps)}`);
}
if (!mainThreadPlan.commandsToRun.includes(tnoWaterCommand) || mainThreadPlan.blockedMainThreadCommands.length !== 0) {
  throw new Error(`includeMainThread should run the reserved command: ${JSON.stringify(mainThreadPlan)}`);
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_adaptive_execute_blocks_unmatched_files_before_running_commands(self) -> None:
        result = run_command(
            "node",
            "tools/run_adaptive_tests.mjs",
            "--execute",
            "--changed-file",
            "tools/ai_test_supervisor/supervise_adaptive_verification.mjs",
            "--changed-file",
            "docs/active/unrelated-task/unregistered-runtime.js",
            "--json-out",
            str(self.tmp_root / "test-adaptive-unmatched-execute.json"),
            "--md-out",
            str(self.tmp_root / "test-adaptive-unmatched-execute.md"),
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unmatched changed files", result.stderr)
        payload = json.loads((self.tmp_root / "test-adaptive-unmatched-execute.json").read_text(encoding="utf-8"))
        self.assertIn("docs/active/unrelated-task/unregistered-runtime.js", payload["unmatchedChangedFiles"])
        self.assertEqual(payload["executionStatus"], "blocked")
        self.assertEqual(payload["executionResults"], [])
        self.assertEqual(payload["executionPlan"]["executionCommands"], [])

    def test_adaptive_execute_rejects_a_stale_selection_artifact_with_empty_execution(self) -> None:
        selection_path = self.tmp_root / "test-adaptive-stale-selector.json"
        json_out = self.tmp_root / "test-adaptive-stale-selector-execution.json"
        md_out = self.tmp_root / "test-adaptive-stale-selector-execution.md"
        selection_path.write_text(json.dumps({
            "schemaVersion": 1,
            "changedFiles": ["package.json"],
            "recommendedCommands": [],
            "childAgentStaticTasks": [],
            "mainThreadSerialVerification": [],
            "ciOnlyVerification": [],
            "blockedVerification": [],
            "matchedByFile": [],
            "unmatchedChangedFiles": [],
        }), encoding="utf-8")
        result = run_command(
            "node",
            "tools/run_adaptive_tests.mjs",
            "--execute",
            "--defer-main-thread",
            "--changed-file",
            "tools/run_adaptive_tests.mjs",
            "--selection-json",
            str(selection_path),
            "--json-out",
            str(json_out),
            "--md-out",
            str(md_out),
        )
        self.assertNotEqual(result.returncode, 0)
        payload = json.loads(json_out.read_text(encoding="utf-8"))
        self.assertEqual(payload["executionStatus"], "blocked")
        self.assertEqual(payload["executionResults"], [])
        self.assertEqual(payload["executionPlan"]["executionCommands"], [])
        self.assertEqual(
            payload["executionPlan"]["routeGaps"][0]["code"],
            "adaptive-selection-artifact-changed-files-mismatch",
        )

    def test_adaptive_execute_records_an_explicit_empty_changed_file_list(self) -> None:
        changed_files_path = self.tmp_root / "test-adaptive-empty-changed-files.txt"
        json_out = self.tmp_root / "test-adaptive-empty-changed-files.json"
        md_out = self.tmp_root / "test-adaptive-empty-changed-files.md"
        changed_files_path.write_text("", encoding="utf-8")
        result = run_command(
            "node",
            "tools/run_adaptive_tests.mjs",
            "--execute",
            "--defer-main-thread",
            "--changed-files-list",
            str(changed_files_path),
            "--json-out",
            str(json_out),
            "--md-out",
            str(md_out),
        )
        self.assertNotEqual(result.returncode, 0)
        payload = json.loads(json_out.read_text(encoding="utf-8"))
        self.assertEqual(payload["executionStatus"], "blocked")
        self.assertEqual(payload["changedFiles"], [])
        self.assertEqual(payload["executionResults"], [])
        self.assertEqual(payload["executionPlan"]["executionCommands"], [])
        self.assertEqual(
            payload["executionPlan"]["routeGaps"][0]["code"],
            "adaptive-execution-empty-changed-files",
        )

    def test_adaptive_execute_normalizes_all_empty_ingress_before_planning(self) -> None:
        whitespace_list = self.tmp_root / "whitespace-only.txt"
        whitespace_list.write_text("  \n\t\n", encoding="utf-8")
        cases = {
            "missing-value": ["--changed-file"],
            "empty-string": ["--changed-file", ""],
            "whitespace": ["--changed-file", "   "],
            "comma-only-file": ["--changed-file", ","],
            "comma-only-list": ["--changed-files", ",,,"],
            "whitespace-list": ["--changed-files-list", str(whitespace_list)],
        }
        for name, ingress_args in cases.items():
            with self.subTest(name=name):
                json_out = self.tmp_root / f"{name}.json"
                md_out = self.tmp_root / f"{name}.md"
                result = run_command(
                    "node",
                    "tools/run_adaptive_tests.mjs",
                    "--execute",
                    "--defer-main-thread",
                    "--json-out",
                    str(json_out),
                    "--md-out",
                    str(md_out),
                    *ingress_args,
                )
                self.assertNotEqual(result.returncode, 0)
                payload = json.loads(json_out.read_text(encoding="utf-8"))
                self.assertEqual(payload["changedFiles"], [])
                self.assertEqual(payload["executionStatus"], "blocked")
                self.assertEqual(payload["executionResults"], [])
                self.assertEqual(payload["executionPlan"]["executionCommands"], [])
                self.assertEqual(
                    payload["executionPlan"]["routeGaps"][0]["code"],
                    "adaptive-execution-empty-changed-files",
                )

    def test_adaptive_execute_can_defer_main_thread_routes_with_evidence(self) -> None:
        json_out = self.tmp_root / "test-adaptive-deferred-main-thread.json"
        md_out = self.tmp_root / "test-adaptive-deferred-main-thread.md"
        result = run_command(
            "node",
            "tools/run_adaptive_tests.mjs",
            "--execute",
            "--defer-main-thread",
            "--changed-file",
            "tests/e2e/sample_guide_deeplink.spec.js",
            "--json-out",
            str(json_out),
            "--md-out",
            str(md_out),
        )
        self.assert_command_ok(result)
        payload = json.loads(json_out.read_text(encoding="utf-8"))
        self.assertEqual(payload["mainThreadDisposition"], "deferred")
        self.assertIn(
            "verify:demo",
            payload["executionPlan"]["blockedMainThreadCommands"],
        )
        self.assertTrue(payload["executionResults"])
        self.assertTrue(all(entry["exitCode"] == 0 for entry in payload["executionResults"]))
        self.assertIn("mainThreadDisposition: deferred", md_out.read_text(encoding="utf-8"))

    def test_adaptive_execute_records_main_thread_ownership_block_as_empty_evidence(self) -> None:
        json_out = self.tmp_root / "test-adaptive-blocked-main-thread.json"
        md_out = self.tmp_root / "test-adaptive-blocked-main-thread.md"
        result = run_command(
            "node",
            "tools/run_adaptive_tests.mjs",
            "--execute",
            "--changed-file",
            "tests/e2e/sample_guide_deeplink.spec.js",
            "--json-out",
            str(json_out),
            "--md-out",
            str(md_out),
        )
        self.assertNotEqual(result.returncode, 0)
        payload = json.loads(json_out.read_text(encoding="utf-8"))
        self.assertEqual(payload["executionStatus"], "blocked")
        self.assertEqual(payload["executionResults"], [])
        self.assertEqual(payload["executionPlan"]["executionCommands"], [])
        self.assertIn("verify:demo", payload["executionPlan"]["blockedMainThreadCommands"])

    def test_route_registry_includes_every_package_test_node_script(self) -> None:
        script = """
import fs from 'node:fs';
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const expectedScripts = Object.keys(packageJson.scripts).filter((name) => name.startsWith('test:node:')).sort();
const { buildRouteIndex } = await import('./tools/test_route_registry.mjs');
const routes = buildRouteIndex();
const nodeRoutes = routes.filter((route) => route.id.startsWith('node:'));
const actualScripts = nodeRoutes.map((route) => route.commandRef).sort();
const missing = expectedScripts.filter((name) => !actualScripts.includes(name));
if (missing.length) {
  throw new Error(`missing node routes: ${missing.join(', ')}`);
}
const fullP4PolicyRoute = nodeRoutes.find((route) => route.commandRef === 'test:node:p4:state-writer-policy');
if (
  !fullP4PolicyRoute
  || fullP4PolicyRoute.executionOwner !== 'main-thread'
  || fullP4PolicyRoute.cost !== 'heavy'
  || fullP4PolicyRoute.ciProfile !== 'full'
  || !fullP4PolicyRoute.resourceLocks.includes('.runtime-output')
) {
  throw new Error(`full P4 policy route must preserve its serialized lane: ${JSON.stringify(fullP4PolicyRoute)}`);
}
const scenarioChunkDeferredCommands = new Set([
  'test:node:scenario-chunk-contracts:heavy',
  'test:node:scenario-chunk-contracts:split',
  'test:node:scenario-chunk-contracts:shadow',
]);
const scenarioChunkDeferredRoutes = nodeRoutes.filter((route) => scenarioChunkDeferredCommands.has(route.commandRef));
if (
  scenarioChunkDeferredRoutes.length !== scenarioChunkDeferredCommands.size
  || scenarioChunkDeferredRoutes.some((route) => (
    route.executionOwner !== 'main-thread'
    || route.cost !== 'heavy'
    || route.ciProfile !== 'full'
    || !route.resourceLocks.includes('scenario-data')
  ))
) {
  throw new Error(`scenario chunk deferred routes must stay full and scenario-data locked: ${JSON.stringify(scenarioChunkDeferredRoutes)}`);
}
const prNodeRoutes = nodeRoutes.filter((route) => (
  route !== fullP4PolicyRoute && !scenarioChunkDeferredCommands.has(route.commandRef)
));
if (prNodeRoutes.some((route) => route.executionOwner !== 'child-safe' || route.resourceLocks.length > 0 || route.ciProfile !== 'pr-fast')) {
  throw new Error('focused node routes must stay child-safe, lock-free, and pr-fast');
}
const observabilityRoute = routes.find((route) => route.id === 'infra:playwright-observability');
if (!observabilityRoute) {
  throw new Error('missing playwright observability route');
}
for (const sourceRef of ['tests/e2e/support/fixtures.js', 'tests/e2e/support/playwright-app.js', 'tests/e2e/support/reporters']) {
  if (!observabilityRoute.sourceRef.includes(sourceRef)) {
    throw new Error(`observability route must cover ${sourceRef}: ${observabilityRoute.sourceRef}`);
  }
}
const tnoWaterRoute = routes.find((route) => route.id === 'infra:tno-water-validator');
if (!tnoWaterRoute) {
  throw new Error('missing TNO water validator route');
}
if (tnoWaterRoute.domain !== 'tno-water' || tnoWaterRoute.executionOwner !== 'main-thread' || tnoWaterRoute.cost !== 'heavy') {
  throw new Error(`unexpected TNO water route metadata: ${JSON.stringify(tnoWaterRoute)}`);
}
for (const lock of ['heavy-geo', 'scenario-data', '.runtime-output']) {
  if (!tnoWaterRoute.resourceLocks.includes(lock)) {
    throw new Error(`TNO water route missing lock ${lock}: ${tnoWaterRoute.resourceLocks.join(',')}`);
  }
}
if (!tnoWaterRoute.guidance?.ownerFiles?.includes('tools/validate_tno_water_geometries.py')) {
  throw new Error(`TNO water route must expose owner-file guidance: ${JSON.stringify(tnoWaterRoute.guidance)}`);
}
for (const [routeId, commandRef] of [
  ['infra:tno-coverage-ledger', 'verify:tno-coverage-ledger'],
  ['infra:tno-atlantropa-coverage', 'verify:tno-atlantropa-coverage'],
  ['infra:tno-polar-coverage', 'verify:tno-polar-coverage'],
  ['infra:tno-coverage-chain', 'verify:tno-coverage-chain'],
]) {
  const route = routes.find((candidate) => candidate.id === routeId);
  if (!route || route.commandRef !== commandRef || route.executionOwner !== 'main-thread') {
    throw new Error(`missing or invalid TNO coverage route ${routeId}: ${JSON.stringify(route)}`);
  }
}
const transportRoute = routes.find((route) => route.id === 'infra:transport-manifest-contracts');
if (!transportRoute || transportRoute.executionOwner !== 'child-safe' || transportRoute.resourceLocks.length !== 0) {
  throw new Error(`transport manifest route must stay child-safe and lock-free: ${JSON.stringify(transportRoute)}`);
}
const dataHealthRoute = routes.find((route) => route.id === 'infra:data-health');
if (!dataHealthRoute || dataHealthRoute.executionOwner !== 'child-safe' || dataHealthRoute.resourceLocks.length !== 0) {
  throw new Error(`data health route must stay child-safe and lock-free: ${JSON.stringify(dataHealthRoute)}`);
}
const browserSmokeRoute = routes.find((route) => route.id === 'infra:browser-smoke-static-contract');
if (
  !browserSmokeRoute
  || browserSmokeRoute.domain !== 'browser-smoke'
  || browserSmokeRoute.executionOwner !== 'child-safe'
  || browserSmokeRoute.resourceLocks.length !== 0
  || browserSmokeRoute.cost !== 'fast'
) {
  throw new Error(`browser smoke route must stay static, child-safe, and lock-free: ${JSON.stringify(browserSmokeRoute)}`);
}
for (const sourceRef of ['ops/browser-mcp/run-smoke-browser-inspection.sh', 'ops/browser-mcp/inspection-profile.toml', 'ops/browser-mcp/inspection-profile.schema.md', 'tools/browser_smoke_profile_contract.py']) {
  if (!browserSmokeRoute.sourceRef.includes(sourceRef)) {
    throw new Error(`browser smoke route must cover ${sourceRef}: ${browserSmokeRoute.sourceRef}`);
  }
}
const releaseSmokeHelperRoute = routes.find((route) => route.id === 'node:test:node:release-smoke-helper');
if (
  !releaseSmokeHelperRoute
  || releaseSmokeHelperRoute.domain !== 'release-smoke'
  || releaseSmokeHelperRoute.ownerHint !== 'release-smoke'
  || releaseSmokeHelperRoute.executionOwner !== 'child-safe'
  || releaseSmokeHelperRoute.resourceLocks.length !== 0
  || releaseSmokeHelperRoute.ciProfile !== 'pr-fast'
) {
  throw new Error(`release smoke helper route must stay child-safe and release-scoped: ${JSON.stringify(releaseSmokeHelperRoute)}`);
}
for (const sourceRef of ['tests/release_smoke_retry_behavior.node.test.mjs', 'tests/e2e/support/release-smoke.js']) {
  if (!releaseSmokeHelperRoute.sourceRef.includes(sourceRef)) {
    throw new Error(`release smoke helper route must cover ${sourceRef}: ${releaseSmokeHelperRoute.sourceRef}`);
  }
}
const releaseGateRoute = routes.find((route) => route.id === 'direct-e2e:test:e2e:pages-public-release-gate');
if (
  !releaseGateRoute
  || releaseGateRoute.commandRef !== 'test:e2e:pages-public-release-gate'
  || releaseGateRoute.sourceRef !== 'tests/e2e/release/pages_public_release_gate.spec.js'
  || releaseGateRoute.domain !== 'release-smoke'
  || releaseGateRoute.ownerHint !== 'deploy-runtime'
  || releaseGateRoute.executionOwner !== 'main-thread'
  || releaseGateRoute.ciProfile !== 'deploy-minimal'
) {
  throw new Error(`release gate route must be explicit and main-thread owned: ${JSON.stringify(releaseGateRoute)}`);
}
for (const lock of ['browser-dev-server', 'playwright-browser', '.runtime-output']) {
  if (!releaseGateRoute.resourceLocks.includes(lock)) {
    throw new Error(`release gate route missing lock ${lock}: ${releaseGateRoute.resourceLocks.join(',')}`);
  }
}
const transportWorkbenchControllerRoute = routes.find((route) => route.id === 'node:test:node:transport-workbench-controller');
if (!transportWorkbenchControllerRoute) {
  throw new Error('missing transport workbench aggregate node route');
}
for (const sourceRef of ['tests/transport_workbench_event_owner_behavior.test.mjs', 'tests/transport_workbench_shell_owner_behavior.test.mjs']) {
  if (!transportWorkbenchControllerRoute.sourceRef.includes(sourceRef)) {
    throw new Error(`aggregate node route must expand ${sourceRef}: ${transportWorkbenchControllerRoute.sourceRef}`);
  }
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_route_registry_rejects_invalid_guidance_shape(self) -> None:
        script = """
const { validateRoute } = await import('./tools/test_route_registry.mjs');
const baseRoute = {
  id: 'test:bad-guidance',
  commandRef: 'python tools/data_health.py --json',
  sourceRef: 'tools/data_health.py',
  domain: 'test-routing',
  ownerHint: 'test-infra',
  layer: 'contract',
  cost: 'contract',
  resourceLocks: [],
  executionOwner: 'child-safe',
  ciProfile: 'pr-fast',
  guidance: { ownerFiles: 'tools/data_health.py' },
};
let rejected = false;
try {
  validateRoute(baseRoute);
} catch (error) {
  rejected = String(error.message).includes('guidance.ownerFiles');
}
if (!rejected) {
  throw new Error('route guidance ownerFiles must reject non-array values');
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_node_route_registry_expands_common_npm_run_forms(self) -> None:
        script = """
const { buildNodeRoutes } = await import('./tools/test_route_registry.mjs');
const packageJson = {
  scripts: {
    'test:node:aggregate': 'npm run -s test:node:first && npm run-script --if-present test:node:second -- --grep owner',
    'test:node:first': 'node --test tests/transport_workbench_event_owner_behavior.test.mjs',
    'test:node:second': 'node --test tests/transport_workbench_shell_owner_behavior.test.mjs',
  },
};
const route = buildNodeRoutes(packageJson).find((candidate) => candidate.id === 'node:test:node:aggregate');
if (!route) {
  throw new Error('missing aggregate route');
}
for (const sourceRef of ['tests/transport_workbench_event_owner_behavior.test.mjs', 'tests/transport_workbench_shell_owner_behavior.test.mjs']) {
  if (!route.sourceRef.includes(sourceRef)) {
    throw new Error(`aggregate route must expand ${sourceRef}: ${route.sourceRef}`);
  }
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_e2e_routes_are_spec_level_and_unique(self) -> None:
        script = """
const { buildE2eRoutes } = await import('./tools/test_route_registry.mjs');
const routes = buildE2eRoutes();
const commandRefs = routes.map((route) => route.commandRef);
const sourceRefs = routes.map((route) => route.sourceRef);
if (new Set(commandRefs).size !== commandRefs.length) {
  throw new Error('E2E commandRef values must stay unique at spec granularity');
}
if (new Set(sourceRefs).size !== sourceRefs.length) {
  throw new Error('E2E sourceRef values must stay unique at spec granularity');
}
for (const route of routes) {
  const expected = route.ciProfile === 'demo'
    ? 'verify:demo'
    : `node tools/e2e_layering.mjs run-spec ${route.sourceRef}`;
  if (route.commandRef !== expected) {
    throw new Error(`unexpected spec command for ${route.sourceRef}: ${route.commandRef}`);
  }
}
const cityRuntimeCount = routes.filter((route) => route.domain === 'city-runtime').length;
if (cityRuntimeCount !== 6) {
  throw new Error(`expected 6 city-runtime spec routes, got ${cityRuntimeCount}`);
}
const demoRoutes = routes.filter((route) => route.ciProfile === 'demo');
if (demoRoutes.length !== 1 || demoRoutes[0].sourceRef !== 'tests/e2e/sample_guide_deeplink.spec.js') {
  throw new Error(`canonical Demo profile must select only the Golden Demo route: ${JSON.stringify(demoRoutes)}`);
}
if (demoRoutes[0].commandRef !== 'verify:demo') {
  throw new Error(`Golden Demo route must be consumed by the canonical Demo entrypoint: ${JSON.stringify(demoRoutes[0])}`);
}
if (demoRoutes[0].executionOwner !== 'main-thread' || !demoRoutes[0].resourceLocks.includes('playwright-browser')) {
  throw new Error(`Golden Demo route must preserve main-thread browser ownership: ${JSON.stringify(demoRoutes[0])}`);
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_verification_selector_routes_test_infra_owner_files(self) -> None:
        script = """
const { buildRecommendation } = await import('./tools/select_verification_targets.mjs');
for (const filePath of ['tools/select_verification_targets.mjs', 'tools/test_route_registry.mjs']) {
  const report = buildRecommendation([filePath]);
  const commands = report.recommendedCommands.map((entry) => entry.commandRef);
  if (!commands.includes('python -m unittest tests.test_e2e_structural_tooling -q')) {
    throw new Error(`missing structural tooling route for ${filePath}: ${commands.join(', ')}`);
  }
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_verification_selector_routes_backend_cloud_support_files(self) -> None:
        script = """
const { buildRecommendation } = await import('./tools/select_verification_targets.mjs');
const expectedCommands = ['test:node:backend-cloud-support', 'test:py:backend-cloud-support'];
for (const filePath of ['map_backend/routes.py', 'js/api/backend_client.js', 'js/ui/sidebar/project_support_diagnostics_controller.js']) {
  const report = buildRecommendation([filePath]);
  const commands = report.recommendedCommands.map((entry) => entry.commandRef);
  for (const expectedCommand of expectedCommands) {
    if (!commands.includes(expectedCommand)) {
      throw new Error(`missing ${expectedCommand} route for ${filePath}: ${commands.join(', ')}`);
    }
  }
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_verification_selector_golden_cases_for_adaptive_routing(self) -> None:
        script = """
const { buildRecommendation } = await import('./tools/select_verification_targets.mjs');

const cases = [
  {
    name: 'selector tooling routes to structural contract and selector check',
    changedFiles: ['tools/select_verification_targets.mjs'],
    expectedCommands: [
      'python -m unittest tests.test_e2e_structural_tooling -q',
      'node tools/select_verification_targets.mjs --check',
    ],
  },
  {
    name: 'route registry changes route to structural contract and selector check',
    changedFiles: ['tools/test_route_registry.mjs'],
    expectedCommands: [
      'python -m unittest tests.test_e2e_structural_tooling -q',
      'node tools/select_verification_targets.mjs --check',
    ],
  },
  {
    name: 'gitignore policy changes route to selector contract',
    changedFiles: ['.gitignore'],
    expectedCommands: [
      'python -m unittest tests.test_e2e_structural_tooling -q',
      'node tools/select_verification_targets.mjs --check',
    ],
    exactCommands: [
      'python -m unittest tests.test_e2e_structural_tooling -q',
      'node tools/select_verification_targets.mjs --check',
    ],
    exactExecutionOwners: ['child-safe'],
    exactResourceLocks: [],
    exactMainThreadCommands: [],
    expectedUnmatched: [],
  },
  {
    name: 'perf gate workflow routes to its contract without claiming a live runtime delta',
    changedFiles: ['.github/workflows/perf-pr-gate.yml'],
    expectedCommands: ['verify:perf-gate-contract'],
    exactCommands: ['verify:perf-gate-contract'],
    exactExecutionOwners: ['child-safe'],
    exactResourceLocks: [],
    exactMainThreadCommands: [],
    expectedUnmatched: [],
  },
  {
    name: 'package metadata routes to dev e2e scripts and guardrails',
    changedFiles: ['package.json'],
    expectedCommands: [
      'test:e2e:dev:tno-ready-state',
      'test:e2e:dev:scenario-chunk-runtime',
      'verify:test-timeout-guardrails',
      'verify:perf-gate-contract',
    ],
  },
  {
    name: 'browser smoke tooling routes to static contract',
    changedFiles: [
      'ops/browser-mcp/run-smoke-browser-inspection.sh',
      'ops/browser-mcp/inspection-profile.toml',
      'ops/browser-mcp/inspection-profile.schema.md',
      'tools/browser_smoke_profile_contract.py',
    ],
    expectedCommands: ['python -m unittest tests.test_playwright_app_ready_gate_contract -q'],
    exactCommands: ['python -m unittest tests.test_playwright_app_ready_gate_contract -q'],
    forbiddenCommands: [
      'perf:gate',
      'verify:perf-gate-contract',
      'python -m unittest tests.test_perf_gate_contract -q',
    ],
    exactExecutionOwners: ['child-safe'],
    exactResourceLocks: [],
    exactMainThreadCommands: [],
  },
  {
    name: 'playwright fixtures route to observability contract and city runtime specs',
    changedFiles: ['tests/e2e/support/fixtures.js'],
    expectedCommands: [
      'python -m unittest tests.test_e2e_structural_tooling -q',
      'node tools/e2e_layering.mjs run-spec tests/e2e/city_label_i18n_redraw.spec.js',
    ],
  },
  {
    name: 'dev tno ready spec routes to direct dev script',
    changedFiles: ['tests/e2e/dev/tno_ready_state_contract.dev.spec.js'],
    expectedCommands: ['test:e2e:dev:tno-ready-state'],
  },
  {
    name: 'startup hydration behavior routes to node behavior test',
    changedFiles: ['js/core/scenario/startup_hydration.js'],
    expectedCommands: ['test:node:startup-hydration-behavior'],
  },
  {
    name: 'scenario lifecycle behavior routes to node behavior test',
    changedFiles: ['js/core/scenario/lifecycle_runtime.js'],
    expectedCommands: ['test:node:scenario-lifecycle-runtime-behavior'],
  },
  {
    name: 'tno water data routes to serial validator with locks',
    changedFiles: ['data/scenarios/tno_1962/water_regions.geojson'],
    expectedCommands: [
      'python tools/validate_tno_water_geometries.py --scenario-dir data/scenarios/tno_1962 --report-path .runtime/reports/generated/tno_1962.polar_coverage_report.json',
    ],
    expectedExecutionOwners: ['main-thread'],
    expectedResourceLocks: ['heavy-geo', 'scenario-data', '.runtime-output'],
  },
  {
    name: 'backend route changes select node and python cloud support checks',
    changedFiles: ['map_backend/routes.py'],
    expectedCommands: ['test:node:backend-cloud-support', 'test:py:backend-cloud-support'],
  },
  {
    name: 'thematic builder and contracts route to thematic contract suite',
    changedFiles: [
      'tools/build_thematic_layers.py',
      'map_builder/thematic_layer_contracts.py',
      'map_builder/thematic_wgi_ingest.py',
      'data/thematic_layers/index.json',
      'tests/test_thematic_layer_contracts.py',
      'tests/test_thematic_wgi_source_ingest.py',
    ],
    expectedCommands: ['test:py:thematic-layer-contracts'],
    expectedExecutionOwners: ['child-safe'],
    expectedResourceLocks: [],
  },
  {
    name: 'pytest style tno water file routes through pytest',
    changedFiles: ['tests/test_tno_water_geometries.py'],
    expectedCommands: ['python -m pytest tests/test_tno_water_geometries.py -q'],
    forbiddenCommands: ['python -m unittest tests.test_tno_water_geometries -q'],
  },
];

for (const testCase of cases) {
  const report = buildRecommendation(testCase.changedFiles);
  const commands = report.recommendedCommands.map((entry) => entry.commandRef);
  for (const expectedCommand of testCase.expectedCommands) {
    if (!commands.includes(expectedCommand)) {
      throw new Error(`${testCase.name}: missing ${expectedCommand}; got ${commands.join(', ')}`);
    }
  }
  for (const forbiddenCommand of testCase.forbiddenCommands || []) {
    if (commands.includes(forbiddenCommand)) {
      throw new Error(`${testCase.name}: saw forbidden ${forbiddenCommand}; got ${commands.join(', ')}`);
    }
  }
  if (testCase.exactCommands) {
    const expected = [...testCase.exactCommands].sort();
    const actual = [...commands].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${testCase.name}: expected exact commands ${expected.join(', ')}; got ${actual.join(', ')}`);
    }
  }
  for (const expectedOwner of testCase.expectedExecutionOwners || []) {
    if (!report.executionOwners.includes(expectedOwner)) {
      throw new Error(`${testCase.name}: missing owner ${expectedOwner}; got ${report.executionOwners.join(', ')}`);
    }
  }
  for (const expectedLock of testCase.expectedResourceLocks || []) {
    if (!report.resourceLocks.includes(expectedLock)) {
      throw new Error(`${testCase.name}: missing lock ${expectedLock}; got ${report.resourceLocks.join(', ')}`);
    }
  }
  if (testCase.exactExecutionOwners) {
    const expected = [...testCase.exactExecutionOwners].sort();
    const actual = [...report.executionOwners].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${testCase.name}: expected exact owners ${expected.join(', ')}; got ${actual.join(', ')}`);
    }
  }
  if (testCase.exactResourceLocks) {
    const expected = [...testCase.exactResourceLocks].sort();
    const actual = [...report.resourceLocks].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${testCase.name}: expected exact locks ${expected.join(', ')}; got ${actual.join(', ')}`);
    }
  }
  if (testCase.exactMainThreadCommands) {
    const expected = [...testCase.exactMainThreadCommands].sort();
    const actual = report.mainThreadSerialVerification.map((entry) => entry.commandRef).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${testCase.name}: expected exact main-thread commands ${expected.join(', ')}; got ${actual.join(', ')}`);
    }
  }
  if (testCase.expectedUnmatched) {
    const expected = [...testCase.expectedUnmatched].sort();
    const actual = [...report.unmatchedChangedFiles].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${testCase.name}: expected unmatched ${expected.join(', ')}; got ${actual.join(', ')}`);
    }
  }
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_verification_selector_routes_tno_water_health_gate(self) -> None:
        script = """
const { buildRecommendation } = await import('./tools/select_verification_targets.mjs');
const tnoWaterCommand = 'python tools/validate_tno_water_geometries.py --scenario-dir data/scenarios/tno_1962 --report-path .runtime/reports/generated/tno_1962.polar_coverage_report.json';
const report = buildRecommendation(['data/scenarios/tno_1962/water_regions.geojson']);
const commands = report.recommendedCommands.map((entry) => entry.commandRef);
if (!commands.includes(tnoWaterCommand)) {
  throw new Error(`missing TNO water validator command: ${commands.join(', ')}`);
}
const mainThreadEntry = report.mainThreadSerialVerification.find((entry) => entry.commandRef === tnoWaterCommand);
if (!mainThreadEntry) {
  throw new Error(`TNO water validator must be main-thread serial: ${JSON.stringify(report.mainThreadSerialVerification)}`);
}
for (const lock of ['heavy-geo', 'scenario-data', '.runtime-output']) {
  if (!mainThreadEntry.resourceLocks.includes(lock)) {
    throw new Error(`TNO water validator missing lock ${lock}: ${mainThreadEntry.resourceLocks.join(',')}`);
  }
}
const diagnostic = report.diagnosticNextSteps.find((entry) => entry.commandRef === tnoWaterCommand);
if (!diagnostic || !diagnostic.guidance.ownerFiles.includes('tools/validate_tno_water_geometries.py')) {
  throw new Error(`TNO water diagnostic guidance missing: ${JSON.stringify(report.diagnosticNextSteps)}`);
}
if (!report.advisoryNotes.some((note) => note.includes('main-thread serial ownership'))) {
  throw new Error(`missing main-thread advisory note: ${report.advisoryNotes.join(' | ')}`);
}
const testReport = buildRecommendation(['tests/test_tno_water_geometries.py']);
const testCommands = testReport.recommendedCommands.map((entry) => entry.commandRef);
if (!testCommands.includes('python -m pytest tests/test_tno_water_geometries.py -q')) {
  throw new Error(`pytest-style TNO water test must use pytest: ${testCommands.join(', ')}`);
}
if (testCommands.includes('python -m unittest tests.test_tno_water_geometries -q')) {
  throw new Error(`pytest-style TNO water test must not use unittest: ${testCommands.join(', ')}`);
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_verification_selector_routes_targeted_node_behavior_files(self) -> None:
        script = """
const { buildRecommendation } = await import('./tools/select_verification_targets.mjs');
const startupReport = buildRecommendation(['js/core/scenario/startup_hydration.js']);
const startupCommands = startupReport.recommendedCommands.map((entry) => entry.commandRef);
if (!startupCommands.includes('test:node:startup-hydration-behavior')) {
  throw new Error(`missing startup hydration node behavior route: ${startupCommands.join(', ')}`);
}
const lifecycleReport = buildRecommendation(['js/core/scenario/lifecycle_runtime.js']);
const lifecycleCommands = lifecycleReport.recommendedCommands.map((entry) => entry.commandRef);
if (!lifecycleCommands.includes('test:node:scenario-lifecycle-runtime-behavior')) {
  throw new Error(`missing scenario lifecycle node behavior route: ${lifecycleCommands.join(', ')}`);
}
const sampleGuideReport = buildRecommendation(['js/core/sample_project_import_workflow.js']);
const sampleGuideCommands = sampleGuideReport.recommendedCommands.map((entry) => entry.commandRef);
if (!sampleGuideCommands.includes('test:node:sample-project-contracts')) {
  throw new Error(`missing sample project node contract route: ${sampleGuideCommands.join(', ')}`);
}
if (!sampleGuideCommands.includes('verify:demo')) {
  throw new Error(`missing sample guide E2E route: ${sampleGuideCommands.join(', ')}`);
}
const goldenDemoCommand = sampleGuideReport.recommendedCommands.find(
  (entry) => entry.commandRef === 'verify:demo',
);
if (!goldenDemoCommand?.ciProfiles.includes('demo')) {
  throw new Error(`sample guide E2E route must use the canonical Demo profile: ${JSON.stringify(goldenDemoCommand)}`);
}
const sampleAssetReport = buildRecommendation(['landing/assets/sample-runs.json']);
const sampleAssetCommands = sampleAssetReport.recommendedCommands.map((entry) => entry.commandRef);
if (!sampleAssetCommands.includes('test:node:sample-project-contracts')) {
  throw new Error(`missing sample asset node contract route: ${sampleAssetCommands.join(', ')}`);
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_verification_selector_routes_pages_dist_mirrors_to_pages_dist_gate(self) -> None:
        script = """
const { buildRecommendation } = await import('./tools/select_verification_targets.mjs');
const report = buildRecommendation([
  'dist/app/js/core/map_renderer/hit_canvas_scheduling_owner.js',
  'dist/app/css/style.css',
  'dist/pages-dist-manifest.json',
]);
const commands = report.recommendedCommands.map((entry) => entry.commandRef);
if (!commands.includes('verify:pages-dist-and-drift')) {
  throw new Error(`missing Pages dist verification route: ${commands.join(', ')}`);
}
if (report.unmatchedChangedFiles.length) {
  throw new Error(`Pages dist mirror files should be matched: ${report.unmatchedChangedFiles.join(', ')}`);
}
const mainThreadEntry = report.mainThreadSerialVerification.find((entry) => entry.commandRef === 'verify:pages-dist-and-drift');
if (!mainThreadEntry) {
  throw new Error(`Pages dist verification must be main-thread serial: ${JSON.stringify(report.mainThreadSerialVerification)}`);
}
for (const lock of ['dist', '.runtime-output']) {
  if (!mainThreadEntry.resourceLocks.includes(lock)) {
    throw new Error(`Pages dist verification missing lock ${lock}: ${mainThreadEntry.resourceLocks.join(',')}`);
  }
}
const sourceReport = buildRecommendation([
  'js/core/map_renderer.js',
  'js/core/map_renderer/render_pass_cache_host_owner.js',
]);
const sourceCommands = sourceReport.recommendedCommands.map((entry) => entry.commandRef);
if (!sourceCommands.includes('verify:pages-dist-and-drift')) {
  throw new Error(`missing Pages dist source mirror route: ${sourceCommands.join(', ')}`);
}
for (const filePath of ['js/core/map_renderer.js', 'js/core/map_renderer/render_pass_cache_host_owner.js']) {
  if (sourceReport.unmatchedChangedFiles.includes(filePath)) {
    throw new Error(`Pages dist source mirror file should be matched: ${filePath}`);
  }
}
"""
        result = run_command("node", "--input-type=module", "-e", script)
        self.assert_command_ok(result)

    def test_shared_city_fixtures_pass_wait_timeout_as_playwright_option(self) -> None:
        script = """
const fixtures = require('./tests/e2e/support/fixtures.js');
const waitCalls = [];
const page = {
  waitForFunction(...args) {
    waitCalls.push(args);
    return Promise.resolve();
  },
  evaluate() {
    return Promise.resolve();
  },
};
(async () => {
  await fixtures.waitForSharedCityExactRender(page, { timeout: 45_000 });
  await fixtures.ensureSharedCityBaseDataLoaded(page, 'contract-shared-city', { timeout: 90_000 });
  const sawExactTimeout = waitCalls.some((args) => args.length === 3 && args[2]?.timeout === 45_000);
  const sawBaseDataTimeout = waitCalls.some((args) => args.length === 3 && args[2]?.timeout === 90_000);
  if (!sawExactTimeout) {
    throw new Error(`waitForSharedCityExactRender did not pass timeout as third argument: ${JSON.stringify(waitCalls)}`);
  }
  if (!sawBaseDataTimeout) {
    throw new Error(`ensureSharedCityBaseDataLoaded did not pass timeout as third argument: ${JSON.stringify(waitCalls)}`);
  }
})();
"""
        result = run_command("node", "-e", script)
        self.assert_command_ok(result)

    def test_shared_city_worker_fixture_has_dedicated_boot_timeout(self) -> None:
        source = (REPO_ROOT / "tests" / "e2e" / "support" / "fixtures.js").read_text(encoding="utf-8")
        fixture_start = source.index("sharedCityBootHarness:")
        fixture_end = source.index("\n  page: async", fixture_start)
        fixture_source = source[fixture_start:fixture_end]
        self.assertIn("const SHARED_CITY_BOOT_TIMEOUT_MS = 150_000;", source)
        self.assertIn('}, { scope: "worker", timeout: SHARED_CITY_BOOT_TIMEOUT_MS }]', fixture_source)
        self.assertIn("waitForAppInteractive(page, { timeout: 120_000 });", fixture_source)
        self.assertIn("waitForShellReady(page, { timeout: 120_000 });", fixture_source)

    def test_city_label_i18n_redraw_has_coherent_budget_and_cjk_sample(self) -> None:
        source = (REPO_ROOT / "tests" / "e2e" / "city_label_i18n_redraw.spec.js").read_text(encoding="utf-8")
        stable_wait_start = source.index("async function waitForStableExactRender")
        stable_wait_end = source.index("\n}\n", stable_wait_start)
        stable_wait_source = source[stable_wait_start:stable_wait_end]
        self.assertIn("test.setTimeout(240_000);", source)
        self.assertIn(r'const ZH_LABEL = "\u6d4b\u8bd5\u57ce";', source)
        self.assertIn("}, undefined, { timeout });", stable_wait_source)
        self.assertIn("async function clearCityLabelDrawLog(page)", source)
        self.assertIn("async function waitForLabelDraw(page, label)", source)
        self.assertIn("globalThis.__resetE2ECityLabelDraws?.();", source)
        self.assertIn("globalThis.__e2eCityLabelDraws", source)

    def test_shared_city_fixtures_restore_runtime_snapshots_on_reset(self) -> None:
        source = (REPO_ROOT / "tests" / "e2e" / "support" / "fixtures.js").read_text(encoding="utf-8")
        reset_call = """await resetSharedCityRuntimeState(page, {
      storageKeys,
      timeout: resetTimeout,
      requireInfraIdle: sharedCityRequireInfraIdle,
    });"""
        self.assertIn("captureSharedCityRuntimeSnapshot", source)
        self.assertIn("__sharedCityWorldCitiesSnapshot", source)
        self.assertIn("__sharedCityScenarioOverridesSnapshot", source)
        self.assertIn('state.worldCitiesData = cloneRuntimeValue(globalThis.__sharedCityWorldCitiesSnapshot);', source)
        self.assertIn('state.scenarioCityOverridesData = cloneRuntimeValue(globalThis.__sharedCityScenarioOverridesSnapshot);', source)
        self.assertIn("worldOverrideCount", source)
        self.assertIn("scenarioOverrideCount", source)
        self.assertIn("display-name overrides remained after reset", source)
        self.assertIn("const resetTimeout = Math.max(30_000, Number(testInfo.timeout) || 0);", source)
        self.assertIn(reset_call, source)

    def test_tno_land_feature_action_clock_wait_has_a_local_deadline(self) -> None:
        source = (REPO_ROOT / "tests" / "e2e" / "tno_open_ocean_rendering.spec.js").read_text(encoding="utf-8")
        self.assertIn("const actionAdvanceDeadline = performance.now() + 1000;", source)
        self.assertIn("performance.now() >= actionAdvanceDeadline", source)
        self.assertIn("Timed out waiting for the action clock to advance", source)

    def test_shared_city_fixture_captures_failure_context_before_reset_cleanup(self) -> None:
        source = (REPO_ROOT / "tests" / "e2e" / "support" / "fixtures.js").read_text(encoding="utf-8")
        reset_call = """await resetSharedCityRuntimeState(page, {
          storageKeys,
          timeout: resetTimeout,
          requireInfraIdle: sharedCityRequireInfraIdle,
        });"""
        failed_index = source.index("const failed = testInfo.status !== testInfo.expectedStatus;")
        snapshot_index = source.index("const failureSnapshot = await readFailureContextSnapshot(page, DEFAULT_FAILURE_SELECTORS);", failed_index)
        write_index = source.index("await writeFailureContextArtifact(testInfo, failureSnapshot);", snapshot_index)
        cleanup_index = source.index("await clearPageEventListeners(page);", write_index)
        reset_index = source.index(reset_call, cleanup_index)
        self.assertLess(failed_index, snapshot_index)
        self.assertLess(snapshot_index, write_index)
        self.assertLess(write_index, cleanup_index)
        self.assertLess(cleanup_index, reset_index)

    def test_verification_selector_routes_helper_workflow_and_dev_spec_changes(self) -> None:
        helper_explain = run_command("node", "tools/select_verification_targets.mjs", "explain", "tests/e2e/support/playwright-app.js")
        self.assert_command_ok(helper_explain)
        helper_payload = json.loads(helper_explain.stdout)
        self.assertEqual(helper_payload["mode"], "recommendation-fallback")
        helper_commands = [entry["commandRef"] for entry in helper_payload["recommendation"]["recommendedCommands"]]
        self.assertEqual(helper_commands[0], "python -m unittest tests.test_e2e_structural_tooling -q")
        self.assertIn("python -m unittest tests.test_e2e_structural_tooling -q", helper_commands)
        self.assertIn("node tools/e2e_layering.mjs run-spec tests/e2e/ui_contract_foundation.spec.js", helper_commands)

        fixtures_result = run_command("node", "tools/select_verification_targets.mjs", "tests/e2e/support/fixtures.js", "--json")
        self.assert_command_ok(fixtures_result)
        fixtures_payload = json.loads(fixtures_result.stdout)
        self.assertIn("python -m unittest tests.test_e2e_structural_tooling -q", [entry["commandRef"] for entry in fixtures_payload["recommendedCommands"]])

        reporter_result = run_command("node", "tools/select_verification_targets.mjs", "tests/e2e/support/reporters/failure-context-reporter.js", "--json")
        self.assert_command_ok(reporter_result)
        reporter_payload = json.loads(reporter_result.stdout)
        self.assertIn("python -m unittest tests.test_e2e_structural_tooling -q", [entry["commandRef"] for entry in reporter_payload["recommendedCommands"]])

        workflow_result = run_command("node", "tools/select_verification_targets.mjs", ".github/workflows/pr-verify.yml", "--json")
        self.assert_command_ok(workflow_result)
        workflow_payload = json.loads(workflow_result.stdout)
        workflow_commands = [entry["commandRef"] for entry in workflow_payload["recommendedCommands"]]
        self.assertIn("node tools/select_verification_targets.mjs --check", workflow_commands)
        self.assertIn("verify:test-import-graph", workflow_commands)
        self.assertIn("verify:architecture-boundaries", workflow_commands)

        dev_ready_result = run_command("node", "tools/select_verification_targets.mjs", "tests/e2e/dev/tno_ready_state_contract.dev.spec.js", "--json")
        self.assert_command_ok(dev_ready_result)
        dev_ready_payload = json.loads(dev_ready_result.stdout)
        self.assertIn("test:e2e:dev:tno-ready-state", [entry["commandRef"] for entry in dev_ready_payload["recommendedCommands"]])

        dev_chunk_result = run_command("node", "tools/select_verification_targets.mjs", "tests/e2e/dev/scenario_chunk_exact_after_settle_regression.dev.spec.js", "--json")
        self.assert_command_ok(dev_chunk_result)
        dev_chunk_payload = json.loads(dev_chunk_result.stdout)
        self.assertIn("test:e2e:dev:scenario-chunk-runtime", [entry["commandRef"] for entry in dev_chunk_payload["recommendedCommands"]])

        release_helper_result = run_command("node", "tools/select_verification_targets.mjs", "tests/e2e/support/release-smoke.js", "--json")
        self.assert_command_ok(release_helper_result)
        release_helper_payload = json.loads(release_helper_result.stdout)
        release_helper_commands = [entry["commandRef"] for entry in release_helper_payload["recommendedCommands"]]
        self.assertIn("test:node:release-smoke-helper", release_helper_commands)
        self.assertIn("test:e2e:pages-public-release-gate", release_helper_commands)

        release_spec_result = run_command("node", "tools/select_verification_targets.mjs", "tests/e2e/release/pages_public_release_gate.spec.js", "--json")
        self.assert_command_ok(release_spec_result)
        release_spec_payload = json.loads(release_spec_result.stdout)
        release_spec_commands = [entry["commandRef"] for entry in release_spec_payload["recommendedCommands"]]
        self.assertIn("test:e2e:pages-public-release-gate", release_spec_commands)

        release_node_result = run_command("node", "tools/select_verification_targets.mjs", "tests/release_smoke_retry_behavior.node.test.mjs", "--json")
        self.assert_command_ok(release_node_result)
        release_node_payload = json.loads(release_node_result.stdout)
        release_node_commands = [entry["commandRef"] for entry in release_node_payload["recommendedCommands"]]
        self.assertIn("test:node:release-smoke-helper", release_node_commands)

        unknown_result = run_command("node", "tools/select_verification_targets.mjs", "explain", "docs/unknown-route-sentinel.txt")
        self.assertNotEqual(unknown_result.returncode, 0)
        self.assertIn("No route found", f"{unknown_result.stdout}\n{unknown_result.stderr}")

    def test_verification_selector_routes_package_metadata_to_dev_scripts_and_guardrails(self) -> None:
        for package_path in ("package.json", "package-lock.json"):
            package_result = run_command("node", "tools/select_verification_targets.mjs", package_path, "--json")
            self.assert_command_ok(package_result)
            package_payload = json.loads(package_result.stdout)
            package_commands = [entry["commandRef"] for entry in package_payload["recommendedCommands"]]
            self.assertIn("test:e2e:dev:tno-ready-state", package_commands)
            self.assertIn("test:e2e:dev:scenario-chunk-runtime", package_commands)
            self.assertIn("verify:test-timeout-inventory", package_commands)
            self.assertIn("verify:test-console-allowlist", package_commands)
            self.assertIn("verify:test-timeout-guardrails", package_commands)
            self.assertIn("verify:architecture-boundaries", package_commands)
            self.assertIn("verify:perf-gate-contract", package_commands)

    def test_verify_shared_builds_selector_artifact_before_selected_execution(self) -> None:
        workflow = (REPO_ROOT / ".github" / "workflows" / "verify-shared.yml").read_text(encoding="utf-8")
        selector_explain_index = workflow.index("node tools/select_verification_targets.mjs --changed-files-list")
        adaptive_runner_index = workflow.index("node tools/run_adaptive_tests.mjs")
        self.assertLess(selector_explain_index, adaptive_runner_index)
        self.assertIn("id: selector", workflow)
        self.assertIn("if: always() && inputs.profile == 'pr-fast' && steps.selector.outcome != 'skipped'", workflow)
        self.assertNotIn("npm run verify:test-import-graph", workflow)
        self.assertNotIn("npm run verify:architecture-boundaries", workflow)
        self.assertNotIn("npm run verify:test-timeout-inventory", workflow)
        self.assertIn(".runtime/reports/generated/test-import-graph.json", workflow)
        self.assertIn(".runtime/tmp/verification-selector-changed-files.txt", workflow)

        changed_files_path = self.tmp_root / "verification-selector-changed-files.txt"
        selector_json_path = self.tmp_root / "verification-selector-explain.json"
        selector_md_path = self.tmp_root / "verification-selector-explain.md"
        adaptive_json_path = self.tmp_root / "verification-selector-execution.json"
        adaptive_md_path = self.tmp_root / "verification-selector-execution.md"
        adaptive_profile_path = self.tmp_root / "verification-selector-execution-profile.json"
        changed_files_path.write_text(".github/workflows/verify-shared.yml\n", encoding="utf-8")
        selector_result = run_command(
            "node",
            "tools/select_verification_targets.mjs",
            "--changed-files-list",
            str(changed_files_path),
            "--json-out",
            str(selector_json_path),
            "--md-out",
            str(selector_md_path),
        )
        self.assert_command_ok(selector_result)
        selector_payload = json.loads(selector_json_path.read_text(encoding="utf-8"))
        route_authority_commands = [entry["commandRef"] for entry in selector_payload["routeAuthority"]]
        self.assertGreater(len(route_authority_commands), 0)
        self.assertEqual(route_authority_commands, sorted(set(route_authority_commands)))
        self.assertIn("python tools/check_min_ci_requirements.py", route_authority_commands)
        self.assertIn("python tools/check_heavy_test_classification.py", route_authority_commands)
        self.assertTrue(selector_payload["catalogDigest"])
        self.assertTrue(selector_payload["catalogSourceIdentity"]["digest"])
        self.assertEqual(
            selector_payload["selectorRootSet"],
            sorted(entry["commandRef"] for entry in selector_payload["recommendedCommands"]),
        )

        adaptive_result = run_command(
            "node",
            "tools/run_adaptive_tests.mjs",
            "--changed-files-list",
            str(changed_files_path),
            "--selection-json",
            str(selector_json_path),
            "--defer-main-thread",
            "--json-out",
            str(adaptive_json_path),
            "--md-out",
            str(adaptive_md_path),
            "--profile-out",
            str(adaptive_profile_path),
        )
        self.assert_command_ok(adaptive_result)
        adaptive_payload = json.loads(adaptive_json_path.read_text(encoding="utf-8"))
        self.assertEqual(adaptive_payload["selectionArtifact"], str(selector_json_path))
        self.assertEqual(adaptive_payload["catalogDigest"], selector_payload["catalogDigest"])
        self.assertEqual(adaptive_payload["catalogSourceIdentity"], selector_payload["catalogSourceIdentity"])
        self.assertEqual(adaptive_payload["selectorRootSet"], selector_payload["selectorRootSet"])
        self.assertEqual(adaptive_payload["executionPlan"]["routeGaps"], [])
        self.assertGreater(len(adaptive_payload["executionPlan"]["executionGroups"]), 0)

    def test_verify_shared_pr_fast_runner_executes_the_adaptive_child_safe_plan(self) -> None:
        workflow = (REPO_ROOT / ".github" / "workflows" / "verify-shared.yml").read_text(encoding="utf-8")
        self.assertNotIn("- name: Run Python fast contracts", workflow)
        self.assertIn("node tools/run_adaptive_tests.mjs", workflow)
        self.assertIn("--changed-files-list .runtime/tmp/verification-selector-changed-files.txt", workflow)
        self.assertIn("--selection-json .runtime/reports/generated/verification-selector-explain.json", workflow)
        self.assertIn("--execute", workflow)
        self.assertIn("--defer-main-thread", workflow)
        self.assertIn("--profile-out .runtime/reports/generated/verification-selector-execution.profile.json", workflow)
        self.assertIn("verification-selector-execution.json", workflow)
        self.assertIn(".runtime/reports/generated/verification-selector-execution.*", workflow)
        self.assertIn('test -s "$changed_files"', workflow)
        self.assertNotIn("npm run verify:script-portfolio", workflow)
        self.assertNotIn("name.startsWith('test:node:')", workflow)
        self.assertNotIn("spawnSync('npm', ['run', name]", workflow)

    def test_pr_required_dag_consumes_the_canonical_golden_demo_profile(self) -> None:
        shared_workflow = (REPO_ROOT / ".github" / "workflows" / "verify-shared.yml").read_text(encoding="utf-8")
        pr_workflow = (REPO_ROOT / ".github" / "workflows" / "pr-verify.yml").read_text(encoding="utf-8")
        jobs = parse_required_pr_workflow_jobs(pr_workflow)

        self.assertIsNone(parse_job_scalar(jobs["pr-verify-fast"], "needs"))
        self.assertIsNone(parse_job_scalar(jobs["pr-verify-smoke"], "needs"))
        self.assertEqual(parse_job_scalar(jobs["pr-verify-smoke"], "uses"), "./.github/workflows/verify-shared.yml")
        self.assertRegex(jobs["pr-verify-smoke"], r"(?m)^      profile: pr-smoke$")
        self.assertRegex(jobs["pr-verify-smoke"], r"(?m)^      run-golden-demo: true$")

        required_job = jobs["pr-verify-required"]
        self.assertEqual(parse_job_scalar(required_job, "name"), "PR Verify Required")
        self.assertEqual(parse_job_scalar(required_job, "if"), "always()")
        self.assertEqual(
            parse_job_scalar(required_job, "needs"),
            ["pr-verify-fast", "pr-verify-smoke"],
        )
        self.assertEqual(parse_job_scalar(required_job, "runs-on"), "ubuntu-latest")
        self.assertIsNone(parse_job_scalar(required_job, "uses"))
        self.assertEqual(len(re.findall(r"(?m)^      - ", required_job)), 1)
        self.assertNotRegex(required_job, r"(?m)^        uses:")
        self.assertEqual(required_job.count("        run: |"), 1)
        self.assertIn("REQUIRED_RESULTS: ${{ toJSON(needs) }}", required_job)
        aggregator_script = extract_required_aggregator_script(required_job)
        self.assertNotRegex(aggregator_script, r"\b(?:exec|execFile|fork|spawn|require)\s*\(")

        demo_node_condition = "inputs.profile == 'full' || inputs.profile == 'pr-fast' || inputs.profile == 'pr-smoke' || inputs.profile == 'demo'"
        demo_browser_condition = "(inputs.profile == 'full' && inputs.run-e2e-smoke) || inputs.profile == 'pr-smoke' || inputs.profile == 'demo'"
        self.assertGreaterEqual(shared_workflow.count(demo_node_condition), 2)
        self.assertGreaterEqual(shared_workflow.count(demo_browser_condition), 2)
        self.assertIn("- name: Run Golden Demo E2E\n        if: inputs.profile == 'demo' || inputs.run-golden-demo\n        run: npm run verify:demo", shared_workflow)
        self.assertIn("run-golden-demo requires the pr-smoke profile", shared_workflow)
        demo_spec = (REPO_ROOT / "tests/e2e/sample_guide_deeplink.spec.js").read_text(encoding="utf-8")
        self.assertEqual(demo_spec.count("@golden-demo"), 1)
        self.assertIn("name: demo-timing-and-failure-context", shared_workflow)
        self.assertIn(".runtime/reports/generated/test-timings-summary.json", shared_workflow)
        self.assertIn(".runtime/tests/playwright/**/failure-context.json", shared_workflow)

    def test_workflow_job_parser_accepts_the_complete_unquoted_job_id_syntax(self) -> None:
        workflow = """name: parser-contract
jobs:
  _Gate:
    runs-on: ubuntu-latest
  SecurityScan:
    runs-on: ubuntu-latest
  security_scan:
    runs-on: ubuntu-latest
  security-scan2:
    runs-on: ubuntu-latest
"""

        self.assertEqual(
            list(parse_workflow_job_blocks(workflow)),
            ["_Gate", "SecurityScan", "security_scan", "security-scan2"],
        )

    def test_workflow_job_parser_fails_closed_for_unparsed_quoted_and_duplicate_headers(self) -> None:
        cases = {
            "unparsed": (
                "  security.scan:\n    runs-on: ubuntu-latest\n",
                "unparseable job header",
            ),
            "quoted": (
                '  "security_scan":\n    runs-on: ubuntu-latest\n',
                "quoted job header",
            ),
            "duplicate": (
                "  security_scan:\n    runs-on: ubuntu-latest\n"
                "  security_scan:\n    runs-on: ubuntu-latest\n",
                "duplicate job id",
            ),
        }

        for name, (jobs_section, expected_error) in cases.items():
            with self.subTest(name=name):
                with self.assertRaisesRegex(AssertionError, expected_error):
                    parse_workflow_job_blocks(f"name: parser-contract\njobs:\n{jobs_section}")

    def test_pr_required_exact_job_set_detects_uppercase_and_underscore_additions(self) -> None:
        workflow = (REPO_ROOT / ".github" / "workflows" / "pr-verify.yml").read_text(encoding="utf-8")

        for extra_job in ("security_scan", "SecurityScan"):
            with self.subTest(extra_job=extra_job):
                changed_workflow = workflow.replace(
                    "  pr-verify-required:\n",
                    f"  {extra_job}:\n    runs-on: ubuntu-latest\n\n  pr-verify-required:\n",
                )
                with self.assertRaisesRegex(AssertionError, "workflow job set mismatch"):
                    parse_required_pr_workflow_jobs(changed_workflow)

    def test_pr_required_aggregator_fails_closed_for_every_dependency_result_matrix(self) -> None:
        workflow = (REPO_ROOT / ".github" / "workflows" / "pr-verify.yml").read_text(encoding="utf-8")
        required_job = parse_workflow_job_blocks(workflow)["pr-verify-required"]
        script = extract_required_aggregator_script(required_job)
        job_names = ["pr-verify-fast", "pr-verify-smoke"]
        result_states = ["success", "failure", "cancelled", "skipped"]

        for result_matrix in itertools.product(result_states, repeat=len(job_names)):
            with self.subTest(results=result_matrix):
                needs = {
                    job: {"result": result, "outputs": {}}
                    for job, result in zip(job_names, result_matrix, strict=True)
                }
                completed = run_command(
                    "node",
                    "-e",
                    script,
                    env={"REQUIRED_RESULTS": json.dumps(needs)},
                )
                should_pass = all(result == "success" for result in result_matrix)
                self.assertEqual(completed.returncode == 0, should_pass, completed.stdout + completed.stderr)

    def test_pr_required_aggregator_rejects_dependency_set_drift(self) -> None:
        workflow = (REPO_ROOT / ".github" / "workflows" / "pr-verify.yml").read_text(encoding="utf-8")
        required_job = parse_workflow_job_blocks(workflow)["pr-verify-required"]
        script = extract_required_aggregator_script(required_job)
        valid_needs = {
            job: {"result": "success", "outputs": {}}
            for job in ("pr-verify-fast", "pr-verify-smoke")
        }
        cases = {
            "missing": json.dumps({job: result for job, result in valid_needs.items() if job != "pr-verify-smoke"}),
            "extra": json.dumps({**valid_needs, "SecurityScan": {"result": "success", "outputs": {}}}),
            "unknown-result": json.dumps({
                **valid_needs,
                "pr-verify-smoke": {"result": "timed_out", "outputs": {}},
            }),
            "malformed-json": "{",
        }

        for name, required_results in cases.items():
            with self.subTest(name=name):
                completed = run_command(
                    "node",
                    "-e",
                    script,
                    env={"REQUIRED_RESULTS": required_results},
                )
                self.assertNotEqual(completed.returncode, 0, completed.stdout + completed.stderr)

    def test_pr_pages_mirrors_cover_runtime_without_rebuilding_unrelated_edits(self) -> None:
        workflow = (REPO_ROOT / ".github" / "workflows" / "verify-shared.yml").read_text(encoding="utf-8")
        step = next(step for step in parse_job_steps(parse_workflow_job_blocks(workflow)["verify"])
                    if step.get("name") == "Check tracked Pages mirrors for relevant PR changes")
        body = "\n".join(str(line) for line in step["lines"])
        self.assertIn("if: inputs.profile == 'pr-fast'", body)
        pattern = re.search(r"grep -Eq '([^']+)'", body).group(1)
        for changed in ["js/core/renderer/render_cache_owner.js", "tools/build_pages_dist.py",
                        "dist/app/js/core/history_manager.js", "data/scenarios/index.json"]:
            self.assertRegex(changed, pattern)
        for changed in ["docs/notes.md", "tests/history_feature_color_refresh_behavior.test.mjs"]:
            self.assertNotRegex(changed, pattern)
        self.assertIn("python tools/build_pages_dist.py", body)
        self.assertIn("git diff --exit-code --", body)
        self.assertIn("dist/pages-dist-manifest.json", body)
        self.assertIn("exit 1", body)

    def test_verify_shared_rejects_unknown_profiles_before_profile_steps(self) -> None:
        workflow = (REPO_ROOT / ".github" / "workflows" / "verify-shared.yml").read_text(encoding="utf-8")
        validation_index = workflow.index("- name: Validate verification profile")
        setup_python_index = workflow.index("- name: Setup Python")
        self.assertLess(validation_index, setup_python_index)
        self.assertIn("full|pr-fast|pr-smoke|demo|deploy-minimal", workflow)
        self.assertIn("unknown verification profile", workflow)
        self.assertIn("exit 2", workflow[validation_index:setup_python_index])

    def test_verify_shared_keeps_two_checkout_commits_for_non_pr_fast_history(self) -> None:
        workflow = (REPO_ROOT / ".github" / "workflows" / "verify-shared.yml").read_text(encoding="utf-8")
        verify_job = parse_workflow_job_blocks(workflow)["verify"]
        checkout = next(step for step in parse_job_steps(verify_job) if step.get("name") == "Checkout")
        checkout_body = "\n".join(str(line) for line in checkout["lines"])

        self.assertIn("fetch-depth: 2", checkout_body)
        self.assertIn("git diff --name-only HEAD^ HEAD", verify_job)

    def test_deploy_minimal_installs_locked_node_dependencies_before_pages_build(self) -> None:
        workflow = (REPO_ROOT / ".github" / "workflows" / "verify-shared.yml").read_text(encoding="utf-8")
        setup_node_index = workflow.index("- name: Setup Node")
        dependency_guard_index = workflow.index("- name: Check deploy-minimal dependency guardrails")
        install_node_index = workflow.index("- name: Install Node dependencies")
        build_pages_index = workflow.index("- name: Build Pages dist")
        setup_node_step = workflow[setup_node_index:install_node_index]
        install_node_step = workflow[install_node_index:build_pages_index]
        dependency_guard_step = workflow[dependency_guard_index:install_node_index]

        self.assertIn("inputs.profile == 'deploy-minimal'", setup_node_step)
        self.assertIn("inputs.profile == 'deploy-minimal'", dependency_guard_step)
        self.assertIn("run: python tools/check_min_ci_requirements.py", dependency_guard_step)
        self.assertIn("inputs.profile == 'deploy-minimal'", install_node_step)
        self.assertIn("run: npm ci", install_node_step)
        self.assertLess(setup_node_index, install_node_index)
        self.assertLess(install_node_index, build_pages_index)

        route_result = run_command(
            "node",
            "tools/select_verification_targets.mjs",
            "tools/check_min_ci_requirements.py",
            "--json",
        )
        self.assert_command_ok(route_result)
        route_payload = json.loads(route_result.stdout)
        commands = [entry["commandRef"] for entry in route_payload["recommendedCommands"]]
        self.assertIn("python tools/check_min_ci_requirements.py", commands)

    def test_pr_browser_profiles_install_backend_python_dependencies(self) -> None:
        workflow = (REPO_ROOT / ".github" / "workflows" / "verify-shared.yml").read_text(encoding="utf-8")
        download_index = workflow.index("- name: Download Python wheel cache")
        install_index = workflow.index("- name: Install Python test dependencies")
        guard_index = workflow.index("- name: Check deploy-minimal dependency guardrails")
        download_step = workflow[download_index:install_index]
        install_step = workflow[install_index:guard_index]

        self.assertNotIn("\n        if:", download_step)
        self.assertNotIn("\n        if:", install_step)
        self.assertIn("requirements-dev.lock.txt", download_step)
        self.assertIn("requirements-dev.lock.txt", install_step)

    def test_nightly_uses_platform_shards_exact_p4_evidence_and_final_aggregator(self) -> None:
        workflow = (REPO_ROOT / ".github" / "workflows" / "nightly-verification.yml").read_text(encoding="utf-8")
        jobs = parse_workflow_job_blocks(workflow)
        expected_jobs = {
            "metadata",
            "p4-checker-boundaries",
            "p4-full-policy",
            "p4-fast",
            "p4-closeout",
            "linux-core",
            "pages",
            "pages-artifact-shadow",
            "browser",
            "scenario-heavy",
            "windows-governance",
            "final",
        }
        self.assertEqual(set(jobs), expected_jobs)
        self.assertIn("schedule:", workflow)
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("concurrency:", workflow)
        self.assertNotRegex(workflow, r"npm run verify:nightly(?:\s|$)")
        self.assertNotIn("npm run verify:p4:p4-3", workflow)
        self.assertNotIn("npm run verify:p4:state-writer-policy", workflow)
        self.assertNotIn("npm run perf:williams-crossover:run", workflow)
        self.assertNotRegex(workflow, r"--retries(?:=|\s)[1-9]")
        self.assertIn("fail-fast: false", jobs["linux-core"])
        self.assertIn("shard: [1, 2, 3]", jobs["linux-core"])
        self.assertEqual(parse_job_scalar(jobs["linux-core"], "runs-on"), "ubuntu-latest")
        self.assertEqual(parse_job_scalar(jobs["p4-checker-boundaries"], "runs-on"), "windows-latest")
        self.assertEqual(parse_job_scalar(jobs["p4-full-policy"], "runs-on"), "windows-latest")
        self.assertEqual(parse_job_scalar(jobs["p4-fast"], "runs-on"), "ubuntu-latest")
        self.assertEqual(parse_job_scalar(jobs["windows-governance"], "runs-on"), "windows-latest")
        self.assertEqual(parse_job_scalar(jobs["p4-closeout"], "needs"), [
            "p4-checker-boundaries", "p4-full-policy", "p4-fast",
        ])
        closeout_steps = parse_job_steps(jobs["p4-closeout"])
        closeout_run = parse_step_run(next(
            step for step in closeout_steps
            if step.get("name") == "Validate exact three-authority P4 closeout"
        ))
        self.assertIn('EVIDENCE_ID=$(node -p "require(', closeout_run)
        self.assertIn('echo "evidence_id=$EVIDENCE_ID" >> "$GITHUB_OUTPUT"', closeout_run)
        self.assertNotIn('echo "evidence_id=$(node -p', closeout_run)
        self.assertIsNone(parse_job_scalar(jobs["linux-core"], "needs"))
        self.assertIsNone(parse_job_scalar(jobs["pages"], "needs"))
        self.assertIsNone(parse_job_scalar(jobs["pages-artifact-shadow"], "needs"))
        self.assertIsNone(parse_job_scalar(jobs["scenario-heavy"], "needs"))
        scenario_heavy_steps = parse_job_steps(jobs["scenario-heavy"])
        scenario_heavy_by_name = {str(step["name"]): step for step in scenario_heavy_steps}
        self.assertEqual(
            parse_step_run(scenario_heavy_by_name["Run canonical Nightly scenario heavy routes"]),
            "node tools/run_core_verification.mjs --nightly-scenario-heavy "
            "--json-out .runtime/reports/generated/nightly/scenario-heavy.json "
            "--md-out .runtime/reports/generated/nightly/scenario-heavy.md "
            "--profile-out .runtime/reports/generated/nightly/scenario-heavy-profile.json",
        )
        self.assertNotIn("unittest discover", jobs["scenario-heavy"])

        artifact_counts = {
            "nightly-p4-checker-boundaries-${{ github.sha }}-${{ github.run_attempt }}": 2,
            "nightly-p4-full-policy-${{ github.sha }}-${{ github.run_attempt }}": 2,
            "nightly-p4-fast-${{ github.sha }}-${{ github.run_attempt }}": 2,
            "nightly-p4-closeout-${{ github.sha }}-${{ github.run_attempt }}": 1,
        }
        for artifact_name, expected_count in artifact_counts.items():
            self.assertEqual(workflow.count(f"name: {artifact_name}"), expected_count)

        closeout_run = parse_step_run(next(
            step for step in parse_job_steps(jobs["p4-closeout"])
            if step.get("name") == "Validate exact three-authority P4 closeout"
        ))
        self.assertEqual(closeout_run.count("--authority "), 3)
        self.assertIn("--expected-sha \"${{ github.sha }}\"", closeout_run)
        self.assertIn("git rev-parse 'HEAD^{tree}'", closeout_run)
        self.assertNotIn("select_verification_targets", closeout_run)
        self.assertNotIn("run_core_verification", closeout_run)

        for job_id in ("linux-core", "scenario-heavy"):
            env = parse_job_env(jobs[job_id])
            self.assertEqual(set(env), {"WHEELHOUSE_DIR"})
            names = [str(step["name"]) for step in parse_job_steps(jobs[job_id])]
            self.assertNotIn("Download P4 closeout", names)
            self.assertNotIn("Download exact P4 producer evidence", names)
            self.assertNotIn("Validate exact P4 producer evidence", names)

        pages_steps = parse_job_steps(jobs["pages"])
        pages_by_name = {str(step["name"]): step for step in pages_steps}
        self.assertEqual(
            parse_step_run(pages_by_name["Run Pages dist and drift verification"]),
            "npm run verify:pages-dist-and-drift",
        )
        pages_shadow_steps = parse_job_steps(jobs["pages-artifact-shadow"])
        pages_shadow_by_name = {str(step["name"]): step for step in pages_shadow_steps}
        self.assertEqual(
            [str(step["name"]) for step in pages_shadow_steps],
            [
                "Checkout",
                "Setup Python",
                "Setup Node",
                "Install Node dependencies",
                "Install Chromium",
                "Build artifact-only Pages shadow dist",
                "Build legacy tracked Pages reference",
                "Verify artifact-only Pages shadow",
                "Start artifact-only Pages shadow server",
                "Smoke artifact-only Pages shadow",
                "Record artifact-only Pages shadow receipt",
                "Upload artifact-only Pages shadow",
            ],
        )
        self.assertEqual(parse_job_env(jobs["pages-artifact-shadow"]), {
            "PLAYWRIGHT_BROWSERS_PATH": ".runtime/browser/ms-playwright",
        })
        self.assertNotIn("Install Python test dependencies", pages_shadow_by_name)
        self.assertEqual(
            parse_step_run(pages_shadow_by_name["Install Node dependencies"]),
            "npm ci",
        )
        self.assertEqual(
            parse_step_run(pages_shadow_by_name["Install Chromium"]),
            "npx playwright install --with-deps chromium",
        )
        self.assertEqual(
            parse_step_run(pages_shadow_by_name["Build artifact-only Pages shadow dist"]),
            "python tools/build_pages_dist.py --output-root .runtime/pages-artifact-shadow/dist",
        )
        self.assertEqual(
            parse_step_run(pages_shadow_by_name["Build legacy tracked Pages reference"]),
            "python tools/build_pages_dist.py",
        )
        self.assertEqual(
            parse_step_run(pages_shadow_by_name["Verify artifact-only Pages shadow"]),
            "python tools/pages_artifact_shadow.py verify --artifact-root .runtime/pages-artifact-shadow/dist "
            "--run-id github-${{ github.run_id }}-${{ github.run_attempt }} "
            "--comparison-out .runtime/reports/generated/nightly/pages-artifact-shadow-comparison.json",
        )
        shadow_server_run = parse_step_run(pages_shadow_by_name["Start artifact-only Pages shadow server"])
        self.assertIn("python -m http.server 4173 --bind 127.0.0.1 --directory .runtime/pages-artifact-shadow/dist", shadow_server_run)
        self.assertIn("curl --fail --silent --show-error http://127.0.0.1:4173/", shadow_server_run)
        self.assertEqual(
            parse_step_run(pages_shadow_by_name["Smoke artifact-only Pages shadow"]),
            "npm run test:e2e:pages-public-release-gate",
        )
        pages_shadow_smoke = "\n".join(str(line) for line in pages_shadow_by_name["Smoke artifact-only Pages shadow"]["lines"])
        self.assertIn("SCENARIO_FORGE_PAGES_URL: http://127.0.0.1:4173/", pages_shadow_smoke)
        self.assertIn("PLAYWRIGHT_TEST_BASE_URL: http://127.0.0.1:4173/", pages_shadow_smoke)
        self.assertNotIn("continue-on-error: true", pages_shadow_smoke)
        pages_shadow_names = [str(step["name"]) for step in pages_shadow_steps]
        receipt_index = pages_shadow_names.index("Record artifact-only Pages shadow receipt")
        smoke_index = pages_shadow_names.index("Smoke artifact-only Pages shadow")
        self.assertLess(smoke_index, receipt_index)
        receipt_prefix = "\n".join(pages_shadow_names[:receipt_index])
        self.assertNotIn("--public-smoke passed", receipt_prefix)
        self.assertEqual(
            parse_step_run(pages_shadow_by_name["Record artifact-only Pages shadow receipt"]),
            "python tools/pages_artifact_shadow.py receipt --comparison "
            ".runtime/reports/generated/nightly/pages-artifact-shadow-comparison.json "
            "--public-smoke passed --out .runtime/reports/generated/nightly/pages-artifact-shadow.json",
        )
        pages_shadow_upload = "\n".join(str(line) for line in pages_shadow_by_name["Upload artifact-only Pages shadow"]["lines"])
        self.assertIn("name: nightly-pages-artifact-shadow-${{ github.sha }}-${{ github.run_attempt }}", pages_shadow_upload)
        self.assertIn(".runtime/pages-artifact-shadow/dist", pages_shadow_upload)
        self.assertIn("pages-artifact-shadow-comparison.json", pages_shadow_upload)
        self.assertIn("pages-artifact-shadow.json", pages_shadow_upload)
        self.assertIn("if-no-files-found: error", pages_shadow_upload)
        self.assertIn("include-hidden-files: true", pages_shadow_upload)
        self.assertNotIn("dist/**", pages_shadow_upload)

        browser_steps = parse_job_steps(jobs["browser"])
        browser_by_name = {str(step["name"]): step for step in browser_steps}
        browser_upload = "\n".join(str(line) for line in browser_by_name["Upload Nightly browser evidence"]["lines"])
        self.assertNotIn(".runtime/browser/**", browser_upload)
        self.assertNotIn("ms-playwright", browser_upload)
        self.assertIn(".runtime/reports/**", browser_upload)
        self.assertIn(".runtime/tests/**", browser_upload)

        for job_id in ("metadata", "linux-core", "pages", "pages-artifact-shadow", "browser", "scenario-heavy"):
            checkout = next(step for step in parse_job_steps(jobs[job_id]) if step.get("name") == "Checkout")
            checkout_body = "\n".join(str(line) for line in checkout["lines"])
            self.assertIn("fetch-depth: 1", checkout_body, job_id)
        for job_id in ("p4-checker-boundaries", "p4-full-policy", "p4-fast", "p4-closeout", "windows-governance"):
            checkout = next(step for step in parse_job_steps(jobs[job_id]) if step.get("name") == "Checkout")
            checkout_body = "\n".join(str(line) for line in checkout["lines"])
            self.assertIn("fetch-depth: 0", checkout_body, job_id)

        linux_core_run = parse_step_run(next(
            step for step in parse_job_steps(jobs["linux-core"])
            if step.get("name") == "Run balanced Linux core shard"
        ))
        self.assertNotIn("pages-dist", linux_core_run)
        self.assertNotIn("p4-", linux_core_run)

        windows_commands = {
            parse_step_run(step)
            for step in parse_job_steps(jobs["windows-governance"])
            if str(step["name"]).startswith("Run ")
        }
        self.assertEqual(windows_commands, {
            "npm run test:node:williams-crossover-governance",
            "npm run test:node:williams-crossover-job-runner",
            "npm run test:node:windows-job-runtime",
            "npm run test:node:windows-job-runtime:integration",
            "npm run perf:williams-power-scheme:live-preflight",
            "npm run test:node:williams-crossover-telemetry-live",
        })
        self.assertIn("group: scenario-forge-system-power-scheme", jobs["windows-governance"])
        self.assertIn("cancel-in-progress: false", jobs["windows-governance"])

        final_steps = parse_job_steps(jobs["final"])
        self.assertEqual([str(step["name"]) for step in final_steps], ["Summarize Nightly shard results"])
        self.assertEqual(parse_job_scalar(jobs["final"], "needs"), [
            "metadata",
            "linux-core",
            "pages",
            "pages-artifact-shadow",
            "browser",
            "scenario-heavy",
            "p4-closeout",
            "windows-governance",
        ])
        aggregator = extract_required_aggregator_script(jobs["final"])
        required_results = {
            job: {"result": "success", "outputs": {}}
            for job in parse_job_scalar(jobs["final"], "needs")
        }
        completed = run_command(
            "node",
            "-e",
            aggregator,
            env={"REQUIRED_RESULTS": json.dumps(required_results)},
        )
        self.assert_command_ok(completed)
        required_results["p4-closeout"]["result"] = "failure"
        rejected = run_command(
            "node",
            "-e",
            aggregator,
            env={"REQUIRED_RESULTS": json.dumps(required_results)},
        )
        self.assertNotEqual(rejected.returncode, 0)

        route_result = run_command(
            "node",
            "tools/select_verification_targets.mjs",
            ".github/workflows/nightly-verification.yml",
            "--json",
        )
        self.assert_command_ok(route_result)
        route_payload = json.loads(route_result.stdout)
        self.assertEqual(route_payload["unmatchedChangedFiles"], [])
        commands = [entry["commandRef"] for entry in route_payload["recommendedCommands"]]
        self.assertIn(
            "node --test tests/p4_nightly_parallel_authorities_behavior.test.mjs "
            "tests/p4_nightly_exact_repair_behavior.test.mjs",
            commands,
        )
        self.assertIn("verify:script-portfolio", commands)
        self.assertIn("node tools/select_verification_targets.mjs --check", commands)

    def test_p4_nightly_selective_repair_reuses_only_exact_prior_receipts(self) -> None:
        workflow = (
            REPO_ROOT / ".github" / "workflows" / "p4-nightly-selective-repair.yml"
        ).read_text(encoding="utf-8")
        validate_p4_nightly_selective_repair_workflow(workflow)

        route_result = run_command(
            "node",
            "tools/select_verification_targets.mjs",
            ".github/workflows/p4-nightly-selective-repair.yml",
            "--json",
        )
        self.assert_command_ok(route_result)
        route_payload = json.loads(route_result.stdout)
        self.assertEqual(route_payload["unmatchedChangedFiles"], [])
        commands = [entry["commandRef"] for entry in route_payload["recommendedCommands"]]
        self.assertIn(
            "node --test tests/p4_nightly_parallel_authorities_behavior.test.mjs "
            "tests/p4_nightly_exact_repair_behavior.test.mjs",
            commands,
        )

    def test_p4_nightly_selective_repair_rejects_structural_fail_open_mutations(self) -> None:
        workflow = (
            REPO_ROOT / ".github" / "workflows" / "p4-nightly-selective-repair.yml"
        ).read_text(encoding="utf-8")
        mutations = {
            "plan downloads future artifact": workflow.replace(
                "      - name: Fetch exact source run metadata",
                "      - name: Download future repair plan\n"
                "        uses: actions/download-artifact@forged\n"
                "      - name: Fetch exact source run metadata",
                1,
            ),
            "reuse omits repair plan download": workflow.replace(
                "      - name: Download exact repair plan",
                "      - name: Repair plan download removed",
                1,
            ),
            "missing prior run binding": workflow.replace(
                "run-id: ${{ inputs.source_run_id }}",
                "run-id: ${{ github.run_id }}",
                1,
            ),
            "missing reused plan binding": workflow.replace(
                "--repair-plan .runtime/repair/plan/p4-repair-plan.json",
                "--repair-plan-removed .runtime/repair/plan/p4-repair-plan.json",
                1,
            ),
            "unconditional execute": workflow.replace(
                "if: needs.plan.outputs.execute_count != '0'",
                "if: always()",
                1,
            ),
            "missing executed origin binding": workflow.replace(
                '--role "${{ matrix.role }}"',
                '--role "checker-boundaries"',
                1,
            ),
            "missing resolved closeout input": workflow.replace(
                "--resolved-authority .runtime/repair/authorities/checker/nightly/p4-checker-boundaries.resolved.json",
                "--resolved-authority-removed .runtime/repair/authorities/checker/nightly/p4-checker-boundaries.resolved.json",
                1,
            ),
            "live checker install": workflow.replace(
                "python -m pip install --no-index --find-links $env:WHEELHOUSE_DIR -r requirements-dev.lock.txt",
                "python -m pip install -r requirements-dev.lock.txt",
                1,
            ),
            "full nightly expansion": workflow + "\n# verify:nightly\n",
        }
        for label, mutated in mutations.items():
            with self.subTest(label=label):
                with self.assertRaises(AssertionError):
                    validate_p4_nightly_selective_repair_workflow(mutated)

    def test_release_consumer_calls_one_canonical_command(self) -> None:
        filename = "release-verification.yml"
        workflow = (REPO_ROOT / ".github" / "workflows" / filename).read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("concurrency:", workflow)
        self.assertIn("timeout-minutes: 120", workflow)
        job = parse_workflow_job_blocks(workflow)["verify-release"]
        checkout_step = next(step for step in parse_job_steps(job) if step.get("name") == "Checkout")
        checkout_body = "\n".join(str(line) for line in checkout_step["lines"])
        self.assertIn("          fetch-depth: 0", checkout_body)
        self.assertEqual(workflow.count("npm run verify:release"), 1)
        self.assertEqual(len(re.findall(r"npm run verify:[A-Za-z0-9:_-]+", workflow)), 1)
        self.assertIn("if: always()", workflow)
        self.assertIn("actions/upload-artifact@", workflow)
        self.assertIn(".runtime/reports/generated/**", workflow)
        self.assertNotIn("actions/deploy-", workflow)

    def test_nightly_and_release_install_locked_python_dependencies_before_lane_command(self) -> None:
        cases = (
            ("nightly-verification.yml", "metadata", "Run Nightly metadata contracts"),
            ("nightly-verification.yml", "p4-checker-boundaries", "Run checker producer and all Python P4 boundaries"),
            ("nightly-verification.yml", "linux-core", "Run balanced Linux core shard"),
            ("nightly-verification.yml", "pages", "Run Pages dist and drift verification"),
            ("nightly-verification.yml", "browser", "Run Nightly browser shard"),
            ("nightly-verification.yml", "scenario-heavy", "Run strict scenario contracts"),
            ("release-verification.yml", "verify-release", "Run canonical Release verification"),
        )
        for filename, job_id, canonical_step in cases:
            with self.subTest(filename=filename):
                workflow = (REPO_ROOT / ".github" / "workflows" / filename).read_text(encoding="utf-8")
                job = parse_workflow_job_blocks(workflow)[job_id]
                steps = parse_job_steps(job)
                names = [str(step["name"]) for step in steps]
                download_index = names.index("Download Python wheel cache")
                install_index = names.index("Install Python test dependencies")
                canonical_index = names.index(canonical_step)
                self.assertLess(download_index, install_index)
                self.assertLess(install_index, canonical_index)
                by_name = {str(step["name"]): step for step in steps}
                download_run = parse_step_run(by_name["Download Python wheel cache"])
                install_run = parse_step_run(by_name["Install Python test dependencies"])
                self.assertRegex(download_run, r"(?m)^\s*python -m pip download -r requirements-dev\.lock\.txt ")
                self.assertRegex(install_run, r"^python -m pip install --no-index --find-links ")
                self.assertIn("-r requirements-dev.lock.txt", install_run)
                if filename == "nightly-verification.yml":
                    guard_index = names.index("Check minimal CI dependency guardrails")
                    self.assertLess(install_index, guard_index)
                    self.assertLess(guard_index, canonical_index)
                    guard_run = parse_step_run(by_name["Check minimal CI dependency guardrails"])
                    self.assertEqual(guard_run, "python tools/check_min_ci_requirements.py")

    def test_heavy_classification_runs_in_nightly_and_routes_through_pr_test_infra(self) -> None:
        command = "python tools/check_heavy_test_classification.py"
        nightly = (REPO_ROOT / ".github" / "workflows" / "nightly-verification.yml").read_text(encoding="utf-8")
        release = (REPO_ROOT / ".github" / "workflows" / "release-verification.yml").read_text(encoding="utf-8")
        shared = (REPO_ROOT / ".github" / "workflows" / "verify-shared.yml").read_text(encoding="utf-8")
        nightly_steps = parse_job_steps(parse_workflow_job_blocks(nightly)["metadata"])
        nightly_names = [str(step["name"]) for step in nightly_steps]
        classification_index = nightly_names.index("Check full-tree heavy test classification")
        canonical_index = nightly_names.index("Run Nightly metadata contracts")

        self.assertLess(classification_index, canonical_index)
        self.assertEqual(parse_step_run(nightly_steps[classification_index]), command)
        self.assertNotIn(command, release)
        self.assertNotIn(command, shared)

        for changed_file in (
            "tools/check_heavy_test_classification.py",
            "tests/heavy_dependency_groups.json",
            "tests/test_landing_map_asset_contracts.py",
        ):
            with self.subTest(changed_file=changed_file):
                route_result = run_command(
                    "node",
                    "tools/select_verification_targets.mjs",
                    changed_file,
                    "--json",
                )
                self.assert_command_ok(route_result)
                route_payload = json.loads(route_result.stdout)
                self.assertEqual(route_payload["unmatchedChangedFiles"], [])
                commands = [entry["commandRef"] for entry in route_payload["recommendedCommands"]]
                self.assertIn(command, commands)

    def test_release_dispatch_binds_required_pages_url_authority_at_job_scope(self) -> None:
        workflow = (REPO_ROOT / ".github" / "workflows" / "release-verification.yml").read_text(encoding="utf-8")
        inputs = parse_workflow_dispatch_inputs(workflow)
        self.assertEqual(inputs["pages_url"]["required"], "true")
        self.assertEqual(inputs["pages_url"]["type"], "string")
        job = parse_workflow_job_blocks(workflow)["verify-release"]
        self.assertEqual(parse_job_env(job)["SCENARIO_FORGE_PAGES_URL"], "${{ inputs.pages_url }}")
        steps = parse_job_steps(job)
        names = [str(step["name"]) for step in steps]
        authority_index = names.index("Validate Pages URL authority")
        canonical_index = names.index("Run canonical Release verification")
        self.assertLess(authority_index, canonical_index)
        authority_run = parse_step_run(steps[authority_index])
        self.assertRegex(
            authority_run,
            r'(?m)^if \[ -z "\$\{SCENARIO_FORGE_PAGES_URL//\[\[:space:\]\]/\}" \]; then$',
        )
        self.assertRegex(authority_run, r"(?m)^  exit 2$")

        commented_dependency = workflow.replace(
            "      - name: Install Python test dependencies",
            "      # - name: Install Python test dependencies",
        )
        with self.assertRaisesRegex(AssertionError, "unparseable workflow step content"):
            parse_job_steps(parse_workflow_job_blocks(commented_dependency)["verify-release"])
        wrong_scope = workflow.replace(
            "      SCENARIO_FORGE_PAGES_URL: ${{ inputs.pages_url }}",
            "    SCENARIO_FORGE_PAGES_URL: ${{ inputs.pages_url }}",
        )
        wrong_scope_env = parse_job_env(parse_workflow_job_blocks(wrong_scope)["verify-release"])
        self.assertNotIn("SCENARIO_FORGE_PAGES_URL", wrong_scope_env)

    def test_failure_context_reporter_tracks_failure_context_attachment(self) -> None:
        script = """
const fs = require('fs');
const path = require('path');
const FailureContextReporter = require('./tests/e2e/support/reporters/failure-context-reporter.js');
const outputFile = path.join('.runtime', 'tmp', 'failure-context-reporter-contract.ndjson');
fs.rmSync(outputFile, { force: true });
process.env.PLAYWRIGHT_FAILURE_CONTEXT_INDEX_FILE = outputFile;
const reporter = new FailureContextReporter();
reporter.onTestEnd(
  { title: 'demo', location: { file: path.join(process.cwd(), 'tests/e2e/main_shell_i18n.spec.js') } },
  {
    status: 'failed',
    retry: 0,
    duration: 321,
    parallelIndex: 0,
    startTime: new Date('2026-05-01T00:00:00Z'),
    error: { message: 'boom' },
    attachments: [
      {
        name: 'failure-context',
        path: path.join(process.cwd(), '.runtime/tests/playwright/demo/failure-context.json'),
        contentType: 'application/json',
      },
    ],
  }
);
const lines = fs.readFileSync(outputFile, 'utf8').trim().split(/\\r?\\n/).filter(Boolean).map((line) => JSON.parse(line));
if (lines.length !== 1) {
  throw new Error(`expected exactly one reporter line, got ${lines.length}`);
}
if (!String(lines[0].failureContextPath || '').endsWith('failure-context.json')) {
  throw new Error(`expected failureContextPath, got ${lines[0].failureContextPath}`);
}
"""
        result = run_command("node", "-e", script)
        self.assert_command_ok(result)

    def test_timing_reporter_appends_ndjson_entry(self) -> None:
        script = """
const fs = require('fs');
const path = require('path');
const TimingReporter = require('./tests/e2e/support/reporters/timing-reporter.js');
const outputFile = path.join('.runtime', 'tmp', 'timing-reporter-contract.ndjson');
fs.rmSync(outputFile, { force: true });
process.env.PLAYWRIGHT_TIMING_OUTPUT_FILE = outputFile;
const reporter = new TimingReporter();
reporter.onTestEnd(
  { title: 'demo', location: { file: path.join(process.cwd(), 'tests/e2e/ui_contract_foundation.spec.js') } },
  {
    status: 'passed',
    retry: 0,
    duration: 123,
    parallelIndex: 1,
    startTime: new Date('2026-05-01T00:00:00Z'),
    attachments: [],
  }
);
const lines = fs.readFileSync(outputFile, 'utf8').trim().split(/\\r?\\n/).filter(Boolean).map((line) => JSON.parse(line));
if (lines.length !== 1) {
  throw new Error(`expected exactly one timing line, got ${lines.length}`);
}
if (lines[0].specPath !== 'tests/e2e/ui_contract_foundation.spec.js') {
  throw new Error(`unexpected specPath ${lines[0].specPath}`);
}
"""
        result = run_command("node", "-e", script)
        self.assert_command_ok(result)


class ScenarioContractMatrixRoutingTests(unittest.TestCase):
    def classify(self, paths, scenario, event="pull_request", diff_status=0, base="base"):
        workflow = (REPO_ROOT / ".github/workflows/scenario-contract-matrix.yml").read_text(encoding="utf-8")
        block = workflow.split("        run: |\n", 1)[1].split("\n      - name:", 1)[0]
        script = "\n".join(line[10:] for line in block.splitlines())
        # Intercept only external change discovery; run the actual branching and routing.
        script = """git() {
          if [ "$1" = "fetch" ]; then return 0; fi
          if [ "$1" = "diff" ]; then
            printf '%s' "$TEST_PATHS" | tr '\\n' '\\0'
            return "$TEST_DIFF_STATUS"
          fi
          return 1
        }
        python() { cat >/dev/null; printf '%s head\\n' "$TEST_BASE"; }
        """ + script
        bash = shutil.which("bash")
        if not bash and os.name == "nt":
            bash = str(Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe")
        self.assertTrue(bash and Path(bash).exists(), "Bash is required to test the workflow classifier")
        temp_root = REPO_ROOT / ".runtime/tmp"
        temp_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temp_root) as directory:
            env = dict(os.environ, GITHUB_EVENT_NAME=event, GITHUB_OUTPUT="output.txt",
                       GITHUB_STEP_SUMMARY="summary.txt", SCENARIO_ID=scenario,
                       TEST_PATHS="".join(path + "\n" for path in paths), TEST_DIFF_STATUS=str(diff_status), TEST_BASE=base)
            result = subprocess.run([bash, "--noprofile", "--norc", "-s"], input=script,
                                    cwd=directory, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stderr, "")
            output = (Path(directory) / "output.txt").read_text(encoding="utf-8")
            return dict(line.split("=", 1) for line in output.splitlines())["should_run"] == "true"

    def test_scenario_changes_run_only_their_owner(self):
        for changed in ("tno_1962", "hoi4_1936", "hoi4_1939"):
            for candidate in ("tno_1962", "hoi4_1936", "hoi4_1939"):
                with self.subTest(changed=changed, candidate=candidate):
                    self.assertEqual(self.classify([f"data/scenarios/{changed}/manifest.json"], candidate),
                                     changed == candidate)

    def test_shared_dependencies_and_unknown_scenarios_run_all(self):
        paths = ["data/scenarios/index.json", "data/scenarios/new_scenario/manifest.json",
                 "data/locales.json", "data/europe_topology.json", "map_builder/io/readers.py",
                 "tools/check_scenario_contracts.py", "tools/build_startup_bundle.py",
                 "requirements-dev.lock.txt", ".github/workflows/scenario-contract-matrix.yml"]
        for path in paths:
            for scenario in ("tno_1962", "hoi4_1936", "hoi4_1939"):
                with self.subTest(path=path, scenario=scenario):
                    self.assertTrue(self.classify([path], scenario))

    def test_unrelated_or_empty_changes_skip(self):
        for paths in ([], ["README.md", "js/ui/menu.js"]):
            for scenario in ("tno_1962", "hoi4_1936", "hoi4_1939"):
                self.assertFalse(self.classify(paths, scenario))

    def test_mixed_changes_select_each_affected_scenario(self):
        paths = ["data/scenarios/hoi4_1936/owners.json", "data/scenarios/tno_1962/manifest.json"]
        for scenario in ("tno_1962", "hoi4_1936", "hoi4_1939"):
            self.assertEqual(self.classify(paths, scenario), scenario != "hoi4_1939")

    def test_non_ascii_and_space_paths_keep_their_scenario_owner(self):
        path = "data/scenarios/tno_1962/城市 names.json"
        self.assertTrue(self.classify([path], "tno_1962"))
        self.assertFalse(self.classify([path], "hoi4_1939"))

    def test_unknown_change_set_never_skips(self):
        for event in ("pull_request", "push"):
            for scenario in ("tno_1962", "hoi4_1936", "hoi4_1939"):
                self.assertTrue(self.classify(["README.md"], scenario, event=event, diff_status=128))
        for event in ("workflow_dispatch", "unknown_event"):
            self.assertTrue(self.classify([], ("tno_1962", "hoi4_1936", "hoi4_1939")[0], event=event))
        self.assertTrue(self.classify([], ("tno_1962", "hoi4_1936", "hoi4_1939")[0], event="push", base="0" * 40))

    def test_successful_push_uses_scenario_routing(self):
        self.assertTrue(self.classify(["data/scenarios/tno_1962/manifest.json"], "tno_1962", event="push"))
        self.assertFalse(self.classify(["README.md"], "tno_1962", event="push"))

    def test_required_matrix_and_pr_cancellation_remain_stable(self):
        workflow = (REPO_ROOT / ".github/workflows/scenario-contract-matrix.yml").read_text(encoding="utf-8")
        self.assertIn("  strict-scenario-contract-review:", workflow)
        for scenario in ("tno_1962", "hoi4_1936", "hoi4_1939"):
            self.assertIn(f"          - {scenario}\n", workflow)
        self.assertIn("group: scenario-contract-${{ github.event_name }}-${{ github.ref }}", workflow)
        self.assertIn("cancel-in-progress: ${{ github.event_name == 'pull_request' }}", workflow)


if __name__ == "__main__":
    unittest.main()
