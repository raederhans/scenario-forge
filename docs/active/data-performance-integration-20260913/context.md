# Context

Starting main/origin/main 29988776 (PR135); no divergent branch-only commits. Clean contours checkout is historical evidence and retained. Main owns all git mutations and shared build/dist/CI processes. Ledger worker owns only tests/test_scenario_contracts.py focused repair; route reviewer is read-only.

Main local runtime: cwd repository root; logs .runtime/tmp/integration-20260913/*.log; one builder at a time writes dist. Target tests use temporary data, no browser server unless needed by a demonstrated failure. Completion requires process exit0 and actual assertions; failed tests are diagnosed before retries. Read-only reviewers consume completed logs, never poll processes.

Local acceptance complete: final canonical build512.47MiB; source/dist17 changed/new JS modules match after LF normalization. Full Pages/catalog82-case run initially exposed stale TNO preview, missing worker decoder edge, and two compacted coverage-ledger byte hashes. Rebuilt landing hero, updated dependency assertion, preserved source bytes for the two ledgers; focused failing methods and final size/manifest checks now pass. Main Node150/Python199; route9/portfolio58; ledger1; source/health/architecture/state checks passed. Final GitHub PR/merge/run receipts will be reported by integration owner and remain authoritative beyond this pre-delivery snapshot.
