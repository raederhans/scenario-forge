# task

## goal
完成 1A + 1B，使仓库获得稳定的 E2E 分层入口、统一 smoke 入口、manifest 覆盖检查，以及 required-check-safe 的 perf gate。

## in-scope
- tests/e2e manifest 与 layer test-list
- package.json layer 脚本与 smoke 兼容别名
- 覆盖检查脚本
- deploy.yml smoke 入口收口
- `.github/workflows/perf-pr-gate.yml`
- changed-files classifier 审计产物
- 基于实测稳定性对 smoke 4 条固定清单做一次收口调整

## out-of-scope
- 1C
- 第二阶段长 spec / `playwright-app.js` 拆分
- 第三阶段 reusable workflow 收口
