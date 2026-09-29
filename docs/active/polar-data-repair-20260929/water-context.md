# Water-only staging owner

Owner: `water_repair` agent. No other agent should run this water build concurrently.

Command (from this worktree root):

```powershell
python -m tools.rebuild_water_geometry --stage-root .runtime/tmp/water-repair-worker --refine-marine *> .runtime/tmp/water-repair-worker.log
```

The stage contains water-owned replacement files only. The log will be moved to `.runtime/tmp/water-repair-worker/build.log` when the command completes. Canonical `data/` files are not modified by this build.

Result: exit code 0. Log is at `.runtime/tmp/water-repair-worker/build.log`; `outputs.json` lists five water-owned replacements. The builder's planar and D3 runtime validation passed for both base topologies and the TNO runtime topology. The staged Bosporus-Dardanelles region has 72 polygon parts versus 82 in the input, with no components at or below the 1e-10 square-degree precision floor. The other three protected Turkey water regions retain exactly equal GeoJSON geometry. Integration must transplant the staged water objects into the newer political topology, not replace whole topology files.

The `--refine-marine` stage changed 36 TNO water geometries by its normal refinement behavior, including Arctic macro regions. It is retained only as diagnostic evidence. The integration candidate is a narrower second run:

```powershell
python -m tools.rebuild_water_geometry --stage-root .runtime/tmp/water-repair-worker/precision-only --repair-precision-only *> .runtime/tmp/water-repair-worker/precision-only.log
```

Move that log to `.runtime/tmp/water-repair-worker/precision-only/build.log` when complete. This command is owned by the same `water_repair` agent and will emit only the TNO runtime topology and TNO water GeoJSON.
