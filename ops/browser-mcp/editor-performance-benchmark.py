#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
PWCLI = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "skills" / "playwright" / "scripts" / "playwright_cli.sh"
SESSION_ID = "editor-perf-benchmark"
BROWSER_OPENED = False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark Map Creator editor performance via Playwright CLI.")
    parser.add_argument("--url", default="http://127.0.0.1:18080/?perf_overlay=1", help="Benchmark target URL.")
    parser.add_argument("--out", default="output/perf/editor-performance-benchmark.json", help="Output JSON path.")
    parser.add_argument("--screenshot-dir", default=".mcp-artifacts/perf", help="Screenshot directory.")
    return parser.parse_args()


def run_pw(*args: str, expect_json: bool = False, timeout_sec: int = 240) -> dict | list | str:
    env = os.environ.copy()
    env["PLAYWRIGHT_CLI_SESSION"] = SESSION_ID
    try:
        proc = subprocess.run(
            ["bash", str(PWCLI), *args],
            cwd=ROOT_DIR,
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
            cwd=ROOT_DIR,
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


def navigate(url: str) -> None:
    js = f"""
async (page) => {{
  page.once('dialog', async (dialog) => {{
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
  await page.waitForFunction(() => typeof window.renderNow === 'function' && !!document.getElementById('map-canvas') && !!document.querySelector('#map-svg rect.interaction-layer'));
  await page.waitForTimeout(750);
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
    run_code_json(js)


def open_page(url: str) -> None:
    global BROWSER_OPENED
    if not BROWSER_OPENED:
        run_pw("open", "about:blank", "--browser", "msedge")
        BROWSER_OPENED = True
    navigate(url)


def force_full_redraw(label: str, context_off: bool = False) -> dict:
    js = f"""
async (page) => {{
  return await page.evaluate(async () => {{
    const {{ state }} = await import('/js/core/state.js');
    const {{ render }} = await import('/js/core/map_renderer.js');
    const cloneFrame = (frame) => frame && typeof frame === 'object'
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
    const label = {json.dumps(label)};
    const contextOff = {json.dumps(bool(context_off))};
    const before = {{
      drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0),
      frames: Number(state.renderPassCache?.counters?.frames || 0),
    }};
    state.showPhysical = !contextOff;
    state.showUrban = !contextOff;
    state.showRivers = !contextOff;
    for (const passName of ['background', 'political', 'effects', 'context', 'borders']) {{
      state.renderPassCache.dirty[passName] = true;
      state.renderPassCache.reasons[passName] = label;
    }}
    render();
    return {{
      visibility: {{
        showPhysical: !!state.showPhysical,
        showUrban: !!state.showUrban,
        showRivers: !!state.showRivers,
      }},
      counterDelta: {{
        drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0) - before.drawCanvas,
        frames: Number(state.renderPassCache?.counters?.frames || 0) - before.frames,
      }},
      lastFrame: cloneFrame(state.renderPassCache.lastFrame),
      overlay: document.getElementById('perf-overlay')?.textContent || '',
    }};
  }});
}}
""".strip()
    return run_code_json(js)  # type: ignore[return-value]


def measure_cached_render_now() -> dict:
    js = """
async (page) => {
  return await page.evaluate(() => {
    const samples = [];
    for (let index = 0; index < 10; index += 1) {
      const startedAt = performance.now();
      window.renderNow();
      samples.push(Number((performance.now() - startedAt).toFixed(3)));
    }
    const averageMs = samples.length
      ? samples.reduce((sum, value) => sum + Number(value || 0), 0) / samples.length
      : 0;
    return {
      samples,
      averageMs: Number(averageMs.toFixed(3)),
    };
  });
}
""".strip()
    return run_code_json(js)  # type: ignore[return-value]


def measure_interactive_pan_frame() -> dict:
    js = """
