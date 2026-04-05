# Scenario Regression Repair

## Goal

- Restore `hoi4_1939` correctness after the recent loading and transport-flow refactor.
- Remove the startup and scenario-apply regressions that made scenario loading slower.
- Leave behind explicit regression gates so broken scenario packs cannot silently pass again.

## Repair Order

1. Freeze the historical 1939 semantic reference and compare it with current checked-in artifacts.
2. Fix the 1939 builder default owner-rule resolution and expectation baseline.
3. Fix startup worker partial-cache handling, full-bundle topology selection, and coarse prewarm blocking.
4. Tighten active scenario naming so bad scenario packs fail loudly instead of falling back to modern labels.
5. Rebuild `hoi4_1939`, rerun strict/domain checks, and record the accepted repo baseline.
