#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$ROOT_DIR"

PROFILE_PATH="ops/browser-mcp/inspection-profile.toml"
MODE_OPT=""
MAX_RUNTIME_OVERRIDE=""

usage() {
  cat <<USAGE
Usage: bash ops/browser-mcp/run-smoke-browser-inspection.sh [options]

Options:
  --profile <path>            Inspection profile path (default: ops/browser-mcp/inspection-profile.toml)
  --mode <quick|full|auto>    Traversal mode override (default: profile decision.default_mode)
  --max-runtime-sec <n>       Override phase runtime budget in seconds
  -h, --help                  Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE_PATH="${2:-}"
      shift 2
      ;;
    --mode)
      MODE_OPT="${2:-}"
      shift 2
      ;;
    --max-runtime-sec)
      MAX_RUNTIME_OVERRIDE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ ! -f "$PROFILE_PATH" ]]; then
  echo "[ERROR] Profile not found: $PROFILE_PATH"
  exit 1
fi

for dep in python3 curl grep sed; do
  if ! command -v "$dep" >/dev/null 2>&1; then
    echo "[ERROR] Missing dependency: $dep"
    exit 1
  fi
done

if ! command -v powershell.exe >/dev/null 2>&1; then
  echo "[WARN] powershell.exe not found. Windows-local fallback may be unavailable."
fi

