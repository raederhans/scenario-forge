# plan

- [x] 完成 1C：把 `scenario_chunk_exact_after_settle_regression.spec.js` 与 `physical_layer_regression.spec.js` 的 static-contract 迁到 node test，并补脚本入口
- [x] 拆 `tests/e2e/support/playwright-app.js` 为多模块 support，同时保持现有导出兼容
- [x] 收尾 E2E 体系：合并 TNO 可见层合同、隔离长红 runtime spec 到 dev 入口、给 dev-only spec 加 `@dev` 并在 CI 排除、补分主题脚本入口
- [x] 收口 CI workflows：抽 `verify-shared.yml`、新增 `pr-verify.yml`、新增 `scenario-contract-matrix.yml`、精简 `peripheral-contract-review.yml`
- [x] 清理 `.runtime/tmp` 残留 probe 文件并更新任务留档
- [x] 执行验证、architect 复核、deslop、自检后归档文档
