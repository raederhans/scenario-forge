"""Render Actions job timestamps as diagnostics, without wrapping release commands."""

from __future__ import annotations

import html
import json
import os
import sys
from datetime import datetime


def duration_seconds(record: dict) -> float | None:
    if record.get("conclusion") == "skipped":
        return None
    try:
        start = datetime.fromisoformat(record["started_at"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(record["completed_at"].replace("Z", "+00:00"))
        seconds = (end - start).total_seconds()
        if start.year > 1 and end.year > 1 and seconds >= 0:
            return seconds
    except (KeyError, TypeError, ValueError, AttributeError):
        pass
    return None


def cell(value: object) -> str:
    return html.escape(str(value)).replace("|", "&#124;").replace("\n", " ").replace("\r", " ")


def elapsed(record: dict) -> str:
    seconds = duration_seconds(record)
    return "n/a" if seconds is None else f"{seconds:.1f}s"


def render_summary(payload: dict, *, run_id: str, attempt: str) -> str:
    # This workflow has four jobs. Reject a partial page instead of silently
    # omitting slow jobs if its topology ever grows beyond the API page size.
    if payload["total_count"] != len(payload["jobs"]):
        raise ValueError("Incomplete jobs response; timing summary requires all jobs")
    jobs = [job for job in payload["jobs"] if job["name"] != "Deployment timing summary"]
    if not jobs:
        raise ValueError("No deployment jobs available")
    lines = [
        "## Deployment timing",
        "",
        f"Run {cell(run_id)}, attempt {cell(attempt)}. GitHub Actions timestamps; diagnostics only.",
        "Job elapsed time excludes queue time. Steps may overlap; do not sum them as wall time.",
        "Missing/skipped timestamps are n/a. Reused jobs from earlier attempts are not included.",
        "",
        "| Job | Result | Elapsed |",
        "| --- | --- | ---: |",
    ]
    for job in jobs:
        result = job.get("conclusion") or job.get("status", "unknown")
        lines.append(f"| {cell(job['name'])} | {cell(result)} | {elapsed(job)} |")
    steps = [(job["name"], step) for job in jobs for step in job.get("steps", [])]
    # Unknown times go last; real zero-duration steps remain measured values.
    steps.sort(key=lambda pair: duration_seconds(pair[1]) if duration_seconds(pair[1]) is not None else -1, reverse=True)
    lines.extend([
        "", "### Slowest steps (up to 15)", "",
        "| Job | Step | Result | Elapsed |",
        "| --- | --- | --- | ---: |",
    ])
    for name, step in steps[:15]:
        result = step.get("conclusion") or step.get("status", "unknown")
        lines.append(f"| {cell(name)} | {cell(step['name'])} | {cell(result)} | {elapsed(step)} |")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    print(render_summary(
        json.load(sys.stdin), run_id=os.environ["GITHUB_RUN_ID"],
        attempt=os.environ["GITHUB_RUN_ATTEMPT"],
    ), end="")