resolve_wsl_rg() {
  local candidate=""
  for candidate in /usr/bin/rg /usr/local/bin/rg "$(command -v rg 2>/dev/null || true)"; do
    [[ -n "$candidate" ]] || continue
    [[ -x "$candidate" ]] || continue
    if [[ "$candidate" == /mnt/* ]]; then
      continue
    fi
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}

RG_BIN="$(resolve_wsl_rg || true)"

match_quiet() {
  local pattern="$1"
  shift
  if [[ -n "$RG_BIN" ]]; then
    "$RG_BIN" -q "$pattern" "$@" 2>/dev/null
  else
    grep -Eq -- "$pattern" "$@" 2>/dev/null
  fi
}

match_quiet_i() {
  local pattern="$1"
  shift
  if [[ -n "$RG_BIN" ]]; then
    "$RG_BIN" -qi "$pattern" "$@" 2>/dev/null
  else
    grep -Eiq -- "$pattern" "$@" 2>/dev/null
  fi
}

match_quiet_fixed() {
  local pattern="$1"
  shift
  if [[ -n "$RG_BIN" ]]; then
    "$RG_BIN" -q -F "$pattern" "$@" 2>/dev/null
  else
    grep -Fq -- "$pattern" "$@" 2>/dev/null
  fi
}

extract_matches() {
  local pattern="$1"
  shift
  if [[ -n "$RG_BIN" ]]; then
    "$RG_BIN" --no-filename -o "$pattern" "$@" -S 2>/dev/null
  else
    grep -Eho -- "$pattern" "$@" 2>/dev/null
  fi
}

extract_matches_n() {
  local pattern="$1"
  shift
  if [[ -n "$RG_BIN" ]]; then
    "$RG_BIN" -n "$pattern" "$@" -S 2>/dev/null
  else
    grep -En -- "$pattern" "$@" 2>/dev/null
  fi
}

PARSE_DIR="$(mktemp -d)"
python3 - "$PROFILE_PATH" "$PARSE_DIR" <<'PY'
import json
import pathlib
import shlex
import sys
import tomllib

profile_path = pathlib.Path(sys.argv[1])
out_dir = pathlib.Path(sys.argv[2])
out_dir.mkdir(parents=True, exist_ok=True)

with profile_path.open("rb") as f:
    cfg = tomllib.load(f)

def b(v: object) -> str:
    return "1" if bool(v) else "0"

def clean(v: object) -> str:
    return str(v).replace("\t", " ").replace("\n", " ").strip()

def modes_csv(v: object) -> str:
    if isinstance(v, list) and v:
        return ",".join(clean(x) for x in v)
    return "quick,full"

def q(v: object) -> str:
    return shlex.quote(str(v))

def write_env_line(fh, key: str, value: object):
    fh.write(f"{key}={q(value)}\n")

def get_int(d: dict, key: str, default: int) -> int:
    try:
        return int(d.get(key, default))
    except Exception:
        return default

def get_str(d: dict, key: str, default: str) -> str:
    v = d.get(key, default)
    return clean(v) if v is not None else default

def get_bool(d: dict, key: str, default: bool) -> str:
    return b(d.get(key, default))

def get_list(d: dict, key: str) -> str:
    v = d.get(key, [])
    if not isinstance(v, list):
        return ""
    return "|".join(clean(x) for x in v)

def defaults_map():
    defaults = cfg.get("defaults", {})
    decision = cfg.get("decision", {})
    budgets = cfg.get("budgets", {})
    bq = budgets.get("quick", {})
    bf = budgets.get("full", {})
    evidence = cfg.get("evidence", {})
    outputs = cfg.get("outputs", {})

    data = {
        "PROFILE_VERSION": cfg.get("version", 1),
        "DEFAULT_BASE_HOST": get_str(defaults, "base_host", "localhost"),
        "DEFAULT_PORT_START": get_int(defaults, "port_range_start", 8000),
        "DEFAULT_PORT_END": get_int(defaults, "port_range_end", 8010),
        "DEFAULT_SERVER_TITLE_PATTERN": get_str(defaults, "server_title_pattern", "Scenario Forge"),
        "DEFAULT_WSL_WINDOWS_FALLBACK": get_bool(defaults, "wsl_windows_fallback", True),

        "DECISION_DEFAULT_MODE": get_str(decision, "default_mode", "auto"),
        "DECISION_AUTO_START_MODE": get_str(decision, "auto_start_mode", "quick"),
        "DECISION_UPGRADE_CROSS": get_bool(decision, "upgrade_on_cross_section_anomaly", True),
        "DECISION_CROSS_THRESHOLD": get_int(decision, "cross_section_threshold", 2),
        "DECISION_UPGRADE_INSUFFICIENT": get_bool(decision, "upgrade_on_insufficient_evidence", True),
        "DECISION_MIN_SECTIONS_CONFIDENCE": get_int(decision, "min_sections_for_confidence", 4),
        "DECISION_FULL_TRIGGER_KEYWORDS": get_list(decision, "full_trigger_keywords"),
        "DECISION_QUICK_TRIGGER_KEYWORDS": get_list(decision, "quick_trigger_keywords"),

        "BUDGET_QUICK_MAX_SECTIONS": get_int(bq, "max_sections", 6),
        "BUDGET_QUICK_MAX_SCREENSHOTS": get_int(bq, "max_screenshots", 8),
        "BUDGET_QUICK_MAX_RUNTIME_SEC": get_int(bq, "max_runtime_sec", 180),
        "BUDGET_QUICK_MAX_NETWORK_ENTRIES": get_int(bq, "max_network_entries", 300),

        "BUDGET_FULL_MAX_SECTIONS": get_int(bf, "max_sections", 20),
        "BUDGET_FULL_MAX_SCREENSHOTS": get_int(bf, "max_screenshots", 24),
        "BUDGET_FULL_MAX_RUNTIME_SEC": get_int(bf, "max_runtime_sec", 420),
        "BUDGET_FULL_MAX_NETWORK_ENTRIES": get_int(bf, "max_network_entries", 300),

        "EVIDENCE_CONSOLE_MIN_LEVEL": get_str(evidence, "console_min_level", "warning"),
        "EVIDENCE_NETWORK_INCLUDE_STATIC": get_bool(evidence, "network_include_static", True),
        "EVIDENCE_NETWORK_FAILED_ONLY": get_bool(evidence, "network_failed_only", True),

        "OUTPUT_ARTIFACT_DIR": get_str(outputs, "artifact_dir", ".runtime/browser/mcp-artifacts"),
        "OUTPUT_REPORT_PATH": get_str(outputs, "report_path", ".runtime/reports/generated/browser/ai-browser-mcp-smoketest.md"),
    }
    return data

env_path = out_dir / "profile.env"
with env_path.open("w", encoding="utf-8") as fh:
    for k, v in defaults_map().items():
        write_env_line(fh, k, v)

routes = cfg.get("routes", [])
with (out_dir / "routes.tsv").open("w", encoding="utf-8") as fh:
    for r in routes:
        rid = clean(r.get("id", ""))
        if not rid:
            continue
        row = [
            rid,
            clean(r.get("url", "/")),
            str(int(r.get("scroll", 0))),
            b(r.get("screenshot", True)),
            b(r.get("capture_console", True)),
            b(r.get("capture_network", True)),
            modes_csv(r.get("enabled_modes")),
        ]
        fh.write("\t".join(row) + "\n")

sections = cfg.get("sections", [])
with (out_dir / "sections.tsv").open("w", encoding="utf-8") as fh:
    for s in sections:
        sid = clean(s.get("id", ""))
        page = clean(s.get("page", ""))
        selector = clean(s.get("selector", ""))
        if not sid or not page or not selector:
            continue
        row = [
            sid,
            page,
            selector,
            clean(s.get("expand", "none")),
            str(int(s.get("scroll", 0))),
            clean(s.get("screenshot", "on_error")),
            clean(s.get("priority", "normal")),
            modes_csv(s.get("enabled_modes")),
        ]
        fh.write("\t".join(row) + "\n")

gestures = cfg.get("gestures", [])
with (out_dir / "gestures.tsv").open("w", encoding="utf-8") as fh:
    for g in gestures:
        gid = clean(g.get("id", ""))
        page = clean(g.get("page", ""))
        selector = clean(g.get("selector", ""))
        gtype = clean(g.get("type", "drag_zoom"))
        if not gid or not page or not selector:
            continue
        from_xy = g.get("from", [980, 500])
        to_xy = g.get("to", [1120, 580])
        wheel = int(g.get("wheel", 0))
        if not (isinstance(from_xy, list) and len(from_xy) >= 2):
            from_xy = [980, 500]
        if not (isinstance(to_xy, list) and len(to_xy) >= 2):
            to_xy = [1120, 580]
        row = [
            gid,
            page,
            selector,
            gtype,
            str(int(from_xy[0])),
            str(int(from_xy[1])),
            str(int(to_xy[0])),
            str(int(to_xy[1])),
            str(wheel),
            b(g.get("screenshot", True)),
            modes_csv(g.get("enabled_modes")),
        ]
        fh.write("\t".join(row) + "\n")
PY

source "$PARSE_DIR/profile.env"

REQUESTED_MODE="${MODE_OPT:-$DECISION_DEFAULT_MODE}"
if [[ "$REQUESTED_MODE" != "quick" && "$REQUESTED_MODE" != "full" && "$REQUESTED_MODE" != "auto" ]]; then
  echo "[ERROR] Invalid mode: $REQUESTED_MODE"
  exit 1
fi

AUTO_START_MODE="$DECISION_AUTO_START_MODE"
if [[ "$AUTO_START_MODE" != "quick" && "$AUTO_START_MODE" != "full" ]]; then
  AUTO_START_MODE="quick"
fi

if [[ "$OUTPUT_ARTIFACT_DIR" = /* ]]; then
  ART_DIR="$OUTPUT_ARTIFACT_DIR"
else
  ART_DIR="$ROOT_DIR/$OUTPUT_ARTIFACT_DIR"
fi
SHOT_DIR="$ART_DIR/screenshots"
LOG_DIR="$ART_DIR/logs"
if [[ "$OUTPUT_REPORT_PATH" = /* ]]; then
  REPORT_OUT="$OUTPUT_REPORT_PATH"
else
  REPORT_OUT="$ROOT_DIR/$OUTPUT_REPORT_PATH"
fi
mkdir -p "$ART_DIR" "$SHOT_DIR" "$LOG_DIR"
mkdir -p "$(dirname "$REPORT_OUT")"

TS="$(date +%Y%m%d-%H%M%S)"
RUN_LOG="$LOG_DIR/smoke-run-$TS.log"
DEV_LOG="$LOG_DIR/dev-server-$TS.log"
WIN_PID_FILE="$LOG_DIR/win-dev-server-$TS.pid"
SMOKE_SESSION_ID="mapcreator-smoke-$TS"

resolve_codex_home() {
  local candidate windows_user=""
  for candidate in "${CODEX_HOME:-}" "$HOME/.codex" "/mnt/c/Users/${USER:-}/.codex"; do
    [[ -n "$candidate" ]] || continue
    [[ -f "$candidate/skills/playwright/scripts/playwright_cli.sh" ]] || continue
    printf '%s\n' "$candidate"
    return 0
  done

  if command -v powershell.exe >/dev/null 2>&1; then
    windows_user="$(powershell.exe -NoProfile -Command '$env:USERNAME' 2>/dev/null | tr -d '\r')"
    candidate="/mnt/c/Users/${windows_user}/.codex"
    if [[ -n "$windows_user" && -f "$candidate/skills/playwright/scripts/playwright_cli.sh" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  return 1
}

export CODEX_HOME="$(resolve_codex_home || true)"
export PLAYWRIGHT_CLI_SESSION="$SMOKE_SESSION_ID"
PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
if [[ ! -f "$PWCLI" ]]; then
  echo "[ERROR] Missing Playwright CLI wrapper: $PWCLI" | tee -a "$RUN_LOG"
  exit 1
fi
PWCLI_WORKDIR="$ROOT_DIR/.runtime/browser/playwright-cli"
mkdir -p "$PWCLI_WORKDIR"

VISITED_ROUTES_FILE="$LOG_DIR/visited-routes-$TS.txt"
VISITED_SECTIONS_FILE="$LOG_DIR/visited-sections-$TS.txt"
SKIPPED_SECTIONS_FILE="$LOG_DIR/skipped-sections-$TS.txt"
SCREENSHOTS_FILE="$LOG_DIR/screenshots-$TS.txt"
CONSOLE_ISSUES_FILE="$LOG_DIR/console-issues-$TS.txt"
NETWORK_ISSUES_FILE="$LOG_DIR/network-issues-$TS.txt"
EXEC_PHASES_FILE="$LOG_DIR/executed-phases-$TS.txt"

: > "$VISITED_ROUTES_FILE"
: > "$VISITED_SECTIONS_FILE"
: > "$SKIPPED_SECTIONS_FILE"
: > "$SCREENSHOTS_FILE"
: > "$CONSOLE_ISSUES_FILE"
: > "$NETWORK_ISSUES_FILE"
: > "$EXEC_PHASES_FILE"

declare -A QUICK_ANOMALY_AREAS=()
QUICK_ANOMALY_TOTAL=0
QUICK_VISITED_SECTIONS=0
AUTO_UPGRADED=0
AUTO_UPGRADE_REASON=""

WSL_SERVER_PID=""
WINDOWS_SERVER_STARTED="0"
TARGET_PORT=""
BASE_URL=""
PHASE_TIMED_OUT="0"
REPORT_MAX_NETWORK_ENTRIES=0
BROWSER_SESSION_READY="0"
LAST_OPEN_URL=""
PWCLI_CALLS_TOTAL=0
PWCLI_DURATION_MS_TOTAL=0

CURRENT_MODE=""
CURRENT_MAX_SECTIONS=0
CURRENT_MAX_SCREENSHOTS=0
CURRENT_MAX_RUNTIME=0
CURRENT_MAX_NETWORK_ENTRIES=0
CURRENT_SECTION_COUNT=0
CURRENT_SCREENSHOT_COUNT=0
CURRENT_PHASE_START=0

cleanup() {
  if [[ -n "$WSL_SERVER_PID" ]]; then
    kill "$WSL_SERVER_PID" >/dev/null 2>&1 || true
  fi
  if [[ "$WINDOWS_SERVER_STARTED" == "1" && -f "$WIN_PID_FILE" ]]; then
    WIN_PID="$(cat "$WIN_PID_FILE" 2>/dev/null || true)"
    if [[ -n "$WIN_PID" ]]; then
      powershell.exe -NoProfile -Command "Stop-Process -Id $WIN_PID -Force -ErrorAction SilentlyContinue" >/dev/null 2>&1 || true
    fi
  fi
  run_pwcli close >/dev/null 2>&1 || true
  rm -rf "$PARSE_DIR"
}
trap cleanup EXIT

run_pwcli() {
  local start_ms end_ms elapsed_ms status
  start_ms="$(date +%s%3N)"
  set +e
  (
    export PLAYWRIGHT_CLI_SESSION="${PLAYWRIGHT_CLI_SESSION:-$SMOKE_SESSION_ID}"
    cd "$PWCLI_WORKDIR"
    bash "$PWCLI" "$@"
  )
  status=$?
  set -e
  end_ms="$(date +%s%3N)"
  if [[ "$start_ms" =~ ^[0-9]+$ && "$end_ms" =~ ^[0-9]+$ ]]; then
    elapsed_ms=$((end_ms - start_ms))
  else
    elapsed_ms=0
  fi
  PWCLI_CALLS_TOTAL=$((PWCLI_CALLS_TOTAL + 1))
  PWCLI_DURATION_MS_TOTAL=$((PWCLI_DURATION_MS_TOTAL + elapsed_ms))
  return "$status"
}

mode_enabled() {
  local modes_csv="$1"
  local mode="$2"
  [[ ",${modes_csv}," == *",${mode},"* ]]
}

json_quote() {
  python3 - "$1" <<'PY'
import json
import sys
print(json.dumps(sys.argv[1]))
PY
}

check_phase_runtime() {
  if (( CURRENT_MAX_RUNTIME <= 0 )); then
    return 0
  fi
  local now elapsed
  now=$(date +%s)
  elapsed=$((now - CURRENT_PHASE_START))
  if (( elapsed >= CURRENT_MAX_RUNTIME )); then
    PHASE_TIMED_OUT="1"
    echo "[WARN] Runtime budget reached for mode=${CURRENT_MODE} (${elapsed}s/${CURRENT_MAX_RUNTIME}s)." | tee -a "$RUN_LOG"
    return 1
  fi
  return 0
}

set_phase_budget() {
  local mode="$1"
  CURRENT_MODE="$mode"
  CURRENT_SECTION_COUNT=0
  CURRENT_SCREENSHOT_COUNT=0
  PHASE_TIMED_OUT="0"

  if [[ "$mode" == "quick" ]]; then
    CURRENT_MAX_SECTIONS=$BUDGET_QUICK_MAX_SECTIONS
    CURRENT_MAX_SCREENSHOTS=$BUDGET_QUICK_MAX_SCREENSHOTS
    CURRENT_MAX_RUNTIME=$BUDGET_QUICK_MAX_RUNTIME_SEC
    CURRENT_MAX_NETWORK_ENTRIES=$BUDGET_QUICK_MAX_NETWORK_ENTRIES
  else
    CURRENT_MAX_SECTIONS=$BUDGET_FULL_MAX_SECTIONS
    CURRENT_MAX_SCREENSHOTS=$BUDGET_FULL_MAX_SCREENSHOTS
    CURRENT_MAX_RUNTIME=$BUDGET_FULL_MAX_RUNTIME_SEC
    CURRENT_MAX_NETWORK_ENTRIES=$BUDGET_FULL_MAX_NETWORK_ENTRIES
  fi

  if [[ -n "$MAX_RUNTIME_OVERRIDE" ]]; then
    CURRENT_MAX_RUNTIME="$MAX_RUNTIME_OVERRIDE"
  fi

  if (( CURRENT_MAX_NETWORK_ENTRIES > REPORT_MAX_NETWORK_ENTRIES )); then
    REPORT_MAX_NETWORK_ENTRIES=$CURRENT_MAX_NETWORK_ENTRIES
  fi

  CURRENT_PHASE_START=$(date +%s)
  echo "$mode" >> "$EXEC_PHASES_FILE"
}

register_anomaly() {
  local mode="$1"
  local area="$2"
  if [[ "$mode" == "quick" ]]; then
    QUICK_ANOMALY_AREAS["$area"]=1
    QUICK_ANOMALY_TOTAL=$((QUICK_ANOMALY_TOTAL + 1))
  fi
}

extract_playwright_sources() {
  local pointer_log="$1"
  local out_file="$2"
  extract_matches "\\.runtime[/\\\\]browser[/\\\\]playwright-cli[/\\\\][^)]*\\.log|\\.playwright-cli[/\\\\][^)]*\\.log" "$pointer_log" \
    | sed 's#\\#/#g' \
    | sort -u > "$out_file" || true
}

collect_console_issues() {
  local pointer_log="$1"
  local context="$2"
  local mode="$3"
  local src_file="$LOG_DIR/.console-src-${mode}-${context//[:\/ ]/_}-$TS.txt"
  local had_issue=0

  extract_playwright_sources "$pointer_log" "$src_file"
  while IFS= read -r src; do
    [[ -z "$src" ]] && continue
    [[ ! -f "$src" ]] && continue
    while IFS= read -r line; do
      echo "[$mode][$context] $line" >> "$CONSOLE_ISSUES_FILE"
      had_issue=1
    done < <(extract_matches_n "\[ERROR\]|\[WARNING\]|TypeError|ReferenceError|ERR_" "$src" || true)
  done < "$src_file"

  rm -f "$src_file"

  if (( had_issue == 1 )); then
    register_anomaly "$mode" "$context"
  fi
  return $had_issue
}

collect_network_issues() {
  local pointer_log="$1"
  local context="$2"
  local mode="$3"
  local src_file="$LOG_DIR/.network-src-${mode}-${context//[:\/ ]/_}-$TS.txt"
  local had_issue=0
  local pattern

  extract_playwright_sources "$pointer_log" "$src_file"
  if [[ "$EVIDENCE_NETWORK_FAILED_ONLY" == "1" ]]; then
    pattern="=> \\[(4[0-9]{2}|5[0-9]{2})\\]|Failed|ERR_"
  else
    pattern="=> \\[[0-9]{3}\\]|Failed|ERR_"
  fi

  while IFS= read -r src; do
    [[ -z "$src" ]] && continue
    [[ ! -f "$src" ]] && continue
    while IFS= read -r line; do
      echo "[$mode][$context] $line" >> "$NETWORK_ISSUES_FILE"
      had_issue=1
    done < <(extract_matches_n "$pattern" "$src" || true)
  done < "$src_file"

  rm -f "$src_file"

  if (( had_issue == 1 )); then
    register_anomaly "$mode" "$context"
  fi
  return $had_issue
}

capture_screenshot() {
  local shot_name="$1"
  local full_page="$2"

  if (( CURRENT_SCREENSHOT_COUNT >= CURRENT_MAX_SCREENSHOTS )); then
    echo "[WARN] Screenshot budget reached for mode=${CURRENT_MODE}, skipping ${shot_name}." | tee -a "$RUN_LOG"
    return 1
  fi

  if ! check_phase_runtime; then
    return 1
  fi

  local shot_path="$SHOT_DIR/${shot_name}.png"
  local shot_log="$LOG_DIR/pw-shot-${shot_name}-$TS.log"

  if [[ "$full_page" == "1" ]]; then
    run_pwcli screenshot --filename "$shot_path" --full-page > "$shot_log"
  else
    run_pwcli screenshot --filename "$shot_path" > "$shot_log"
  fi

  CURRENT_SCREENSHOT_COUNT=$((CURRENT_SCREENSHOT_COUNT + 1))
  echo "$shot_path" >> "$SCREENSHOTS_FILE"
  return 0
}

collect_route_evidence() {
  local context="$1"
  local mode="$2"
  local capture_console="$3"
  local capture_network="$4"
  local console_log="$LOG_DIR/console-route-${context}-${mode}-$TS.log"
  local network_log="$LOG_DIR/network-route-${context}-${mode}-$TS.log"
  local before_console before_network after_console after_network

  before_console=$(wc -l < "$CONSOLE_ISSUES_FILE")
  before_network=$(wc -l < "$NETWORK_ISSUES_FILE")

  if [[ "$capture_console" == "1" ]]; then
    run_pwcli console "$EVIDENCE_CONSOLE_MIN_LEVEL" > "$console_log" || true
    collect_console_issues "$console_log" "route:${context}" "$mode" || true
  fi

  if [[ "$capture_network" == "1" ]]; then
    if [[ "$EVIDENCE_NETWORK_INCLUDE_STATIC" == "1" ]]; then
      run_pwcli network --static > "$network_log" || true
    else
      run_pwcli network > "$network_log" || true
    fi
    collect_network_issues "$network_log" "route:${context}" "$mode" || true
  fi

  after_console=$(wc -l < "$CONSOLE_ISSUES_FILE")
  after_network=$(wc -l < "$NETWORK_ISSUES_FILE")
  if (( after_console > before_console )) || (( after_network > before_network )); then
    return 0
  fi
  return 1
}

resolve_url() {
  local raw="$1"
  if [[ "$raw" =~ ^https?:// ]]; then
    echo "$raw"
  else
    echo "${BASE_URL}${raw}"
  fi
}

find_wsl_server_port() {
  local start="$DEFAULT_PORT_START"
  local end="$DEFAULT_PORT_END"
  for p in $(seq "$start" "$end"); do
    if curl -fsS "http://127.0.0.1:${p}/" > "/tmp/mapcreator-home-$p.html" 2>/dev/null; then
      if match_quiet_i "$DEFAULT_SERVER_TITLE_PATTERN" "/tmp/mapcreator-home-$p.html"; then
        echo "$p"
        return 0
      fi
    fi
  done
  return 1
}

parse_started_port_from_dev_log() {
  if [[ ! -f "$DEV_LOG" ]]; then
    return 1
  fi

  local line
  line="$(extract_matches "Server started at http://127\\.0\\.0\\.1:[0-9]+" "$DEV_LOG" | tail -n1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi

  printf '%s\n' "$line" | grep -Eo '[0-9]+$'
}

port_matches_expected_home() {
  local port="$1"
  if curl -fsS "http://127.0.0.1:${port}/" > "/tmp/mapcreator-home-$port.html" 2>/dev/null; then
    if match_quiet_i "$DEFAULT_SERVER_TITLE_PATTERN" "/tmp/mapcreator-home-$port.html"; then
      return 0
    fi
  fi
  return 1
}

start_wsl_server_if_needed() {
  if TARGET_PORT="$(find_wsl_server_port)"; then
    echo "[INFO] Reusing WSL dev server on 127.0.0.1:$TARGET_PORT" | tee -a "$RUN_LOG"
    return 0
  fi

  echo "[INFO] No WSL dev server detected. Starting python3 tools/dev_server.py" | tee -a "$RUN_LOG"
  nohup python3 tools/dev_server.py > "$DEV_LOG" 2>&1 &
  WSL_SERVER_PID=$!

  for _ in $(seq 1 25); do
    local parsed_port
    parsed_port="$(parse_started_port_from_dev_log || true)"
    if [[ -n "$parsed_port" ]]; then
      if port_matches_expected_home "$parsed_port"; then
        TARGET_PORT="$parsed_port"
        echo "[INFO] Parsed dev server port from log: 127.0.0.1:$TARGET_PORT" | tee -a "$RUN_LOG"
        return 0
      fi
    fi

    if TARGET_PORT="$(find_wsl_server_port)"; then
      echo "[INFO] Started WSL dev server on 127.0.0.1:$TARGET_PORT" | tee -a "$RUN_LOG"
      return 0
    fi
    sleep 1
  done

  echo "[ERROR] Could not find reachable WSL dev server on ports ${DEFAULT_PORT_START}-${DEFAULT_PORT_END}." | tee -a "$RUN_LOG"
  exit 1
}

ensure_windows_server_for_edge() {
  local port="$1"
  local test_url="http://${DEFAULT_BASE_HOST}:${port}/"
  local probe_log="$LOG_DIR/pw-open-probe-$TS.log"

  run_pwcli close >/dev/null 2>&1 || true
  run_pwcli open "$test_url" --browser msedge > "$probe_log" 2>&1 || true

  if ! match_quiet "ERR_CONNECTION_REFUSED|### Error" "$probe_log"; then
    BROWSER_SESSION_READY="1"
    LAST_OPEN_URL="$test_url"
    echo "[INFO] Edge can reach $test_url directly." | tee -a "$RUN_LOG"
    return 0
  fi

  if [[ "$DEFAULT_WSL_WINDOWS_FALLBACK" != "1" ]]; then
    echo "[ERROR] Edge cannot reach $test_url and fallback is disabled by profile." | tee -a "$RUN_LOG"
    exit 1
  fi

  echo "[WARN] Edge cannot reach WSL localhost endpoint ($test_url). Starting Windows-local server fallback." | tee -a "$RUN_LOG"

  if ! command -v powershell.exe >/dev/null 2>&1; then
    echo "[ERROR] powershell.exe is required for WSL fallback but not found." | tee -a "$RUN_LOG"
    exit 1
  fi

  local win_root win_pid_path
  win_root="$(wslpath -w "$ROOT_DIR")"
  win_pid_path="$(wslpath -w "$WIN_PID_FILE")"

  powershell.exe -NoProfile -Command "\$p=Start-Process -FilePath py -ArgumentList '-3','-m','http.server','${port}' -WorkingDirectory '${win_root}' -PassThru -WindowStyle Hidden; \$p.Id | Out-File -Encoding ascii '${win_pid_path}'" >/dev/null
  WINDOWS_SERVER_STARTED="1"
  for _ in $(seq 1 6); do
    sleep 0.5
    run_pwcli close >/dev/null 2>&1 || true
    run_pwcli open "$test_url" --browser msedge > "$probe_log" 2>&1 || true
    if ! match_quiet "ERR_CONNECTION_REFUSED|### Error" "$probe_log"; then
      BROWSER_SESSION_READY="1"
      LAST_OPEN_URL="$test_url"
      echo "[INFO] Windows-local fallback server active on ${DEFAULT_BASE_HOST}:${port}" | tee -a "$RUN_LOG"
      return 0
    fi
  done

  echo "[ERROR] Edge still cannot reach $test_url after Windows fallback." | tee -a "$RUN_LOG"
  exit 1
}

first_route_url_for_mode() {
  local mode="$1"
  local route_rows=()
  mapfile -t route_rows < "$PARSE_DIR/routes.tsv"
  local row rid url modes_csv
  for row in "${route_rows[@]}"; do
    IFS=$'\t' read -r rid url _ _ _ _ modes_csv <<< "$row"
    [[ -z "$rid" ]] && continue
    mode_enabled "$modes_csv" "$mode" || continue
    echo "$(resolve_url "$url")"
    return 0
  done
  return 1
}

run_section() {
  local sid="$1"
  local page="$2"
  local selector="$3"
  local expand="$4"
  local scroll="$5"
  local screenshot_policy="$6"
  local mode="$7"

  if (( CURRENT_SECTION_COUNT >= CURRENT_MAX_SECTIONS )); then
    echo "[$mode][$page] ${sid}: skipped (section budget reached)" >> "$SKIPPED_SECTIONS_FILE"
    return 0
  fi

  check_phase_runtime || return 0

  local selector_json expand_json
  selector_json="$(json_quote "$selector")"
  expand_json="$(json_quote "$expand")"

  local action_log="$LOG_DIR/pw-section-action-${sid}-${mode}-$TS.log"
  if ! run_pwcli run-code "async (page) => {
    const locator = page.locator(${selector_json}).first();
    await locator.scrollIntoViewIfNeeded();
    if (${expand_json} === 'click' || ${expand_json} === 'toggle') {
      await locator.click();
    }
    if (${scroll} > 0) {
      await page.mouse.wheel(0, ${scroll});
    }
  }" > "$action_log" 2>&1; then
    echo "[$mode][$page] ${sid}: skipped (selector not found: ${selector})" >> "$SKIPPED_SECTIONS_FILE"
    register_anomaly "$mode" "section:${sid}"
    if [[ "$screenshot_policy" == "on_error" ]]; then
      capture_screenshot "section-${sid}-error-${mode}-$TS" 0 || true
    fi
    return 0
  fi

  CURRENT_SECTION_COUNT=$((CURRENT_SECTION_COUNT + 1))
  if [[ "$mode" == "quick" ]]; then
    QUICK_VISITED_SECTIONS=$((QUICK_VISITED_SECTIONS + 1))
  fi

  echo "[$mode][$page] ${sid} (${selector})" >> "$VISITED_SECTIONS_FILE"

  if [[ "$screenshot_policy" == "always" ]]; then
    capture_screenshot "section-${sid}-${mode}-$TS" 0 || true
  fi

  return 0
}

run_gesture() {
  local gid="$1"
  local page="$2"
  local selector="$3"
  local gtype="$4"
  local x1="$5"
  local y1="$6"
  local x2="$7"
  local y2="$8"
  local wheel="$9"
  local gshot="${10}"
  local mode="${11}"

  check_phase_runtime || return 0

  local selector_json gtype_json
  selector_json="$(json_quote "$selector")"
  gtype_json="$(json_quote "$gtype")"
  local action_log="$LOG_DIR/pw-gesture-action-${gid}-${mode}-$TS.log"
  if ! run_pwcli run-code "async (page) => {
    const locator = page.locator(${selector_json}).first();
    await locator.scrollIntoViewIfNeeded();
    if (${gtype_json} === 'drag_zoom') {
      await page.mouse.move(${x1}, ${y1});
      await page.mouse.down({ button: 'left' });
      await page.mouse.move(${x2}, ${y2});
      await page.mouse.up({ button: 'left' });
      if (${wheel} !== 0) {
        await page.mouse.wheel(0, ${wheel});
      }
    }
  }" > "$action_log" 2>&1; then
    echo "[$mode][$page] ${gid}: skipped (selector not found: ${selector})" >> "$SKIPPED_SECTIONS_FILE"
    register_anomaly "$mode" "gesture:${gid}"
    return 0
  fi

  if [[ "$gshot" == "1" ]]; then
    capture_screenshot "gesture-${gid}-${mode}-$TS" 0 || true
  fi

  return 0
}

run_route() {
  local rid="$1"
  local raw_url="$2"
  local scroll="$3"
  local do_shot="$4"
  local capture_console="$5"
  local capture_network="$6"
  local mode="$7"
  local skip_navigation="${8:-0}"

  check_phase_runtime || return 0

  local url
  url="$(resolve_url "$raw_url")"

  echo "$url" >> "$VISITED_ROUTES_FILE"

  run_pwcli console "$EVIDENCE_CONSOLE_MIN_LEVEL" --clear > /dev/null 2>&1 || true
  run_pwcli network --clear > /dev/null 2>&1 || true

  if [[ "$skip_navigation" != "1" ]]; then
    local goto_log="$LOG_DIR/pw-goto-${rid}-${mode}-$TS.log"
    if ! run_pwcli goto "$url" > "$goto_log"; then
      echo "[$mode][route:${rid}] navigation failed: $url" >> "$NETWORK_ISSUES_FILE"
      register_anomaly "$mode" "route:${rid}"
      return 0
    fi
    LAST_OPEN_URL="$url"
    BROWSER_SESSION_READY="1"
  fi

  if (( scroll > 0 )); then
    run_pwcli mousewheel 0 "$scroll" > "$LOG_DIR/pw-scroll-${rid}-${mode}-$TS.log" || true
  fi

  local section_rows=()
  mapfile -t section_rows < "$PARSE_DIR/sections.tsv"
  local section_row sid page selector expand sscroll screenshot_policy _priority modes_csv
  for section_row in "${section_rows[@]}"; do
    IFS=$'\t' read -r sid page selector expand sscroll screenshot_policy _priority modes_csv <<< "$section_row"
    [[ -z "$sid" ]] && continue
    [[ "$page" != "$rid" ]] && continue
    mode_enabled "$modes_csv" "$mode" || continue
    run_section "$sid" "$page" "$selector" "$expand" "$sscroll" "$screenshot_policy" "$mode"
    [[ "$PHASE_TIMED_OUT" == "1" ]] && break
  done

  local gesture_rows=()
  mapfile -t gesture_rows < "$PARSE_DIR/gestures.tsv"
  local gesture_row gid page selector gtype x1 y1 x2 y2 wheel gshot modes_csv
  for gesture_row in "${gesture_rows[@]}"; do
    IFS=$'\t' read -r gid page selector gtype x1 y1 x2 y2 wheel gshot modes_csv <<< "$gesture_row"
    [[ -z "$gid" ]] && continue
    [[ "$page" != "$rid" ]] && continue
    mode_enabled "$modes_csv" "$mode" || continue
    run_gesture "$gid" "$page" "$selector" "$gtype" "$x1" "$y1" "$x2" "$y2" "$wheel" "$gshot" "$mode"
    [[ "$PHASE_TIMED_OUT" == "1" ]] && break
  done

  if [[ "$do_shot" == "1" ]]; then
    capture_screenshot "route-${rid}-${mode}-$TS" 1 || true
  fi

  if [[ "$capture_console" == "1" || "$capture_network" == "1" ]]; then
    collect_route_evidence "$rid" "$mode" "$capture_console" "$capture_network" || true
  fi

  return 0
}

run_mode_phase() {
  local mode="$1"
  set_phase_budget "$mode"

  local route_rows=()
  mapfile -t route_rows < "$PARSE_DIR/routes.tsv"
  local route_row rid url scroll do_shot capture_console capture_network modes_csv
  local first_route_id=""
  local first_url=""
  for route_row in "${route_rows[@]}"; do
    IFS=$'\t' read -r rid url scroll do_shot capture_console capture_network modes_csv <<< "$route_row"
    [[ -z "$rid" ]] && continue
    mode_enabled "$modes_csv" "$mode" || continue
    first_route_id="$rid"
    first_url="$(resolve_url "$url")"
    break
  done

  if [[ -z "$first_route_id" || -z "$first_url" ]]; then
    echo "[WARN] No routes configured for mode=$mode" | tee -a "$RUN_LOG"
    return 0
  fi

  local first_route_ready="0"
  if [[ "$BROWSER_SESSION_READY" == "1" && "$LAST_OPEN_URL" == "$first_url" ]]; then
    first_route_ready="1"
  else
    run_pwcli close >/dev/null 2>&1 || true
    if run_pwcli open "$first_url" --browser msedge > "$LOG_DIR/pw-open-${mode}-$TS.log" 2>&1; then
      BROWSER_SESSION_READY="1"
      LAST_OPEN_URL="$first_url"
      first_route_ready="1"
    fi
  fi

  echo "[INFO] Running mode phase: $mode" | tee -a "$RUN_LOG"

  local first_route_consumed="0"
  for route_row in "${route_rows[@]}"; do
    IFS=$'\t' read -r rid url scroll do_shot capture_console capture_network modes_csv <<< "$route_row"
    [[ -z "$rid" ]] && continue
    mode_enabled "$modes_csv" "$mode" || continue
    local skip_navigation="0"
    if [[ "$first_route_ready" == "1" && "$first_route_consumed" == "0" && "$rid" == "$first_route_id" ]]; then
      skip_navigation="1"
      first_route_consumed="1"
    fi
    run_route "$rid" "$url" "$scroll" "$do_shot" "$capture_console" "$capture_network" "$mode" "$skip_navigation"
    [[ "$PHASE_TIMED_OUT" == "1" ]] && break
  done

  return 0
}

start_wsl_server_if_needed
ensure_windows_server_for_edge "$TARGET_PORT"
BASE_URL="http://${DEFAULT_BASE_HOST}:${TARGET_PORT}"

echo "Smoke target base URL: $BASE_URL" > "$ART_DIR/smoke-instructions-$TS.txt"
{
  echo "Requested mode: $REQUESTED_MODE"
  echo "Profile: $PROFILE_PATH"
  echo "Expected route count: $(wc -l < "$PARSE_DIR/routes.tsv")"
} >> "$ART_DIR/smoke-instructions-$TS.txt"

echo "[INFO] Running profile-driven browser smoke" | tee -a "$RUN_LOG"

if [[ "$REQUESTED_MODE" == "quick" || "$REQUESTED_MODE" == "full" ]]; then
  run_mode_phase "$REQUESTED_MODE"
else
  local_start_mode="$AUTO_START_MODE"
  if [[ "$local_start_mode" != "quick" && "$local_start_mode" != "full" ]]; then
    local_start_mode="quick"
  fi

  run_mode_phase "$local_start_mode"

  if [[ "$local_start_mode" == "quick" ]]; then
    quick_unique_areas=${#QUICK_ANOMALY_AREAS[@]}

    if [[ "$DECISION_UPGRADE_CROSS" == "1" ]] && (( quick_unique_areas >= DECISION_CROSS_THRESHOLD )); then
      AUTO_UPGRADED=1
      AUTO_UPGRADE_REASON="cross_section_anomaly(unique_areas=${quick_unique_areas}, threshold=${DECISION_CROSS_THRESHOLD})"
    elif [[ "$DECISION_UPGRADE_INSUFFICIENT" == "1" ]] && (( QUICK_ANOMALY_TOTAL == 0 )) && (( QUICK_VISITED_SECTIONS < DECISION_MIN_SECTIONS_CONFIDENCE )); then
      AUTO_UPGRADED=1
      AUTO_UPGRADE_REASON="insufficient_evidence(visited_sections=${QUICK_VISITED_SECTIONS}, min_required=${DECISION_MIN_SECTIONS_CONFIDENCE})"
    fi

    if (( AUTO_UPGRADED == 1 )); then
      echo "[INFO] Auto-upgrade quick -> full because $AUTO_UPGRADE_REASON" | tee -a "$RUN_LOG"
      run_mode_phase "full"
    else
      echo "[INFO] Auto mode stayed in quick phase (no upgrade triggered)." | tee -a "$RUN_LOG"
    fi
  fi
fi

if (( REPORT_MAX_NETWORK_ENTRIES <= 0 )); then
  REPORT_MAX_NETWORK_ENTRIES=300
fi

mapfile -t REPORT_SHOTS < <(sort -u "$SCREENSHOTS_FILE" 2>/dev/null || true)
mapfile -t REPORT_ROUTES < <(sort -u "$VISITED_ROUTES_FILE" 2>/dev/null || true)
mapfile -t REPORT_SECTIONS < <(sort -u "$VISITED_SECTIONS_FILE" 2>/dev/null || true)
mapfile -t REPORT_SKIPPED < <(sort -u "$SKIPPED_SECTIONS_FILE" 2>/dev/null || true)
mapfile -t REPORT_PHASES < <(cat "$EXEC_PHASES_FILE" 2>/dev/null || true)
REPORT_ROUTE_COUNT="${#REPORT_ROUTES[@]}"
PWCLI_AVG_CALLS_PER_ROUTE=0
PWCLI_AVG_MS_PER_ROUTE=0
if (( REPORT_ROUTE_COUNT > 0 )); then
  PWCLI_AVG_CALLS_PER_ROUTE=$((PWCLI_CALLS_TOTAL / REPORT_ROUTE_COUNT))
  PWCLI_AVG_MS_PER_ROUTE=$((PWCLI_DURATION_MS_TOTAL / REPORT_ROUTE_COUNT))
fi

{
  echo "# AI Browser MCP Smoke Test"
  echo
  echo "Date: $(date -u +'%Y-%m-%d %H:%M:%S UTC')"
  echo "Profile: $PROFILE_PATH"
  echo "Requested Mode: $REQUESTED_MODE"
  echo "Executed Phases: ${REPORT_PHASES[*]:-none}"
  if (( AUTO_UPGRADED == 1 )); then
    echo "Auto Upgrade: quick -> full"
    echo "Auto Upgrade Reason: $AUTO_UPGRADE_REASON"
  else
    echo "Auto Upgrade: not triggered"
  fi
  echo "Base URL: $BASE_URL"
  echo
  echo "## Visited URLs"
  if (( ${#REPORT_ROUTES[@]} > 0 )); then
    for u in "${REPORT_ROUTES[@]}"; do
      echo "- $u"
    done
  else
    echo "- No routes were visited."
  fi
  echo
  echo "## Covered Sections"
  if (( ${#REPORT_SECTIONS[@]} > 0 )); then
    for s in "${REPORT_SECTIONS[@]}"; do
      echo "- $s"
    done
  else
    echo "- No sections were inspected."
  fi
  echo
  echo "## Skipped Sections"
  if (( ${#REPORT_SKIPPED[@]} > 0 )); then
    for s in "${REPORT_SKIPPED[@]}"; do
      echo "- $s"
    done
  else
    echo "- None"
  fi
  echo
  echo "## Screenshot files"
  if (( ${#REPORT_SHOTS[@]} > 0 )); then
    for s in "${REPORT_SHOTS[@]}"; do
      echo "- $s"
    done
  else
    echo "- No screenshots captured."
  fi
  echo
  echo "## Playwright CLI Metrics"
  echo "- Session: $SMOKE_SESSION_ID"
  echo "- Total CLI calls: $PWCLI_CALLS_TOTAL"
  echo "- Total CLI time (ms): $PWCLI_DURATION_MS_TOTAL"
  echo "- Avg CLI calls per visited route: $PWCLI_AVG_CALLS_PER_ROUTE"
  echo "- Avg CLI time per visited route (ms): $PWCLI_AVG_MS_PER_ROUTE"
  echo
  echo "## Console summary"
  if [[ -s "$CONSOLE_ISSUES_FILE" ]]; then
    sed 's/^/- /' "$CONSOLE_ISSUES_FILE"
  else
    echo "- No warning/error lines matched the summary filter."
  fi
  echo
  echo "## Network summary"
  if [[ -s "$NETWORK_ISSUES_FILE" ]]; then
    head -n "$REPORT_MAX_NETWORK_ENTRIES" "$NETWORK_ISSUES_FILE" | sed 's/^/- /'
  else
    echo "- No 4xx/5xx lines matched the summary filter."
  fi
  echo
  echo "## Initial rendering diagnosis clues"
  if match_quiet "europe_topology\.highres\.json" "$CONSOLE_ISSUES_FILE" "$NETWORK_ISSUES_FILE"; then
    echo "- Home page attempts to load data/europe_topology.highres.json and falls back to data/europe_topology.json.bak."
  fi
  if match_quiet "favicon\.ico" "$CONSOLE_ISSUES_FILE" "$NETWORK_ISSUES_FILE"; then
    echo "- Favicon requests include 404 responses (low severity noise)."
  fi
  if match_quiet_fixed '$(...).ready is not a function' "$CONSOLE_ISSUES_FILE" "$NETWORK_ISSUES_FILE"; then
    echo '- README third-party page logs jQuery compatibility error: $(...).ready is not a function.'
  fi
  echo "- Evidence order follows: console -> network -> screenshots -> repro steps -> patch hint."
} > "$REPORT_OUT"

echo "[OK] Smoke complete. Report: $REPORT_OUT" | tee -a "$RUN_LOG"
echo "[OK] Screenshots listed in: $SCREENSHOTS_FILE" | tee -a "$RUN_LOG"
