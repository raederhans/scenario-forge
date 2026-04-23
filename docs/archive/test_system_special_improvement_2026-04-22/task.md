# task

## goal
对照测试系统专项改进原计划，完成剩余项目并归档：补完 1C，收口剩余 workflow 重复，继续瘦身测试入口与 support 耦合，清理可直接消除的残留债务。

## in-scope
- `scenario_chunk_exact_after_settle_regression.spec.js` / `physical_layer_regression.spec.js` 的 static-contract 迁出
- `tests/e2e/support/playwright-app.js` 多职责拆分
- TNO 可见层合同的稳定入口恢复
- 长红 runtime spec 从稳定 layer manifest 移到 `tests/e2e/dev/` 专用入口
- `dev_workspace_render_boundary.spec.js` / `shortcut_history_render_boundary.spec.js` 的 dev-only 标记与 CI 排除
- `package.json` 新增 node / E2E 主题入口与 dev 入口
- `.github/workflows` 的 reusable verify / scenario matrix / peripheral cleanup
- `.runtime/tmp` 剩余 boot probe 清理

## out-of-scope
- `tools/build_*.py` 的 orchestrator 收口
- 长红 dev runtime 用例本身的运行时根因修复
- 超出本轮目标的额外大规模 spec 拆分（如 project-save-load / strategic-overlay-editing 只做留档，不在本轮硬拆）
