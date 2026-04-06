# 第一性原理

使用第一性原理思考，你不能假设我非常清楚我想要什么以及知道该如何做到。保持审慎，从原始需求和问题出发，如果动机或者目标不明确，停下来与我讨论。对于需求确定和项目探索阶段，问尽可能详细，尽可能多的问题。对于想法讨论类的任务要求，调用brainstorm skill，默认允许在brianstorming时候调用浏览器进行视觉交互。

#语言要求

用简单直白的中文做一次性输出，不要角色扮演，不要分口吻说话，对话中已经解决的问题不用再提，不要用P0/P1/P2这种说法。把我当成仅有基础编程知识的高中生，以通俗易懂的方式向我陈述。

严禁陈述式汇报：严禁复读背景，严禁分“证据/分析/结论”等多维度拆解简单问题，但如果问题特别复杂，你可以这么做

做code review时，也用中文进行最后输出

中文输出结果时，对于专有词汇词组，你可以保留英文

在汇报开头便给出结论和修复方案

## 方案规范

当你修改或者重构方案时，需遵循以下规范：

-禁止私自创建新的worktree。你可以建议我创建，但除非得到我明确同意你才能操作。
-不允许过度设计，保持最短路径实现并不要违反第一性原理
-除了最简单的任务，始终部署子代理去完成任务（使用5.4模型）。保持主上下文纯净。
-在开始复杂任务前，检查项目的agent文件，如果项目地址中已经编写了符合任务要求的子代理，则调用之。
-在执行任务前，简要查看现有的skill库，如有适配任务的skill，则加载之
-在执行UI提升类任务时，必须加载UI类 skill
-发现问题后尽早暴露，不要用任何降级，兜底或者启发式补丁，以及非严谨的通用性算法做后处理补救。
-严禁过度使用兜底方案，如果全局调参可以解决问题，那么优先全局调参
-在最终收尾汇报之前，严格执行一次【review-查bug-进行第一性原理分析】流程，思考是否有更简单，更稳健的实现方式。

##工程规范

-在开始执行任务前，阅读主目录下方的lessons leanrned.md，吸取其中的教训。在完成任务后，检查这个文件，简明扼要的，将你遇到的，且没有在本文件中记录的问题和解决方法以至多三个要点的形式记录下来。不要覆盖之前的记录，直接接在其后面写。仅对重大问题进行记录，琐碎的小问题不用记录，不是每一轮你都需要记录。
-在开始复杂任务前，在DOCS文件夹中对计划进行留档，如果是分步骤执行的，在DOCS当中随任务阶段性完成，对照留档计划，确认已执行的内容。计划和进度留档都只限在同一份文件中执行。在确认全部完成计划之后，将文件移入归档文件夹。
-不可捏造数据，生产代码严禁mock。mock仅限本地调试，且必须在gitignore中排除
-任何长测试一律以后台日志形式运行，前台只做日志阅读和轮询。
-所有 bundle/checkpoint 构建必须是单拥有者执行；若使用共享 checkpoint 目录，必须持有跨进程目录锁；未持锁时禁止启动第二个 builder。
-父子代理不得同时运行或轮询长时间测试/构建命令
-对于复杂，大型任务，保持耐心，给予子代理更多的工作时间
-除非我明确指示，不得更改readme
-禁止过度使用playwright做验证，不要为playwright浪费太多时间

## Multi-agent test safety

-Known Codex instability can occur when the parent thread and a sub-agent simultaneously monitor or run long-lived test commands.
- Only one agent may run or monitor live tests at a time.
- If the parent is running `unittest`, `pytest`, or any long-lived command, sub-agents must do static analysis only.
- Do not spawn sub-agents to watch, poll, retry, or duplicate active test runs.
- Share logs and outputs across agents instead of sharing live process ownership.
- When in doubt, serialize test execution.

Subagent Strategy
-offload research, exploration and parallel analysis to subagents
-One track per subagent for focused execution

Core rules
-Simplicity: Make every change as simple as possible, impact minimal code
-No Laziness: Find root causes, no temporary fix
-Minimat Impact: Change should only touch what is necessary

# Global Codex Rules for Browser Inspection

## Trigger and tool priority
When a user asks for direct UI checking (for example: "use browser inspection", "open the page yourself", "I cannot describe the UI bug clearly", "用浏览器检视", "你自己打开页面看看", "我描述不清楚", "滚动和跳转都要检查"), prioritize Playwright MCP over text-only inference.

