# Review Findings Fix Plan 2026-04-29

## Scope

- Fix chunk refresh scheduling so normal scheduled refreshes start once, while flush-only paths still require pending work.
- Make checked-in chunk manifest cost fields match real chunk files and add a repository asset contract.
- Make repeated zoom metrics prove the active scenario before marking sameScenario.
- Make perf gate fail when current gate metrics are missing or non-positive.

## Tasks

- [x] Patch chunk refresh scheduling and targeted behavior coverage.
- [x] Patch manifest byte_size values and repository contract coverage.
- [x] Patch repeated zoom activeScenarioId reporting and metric trust test.
- [x] Patch perf gate current metric validation and contract test.
- [x] Run targeted verification and final self-review.
