from __future__ import annotations

import unittest

from tools.deploy_timing_summary import duration_seconds, render_summary


def record(name: str, seconds: int = 5, conclusion: str = "success") -> dict:
    return {
        "name": name, "status": "completed", "conclusion": conclusion,
        "started_at": "2026-10-15T12:00:00Z",
        "completed_at": f"2026-10-15T12:00:{seconds:02d}Z",
    }


class DeployTimingSummaryTests(unittest.TestCase):
    def test_durations_preserve_failed_and_zero_length_steps(self) -> None:
        self.assertEqual(duration_seconds(record("build", 12, "failure")), 12)
        self.assertEqual(duration_seconds(record("setup", 0)), 0)
        offset = {**record("setup"), "started_at": "2026-10-15T13:00:00+01:00"}
        self.assertEqual(duration_seconds(offset), 5)

    def test_missing_skipped_invalid_and_partial_times_are_not_zero(self) -> None:
        for entry in (
            {}, record("deploy", 0, "skipped"),
            {**record("build"), "completed_at": None},
            {**record("build"), "started_at": "bad"},
            {**record("build"), "started_at": "2026-10-15T12:01:00Z"},
            {**record("build"), "started_at": "0001-01-01T00:00:00Z"},
        ):
            with self.subTest(entry=entry):
                self.assertIsNone(duration_seconds(entry))

    def test_summary_ranks_steps_preserves_results_and_excludes_itself(self) -> None:
        verify = {**record("verify / verify", 50, "failure"), "steps": [
            record("Setup Python", 2), record("Playwright", 30),
            record("Artifact gate", 15, "failure"),
        ]}
        jobs = [verify, record("build", 0, "skipped"), record("deploy", 0, "skipped"),
                record("Deployment timing summary", 59)]
        summary = render_summary({"total_count": 4, "jobs": jobs}, run_id="42", attempt="2")
        self.assertIn("Run 42, attempt 2", summary)
        self.assertIn("| verify / verify | failure | 50.0s |", summary)
        self.assertIn("| build | skipped | n/a |", summary)
        self.assertIn("| Artifact gate | failure | 15.0s |", summary)
        self.assertLess(summary.index("| Playwright |"), summary.index("| Artifact gate |"))
        self.assertLess(summary.index("| Artifact gate |"), summary.index("| Setup Python |"))
        self.assertNotIn("59.0s", summary)

    def test_summary_bounds_rows_and_escapes_table_cells(self) -> None:
        job = {**record("build|<script>\n"), "steps": [record(f"step-{i}", i) for i in range(20)]}
        summary = render_summary({"total_count": 1, "jobs": [job]}, run_id="42", attempt="1")
        self.assertIn("build&#124;&lt;script&gt; ", summary)
        self.assertIn("| step-19 |", summary)
        self.assertNotIn("| step-4 |", summary)

    def test_incomplete_or_empty_responses_are_explicitly_unavailable(self) -> None:
        for payload in ({"total_count": 2, "jobs": [record("build")]},
                        {"total_count": 0, "jobs": []}):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                render_summary(payload, run_id="42", attempt="1")


if __name__ == "__main__":
    unittest.main()