async (page) => {
  return await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    const { render } = await import('/js/core/map_renderer.js');
    const cloneFrame = (frame) => frame && typeof frame === 'object'
      ? {
        phase: frame.phase || null,
        totalMs: Number(frame.totalMs || 0),
        timings: { ...(frame.timings || {}) },
        transform: {
          x: Number(frame.transform?.x || 0),
          y: Number(frame.transform?.y || 0),
          k: Number(frame.transform?.k || 1),
        },
      }
      : null;
    for (const passName of ['background', 'political', 'effects', 'context', 'borders']) {
      state.renderPassCache.dirty[passName] = true;
      state.renderPassCache.reasons[passName] = 'interactive-bench-prime';
    }
    state.renderPhase = 'idle';
    render();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const before = {
      drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0),
      frames: Number(state.renderPassCache?.counters?.frames || 0),
      transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0),
    };
    const originalTransform = {
      ...(state.zoomTransform || { x: 0, y: 0, k: 1 }),
    };

    state.renderPhase = 'interacting';
    state.zoomTransform = {
      x: originalTransform.x + 42,
      y: originalTransform.y + 24,
      k: Number((originalTransform.k * 1.08).toFixed(4)),
    };
    render();
    const interactiveFrame = cloneFrame(state.renderPassCache.lastFrame);
    const deltas = {
      drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0) - before.drawCanvas,
      frames: Number(state.renderPassCache?.counters?.frames || 0) - before.frames,
      transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0) - before.transformedFrames,
    };

    state.renderPhase = 'idle';
    state.zoomTransform = originalTransform;
    render();
    const restoredFrame = cloneFrame(state.renderPassCache.lastFrame);
    return {
      interactiveFrame,
      deltas,
      restoredFrame,
    };
  });
}
""".strip()
    return run_code_json(js)  # type: ignore[return-value]


def measure_single_click_fill() -> dict:
    prepare_js = """
async (page) => {
  return await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    const interaction = document.querySelector('#map-svg rect.interaction-layer');
    const customColor = document.getElementById('customColor');
    if (!interaction || !customColor || !state.landData?.features?.length) {
      throw new Error('Single-click benchmark prerequisites are unavailable.');
    }
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
      .map((feature) => ({
        id: String(feature?.properties?.id || ''),
        name: String(feature?.properties?.name || ''),
        code: String(feature?.properties?.cntr_code || '').trim().toUpperCase(),
        area: window.d3.geoArea(feature),
        point: pathBuilder.centroid(feature),
      }))
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
    if (!candidate) {
      throw new Error('Unable to resolve a single-click benchmark target.');
    }
    customColor.value = '#ff00aa';
    customColor.dispatchEvent(new Event('input', { bubbles: true }));
    window.__benchBaseline = {
      drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0),
      frames: Number(state.renderPassCache?.counters?.frames || 0),
      transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0),
      sidebar: { ...(state.sidebarPerf?.counters || {}) },
      longTasks: Array.isArray(window.__perfBench?.longTasks) ? window.__perfBench.longTasks.length : 0,
    };
    return {
      ...candidate,
      screenX: bounds.left + candidate.point[0],
      screenY: bounds.top + candidate.point[1],
    };
  });
}
""".strip()
    target = run_code_json(prepare_js)
    action_js = f"""
async (page) => {{
  await page.mouse.move({json.dumps(target["screenX"])}, {json.dumps(target["screenY"])});
  await page.mouse.click({json.dumps(target["screenX"])}, {json.dumps(target["screenY"])});
  await page.waitForTimeout(400);
  return {{ ok: true }};
}}
""".strip()
    run_code_json(action_js)
    collect_js = f"""
