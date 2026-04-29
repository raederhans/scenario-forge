#!/usr/bin/env python3

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
import os
import sys
from queue import Empty, Queue
import re
import subprocess
from threading import Lock, Thread
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


ROOT_DIR = Path(__file__).resolve().parents[2]
PWCLI_WORKDIR = ROOT_DIR / ".runtime" / "browser" / "playwright-cli"
SESSION_ID = "editor-perf-benchmark"
BROWSER_OPENED = False
SCENARIO_IDS = ["none", "hoi4_1939", "tno_1962"]
RENDER_PASS_NAMES = ["background", "political", "effects", "contextBase", "contextScenario", "dayNight", "borders"]
BROWSER_OPEN_TIMEOUT_SEC = 45
OPEN_BROWSER_CANDIDATES = ("msedge", "chromium")
WRAPPER_BACKEND = "wrapper"
LOCAL_NODE_PLAYWRIGHT_BACKEND = "local-node-playwright"
LOCAL_NODE_PLAYWRIGHT_HEADLESS = os.environ.get("EDITOR_PERF_BENCHMARK_FALLBACK_HEADLESS", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
PLAYWRIGHT_BACKEND = WRAPPER_BACKEND
CONTEXT_PROBE_CASES = [
    ("baseline", {}),
    ("physical_off", {"showPhysical": False}),
    ("urban_off", {"showUrban": False}),
    ("rivers_off", {"showRivers": False}),
    ("water_off", {"showWaterRegions": False}),
    ("physical_urban_rivers_off", {"showPhysical": False, "showUrban": False, "showRivers": False}),
]
CONTEXT_PROBE_SAMPLE_COUNT = 5
CONTEXT_PROBE_MIN_SAMPLES_FOR_RECOMMENDATION = 3
WSL_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
WSL_GATEWAY_HOST = None
WATER_CACHE_REPORT_PATH = ".runtime/reports/generated/editor-performance-water-cache-summary.json"


def resolve_playwright_cli_wrapper() -> Path:
    candidate_roots: list[Path] = []
    seen_roots: set[Path] = set()

    def add_root(root: Path | None) -> None:
        if root is None:
            return
        normalized = root.expanduser().resolve()
        if normalized in seen_roots:
            return
        candidate_roots.append(normalized)
        seen_roots.add(normalized)

    codex_home_env = os.environ.get("CODEX_HOME")
    if codex_home_env:
        add_root(Path(codex_home_env))

    home_dir = Path.home()
    add_root(home_dir / ".codex")
    if home_dir.name == "powershell-profile-home" and home_dir.parent.name == ".codex":
        add_root(home_dir.parent)

    for root in candidate_roots:
        wrapper_path = root / "skills" / "playwright" / "scripts" / "playwright_cli.sh"
        if wrapper_path.exists():
            return wrapper_path

    fallback_root = candidate_roots[0] if candidate_roots else (home_dir / ".codex")
    return fallback_root / "skills" / "playwright" / "scripts" / "playwright_cli.sh"


PWCLI = resolve_playwright_cli_wrapper()

LOCAL_NODE_PLAYWRIGHT_WORKER = r"""
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function serializeError(error) {
  if (!error) {
    return { message: 'Unknown error', stack: null };
  }
  return {
    message: String(error.message || error),
    stack: error.stack ? String(error.stack) : null,
  };
}

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  process.stdout.write(JSON.stringify({ type: 'ready', ok: false, error: serializeError(error) }) + '\n');
  process.exit(0);
}

let browser = null;
let context = null;
let page = null;
let activeBrowserName = null;
let consoleIssues = [];
let networkIssues = [];
const MAX_ISSUES = 400;

function pushBounded(target, value) {
  target.push(value);
  if (target.length > MAX_ISSUES) {
    target.splice(0, target.length - MAX_ISSUES);
  }
}

function ensurePageListeners(targetPage) {
  if (!targetPage || targetPage.__editorPerfListenersAttached) {
    return;
  }
  targetPage.__editorPerfListenersAttached = true;
  targetPage.on('console', (message) => {
    pushBounded(consoleIssues, {
      type: String(message.type() || 'log'),
      text: String(message.text() || ''),
      location: message.location() || null,
    });
  });
  targetPage.on('pageerror', (error) => {
    pushBounded(consoleIssues, {
      type: 'pageerror',
      text: String(error?.message || error || ''),
      location: null,
    });
  });
  targetPage.on('requestfailed', (request) => {
    pushBounded(networkIssues, {
      kind: 'requestfailed',
      url: String(request.url() || ''),
      method: String(request.method() || ''),
      status: null,
      failureText: String(request.failure()?.errorText || ''),
    });
  });
  targetPage.on('response', (response) => {
    const status = Number(response.status() || 0);
    if (status < 400) {
      return;
    }
    pushBounded(networkIssues, {
      kind: 'response',
      url: String(response.url() || ''),
      method: String(response.request()?.method?.() || ''),
      status,
      failureText: '',
    });
  });
}

async function closeBrowser() {
  if (page) {
    await page.close().catch(() => {});
    page = null;
  }
  if (context) {
    await context.close().catch(() => {});
    context = null;
  }
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
  activeBrowserName = null;
}

async function ensurePage(payload) {
  const requestedBrowser = String(payload?.browserName || 'chromium');
  const launchOptions = { headless: !!payload?.headless };
  if (requestedBrowser === 'msedge') {
    launchOptions.channel = 'msedge';
  }
  if (!browser || !page || activeBrowserName !== requestedBrowser) {
    await closeBrowser();
    browser = await chromium.launch(launchOptions);
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    activeBrowserName = requestedBrowser;
    ensurePageListeners(page);
  }
  return page;
}

function formatConsoleIssue(issue) {
  return `[${issue.type}] ${issue.text}`.trim();
}

function formatNetworkIssue(issue) {
  const parts = [`[${issue.kind}]`];
  if (issue.status) {
    parts.push(String(issue.status));
  }
  if (issue.method) {
    parts.push(issue.method);
  }
  if (issue.url) {
    parts.push(issue.url);
  }
  if (issue.failureText) {
    parts.push(issue.failureText);
  }
  return parts.join(' ').trim();
}

async function handleRequest(request) {
  switch (request.command) {
    case 'open': {
      const payload = request.payload || {};
      const targetPage = await ensurePage(payload);
      const url = String(payload.url || '').trim();
      if (url) {
        await targetPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      }
      return {
        browserName: activeBrowserName || String(payload.browserName || 'chromium'),
        headless: !!payload.headless,
        url: targetPage.url(),
      };
    }
    case 'run-code': {
      if (!page) {
        throw new Error('No active Playwright page for run-code.');
      }
      const fn = eval(String(request.payload?.code || ''));
      if (typeof fn !== 'function') {
        throw new Error('run-code payload did not evaluate to a function.');
      }
      return await fn(page);
    }
    case 'console': {
      const level = String(request.payload?.level || '').toLowerCase();
      const entries = consoleIssues.filter((issue) => {
        if (level === 'warning') {
          return ['warning', 'error', 'assert', 'pageerror'].includes(issue.type);
        }
        return true;
      }).map(formatConsoleIssue);
      if (request.payload?.clear) {
        consoleIssues = [];
      }
      return entries;
    }
    case 'network': {
      const entries = networkIssues.map(formatNetworkIssue);
      if (request.payload?.clear) {
        networkIssues = [];
      }
      return entries;
    }
    case 'screenshot': {
      if (!page) {
        throw new Error('No active Playwright page for screenshot.');
      }
      const filename = path.resolve(String(request.payload?.filename || ''));
      await fs.promises.mkdir(path.dirname(filename), { recursive: true });
      await page.screenshot({ path: filename, fullPage: !!request.payload?.fullPage });
      return filename;
    }
    case 'close': {
      await closeBrowser();
      return { ok: true };
    }
    default:
      throw new Error(`Unsupported fallback command: ${request.command}`);
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

let chain = Promise.resolve();
process.stdout.write(JSON.stringify({ type: 'ready', ok: true }) + '\n');
rl.on('line', (line) => {
  if (!line) {
    return;
  }
  chain = chain.then(async () => {
    let request = null;
    try {
      request = JSON.parse(line);
      const result = await handleRequest(request);
      process.stdout.write(JSON.stringify({ id: request.id, ok: true, result }) + '\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({
        id: request?.id ?? null,
        ok: false,
        error: serializeError(error),
      }) + '\n');
    }
  });
});
""".strip()


class LocalPlaywrightWorker:
    def __init__(self) -> None:
      self.proc = subprocess.Popen(
          ["node", "-e", LOCAL_NODE_PLAYWRIGHT_WORKER],
          cwd=ROOT_DIR,
          stdin=subprocess.PIPE,
          stdout=subprocess.PIPE,
          stderr=subprocess.PIPE,
          text=True,
          encoding="utf-8",
          errors="replace",
          bufsize=1,
      )
      if self.proc.stdin is None or self.proc.stdout is None or self.proc.stderr is None:
          raise RuntimeError("Failed to create local Playwright fallback worker pipes.")
      self.stdin = self.proc.stdin
      self.stdout_queue: Queue[str] = Queue()
      self.stderr_queue: Queue[str] = Queue()
      self._request_lock = Lock()
      self._request_id = 0
      Thread(target=self._pump_stream, args=(self.proc.stdout, self.stdout_queue), daemon=True).start()
      Thread(target=self._pump_stream, args=(self.proc.stderr, self.stderr_queue), daemon=True).start()
      ready = self._read_message(15)
      if not ready.get("ok"):
          error_message = ready.get("error", {}).get("message") if isinstance(ready.get("error"), dict) else ready.get("error")
          self.stop()
          raise RuntimeError(f"Local Playwright fallback worker failed to start: {error_message}")

    @staticmethod
    def _pump_stream(stream, queue: Queue[str]) -> None:
      try:
          for line in iter(stream.readline, ""):
              if line:
                  queue.put(line)
      finally:
          stream.close()

    def _collect_stderr(self) -> str:
      chunks: list[str] = []
      while True:
          try:
              chunks.append(self.stderr_queue.get_nowait())
          except Empty:
              break
      return "".join(chunks).strip()

    def _read_message(self, timeout_sec: int) -> dict:
      try:
          raw_line = self.stdout_queue.get(timeout=timeout_sec)
      except Empty as exc:
          stderr_output = self._collect_stderr()
          raise RuntimeError(
              "Timed out waiting for local Playwright fallback worker response."
              + (f"\nSTDERR:\n{stderr_output}" if stderr_output else "")
          ) from exc
      try:
          return json.loads(raw_line)
      except json.JSONDecodeError as exc:
          stderr_output = self._collect_stderr()
          raise RuntimeError(
              "Failed to parse local Playwright fallback worker output."
              f"\nSTDOUT:\n{raw_line.strip()}"
              + (f"\nSTDERR:\n{stderr_output}" if stderr_output else "")
          ) from exc

    def request(self, command: str, payload: dict | None = None, timeout_sec: int = 240) -> object:
      if self.proc.poll() is not None:
          stderr_output = self._collect_stderr()
          raise RuntimeError(
              "Local Playwright fallback worker exited unexpectedly."
              + (f"\nSTDERR:\n{stderr_output}" if stderr_output else "")
          )
      with self._request_lock:
          self._request_id += 1
          self.stdin.write(json.dumps({
              "id": self._request_id,
              "command": command,
              "payload": payload or {},
          }) + "\n")
          self.stdin.flush()
          response = self._read_message(timeout_sec)
      if not response.get("ok"):
          error = response.get("error")
          message = error.get("message") if isinstance(error, dict) else str(error)
          stack = error.get("stack") if isinstance(error, dict) else None
          raise RuntimeError(message + (f"\n{stack}" if stack else ""))
      return response.get("result")

    def stop(self) -> None:
      if self.proc.poll() is None:
          self.proc.terminate()
          try:
              self.proc.wait(timeout=5)
          except subprocess.TimeoutExpired:
              self.proc.kill()
      self._collect_stderr()


LOCAL_PLAYWRIGHT_WORKER_SESSION: LocalPlaywrightWorker | None = None


def ensure_local_playwright_worker() -> LocalPlaywrightWorker:
    global LOCAL_PLAYWRIGHT_WORKER_SESSION
    if LOCAL_PLAYWRIGHT_WORKER_SESSION is None:
      LOCAL_PLAYWRIGHT_WORKER_SESSION = LocalPlaywrightWorker()
    return LOCAL_PLAYWRIGHT_WORKER_SESSION


def stop_local_playwright_worker() -> None:
    global LOCAL_PLAYWRIGHT_WORKER_SESSION
    if LOCAL_PLAYWRIGHT_WORKER_SESSION is None:
      return
    LOCAL_PLAYWRIGHT_WORKER_SESSION.stop()
    LOCAL_PLAYWRIGHT_WORKER_SESSION = None


def normalize_bash_path(path: Path) -> str:
    resolved = path.resolve()
    posix_path = resolved.as_posix()
    if os.name != "nt":
        return posix_path
    drive, tail = os.path.splitdrive(posix_path)
    if drive:
        return f"/mnt/{drive[0].lower()}{tail}"
    return posix_path


def resolve_wsl_gateway_host() -> str | None:
    global WSL_GATEWAY_HOST
    if WSL_GATEWAY_HOST is not None:
        return WSL_GATEWAY_HOST or None
    if os.name != "nt":
        WSL_GATEWAY_HOST = ""
        return None
    try:
        proc = subprocess.run(
            ["bash", "-lc", "ip route show default"],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
    except (subprocess.SubprocessError, OSError):
        WSL_GATEWAY_HOST = ""
        return None
    gateway_host = ""
    if proc.returncode == 0:
        match = re.search(r"\bvia\s+(\S+)", proc.stdout)
        gateway_host = match.group(1).strip() if match else ""
    WSL_GATEWAY_HOST = gateway_host
    return gateway_host or None


def normalize_playwright_url(url: str) -> str:
    if os.name != "nt":
        return url
    parts = urlsplit(url)
    hostname = parts.hostname or ""
    if hostname.lower() not in WSL_LOOPBACK_HOSTS:
        return url
    gateway_host = resolve_wsl_gateway_host()
    if not gateway_host:
        return url
    auth = ""
    if parts.username:
        auth = parts.username
        if parts.password:
            auth += f":{parts.password}"
        auth += "@"
    port = f":{parts.port}" if parts.port else ""
    netloc = f"{auth}{gateway_host}{port}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def resolve_git_head() -> str:
    try:
      completed = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT_DIR,
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
      )
      return completed.stdout.strip()
    except Exception:
      return "unknown"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark Scenario Forge editor performance via Playwright CLI.")
    parser.add_argument("--url", default="http://127.0.0.1:8000/?perf_overlay=1", help="Benchmark target URL.")
    parser.add_argument(
        "--out",
        default=".runtime/output/perf/editor-performance-benchmark.json",
        help="Output JSON path.",
    )
    parser.add_argument("--screenshot-dir", default=".runtime/browser/mcp-artifacts/perf", help="Screenshot directory.")
    parser.add_argument(
        "--repeated-zoom-regions",
        default="europe,us_east,east_asia",
        help="Comma-separated repeated zoom region ids for the TNO interaction probe.",
    )
    parser.add_argument("--repeated-zoom-cycles", type=positive_int, default=8, help="Repeated zoom cycles per region.")
    parser.add_argument(
        "--repeated-zoom-wheels-per-cycle",
        type=positive_int,
        default=5,
        help="Wheel events per repeated zoom cycle.",
    )
    return parser.parse_args()


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
      raise argparse.ArgumentTypeError("value must be a positive integer")
    return parsed


def parse_repeated_zoom_regions(value: str) -> list[str]:
    regions = [entry.strip() for entry in str(value or "").split(",") if entry.strip()]
    if not regions:
      raise ValueError("--repeated-zoom-regions must contain at least one region id.")
    return list(dict.fromkeys(regions))


def run_wrapper_pw(*args: str, expect_json: bool = False, timeout_sec: int = 240) -> dict | list | str:
    env = os.environ.copy()
    env["PLAYWRIGHT_CLI_SESSION"] = SESSION_ID
    PWCLI_WORKDIR.mkdir(parents=True, exist_ok=True)
    try:
      proc = subprocess.run(
          ["bash", normalize_bash_path(PWCLI), *args],
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


def run_local_pw(*args: str, expect_json: bool = False, timeout_sec: int = 240) -> dict | list | str:
    if not args:
      raise RuntimeError("Missing local Playwright fallback command.")
    command = args[0]
    worker = ensure_local_playwright_worker()
    if command == "open":
      browser_name = "chromium"
      if "--browser" in args:
          browser_index = args.index("--browser")
          if browser_index + 1 >= len(args):
              raise RuntimeError("Missing browser name for local Playwright fallback open command.")
          browser_name = args[browser_index + 1]
      result = worker.request("open", {
          "url": args[1] if len(args) > 1 else "",
          "browserName": browser_name,
          "headless": LOCAL_NODE_PLAYWRIGHT_HEADLESS,
      }, timeout_sec=timeout_sec)
      return result if expect_json else str(result)
    if command == "run-code":
      result = worker.request("run-code", {"code": args[1] if len(args) > 1 else ""}, timeout_sec=timeout_sec)
      return result if expect_json else json.dumps(result, ensure_ascii=False)
    if command == "console":
      level = args[1] if len(args) > 1 and not args[1].startswith("--") else ""
      result = worker.request("console", {
          "level": level,
          "clear": "--clear" in args,
      }, timeout_sec=timeout_sec)
      if expect_json:
          return result
      return "\n".join(str(line) for line in result if str(line).strip())
    if command == "network":
      result = worker.request("network", {"clear": "--clear" in args}, timeout_sec=timeout_sec)
      if expect_json:
          return result
      return "\n".join(str(line) for line in result if str(line).strip())
    if command == "screenshot":
      filename = ""
      if "--filename" in args:
          filename_index = args.index("--filename")
          if filename_index + 1 >= len(args):
              raise RuntimeError("Missing filename for local Playwright fallback screenshot command.")
          filename = args[filename_index + 1]
      result = worker.request("screenshot", {
          "filename": filename,
          "fullPage": "--full-page" in args,
      }, timeout_sec=timeout_sec)
      return result if expect_json else str(result)
    if command == "close":
      result = worker.request("close", {}, timeout_sec=min(timeout_sec, 30))
      return result if expect_json else str(result)
    raise RuntimeError(f"Unsupported local Playwright fallback command: {' '.join(args)}")


def run_pw(*args: str, expect_json: bool = False, timeout_sec: int = 240) -> dict | list | str:
    if PLAYWRIGHT_BACKEND == LOCAL_NODE_PLAYWRIGHT_BACKEND:
      return run_local_pw(*args, expect_json=expect_json, timeout_sec=timeout_sec)
    return run_wrapper_pw(*args, expect_json=expect_json, timeout_sec=timeout_sec)


def close_session() -> None:
    global BROWSER_OPENED, PLAYWRIGHT_BACKEND
    if PLAYWRIGHT_BACKEND == LOCAL_NODE_PLAYWRIGHT_BACKEND:
      try:
          run_local_pw("close", timeout_sec=10)
      except RuntimeError:
          pass
      stop_local_playwright_worker()
      PLAYWRIGHT_BACKEND = WRAPPER_BACKEND
      BROWSER_OPENED = False
      return
    env = os.environ.copy()
    env["PLAYWRIGHT_CLI_SESSION"] = SESSION_ID
    PWCLI_WORKDIR.mkdir(parents=True, exist_ok=True)
    try:
      subprocess.run(
          ["bash", normalize_bash_path(PWCLI), "close"],
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


def run_code_json(js_code: str, timeout_sec: int = 240) -> dict | list | str:
    compact = " ".join(line.strip() for line in js_code.splitlines() if line.strip())
    return run_pw("run-code", compact, expect_json=True, timeout_sec=timeout_sec)


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


def clone_runtime_chunk_load_state_summary_js(source: str = "state.runtimeChunkLoadState") -> str:
    return f"""(() => {{
      const loadState = {source} || {{}};
      const countList = (value) => Array.isArray(value) ? value.length : 0;
      const countKeys = (value) => value && typeof value === 'object' ? Object.keys(value).length : 0;
      const lastSelection = loadState.lastSelection && typeof loadState.lastSelection === 'object'
        ? loadState.lastSelection
        : {{}};
      const pendingPostCommitRefresh = loadState.pendingPostCommitRefresh && typeof loadState.pendingPostCommitRefresh === 'object'
        ? loadState.pendingPostCommitRefresh
        : null;
      const cloneZoomMetric = (metric) => metric && typeof metric === 'object'
        ? {{
          durationMs: Number(metric.durationMs || 0),
          recordedAt: Number(metric.recordedAt || 0),
          scenarioId: String(metric.scenarioId || ''),
          zoom: Number(metric.zoom || 0),
          threshold: Number(metric.threshold || 0),
          focusCountry: String(metric.focusCountry || ''),
          requiredPoliticalChunkCount: Number(metric.requiredPoliticalChunkCount || 0),
          requiredChunkCount: Number(metric.requiredChunkCount || 0),
          loadedChunkCount: Number(metric.loadedChunkCount || 0),
          selectionVersion: Number(metric.selectionVersion || 0),
          promotionRetryCount: Number(metric.promotionRetryCount || 0),
          pendingReason: String(metric.pendingReason || ''),
        }}
        : null;
      return {{
        shellStatus: String(loadState.shellStatus || ''),
        registryStatus: String(loadState.registryStatus || ''),
        refreshScheduled: !!loadState.refreshScheduled,
        selectionVersion: Number(loadState.selectionVersion || 0),
        pendingReason: String(loadState.pendingReason || ''),
        pendingDelayMs: Number.isFinite(Number(loadState.pendingDelayMs)) ? Number(loadState.pendingDelayMs) : null,
        focusCountryOverride: String(loadState.focusCountryOverride || ''),
        focusCountryOverrideSource: String(loadState.focusCountryOverrideSource || ''),
        focusCountryOverrideExpiresAt: Number(loadState.focusCountryOverrideExpiresAt || 0),
        zoomEndProtectedChunkCount: countList(loadState.zoomEndProtectedChunkIds),
        zoomEndProtectedUntil: Number(loadState.zoomEndProtectedUntil || 0),
        zoomEndProtectedSelectionVersion: Number(loadState.zoomEndProtectedSelectionVersion || 0),
        zoomEndProtectedScenarioId: String(loadState.zoomEndProtectedScenarioId || ''),
        zoomEndProtectedFocusCountry: String(loadState.zoomEndProtectedFocusCountry || ''),
        pendingVisualPromotionPresent: !!loadState.pendingVisualPromotion,
        pendingInfraPromotionPresent: !!loadState.pendingInfraPromotion,
        pendingPromotionPresent: !!loadState.pendingPromotion,
        promotionScheduled: !!loadState.promotionScheduled,
        promotionCommitInFlight: !!loadState.promotionCommitInFlight,
        promotionCommitRunId: Number(loadState.promotionCommitRunId || 0),
        promotionCommitStatus: String(loadState.promotionCommitStatus || ''),
        promotionCommitScenarioId: String(loadState.promotionCommitScenarioId || ''),
        promotionCommitSelectionVersion: Number(loadState.promotionCommitSelectionVersion || 0),
        promotionCommitReason: String(loadState.promotionCommitReason || ''),
        promotionCommitStartedAt: Number(loadState.promotionCommitStartedAt || 0),
        promotionCommitFinishedAt: Number(loadState.promotionCommitFinishedAt || 0),
        promotionCommitError: String(loadState.promotionCommitError || ''),
        pendingPostCommitRefresh: pendingPostCommitRefresh ? {{
          scenarioId: String(pendingPostCommitRefresh.scenarioId || ''),
          selectionVersion: Number(pendingPostCommitRefresh.selectionVersion || 0),
          reason: String(pendingPostCommitRefresh.reason || ''),
          delayMs: Number(pendingPostCommitRefresh.delayMs || 0),
          refreshSourceStartedAtMs: Number(pendingPostCommitRefresh.refreshSourceStartedAtMs || 0),
        }} : null,
        promotionRetryCount: Number(loadState.promotionRetryCount || 0),
        lastPromotionRetryAt: Number(loadState.lastPromotionRetryAt || 0),
        inFlightChunkCount: countKeys(loadState.inFlightByChunkId),
        errorChunkCount: countKeys(loadState.errorByChunkId),
        lastSelection: {{
          reason: String(lastSelection.reason || ''),
          scenarioId: String(lastSelection.scenarioId || ''),
          selectionVersion: Number(lastSelection.selectionVersion || 0),
          focusCountry: String(lastSelection.focusCountry || ''),
          recordedAt: Number(lastSelection.recordedAt || 0),
          requiredChunkCount: countList(lastSelection.requiredChunkIds),
          optionalChunkCount: countList(lastSelection.optionalChunkIds),
          cacheOnlyChunkCount: countList(lastSelection.cacheOnlyChunkIds),
          zoomEndProtectionUntil: Number(lastSelection.zoomEndProtectionUntil || 0),
        }},
        layerSelectionSignatureCount: countKeys(loadState.layerSelectionSignatures),
        mergedLayerPayloadCacheLayerCount: countKeys(loadState.mergedLayerPayloadCache),
        zoomEndChunkVisibleMetric: cloneZoomMetric(loadState.zoomEndChunkVisibleMetric),
        lastZoomEndToChunkVisibleMetric: cloneZoomMetric(loadState.lastZoomEndToChunkVisibleMetric),
      }};
    }})()"""


def clone_repeated_zoom_render_metrics_summary_js(source: str = "state.renderPerfMetrics") -> str:
    return f"""(() => {{
      const metrics = {source} || {{}};
      const clone = (value) => value && typeof value === 'object'
        ? JSON.parse(JSON.stringify(value))
        : null;
      return {{
        blackFrameCount: clone(metrics.blackFrameCount),
        chunkSelectionMs: clone(metrics.chunkSelectionMs),
        selectedFeatureCountSum: clone(metrics.selectedFeatureCountSum),
        chunkMergeMs: clone(metrics.chunkMergeMs),
        scenarioChunkPromotionVisualStage: clone(metrics.scenarioChunkPromotionVisualStage),
        zoomEndToChunkVisibleMs: clone(metrics.zoomEndToChunkVisibleMs),
        frameSchedulerQueueDepth: clone(metrics.frameSchedulerQueueDepth),
        buildHitCanvas: clone(metrics.buildHitCanvas),
        settleExactRefresh: clone(metrics.settleExactRefresh),
        drawPoliticalBackgroundFillsPass: clone(metrics.drawPoliticalBackgroundFillsPass),
        drawPoliticalFeatureFillLoop: clone(metrics.drawPoliticalFeatureFillLoop),
        drawPoliticalFeatureStrokeLoop: clone(metrics.drawPoliticalFeatureStrokeLoop),
        politicalPassVisibleItems: clone(metrics.politicalPassVisibleItems),
        drawContextScenarioPass: clone(metrics.drawContextScenarioPass),
        drawLabelsPass: clone(metrics.drawLabelsPass),
        scenarioPoliticalBackgroundCacheBuild: clone(metrics.scenarioPoliticalBackgroundCacheBuild),
        scenarioPoliticalBackgroundCacheReplay: clone(metrics.scenarioPoliticalBackgroundCacheReplay),
        politicalRasterWorkerRoundTripMs: clone(metrics["politicalRasterWorker.roundTripMs"]),
        politicalRasterWorkerAcceptedCount: clone(metrics["politicalRasterWorker.acceptedCount"]),
        politicalRasterWorkerRejectedStaleCount: clone(metrics["politicalRasterWorker.rejectedStaleCount"]),
        politicalRasterWorkerFallbackCount: clone(metrics["politicalRasterWorker.fallbackCount"]),
      }};
    }})()"""


def clone_repeated_zoom_pass_attribution_js(source: str = "state.renderPerfMetrics") -> str:
    return f"""(() => {{
      const metrics = {source} || {{}};
      const clone = (value) => value && typeof value === 'object'
        ? JSON.parse(JSON.stringify(value))
        : null;
      const passMetricNames = {{
        politicalBg: "drawPoliticalBackgroundFillsPass",
        politicalFill: "drawPoliticalFeatureFillLoop",
        politicalStroke: "drawPoliticalFeatureStrokeLoop",
        contextScenario: "drawContextScenarioPass",
        labels: "drawLabelsPass",
        hitCanvas: "buildHitCanvas",
        settleExact: "settleExactRefresh",
        bgCacheBuild: "scenarioPoliticalBackgroundCacheBuild",
        bgCacheReplay: "scenarioPoliticalBackgroundCacheReplay",
      }};
      const passes = {{}};
      Object.entries(passMetricNames).forEach(([label, metricName]) => {{
        const entry = clone(metrics[metricName]);
        if (!entry) return;
        passes[label] = {{
          metricName,
          durationMs: Number(entry.durationMs || 0),
          recordedAt: Number(entry.recordedAt || 0),
          details: entry,
        }};
      }});
      return {{
        schema: "mc_pass_attribution_v1",
        passes,
        scheduler: clone(metrics.frameSchedulerQueueDepth),
        chunkCost: clone(metrics.selectedFeatureCountSum),
        chunkSelection: clone(metrics.chunkSelectionMs),
        politicalPassVisibleItems: clone(metrics.politicalPassVisibleItems),
        politicalRasterWorker: {{
          roundTripMs: clone(metrics["politicalRasterWorker.roundTripMs"]),
          rasterMs: clone(metrics["politicalRasterWorker.rasterMs"]),
          encodeMs: clone(metrics["politicalRasterWorker.encodeMs"]),
          decodeMs: clone(metrics["politicalRasterWorker.decodeMs"]),
          blitMs: clone(metrics["politicalRasterWorker.blitMs"]),
          acceptedCount: clone(metrics["politicalRasterWorker.acceptedCount"]),
          rejectedStaleCount: clone(metrics["politicalRasterWorker.rejectedStaleCount"]),
          fallbackCount: clone(metrics["politicalRasterWorker.fallbackCount"]),
        }},
      }};
    }})()"""


def sample_canvas_black_pixel_ratio_js() -> str:
    return """(() => {
      const canvas = document.getElementById('map-canvas') || document.getElementById('colorCanvas');
      if (!canvas || !canvas.width || !canvas.height) return null;
      const sampleWidth = Math.min(80, Math.max(1, canvas.width));
      const sampleHeight = Math.min(54, Math.max(1, canvas.height));
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = sampleWidth;
      sampleCanvas.height = sampleHeight;
      const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
      if (!sampleContext) return null;
      const maxX = Math.max(0, canvas.width - sampleWidth);
      const maxY = Math.max(0, canvas.height - sampleHeight);
      const sampleRegions = [
        [0.5, 0.5],
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ];
      let black = 0;
      let sampled = 0;
      for (const [xRatio, yRatio] of sampleRegions) {
        const sourceX = Math.round(maxX * xRatio);
        const sourceY = Math.round(maxY * yRatio);
        sampleContext.clearRect(0, 0, sampleWidth, sampleHeight);
        sampleContext.drawImage(canvas, sourceX, sourceY, sampleWidth, sampleHeight, 0, 0, sampleWidth, sampleHeight);
        const pixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
        sampled += sampleWidth * sampleHeight;
        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3];
          const luminance = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
          if (alpha > 0 && luminance < 8) black += 1;
        }
      }
      return sampled > 0 ? Number((black / sampled).toFixed(6)) : null;
    })()"""


def sample_canvas_black_pixel_details_js() -> str:
    return """(() => {
      const canvas = document.getElementById('map-canvas') || document.getElementById('colorCanvas');
      if (!canvas || !canvas.width || !canvas.height) return null;
      const classifyRatio = (ratio) => {
        const value = Number(ratio || 0);
        if (value >= 0.95) return 'blank-frame-candidate';
        if (value >= 0.25) return 'dark-content-candidate';
        return 'normal';
      };
      const sampleWidth = Math.min(80, Math.max(1, canvas.width));
      const sampleHeight = Math.min(54, Math.max(1, canvas.height));
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = sampleWidth;
      sampleCanvas.height = sampleHeight;
      const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
      if (!sampleContext) return null;
      const maxX = Math.max(0, canvas.width - sampleWidth);
      const maxY = Math.max(0, canvas.height - sampleHeight);
      const sampleRegions = [
        ['center', 0.5, 0.5],
        ['north_west', 0.25, 0.25],
        ['north_east', 0.75, 0.25],
        ['south_west', 0.25, 0.75],
        ['south_east', 0.75, 0.75],
      ];
      let black = 0;
      let sampled = 0;
      const regions = [];
      for (const [label, xRatio, yRatio] of sampleRegions) {
        const sourceX = Math.round(maxX * xRatio);
        const sourceY = Math.round(maxY * yRatio);
        sampleContext.clearRect(0, 0, sampleWidth, sampleHeight);
        sampleContext.drawImage(canvas, sourceX, sourceY, sampleWidth, sampleHeight, 0, 0, sampleWidth, sampleHeight);
        const pixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
        let regionBlack = 0;
        const regionSampled = sampleWidth * sampleHeight;
        sampled += regionSampled;
        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3];
          const luminance = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
          if (alpha > 0 && luminance < 8) regionBlack += 1;
        }
        const regionRatio = Number((regionBlack / Math.max(1, regionSampled)).toFixed(6));
        black += regionBlack;
        regions.push({
          label,
          xRatio,
          yRatio,
          sourceX,
          sourceY,
          sampled: regionSampled,
          black: regionBlack,
          ratio: regionRatio,
          classification: classifyRatio(regionRatio),
        });
      }
      const maxRegionRatio = regions.reduce((max, entry) => Math.max(max, Number(entry.ratio || 0)), 0);
      return {
        ratio: sampled > 0 ? Number((black / sampled).toFixed(6)) : null,
        maxRegionRatio,
        classification: classifyRatio(maxRegionRatio),
        blankCandidateCount: regions.filter((entry) => entry.classification === 'blank-frame-candidate').length,
        sampled,
        black,
        regions,
      };
    })()"""


def sample_js_heap_memory_js() -> str:
    return """(() => {
      const memory = performance.memory;
      if (!memory) {
        return {
          supported: false,
          usedJSHeapSize: null,
          totalJSHeapSize: null,
          jsHeapSizeLimit: null,
        };
      }
      return {
        supported: true,
        usedJSHeapSize: Number(memory.usedJSHeapSize || 0),
        totalJSHeapSize: Number(memory.totalJSHeapSize || 0),
        jsHeapSizeLimit: Number(memory.jsHeapSizeLimit || 0),
      };
    })()"""


def navigate(url: str) -> dict:
    js = f"""
async (page) => {{
  const benchmarkStartedAt = Date.now();
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
          attribution: Array.from(entry.attribution || []).map((item) => ({{
            name: String(item.name || ''),
            entryType: String(item.entryType || ''),
            containerType: String(item.containerType || ''),
            containerName: String(item.containerName || ''),
            containerSrc: String(item.containerSrc || ''),
            containerId: String(item.containerId || ''),
          }})),
        }}));
        window.__perfBench.longTasks.push(...entries);
      }});
      observer.observe({{ entryTypes: ['longtask'] }});
      window.__perfBench.longTaskObserverAttached = true;
    }} catch (_error) {{
      window.__perfBench.longTaskObserverAttached = false;
    }}
  }});
  const pageLoad = await page.evaluate(() => {{
    const navigationEntry = performance.getEntriesByType('navigation')?.[0] || null;
    const paintEntries = Object.fromEntries(
      performance.getEntriesByType('paint').map((entry) => [entry.name, Number(entry.startTime || 0)])
    );
    const asMetric = (value) => {{
      const numeric = Number(value || 0);
      return Number.isFinite(numeric) && numeric > 0 ? Number(numeric.toFixed(3)) : null;
    }};
    return {{
      measuredAt: Date.now(),
      url: location.href,
      title: document.title,
      navigationType: navigationEntry?.type || null,
      domInteractiveMs: asMetric(navigationEntry?.domInteractive),
      domContentLoadedMs: asMetric(navigationEntry?.domContentLoadedEventEnd),
      loadEventEndMs: asMetric(navigationEntry?.loadEventEnd),
      responseEndMs: asMetric(navigationEntry?.responseEnd),
      firstPaintMs: asMetric(paintEntries['first-paint']),
      firstContentfulPaintMs: asMetric(paintEntries['first-contentful-paint']),
      activeScenarioId: String(document.querySelector('#scenarioSelect')?.value || ''),
    }};
  }});
  return {{
    ...pageLoad,
    pageReadyMs: Number((Date.now() - benchmarkStartedAt).toFixed(3)),
  }};
}}
""".strip()
    return run_code_json(js)  # type: ignore[return-value]


def open_page(urls: list[str] | tuple[str, ...] | str) -> dict:
    global BROWSER_OPENED, PLAYWRIGHT_BACKEND
    candidate_urls = unique_strings([urls] if isinstance(urls, str) else list(urls))
    if not candidate_urls:
        raise RuntimeError("No benchmark URL candidates were provided.")
    if not BROWSER_OPENED:
      attempts: list[str] = []
      if PWCLI.exists():
          for browser_name in OPEN_BROWSER_CANDIDATES:
              for candidate_url in candidate_urls:
                  attempts.append(f"{browser_name}:{candidate_url}")
                  try:
                      PLAYWRIGHT_BACKEND = WRAPPER_BACKEND
                      run_wrapper_pw("open", candidate_url, "--browser", browser_name, timeout_sec=BROWSER_OPEN_TIMEOUT_SEC)
                      BROWSER_OPENED = True
                      page_load = navigate(candidate_url)
                      if isinstance(page_load, dict):
                          page_load["openBrowser"] = browser_name
                          page_load["openUrl"] = candidate_url
                          page_load["openFallbackUsed"] = len(attempts) > 1
                          page_load["openAttempts"] = attempts
                          page_load["openTransport"] = WRAPPER_BACKEND
                      return page_load
                  except RuntimeError:
                      close_session()
      else:
          attempts.append(f"{WRAPPER_BACKEND}:missing-cli-wrapper")
      for browser_name in OPEN_BROWSER_CANDIDATES:
          for candidate_url in candidate_urls:
              attempts.append(f"{LOCAL_NODE_PLAYWRIGHT_BACKEND}:{browser_name}:{candidate_url}")
              try:
                  PLAYWRIGHT_BACKEND = LOCAL_NODE_PLAYWRIGHT_BACKEND
                  fallback_open = run_local_pw(
                      "open",
                      candidate_url,
                      "--browser",
                      browser_name,
                      timeout_sec=BROWSER_OPEN_TIMEOUT_SEC,
                      expect_json=True,
                  )
                  BROWSER_OPENED = True
                  page_load = navigate(candidate_url)
                  if isinstance(page_load, dict):
                      page_load["openBrowser"] = (
                          fallback_open.get("browserName")
                          if isinstance(fallback_open, dict)
                          else browser_name
                      )
                      page_load["openUrl"] = candidate_url
                      page_load["openFallbackUsed"] = True
                      page_load["openAttempts"] = attempts
                      page_load["openTransport"] = LOCAL_NODE_PLAYWRIGHT_BACKEND
                      if isinstance(fallback_open, dict):
                          page_load["openHeadless"] = bool(fallback_open.get("headless"))
                  return page_load
              except RuntimeError:
                  close_session()
      raise RuntimeError(
          "Unable to open benchmark browser session. Attempts: "
          + ", ".join(attempts)
      )
    reuse_attempts: list[str] = []
    for candidate_url in candidate_urls:
        reuse_attempts.append(f"{PLAYWRIGHT_BACKEND}:{candidate_url}")
        try:
            page_load = navigate(candidate_url)
            if isinstance(page_load, dict):
                page_load["openBrowser"] = None
                page_load["openUrl"] = candidate_url
                page_load["openFallbackUsed"] = PLAYWRIGHT_BACKEND == LOCAL_NODE_PLAYWRIGHT_BACKEND
                page_load["openAttempts"] = reuse_attempts
                page_load["openTransport"] = PLAYWRIGHT_BACKEND
                if PLAYWRIGHT_BACKEND == LOCAL_NODE_PLAYWRIGHT_BACKEND:
                    page_load["openHeadless"] = LOCAL_NODE_PLAYWRIGHT_HEADLESS
            return page_load
        except RuntimeError:
            continue
    raise RuntimeError(
        "Unable to navigate benchmark browser session after open. Attempts: "
        + ", ".join(reuse_attempts)
    )


def with_query_overrides(url: str, **overrides: str) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    for key, value in overrides.items():
      query[key] = value
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def build_scenario_open_urls(base_urls: list[str], scenario_id: str) -> list[str]:
    urls: list[str] = []
    normalized_scenario_id = str(scenario_id or "").strip()
    for base_url in unique_strings(base_urls):
      perf_url = with_query_overrides(ensure_app_path_url(base_url), perf_overlay="1", runtime_chunk_perf="1")
      if normalized_scenario_id and normalized_scenario_id != "none":
        scenario_perf_url = with_query_overrides(perf_url, default_scenario=normalized_scenario_id)
        urls.append(scenario_perf_url)
      urls.append(perf_url)
    return unique_strings(urls)


def build_suite_open_urls(base_urls: list[str], scenario_id: str) -> list[str]:
    return build_scenario_open_urls(base_urls, scenario_id)


def ensure_app_path_url(url: str) -> str:
    parts = urlsplit(str(url or "").strip())
    path = parts.path or "/"
    if path.startswith("/app/") or path == "/app":
        normalized_path = path if path.startswith("/app/") else "/app/"
    elif path == "/":
        normalized_path = "/app/"
    else:
        normalized_path = f"/app{path}" if path.startswith("/") else f"/app/{path}"
    return urlunsplit((parts.scheme, parts.netloc, normalized_path, parts.query, parts.fragment))


def unique_strings(values: list[str] | tuple[str, ...]) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = str(value or "").strip()
        if not normalized or normalized in seen:
            continue
        ordered.append(normalized)
        seen.add(normalized)
    return ordered


def clear_browser_buffers() -> None:
    run_pw("console", "warning", "--clear")
    run_pw("network", "--clear")


def wait_for_benchmark_runtime_ready(label: str, timeout_ms: int = 90000) -> dict:
    js = f"""
async (page) => {{
  return await page.evaluate(async (payload) => {{
    const {{ state }} = await import('/js/core/state.js');
    const timeoutMs = Math.max(1000, Number(payload?.timeoutMs || 0));
    const startedAt = performance.now();
    const isReady = () => (
      !state.bootBlocking
      && !state.startupReadonly
      && !state.startupReadonlyUnlockInFlight
      && !state.scenarioApplyInFlight
      && !state.isInteracting
      && !state.deferExactAfterSettle
      && !String(state.activePostReadyTaskKey || '')
      && String(state.renderPhase || 'idle') === 'idle'
      && (Number(state.phaseEnteredAt || 0) <= 0 || performance.now() - Number(state.phaseEnteredAt || 0) >= 600)
      && (Number(state.zoomGestureEndedAt || 0) <= 0 || performance.now() - Number(state.zoomGestureEndedAt || 0) >= 600)
    );
    while (!isReady() && (performance.now() - startedAt) < timeoutMs) {{
      await new Promise((resolve) => setTimeout(resolve, 100));
    }}
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {{
      label: String(payload?.label || ''),
      ready: isReady(),
      waitedMs: Number((performance.now() - startedAt).toFixed(3)),
      bootPhase: String(state.bootPhase || ''),
      bootBlocking: !!state.bootBlocking,
      startupReadonly: !!state.startupReadonly,
      startupReadonlyUnlockInFlight: !!state.startupReadonlyUnlockInFlight,
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
      isInteracting: !!state.isInteracting,
      deferExactAfterSettle: !!state.deferExactAfterSettle,
      activePostReadyTaskKey: String(state.activePostReadyTaskKey || ''),
      renderPhase: String(state.renderPhase || ''),
      activeScenarioId: String(state.activeScenarioId || ''),
    }};
  }}, {{ label: {json.dumps(label)}, timeoutMs: {int(timeout_ms)} }});
}}
""".strip()
    result = run_code_json(js)
    if isinstance(result, dict) and result.get("ready"):
      return result
    raise RuntimeError(f"Benchmark runtime did not become ready before scenario action: {result}")


def capture_console_issues() -> list[str]:
    output = run_pw("console", "warning")
    return [line for line in str(output).splitlines() if line.strip()]


def capture_network_issues() -> list[str]:
    output = run_pw("network")
    return [line for line in str(output).splitlines() if line.strip()]


def take_screenshot(target_path: Path) -> str:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    filename = (
      str(target_path.resolve())
      if PLAYWRIGHT_BACKEND == LOCAL_NODE_PLAYWRIGHT_BACKEND
      else normalize_bash_path(target_path.resolve())
    )
    run_pw("screenshot", "--filename", filename, "--full-page", timeout_sec=120)
    if not target_path.exists():
      raise RuntimeError(f"Screenshot was not created at {target_path}")
    return str(target_path)


def as_finite_number(value: object) -> float | None:
    try:
      numeric = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
      return None
    if not math.isfinite(numeric):
      return None
    return numeric


def percentile(values: list[float], quantile: float) -> float | None:
    if not values:
      return None
    if len(values) == 1:
      return values[0]
    clamped_quantile = min(max(quantile, 0.0), 1.0)
    sorted_values = sorted(values)
    rank = (len(sorted_values) - 1) * clamped_quantile
    lower_index = math.floor(rank)
    upper_index = math.ceil(rank)
    if lower_index == upper_index:
      return sorted_values[lower_index]
    lower_value = sorted_values[lower_index]
    upper_value = sorted_values[upper_index]
    weight = rank - lower_index
    return lower_value + (upper_value - lower_value) * weight


def stddev(values: list[float]) -> float | None:
    if not values:
      return None
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    return math.sqrt(variance)


def summarize_distribution(values: list[float]) -> dict:
    return {
      "count": len(values),
      "p50": percentile(values, 0.5),
      "p90": percentile(values, 0.9),
      "stddev": stddev(values),
      "min": min(values) if values else None,
      "max": max(values) if values else None,
      "mean": (sum(values) / len(values)) if values else None,
      "samples": values,
    }


def iter_perf_metric_maps(node: object, path: str = ""):
    if isinstance(node, dict):
      for key, value in node.items():
        next_path = f"{path}.{key}" if path else key
        if key in {"renderMetrics", "scenarioMetrics"} and isinstance(value, dict):
          yield next_path, key, value
        if isinstance(value, (dict, list)):
          yield from iter_perf_metric_maps(value, next_path)
      return
    if isinstance(node, list):
      for index, value in enumerate(node):
        next_path = f"{path}[{index}]"
        if isinstance(value, (dict, list)):
          yield from iter_perf_metric_maps(value, next_path)


def find_latest_perf_metric(suite: dict, category: str, metric_name: str) -> dict | None:
    best_match: dict | None = None
    best_rank = (-1.0, -1)
    for order, (path, map_name, metrics) in enumerate(iter_perf_metric_maps(suite)):
      if map_name != category or not isinstance(metrics, dict):
        continue
      entry = metrics.get(metric_name)
      if not isinstance(entry, dict):
        continue
      recorded_at = as_finite_number(entry.get("recordedAt"))
      rank = (recorded_at if recorded_at is not None else -1.0, order)
      if rank >= best_rank:
        best_rank = rank
        best_match = {
          "source": f"{path}.{metric_name}",
          "entry": entry,
        }
    return best_match


def summarize_metric(metric_match: dict | None, *, count_key: str | None = None) -> dict:
    summary = {
      "present": False,
      "source": None,
      "durationMs": None,
      "recordedAt": None,
      "count": None,
      "details": None,
    }
    if not metric_match:
      return summary
    entry = metric_match.get("entry")
    if not isinstance(entry, dict):
      return summary
    details = {
      key: value
      for key, value in entry.items()
      if key not in {"durationMs", "recordedAt", count_key}
    }
    summary.update({
      "present": True,
      "source": metric_match.get("source"),
      "durationMs": as_finite_number(entry.get("durationMs")),
      "recordedAt": as_finite_number(entry.get("recordedAt")),
      "count": as_finite_number(entry.get(count_key)) if count_key else None,
      "details": details,
    })
    return summary


def summarize_page_load(page_load: object) -> dict:
    summary = {
      "present": False,
      "source": None,
      "durationMs": None,
      "recordedAt": None,
      "count": None,
      "details": None,
    }
    if not isinstance(page_load, dict):
      return summary
    selected_field = None
    duration_ms = None
    for field_name in ("pageReadyMs", "loadEventEndMs", "domContentLoadedMs", "domInteractiveMs"):
      duration_ms = as_finite_number(page_load.get(field_name))
      if duration_ms is not None:
        selected_field = field_name
        break
    details = dict(page_load)
    if selected_field:
      details["selectedField"] = selected_field
    summary.update({
      "present": selected_field is not None,
      "source": f"pageLoad.{selected_field}" if selected_field else None,
      "durationMs": duration_ms,
      "recordedAt": as_finite_number(page_load.get("measuredAt")),
      "details": details,
    })
    return summary


def summarize_direct_metric_entry(entry: object, source: str, *, count_key: str | None = None) -> dict:
    if not isinstance(entry, dict):
      return {
        "present": False,
        "source": None,
        "durationMs": None,
        "recordedAt": None,
        "count": None,
        "details": None,
      }
    details = {
      key: value
      for key, value in entry.items()
      if key not in {"durationMs", "recordedAt", count_key}
    }
    return {
      "present": True,
      "source": source,
      "durationMs": as_finite_number(entry.get("durationMs")),
      "recordedAt": as_finite_number(entry.get("recordedAt")),
      "count": as_finite_number(entry.get(count_key)) if count_key else None,
      "details": details,
    }


def metric_entry_matches_scenario(entry: object, scenario_id: object, *field_names: str) -> bool:
    if not isinstance(entry, dict):
      return False
    normalized_scenario_id = str(scenario_id or "").strip()
    if not normalized_scenario_id:
      return not any(str(entry.get(field_name) or "").strip() for field_name in field_names or ("scenarioId", "activeScenarioId"))
    for field_name in field_names or ("scenarioId", "activeScenarioId"):
      if str(entry.get(field_name) or "").strip() == normalized_scenario_id:
        return True
    return False


def is_fresh_metric_entry(entry: object, previous_recorded_at: object) -> bool:
    if not isinstance(entry, dict):
      return False
    recorded_at = as_finite_number(entry.get("recordedAt"))
    baseline = as_finite_number(previous_recorded_at) or 0.0
    return recorded_at is not None and recorded_at > baseline


def is_same_scenario_fresh_metric_entry(
    entry: object,
    scenario_id: object,
    previous_recorded_at: object,
    *field_names: str,
) -> bool:
    return is_fresh_metric_entry(entry, previous_recorded_at) and metric_entry_matches_scenario(
      entry,
      scenario_id,
      *(field_names or ("scenarioId", "activeScenarioId")),
    )


def summarize_freshest_direct_metric_entry(
    candidates: list[tuple[object, str, object]],
    *,
    count_key: str | None = None,
) -> dict:
    freshest_summary: dict | None = None
    freshest_recorded_at = -1.0
    for entry, source, baseline in candidates:
      if not is_fresh_metric_entry(entry, baseline):
        continue
      summary = summarize_direct_metric_entry(entry, source, count_key=count_key)
      recorded_at = as_finite_number(summary.get("recordedAt")) or -1.0
      if recorded_at >= freshest_recorded_at:
        freshest_summary = summary
        freshest_recorded_at = recorded_at
    if freshest_summary is not None:
      return freshest_summary
    return {
      "present": False,
      "source": None,
      "durationMs": None,
      "recordedAt": None,
      "count": None,
      "details": None,
    }


def summarize_freshest_same_scenario_metric_entry(
    candidates: list[tuple[object, str, object]],
    scenario_id: object,
    *,
    field_names: tuple[str, ...] = ("scenarioId", "activeScenarioId"),
    count_key: str | None = None,
) -> dict:
    freshest_summary: dict | None = None
    freshest_recorded_at = -1.0
    for entry, source, baseline in candidates:
      if not is_same_scenario_fresh_metric_entry(entry, scenario_id, baseline, *field_names):
        continue
      summary = summarize_direct_metric_entry(entry, source, count_key=count_key)
      recorded_at = as_finite_number(summary.get("recordedAt")) or -1.0
      if recorded_at >= freshest_recorded_at:
        freshest_summary = summary
        freshest_recorded_at = recorded_at
    if freshest_summary is not None:
      return freshest_summary
    return {
      "present": False,
      "source": None,
      "durationMs": None,
      "recordedAt": None,
      "count": None,
      "details": None,
    }


def with_metric_context(
    summary: dict,
    *,
    metric_name: str,
    requested_scenario_id: str,
    selected_via: str,
    probe: object = None,
    baselines: object = None,
    candidate_sources: list[str] | tuple[str, ...] | None = None,
    allow_direct_probe_without_scenario_fields: bool = True,
) -> dict:
    normalized_requested_scenario_id = str(requested_scenario_id or "").strip()
    expected_metric_scenario_id = "" if normalized_requested_scenario_id == "none" else normalized_requested_scenario_id
    normalized_summary = dict(summary)
    details = dict(normalized_summary.get("details") or {})
    probe_context = probe if isinstance(probe, dict) else {}
    details_match_scenario = metric_entry_matches_scenario(
      details,
      expected_metric_scenario_id,
      "scenarioId",
      "activeScenarioId",
    )
    probe_matches_scenario = metric_entry_matches_scenario(
      probe_context,
      expected_metric_scenario_id,
      "scenarioId",
      "activeScenarioId",
    )
    has_probe_scenario_context = any(
      str(probe_context.get(field_name) or "").strip()
      for field_name in ("scenarioId", "activeScenarioId")
    )
    # Direct probes run inside the already-open suite page. Some probes report
    # only their measured values, so their scenario trust comes from the suite
    # request plus scenarioConsistency instead of a stale metric entry.
    direct_probe_without_scenario_fields = (
      selected_via == "direct-probe"
      and allow_direct_probe_without_scenario_fields
      and not any(str(details.get(field_name) or "").strip() for field_name in ("scenarioId", "activeScenarioId"))
      and not has_probe_scenario_context
    )
    details.update({
      "metricName": metric_name,
      "requestedScenarioId": normalized_requested_scenario_id,
      "expectedMetricScenarioId": expected_metric_scenario_id,
      "selectedVia": selected_via,
      "sameScenario": details_match_scenario or probe_matches_scenario or direct_probe_without_scenario_fields,
    })
    if candidate_sources:
      details["candidateSources"] = list(candidate_sources)
    if isinstance(baselines, dict):
      details["metricBaselines"] = dict(baselines)
    if isinstance(probe, dict):
      details["probe"] = {
        key: value
        for key, value in probe.items()
        if key not in {"scenarioMetrics", "renderMetrics", "runtimeChunkLoadState"}
      }
    normalized_summary["details"] = details
    return normalized_summary


def summarize_distribution_metric(
    value: object,
    *,
    source: str,
    details: dict | None = None,
    count: object = None,
) -> dict:
    numeric_value = as_finite_number(value)
    numeric_count = as_finite_number(count)
    metric_details = dict(details or {})
    metric_details["distribution"] = summarize_distribution([numeric_value] if numeric_value is not None else [])
    return {
      "present": numeric_value is not None,
      "source": source if numeric_value is not None else None,
      "durationMs": numeric_value,
      "recordedAt": None,
      "count": numeric_count,
      "details": metric_details,
    }


def summarize_interactive_pan_metric(suite: dict) -> dict:
    probe = suite.get("interactivePanFrame") if isinstance(suite.get("interactivePanFrame"), dict) else {}
    frame = probe.get("interactiveFrame") if isinstance(probe.get("interactiveFrame"), dict) else {}
    return summarize_distribution_metric(
      frame.get("totalMs"),
      source="interactivePanFrame.interactiveFrame.totalMs",
      count=(probe.get("counterDelta") or {}).get("transformedFrames") if isinstance(probe.get("counterDelta"), dict) else None,
      details={
        "counterDelta": probe.get("counterDelta"),
        "frame": frame,
      },
    )


def summarize_fill_action_metric(suite: dict, key: str) -> dict:
    probe = suite.get(key) if isinstance(suite.get(key), dict) else {}
    return summarize_distribution_metric(
      probe.get("lastActionDurationMs"),
      source=f"{key}.lastActionDurationMs",
      count=probe.get("longTaskCountDelta"),
      details={
        "target": probe.get("target"),
        "lastAction": probe.get("lastAction"),
        "longTaskCountDelta": probe.get("longTaskCountDelta"),
        "blackPixelRatio": as_finite_number(probe.get("blackPixelRatio")),
        "counterDelta": probe.get("counterDelta"),
        "lastActionFrame": probe.get("lastActionFrame"),
      },
    )


def summarize_repeated_zoom_regions_metric(suite: dict) -> dict:
    probe = suite.get("repeatedZoomRegions") if isinstance(suite.get("repeatedZoomRegions"), dict) else {}
    regions = probe.get("regions") if isinstance(probe.get("regions"), dict) else {}
    first_idle_values: list[float] = []
    degradation_ratios: list[float] = []
    max_black_values: list[float] = []
    max_long_values: list[float] = []
    used_heap_deltas: list[float] = []
    region_summaries: dict[str, dict] = {}
    pass_duration_values: dict[str, list[float]] = {}
    black_classification_counts: dict[str, int] = {}
    for region_id, region_payload in regions.items():
      if not isinstance(region_payload, dict):
        continue
      cycles = region_payload.get("cycles") if isinstance(region_payload.get("cycles"), list) else []
      cycle_idle_values = [
        as_finite_number(cycle.get("firstIdleAfterLastWheelMs"))
        for cycle in cycles
        if isinstance(cycle, dict)
      ]
      cycle_idle_values = [value for value in cycle_idle_values if value is not None]
      first_idle_values.extend(cycle_idle_values)
      degradation = region_payload.get("degradation") if isinstance(region_payload.get("degradation"), dict) else {}
      ratio = as_finite_number(degradation.get("ratio"))
      if ratio is not None:
        degradation_ratios.append(ratio)
      max_black = as_finite_number(region_payload.get("maxBlackPixelRatio"))
      if max_black is not None:
        max_black_values.append(max_black)
      max_long = as_finite_number(region_payload.get("maxLongTaskMs"))
      if max_long is not None:
        max_long_values.append(max_long)
      memory_delta = region_payload.get("memoryDelta") if isinstance(region_payload.get("memoryDelta"), dict) else {}
      used_heap_delta = as_finite_number(memory_delta.get("usedJSHeapSize"))
      if used_heap_delta is not None:
        used_heap_deltas.append(used_heap_delta)
      for cycle in cycles:
        if not isinstance(cycle, dict):
          continue
        pass_attribution = cycle.get("passAttribution") if isinstance(cycle.get("passAttribution"), dict) else {}
        passes = pass_attribution.get("passes") if isinstance(pass_attribution.get("passes"), dict) else {}
        for pass_name, pass_entry in passes.items():
          if not isinstance(pass_entry, dict):
            continue
          duration = as_finite_number(pass_entry.get("durationMs"))
          if duration is not None:
            pass_duration_values.setdefault(str(pass_name), []).append(duration)
        black_attribution = cycle.get("blackPixelAttribution") if isinstance(cycle.get("blackPixelAttribution"), dict) else {}
        classification = str(black_attribution.get("classification") or "").strip()
        if classification:
          black_classification_counts[classification] = black_classification_counts.get(classification, 0) + 1
      region_summaries[str(region_id)] = {
        "cycleCount": len(cycles),
        "firstIdleAfterLastWheelMs": summarize_distribution(cycle_idle_values),
        "degradation": degradation,
        "maxBlackPixelRatio": max_black,
        "maxLongTaskMs": max_long,
        "memoryDelta": memory_delta,
        "passAttributionSchema": region_payload.get("passAttributionSchema") or probe.get("passAttributionSchema"),
      }
    pass_attribution_summary = {
      pass_name: summarize_distribution(values)
      for pass_name, values in sorted(pass_duration_values.items())
    }
    return {
      "present": bool(regions),
      "source": "repeatedZoomRegions",
      "durationMs": max(first_idle_values) if first_idle_values else None,
      "recordedAt": None,
      "count": max(degradation_ratios) if degradation_ratios else None,
      "details": {
        "interactionProbeSchema": probe.get("interactionProbeSchema"),
        "passAttributionSchema": probe.get("passAttributionSchema"),
        "regionCount": len(regions),
        "cycleCount": as_finite_number(probe.get("cyclesPerRegion")),
        "wheelsPerCycle": as_finite_number(probe.get("wheelsPerCycle")),
        "firstIdleAfterLastWheelMs": summarize_distribution(first_idle_values),
        "degradationRatio": summarize_distribution(degradation_ratios),
        "blackPixelRatio": summarize_distribution(max_black_values),
        "longTask": {
          "maxLongTaskMs": max(max_long_values) if max_long_values else None,
          "distribution": summarize_distribution(max_long_values),
        },
        "memory": {
          "usedJSHeapSizeDelta": summarize_distribution(used_heap_deltas),
        },
        "passAttribution": pass_attribution_summary,
        "blackPixelClassification": black_classification_counts,
        "regions": region_summaries,
      },
    }


def build_suite_scenario_consistency(suite: dict) -> dict:
    page_load = suite.get("pageLoad") if isinstance(suite.get("pageLoad"), dict) else {}
    scenario_apply = suite.get("scenarioApply") if isinstance(suite.get("scenarioApply"), dict) else {}
    requested_scenario_id = str(
      scenario_apply.get("requestedScenarioId")
      or suite.get("scenarioId")
      or ""
    ).strip()
    expected_active_scenario_id = "" if requested_scenario_id == "none" else requested_scenario_id
    page_load_active = str(page_load.get("activeScenarioId") or "").strip()
    page_load_open_url = str(page_load.get("openUrl") or "").strip()
    scenario_apply_active = str(scenario_apply.get("activeScenarioId") or "").strip()
    scenario_apply_requested = str(scenario_apply.get("requestedScenarioId") or "").strip()
    page_load_matches = (
      True
      if requested_scenario_id == "none"
      else (
        page_load_active == expected_active_scenario_id
        or f"default_scenario={expected_active_scenario_id}" in page_load_open_url
      )
    )
    scenario_apply_matches = (
      scenario_apply_requested == requested_scenario_id
      and scenario_apply_active == expected_active_scenario_id
    )
    return {
      "requestedScenarioId": requested_scenario_id,
      "expectedActiveScenarioId": expected_active_scenario_id,
      "pageLoadActiveScenarioId": page_load_active,
      "pageLoadOpenUrl": page_load_open_url,
      "scenarioApplyRequestedScenarioId": scenario_apply_requested,
      "scenarioApplyActiveScenarioId": scenario_apply_active,
      "pageLoadMatches": page_load_matches,
      "scenarioApplyMatches": scenario_apply_matches,
      "consistent": page_load_matches and scenario_apply_matches,
    }


def build_suite_benchmark_metrics(suite: dict) -> dict:
    page_load_metric = summarize_page_load(suite.get("pageLoad"))
    scenario_apply = suite.get("scenarioApply") if isinstance(suite.get("scenarioApply"), dict) else {}
    scenario_apply_metrics = scenario_apply.get("scenarioMetrics") if isinstance(scenario_apply.get("scenarioMetrics"), dict) else {}
    scenario_apply_render_metrics = scenario_apply.get("renderMetrics") if isinstance(scenario_apply.get("renderMetrics"), dict) else {}
    baselines = scenario_apply.get("metricBaselines") if isinstance(scenario_apply.get("metricBaselines"), dict) else {}
    requested_scenario_id = str(
      scenario_apply.get("requestedScenarioId")
      or scenario_apply.get("activeScenarioId")
      or suite.get("scenarioId")
      or ""
    ).strip()
    expected_metric_scenario_id = "" if requested_scenario_id == "none" else requested_scenario_id
    captured_current_scenario = bool(scenario_apply.get("capturedCurrentScenario"))

    if metric_entry_matches_scenario(
      scenario_apply_metrics.get("loadScenarioBundle"),
      expected_metric_scenario_id,
      "scenarioId",
    ):
      load_metric = summarize_direct_metric_entry(
        scenario_apply_metrics.get("loadScenarioBundle"),
        "scenarioApply.scenarioMetrics.loadScenarioBundle",
      )
      load_selected_via = "same-scenario-direct"
    elif is_same_scenario_fresh_metric_entry(
      scenario_apply_metrics.get("loadScenarioBundle"),
      expected_metric_scenario_id,
      baselines.get("loadScenarioBundleRecordedAt"),
      "scenarioId",
    ):
      load_metric = summarize_direct_metric_entry(
        scenario_apply_metrics.get("loadScenarioBundle"),
        "scenarioApply.scenarioMetrics.loadScenarioBundle",
      )
      load_selected_via = "fresh-same-scenario"
    else:
      load_metric = page_load_metric
      load_selected_via = "page-load-fallback"
    load_metric = with_metric_context(
      load_metric,
      metric_name="load",
      requested_scenario_id=requested_scenario_id,
      selected_via=load_selected_via,
      candidate_sources=[
        "scenarioApply.scenarioMetrics.loadScenarioBundle",
        "pageLoad.pageReadyMs",
      ],
      baselines=baselines,
    )

    if metric_entry_matches_scenario(
      scenario_apply_metrics.get("timeToInteractiveCoarseFrame"),
      expected_metric_scenario_id,
      "scenarioId",
    ):
      time_to_interactive_metric = summarize_direct_metric_entry(
        scenario_apply_metrics.get("timeToInteractiveCoarseFrame"),
        "scenarioApply.scenarioMetrics.timeToInteractiveCoarseFrame",
      )
      time_to_interactive_selected_via = "same-scenario-direct"
    elif is_same_scenario_fresh_metric_entry(
      scenario_apply_metrics.get("timeToInteractiveCoarseFrame"),
      expected_metric_scenario_id,
      baselines.get("timeToInteractiveCoarseFrameRecordedAt"),
      "scenarioId",
    ):
      time_to_interactive_metric = summarize_direct_metric_entry(
        scenario_apply_metrics.get("timeToInteractiveCoarseFrame"),
        "scenarioApply.scenarioMetrics.timeToInteractiveCoarseFrame",
      )
      time_to_interactive_selected_via = "fresh-same-scenario"
    elif expected_metric_scenario_id:
      time_to_interactive_metric = {
        "present": False,
        "source": None,
        "durationMs": None,
        "recordedAt": None,
        "count": None,
        "details": None,
      }
      time_to_interactive_selected_via = "missing-fresh-same-scenario"
    else:
      time_to_interactive_metric = summarize_direct_metric_entry(
        {
          "durationMs": as_finite_number(scenario_apply.get("durationMs")) or 0.0,
          "recordedAt": None,
          "scenarioId": scenario_apply.get("requestedScenarioId"),
          "fallback": "scenarioApply.durationMs",
        },
        "scenarioApply.durationMs",
      )
      time_to_interactive_selected_via = "scenario-apply-duration-fallback"
    time_to_interactive_metric = with_metric_context(
      time_to_interactive_metric,
      metric_name="timeToInteractive",
      requested_scenario_id=requested_scenario_id,
      selected_via=time_to_interactive_selected_via,
      baselines=baselines,
      candidate_sources=[
        "scenarioApply.scenarioMetrics.timeToInteractiveCoarseFrame",
        "scenarioApply.durationMs",
      ],
    )

    post_apply_metrics = suite.get("postApplyMetrics") if isinstance(suite.get("postApplyMetrics"), dict) else {}
    post_apply_scenario_metrics = post_apply_metrics.get("scenarioMetrics") if isinstance(post_apply_metrics.get("scenarioMetrics"), dict) else {}
    post_apply_baselines = post_apply_metrics.get("metricBaselines") if isinstance(post_apply_metrics.get("metricBaselines"), dict) else {}
    if metric_entry_matches_scenario(
      scenario_apply_metrics.get("timeToPoliticalCoreReady"),
      expected_metric_scenario_id,
      "scenarioId",
    ):
      political_core_ready_metric = summarize_direct_metric_entry(
        scenario_apply_metrics.get("timeToPoliticalCoreReady"),
        "scenarioApply.scenarioMetrics.timeToPoliticalCoreReady",
      )
      political_core_selected_via = "same-scenario-direct"
    else:
      political_core_ready_metric = summarize_freshest_same_scenario_metric_entry([
        (
          post_apply_scenario_metrics.get("timeToPoliticalCoreReady"),
          "postApplyMetrics.scenarioMetrics.timeToPoliticalCoreReady",
          post_apply_baselines.get("timeToPoliticalCoreReadyRecordedAt", baselines.get("timeToPoliticalCoreReadyRecordedAt")),
        ),
      ], expected_metric_scenario_id, field_names=("scenarioId",))
      political_core_selected_via = "post-apply-fresh-same-scenario"
    if not political_core_ready_metric.get("present"):
      if (
        time_to_interactive_metric.get("present")
        and isinstance(scenario_apply_metrics.get("timeToInteractiveCoarseFrame"), dict)
        and scenario_apply_metrics.get("timeToInteractiveCoarseFrame", {}).get("hasChunkedRuntime") is False
      ):
        political_core_ready_metric = {
          **time_to_interactive_metric,
          "source": "scenarioApply.scenarioMetrics.timeToInteractiveCoarseFrame",
          "details": {
            **(time_to_interactive_metric.get("details") or {}),
            "fallback": "timeToInteractiveCoarseFrame",
          },
        }
        political_core_selected_via = "time-to-interactive-fallback"
      else:
        political_core_ready_metric = {
          "present": False,
          "source": None,
          "durationMs": None,
          "recordedAt": None,
          "count": None,
          "details": None,
        }
        political_core_selected_via = "missing"
    political_core_ready_metric = with_metric_context(
      political_core_ready_metric,
      metric_name="timeToPoliticalCoreReady",
      requested_scenario_id=requested_scenario_id,
      selected_via=political_core_selected_via,
      probe=post_apply_metrics,
      baselines=post_apply_baselines or baselines,
      candidate_sources=[
        "scenarioApply.scenarioMetrics.timeToPoliticalCoreReady",
        "postApplyMetrics.scenarioMetrics.timeToPoliticalCoreReady",
        "scenarioApply.scenarioMetrics.timeToInteractiveCoarseFrame",
      ],
    )

    zoom_settle = suite.get("zoomSettleFullRedraw") if isinstance(suite.get("zoomSettleFullRedraw"), dict) else {}
    zoom_settle_render_metrics = zoom_settle.get("renderMetrics") if isinstance(zoom_settle.get("renderMetrics"), dict) else {}
    zoom_settle_baselines = zoom_settle.get("metricBaselines") if isinstance(zoom_settle.get("metricBaselines"), dict) else {}
    settle_exact_metric = summarize_freshest_same_scenario_metric_entry([
      (
        zoom_settle_render_metrics.get("settleExactRefresh"),
        "zoomSettleFullRedraw.renderMetrics.settleExactRefresh",
        zoom_settle_baselines.get("settleExactRefreshRecordedAt"),
      ),
    ], expected_metric_scenario_id, field_names=("activeScenarioId",))
    settle_exact_selected_via = "fresh-same-scenario" if settle_exact_metric.get("present") else "missing"
    settle_exact_metric = with_metric_context(
      settle_exact_metric,
      metric_name="settleExactRefresh",
      requested_scenario_id=requested_scenario_id,
      selected_via=settle_exact_selected_via,
      probe=zoom_settle,
      baselines=zoom_settle_baselines,
      candidate_sources=[
        "zoomSettleFullRedraw.renderMetrics.settleExactRefresh",
      ],
    )

    zoom_end_chunk_visible = suite.get("zoomEndChunkVisible") if isinstance(suite.get("zoomEndChunkVisible"), dict) else {}
    zoom_end_render_metrics = zoom_end_chunk_visible.get("renderMetrics") if isinstance(zoom_end_chunk_visible.get("renderMetrics"), dict) else {}
    zoom_end_runtime_chunk_state = zoom_end_chunk_visible.get("runtimeChunkLoadState") if isinstance(zoom_end_chunk_visible.get("runtimeChunkLoadState"), dict) else {}
    zoom_end_baselines = zoom_end_chunk_visible.get("metricBaselines") if isinstance(zoom_end_chunk_visible.get("metricBaselines"), dict) else {}
    zoom_end_chunk_visible_metric = summarize_freshest_same_scenario_metric_entry([
      (
        zoom_end_render_metrics.get("zoomEndToChunkVisibleMs"),
        "zoomEndChunkVisible.renderMetrics.zoomEndToChunkVisibleMs",
        zoom_end_baselines.get("zoomEndToChunkVisibleRecordedAt"),
      ),
      (
        zoom_end_runtime_chunk_state.get("lastZoomEndToChunkVisibleMetric"),
        "zoomEndChunkVisible.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric",
        zoom_end_baselines.get("lastZoomEndToChunkVisibleRecordedAt"),
      ),
    ], expected_metric_scenario_id, field_names=("scenarioId", "activeScenarioId"))
    zoom_end_selected_via = "fresh-same-scenario" if zoom_end_chunk_visible_metric.get("present") else "missing"
    if not zoom_end_chunk_visible_metric.get("present"):
      zoom_end_visual_stage_metric = summarize_freshest_same_scenario_metric_entry([
        (
          zoom_end_render_metrics.get("scenarioChunkPromotionVisualStage"),
          "zoomEndChunkVisible.renderMetrics.scenarioChunkPromotionVisualStage",
          zoom_end_baselines.get("scenarioChunkPromotionVisualStageRecordedAt"),
        ),
      ], expected_metric_scenario_id, field_names=("activeScenarioId",))
      if zoom_end_visual_stage_metric.get("present"):
        zoom_end_chunk_visible_metric = zoom_end_visual_stage_metric
        zoom_end_selected_via = "visual-stage-fallback"
    zoom_end_chunk_visible_metric = with_metric_context(
      zoom_end_chunk_visible_metric,
      metric_name="zoomEndToChunkVisible",
      requested_scenario_id=requested_scenario_id,
      selected_via=zoom_end_selected_via,
      probe=zoom_end_chunk_visible,
      baselines=zoom_end_baselines,
      candidate_sources=[
        "zoomEndChunkVisible.renderMetrics.zoomEndToChunkVisibleMs",
        "zoomEndChunkVisible.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric",
        "zoomEndChunkVisible.renderMetrics.scenarioChunkPromotionVisualStage",
      ],
    )

    current_black_count = as_finite_number((scenario_apply_render_metrics.get("blackFrameCount") or {}).get("count")) or 0.0
    previous_black_count = as_finite_number(baselines.get("blackFrameCount")) or 0.0
    black_frame_metric = {
      "present": True,
      "source": "scenarioApply.renderMetrics.blackFrameCount",
      "durationMs": max(0.0, current_black_count - previous_black_count),
      "recordedAt": as_finite_number((scenario_apply_render_metrics.get("blackFrameCount") or {}).get("recordedAt")),
      "count": max(0.0, current_black_count - previous_black_count),
      "details": {
        "currentCount": current_black_count,
        "previousCount": previous_black_count,
      },
    }
    black_frame_metric = with_metric_context(
      black_frame_metric,
      metric_name="blackFrame",
      requested_scenario_id=requested_scenario_id,
      selected_via="counter-delta",
      baselines=baselines,
      candidate_sources=[
        "scenarioApply.renderMetrics.blackFrameCount",
      ],
    )
    wheel_anchor_trace = suite.get("wheelAnchorTrace") if isinstance(suite.get("wheelAnchorTrace"), dict) else {}
    wheel_anchor_metric = {
      "present": bool(wheel_anchor_trace),
      "source": "wheelAnchorTrace",
      "durationMs": (
        as_finite_number(wheel_anchor_trace.get("firstIdleAfterLastWheelMs"))
        if as_finite_number(wheel_anchor_trace.get("firstIdleAfterLastWheelMs")) is not None
        else as_finite_number(wheel_anchor_trace.get("firstIdleAfterWheelMs"))
      ),
      "recordedAt": None,
      "count": as_finite_number(wheel_anchor_trace.get("maxStableAnchorDriftPx")),
      "details": {
        "maxAnchorDriftPx": as_finite_number(wheel_anchor_trace.get("maxAnchorDriftPx")),
        "maxStableAnchorDriftPx": as_finite_number(wheel_anchor_trace.get("maxStableAnchorDriftPx")),
        "postIdleAnchorDriftPx": as_finite_number(wheel_anchor_trace.get("postIdleAnchorDriftPx")),
        "firstIdleAfterWheelMs": as_finite_number(wheel_anchor_trace.get("firstIdleAfterWheelMs")),
        "lastWheelAt": as_finite_number(wheel_anchor_trace.get("lastWheelAt")),
        "firstIdleAfterLastWheelMs": as_finite_number(wheel_anchor_trace.get("firstIdleAfterLastWheelMs")),
        "maxBlackPixelRatio": as_finite_number(wheel_anchor_trace.get("maxBlackPixelRatio")),
        "longTaskCountDelta": as_finite_number(wheel_anchor_trace.get("longTaskCountDelta")),
        "maxLongTaskMs": as_finite_number(wheel_anchor_trace.get("maxLongTaskMs")),
        "blackFrameDelta": as_finite_number(wheel_anchor_trace.get("blackFrameDelta")),
        "distribution": summarize_distribution([
          (
            as_finite_number(wheel_anchor_trace.get("firstIdleAfterLastWheelMs"))
            if as_finite_number(wheel_anchor_trace.get("firstIdleAfterLastWheelMs")) is not None
            else as_finite_number(wheel_anchor_trace.get("firstIdleAfterWheelMs"))
          )
        ] if (
          as_finite_number(wheel_anchor_trace.get("firstIdleAfterLastWheelMs")) is not None
          or as_finite_number(wheel_anchor_trace.get("firstIdleAfterWheelMs")) is not None
        ) else []),
      },
    }
    interactive_pan_metric = summarize_interactive_pan_metric(suite)
    single_fill_metric = summarize_fill_action_metric(suite, "singleFill")
    double_click_fill_metric = summarize_fill_action_metric(suite, "doubleClickFill")
    repeated_zoom_metric = summarize_repeated_zoom_regions_metric(suite)
    wheel_anchor_metric = with_metric_context(
      wheel_anchor_metric,
      metric_name="wheelAnchorTrace",
      requested_scenario_id=requested_scenario_id,
      selected_via="direct-probe",
      probe=wheel_anchor_trace,
      candidate_sources=["wheelAnchorTrace.firstIdleAfterLastWheelMs", "wheelAnchorTrace.firstIdleAfterWheelMs"],
    )
    interactive_pan_metric = with_metric_context(
      interactive_pan_metric,
      metric_name="interactivePanFrame",
      requested_scenario_id=requested_scenario_id,
      selected_via="direct-probe",
      probe=suite.get("interactivePanFrame") if isinstance(suite.get("interactivePanFrame"), dict) else {},
      candidate_sources=["interactivePanFrame.interactiveFrame.totalMs"],
    )
    single_fill_metric = with_metric_context(
      single_fill_metric,
      metric_name="singleFillAction",
      requested_scenario_id=requested_scenario_id,
      selected_via="direct-probe",
      probe=suite.get("singleFill") if isinstance(suite.get("singleFill"), dict) else {},
      candidate_sources=["singleFill.lastActionDurationMs"],
    )
    double_click_fill_metric = with_metric_context(
      double_click_fill_metric,
      metric_name="doubleClickFillAction",
      requested_scenario_id=requested_scenario_id,
      selected_via="direct-probe",
      probe=suite.get("doubleClickFill") if isinstance(suite.get("doubleClickFill"), dict) else {},
      candidate_sources=["doubleClickFill.lastActionDurationMs"],
    )
    repeated_zoom_metric = with_metric_context(
      repeated_zoom_metric,
      metric_name="repeatedZoomRegions",
      requested_scenario_id=requested_scenario_id,
      selected_via="direct-probe",
      probe=suite.get("repeatedZoomRegions") if isinstance(suite.get("repeatedZoomRegions"), dict) else {},
      candidate_sources=["repeatedZoomRegions.regions.*.cycles.*.firstIdleAfterLastWheelMs"],
      allow_direct_probe_without_scenario_fields=False,
    )
    return {
      "load": load_metric,
      "pageLoad": page_load_metric,
      "timeToInteractive": time_to_interactive_metric,
      "timeToPoliticalCoreReady": political_core_ready_metric,
      "settleExactRefresh": settle_exact_metric,
      "zoomEndToChunkVisible": zoom_end_chunk_visible_metric,
      "wheelAnchorTrace": wheel_anchor_metric,
      "interactivePanFrame": interactive_pan_metric,
      "singleFillAction": single_fill_metric,
      "doubleClickFillAction": double_click_fill_metric,
      "repeatedZoomRegions": repeated_zoom_metric,
      "firstInteraction": {
        "wheelAnchorTrace": wheel_anchor_metric,
        "interactivePanFrame": interactive_pan_metric,
        "singleFillAction": single_fill_metric,
        "doubleClickFillAction": double_click_fill_metric,
        "repeatedZoomRegions": repeated_zoom_metric,
      },
      "fullySettled": {
        "settleExactRefresh": settle_exact_metric,
        "zoomEndToChunkVisible": zoom_end_chunk_visible_metric,
      },
      "blackFrame": black_frame_metric,
    }


def apply_scenario(scenario_id: str) -> dict:
    js = f"""
async (page) => {{
  return await page.evaluate(async (scenarioId) => {{
    const {{ state }} = await import('/js/core/state.js');
    const scenarioManager = await import('/js/core/scenario_manager.js');
    const waitForScenarioActionReady = async () => {{
      const waitStartedAt = performance.now();
      while (
        (state.bootBlocking || state.startupReadonly || state.startupReadonlyUnlockInFlight || state.scenarioApplyInFlight)
        && (performance.now() - waitStartedAt) < 90000
      ) {{
        await new Promise((resolve) => setTimeout(resolve, 100));
      }}
      if (state.bootBlocking || state.startupReadonly || state.startupReadonlyUnlockInFlight || state.scenarioApplyInFlight) {{
        throw new Error('Benchmark scenario action timed out while waiting for startup readiness.');
      }}
    }};
    await waitForScenarioActionReady();
    const normalizedScenarioId = String(scenarioId || '');
    const before = {{
      drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0),
      frames: Number(state.renderPassCache?.counters?.frames || 0),
      transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0),
      dynamicBorderRebuilds: Number(state.renderPassCache?.counters?.dynamicBorderRebuilds || 0),
    }};
    const metricBaselines = {{
      loadScenarioBundleRecordedAt: Number(state.scenarioPerfMetrics?.loadScenarioBundle?.recordedAt || 0),
      timeToInteractiveCoarseFrameRecordedAt: Number(state.scenarioPerfMetrics?.timeToInteractiveCoarseFrame?.recordedAt || 0),
      timeToPoliticalCoreReadyRecordedAt: Number(state.scenarioPerfMetrics?.timeToPoliticalCoreReady?.recordedAt || 0),
      blackFrameCount: Number(state.renderPerfMetrics?.blackFrameCount?.count || 0),
      blackFrameRecordedAt: Number(state.renderPerfMetrics?.blackFrameCount?.recordedAt || 0),
    }};
    window.__perfBench.longTasks = [];
    const startedAt = performance.now();
    if (!normalizedScenarioId || normalizedScenarioId === 'none') {{
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
      if (String(state.activeScenarioId || '') === normalizedScenarioId) {{
        scenarioManager.clearActiveScenario({{
          renderNow: true,
          markDirtyReason: '',
          showToastOnComplete: false,
        }});
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }}
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
      readinessDiagnostics: {{
        requestedScenarioId: scenarioId,
        activeScenarioId: String(state.activeScenarioId || ''),
        baselineRecordedAt: {{
          timeToPoliticalCoreReady: metricBaselines.timeToPoliticalCoreReadyRecordedAt,
        }},
        currentRecordedAt: {{
          timeToPoliticalCoreReady: Number(state.scenarioPerfMetrics?.timeToPoliticalCoreReady?.recordedAt || 0),
        }},
        freshByRecordedAt: Number(state.scenarioPerfMetrics?.timeToPoliticalCoreReady?.recordedAt || 0) > metricBaselines.timeToPoliticalCoreReadyRecordedAt,
        scenarioMatches: String(state.activeScenarioId || '') === (normalizedScenarioId === 'none' ? '' : normalizedScenarioId),
      }},
      metricBaselines,
      lastFrame: {clone_frame_js("state.renderPassCache?.lastFrame || null")},
      renderMetrics: {clone_metrics_js("state.renderPerfMetrics")},
      scenarioMetrics: {clone_metrics_js("state.scenarioPerfMetrics")},
      overlay: document.getElementById('perf-overlay')?.textContent || '',
    }};
  }}, {json.dumps(scenario_id)});
}}
""".strip()
    return run_code_json(js)  # type: ignore[return-value]


def capture_current_scenario_metrics(scenario_id: str) -> dict:
    js = f"""
async (page) => {{
  return await page.evaluate(async (expectedScenarioId) => {{
    const {{ state }} = await import('/js/core/state.js');
    const currentScenarioId = String(state.activeScenarioId || '');
    if (String(expectedScenarioId || '') !== currentScenarioId) {{
      throw new Error(`Current scenario "${{currentScenarioId}}" did not match expected "${{expectedScenarioId}}".`);
    }}
    return {{
      capturedCurrentScenario: true,
      requestedScenarioId: expectedScenarioId,
      activeScenarioId: currentScenarioId,
      durationMs: 0,
      renderProfile: String(state.renderProfile || 'auto'),
      dynamicBordersEnabled: state.dynamicBordersEnabled !== false,
      showWaterRegions: !!state.showWaterRegions,
      showScenarioSpecialRegions: !!state.showScenarioSpecialRegions,
      showScenarioReliefOverlays: !!state.showScenarioReliefOverlays,
      counterDelta: {{
        drawCanvas: 0,
        frames: 0,
        transformedFrames: 0,
        dynamicBorderRebuilds: 0,
      }},
      longTaskCount: 0,
      metricBaselines: {{
        loadScenarioBundleRecordedAt: Number(state.scenarioPerfMetrics?.loadScenarioBundle?.recordedAt || 0),
        timeToInteractiveCoarseFrameRecordedAt: Number(state.scenarioPerfMetrics?.timeToInteractiveCoarseFrame?.recordedAt || 0),
        timeToPoliticalCoreReadyRecordedAt: Number(state.scenarioPerfMetrics?.timeToPoliticalCoreReady?.recordedAt || 0),
        blackFrameCount: Number(state.renderPerfMetrics?.blackFrameCount?.count || 0),
        blackFrameRecordedAt: Number(state.renderPerfMetrics?.blackFrameCount?.recordedAt || 0),
      }},
      lastFrame: {clone_frame_js("state.renderPassCache?.lastFrame || null")},
      renderMetrics: {clone_metrics_js("state.renderPerfMetrics")},
      scenarioMetrics: {clone_metrics_js("state.scenarioPerfMetrics")},
      overlay: document.getElementById('perf-overlay')?.textContent || '',
    }};
  }}, {json.dumps(scenario_id)});
}}
""".strip()
    return run_code_json(js)  # type: ignore[return-value]


def measure_post_apply_metrics(scenario_id: str, baseline_recorded_at: object = 0, captured_current_scenario: bool = False) -> dict | None:
    if scenario_id == "none":
      return None
    baseline_recorded_at_number = as_finite_number(baseline_recorded_at) or 0.0
    js = f"""
async (page) => {{
  return await page.evaluate(async (payload) => {{
    const {{ state }} = await import('/js/core/state.js');
    const expectedScenarioId = String(payload?.scenarioId || '');
    const baselineRecordedAt = Number(payload?.timeToPoliticalCoreReadyRecordedAt || 0);
    const allowAlreadyReady = !!payload?.capturedCurrentScenario;
    const startedAt = performance.now();
    const getPoliticalReadyEntry = () => state.scenarioPerfMetrics?.timeToPoliticalCoreReady || null;
    const hasCurrentPoliticalReadyMetric = () => {{
      const entry = getPoliticalReadyEntry();
      return Number(entry?.recordedAt || 0) > 0
        && String(entry?.scenarioId || '') === expectedScenarioId;
    }};
    const hasFreshPoliticalReadyMetric = () => {{
      const entry = getPoliticalReadyEntry();
      return Number(entry?.recordedAt || 0) > baselineRecordedAt
        && String(entry?.scenarioId || '') === expectedScenarioId;
    }};
    const alreadyReadyCurrentScenario = allowAlreadyReady && hasCurrentPoliticalReadyMetric();
    while (
      String(state.activeScenarioId || '') === String(expectedScenarioId || '')
      && !alreadyReadyCurrentScenario
      && !hasFreshPoliticalReadyMetric()
      && (performance.now() - startedAt) < 12000
    ) {{
      await new Promise((resolve) => setTimeout(resolve, 50));
    }}
    return {{
      requestedScenarioId: expectedScenarioId,
      activeScenarioId: String(state.activeScenarioId || ''),
      waitedMs: Number((performance.now() - startedAt).toFixed(3)),
      politicalCoreReadyObserved: alreadyReadyCurrentScenario || hasFreshPoliticalReadyMetric(),
      politicalCoreReadyGate: {{
        waitedMs: Number((performance.now() - startedAt).toFixed(3)),
        timeoutMs: 12000,
        baselineRecordedAt,
        latestRecordedAt: Number(getPoliticalReadyEntry()?.recordedAt || 0),
        latestScenarioId: String(getPoliticalReadyEntry()?.scenarioId || ''),
        observed: alreadyReadyCurrentScenario || hasFreshPoliticalReadyMetric(),
        outcome: alreadyReadyCurrentScenario ? 'already-ready' : (hasFreshPoliticalReadyMetric() ? 'fresh' : 'missing'),
        reason: alreadyReadyCurrentScenario ? 'already-ready-current-scenario' : (hasFreshPoliticalReadyMetric() ? 'fresh-recorded-at' : 'timed-out'),
      }},
      metricBaselines: {{
        timeToPoliticalCoreReadyRecordedAt: baselineRecordedAt,
      }},
      scenarioMetrics: {clone_metrics_js("state.scenarioPerfMetrics")},
      renderMetrics: {clone_metrics_js("state.renderPerfMetrics")},
      overlay: document.getElementById('perf-overlay')?.textContent || '',
    }};
  }}, {{
    scenarioId: {json.dumps(scenario_id)},
    timeToPoliticalCoreReadyRecordedAt: {json.dumps(baseline_recorded_at_number)},
    capturedCurrentScenario: {json.dumps(bool(captured_current_scenario))},
  }});
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
    probe_payload_json = json.dumps({"label": label, "flags": flags})
    js = f"""
async (page) => {{
  return await page.evaluate(async () => {{
    const payload = {probe_payload_json};
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
  }});
}}
""".strip()
    return run_code_json(js)  # type: ignore[return-value]


def context_probe_case_metric_samples(samples: list[dict], key_path: tuple[str, ...]) -> list[float]:
    values: list[float] = []
    for sample in samples:
      current: object = sample
      for key in key_path:
        if not isinstance(current, dict):
          current = None
          break
        current = current.get(key)
      numeric = as_finite_number(current)
      if numeric is None:
        continue
      values.append(numeric)
    return values


def build_context_probe_case_summary(label: str, flags: dict[str, bool], samples: list[dict]) -> dict:
    draw_canvas_values = context_probe_case_metric_samples(samples, ("counterDelta", "drawCanvas"))
    frame_values = context_probe_case_metric_samples(samples, ("counterDelta", "frames"))
    context_scenario_values = context_probe_case_metric_samples(samples, ("lastFrame", "durations", "contextScenario"))
    return {
      "label": label,
      "flags": flags,
      "sampleCount": len(samples),
      "drawCanvas": summarize_distribution(draw_canvas_values),
      "frames": summarize_distribution(frame_values),
      "contextScenarioDurationMs": summarize_distribution(context_scenario_values),
      "samples": samples,
    }


def pairwise_delta(left: list[float], right: list[float]) -> list[float]:
    size = min(len(left), len(right))
    return [left[index] - right[index] for index in range(size)]


def build_water_cache_delta_summary(context_probes: dict | None) -> dict | None:
    if not isinstance(context_probes, dict):
      return None
    baseline = context_probes.get("baseline")
    water_off = context_probes.get("water_off")
    if not isinstance(baseline, dict) or not isinstance(water_off, dict):
      return None
    baseline_error = baseline.get("error")
    water_off_error = water_off.get("error")
    if isinstance(baseline_error, str) or isinstance(water_off_error, str):
      return None
    baseline_samples = baseline.get("samples") if isinstance(baseline.get("samples"), list) else []
    water_off_samples = water_off.get("samples") if isinstance(water_off.get("samples"), list) else []
    baseline_draw_canvas = context_probe_case_metric_samples(baseline_samples, ("counterDelta", "drawCanvas"))
    baseline_frames = context_probe_case_metric_samples(baseline_samples, ("counterDelta", "frames"))
    baseline_context_scenario = context_probe_case_metric_samples(baseline_samples, ("lastFrame", "durations", "contextScenario"))
    water_off_draw_canvas = context_probe_case_metric_samples(water_off_samples, ("counterDelta", "drawCanvas"))
    water_off_frames = context_probe_case_metric_samples(water_off_samples, ("counterDelta", "frames"))
    water_off_context_scenario = context_probe_case_metric_samples(water_off_samples, ("lastFrame", "durations", "contextScenario"))
    delta_draw_canvas = pairwise_delta(water_off_draw_canvas, baseline_draw_canvas)
    delta_frames = pairwise_delta(water_off_frames, baseline_frames)
    delta_context_scenario = pairwise_delta(water_off_context_scenario, baseline_context_scenario)
    return {
      "baselineSampleCount": len(baseline_samples),
      "waterOffSampleCount": len(water_off_samples),
      "pairedSampleCount": min(len(baseline_samples), len(water_off_samples)),
      "drawCanvasDelta": summarize_distribution(delta_draw_canvas),
      "framesDelta": summarize_distribution(delta_frames),
      "contextScenarioDurationDeltaMs": summarize_distribution(delta_context_scenario),
    }


def metric_distribution_is_sustained_negative(distribution: dict) -> bool:
    if not isinstance(distribution, dict):
      return False
    samples = distribution.get("samples")
    if not isinstance(samples, list) or len(samples) < CONTEXT_PROBE_MIN_SAMPLES_FOR_RECOMMENDATION:
      return False
    normalized = [as_finite_number(value) for value in samples]
    finite_values = [value for value in normalized if value is not None]
    if len(finite_values) < CONTEXT_PROBE_MIN_SAMPLES_FOR_RECOMMENDATION:
      return False
    return max(finite_values) < 0.0


def metric_distribution_has_recommendation_signal(distribution: dict) -> bool:
    if not isinstance(distribution, dict):
      return False
    samples = distribution.get("samples")
    if not isinstance(samples, list) or len(samples) < CONTEXT_PROBE_MIN_SAMPLES_FOR_RECOMMENDATION:
      return False
    normalized = [as_finite_number(value) for value in samples]
    finite_values = [value for value in normalized if value is not None]
    return len(finite_values) >= CONTEXT_PROBE_MIN_SAMPLES_FOR_RECOMMENDATION


def decide_water_cache_low_coverage_recommendation(scenario_id: str, water_cache_delta: dict | None) -> dict:
    if not isinstance(water_cache_delta, dict):
      return {
        "scenarioId": scenario_id,
        "hasRecommendationSignal": False,
        "isLowWaterCoverageScenario": False,
        "recommendDisableWaterCacheLowCoverage": False,
        "reason": "missing-water-cache-delta",
      }
    has_recommendation_signal = all(
      (
        metric_distribution_has_recommendation_signal(water_cache_delta.get("drawCanvasDelta")),
        metric_distribution_has_recommendation_signal(water_cache_delta.get("framesDelta")),
        metric_distribution_has_recommendation_signal(water_cache_delta.get("contextScenarioDurationDeltaMs")),
      )
    )
    if not has_recommendation_signal:
      return {
        "scenarioId": scenario_id,
        "hasRecommendationSignal": False,
        "isLowWaterCoverageScenario": False,
        "recommendDisableWaterCacheLowCoverage": False,
        "reason": "insufficient-water-cache-delta-samples",
      }
    metrics = {
      "drawCanvasDelta": metric_distribution_is_sustained_negative(water_cache_delta.get("drawCanvasDelta")),
      "framesDelta": metric_distribution_is_sustained_negative(water_cache_delta.get("framesDelta")),
      "contextScenarioDurationDeltaMs": metric_distribution_is_sustained_negative(
        water_cache_delta.get("contextScenarioDurationDeltaMs")
      ),
    }
    matched = [name for name, value in metrics.items() if value]
    is_low_water_coverage = len(matched) >= 2
    return {
      "scenarioId": scenario_id,
      "hasRecommendationSignal": True,
      "isLowWaterCoverageScenario": is_low_water_coverage,
      "recommendDisableWaterCacheLowCoverage": is_low_water_coverage,
      "negativeBenefitMetrics": matched,
      "reason": "sustained-negative-deltas" if is_low_water_coverage else "delta-signal-insufficient",
    }


def measure_context_probes(scenario_id: str) -> dict | None:
    if scenario_id != "tno_1962":
      return None
    probes = {}
    for label, flags in CONTEXT_PROBE_CASES:
      print(f"[benchmark] context probe scenario={scenario_id} case={label}", flush=True)
      try:
        samples = []
        for sample_index in range(CONTEXT_PROBE_SAMPLE_COUNT):
          print(
            f"[benchmark] context probe scenario={scenario_id} case={label} sample={sample_index + 1}/{CONTEXT_PROBE_SAMPLE_COUNT}",
            flush=True,
          )
          samples.append(measure_context_probe_case(label, flags))
        probes[label] = build_context_probe_case_summary(label, flags, samples)
      except RuntimeError as exc:
        probes[label] = {
          "label": label,
          "flags": flags,
          "error": str(exc),
        }
    return probes


def measure_zoom_settle_redraw() -> dict:
    js = f"""
async (page) => {{
  return await page.evaluate(async () => {{
    const {{ state }} = await import('/js/core/state.js');
    const {{ render, scheduleRenderPhaseIdle, scheduleExactAfterSettleRefresh }} = await import('/js/core/map_renderer.js');
    const clearExactAfterSettle = () => {{
      if (state.exactAfterSettleHandle) {{
        if (state.exactAfterSettleHandle.type === 'idle' && typeof cancelIdleCallback === 'function') {{
          cancelIdleCallback(state.exactAfterSettleHandle.id);
        }} else {{
          clearTimeout(state.exactAfterSettleHandle.id);
        }}
      }}
      state.exactAfterSettleHandle = null;
      state.deferExactAfterSettle = false;
      state.pendingExactPoliticalFastFrame = false;
    }};
    clearExactAfterSettle();
    state.renderPhase = 'idle';
    state.phaseEnteredAt = performance.now();
    state.isInteracting = false;
    render();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const before = {{
      drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0),
      frames: Number(state.renderPassCache?.counters?.frames || 0),
      transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0),
    }};
    const expectedScenarioId = String(state.activeScenarioId || '');
    const originalZoomGestureScaleDelta = Number(state.zoomGestureScaleDelta || 0);
    const originalZoomGestureEndedAt = Number(state.zoomGestureEndedAt || 0);
    const previousExactRefreshRecordedAt = Number(state.renderPerfMetrics?.settleExactRefresh?.recordedAt || 0);
    const previousFastExactSkippedRecordedAt = Number(state.renderPerfMetrics?.settlePoliticalFastExactSkipped?.recordedAt || 0);
    const benchmarkZoomEndedAt = performance.now();
    const hasFreshSettleMetric = (entry, baselineRecordedAt) =>
      Number(entry?.recordedAt || 0) > Number(baselineRecordedAt || 0)
      && String(entry?.activeScenarioId || '') === expectedScenarioId
      && Number(entry?.zoomEndedAt || benchmarkZoomEndedAt) >= benchmarkZoomEndedAt;
    const originalTransform = {{ ...(state.zoomTransform || {{ x: 0, y: 0, k: 1 }}) }};
    state.zoomTransform = {{
      x: originalTransform.x + 54,
      y: originalTransform.y + 28,
      k: Number((originalTransform.k * 1.12).toFixed(4)),
    }};
    state.zoomGestureScaleDelta = Math.abs(Math.log2(
      Math.max(0.0001, Number(state.zoomTransform?.k || 1))
      / Math.max(0.0001, Number(originalTransform.k || 1))
    ));
    state.zoomGestureEndedAt = benchmarkZoomEndedAt;
    state.renderPhase = 'settling';
    state.phaseEnteredAt = performance.now();
    state.isInteracting = false;
    state.deferExactAfterSettle = true;
    state.pendingExactPoliticalFastFrame = true;
    render();
    scheduleExactAfterSettleRefresh();
    const settleFrame = {clone_frame_js("state.renderPassCache?.lastFrame || null")};
    scheduleRenderPhaseIdle();
    const idleFastStartedAt = performance.now();
    while (state.renderPhase !== 'idle' && (performance.now() - idleFastStartedAt) < 4000) {{
      await new Promise((resolve) => setTimeout(resolve, 25));
    }}
    const idleFastFrame = {clone_frame_js("state.renderPassCache?.lastFrame || null")};
    const settleMetricStartedAt = performance.now();
    while (
      !hasFreshSettleMetric(state.renderPerfMetrics?.settleExactRefresh, previousExactRefreshRecordedAt)
      && (performance.now() - settleMetricStartedAt) < 8000
    ) {{
      await new Promise((resolve) => setTimeout(resolve, 25));
    }}
    const exactRefreshObserved = hasFreshSettleMetric(
      state.renderPerfMetrics?.settleExactRefresh,
      previousExactRefreshRecordedAt,
    );
    const fastExactSkippedObserved = hasFreshSettleMetric(
      state.renderPerfMetrics?.settlePoliticalFastExactSkipped,
      previousFastExactSkippedRecordedAt,
    );
    const exactRefreshFrame = {clone_frame_js("state.renderPassCache?.lastFrame || null")};
    const settleMetrics = {clone_metrics_js("state.renderPerfMetrics")};
    clearExactAfterSettle();
    state.zoomTransform = originalTransform;
    state.zoomGestureScaleDelta = originalZoomGestureScaleDelta;
    state.zoomGestureEndedAt = originalZoomGestureEndedAt;
    state.renderPhase = 'idle';
    state.phaseEnteredAt = performance.now();
    state.isInteracting = false;
    for (const passName of {json.dumps(RENDER_PASS_NAMES)}) {{
      state.renderPassCache.dirty[passName] = true;
      state.renderPassCache.reasons[passName] = 'zoom-settle-bench-restore';
    }}
    render();
    return {{
      requestedScenarioId: expectedScenarioId || 'none',
      activeScenarioId: String(state.activeScenarioId || ''),
      benchmarkZoomEndedAt: benchmarkZoomEndedAt,
      counterDelta: {{
        drawCanvas: Number(state.renderPassCache?.counters?.drawCanvas || 0) - before.drawCanvas,
        frames: Number(state.renderPassCache?.counters?.frames || 0) - before.frames,
        transformedFrames: Number(state.renderPassCache?.counters?.transformedFrames || 0) - before.transformedFrames,
      }},
      settleFrame,
      idleFastFrame,
      exactRefreshObserved,
      fastExactSkippedObserved,
      exactRefreshFrame,
      restoredFrame: {clone_frame_js("state.renderPassCache?.lastFrame || null")},
      metricBaselines: {{
        settleExactRefreshRecordedAt: previousExactRefreshRecordedAt,
        settlePoliticalFastExactSkippedRecordedAt: previousFastExactSkippedRecordedAt,
      }},
      renderMetrics: settleMetrics,
      overlay: document.getElementById('perf-overlay')?.textContent || '',
    }};
  }});
}}
""".strip()
    return run_code_json(js)  # type: ignore[return-value]


def measure_zoom_end_chunk_visible(scenario_id: str) -> dict | None:
    if scenario_id != "tno_1962":
      return None
    js = f"""
async (page) => {{
  return await page.evaluate(async () => {{
    const {{ state }} = await import('/js/core/state.js');
    const {{ setZoomPercent }} = await import('/js/core/map_renderer.js');
    const {{ scheduleScenarioChunkRefresh }} = await import('/js/core/scenario_resources.js');
    const expectedScenarioId = String(state.activeScenarioId || '');
    const previousRenderRecordedAt = Number(state.renderPerfMetrics?.zoomEndToChunkVisibleMs?.recordedAt || 0);
    const previousVisualStageRecordedAt = Number(state.renderPerfMetrics?.scenarioChunkPromotionVisualStage?.recordedAt || 0);
    const previousRuntimeRecordedAt = Number(
      state.runtimeChunkLoadState?.lastZoomEndToChunkVisibleMetric?.recordedAt
      || 0
    );
    if (state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === 'object') {{
      state.runtimeChunkLoadState.zoomEndChunkVisibleMetric = null;
    }}
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const hasFreshChunkVisibleMetric = (entry, baselineRecordedAt) =>
      Number(entry?.recordedAt || 0) > Number(baselineRecordedAt || 0)
      && String(entry?.scenarioId || '') === expectedScenarioId
      && Math.abs(Number(entry?.zoom || 0) - expectedZoom) <= 0.02;
    const hasFreshVisualStageMetric = (entry, baselineRecordedAt, expectedSelectionVersion = 0) =>
      Number(entry?.recordedAt || 0) > Number(baselineRecordedAt || 0)
      && String(entry?.activeScenarioId || '') === expectedScenarioId
      && String(entry?.reason || '').toLowerCase() === 'zoom-end'
      && Number(entry?.selectionVersion || 0) >= Number(expectedSelectionVersion || 0);
    const originalZoomPercent = Math.round(Math.max(1, Number(state.zoomTransform?.k || 1) * 100));
    const detailZoomThreshold = Number(state.activeScenarioManifest?.render_budget_hints?.detail_zoom_threshold || 0);
    const minimumTriggerPercent = Math.max(120, Math.ceil(detailZoomThreshold * 100) + 5);
    const targetPercent = originalZoomPercent >= minimumTriggerPercent ? Math.max(105, minimumTriggerPercent - 20) : minimumTriggerPercent;
    const expectedZoom = Number((targetPercent / 100).toFixed(4));
    setZoomPercent(targetPercent);
    scheduleScenarioChunkRefresh({{
      reason: 'zoom-end',
      delayMs: 0,
      flushPending: true,
    }});
    const expectedSelectionVersion = Number(state.runtimeChunkLoadState?.selectionVersion || 0);
    const registrationStartedAt = performance.now();
    while (
      Math.abs(Number(state.runtimeChunkLoadState?.zoomEndChunkVisibleMetric?.zoom || 0) - expectedZoom) > 0.02
      && (performance.now() - registrationStartedAt) < 2000
    ) {{
      await new Promise((resolve) => setTimeout(resolve, 25));
    }}
    const startedAt = performance.now();
    while (
      !hasFreshVisualStageMetric(state.renderPerfMetrics?.scenarioChunkPromotionVisualStage, previousVisualStageRecordedAt, expectedSelectionVersion)
      && !hasFreshChunkVisibleMetric(state.renderPerfMetrics?.zoomEndToChunkVisibleMs, previousRenderRecordedAt)
      && !hasFreshChunkVisibleMetric(state.runtimeChunkLoadState?.lastZoomEndToChunkVisibleMetric, previousRuntimeRecordedAt)
      && (performance.now() - startedAt) < 12000
    ) {{
      await new Promise((resolve) => setTimeout(resolve, 50));
    }}
    const result = {{
      requestedScenarioId: expectedScenarioId,
      activeScenarioId: String(state.activeScenarioId || ''),
      waitedMs: Number((performance.now() - startedAt).toFixed(3)),
      visualStageObserved: hasFreshVisualStageMetric(
        state.renderPerfMetrics?.scenarioChunkPromotionVisualStage,
        previousVisualStageRecordedAt,
        expectedSelectionVersion,
      ),
      renderMetricObserved: hasFreshChunkVisibleMetric(
        state.renderPerfMetrics?.zoomEndToChunkVisibleMs,
        previousRenderRecordedAt,
      ),
      runtimeMetricObserved: hasFreshChunkVisibleMetric(
        state.runtimeChunkLoadState?.lastZoomEndToChunkVisibleMetric,
        previousRuntimeRecordedAt,
      ),
      zoomPercentBefore: originalZoomPercent,
      zoomPercentAfter: targetPercent,
      metricBaselines: {{
        scenarioChunkPromotionVisualStageRecordedAt: previousVisualStageRecordedAt,
        zoomEndToChunkVisibleRecordedAt: previousRenderRecordedAt,
        lastZoomEndToChunkVisibleRecordedAt: previousRuntimeRecordedAt,
        expectedSelectionVersion,
      }},
      renderMetrics: {clone_metrics_js("state.renderPerfMetrics")},
      scenarioMetrics: {clone_metrics_js("state.scenarioPerfMetrics")},
      runtimeChunkLoadState: {clone_runtime_chunk_load_state_summary_js()},
      overlay: document.getElementById('perf-overlay')?.textContent || '',
    }};
    setZoomPercent(originalZoomPercent);
    return result;
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
      blackPixelRatio: {sample_canvas_black_pixel_ratio_js()},
      renderMetrics: {clone_metrics_js("state.renderPerfMetrics")},
      overlay: document.getElementById('perf-overlay')?.textContent || '',
    }};
  }});
}}
""".strip()
    return run_code_json(js)  # type: ignore[return-value]


def measure_wheel_anchor_trace(scenario_id: str) -> dict | None:
    if scenario_id != "tno_1962":
      return None
    js = f"""
