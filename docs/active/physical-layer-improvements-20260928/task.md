# Integration status

- User authorized merge and push on 2026-09-29.
- Integration owner: root; branch codex/physical-layer-improvements-20260929; base 20bc0f6a.
- Physical-only deltas were extracted against the saved task baseline, preserving current main's ocean, lake, UI and ownership contracts and the primary checkout's mixed WIP.
- Targeted Node behavior: 115 checks plus 39 signature checks passed. Python geometry/catalog: 31 passed; data health passed.
- PR preflight static checks passed. All 110 adaptive execution groups passed across the initial run and two resumes after repairing fixtures/route expectations and rebuilding tracked dist. Original failure reports are retained alongside resumed results.
- Localhost integration browser: neutral pixel difference 0; local brush 5,598 changed pixels, none outside its support; all three physical geometry packs reported zero bad spherical parts. No captured runtime exceptions or failed requests. Test tab closed and server stopped.
- Pages dist rebuilt; catalog count is 671. The generated mirror also synchronizes source changes already present in current main. Detailed cover and DEM shading remain Alps-scoped.
- Next: commit/push, required remote CI and ordinary protected-main merge. No force push or primary-checkout reset/stash/cleanup.
- Final Pages startup/asset suite: 64 tests passed; all root-owned local test/build processes have completed.