async (page) => {{
  return await page.evaluate(async (target) => {{
    const {{ state }} = await import('/js/core/state.js');
    const cloneFrame = (frame) => frame && typeof frame === 'object'
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
    const before = window.__benchBaseline;
    const currentSidebar = state.sidebarPerf?.counters || {{}};
    return {{
      target,
      lastAction: state.renderPassCache?.lastAction || null,
      lastActionDurationMs: Number(state.renderPassCache?.lastActionDurationMs || 0),
      lastActionFrame: cloneFrame(state.renderPassCache?.lastActionFrame || null),
      lastFrame: cloneFrame(state.renderPassCache?.lastFrame || null),
      counterDelta: {{
        drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0) - Number(before.drawCanvas || 0),
        frames: Number(state.renderPassCache?.counters?.frames || 0) - Number(before.frames || 0),
        transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0) - Number(before.transformedFrames || 0),
      }},
      sidebarDelta: Object.fromEntries(
        Object.entries(currentSidebar).map(([key, value]) => [
          key,
          Number(value || 0) - Number(before.sidebar?.[key] || 0),
        ])
      ),
      longTaskCountDelta: (
        Array.isArray(window.__perfBench?.longTasks) ? window.__perfBench.longTasks.length : 0
      ) - Number(before.longTasks || 0),
    }};
  }}, {json.dumps(target)});
}}
""".strip()
    return run_code_json(collect_js)  # type: ignore[return-value]


def measure_double_click_fill() -> dict:
    prepare_js = """
async (page) => {
  return await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    const interaction = document.querySelector('#map-svg rect.interaction-layer');
    const customColor = document.getElementById('customColor');
    if (!interaction || !customColor || !state.landData?.features?.length) {
      throw new Error('Double-click benchmark prerequisites are unavailable.');
    }
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
    for (const feature of state.landData.features) {
      const code = String(feature?.properties?.cntr_code || '').trim().toUpperCase();
      featureCounts.set(code, (featureCounts.get(code) || 0) + 1);
    }
    const candidate = state.landData.features
      .map((feature) => {
        const code = String(feature?.properties?.cntr_code || '').trim().toUpperCase();
        return {
          id: String(feature?.properties?.id || ''),
          name: String(feature?.properties?.name || ''),
          code,
          area: window.d3.geoArea(feature),
          countryFeatureCount: featureCounts.get(code) || 0,
          point: pathBuilder.centroid(feature),
        };
      })
      .filter((item) => (
        item.code === 'CN'
        && item.countryFeatureCount >= 100
        && Number.isFinite(item.point[0])
        && Number.isFinite(item.point[1])
        && item.point[0] > 40
        && item.point[0] < state.width - 40
        && item.point[1] > 40
        && item.point[1] < state.height - 70
      ))
      .sort((left, right) => right.area - left.area)[0];
    if (!candidate) {
      throw new Error('Unable to resolve a double-click benchmark target.');
    }
    customColor.value = '#11dd66';
    customColor.dispatchEvent(new Event('input', { bubbles: true }));
    window.__benchBaseline = {
      drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0),
      frames: Number(state.renderPassCache?.counters?.frames || 0),
      transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0),
      sidebar: { ...(state.sidebarPerf?.counters || {}) },
      longTasks: Array.isArray(window.__perfBench?.longTasks) ? window.__perfBench.longTasks.length : 0,
    };
    const bounds = interaction.getBoundingClientRect();
    return {
      ...candidate,
      screenX: bounds.left + candidate.point[0],
      screenY: bounds.top + candidate.point[1],
    };
  });
}
""".strip()
    target = run_code_json(prepare_js)
    action_js = f"""
async (page) => {{
  await page.mouse.move({json.dumps(target["screenX"])}, {json.dumps(target["screenY"])});
  await page.mouse.dblclick({json.dumps(target["screenX"])}, {json.dumps(target["screenY"])});
  await page.waitForTimeout(500);
  return {{ ok: true }};
}}
""".strip()
    run_code_json(action_js)
    collect_js = f"""
