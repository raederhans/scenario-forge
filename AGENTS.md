# Mapcreator 项目规则

## 范围与所有权

- 遵循全局规则，并保留用户、其他 agent 和其他 worktree 的未归属改动。
- 改动保持在当前请求涉及的模块；优先现有项目脚本、测试入口和实现模式。
- `data/` 下的改动同时遵循最近的 `data/AGENTS.md`。

## 浏览器检查

- 用户明确要求浏览器检视，或 UI 行为无法通过代码和目标测试可靠证明时，使用 Playwright 检查 localhost 页面。
- 一般检查使用 quick 模式；只有用户要求全量巡检或问题确实跨越全部版块时使用 full 模式。
- 浏览器巡检配置以 `ops/browser-mcp/inspection-profile.toml` 为准，并遵守其中的时间、版块和截图预算。
- 优先报告可复现的控制台错误、网络失败和行为问题；截图只作为确有帮助的辅助证据。
- 除非用户明确要求，浏览器访问范围保持在 localhost。

## 运行时输出

- 所有一次性运行输出放在 `.runtime/` 下。
- 浏览器证据放在 `.runtime/browser/`，Playwright 输出放在 `.runtime/tests/playwright/`，生成报告放在 `.runtime/reports/generated/`，临时缓存放在 `.runtime/tmp/` 或 `.runtime/python/pycache/`。
- 不在仓库根目录写入临时截图、日志、缓存或生成报告。

## 验证

- 文档、注释和不参与执行或解析的文本变更无需运行项目测试。
- 隔离的行为变更默认运行一个最相关的目标测试或检查。
- 单元测试入口只有一个：`npm test`（或 `npm run test:node` / `npm run test:python`），单个文件用 `node --test tests/<file>.test.mjs`。
- UI 运行时行为在必要时运行一个聚焦的浏览器或 Playwright 检查。
- 黄金流程（`tests/e2e/golden/`，`npm run test:e2e:golden`）是重构的行为安全网：只通过 DOM 和 `window.__scenarioForgeTestApi`（`js/core/app_test_api.js`）读写应用。重写状态或渲染时，改这个适配模块让黄金流程继续通过，不要改黄金流程去迁就内部实现；性能预算在 `tests/e2e/golden/golden-budgets.js`。
- 共享契约、跨模块、数据、性能、构建、dist 或发布路径发生变化时，再扩大到相应的项目标准检查，例如 `npm run verify:pages-dist`。
- bug 已复现、断言稳定且具有实际复发风险时，新增或更新回归测试。
- 测试只验证可观察行为：调用真实模块、检查输出、状态或渲染结果。不要新增读取源码文本做字符串、正则、token、行数或哈希断言的测试，也不要为"文件结构/调用关系"写守卫测试；它们会在每次重构时失败，却拦不住行为回归。
- 跳过测试只能写进 `tests/quarantine.json` 并注明原因。
- 检查已充分证明当前声明后停止；不重复未受新改动影响的检查，不为普通改动生成完整证据包。
- 不扩大 console、timeout 或 route allowlist 来掩盖真实失败。

## 提交与 PR

- 提交前运行 `npm test`；每个 PR 在 CI 上运行同一组检查，不按改动路径分流。
- 推送功能分支、PR 合并、部署分别汇报。PR 等待最终提交的 `PR Verify Required`。遵守既有推送、合并和生产发布授权。
- 具体用法见 [开发与交付](docs/development-and-delivery.zh-CN.md)。

## 汇报

- 最终说明改动结果、涉及文件、实际运行的检查及重要验证缺口。
- 只有确实生成并与结论相关时才列出 artifact。