async (page) => {{
  await page.evaluate(async () => {{
    const {{ state }} = await import('/js/core/state.js');
    const startedAt = performance.now();
    const exactActive = () => {{
      const phase = String(state.exactAfterSettleController?.phase || 'idle');
      return !!state.deferExactAfterSettle || ['scheduled', 'applying', 'awaiting-paint', 'finalizing'].includes(phase);
    }};
    while (
      (state.isInteracting || String(state.renderPhase || '') !== 'idle' || exactActive())
      && (performance.now() - startedAt) < 7000
    ) {{
      await new Promise((resolve) => setTimeout(resolve, 80));
    }}
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }});
  const target = await page.evaluate(async () => {{
    const {{ state }} = await import('/js/core/state.js');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const interaction = document.querySelector('#map-svg rect.interaction-layer');
    if (!interaction) {{
      throw new Error('Wheel benchmark interaction layer is unavailable.');
    }}
    const bounds = interaction.getBoundingClientRect();
    const anchorLocal = {{
      x: Math.max(24, Math.min(bounds.width - 24, bounds.width * 0.58)),
      y: Math.max(24, Math.min(bounds.height - 24, bounds.height * 0.48)),
    }};
    const transform = state.zoomTransform || {{ x: 0, y: 0, k: 1 }};
    return {{
      screenX: bounds.left + anchorLocal.x,
      screenY: bounds.top + anchorLocal.y,
      anchorLocal,
      worldAnchor: {{
        x: (anchorLocal.x - Number(transform.x || 0)) / Math.max(Number(transform.k || 1), 0.0001),
        y: (anchorLocal.y - Number(transform.y || 0)) / Math.max(Number(transform.k || 1), 0.0001),
      }},
      baselineLongTasks: Array.isArray(window.__perfBench?.longTasks) ? window.__perfBench.longTasks.length : 0,
      baselineBlackFrameCount: Number(state.renderPerfMetrics?.blackFrameCount?.count || 0),
      baselineTime: performance.now(),
    }};
  }});
  const sample = async (label) => page.evaluate(async (payload) => {{
    const {{ state }} = await import('/js/core/state.js');
    const transform = state.zoomTransform || {{ x: 0, y: 0, k: 1 }};
    const expectedLocal = {{
      x: payload.worldAnchor.x * Number(transform.k || 1) + Number(transform.x || 0),
      y: payload.worldAnchor.y * Number(transform.k || 1) + Number(transform.y || 0),
    }};
    const dx = expectedLocal.x - payload.anchorLocal.x;
    const dy = expectedLocal.y - payload.anchorLocal.y;
    const longTasks = Array.isArray(window.__perfBench?.longTasks) ? window.__perfBench.longTasks : [];
    const newLongTasks = longTasks.slice(Number(payload.baselineLongTasks || 0));
    return {{
      label: String(payload.label || ''),
      dtMs: Number((performance.now() - Number(payload.baselineTime || 0)).toFixed(3)),
      renderPhase: String(state.renderPhase || ''),
      isInteracting: !!state.isInteracting,
      transform: {{
        x: Number(transform.x || 0),
        y: Number(transform.y || 0),
        k: Number(transform.k || 1),
      }},
      anchorDriftPx: Number(Math.hypot(dx, dy).toFixed(3)),
      blackFrameCount: Number(state.renderPerfMetrics?.blackFrameCount?.count || 0),
      blackPixelRatio: {sample_canvas_black_pixel_ratio_js()},
      longTaskCountDelta: newLongTasks.length,
      maxLongTaskMs: newLongTasks.reduce((max, entry) => Math.max(max, Number(entry.duration || 0)), 0),
      lastFrame: {clone_frame_js("state.renderPassCache?.lastFrame || null")},
      renderMetrics: {clone_metrics_js("state.renderPerfMetrics")},
    }};
  }}, {{ ...target, label }});

  const samples = [];
  samples.push(await sample('before-wheel'));
  await page.mouse.move(target.screenX, target.screenY);
  let lastWheelAt = Number(target.baselineTime || 0);
  for (let index = 0; index < 5; index += 1) {{
    await page.mouse.wheel(0, -280);
    lastWheelAt = await page.evaluate(() => performance.now());
    await page.waitForTimeout(80);
    samples.push(await sample(`after-wheel-${{index + 1}}`));
  }}
  const waitStartedAt = Date.now();
  while (Date.now() - waitStartedAt < 5000) {{
    const stateSnapshot = await page.evaluate(async () => {{
      const {{ state }} = await import('/js/core/state.js');
      return {{
        renderPhase: String(state.renderPhase || ''),
        isInteracting: !!state.isInteracting,
      }};
    }});
    if (stateSnapshot.renderPhase === 'idle' && !stateSnapshot.isInteracting) break;
    await page.waitForTimeout(80);
  }}
  samples.push(await sample('after-idle-wait'));
  const after = samples[samples.length - 1] || {{}};
  const stableSamples = samples.filter((entry) => (
    (String(entry.label || '').startsWith('after-wheel-') && entry.label !== 'after-wheel-1')
    || String(entry.label || '') === 'after-idle-wait'
  ));
  const postIdleSample = samples.find((entry) => String(entry.label || '') === 'after-idle-wait') || null;
  const maxAnchorDriftPx = samples.reduce((max, entry) => Math.max(max, Number(entry.anchorDriftPx || 0)), 0);
  const maxStableAnchorDriftPx = stableSamples.reduce((max, entry) => Math.max(max, Number(entry.anchorDriftPx || 0)), 0);
  const longTaskCountDelta = Number(after.longTaskCountDelta || 0);
  const maxLongTaskMs = samples.reduce((max, entry) => Math.max(max, Number(entry.maxLongTaskMs || 0)), 0);
  const baselineTime = Number(target.baselineTime || 0);
  const lastWheelOffsetMs = Math.max(0, Number(lastWheelAt || 0) - baselineTime);
  const maxBlackPixelRatio = samples.reduce((max, entry) => Math.max(max, Number(entry.blackPixelRatio || 0)), 0);
  return {{
    requestedScenarioId: {json.dumps(scenario_id)},
    samples,
    lastWheelAt: Number(lastWheelAt || 0),
    firstIdleAfterLastWheelMs: Math.max(0, Number(after.dtMs || 0) - lastWheelOffsetMs),
    maxBlackPixelRatio,
    maxAnchorDriftPx,
    maxStableAnchorDriftPx,
    postIdleAnchorDriftPx: Number(postIdleSample?.anchorDriftPx || 0),
    firstIdleAfterWheelMs: Number(after.dtMs || 0),
    longTaskCountDelta,
    maxLongTaskMs,
    blackFrameDelta: Math.max(0, Number(after.blackFrameCount || 0) - Number(target.baselineBlackFrameCount || 0)),
  }};
}}
""".strip()
    return run_code_json(js)  # type: ignore[return-value]


def measure_repeated_zoom_regions(
    scenario_id: str,
    regions: list[str],
    cycles: int,
    wheels_per_cycle: int,
) -> dict | None:
    if scenario_id != "tno_1962":
      return None
    config = {
      "scenarioId": scenario_id,
      "regions": regions,
      "cycles": cycles,
      "wheelsPerCycle": wheels_per_cycle,
    }
    js = f"""
