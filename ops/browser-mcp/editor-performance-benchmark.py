#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


ROOT_DIR = Path(__file__).resolve().parents[2]
PWCLI = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "skills" / "playwright" / "scripts" / "playwright_cli.sh"
PWCLI_WORKDIR = ROOT_DIR / ".runtime" / "browser" / "playwright-cli"
SESSION_ID = "editor-perf-benchmark"
BROWSER_OPENED = False
SCENARIO_IDS = ["none", "hoi4_1939", "tno_1962"]
RENDER_PASS_NAMES = ["background", "political", "effects", "contextBase", "contextScenario", "dayNight", "borders"]
CONTEXT_PROBE_CASES = [
    ("baseline", {}),
    ("physical_off", {"showPhysical": False}),
    ("urban_off", {"showUrban": False}),
    ("rivers_off", {"showRivers": False}),
    ("water_off", {"showWaterRegions": False}),
    ("physical_urban_rivers_off", {"showPhysical": False, "showUrban": False, "showRivers": False}),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark Map Creator editor performance via Playwright CLI.")
    parser.add_argument("--url", default="http://127.0.0.1:8000/?perf_overlay=1", help="Benchmark target URL.")
    parser.add_argument(
        "--out",
        default=".runtime/output/perf/editor-performance-benchmark.json",
        help="Output JSON path.",
    )
    parser.add_argument("--screenshot-dir", default=".runtime/browser/mcp-artifacts/perf", help="Screenshot directory.")
    return parser.parse_args()


def run_pw(*args: str, expect_json: bool = False, timeout_sec: int = 240) -> dict | list | str:
    env = os.environ.copy()
    env["PLAYWRIGHT_CLI_SESSION"] = SESSION_ID
    try:
      proc = subprocess.run(
          ["bash", str(PWCLI), *args],
          cwd=PWCLI_WORKDIR,
          env=env,
          capture_output=True,
          text=True,
          check=False,
          timeout=timeout_sec,
      )
    except subprocess.TimeoutExpired as exc:
      raise RuntimeError(f"Playwright CLI command timed out ({' '.join(args)}) after {timeout_sec}s.") from exc
    if proc.returncode != 0:
      raise RuntimeError(
          f"Playwright CLI command failed ({' '.join(args)}):\n"
          f"STDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
      )
    output = proc.stdout.strip()
    if not expect_json:
      return output

    match = re.search(r"### Result\s*\n(.*?)\n### Ran Playwright code", output, re.S)
    if not match:
      raise RuntimeError(f"Unable to parse JSON result from Playwright CLI output:\n{output}")
    return json.loads(match.group(1).strip())


def close_session() -> None:
    global BROWSER_OPENED
    env = os.environ.copy()
    env["PLAYWRIGHT_CLI_SESSION"] = SESSION_ID
    try:
      subprocess.run(
          ["bash", str(PWCLI), "close"],
          cwd=PWCLI_WORKDIR,
          env=env,
          capture_output=True,
          text=True,
          check=False,
          timeout=10,
      )
    except subprocess.TimeoutExpired:
      pass
    BROWSER_OPENED = False


def run_code_json(js_code: str) -> dict | list | str:
    compact = " ".join(line.strip() for line in js_code.splitlines() if line.strip())
    return run_pw("run-code", compact, expect_json=True)


def clone_frame_js(source: str) -> str:
    return f"""(() => {{
      const frame = {source};
      return frame && typeof frame === 'object'
        ? {{
          phase: frame.phase || null,
          totalMs: Number(frame.totalMs || 0),
          timings: {{ ...(frame.timings || {{}}) }},
          transform: {{
            x: Number(frame.transform?.x || 0),
            y: Number(frame.transform?.y || 0),
            k: Number(frame.transform?.k || 1),
          }},
        }}
        : null;
    }})()"""


def clone_metrics_js(source: str) -> str:
    return f"""JSON.parse(JSON.stringify({source} || {{}}))"""


def navigate(url: str) -> None:
    js = f"""
async (page) => {{
  page.on('dialog', async (dialog) => {{
    try {{
      await dialog.accept();
    }} catch (_error) {{}}
  }});
  await page.evaluate(async () => {{
    try {{
      const dirtyStateModule = await import('/js/core/dirty_state.js');
      if (typeof dirtyStateModule?.clearDirty === 'function') {{
        dirtyStateModule.clearDirty('benchmark-navigation');
      }}
    }} catch (_error) {{}}
  }}).catch(() => {{}});
  await page.goto({json.dumps(url)}, {{ waitUntil: 'domcontentloaded', timeout: 60000 }});
  await page.waitForFunction(
    () => typeof window.renderNow === 'function' && !!document.getElementById('map-canvas') && !!document.querySelector('#map-svg rect.interaction-layer'),
    undefined,
    {{ timeout: 30000 }}
  );
  await page.waitForTimeout(900);
  await page.evaluate(() => {{
    window.__perfBench = window.__perfBench || {{}};
    window.__perfBench.longTasks = [];
    if (window.__perfBench.longTaskObserverAttached) return;
    if (typeof window.PerformanceObserver !== 'function') return;
    try {{
      const observer = new PerformanceObserver((list) => {{
        const entries = list.getEntries().map((entry) => ({{
          name: entry.name,
          duration: Number(entry.duration || 0),
          startTime: Number(entry.startTime || 0),
        }}));
        window.__perfBench.longTasks.push(...entries);
      }});
      observer.observe({{ entryTypes: ['longtask'] }});
      window.__perfBench.longTaskObserverAttached = true;
    }} catch (_error) {{
      window.__perfBench.longTaskObserverAttached = false;
    }}
  }});
  return {{ url: page.url(), title: await page.title() }};
}}
""".strip()
    compact = " ".join(line.strip() for line in js.splitlines() if line.strip())
    run_pw("run-code", compact, expect_json=False)


def open_page(url: str) -> None:
    global BROWSER_OPENED
    if not BROWSER_OPENED:
      run_pw("open", "about:blank", "--browser", "msedge")
      BROWSER_OPENED = True
    navigate(url)


def with_query_overrides(url: str, **overrides: str) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    for key, value in overrides.items():
      query[key] = value
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def clear_browser_buffers() -> None:
    run_pw("console", "warning", "--clear")
    run_pw("network", "--clear")


def capture_console_issues() -> list[str]:
    output = run_pw("console", "warning")
    return [line for line in str(output).splitlines() if line.strip()]


def capture_network_issues() -> list[str]:
    output = run_pw("network")
    return [line for line in str(output).splitlines() if line.strip()]


def take_screenshot(target_path: Path) -> str:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    run_pw("screenshot", "--filename", target_path.resolve().as_posix(), "--full-page", timeout_sec=120)
    if not target_path.exists():
      raise RuntimeError(f"Screenshot was not created at {target_path}")
    return str(target_path)


def apply_scenario(scenario_id: str) -> dict:
    js = f"""
async (page) => {{
  return await page.evaluate(async (scenarioId) => {{
    const {{ state }} = await import('/js/core/state.js');
    const scenarioManager = await import('/js/core/scenario_manager.js');
    const before = {{
      drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0),
      frames: Number(state.renderPassCache?.counters?.frames || 0),
      transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0),
      dynamicBorderRebuilds: Number(state.renderPassCache?.counters?.dynamicBorderRebuilds || 0),
    }};
    window.__perfBench.longTasks = [];
    const startedAt = performance.now();
    if (!scenarioId || scenarioId === 'none') {{
      if (state.activeScenarioId) {{
        scenarioManager.clearActiveScenario({{
          renderNow: true,
          markDirtyReason: '',
          showToastOnComplete: false,
        }});
      }} else if (typeof window.renderNow === 'function') {{
        window.renderNow();
      }}
    }} else {{
      await scenarioManager.applyScenarioById(scenarioId, {{
        renderNow: true,
        markDirtyReason: '',
        showToastOnComplete: false,
      }});
    }}
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {{
      requestedScenarioId: scenarioId,
      activeScenarioId: String(state.activeScenarioId || ''),
      durationMs: Number((performance.now() - startedAt).toFixed(3)),
      renderProfile: String(state.renderProfile || 'auto'),
      dynamicBordersEnabled: state.dynamicBordersEnabled !== false,
      showWaterRegions: !!state.showWaterRegions,
      showScenarioSpecialRegions: !!state.showScenarioSpecialRegions,
      showScenarioReliefOverlays: !!state.showScenarioReliefOverlays,
      counterDelta: {{
        drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0) - before.drawCanvas,
        frames: Number(state.renderPassCache?.counters?.frames || 0) - before.frames,
        transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0) - before.transformedFrames,
        dynamicBorderRebuilds: Number(state.renderPassCache?.counters?.dynamicBorderRebuilds || 0) - before.dynamicBorderRebuilds,
      }},
      longTaskCount: Array.isArray(window.__perfBench?.longTasks) ? window.__perfBench.longTasks.length : 0,
      lastFrame: {clone_frame_js("state.renderPassCache?.lastFrame || null")},
      renderMetrics: {clone_metrics_js("state.renderPerfMetrics")},
      scenarioMetrics: {clone_metrics_js("state.scenarioPerfMetrics")},
      overlay: document.getElementById('perf-overlay')?.textContent || '',
    }};
  }}, {json.dumps(scenario_id)});
}}
""".strip()
    return run_code_json(js)  # type: ignore[return-value]


def force_idle_full_redraw(label: str) -> dict:
    js = f"""
async (page) => {{
  return await page.evaluate(async () => {{
    const {{ state }} = await import('/js/core/state.js');
    const {{ render }} = await import('/js/core/map_renderer.js');
    const before = {{
      drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0),
      frames: Number(state.renderPassCache?.counters?.frames || 0),
    }};
    state.renderPhase = 'idle';
    for (const passName of {json.dumps(RENDER_PASS_NAMES)}) {{
      state.renderPassCache.dirty[passName] = true;
      state.renderPassCache.reasons[passName] = {json.dumps(label)};
    }}
    render();
    return {{
      counterDelta: {{
        drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0) - before.drawCanvas,
        frames: Number(state.renderPassCache?.counters?.frames || 0) - before.frames,
      }},
      lastFrame: {clone_frame_js("state.renderPassCache?.lastFrame || null")},
      renderMetrics: {clone_metrics_js("state.renderPerfMetrics")},
      overlay: document.getElementById('perf-overlay')?.textContent || '',
    }};
  }});
}}
""".strip()
    return run_code_json(js)  # type: ignore[return-value]


def measure_context_probe_case(label: str, flags: dict[str, bool]) -> dict:
    js = f"""
async (page) => {{
  return await page.evaluate(async (payload) => {{
    const probeLabel = String(payload?.label || '');
    const probeFlags = payload?.flags || {{}};
    const {{ state }} = await import('/js/core/state.js');
    const {{ render }} = await import('/js/core/map_renderer.js');
    const trackedFlags = [
      'showPhysical',
      'showUrban',
      'showRivers',
      'showWaterRegions',
      'showScenarioSpecialRegions',
      'showScenarioReliefOverlays',
    ];
    const snapshot = Object.fromEntries(trackedFlags.map((key) => [key, state[key]]));
    const before = {{
      drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0),
      frames: Number(state.renderPassCache?.counters?.frames || 0),
    }};
    Object.entries(probeFlags || {{}}).forEach(([key, value]) => {{
      state[key] = value;
    }});
    state.renderPhase = 'idle';
    for (const passName of {json.dumps(RENDER_PASS_NAMES)}) {{
      state.renderPassCache.dirty[passName] = true;
      state.renderPassCache.reasons[passName] = `context-probe:${{probeLabel}}`;
    }}
    render();
    const result = {{
      label: probeLabel,
      flags: Object.fromEntries(trackedFlags.map((key) => [key, !!state[key]])),
      counterDelta: {{
        drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0) - before.drawCanvas,
        frames: Number(state.renderPassCache?.counters?.frames || 0) - before.frames,
      }},
      lastFrame: {clone_frame_js("state.renderPassCache?.lastFrame || null")},
      renderMetrics: {clone_metrics_js("state.renderPerfMetrics")},
      overlay: document.getElementById('perf-overlay')?.textContent || '',
    }};
    Object.entries(snapshot).forEach(([key, value]) => {{
      state[key] = value;
    }});
    for (const passName of {json.dumps(RENDER_PASS_NAMES)}) {{
      state.renderPassCache.dirty[passName] = true;
      state.renderPassCache.reasons[passName] = `context-probe-restore:${{probeLabel}}`;
    }}
    render();
    return result;
  }}, {json.dumps({"label": label, "flags": flags})});
}}
""".strip()
    return run_code_json(js)  # type: ignore[return-value]


def measure_context_probes(scenario_id: str) -> dict | None:
    if scenario_id != "tno_1962":
      return None
    probes = {}
    for label, flags in CONTEXT_PROBE_CASES:
      print(f"[benchmark] context probe scenario={scenario_id} case={label}", flush=True)
      probes[label] = measure_context_probe_case(label, flags)
    return probes


def measure_zoom_settle_redraw() -> dict:
    js = f"""
async (page) => {{
  return await page.evaluate(async () => {{
    const {{ state }} = await import('/js/core/state.js');
    const {{ render, scheduleRenderPhaseIdle }} = await import('/js/core/map_renderer.js');
    const before = {{
      drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0),
      frames: Number(state.renderPassCache?.counters?.frames || 0),
      transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0),
    }};
    const previousExactRefreshRecordedAt = Number(state.renderPerfMetrics?.settleExactRefresh?.recordedAt || 0);
    const originalTransform = {{ ...(state.zoomTransform || {{ x: 0, y: 0, k: 1 }}) }};
    state.zoomTransform = {{
      x: originalTransform.x + 54,
      y: originalTransform.y + 28,
      k: Number((originalTransform.k * 1.12).toFixed(4)),
    }};
    state.renderPhase = 'settling';
    state.phaseEnteredAt = performance.now();
    state.isInteracting = false;
    render();
    const settleFrame = {clone_frame_js("state.renderPassCache?.lastFrame || null")};
    scheduleRenderPhaseIdle();
    const idleFastStartedAt = performance.now();
    while (state.renderPhase !== 'idle' && (performance.now() - idleFastStartedAt) < 4000) {{
      await new Promise((resolve) => setTimeout(resolve, 25));
    }}
    const idleFastFrame = {clone_frame_js("state.renderPassCache?.lastFrame || null")};
    const exactRefreshStartedAt = performance.now();
    while (
      Number(state.renderPerfMetrics?.settleExactRefresh?.recordedAt || 0) <= previousExactRefreshRecordedAt
      && (performance.now() - exactRefreshStartedAt) < 8000
    ) {{
      await new Promise((resolve) => setTimeout(resolve, 25));
    }}
    const exactRefreshObserved = Number(state.renderPerfMetrics?.settleExactRefresh?.recordedAt || 0) > previousExactRefreshRecordedAt;
    const exactRefreshFrame = {clone_frame_js("state.renderPassCache?.lastFrame || null")};
    const settleMetrics = {clone_metrics_js("state.renderPerfMetrics")};
    if (state.exactAfterSettleHandle) {{
      if (state.exactAfterSettleHandle.type === 'idle' && typeof cancelIdleCallback === 'function') {{
        cancelIdleCallback(state.exactAfterSettleHandle.id);
      }} else {{
        clearTimeout(state.exactAfterSettleHandle.id);
      }}
      state.exactAfterSettleHandle = null;
    }}
    state.deferExactAfterSettle = false;
    state.zoomTransform = originalTransform;
    state.renderPhase = 'idle';
    state.phaseEnteredAt = performance.now();
    state.isInteracting = false;
    for (const passName of {json.dumps(RENDER_PASS_NAMES)}) {{
      state.renderPassCache.dirty[passName] = true;
      state.renderPassCache.reasons[passName] = 'zoom-settle-bench-restore';
    }}
    render();
    return {{
      counterDelta: {{
        drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0) - before.drawCanvas,
        frames: Number(state.renderPassCache?.counters?.frames || 0) - before.frames,
        transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0) - before.transformedFrames,
      }},
      settleFrame,
      idleFastFrame,
      exactRefreshObserved,
      exactRefreshFrame,
      restoredFrame: {clone_frame_js("state.renderPassCache?.lastFrame || null")},
      renderMetrics: settleMetrics,
      overlay: document.getElementById('perf-overlay')?.textContent || '',
    }};
  }});
}}
""".strip()
    return run_code_json(js)  # type: ignore[return-value]


def measure_interactive_pan_frame() -> dict:
    js = f"""
async (page) => {{
  return await page.evaluate(async () => {{
    const {{ state }} = await import('/js/core/state.js');
    const {{ render }} = await import('/js/core/map_renderer.js');
    for (const passName of {json.dumps(RENDER_PASS_NAMES)}) {{
      state.renderPassCache.dirty[passName] = true;
      state.renderPassCache.reasons[passName] = 'interactive-bench-prime';
    }}
    state.renderPhase = 'idle';
    render();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const before = {{
      drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0),
      frames: Number(state.renderPassCache?.counters?.frames || 0),
      transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0),
    }};
    const originalTransform = {{ ...(state.zoomTransform || {{ x: 0, y: 0, k: 1 }}) }};
    state.renderPhase = 'interacting';
    state.zoomTransform = {{
      x: originalTransform.x + 42,
      y: originalTransform.y + 24,
      k: Number((originalTransform.k * 1.08).toFixed(4)),
    }};
    render();
    const interactiveFrame = {clone_frame_js("state.renderPassCache?.lastFrame || null")};
    state.renderPhase = 'idle';
    state.zoomTransform = originalTransform;
    render();
    return {{
      counterDelta: {{
        drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0) - before.drawCanvas,
        frames: Number(state.renderPassCache?.counters?.frames || 0) - before.frames,
        transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0) - before.transformedFrames,
      }},
      interactiveFrame,
      restoredFrame: {clone_frame_js("state.renderPassCache?.lastFrame || null")},
      renderMetrics: {clone_metrics_js("state.renderPerfMetrics")},
      overlay: document.getElementById('perf-overlay')?.textContent || '',
    }};
  }});
}}
""".strip()
    return run_code_json(js)  # type: ignore[return-value]


def measure_single_click_fill() -> dict:
    prepare_js = f"""
async (page) => {{
  return await page.evaluate(async () => {{
    const {{ state }} = await import('/js/core/state.js');
    const interaction = document.querySelector('#map-svg rect.interaction-layer');
    if (!interaction || !state.landData?.features?.length) {{
      throw new Error('Single-click benchmark prerequisites are unavailable.');
    }}
    const padding = Math.max(16, Math.round(Math.min(state.width, state.height) * 0.04));
    const projection = window.d3
      .geoEqualEarth()
      .precision(0.1)
      .fitExtent(
        [[padding, padding], [Math.max(padding + 1, state.width - padding), Math.max(padding + 1, state.height - padding)]],
        state.landData
      );
    const pathBuilder = window.d3.geoPath(projection);
    const bounds = interaction.getBoundingClientRect();
    const candidate = state.landData.features
      .map((feature) => ({{
        id: String(feature?.properties?.id || ''),
        name: String(feature?.properties?.name || ''),
        code: String(feature?.properties?.cntr_code || '').trim().toUpperCase(),
        area: window.d3.geoArea(feature),
        point: pathBuilder.centroid(feature),
      }}))
      .filter((item) => (
        !['AQ', 'CN'].includes(item.code)
        && Number.isFinite(item.point[0])
        && Number.isFinite(item.point[1])
        && item.point[0] > 40
        && item.point[0] < state.width - 40
        && item.point[1] > 40
        && item.point[1] < state.height - 70
      ))
      .sort((left, right) => right.area - left.area)[0];
    if (!candidate) {{
      throw new Error('Unable to resolve a single-click benchmark target.');
    }}
    window.__benchBaseline = {{
      drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0),
      frames: Number(state.renderPassCache?.counters?.frames || 0),
      transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0),
      dynamicBorderRebuilds: Number(state.renderPassCache?.counters?.dynamicBorderRebuilds || 0),
      longTasks: Array.isArray(window.__perfBench?.longTasks) ? window.__perfBench.longTasks.length : 0,
    }};
    return {{
      ...candidate,
      screenX: bounds.left + candidate.point[0],
      screenY: bounds.top + candidate.point[1],
    }};
  }});
}}
""".strip()
    target = run_code_json(prepare_js)
    action_js = f"""
async (page) => {{
  await page.mouse.move({json.dumps(target["screenX"])}, {json.dumps(target["screenY"])});
  await page.mouse.click({json.dumps(target["screenX"])}, {json.dumps(target["screenY"])});
  await page.waitForTimeout(450);
  return {{ ok: true }};
}}
""".strip()
    run_code_json(action_js)
    collect_js = f"""
async (page) => {{
  return await page.evaluate(async (target) => {{
    const {{ state }} = await import('/js/core/state.js');
    const before = window.__benchBaseline || {{}};
    return {{
      target,
      lastAction: state.renderPassCache?.lastAction || null,
      lastActionDurationMs: Number(state.renderPassCache?.lastActionDurationMs || 0),
      lastActionFrame: {clone_frame_js("state.renderPassCache?.lastActionFrame || null")},
      lastFrame: {clone_frame_js("state.renderPassCache?.lastFrame || null")},
      counterDelta: {{
        drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0) - Number(before.drawCanvas || 0),
        frames: Number(state.renderPassCache?.counters?.frames || 0) - Number(before.frames || 0),
        transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0) - Number(before.transformedFrames || 0),
        dynamicBorderRebuilds: Number(state.renderPassCache?.counters?.dynamicBorderRebuilds || 0) - Number(before.dynamicBorderRebuilds || 0),
      }},
      longTaskCountDelta: (
        Array.isArray(window.__perfBench?.longTasks) ? window.__perfBench.longTasks.length : 0
      ) - Number(before.longTasks || 0),
      renderMetrics: {clone_metrics_js("state.renderPerfMetrics")},
      scenarioMetrics: {clone_metrics_js("state.scenarioPerfMetrics")},
      overlay: document.getElementById('perf-overlay')?.textContent || '',
    }};
  }}, {json.dumps(target)});
}}
""".strip()
    return run_code_json(collect_js)  # type: ignore[return-value]


def measure_double_click_fill() -> dict:
    prepare_js = f"""
async (page) => {{
  return await page.evaluate(async () => {{
    const {{ state }} = await import('/js/core/state.js');
    const interaction = document.querySelector('#map-svg rect.interaction-layer');
    if (!interaction || !state.landData?.features?.length) {{
      throw new Error('Double-click benchmark prerequisites are unavailable.');
    }}
    const padding = Math.max(16, Math.round(Math.min(state.width, state.height) * 0.04));
    const projection = window.d3
      .geoEqualEarth()
      .precision(0.1)
      .fitExtent(
        [[padding, padding], [Math.max(padding + 1, state.width - padding), Math.max(padding + 1, state.height - padding)]],
        state.landData
      );
    const pathBuilder = window.d3.geoPath(projection);
    const featureCounts = new Map();
    for (const feature of state.landData.features) {{
      const code = String(feature?.properties?.cntr_code || '').trim().toUpperCase();
      featureCounts.set(code, (featureCounts.get(code) || 0) + 1);
    }}
    const candidate = state.landData.features
      .map((feature) => {{
        const code = String(feature?.properties?.cntr_code || '').trim().toUpperCase();
        return {{
          id: String(feature?.properties?.id || ''),
          name: String(feature?.properties?.name || ''),
          code,
          area: window.d3.geoArea(feature),
          countryFeatureCount: featureCounts.get(code) || 0,
          point: pathBuilder.centroid(feature),
        }};
      }})
      .filter((item) => (
        item.code
        && item.code !== 'AQ'
        && item.countryFeatureCount >= 24
        && Number.isFinite(item.point[0])
        && Number.isFinite(item.point[1])
        && item.point[0] > 40
        && item.point[0] < state.width - 40
        && item.point[1] > 40
        && item.point[1] < state.height - 70
      ))
      .sort((left, right) => {{
        if (right.countryFeatureCount !== left.countryFeatureCount) {{
          return right.countryFeatureCount - left.countryFeatureCount;
        }}
        return right.area - left.area;
      }})[0];
    if (!candidate) {{
      throw new Error('Unable to resolve a double-click benchmark target.');
    }}
    window.__benchBaseline = {{
      drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0),
      frames: Number(state.renderPassCache?.counters?.frames || 0),
      transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0),
      dynamicBorderRebuilds: Number(state.renderPassCache?.counters?.dynamicBorderRebuilds || 0),
      longTasks: Array.isArray(window.__perfBench?.longTasks) ? window.__perfBench.longTasks.length : 0,
    }};
    const bounds = interaction.getBoundingClientRect();
    return {{
      ...candidate,
      screenX: bounds.left + candidate.point[0],
      screenY: bounds.top + candidate.point[1],
    }};
  }});
}}
""".strip()
    target = run_code_json(prepare_js)
    action_js = f"""
async (page) => {{
  await page.mouse.move({json.dumps(target["screenX"])}, {json.dumps(target["screenY"])});
  await page.mouse.dblclick({json.dumps(target["screenX"])}, {json.dumps(target["screenY"])});
  await page.waitForTimeout(600);
  return {{ ok: true }};
}}
""".strip()
    run_code_json(action_js)
    collect_js = f"""
async (page) => {{
  return await page.evaluate(async (target) => {{
    const {{ state }} = await import('/js/core/state.js');
    const before = window.__benchBaseline || {{}};
    return {{
      target,
      lastAction: state.renderPassCache?.lastAction || null,
      lastActionDurationMs: Number(state.renderPassCache?.lastActionDurationMs || 0),
      lastActionFrame: {clone_frame_js("state.renderPassCache?.lastActionFrame || null")},
      lastFrame: {clone_frame_js("state.renderPassCache?.lastFrame || null")},
      counterDelta: {{
        drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0) - Number(before.drawCanvas || 0),
        frames: Number(state.renderPassCache?.counters?.frames || 0) - Number(before.frames || 0),
        transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0) - Number(before.transformedFrames || 0),
        dynamicBorderRebuilds: Number(state.renderPassCache?.counters?.dynamicBorderRebuilds || 0) - Number(before.dynamicBorderRebuilds || 0),
      }},
      longTaskCountDelta: (
        Array.isArray(window.__perfBench?.longTasks) ? window.__perfBench.longTasks.length : 0
      ) - Number(before.longTasks || 0),
      renderMetrics: {clone_metrics_js("state.renderPerfMetrics")},
      scenarioMetrics: {clone_metrics_js("state.scenarioPerfMetrics")},
      overlay: document.getElementById('perf-overlay')?.textContent || '',
    }};
  }}, {json.dumps(target)});
}}
""".strip()
    return run_code_json(collect_js)  # type: ignore[return-value]


def run_scenario_suite(base_url: str, scenario_id: str, screenshot_dir: Path) -> dict:
    print(f"[benchmark] start scenario={scenario_id}", flush=True)
    open_page(with_query_overrides(base_url, perf_overlay="1"))
    clear_browser_buffers()
    print(f"[benchmark] apply scenario={scenario_id}", flush=True)
    scenario_apply = apply_scenario(scenario_id)
    print(f"[benchmark] idle redraw scenario={scenario_id}", flush=True)
    idle_full_redraw = force_idle_full_redraw(f"benchmark-{scenario_id}-idle-full-redraw")
    context_probes = measure_context_probes(scenario_id)
    print(f"[benchmark] zoom settle scenario={scenario_id}", flush=True)
    zoom_settle_redraw = measure_zoom_settle_redraw()
    print(f"[benchmark] interactive pan scenario={scenario_id}", flush=True)
    interactive_pan_frame = measure_interactive_pan_frame()
    print(f"[benchmark] single fill scenario={scenario_id}", flush=True)
    single_fill = measure_single_click_fill()
    print(f"[benchmark] double fill scenario={scenario_id}", flush=True)
    double_click_fill = measure_double_click_fill()
    console_issues = capture_console_issues()
    network_issues = capture_network_issues()
    screenshot_path = take_screenshot(screenshot_dir / f"{scenario_id or 'none'}-home.png")
    print(f"[benchmark] done scenario={scenario_id}", flush=True)
    return {
      "scenarioId": scenario_id,
      "scenarioApply": scenario_apply,
      "idleFullRedraw": idle_full_redraw,
      "contextProbes": context_probes,
      "zoomSettleFullRedraw": zoom_settle_redraw,
      "interactivePanFrame": interactive_pan_frame,
      "singleFill": single_fill,
      "doubleClickFill": double_click_fill,
      "consoleIssues": console_issues,
      "networkIssues": network_issues,
      "screenshots": {
        "home": screenshot_path,
      },
    }


def main() -> None:
    args = parse_args()
    if not PWCLI.exists():
      raise SystemExit(f"Missing Playwright CLI wrapper: {PWCLI}")
    PWCLI_WORKDIR.mkdir(parents=True, exist_ok=True)

    out_path = (ROOT_DIR / args.out).resolve()
    screenshot_dir = (ROOT_DIR / args.screenshot_dir).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    screenshot_dir.mkdir(parents=True, exist_ok=True)

    try:
      suites = {scenario_id: run_scenario_suite(args.url, scenario_id, screenshot_dir) for scenario_id in SCENARIO_IDS}
      report = {
        "createdAt": subprocess.run(["date", "-Iseconds"], capture_output=True, text=True, check=True).stdout.strip(),
        "url": args.url,
        "scenarioIds": SCENARIO_IDS,
        "suites": suites,
      }
      out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
      print(json.dumps(report, indent=2, ensure_ascii=False))
    finally:
      close_session()


if __name__ == "__main__":
    main()
