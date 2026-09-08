# Task

## Current status

Complete: all five stages and the local acceptance criteria in plan.md are satisfied. This is the M4 recovery-cycle implementation and local acceptance, not remote CI, deployment, or historical P4 admission.

## Checklist

- [x] Consolidate water strategy paths.
- [x] Centralize scenario-layer cache lifecycle.
- [x] Complete relief owner and renderer assembly.
- [x] Behavior/assembly tests and focused verification routing.
- [x] Whole-scope validation and closeout.

## Validation evidence

- Prior slice: node --test tests/scenario_region_overlay_render_owner_behavior.test.mjs — 14/14 before and after consolidation.
- Final region/cache/relief integration suite: 20/20; relief drawing suite: 4/4; render cache invalidation suite: 8/8. Final two added cases independently passed after the combined run.
- `verify:edit` with the three affected owners passed: one shared behavior command plus the existing scenario quick command (58/58). Elapsed command time 3.52s. Initial separate route registration exceeded existing budgets; combining the same test leaves fixed it without changing budgets.
- Related cache host, context pass, water fill/signature and projected-bounds Node suites: 67/67.
- Physical-layer contract suite: 2/2; targeted heavy `exact-after-settle keeps scenario overlays` contract: 1/1.
- Renderer cache and pipeline Python boundary suites: 13/13.
- Verification metadata: 50/50; script portfolio tests passed. Route schema check: 471 routes. Full 13-file M4 changed set (including records) has zero unmatched paths.
- Existing TNO water `reuse` browser regression: 1/1, 46.9s total / 40.5s test; zero observed black frames. Test server exited with the runner. See `.runtime/tmp/m4-water-reuse.log`.
- HEAD reproduction confirmed failed forced water drawing left a reusable old identity (`baselineCanCompositeFailedLayer=true`). New end-to-end owner regression proves rejection and subsequent rebuild.
- `git diff --check` passed.

## Limitations outside the M4 acceptance scope

- Global `verify:state-write-allowlist` fails on the already-existing `tests/history_feature_color_refresh_behavior.test.mjs` direct singleton writes. Reading HEAD confirmed the same writer before this work; none of the four changed production modules became a new direct-writer file. The allowlist was not widened. This is not proof of full historical/indirect state-policy admission.
- Browser validation is one focused reuse-mode TNO case; unit/owner coverage exercises the other modes. No full browser matrix, remote CI, deployment or absolute performance improvement is claimed.
- Changes remain uncommitted. Pre-existing config and M0–M1 documents are preserved.
