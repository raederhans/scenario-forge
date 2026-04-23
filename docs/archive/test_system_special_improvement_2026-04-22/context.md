# context

- 任务边界已经收口到 1A + 1B：manifest、layer `--test-list`、layer 入口、smoke 重定义、覆盖检查、deploy smoke 统一入口，以及 perf-pr-gate required-check-safe 改造。
- 已落地内容：
  - 新增 `tests/e2e/test-layer-manifest.json`，只覆盖 `tests/e2e/*.spec.js` 这 45 个 Playwright spec。
  - 新增 `tools/e2e_layering.mjs`，负责 manifest 校验、5 份 `test-list` 生成、layer 运行入口、覆盖检查。
  - `test:e2e:smoke` 现已改成 `test:e2e:layer:smoke` 的兼容别名；smoke 固定为 4 个 spec，并在脚本层写死 `workers=2`、`retries=0`。
  - smoke 第 4 条由 `strategic_overlay_smoke.spec.js` 调整为 `ui_contract_foundation.spec.js`。原因是前者在当前仓库和本地运行环境里持续出现超时，无法作为稳定 smoke；后者能稳定覆盖主 UI foundation 入口，且实跑通过。
  - `scenario_apply_resilience.spec.js` 已留在 feature 层，从主 smoke 排除。
  - `deploy.yml` 的 E2E smoke 已收口到统一 smoke 入口，单独 strategic overlay smoke 步骤已移除。
  - `.github/workflows/perf-pr-gate.yml` 已改成 always-run `pull_request` workflow；`perf-gate` job 名保持不变；workflow 内新增 changed-files classifier、JSON/Markdown 审计产物和 artifact 上传。
- 轻量验证策略：
  - `npm run verify:test:e2e-layers` 通过。
  - `npm run test:e2e:layer:all -- --list` 枚举到 95 tests / 45 files。
  - `npm run test:e2e:smoke` 实跑通过，4 tests / 4 passed / 1.7m。
  - 定向 smoke 复跑通过：`hoi4_1939_ui_smoke + tno_1962_ui_smoke` 通过，`main_shell_i18n` 单跑通过，`strategic_overlay_smoke` 单跑通过。
  - JS 改动文件 `lsp_diagnostics` / `node --check` 为 0 error。
  - `perf-pr-gate.yml` 已做 `git diff --check`，只剩 CRLF warning，没有格式错误。