async (page) => {{
  const config = {json.dumps(config)};
  const waitForIdle = async (timeoutMs = 7000) => page.evaluate(async (timeoutMs) => {{
    const {{ state }} = await import('/js/core/state.js');
    const startedAt = performance.now();
    const exactActive = () => {{
      const phase = String(state.exactAfterSettleController?.phase || 'idle');
      return !!state.deferExactAfterSettle || ['scheduled', 'applying', 'awaiting-paint', 'finalizing'].includes(phase);
    }};
    while (
      (state.isInteracting || String(state.renderPhase || '') !== 'idle' || exactActive())
      && (performance.now() - startedAt) < timeoutMs
    ) {{
      await new Promise((resolve) => setTimeout(resolve, 80));
    }}
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const stillActive = state.isInteracting || String(state.renderPhase || '') !== 'idle' || exactActive();
    return {{
      waitedMs: Number((performance.now() - startedAt).toFixed(3)),
      renderPhase: String(state.renderPhase || ''),
      isInteracting: !!state.isInteracting,
      exactActive: exactActive(),
      timedOut: !!stillActive,
      settled: !stillActive,
    }};
  }}, timeoutMs);

  const resetZoom = async () => page.evaluate(async () => {{
    const renderer = await import('/js/core/map_renderer/public.js');
    renderer.resetZoomToFit();
  }});

  const resolveTarget = async (regionId) => page.evaluate(async (regionId) => {{
    const {{ state }} = await import('/js/core/state.js');
    const regionAnchors = {{
      europe: {{ lon: 10, lat: 50, label: 'Europe' }},
      us_east: {{ lon: -77, lat: 39, label: 'US East' }},
      east_asia: {{ lon: 120, lat: 35, label: 'East Asia' }},
    }};
    const anchor = regionAnchors[String(regionId || '')];
    if (!anchor) {{
      throw new Error(`Unknown repeated zoom region: ${{regionId}}`);
    }}
    const interaction = document.querySelector('#map-svg rect.interaction-layer');
    if (!interaction || !state.landData?.features?.length || !window.d3) {{
      throw new Error('Repeated zoom benchmark prerequisites are unavailable.');
    }}
    const bounds = interaction.getBoundingClientRect();
    const padding = Math.max(16, Math.round(Math.min(state.width, state.height) * 0.04));
    const projection = window.d3.geoEqualEarth()
      .precision(0.1)
      .fitExtent(
        [[padding, padding], [Math.max(padding + 1, state.width - padding), Math.max(padding + 1, state.height - padding)]],
        state.landData
      );
    const projected = projection([anchor.lon, anchor.lat]);
    const transform = state.zoomTransform || {{ x: 0, y: 0, k: 1 }};
    const anchorLocal = {{
      x: Math.max(24, Math.min(bounds.width - 24, (projected?.[0] || bounds.width * 0.5) * Number(transform.k || 1) + Number(transform.x || 0))),
      y: Math.max(24, Math.min(bounds.height - 24, (projected?.[1] || bounds.height * 0.5) * Number(transform.k || 1) + Number(transform.y || 0))),
    }};
    return {{
      regionId: String(regionId || ''),
      regionLabel: anchor.label,
      screenX: bounds.left + anchorLocal.x,
      screenY: bounds.top + anchorLocal.y,
      anchorLocal,
      worldAnchor: {{
        x: (anchorLocal.x - Number(transform.x || 0)) / Math.max(Number(transform.k || 1), 0.0001),
        y: (anchorLocal.y - Number(transform.y || 0)) / Math.max(Number(transform.k || 1), 0.0001),
      }},
      transform: {{
        x: Number(transform.x || 0),
        y: Number(transform.y || 0),
        k: Number(transform.k || 1),
      }},
    }};
  }}, regionId);

  const captureBaseline = async () => page.evaluate(async () => {{
    const {{ state }} = await import('/js/core/state.js');
    return {{
      baselineTime: performance.now(),
      baselineLongTasks: Array.isArray(window.__perfBench?.longTasks) ? window.__perfBench.longTasks.length : 0,
      baselineBlackFrameCount: Number(state.renderPerfMetrics?.blackFrameCount?.count || 0),
      memory: {sample_js_heap_memory_js()},
    }};
  }});

  const sample = async (payload) => page.evaluate(async (payload) => {{
    const {{ state }} = await import('/js/core/state.js');
    const includeHeavyMetrics = payload.includeHeavyMetrics !== false;
    const includeLongTasks = payload.includeLongTasks !== false;
    const transform = state.zoomTransform || {{ x: 0, y: 0, k: 1 }};
    const expectedLocal = {{
      x: payload.worldAnchor.x * Number(transform.k || 1) + Number(transform.x || 0),
      y: payload.worldAnchor.y * Number(transform.k || 1) + Number(transform.y || 0),
    }};
    const dx = expectedLocal.x - payload.anchorLocal.x;
    const dy = expectedLocal.y - payload.anchorLocal.y;
    const longTasks = Array.isArray(window.__perfBench?.longTasks) ? window.__perfBench.longTasks : [];
    const baselineLongTasks = Number(payload.baselineLongTasks || 0);
    const baselineTime = Number(payload.baselineTime || 0);
    const newLongTasks = longTasks
      .slice(baselineLongTasks)
      .filter((entry) => Number(entry.startTime || 0) >= baselineTime - 1)
      .map((entry) => ({{
        name: String(entry.name || ''),
        duration: Number(entry.duration || 0),
        startTime: Number(entry.startTime || 0),
        attribution: Array.isArray(entry.attribution) ? entry.attribution : [],
      }}));
    const blackPixelSamples = {sample_canvas_black_pixel_details_js()};
    return {{
      regionId: String(payload.regionId || ''),
      cycleIndex: Number(payload.cycleIndex || 0),
      wheelIndex: Number(payload.wheelIndex || 0),
      label: String(payload.label || ''),
      dtMs: Number((performance.now() - baselineTime).toFixed(3)),
      renderPhase: String(state.renderPhase || ''),
      isInteracting: !!state.isInteracting,
      transform: {{
        x: Number(transform.x || 0),
        y: Number(transform.y || 0),
        k: Number(transform.k || 1),
      }},
      anchorDriftPx: Number(Math.hypot(dx, dy).toFixed(3)),
      blackFrameCount: Number(state.renderPerfMetrics?.blackFrameCount?.count || 0),
      blackPixelRatio: blackPixelSamples?.ratio ?? {sample_canvas_black_pixel_ratio_js()},
      blackPixelSamples,
      blackPixelAttribution: blackPixelSamples ? {{
        schema: 'mc_black_pixel_attribution_v1',
        classification: String(blackPixelSamples.classification || ''),
        maxRegionRatio: Number(blackPixelSamples.maxRegionRatio || 0),
        blankCandidateCount: Number(blackPixelSamples.blankCandidateCount || 0),
        renderPhase: String(state.renderPhase || ''),
        regions: Array.isArray(blackPixelSamples.regions) ? blackPixelSamples.regions : [],
      }} : null,
      memory: {sample_js_heap_memory_js()},
      longTasks: includeLongTasks ? newLongTasks.slice(-40) : [],
      longTaskCountDelta: newLongTasks.length,
      maxLongTaskMs: newLongTasks.reduce((max, entry) => Math.max(max, Number(entry.duration || 0)), 0),
      longTaskDurationTotalMs: newLongTasks.reduce((sum, entry) => sum + Math.max(0, Number(entry.duration || 0)), 0),
      lastFrame: includeHeavyMetrics ? {clone_frame_js("state.renderPassCache?.lastFrame || null")} : null,
      renderMetrics: includeHeavyMetrics ? {clone_repeated_zoom_render_metrics_summary_js()} : {{}},
      passAttribution: includeHeavyMetrics ? {clone_repeated_zoom_pass_attribution_js()} : null,
      runtimeChunkLoadState: includeHeavyMetrics ? {clone_runtime_chunk_load_state_summary_js()} : null,
    }};
  }}, payload);
  const readActiveScenarioId = async () => await page.evaluate(async () => {{
    const {{ state }} = await import('/js/core/state.js');
    return String(state.activeScenarioId || '');
  }});

  const result = {{
    requestedScenarioId: String(config.scenarioId || ''),
    activeScenarioId: await readActiveScenarioId(),
    interactionProbeSchema: 'mc_repeated_zoom_regions_v1',
    passAttributionSchema: 'mc_pass_attribution_v1',
    blackPixelAttributionSchema: 'mc_black_pixel_attribution_v1',
    regionsRequested: config.regions,
    cyclesPerRegion: Number(config.cycles || 0),
    wheelsPerCycle: Number(config.wheelsPerCycle || 0),
    regions: {{}},
  }};

  for (const regionId of config.regions) {{
    await resetZoom();
    await waitForIdle(7000);
    const memoryBefore = await page.evaluate(() => {{ return {sample_js_heap_memory_js()}; }});
    const regionCycles = [];
    const longTaskAttribution = [];
    for (let cycleIndex = 0; cycleIndex < Number(config.cycles || 0); cycleIndex += 1) {{
      await resetZoom();
      await waitForIdle(7000);
      const target = await resolveTarget(regionId);
      const baseline = await captureBaseline();
      const samples = [];
      samples.push(await sample({{
        ...target,
        ...baseline,
        cycleIndex,
        wheelIndex: 0,
        label: 'before-cycle',
        includeHeavyMetrics: false,
        includeLongTasks: false,
      }}));
      await page.mouse.move(target.screenX, target.screenY);
      let lastWheelAt = Number(baseline.baselineTime || 0);
      for (let wheelIndex = 0; wheelIndex < Number(config.wheelsPerCycle || 0); wheelIndex += 1) {{
        await page.mouse.wheel(0, -280);
        lastWheelAt = await page.evaluate(() => performance.now());
        await page.waitForTimeout(80);
        samples.push(await sample({{
          ...target,
          ...baseline,
          cycleIndex,
          wheelIndex: wheelIndex + 1,
          label: `after-wheel-${{wheelIndex + 1}}`,
          includeHeavyMetrics: false,
          includeLongTasks: false,
        }}));
      }}
      const idleState = await waitForIdle(7000);
      samples.push(await sample({{
        ...target,
        ...baseline,
        cycleIndex,
        wheelIndex: Number(config.wheelsPerCycle || 0),
        label: 'after-idle-wait',
        includeHeavyMetrics: true,
        includeLongTasks: true,
      }}));
      const after = samples[samples.length - 1] || {{}};
      const lastWheelOffsetMs = Math.max(0, Number(lastWheelAt || 0) - Number(baseline.baselineTime || 0));
      const firstIdleAfterLastWheelMs = idleState?.timedOut
        ? null
        : Math.max(0, Number(after.dtMs || 0) - lastWheelOffsetMs);
      const cycleLongTasks = Array.isArray(after.longTasks) ? after.longTasks : [];
      longTaskAttribution.push({{
        regionId,
        cycleIndex,
        sampleLabel: 'after-idle-wait',
        tasks: cycleLongTasks.slice(0, 20),
      }});
      regionCycles.push({{
        regionId,
        cycleIndex,
        target,
        idleState,
        samples,
        firstIdleAfterLastWheelMs,
        longTaskCountDelta: cycleLongTasks.length,
        maxLongTaskMs: cycleLongTasks.reduce((max, entry) => Math.max(max, Number(entry.duration || 0)), 0),
        longTaskDurationTotalMs: cycleLongTasks.reduce((sum, entry) => sum + Math.max(0, Number(entry.duration || 0)), 0),
        maxBlackPixelRatio: samples.reduce((max, entry) => Math.max(max, Number(entry.blackPixelRatio || 0)), 0),
        blackFrameDelta: Math.max(0, Number(after.blackFrameCount || 0) - Number(baseline.baselineBlackFrameCount || 0)),
        memoryBefore: baseline.memory,
        memoryAfter: after.memory,
        memoryDelta: {{
          usedJSHeapSize: baseline.memory?.supported && after.memory?.supported ? (
            Number(after.memory?.usedJSHeapSize || 0)
            - Number(baseline.memory?.usedJSHeapSize || 0)
          ) : null,
        }},
        passAttribution: after.passAttribution || null,
        blackPixelAttribution: after.blackPixelAttribution || null,
      }});
    }}
    const memoryAfter = await page.evaluate(() => {{ return {sample_js_heap_memory_js()}; }});
    const idleValues = regionCycles
      .map((cycle) => Number(cycle.firstIdleAfterLastWheelMs))
      .filter(Number.isFinite);
    const firstCycleIdle = idleValues.length ? idleValues[0] : null;
    const lastCycleIdle = idleValues.length ? idleValues[idleValues.length - 1] : null;
    result.regions[regionId] = {{
      regionId,
      cycles: regionCycles,
      memoryBefore,
      memoryAfter,
      memoryDelta: {{
        usedJSHeapSize: memoryBefore?.supported && memoryAfter?.supported ? (
          Number(memoryAfter?.usedJSHeapSize || 0)
          - Number(memoryBefore?.usedJSHeapSize || 0)
        ) : null,
      }},
      degradation: {{
        firstCycleMs: firstCycleIdle,
        lastCycleMs: lastCycleIdle,
        ratio: firstCycleIdle && firstCycleIdle > 0 ? Number((lastCycleIdle / firstCycleIdle).toFixed(4)) : null,
      }},
      maxBlackPixelRatio: regionCycles.reduce((max, cycle) => Math.max(max, Number(cycle.maxBlackPixelRatio || 0)), 0),
      maxLongTaskMs: regionCycles.reduce((max, cycle) => Math.max(max, Number(cycle.maxLongTaskMs || 0)), 0),
      longTaskAttribution,
      passAttributionSchema: 'mc_pass_attribution_v1',
      passAttribution: regionCycles
        .map((cycle) => ({{
          cycleIndex: Number(cycle.cycleIndex || 0),
          passAttribution: cycle.passAttribution || null,
        }})),
      blackPixelAttribution: regionCycles
        .map((cycle) => ({{
          cycleIndex: Number(cycle.cycleIndex || 0),
          blackPixelAttribution: cycle.blackPixelAttribution || null,
        }})),
    }};
  }}
  await resetZoom();
  result.finalReset = await waitForIdle(7000);
  result.activeScenarioId = await readActiveScenarioId();
  return result;
}}
""".strip()
    timeout_sec = max(300, (len(regions) * cycles * max(20, wheels_per_cycle * 2)) + 240)
    return run_code_json(js, timeout_sec=timeout_sec)  # type: ignore[return-value]


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
      blackPixelRatio: {sample_canvas_black_pixel_ratio_js()},
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
    const doubleClickCandidates = state.landData.features
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
      }});
    const candidate = doubleClickCandidates.find((item) => item.countryFeatureCount >= 24) || doubleClickCandidates[0];
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
      blackPixelRatio: {sample_canvas_black_pixel_ratio_js()},
      renderMetrics: {clone_metrics_js("state.renderPerfMetrics")},
      scenarioMetrics: {clone_metrics_js("state.scenarioPerfMetrics")},
      overlay: document.getElementById('perf-overlay')?.textContent || '',
    }};
  }}, {json.dumps(target)});
}}
""".strip()
    return run_code_json(collect_js)  # type: ignore[return-value]


