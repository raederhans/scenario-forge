# tno_1962 Strict Contract Check Plan

- Reproduce `tools/check_scenario_contracts.py --strict` failure locally.
- Compare manifest, feature maps, runtime topology, and chunk id sets.
- Use generated same-source checkpoint data when it matches current runtime topology.
- Apply the smallest data sync needed for the strict contract.
- Re-run the failing strict check and targeted consistency probes.
