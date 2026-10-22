# 开发与交付

[English](development-and-delivery.md)

## 本地检查

```sh
npm test                 # 全部 Node 与 Python 单元测试
npm run test:node        # 只跑 Node（tests/*.test.mjs）
npm run test:python      # 只跑 Python（pytest -n auto）
node --test tests/<file>.test.mjs   # 单个文件
npm run test:e2e:smoke   # 浏览器冒烟
npm run test:e2e:golden  # 黄金用户流程（约 10 分钟）
```

`tests/quarantine.json` 是 PR 上唯一的跳过清单，每一项都必须写明原因，修好或删掉后立即移除。nightly 用 `--all` 运行全部测试，包括隔离项和慢测试。

| 阶段 | 使用方式 |
| --- | --- |
| 编辑反馈 | 运行与改动最相关的测试文件；涉及 UI 行为时跑一个聚焦的浏览器检查。 |
| 提交前 | `npm test`。改了数据、构建或 Pages 入口时，加跑 `npm run verify:pages-dist`。 |
| 推送功能分支 | 在既有授权内推送，不需要额外的验证组合。 |
| PR 合并 | 以最终提交的 `PR Verify Required` 为准。 |
| 发布 | `main` 合并触发部署流程；CI、合并、产物验证和线上成功分别确认。 |

## PR 中的检查

每个 PR 都运行同一组检查，不按改动路径分流：

| Job | 内容 |
| --- | --- |
| `pr-tests` | 全部 Node 单元测试（2 个分片）和 Python 单元测试。 |
| `pr-verify-fast` | 公开样例项目校验、Quick Fill 层级数据与审计、数据目录健康检查、Pages 源码引用检查、Pages 产物构建与启动壳检查。 |
| `pr-golden` | 黄金用户流程（2 个分片）：启动、5 个场景切换与填色、撤销重做、保存后重新打开、PNG 导出、性能预算。只通过 DOM 和 `js/core/app_test_api.js` 访问应用。 |
| `pr-verify-smoke` | 浏览器冒烟、Golden Demo 和 Quick Fill 真实工具栏冒烟（`tools/check_quick_fill_browser.mjs`）。 |
| `pr-verify-hgo` | 独立 HGO 编辑器的检查、测试和数据校验。 |
| `PR Verify Required` | 汇总以上 job，任一失败即失败；这是唯一的 required check。 |

另外，Scenario Contract Matrix（5 个场景的严格数据合约）和 Transport Contract Required 也在每个 PR 上运行，可以从 Actions 手动重跑；它们不是 required check。性能门禁由 `perf-pr-gate.yml` 和 [性能策略](../tools/ci/perf_policy.mjs) 决定。

保存工作到功能分支无需先追平 `main`。准备合并时再 fetch 目标分支并确认最终提交的 required check；合并后的 Pages 发布独立验收。
