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
- 已有局部路由的 action/owner 修改，可用 `npm run verify:edit -- --changed-file <path>` 获得真实行为测试反馈；显式路径只代表本次选择的文件，不代表整个工作区已验收。
- `verify:core` 默认只含无资源锁的 child-safe 检查；完整非浏览器组合使用 `--include-reserved`，浏览器/主线程组合使用既有 `verify:core:main-thread`。不要把完整策略历史证明作为每次未提交修改的前置条件。
- UI 运行时行为在必要时运行一个聚焦的浏览器或 Playwright 检查。
- 共享契约、跨模块、数据、性能、构建、dist 或发布路径发生变化时，再扩大到相应的项目标准检查。
- `test:adaptive`、supervisor、`verify:core`、`verify:pr`、nightly、release 和全量浏览器检查只用于验证框架自身改动、相关高风险路径、CI / 发布任务，或用户明确要求的场景。
- bug 已复现、断言稳定且具有实际复发风险时，新增或更新回归测试。
- 检查已充分证明当前声明后停止；不重复未受新改动影响的检查，不为普通改动生成完整证据包。
- 不扩大 console、timeout 或 route allowlist 来掩盖真实失败。

## 提交与 PR

- 交付前运行 `npm run pr:plan`：只读查看本分支相对 `origin/main` 的已提交差异、未提交改动、建议的本地检查和预计 CI。它不 fetch、不执行测试，也不表示检查通过。
- 按计划运行本次所需的目标检查；覆盖缺口先补齐。`verify:edit` 用于局部反馈，`verify:commit` 用于提交前组合检查；不要把 `verify:pr`、nightly 或 release 作为每次推送功能分支的固定前置条件。
- 推送功能分支、PR 合并、部署分别汇报。PR 等待最终提交的 required checks；计划中的 deferred/diagnostic 不是已通过。遵守既有推送、合并和生产发布授权。
- 具体用法见 [开发与交付](docs/development-and-delivery.zh-CN.md)。

## 汇报

- 最终说明改动结果、涉及文件、实际运行的检查及重要验证缺口。
- 只有确实生成并与结论相关时才列出 artifact。