async (page) => {{
  return await page.evaluate(async (target) => {{
    const {{ state }} = await import('/js/core/state.js');
    const cloneFrame = (frame) => frame && typeof frame === 'object'
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
    const before = window.__benchBaseline;
    const currentSidebar = state.sidebarPerf?.counters || {{}};
    const colorMatchCount = Object.values(state.colors || {{}}).filter(
      (value) => String(value || '').toLowerCase() === '#11dd66'
    ).length;
    return {{
      target,
      colorMatchCount,
      lastAction: state.renderPassCache?.lastAction || null,
      lastActionDurationMs: Number(state.renderPassCache?.lastActionDurationMs || 0),
      lastActionFrame: cloneFrame(state.renderPassCache?.lastActionFrame || null),
      lastFrame: cloneFrame(state.renderPassCache?.lastFrame || null),
      counterDelta: {{
        drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0) - Number(before.drawCanvas || 0),
        frames: Number(state.renderPassCache?.counters?.frames || 0) - Number(before.frames || 0),
        transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0) - Number(before.transformedFrames || 0),
      }},
      sidebarDelta: Object.fromEntries(
        Object.entries(currentSidebar).map(([key, value]) => [
          key,
          Number(value || 0) - Number(before.sidebar?.[key] || 0),
        ])
      ),
      longTaskCountDelta: (
        Array.isArray(window.__perfBench?.longTasks) ? window.__perfBench.longTasks.length : 0
      ) - Number(before.longTasks || 0),
    }};
  }}, {json.dumps(target)});
}}
""".strip()
    return run_code_json(collect_js)  # type: ignore[return-value]


def capture_console_issues() -> list[str]:
    output = run_pw("console", "warning")
    return [line for line in str(output).splitlines() if line.strip()]


def capture_network_issues() -> list[str]:
    output = run_pw("network")
    return [line for line in str(output).splitlines() if line.strip()]


def clear_browser_buffers() -> None:
    run_pw("console", "warning", "--clear")
    run_pw("network", "--clear")


def take_screenshot(target_path: Path) -> str:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    relative_target = target_path.resolve().relative_to(ROOT_DIR).as_posix()
    run_pw("screenshot", "--filename", relative_target, "--full-page", timeout_sec=120)
    if not target_path.exists():
        raise RuntimeError(f"Screenshot was not created at {target_path}")
    return str(target_path)


def main() -> None:
    args = parse_args()
    if not PWCLI.exists():
      raise SystemExit(f"Missing Playwright CLI wrapper: {PWCLI}")

    out_path = (ROOT_DIR / args.out).resolve()
    screenshot_dir = (ROOT_DIR / args.screenshot_dir).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    screenshot_dir.mkdir(parents=True, exist_ok=True)

    try:
        open_page(args.url)
        default_forced_full_redraw = force_full_redraw("benchmark-default", context_off=False)
        cached_render_now = measure_cached_render_now()
        interactive_pan_frame = measure_interactive_pan_frame()
        single_click_fill = measure_single_click_fill()
        double_click_fill = measure_double_click_fill()

        open_page("http://127.0.0.1:18080/?detail_layer=off&perf_overlay=1")
        detail_layer_off_forced_full_redraw = force_full_redraw("benchmark-detail-off", context_off=False)

        open_page("http://127.0.0.1:18080/?perf_overlay=1")
        context_layers_disabled_forced_full_redraw = force_full_redraw("benchmark-context-off", context_off=True)

        open_page(args.url)
        console_issues = capture_console_issues()
        network_issues = capture_network_issues()

        screenshots = {
            "home": take_screenshot(screenshot_dir / "editor-home.png"),
        }
        run_code_json(
            """
async (page) => {
  return await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    const { render } = await import('/js/core/map_renderer.js');
    state.renderPhase = 'interacting';
    state.zoomTransform = { x: 42, y: 24, k: 1.08 };
    render();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return state.renderPassCache.lastFrame || null;
  });
}
""".strip()
        )
        screenshots["interacting"] = take_screenshot(screenshot_dir / "editor-interacting.png")

        report = {
            "createdAt": subprocess.run(["date", "-Iseconds"], capture_output=True, text=True, check=True).stdout.strip(),
            "url": args.url,
            "metrics": {
                "defaultForcedFullRedraw": default_forced_full_redraw,
                "cachedRenderNow": cached_render_now,
                "detailLayerOffForcedFullRedraw": detail_layer_off_forced_full_redraw,
                "contextLayersDisabledForcedFullRedraw": context_layers_disabled_forced_full_redraw,
                "interactivePanFrame": interactive_pan_frame,
                "singleClickFill": single_click_fill,
                "doubleClickFill": double_click_fill,
            },
            "consoleIssues": console_issues,
            "networkIssues": network_issues,
            "screenshots": screenshots,
        }

        out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps(report, indent=2, ensure_ascii=False))
    finally:
        close_session()


if __name__ == "__main__":
    main()