def capture_political_raster_worker_metrics() -> dict:
    js = """
async (page) => {
    return await page.evaluate(() => {
    const source = window.__mc_politicalRasterWorkerMetrics || {};
    return {
      protocolVersion: Number(source.protocolVersion || 0),
      roundTripMs: Number(source.roundTripMs || 0),
      rasterMs: Number(source.rasterMs || 0),
      encodeMs: Number(source.encodeMs || 0),
      decodeMs: Number(source.decodeMs || 0),
      blitMs: Number(source.blitMs || 0),
      timeoutCount: Number(source.timeoutCount || 0),
      recycleCount: Number(source.recycleCount || 0),
      staleResponseCount: Number(source.staleResponseCount || 0),
      acceptedCount: Number(source.acceptedCount || 0),
      rejectedStaleCount: Number(source.rejectedStaleCount || 0),
      fallbackCount: Number(source.fallbackCount || 0),
      enabled: !!source.enabled,
      lastReason: String(source.lastReason || ''),
      lastTaskId: String(source.lastTaskId || ''),
    };
  });
}
""".strip()
    return run_code_json(js)  # type: ignore[return-value]


def run_scenario_suite(
    base_urls: list[str],
    scenario_id: str,
    screenshot_dir: Path,
    repeated_zoom_regions: list[str],
    repeated_zoom_cycles: int,
    repeated_zoom_wheels_per_cycle: int,
) -> dict:
    print(f"[benchmark] start scenario={scenario_id}", flush=True)
    # Each scenario is intentionally isolated. TNO can inherit enough browser
    # state from a previous heavy scenario to make navigation itself flaky,
    # which pollutes the benchmark before any measured action starts.
    close_session()
    page_load = open_page(build_scenario_open_urls(base_urls, scenario_id))
    startup_ready = wait_for_benchmark_runtime_ready(f"open:{scenario_id}")
    clear_browser_buffers()
    normalized_scenario_id = str(scenario_id or "").strip()
    active_scenario_id = str(page_load.get("activeScenarioId") or "").strip()
    if normalized_scenario_id and normalized_scenario_id != "none" and active_scenario_id == normalized_scenario_id:
      print(f"[benchmark] capture current scenario={scenario_id}", flush=True)
      scenario_apply = capture_current_scenario_metrics(scenario_id)
    else:
      print(f"[benchmark] apply scenario={scenario_id}", flush=True)
      scenario_apply = apply_scenario(scenario_id)
    post_apply_metrics = (
      {
        "requestedScenarioId": scenario_id,
        "activeScenarioId": active_scenario_id,
        "politicalCoreReadyObserved": False,
        "politicalCoreReadyGate": {
          "outcome": "captured-current-scenario",
          "reason": "open-state-only",
        },
      }
      if bool(scenario_apply.get("capturedCurrentScenario"))
      else measure_post_apply_metrics(
        scenario_id,
        (scenario_apply.get("metricBaselines") or {}).get("timeToPoliticalCoreReadyRecordedAt"),
        False,
      )
    )
    print(f"[benchmark] idle redraw scenario={scenario_id}", flush=True)
    idle_full_redraw = force_idle_full_redraw(f"benchmark-{scenario_id}-idle-full-redraw")
    context_probes = measure_context_probes(scenario_id)
    print(f"[benchmark] zoom settle scenario={scenario_id}", flush=True)
    zoom_settle_redraw = measure_zoom_settle_redraw()
    zoom_end_chunk_visible = measure_zoom_end_chunk_visible(scenario_id)
    print(f"[benchmark] wheel anchor scenario={scenario_id}", flush=True)
    wheel_anchor_trace = measure_wheel_anchor_trace(scenario_id)
    repeated_zoom_regions_probe = measure_repeated_zoom_regions(
      scenario_id,
      repeated_zoom_regions,
      repeated_zoom_cycles,
      repeated_zoom_wheels_per_cycle,
    )
    rapid_wheel_screenshot_path = (
      take_screenshot(screenshot_dir / f"{scenario_id or 'none'}-rapid-wheel.png")
      if wheel_anchor_trace
      else None
    )
    print(f"[benchmark] interactive pan scenario={scenario_id}", flush=True)
    interactive_pan_frame = measure_interactive_pan_frame()
    interactive_pan_screenshot_path = take_screenshot(screenshot_dir / f"{scenario_id or 'none'}-interactive-pan.png")
    print(f"[benchmark] single fill scenario={scenario_id}", flush=True)
    single_fill = measure_single_click_fill()
    print(f"[benchmark] double fill scenario={scenario_id}", flush=True)
    double_click_fill = measure_double_click_fill()
    political_raster_worker = capture_political_raster_worker_metrics()
    console_issues = capture_console_issues()
    network_issues = capture_network_issues()
    screenshot_path = take_screenshot(screenshot_dir / f"{scenario_id or 'none'}-home.png")
    print(f"[benchmark] done scenario={scenario_id}", flush=True)
    suite = {
      "scenarioId": scenario_id,
      "pageLoad": page_load,
      "startupReady": startup_ready,
      "scenarioApply": scenario_apply,
      "postApplyMetrics": post_apply_metrics,
      "idleFullRedraw": idle_full_redraw,
      "contextProbes": context_probes,
      "zoomSettleFullRedraw": zoom_settle_redraw,
      "zoomEndChunkVisible": zoom_end_chunk_visible,
      "wheelAnchorTrace": wheel_anchor_trace,
      "repeatedZoomRegions": repeated_zoom_regions_probe,
      "interactivePanFrame": interactive_pan_frame,
      "singleFill": single_fill,
      "doubleClickFill": double_click_fill,
      "politicalRasterWorker": political_raster_worker,
      "consoleIssues": console_issues,
      "networkIssues": network_issues,
      "screenshots": {
        "home": screenshot_path,
        "rapidWheel": rapid_wheel_screenshot_path,
        "interactivePan": interactive_pan_screenshot_path,
      },
    }
    suite["scenarioConsistency"] = build_suite_scenario_consistency(suite)
    suite["benchmarkMetrics"] = build_suite_benchmark_metrics(suite)
    water_cache_delta = build_water_cache_delta_summary(context_probes)
    suite["waterCacheDelta"] = water_cache_delta
    suite["waterCacheRecommendation"] = decide_water_cache_low_coverage_recommendation(scenario_id, water_cache_delta)
    return suite


