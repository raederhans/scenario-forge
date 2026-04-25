# Context

- Repo: raederhans/scenario-forge
- Local branch: main
- Upstream: origin/main
- Final pushed SHA: 002aef5409a4444b1241d3a43cf4094f5163a082
- Final Actions run: https://github.com/raederhans/scenario-forge/actions/runs/24921254007

## Findings and fixes
- GitHub push protection blocked .claude/settings.local.json because it contained a GitHub PAT in commit daf2bd9. I rebuilt local main from origin/main, committed removal of tracked .claude settings, then cherry-picked the original seven commits with .claude/ kept out of tracked history.
- perf-pr-gate.yml failed to parse on push. I added push-aware event parsing and fixed the PowerShell un scalar that contained :.
- Build verification failed on stale static contract tests after the renderer runtime/facade split. I updated the tests to assert the current owner/facade boundaries.
- Pages data generation failed because generated urban polygons without overlap still need stable political owners. I extended ssign_urban_country_owners so unresolved urban rows use the nearest political owner.
- Pages build then spent too long in remote data generation. The deployment workflow now assembles Pages from checked-in data and keeps verification in the shared verify job plus startup shell test.

## Final cloud status
- perf-pr-gate: success, run 24921254015.
- Transport Contract Required: success, run 24921254003.
- Build and Deploy Scenario Forge: success, run 24921254007; verify, build, and deploy jobs all succeeded.
