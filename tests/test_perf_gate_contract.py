from pathlib import Path
import importlib.util
import json
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_JSON = REPO_ROOT / "package.json"
WORKFLOW_FILE = REPO_ROOT / ".github" / "workflows" / "perf-pr-gate.yml"
BASELINE_MD = REPO_ROOT / "docs" / "perf" / "baseline_2026-04-20.md"
BASELINE_JSON = REPO_ROOT / "docs" / "perf" / "baseline_2026-04-20.json"
PERF_SCRIPT = REPO_ROOT / "tools" / "perf" / "run_baseline.mjs"
EDITOR_BENCHMARK_SCRIPT = REPO_ROOT / "ops" / "browser-mcp" / "editor-performance-benchmark.py"


def load_editor_benchmark_module():
    spec = importlib.util.spec_from_file_location("editor_performance_benchmark", EDITOR_BENCHMARK_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PerfGateContractTest(unittest.TestCase):
    def test_package_perf_gate_uses_real_gate_scenarios(self):
        package_payload = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
        perf_baseline_script = package_payload["scripts"]["perf:baseline"]
        perf_gate_script = package_payload["scripts"]["perf:gate"]
        self.assertEqual(
            package_payload["scripts"].get("verify:perf-gate-contract"),
            "python -m unittest tests.test_perf_gate_contract -q",
        )
        self.assertEqual(
            package_payload["scripts"].get("bench:editor-performance"),
            "python ops/browser-mcp/editor-performance-benchmark.py --out .runtime/output/perf/editor-performance-benchmark.json --screenshot-dir .runtime/browser/mcp-artifacts/perf",
        )
        self.assertIn("--warmups 3", perf_baseline_script)
        self.assertIn("--scenarios tno_1962,hoi4_1939", perf_gate_script)
        self.assertIn("--warmups 3", perf_gate_script)
        self.assertNotIn("blank_base", perf_gate_script)

    def test_workflow_matches_checked_in_baseline_environment(self):
        workflow_content = WORKFLOW_FILE.read_text(encoding="utf-8")
        baseline_payload = json.loads(BASELINE_JSON.read_text(encoding="utf-8"))
        baseline_os = str(baseline_payload["environment"]["os"])
        baseline_node = str(baseline_payload["environment"]["node"])
        self.assertTrue(baseline_os.startswith("win32 "), baseline_os)
        self.assertTrue(baseline_node.startswith("v22."), baseline_node)
        self.assertIn("runs-on: windows-latest", workflow_content)
        self.assertRegex(workflow_content, r'node-version:\s*[\"\']22[\"\']')
        self.assertIn("npx playwright install chromium", workflow_content)
        self.assertIn("npm run perf:gate", workflow_content)

    def test_baseline_markdown_declares_gate_vs_observation_roles(self):
        markdown = BASELINE_MD.read_text(encoding="utf-8")
        self.assertIn("- Gate scenarios: tno_1962, hoi4_1939", markdown)
        self.assertIn("- Observation samples: blank_base", markdown)
        self.assertRegex(markdown, r"## Scenario: blank_base\s+- sample_role: observation")
        self.assertRegex(markdown, r"## Scenario: tno_1962\s+- sample_role: gate")
        self.assertRegex(markdown, r"## Scenario: hoi4_1939\s+- sample_role: gate")

    def test_perf_script_locks_hardening_contract(self):
        script = PERF_SCRIPT.read_text(encoding="utf-8")
        self.assertIn('benchmarkMetricsSchemaVersion: "3.2"', script)
        self.assertIn('probeSchema: "mc_perf_snapshot"', script)
        self.assertIn('const PERF_REPORT_CONTRACT_FIELDS = [', script)
        self.assertIn('getPerfReportContractMismatches(baselineReport, "baseline")', script)
        self.assertIn('getPerfReportContractMismatches(currentReport, "current")', script)
        self.assertIn('const DEFAULT_GATE_SCENARIOS = ["tno_1962", "hoi4_1939"];', script)
        self.assertIn("const MIN_GATE_WARMUPS = 3;", script)
        self.assertIn("const DEFAULT_WARMUPS = MIN_GATE_WARMUPS;", script)
        self.assertIn('throw new Error(`[perf-baseline] Gate warmups must be at least ${MIN_GATE_WARMUPS}; received ${options.warmups}.`);', script)
        self.assertIn("warmups mismatch: baseline=", script)
        self.assertIn('if (activeScenarioId !== normalizeScenarioId(scenarioId)) {', script)
        self.assertIn('{ key: "scenarioAppliedMs", label: "scenarioAppliedMs" }', script)
        self.assertIn('{ key: "applyScenarioBundleMs", label: "applyScenarioBundleMs" }', script)
        self.assertIn('{ key: "refreshScenarioApplyMs", label: "refreshScenarioApplyMs" }', script)
        self.assertIn('{ key: "renderSampleMedianMs", label: "renderSampleMedianMs", threshold: 1.25 }', script)
        for field_name in (
            "scenarioFullHydrateMs",
            "interactionInfraMs",
            "scenarioChunkPromotionInfraStageMs",
            "scenarioChunkPromotionVisualStageMs",
            "zoomEndToChunkVisibleMs",
            "interactionRecoveryWindowMs",
            "interactionRecoveryTaskMs",
            "continuityFrameStaleAgeMs",
            "missingVisibleFrameCount",
            "postReadyMaxPendingAgeMs",
            "postReadyMaxRetryCount",
            "startupBundleSource",
            "loadScenarioBundleMs",
            "drawContextScenarioPassMs",
            "setMapDataFirstPaintMs",
            "settleExactRefreshMs",
        ):
            self.assertIn(field_name, script)
        self.assertIn('bootMetrics["scenario-apply"]?.source', script)
        self.assertIn("workerDecodeMs", script)
        self.assertIn("workerMetaBuildMs", script)
        self.assertIn("Perf gate baseline contract mismatch.", script)

    def test_checked_in_baseline_keeps_report_identity_and_worker_summary_fields(self):
        baseline_payload = json.loads(BASELINE_JSON.read_text(encoding="utf-8"))
        self.assertEqual(baseline_payload.get("schemaVersion"), 1)
        self.assertEqual(baseline_payload.get("benchmarkMetricsSchemaVersion"), "3.2")
        self.assertEqual(baseline_payload.get("probeSchema"), "mc_perf_snapshot")
        self.assertRegex(str(baseline_payload.get("gitHead", "")), r"^[0-9a-f]{40}$")
        self.assertEqual(baseline_payload.get("config", {}).get("warmups"), 3)
        for scenario_id in ("tno_1962", "hoi4_1939"):
            summary = baseline_payload.get("scenarios", {}).get(scenario_id, {}).get("summary", {})
            self.assertIn("workerDecodeMs", summary)
            self.assertIn("workerMetaBuildMs", summary)
            self.assertIsInstance(summary.get("workerDecodeMs"), (int, float))
            self.assertIsInstance(summary.get("workerMetaBuildMs"), (int, float))

    def test_editor_benchmark_locks_identity_and_fill_black_pixel_contract(self):
        script = EDITOR_BENCHMARK_SCRIPT.read_text(encoding="utf-8")
        self.assertIn('"schemaVersion": 1', script)
        self.assertIn('"probeSchema": "mc_perf_snapshot"', script)
        self.assertIn('"interactionProbeSchema": "mc_repeated_zoom_regions_v1"', script)
        self.assertIn('"benchmarkMetricsSchemaVersion": "3.2"', script)
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
        self.assertIn("mergedLayerPayloadCacheLayerCount", script)
        self.assertIn("includeHeavyMetrics: false", script)
        self.assertIn("includeHeavyMetrics: true", script)
        self.assertIn("timedOut: !!stillActive", script)
        self.assertIn("firstIdleAfterLastWheelMs = idleState?.timedOut", script)
        self.assertIn("result.finalReset = await waitForIdle(7000)", script)
        self.assertIn("attribution: Array.from(entry.attribution || [])", script)
        self.assertIn('"git", "rev-parse", "HEAD"', script)
        self.assertIn('SCENARIO_IDS = ["none", "hoi4_1939", "tno_1962"]', script)
        self.assertIn('"politicalRasterWorker": political_raster_worker', script)
        self.assertIn("const sampleRegions = [", script)
        self.assertIn("sampleContext.drawImage(canvas, sourceX, sourceY", script)

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
                "interactionProbeSchema": "mc_repeated_zoom_regions_v1",
                "cyclesPerRegion": 2,
                "wheelsPerCycle": 5,
                "regions": {
                    "europe": {
                        "cycles": [
                            {"firstIdleAfterLastWheelMs": 100},
                            {"firstIdleAfterLastWheelMs": 125},
                        ],
                        "degradation": {"ratio": 1.25},
                        "maxBlackPixelRatio": 0.02,
                        "maxLongTaskMs": 30,
                        "memoryDelta": {"usedJSHeapSize": 2048},
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
        self.assertEqual(metric["details"]["regions"]["europe"]["degradation"]["ratio"], 1.25)

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
                "blackPixelRatio": 0.12,
            },
            "doubleClickFill": {
                "lastActionDurationMs": 22,
                "blackPixelRatio": 0.34,
            },
        }
        metrics = benchmark.build_suite_benchmark_metrics(suite)["firstInteraction"]
        self.assertEqual(metrics["singleFillAction"]["details"]["blackPixelRatio"], 0.12)
        self.assertEqual(metrics["doubleClickFillAction"]["details"]["blackPixelRatio"], 0.34)

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


if __name__ == "__main__":
    unittest.main()

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