def build_water_cache_summary_by_scenario(suites: dict[str, dict]) -> dict[str, dict]:
    summary: dict[str, dict] = {}
    for scenario_id, suite in suites.items():
      water_cache_delta = suite.get("waterCacheDelta") if isinstance(suite.get("waterCacheDelta"), dict) else None
      recommendation = (
        suite.get("waterCacheRecommendation")
        if isinstance(suite.get("waterCacheRecommendation"), dict)
        else decide_water_cache_low_coverage_recommendation(scenario_id, water_cache_delta)
      )
      summary[scenario_id] = {
        "waterCacheDelta": water_cache_delta,
        "waterCacheRecommendation": recommendation,
      }
    return summary


def main() -> None:
    args = parse_args()
    if hasattr(sys.stdout, "reconfigure"):
      try:
          sys.stdout.reconfigure(encoding="utf-8", errors="replace")
      except Exception:
          pass
    PWCLI_WORKDIR.mkdir(parents=True, exist_ok=True)

    out_path = (ROOT_DIR / args.out).resolve()
    water_cache_out_path = (ROOT_DIR / WATER_CACHE_REPORT_PATH).resolve()
    screenshot_dir = (ROOT_DIR / args.screenshot_dir).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    water_cache_out_path.parent.mkdir(parents=True, exist_ok=True)
    screenshot_dir.mkdir(parents=True, exist_ok=True)

    effective_url = normalize_playwright_url(args.url)
    repeated_zoom_regions = parse_repeated_zoom_regions(args.repeated_zoom_regions)

    try:
      suite_base_urls = unique_strings([
          effective_url,
          ensure_app_path_url(effective_url),
          args.url,
          ensure_app_path_url(args.url),
      ])
      suites = {
        scenario_id: run_scenario_suite(
          suite_base_urls,
          scenario_id,
          screenshot_dir,
          repeated_zoom_regions,
          int(args.repeated_zoom_cycles),
          int(args.repeated_zoom_wheels_per_cycle),
        )
        for scenario_id in SCENARIO_IDS
      }
      water_cache_summary_by_scenario = build_water_cache_summary_by_scenario(suites)
      report = {
        "createdAt": datetime.now(timezone.utc).astimezone().isoformat(),
        "gitHead": resolve_git_head(),
        "schemaVersion": 1,
        "probeSchema": "mc_perf_snapshot",
        "interactionProbeSchema": "mc_repeated_zoom_regions_v1",
        "passAttributionSchema": "mc_pass_attribution_v1",
        "url": args.url,
        "effectiveUrl": effective_url,
        "scenarioIds": SCENARIO_IDS,
        "benchmarkMetricsSchemaVersion": "3.3",
        "config": {
          "repeatedZoomRegions": repeated_zoom_regions,
          "repeatedZoomCycles": int(args.repeated_zoom_cycles),
          "repeatedZoomWheelsPerCycle": int(args.repeated_zoom_wheels_per_cycle),
        },
        "benchmarkMetricsByScenario": {
          scenario_id: suites[scenario_id].get("benchmarkMetrics", {})
          for scenario_id in SCENARIO_IDS
        },
        "scenarioConsistencyByScenario": {
          scenario_id: suites[scenario_id].get("scenarioConsistency", {})
          for scenario_id in SCENARIO_IDS
        },
        "waterCacheSummaryByScenario": water_cache_summary_by_scenario,
        "waterCacheSummaryPath": str(water_cache_out_path),
        "suites": suites,
      }
      water_cache_report = {
        "createdAt": report["createdAt"],
        "sourceBenchmarkPath": str(out_path),
        "scenarioIds": SCENARIO_IDS,
        "waterCacheSummaryByScenario": water_cache_summary_by_scenario,
      }
      out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
      water_cache_out_path.write_text(json.dumps(water_cache_report, indent=2, ensure_ascii=False), encoding="utf-8")
      print(json.dumps(report, indent=2, ensure_ascii=False))
    finally:
      close_session()


if __name__ == "__main__":
    main()
