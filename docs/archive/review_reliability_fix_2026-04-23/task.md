## 任务
- 修复 review 指出的两个问题：
  1. `CI=1` 时，全量 Playwright 入口应排除 `tests/e2e/dev/**`。
  2. `scenario-contract-matrix.yml` 的 pull_request paths 应覆盖 strict checker 的共享依赖文件。
- 只做最小必要修改。
- 验证方式：
  - `CI=1 playwright test --list` 检查 dev 目录是否已排除。
  - 静态检查 workflow 路径与 checker import 依赖是否一致。
- 当前结果：
  - `playwright.config.cjs` 已改为 `grepInvert + 精确 dev 目录 testIgnore` 组合。
  - `.github/workflows/scenario-contract-matrix.yml` 已补 `map_builder/config.py`、`map_builder/contracts.py`。
  - `CI=1 --list` 验证通过，dev-only 目录与 `@dev` 项均未进入清单。
