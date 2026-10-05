# 开发与交付

[English](development-and-delivery.md)

完成一项改动后，先查看本次交付计划：

```sh
npm run pr:plan
```

这个命令只读本地 Git 引用，不联网、不修改文件、不运行测试。它分别显示相对 `origin/main` 的已提交差异、未提交改动，以及两者合并后的预计检查；远端 CI 实际只能验证推送后的提交。目标分支引用需要由贡献者适时更新，计划中的 SHA 是本次判断的依据。

```sh
npm run pr:plan -- --base origin/main --json
npm run pr:plan -- --changed-file js/ui/styled_selects.js
npm run pr:plan -- --labels ci:perf-strict
```

显式文件参数只预览指定范围。标签参数描述预计的 PR 标签，默认假定没有标签；命令不会读取或更改 GitHub 标签。计划不是通过证明，未匹配路径或执行路由缺口必须处理，deferred 检查仍未执行。

| 阶段 | 使用方式 |
| --- | --- |
| 编辑反馈 | 计划中的目标行为测试，或 `verify:edit -- --changed-file <path>`。涉及 UI 行为时运行相关浏览器检查。 |
| 提交准备 | 检查本次 diff、所有权和覆盖；需要组合检查时使用 `verify:commit`。它会执行检查，默认读取未提交工作区，已提交分支差异以 `pr:plan` 为准。 |
| 推送功能分支 | 在既有授权内推送本次提交，无需重复叠加完整 `verify:pr`。 |
| PR 合并 | CI 使用同一 PR 策略，按受影响范围执行；以最终提交的 required checks 为准。 |
| 发布 | `main` 合并会触发现有部署流程；CI、合并、产物验证和线上成功分别确认。 |

`verify:pr` 是显式的较宽验证组合，不是远端 PR 工作流的本地复刻，也不是每次推送的必选项。`verify:core`、nightly、release 的边界见 [验证维护说明](testing/verify-core.md)。仓库没有自动运行这些命令的提交或推送 hook。

PR 按整个提交范围分流，混合改动采用较宽的检查：

| 改动范围 | PR 中的检查 |
| --- | --- |
| 纯 README / 普通 Markdown 文档 | 保留分类与 required 汇总，跳过测试环境、浏览器和 Pages 构建；`docs/testing` 不适用此豁免。 |
| 已登记的局部 UI | 受影响契约、5 个聚焦浏览器测试、Pages 源码引用检查；性能采样保留为观察任务，合并门禁不等待它。 |
| 其他 JS/CSS 运行时 | 受影响契约、既有 smoke、源码引用检查，以及适用的必需性能测量。 |
| 数据、依赖、入口、打包或 CI 路由 | 完整 Pages artifact 检查及该范围要求的其他检查。`ci:full` 强制完整 PR 路由，`ci:perf-strict` 强制严格性能测量。 |

局部 UI 当前仅包括 `editor-workspace.css`、`editor-tool-guidance.css`、`styled_selects.js` 和 `toolbar/tool_guidance.js`，以 [共享策略](../tools/ci/perf_policy.mjs) 的完整路径为准。任意其他文件混入后重新按全部改动分类；未知路径不能获得 UI 豁免。

可用 `npm run verify:pages-source-graph` 单独检查当前源码的页面、JS/MJS 和 CSS 引用。它不生成 dist，也不证明地图数据内容、压缩或发布产物完整性；这些仍由完整构建和发布检查负责。

保存工作到功能分支无需先追平 `main` 或重跑整套验证。准备合并时再 fetch 目标分支，确认最终提交和 required checks；若远端要求分支追平，合并最新 `main` 后仅等待这次更新的 CI，不叠加本地 `verify:pr`。标签增删会重新规划检查；合并后的 Pages 发布独立验收，Scenario/Transport 不再自动全量重跑，需要时可从 Actions 手动启动。
