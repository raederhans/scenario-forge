# QA Directory Guide

This directory is the project's long-lived QA knowledge base, not a dump for runtime artifacts.

## Layout

- `QA-0xx_*.md`
  Active and historical execution notes that are still useful as implementation context.
- `HGO_reference_reports_2026-03-08/`
  Reference handbooks for `historic geographic overhaul` reuse work.
- `archive/pre_ui_execution/`
  Archived execution notes from the pre-UI phase.
- `archive/pre_ui_plans/`
  Archived planning and diagnostic documents migrated from the legacy `qa_reports/` tree.

## What Belongs Here

- Decision records worth keeping in the repo
- Implementation studies and audit summaries
- Reference reports that future work will reuse

## What Does Not Belong Here

- Browser smoke screenshots
- Temporary Playwright logs
- Generated reports that can be rebuilt
- Local scratch files

Use these locations for regenerable evidence instead:

- `.runtime/browser/mcp-artifacts/`
- `.runtime/browser/playwright-cli/`
- `.runtime/tmp/`
- `.runtime/reports/generated/`

Those locations are intentionally treated as disposable runtime outputs.
