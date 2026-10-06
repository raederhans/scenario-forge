# Integration context

- Worktree: C:/Users/raede/.codex/worktrees/population-thematic-integration/mapcreator
- Branch: codex/population-thematic-20261006; initial base 926ee96f7.
- Root alone owns Git mutations, local integration tests, PR and CI monitoring. Git fetch/push uses per-command `-c http.proxy=http://localhost:15236`, matching existing Windows proxy preferences.
- Primary source C:/Users/raede/Desktop/dev/mapcreator is read-only during integration. Never reset, stash, clean or copy whole mixed source files over current main.
- population_merge_renderer owns renderer integration and its targeted tests; population_merge_data owns population build and data registration.
- Data process owner: population_merge_data. Command: `node tools/run_python.mjs tools/build_population_spatial.py --raster <primary .runtime GHSL TIF> --source-ledger <primary .runtime GHSL source.json>`, cwd this worktree. Log: `.runtime/reports/generated/population-integration/build.log`; succeeds only after current four-scene identity and conservation validation. No other owner polls or duplicates this builder.
- Root short/combined tests use this worktree and `.runtime/reports/generated/population-integration/` logs. Shared node_modules junction points at primary installed dependencies; no dependency upgrade or package mutation there.
- New main changes actual geometry in all four population scenes; TNO raw gzip SHA remains the geometry identity, decompression is JSON-only. Old sidecars cannot be rebound without recalculation.
- Feature commit `ec0bd9d7` was pushed. Current main `a91cb74e1` adds surface/edge rendering; it merged without conflicts and 93 combined renderer checks passed.
- Final Pages build uses `.runtime/p` to avoid Windows path-length limits. Build succeeded at 937.79 MiB and all 684 population pack files are present. Do not use tracked `dist` for one-off verification.
- Full Pages/landing contracts ran 86 cases: 85 passed, one found a stale canonical Mediterranean work-card SVG. The canonical generator updated only that SVG and its JSON, correcting RKM part.4 to part.5 after the earlier main topology change. Data owner owns the final parity rerun; required CI remains pending.
