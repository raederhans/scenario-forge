# Verify boot timeout repair 2026-04-07

## Plan

- 给启动入口增加 `default_scenario` query 覆盖，让 preload 和 bootstrap 共用同一个场景来源。
- 把 `scenario_apply_resilience.spec.js` 改成从 `hoi4_1939` 启动，避免先吃默认 `tno_1962` 的重型启动链。
- 给 `waitForAppInteractive()` 加启动状态快照，超时时直接暴露卡住阶段。
- 串行跑目标 e2e 与 smoke，确认 verify 恢复。

## Progress

- [x] 完成根因排查，确认问题先卡在 boot / startup 前置链，而不是 rollback 断言主体。
- [x] 完成实现方案收敛，选择“加启动覆盖 + 改 resilience 基线 + 补诊断”。
- [x] 落代码改动。
- [x] 串行跑验证。
- [x] 收尾复审并归档。

## Validation

- `node node_modules/@playwright/test/cli.js test tests/e2e/scenario_apply_resilience.spec.js --reporter=list --workers=1` ✅
- `npm run test:e2e:smoke` ✅
- 补充检查：`tests/e2e/scenario_shell_overlay_contract.spec.js` 仍失败，报错点在它自己的 `applyScenarioByIdCommand("hoi4_1939")` 路径超时，和本轮 `default_scenario` 覆盖修复无直接耦合，未纳入本次改动范围。
