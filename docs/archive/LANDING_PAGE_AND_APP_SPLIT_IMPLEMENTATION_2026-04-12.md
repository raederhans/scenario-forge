# LANDING_PAGE_AND_APP_SPLIT_IMPLEMENTATION_2026-04-12

## Goal
- Build a bilingual pure-frontend landing page for Scenario Forge.
- Publish landing at `/` and keep the existing editor at `/app/`.
- Keep source changes minimal and avoid a full editor source migration.

## Decisions Locked
- Landing is a long-scroll editorial page.
- Product evidence comes first; feature list comes later.
- Tone is restrained, credible, human, and close to Anthropic/OpenAI product pages.
- Primary CTA goes to `/app/?view=guide`.
- Only the landing page is the public sharing and SEO surface.
- First release uses a `dist/` assembly step instead of a source-tree relocation.

## Execution Checklist
- [x] Confirm direction, IA, tone, route split, and SEO boundary with user.
- [x] Audit current app entry, deploy workflow, worker URL behavior, and test entry assumptions.
- [x] Create landing source files and assets.
- [x] Add dist assembly script for landing + `/app/` editor packaging.
- [x] Update local dev serving so `/` previews landing and `/app/` previews editor.
- [x] Update editor app entry assumptions for `/app/` in test/dev helpers.
- [x] Update Pages workflow to publish `dist/`.
- [x] Run focused validation and review for regressions.
- [ ] Archive this tracker into `docs/archive/` after completion.

## Progress Log
- 2026-04-12: Direction locked with user. Using minimal split strategy, not a source-tree relocation.
- 2026-04-12: Confirmed the biggest technical risk is startup worker URL resolution and legacy `/` editor assumptions in dev/test flow.

- 2026-04-12: Added bilingual landing source files under `landing/` with restrained editorial structure and generated publishable favicon/social preview assets.
- 2026-04-12: Added `tools/build_pages_dist.py`, Pages now publishes `dist/`, and built editor output receives a `noindex,nofollow` robots tag.
- 2026-04-12: Updated local dev + Playwright app entry assumptions to `/app/` and normalized startup worker URLs before they are sent to the worker.