For these requests, use skill:
- `browser-inspect-localhost-mcp-edge`

## Mode policy
1. Default mode is `auto`.
2. Explicit full-sweep wording (for example: "遍历所有版块", "全量巡检", "scan all sections", "full sweep") -> `full`.
3. Generic inspection wording -> `quick`.
4. In `auto`, run quick first and upgrade to full only when escalation conditions match.

## Scope and fallback
- If headed startup is unstable (WSL/no GUI), switch to standalone HTTP transport.

# Project Agent Rules

## Browser Inspection First
When the user asks any of the following (or equivalent intent), use Playwright MCP to inspect running localhost pages before proposing code changes:
- "use browser inspection"
- "open the page yourself"
- "my description is unclear"
- "check both scrolling and navigation"
- "用浏览器检视"
- "你自己打开页面看看"
- "我描述不清楚"
- "滚动和跳转都要检查"

## Mode Decision Rules
Traversal mode for `ops/browser-mcp/run-smoke-browser-inspection.sh`:
1. Default: `auto`.
2. If user explicitly asks full sweep (for example "遍历所有版块", "全量巡检", "scan all sections"), use `--mode full`.
3. If user only asks general inspection, use `--mode quick`.
4. In `auto`, run quick first and auto-upgrade to full when profile upgrade conditions are met.

Configuration source of truth:
- `ops/browser-mcp/inspection-profile.toml`

## Budget Guardrails
Respect profile budgets and stop early when budget is exhausted:
- Quick budget: max sections/screenshots/runtime from `[budgets.quick]`
- Full budget: max sections/screenshots/runtime from `[budgets.full]`

If budget causes incomplete coverage, report uncovered sections explicitly.

## Required Evidence Order
When returning findings, prioritize output in this order:
1. Console errors and warnings.
2. Network failures and 4xx/5xx clues.
3. Key screenshot paths under `.runtime/browser/mcp-artifacts/`.
4. Reproduction steps.
5. Minimal patch proposal.

## Scope Constraint
Prefer localhost-only browsing for this project unless the user explicitly asks otherwise.

## Runtime Output Policy
- Use `.runtime/` as the only root for disposable runtime outputs.
- Put browser inspection evidence under `.runtime/browser/`.
- Put Playwright test outputs under `.runtime/tests/playwright/`.
- Put generated reports under `.runtime/reports/generated/`.
- Put temporary caches and scratch outputs under `.runtime/tmp/` or `.runtime/python/pycache/`.
- Do not write temporary artifacts, caches, screenshots, logs, or generated reports directly under the repo root.

<!-- OMX:RUNTIME:START -->
<session_context>
**Session:** omx-1775432543311-wahbdi | 2026-04-05T23:42:23.413Z

**Codebase Map:**
  js/: city_lights_historical_1930_asset, city_lights_modern_asset, color_manager, country_code_aliases, data_loader, dirty_state, file_manager, history_manager, interaction_funnel, legend_manager
  tests/: city_lights_layer_regression.spec, city_points_urban_runtime.spec, city_urban_rendering_regression.spec, dev_workspace_i18n.spec, dev_workspace_render_boundary.spec, hoi4_1939_ui_smoke.spec, hoi4_rk_russia_regression.spec, interaction_funnel_contract.spec, main_shell_i18n.spec, physical_layer_regression.spec
  tools/: boundary_gap_test
  vendor/: d3.v7.min, milsymbol, topojson-client.min

**Explore Command Preference:** enabled via `USE_OMX_EXPLORE_CMD` (default-on; opt out with `0`, `false`, `no`, or `off`)
- Advisory steering only: agents SHOULD treat `omx explore` as the default first stop for direct inspection and SHOULD reserve `omx sparkshell` for qualifying read-only shell-native tasks.
- For simple file/symbol lookups, use `omx explore` FIRST before attempting full code analysis.
- When the user asks for a simple read-only exploration task (file/symbol/pattern/relationship lookup), strongly prefer `omx explore` as the default surface.
- Explore examples: `omx explore...

**Compaction Protocol:**
Before context compaction, preserve critical state:
1. Write progress checkpoint via state_write MCP tool
2. Save key decisions to notepad via notepad_write_working
3. If context is >80% full, proactively checkpoint state
</session_context>
<!-- OMX:RUNTIME:END -->
