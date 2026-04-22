# Lessons Learned

只记录后续还会反复用到的重大教训，尽量短，避免重复。

## 2026-04-03 - TNO 1962 bundle / 编辑链重构

### 1. “闪退”通常先当成前置校验失败，不先当成随机崩溃
- 长构建和长测试前台会话很不稳定，优先用后台日志模式跑，分开保存 `stdout`、`stderr`、退出码和锁文件。
- 完整 rebuild 前，先做最小静态检查：
  - `py_compile`
  - 关键 override / 路径解析
  - checkpoint 锁是否正常
- rebuild 产物要整体审查；如果 manifest 引用了新 chunk，文件也必须一起提交。

### 2. bundle / test 的长命令必须后台化
- 前台会话掉线不等于 Python 进程崩溃。
- 小测试可前台跑，完整 `pytest/unittest` 和长构建默认后台日志。
- 先看 `.runtime/tmp/*.out.log`、`.runtime/tmp/*.err.log`、PID、退出码，再判断是不是代码失败。

### 3. 重逻辑要按事务边界拆，不要按文件类型拆
- 先找一笔完整 transaction 的输入输出，再抽 materializer / service。
- 入口函数理想状态只剩：校验、锁、调用、提交、响应整形。
- 不要把同一笔事务拆成两套半重叠实现。

### 4. materialize 和 publish 必须分开
- `materialize` 只生成产物，`publish` 只发布现有产物。
- 如果 UI 需要“保存后立即可见”，应该显式串联 `materialize + publish`，不要把 publish 藏进 materializer。
- editor outputs publish 和 bundle publish 不是一回事，不能为了省事合成一个 service。

### 5. canonical 输入只能有一份，公开产物不要回流当输入
- `scenario_mutations.json`、`city_assets.partial.json`、`capital_defaults.partial.json` 这类 internal partial 才能当主输入。
- `city_overrides.json`、`capital_hints.json`、`scenario_manual_overrides.json`、`releasable_catalog.manual.json` 这类公开或镜像文件，默认都当输出，不再回读。
- 一旦已有独立 partial，就不要再从最终组合产物里反提取主输入。

### 6. local manual mirror 不能支配 canonical，但合法 manual-only 数据必须保留
- source 同名条目永远比 local mirror 更权威。
- 但 local 中 source 不存在的 untouched manual-only 条目，重建时必须保留，不能一刀切掉。
- 重新生成 local catalog 时，要区分：
  - `source duplicate`
  - `local-only`

### 7. capital 编辑不能串到 country mutation，也不能丢默认值
- capital edit 和 country edit 是两类 mutation，不要为了改同一个发布文件把它们混成一条保存链。
- 第一次编辑默认 capital 时，种子优先级必须是：
  - defaults
  - existing mutation
  - explicit request
- API 允许最小编辑时，所有可选字段都要从 `previous_hint` 继承，不能只继承名称字段。

### 8. `city_overrides.json` 必须只是组合产物
- `cities` 和 capital sections 不能再由同一条旧逻辑一起增量改。
- `cities` 来自城市资产 partial。
- `capitals_by_tag` / `capital_city_hints` 来自 capital mutation / defaults。
- 最终只通过 composer 合成新的 `city_overrides.json`。

### 9. 公开诊断文件和内部 canonical partial 不要混用
- `capital_hints.json` 这类公开诊断文件可以保留给 contract / audit，但不要再参与保存链或 materialize 主路径。
- internal partial 不应该通过 public schema 倒推生成；应该直接从底层候选结果生成，再投影出公开诊断文件。

### 10. 强制切换输入边界时，测试夹具要一起切
- 删除 fallback 后，最先坏的往往不是生产代码，而是测试夹具还活在兼容期。
- 新的必需输入文件要让共享 fixture 默认生成。
- 旧断言里不能继续期待 stale 发布态内容会回流进新结果。

### 11. 审核重构进度时，要分清三件事
- 代码是否已改
- 测试是否已约束
- checked-in 场景产物是否已迁移

只要场景目录里的真实数据还没迁到新契约，就不能把任务当成“基本完成”。

### 12. 其他通用教训
- repo 内部的临时 worktree 会污染主仓 `git status`；如果要可丢弃，尽量放到 repo 外。
- 做 i18n / markup audit 时，要先排除 `script`、`style`、`importmap` 这类非可见内容，避免把嵌入代码误判成 UI 文案。

### 13. canonical 输入边界切换时，要一次性收口工具链
- 不能只改 save/materialize/publish 主线，还要同步改 migration script、contract checker、test fixture。
- 如果这几层没一起收口，就会出现“仓库真实状态已经迁移，但工具流水线还停在旧世界”的假完成状态。

### 14. owner-aware 锁不能只看 pid，必须把 thread 和 transaction 一起建模
- 同线程嵌套写链如果没有 transaction 继承，收紧锁语义后会先把自己锁死。
- 最小可行方案是：锁文件写 `thread_id` / `transaction_id`，进程内用 `ContextVar` 继承当前 transaction，跨线程即使 transaction 相同也不允许重入。
- 改完后必须补三类定向测试：同线程默认继承、同线程不同 transaction 拒绝、不同线程同 transaction 拒绝。

### 15. startup supporting file 一旦进入场景链路，就要直接正式化，不要保留半套 root 兼容层
- 如果 `locales.startup.json` / `geo_aliases.startup.json` 已经参与 startup bundle 构筑，就应当进入 checkpoint artifact 和 scenario publish contract。
- 继续把它们留在 root 当 supporting file，只会让 build、publish、fallback 各走各的路径。
- 更稳的最短路径是：checkpoint 内生成，scenario 目录正式发布，fallback 也直接读 scenario-scoped 版本。

### 16. live test 归属要先锁死，不能在收尾阶段并行起两条 unittest
- 就算都是短测，也要默认串行；一旦 parent 和子代理同时持有 live test，日志归属会立刻混乱。
- 正确顺序是：先关掉还在运行的写线子代理，再由主线程独占执行所有验证。

### 17. 抽 service 时，测试要跟着切到真实写口，不能继续 patch 旧 adapter helper
- 业务 helper 下沉后，dev_server.write_json_atomic 这类旧入口不一定还是实际写口；继续 patch 旧入口，测出来的只会是过时实现。
- 更稳的做法是先确认当前真实写链，再 patch 命中的共享 transaction writer 或底层 IO 函数。
- 这样才能同时守住“逻辑没回退”和“回滚边界还在”。
### 18. 先切断 service 的反向 import，再决定 adapter 要不要同波次薄化
- 真正影响架构边界的是 map_builder -> tools 这类反向依赖，不是 adapter 文件里还保留了多少旧 helper 名字。
- 如果 donor 面很大，先把 service deps 内收，保留 adapter wrapper，通常比一波里同时清空旧 helper 更稳。
- 等主链稳定后，再单独决定要不要把 adapter 旧实现全部收成转发，避免为了“顺手清理”扩大回归面。### 19. runtime merged state 必须区分“没有这个 layer”和“这个 layer 明确为空”
- chunk runtime 一旦把 merged payload 从 bundle cache 收回 runtime state，就不能再用 `merged?.layer || null` 这种写法偷懒；否则没有加载该 layer 和该 layer 真的应该清空会被混成一件事。
- 更稳的做法是先判 `hasOwnProperty(layerKey)`，只有 chunk 真正接管的 layer 才允许写回 `null`；fallback layer 必须保持现有 bundle/topology 路径，不应被 chunk refresh 顺手清空。
- 这条边界尤其会放大到 `cities -> syncScenarioLocalizationState()`，所以 runtime/chunk 调整时必须把 localization collateral 一起复核。

### 20. 新 validator 的路径归一化要在 CLI 入口就做，不要等到 report 阶段才混用相对/绝对路径
- 只要 validator 会把输入路径再做 `relative_to(PROJECT_ROOT)` 或写进报告，`--root` / `--manifest` 入口就必须先统一 `resolve()`；否则本地相对路径能跑到扫描阶段，却会在生成报告或错误文案时直接炸掉。
- 这类问题最容易在“本地手跑命令”和“CI 从 repo root 跑命令”之间来回漂移，所以应把归一化做成入口不变量，不要散落在后续 helper 里补。

### 21. 新增 review lane 的第一职责是暴露真实缺口，不是把红灯伪装成绿灯
- 如果新 workflow 接上 shared strict checker 后立刻暴露 checked-in 产物缺文件，优先把它记录为显式剩余风险；不要通过降级 strict、跳过 scenario、改成 warning-only 来掩盖真实 contract 漏口。
- non-blocking 的意义是“不阻断主 deploy”，不是“把 checker 变松”。
### 22. 多 scenario builder 不能只把输出目录参数化，默认输入和域规则也要一起 scenario-aware
- 这次 `build_hoi4_scenario.py` 真正的红点不是 runtime topology，而是它虽然支持 `--scenario-id hoi4_1939`，默认 `display_name`、rules 和 manifest authoring inputs 还停在 1936 世界，导致 checked-in 产物会出现“strict 部分变绿，但 domain 仍然漂移”的假完成状态。
- 最稳的做法是：只要 builder 宣称支持多个 scenario，`display_name`、bookmark、manual rules、controller rules、authoring input contract 就都必须按 `scenario_id` 一起解析，并且要用真实 checked-in 场景重建一次来验收，不要只靠 fixture。

### 23. transport frontend manifest migrations must switch preview + inspector together
- If preview loaders move to shared variants but toolbar summary/inspector still read legacy fields, the UI enters a split state: data loads from shared, while panels still describe legacy defaults.
- The shortest stable fix is to add one tiny shared variant helper, migrate all runtime readers in the same wave, and add a static test that forbids legacy manifest variant field names in runtime UI code.

### 24. once transport runtime is shared-only, validator must ban legacy fields instead of comparing against them
- If the UI has already switched to shared `default_variant/variants`, keeping validator logic in shared-vs-legacy comparison mode only preserves the old contract and delays real cleanup.
- The stable cutover is: stop builders from writing legacy fields, remove checked-in legacy fields, then make validator reject any legacy variant keys on sight.

### 25. Scenario delta rule files must never become full-pack defaults
- If a scenario-specific manual rules file is only meant to override a shared base pack, the builder default must continue to load the base pack and the delta pack together.
- The fastest way to catch this class of regression is to gate on semantic signals like owner_count, synthetic_owner_feature_count, featured_tags, and a few representative country counts, not only on file presence.

### 26. Fix the checked-in scenario pack first, then tune runtime symptoms
- When a historical scenario suddenly shows modern countries or wrong palettes, check the checked-in bundle and audit outputs before touching render or UI code.
- Runtime strictness is still useful: removing silent fallback to global names makes bad scenario packs fail loudly instead of looking half-correct.

### 25. Scenario checker path assertions must normalize before compare
- If a builder writes absolute diagnostic paths while expectations store repo-relative paths, the same gold baseline will fail across machines for non-semantic reasons.
- The stable fix is to normalize diagnostic path assertions to repo-root-relative form inside the checker instead of hardcoding absolute paths into expectations.

### 26. Scenario name fallback tests must distinguish blank mode from active scenario mode
- The real regression is merging global modern country names into an active historical scenario, not every read of countryNames.
- blank semantic mode may still use baseline countryNames; tests should encode that exception explicitly so correct fixes are not flagged as regressions.
### 27. 做浏览器类审查前，不能只信 `.runtime/dev/active_server.json`，必须先验证端口真活着
- `active_server.json` 可能残留旧 pid 和旧端口，看起来像“已有 dev server”，但实际请求已经连不上。
- 最短稳路线是：先做一次真实 HTTP 探测；失败再重启 server，并把 stdout/stderr 落到 `.runtime/tmp`，不要直接把陈旧元数据当事实。

### 28. 分阶段 UI 重构要先把 contract 落成可机读资产，再让表面迁移接入
- 如果 01 只是文档，没有 `source of truth + checker + 最小真实接入点`，02/03 执行时很快又会把“标题/标签/按钮/弹层边界”重新争论一遍。
- 最稳的最短路径是：先落共享 contract 模块、语义 class 骨架、targeted 验证，再开始主界面结构迁移。

### 29. 顶部 overlay 重排不能只改 DOM，要一起复核点击层级和安全间距
- 这次 02 把 `Transport` 移到右上 utility 后，`scenario context bar` 和 `zoomControls` 立刻发生点击遮挡；如果只看静态结构，很容易漏掉。
- 最稳做法是：改完后立刻做一次真实点击验证；必要时同时调 `z-index`、安全间距和纵向分层，不要只靠肉眼看“不太重叠”。

### 30. `$team` 不是随时可用，先做 tmux leader 预检
- 当前环境如果不在 tmux leader pane 内，`omx team` / `omx_run_team_start` 会直接失败；不要等到分工都写完才发现。
- 最短路径是先预检 `$env:TMUX` 和 team runtime 条件；不满足时尽早暴露，再决定是否切原生子代理并行。

### 31. 相邻 e2e 不要把非主路径存在性写成硬前置
- 这次 `main_shell_i18n.spec.js` 被 `.scenario-visual-adjustments` 是否出现卡死，但它本来测的是主壳 i18n，不是这个区块的存在性。
- 更稳的写法是：主壳类用例只对“存在时必须正确”的相邻区块做可选断言；真正要求必出现的内容，单独交给自己的 contract/e2e。

### 32. i18n 不能直接对带子节点的 summary / heading 容器整块写 `textContent`
- 如果一个 summary 里包了标题节点、info trigger、状态节点，翻译时直接 `element.textContent = ...` 会把整个结构抹平。
- 更稳的做法是先找语义文本子节点，只替换真正承载标题文案的那一层；结构容器本身不要直接覆写。

### 31. 主壳 e2e 不要被相邻非主路径区块绑死
- `main_shell_i18n.spec.js` 这类主壳回归，应该优先锁定真正的主壳文案和交互；像 `.scenario-visual-adjustments` 这种可选相邻区块，存在才校验，不该变成整轮主壳验收的硬门槛。
- 更稳的做法是把“主壳稳定性”和“相邻功能块存在性”拆成不同测试面，避免一处可选 UI 把整轮 01/02/03 验收拖死。

### 29. 顶部双壳层同时改版时，必须用真实浏览器检查点击命中，不要只看 DOM 顺序
- 这次 `scenario context bar` 和右上 utility 分组同时收口后，`Guide` 按钮一度被 `zoomControls` 遮住，DOM 没报错，但真实点击被上层按钮拦截。
- 最稳的最短路径是：每次改完顶部壳层布局，都跑一次真实浏览器点击验证，再决定是收宽、下移，还是改 z-index。

### 30. `$team` 不是普通并行 fanout，缺少 tmux leader pane 时会直接硬失败
- 这次 `omx team` / `omx_run_team_start` 因为当前 leader 不在 tmux pane 内直接失败，不能把它当成和原生 subagent 一样随时可用。
- 进入 team 流程前要先确认 `$TMUX`、再确认是否接受 team runtime 的工作模式；不满足前置条件时，要尽早暴露，不要把失败拖到执行中途。

### 29. `$team / omx team` 不是随时可用；不在 tmux leader pane 时要尽早暴露并切回原生子代理
- 这次 `omx_run_team_start` 直接因为“当前会话不在 tmux leader pane”失败，说明 team mode 有硬前置，不满足就不要继续假设它能跑。
- 遇到这种情况要第一时间暴露，再用原生子代理 + 主线程单拥有者集成顶上，别一边卡着 team 一边让实现停摆。

### 30. 顶部轻状态条和右上 utility 重排后，要立刻复核可点击层级，不然会出现“看得见但点不到”
- 这次 `scenario context bar` 和 `zoomControls` 重排后，Guide 按钮被右上 utility 遮住，Playwright 点不到。
- 最稳的收口顺序是：改完位置/宽度后立刻用一次真实点击验证，不要只看静态截图。

### 29. `$team` / omx team` 依赖 tmux leader pane，当前会话不在 tmux 时要先暴露这个硬前提
- `omx team` 和 `omx_run_team_start` 都不是普通并行工具；如果当前 leader 不在 tmux pane 里，运行时会直接失败。
- 真正开工前先检查 `$env:TMUX` 和 tmux 前提，缺前提就尽早暴露，不要把调度失败拖到实现中段。

### 28. 文档先行的 UI 重构阶段，先落 machine-readable contract，再动表面迁移
- 如果阶段目标是“共享契约 / foundation”，最稳的最短路径是先交付统一 contract 模块、语义 class 骨架、验证脚本，再把真正的 HTML/布局迁移留给后续 phase。
- 这样可以先把边界锁死，又不会误闯进下一阶段的表面重排。

### 29. 契约文件名、文档进度和验证脚本必须同名同口径
- 像 `ui_contract.js` / `ui_contracts.js` 这种单复数不一致，会先把验证和留档搞乱，再拖累后续阶段接入。
- 文档里的执行进度、package 脚本名、测试断言要共用同一个 canonical 名称。
### 33. Dev startup must not combine `no-store` with on-the-fly gzip for large JSON/topology assets
- When startup depends on 30-45 MB scenario bundles or topology files, defaulting static responses to `no-store` turns every refresh into a cold start.
- If the dev server also calls `gzip.compress()` on each request, CPU time can dominate local startup; prefer stable cache headers plus prebuilt `.gz` sidecars for large immutable assets.
### 33. ����Ĭ�� startup scenario �� e2e ��Ҫ�� smoke ���������� boot overlay ȫ��������
- �� scenario_apply_resilience.spec.js ����Ŀ���ǲ� scenario rollback / fatal recovery ��������ǰ������Ӧ������Ϊ��scenario manager ���ȶ�������Ҫ����� ootOverlay hidden ���ֺ����������޹ء����� CI �����Ϻܹ����������
- ���ȵ����·���Ǹ�������ڼ� default_scenario query ���ǣ��ò�����ʽѡ��Ϻ��ʵ� startup baseline����ƷĬ�ϳ������ֲ�����
### 34. JS split 后要警惕同名 helper 的“双声明”，这种错误会在 boot 最早阶段把整页卡死
- 这次 `scenario_resources.js` 同时保留了旧 `function hasRenderableScenarioPoliticalTopology(...)` 和新的 `const hasRenderableScenarioPoliticalTopology = ...`，浏览器直接抛 `SyntaxError`，主壳停在 `bootPhase = shell`。
- 这类问题最稳的收口方式是：拆分后补一条 owner 边界测试，至少钉住“同名 helper 只保留一个声明”。

### 35. UI i18n smoke 的中文断言要跟 canonical locale 资产对齐
- 这次 transport compare 按钮的运行时文案来自 `data/locales.json`，已经是“比较基线 / 这个家族没有可用基线”，旧 e2e 还在断言早期文案“对比基线 / 这个 family 没有可用基线”。
- 这类断言要优先跟当前 canonical locale 资产同步，避免 inline fallback 和 startup locale 覆盖把 smoke 误打红。
### 34. Playwright ��ʱ��־Ҫֱ�Ӵ�����̬���գ���Ҫֻ���� timeout
- ����ȴ��������� ootPhase��startupReadonly��scenarioApplyInFlight ��������̬�����Ը���������ʱʱӦ��������Щ״̬һ���׳����������Ų��һֱ���ڡ�������ֻ�ǳ�ʱ����
### 34. Readonly startup unlock should only wait for interactions that are truly blocking
- Spatial/index data can be enough to restore basic pan/zoom/click interaction; hit-canvas quality work should not automatically stay on the startup critical path.
- If a post-startup interaction structure already has a deferred/lazy rebuild path, prefer reusing that path instead of forcing a synchronous build during unlock.
### 35. Default startup should not silently preload optional scenario layers just because they are visible by default
- If an optional layer already has a visibility-driven/on-demand loading path, eager preload during startup only adds hidden transfer and parse cost without improving first paint.
- For startup performance work, prefer measuring and removing automatic background requests before changing heavier core data structures.
### 36. If startup is bundle-first, shrinking the bundle boundary usually beats local cache tricks
- When the default startup path already prioritizes a scenario-specific startup bundle, cutting the largest embedded payload can produce much larger real gains than adding another cache layer around the old shape.
- For coarse-first startup, carry enough scenario state to apply ownership/controller/core immediately, then let chunk registry + coarse chunks provide the first scenario geometry.

### 37. Startup health gate should live inside the scenario apply transaction
- If the gate runs only after boot leaves apply flow, rollback cannot restore a clean scenario baseline.
- The safer path is apply -> refresh map data -> run startup-only health gate inside applyScenarioBundle() -> throw into existing rollback.
### 38. Ultra-light runtime shell should keep contract markers and ids, not real mask geometry
- Re-embedding real land/water mask geometry into startup bundle quickly eats back the startup gain.
- Keep empty named topology objects plus runtime_political_meta in startup bundle, and leave real overlay geometry to deferred hydration.

### 37. �Ӿ��ع������� render pass ʱ������ͬʱ���� signature / invalidation / transformed frame / exact refresh ��·
### 38. UI controller 拆分后，静态合同要跟着切到新的 owner 文件
- 像 transport workbench 这种大面板拆到 `toolbar/*_controller.js` 之后，旧测试如果还盯 `toolbar.js` 的实现细节，会把正确的 owner 迁移误报成回归。
- 更稳的做法是把 facade 合同继续钉在 `toolbar.js`，把内部文案、manifest/runtime 读取、面板事件绑定这些 owner 合同切到新的 controller 文件。
### 39. support surface 这类壳层协调要单独成 owner，别和具体面板实现搅在一起
- guide、dock reference、URL restore、outside click、Escape 关闭链属于同一层 workspace chrome 协调，和 export/transport/special zone 的面板内部实现是两层职责。
- 更稳的拆法是：面板内部逻辑进各自 controller，support surface 壳层再单独进 `workspace_chrome_support_surface_controller.js`，测试也分成 facade 合同和 owner 合同两层。
### 40. facade 还在运行链上时，拆 owner 不能顺手带走 facade
- `toggleLeftPanel`、`toggleRightPanel`、`toggleDock`、`syncPanelToggleButtons`、`state.toggle*` 这类函数如果还被 shortcuts、restore 链、其他 controller 直接调用，就属于 `toolbar.js` 的运行态 facade。
- 更稳的拆法是：owner 逻辑下沉，新旧 facade 继续留在 `toolbar.js`，等所有调用方一起迁完再决定是否收口。
- ��� terrain ��� physicalBase �����ֻ�ӻ��ƺ�������ͬ���ӽ� RENDER_PASS_NAMES��signature����ɫʧЧ��context layer invalidation �� settle �� exact refresh���ͻ����һ����¡�һ�����þɻ���ļ��޸���
### 38. ��Ҫ�����ᾲĬʧЧ�� fallback��������ʽ����Ҳ��Ҫ��װ����
- physical ���� fallback ������Դ�ļ�����Ϊ��ʱ�������� fallback ֻ������������Ρ����ȵ�������ֱ�ӱ�¶ȱʧ״̬��������Ӿ��˻����гɵ������⡣
### 39. preset ���첻��ֻ�� HTML �� state һͷ���������Ϳؼ�����Ҫͬһ���տ�
- ��� physicalPreset �����ʱ�����Ȼ��Ĳ�����Ⱦ������ 	oolbar.js �� state.js �ĵ��뵼������һ�¡����� preset/ģʽϵͳʱ������Ҫͬ���տڣ�״̬������normalize��UI ����¼��󶨡�

### 37. 语义地貌层不能按 `atlas_class` 直接 dissolve 成全局 MultiPolygon
- 这样会把整类地貌压成 8 个世界级大面，前端再怎么调 blend/opacity 也只是在给整块大陆蒙色，区分度和干净度都上不去。
- 更稳的最短路径是：按 class 合并局部连通面后再 explode 成分裂 feature，并用几何哈希生成稳定 id，让数据既细化又可追踪。

### 38. 地貌 `blendMode` 不能只在渲染时兜底，必须在 state 层先合法化
- 如果配置里保留非法值、渲染时再偷偷 fallback，就会出现“UI/导出看到的是一种模式，实际画出来是另一种模式”的错觉，调参会被误导。
- 更稳的做法是：`normalizePhysicalStyleConfig()` 直接把 `blendMode` 归一化成合法值，状态、UI、导出、测试都统一看同一个结果。

### 37. ��ò����㲻�ܰ� atlas_class ȫ�� dissolve �ɳ�����
- ֻҪ physical_semantics �˻���ÿ��һ��ȫ�� MultiPolygon��ǰ������ô��͸���Ⱥ� blendMode����ò������һ����ɫĤ��ȱ�پֲ���Ρ�
- ���ȵ������Ǳ������Ѻ����� feature����������ʱ�� atlas_layer / atlas_class �����Ⱦ��

### 38. ���� render pass ʱ������һ����ͬ���崦
- �¼��� physicalBase ������ pass������ֻ�� pass ˳�򣻻�Ҫͬʱ�տ� RENDER_PASS_NAMES��transform reuse �б���pass signature��invalidation ·����counter/metrics��
- �ٸ�һ�������ͨ���������̱��������ǻ��渴�ô�λ����ɫ��ˢ�¡��� settle ����Ȼ����

### 40. e2e ��ʱ��ֻͣ�� ��Running N tests�� ʱ���ȸ����Ը��������ӷֶ���־������̬����
- ��� `project_save_load_roundtrip.spec.js` ���� harness �������������ǿ��� `gotoProjectPage -> waitForProjectUiReady` ��һ�Σ����û�в�����־������������Playwright ����û��ʼ�ܡ���
- ���ȵ����·���ǣ����Զ��� wait helper ��ʱǰ�����������boot snapshot���ؼ� DOM/״̬�����Ƿ�������پ������޲��Եȴ�����������ҳ����������

### 39. Playwright list reporter ֻ��ʾ Running �������� harness ��������
- �� project_save_load_roundtrip ���ֳ���·����������м�û�н׶���־��stdout ���ܳ�ʱ��ֻʣ 'Running N tests using 1 worker'�����������г� harness û������
- ���ȵ��������ڹؼ� helper��ҳ����롢UI ready��download��import��scenario apply�����ӡ��ʱ����Ľ׶���־�����ڳ�ʱʱ������̬���ա�

### 40. Chunked detail political features must be normalized before merging into runtime land collections
- If chunk payload features bypass normalizeFeatureGeometry(), many detail polygons can be interpreted as world-size complements, causing world_bounds skips, blank political fills, and oversized Antarctic/ocean artifacts.
- When runtime/topology collections are merged, normalize the chunk features at the merge boundary instead of assuming chunk JSON already has safe winding.
### 41. New render passes that depend on scenario masks must be invalidated on runtime mask updates
- Once a pass like physicalBase starts clipping against scenarioLandMask/contextLandMask, scenario hydrate and water fallback paths must invalidate that pass too, not just background/contextScenario.
- Otherwise old mask geometry can keep rendering against new scenario state, which looks like broken open-ocean or Antarctic overlays.

### 42. Startup default scenario apply must participate in the same in-flight gate as manual scenario apply
- If startup bundle apply does not set scenarioApplyInFlight, tests and UI can observe activeScenarioId early while the apply transaction is still unfinished.
- The stable rule is: startup apply, manual apply, and recovery apply should all share the same busy gate before scenario UI is treated as settled.
### 43. Chunked coarse preload and noncritical scenario metadata should not block scenario apply completion
- If coarse chunk preload or metadata like releasable catalog/district groups/audit stay on the main apply path, startup can remain stuck in scenario-apply even after the scene is already usable.
- Let apply finish on required political/runtime assets first, then load coarse chunks and metadata in the background.

### 44. 不能把 fill-based physical 机械地下沉到完全不透明的 political 下方
- 这次检查发现 drawPoliticalBackgroundFills() 和 drawPoliticalFeature() 默认都是不透明填色；如果把 atlas + contours 全部沉到底下，physical 会直接基本不可见。
- 更稳的最小修复是先确认上层 fill 是否透明，再决定 physical ownership；在不改 political opacity 的前提下，优先把最抢眼的 atlas fill 下沉，把最轻的 contour cue 留在上层。

### 45. Ready text and editability must use the same runtime contract
- TNO 1962 showed detail promotion completed and startupReadonly=false while the status bar still claimed coarse mode, so status copy and edit locks cannot be derived from separate stale flags.
- Keep startup readonly for startup unlock only; treat post-ready overlay degradation as a separate health-gate state, and drive status text/buttons from the real ready state.

### 45. scenario health gate 不能优先信任 TopoJSON 自动数字 id，必须优先用业务 feature id
- 这次 TNO deferred hydration gate 看起来像“overlay 降级逻辑有问题”，根因其实是 `state.landData` 里的很多 detail feature 带的是 TopoJSON 数字 `feature.id`，真正的业务 id 在 `feature.properties.id`。
- 如果 gate / overlap 校验先读数字 id，就会把本来健康的 detail 场景误判成 owner-feature mismatch，后续所有 readonly / fatal recovery 判断都会跑偏。

### 46. detail promotion 完成后，状态文案不能继续吃旧的 scenarioDataHealth 快照
- 这次浏览器里 `detailPromotionCompleted=true`、`topologyBundleMode="composite"` 已经成立，但状态栏还残留 coarse mode，说明 detail promotion 链只更新了渲染，没有同步刷新 status 依赖的数据。
- 更稳的做法是：detail promotion 一旦落地，就在同一轮里刷新 scenarioDataHealth 和 scenario UI，避免“画面是 detail，文案还是 coarse”的假只读感。

### 45. hydration / health gate 做要素重叠校验时，不能优先读 topology 自动编号 `feature.id`
- 这次 TNO 1962 detail runtime 里很多 feature 的真正稳定 id 在 `properties.id`，而 `feature.id` 只是 0,1,2 这种自动编号；如果校验逻辑优先读 `feature.id`，owner overlap 会被误判成几乎全丢。
- 更稳的做法是：凡是做跨阶段一致性、ownership、controller、diff、health gate 这类校验，一律先取 `properties.id`，只有没有时才退回 `feature.id`。
### 47. post-ready 渲染链里一个未声明 cache 变量，足以把 exact refresh 和 full hydrate 一起打断
- 这次 `contourHostFillColorCache` 在 contour 自适应颜色链里被调用但没有定义，结果不是只坏一条 contour 逻辑，而是把 `post-ready` 的 full localization / full scenario hydration / exact context refresh 一起打断。
- 更稳的做法是：凡是挂在 post-ready render pass 里的缓存对象，都必须显式定义并接入 topology/color/scenario 的统一失效链；否则会出现“首屏能出、后续细化全断”的假恢复状态。
### 48. detail promotion 后不能同步全量重建全球内部边界 mesh
- 这次真正拖垮主线程的不是 detail topology 本身，而是 detail 落地后立刻对大量国家同步执行 `topojson.mesh(...)` 去重建 province/local/detail 边界。
- 更稳的做法是：启动和 detail promotion 只保留 country/coastline 这类当前必须的基础 mesh；内部边界按当前视口和 zoom bucket 懒建，绝不能在全球视角下一次性全算完。
### 49. chunk promotion 必须把视觉、spatial、hit canvas 当成同一世代提交
- 这次“视觉地图和判定地图错位”的根因不是单独 hit canvas 失效，而是 chunk/detail promotion 会在交互中途提前切 active 数据，导致视觉帧和命中层看见的不是同一版拓扑。
- 更稳的做法是：交互期只允许后台加载 chunk 到缓存，不允许直接提交 active topology；真正提交要等 idle，再把 render pass、spatial index、hit canvas 一起切换。
### 50. 如果默认场景必须首屏正确，就不能先暴露 first-visible-base 预览帧
- 这次默认场景其实一直是 `tno_1962`，但用户看到像 1939/HOI4，是因为 `main.js` 在 scenario bundle/apply 之前先 flush 了一张 base preview，再把 boot overlay peek 打开了。
- 更稳的做法是：首个 `first-visible` 必须绑定到 scenario coarse shell 已落地之后；如果首屏正确性比极限秒开更重要，就不要再暴露 base preview。
### 51. 海洋 hover 和海洋 click 必须拆成两套策略
- 这次海洋高亮迟滞不是因为海洋交互本身必须关闭，而是因为开放水域参与了 hover 命中，配合 water-over-land 优先级后，鼠标离开时容易留下旧高亮。
- 更稳的做法是：开放水域禁 hover、保留 click；湖泊/海峡/内海这类精细水域再保留 hover，这样既不废掉交互，也更稳定。
### 52. 视口相关的内部边界 mesh 不能在 draw pass 里同步补建
- 这次剩余的 pan/zoom 卡顿继续证明：只要在 `drawHierarchicalBorders()` 里按当前视口同步 `topojson.mesh(...)`，视口元素越多就越慢。
- 更稳的做法是：draw pass 只画已经缓存好的 mesh；当前视口新需要的 province/local/detail 边界改成 idle 后补建，再触发一轮轻量边界重绘。
### 53. chunk refresh 去重逻辑里，千万别把“上一轮选择”先写回再比较
- 这次脚本启动卡在 0% 的直接根因不是网络或 bundle，而是 `scenario_resources.js` 里为了跳过重复 chunk refresh，新加逻辑时在同一作用域把 `loadState` 重复声明了，直接让模块 SyntaxError，主入口完全起不来。
- 更稳的做法是：这类“前后状态比较”必须先保存 `previousSelection` 再写 `lastSelection`；同时要避免在同一块里重复声明同名变量，改完立刻跑 `node --check`。
### 54. contour 这类大集合 exact pass，先缓存可见集，再谈 draw 性能
- 这次 `drawPhysicalContourLayer` 的主要浪费不在真正 stroke，而在每次 exact 都重新遍历几万条 contour 去跑可见性筛选。
- 更稳的做法是：按 `topologyRevision + viewport bounds + zoom bucket + contour filter inputs` 缓存 visible feature set；画法不变，只减少重复筛选。
### 55. exact refresh 不要把“功能开启”误当成“必须强刷”
- 这次 `physical` 开着就强制 exact 的策略太保守，会让很多本可复用 transform frame 的 settle 也被拉回重刷。
- 更稳的做法是：只在 pass 脏、跨 contour 阈值、或关键 signature 变化时强刷；功能开启本身不能成为强刷理由。
### 56. contextBase 的首个 exact 帧和增强项要分开落地
- 这次最稳的提速不是删效果，而是把 `contour/urban/rivers` 这种视觉骨架先落地，把 `city points/airports/ports/labels` 延后一拍补齐。
- 更稳的做法是：首帧 exact 先保证骨架清晰，后补帧再填增强项，这样最终画面不变，但首个 exact 更短。
### 57. 懒生成 mesh 的状态不能只靠“数组是不是空”来表达
- 这次 detail ADM 边界在高倍缩放下的空转根因，是把“还没生成”和“当前视图根本无 mesh”都压成了 `cachedDetailAdmBorders.length === 0` 这一种状态。
- 更稳的做法是：给 lazy build 至少保留 `idle / building / ready / empty` 四态；否则 draw pass 会在空数组上持续重复排队后台构建。
### 58. 任何懒生成后可见的边界，都要立刻同步回 static mesh snapshot
- 这次 chunk promotion 后内部边界会短暂消失，是因为 `captureStaticMeshSnapshot()` 只记录了同步阶段的 mesh，没有把后续按视口懒生成的 province/local/detail 边界写回 snapshot。
- 更稳的做法是：只要 lazy build 实际改动了缓存边界集合，就立刻刷新 `staticMeshCache.snapshot`，不要等下一次全量 rebuild。

## 2026-04-09 - 城市图层修复

### 1. 视觉回归不要挂在已经掺杂旧业务断言的“大烟雾测试”上
- 这次 `city_points_urban_runtime.spec.js` 先被不相干的历史 locale 断言打断，说明混合型 smoke spec 不适合承接新的定向回归。
- 更稳的做法是为“当前 bug 的最小行为边界”单开 focused spec，只断言当前修复点，避免被旧漂移噪声盖住结果。

### 2. sprite/cache 只要依赖宿主底色，就必须同时接入 key 扩展和 revision 失效
- 只把背景色塞进 cache key，能避免错复用，但挡不住旧 sprite 常驻内存；只做 revision clear，又会把不同背景错误复用成同一张 sprite。
- 最稳的最小方案是：cache key 带背景签名，cache 生命周期跟 `colorRevision` 绑定清空。

### 59. ����Ӿ����ⱨ��ʱ��������û���ֳ� helper ��д�õ�û�ӵ����� draw/sprite ·��
- ��� city marker �ı�������Ӧ������ȫû���߼������� getCityMarkerRenderStyle() �Ѿ����ڣ�ȴû�нӽ� getCityMarkerSprite()��
- ���ȵ����·�������ҡ��Ѵ��ڵ�δ���ߡ��� helper���پ���Ҫ��Ҫ����һ���㷨�������Ķ���С��Ҳ�������׷ֲ���ڶ����߼���

### 60. defer �͵�����·����ȱ�� pending���ٵ�״̬�˳��� flush��Ҫ�����������˳��߽���
- ��� exact-after-settle �����ⲻ������ pending ��ǣ����� deferExactAfterSettle �� true ��� false �Ժ�û���ٲ�һ�� flush��
- ���ȵ������ǣ�defer �׶�ֻ�����ѹ pending������������ flush Ҫ���ڡ�����̬�˳����Ǹ���ȷʱ�̣�������������̬�ڲ��������ԡ�

### 60. ���� defer ״̬ʱ������ pending �ĵ��ȣ������ڽ�� defer ��ͬһ�������ϲ�һ�� flush
- ��� chunked scenario �� exact-after-settle ����˵����ֻ�� defer �ڼ� mark pending������ defer ��������̲� flush���ͻ��ˢ�¿�����һ�ν����� ready �¼���
- ���ȵ������ǣ��ڽ�� defer ���Ǹ��տڵ㣬�ٲ�һ�� guarded flush�����ҷŵ���һ���¼�ѭ��ִ�У�����ͬһ����ջ���˲ʱ״̬�ְ��������л� deferred��

### 24. contour publish artifacts 不能在生成失败时静默写空文件
- terrain contour 这类 runtime 关键发布产物，一旦 builder 失败或结果为空，必须直接 fail build；继续写空 topo 只会把 pipeline 错误伪装成前端“偶发缺层”。
- 对 contour 这类派生数据，最少也要补两层校验：builder 单测锁参数/分层/失败策略，publish contract 锁非空和层级约束。

### 25. viewport 相关缓存 key 不能只看 zoom bucket 和画布尺寸
- 任何“可见 feature 集”缓存，只要结果受平移影响，就必须把 transform 签名带进 key；只看 bucket/viewport size 会在同 bucket 平移后复用错结果。
- 对 map renderer，这类缓存最稳的最短路径是：`collection ref + transform signature + filter inputs`。

### 26. 查启动性能回归时，必须区分首屏 boot 路径和 post-ready warmup
- `loadMapData(includeContextLayers=false)` 这种首屏参数并不代表相关资源不会很快在 ready 后被补拉；如果只看 boot loader，很容易误判真正的性能回归位置。
- 更稳的做法是同时检查：startup flags、post-ready task、以及交互入口上的按需加载调用点，再决定该把大资源延后到哪一拍。

### 61. �� context layer ��Լʱ���ȿ� external pack �ܲ��ܽӹܣ��پ���Ҫ��Ҫ��д checked-in topology
- ��� urban adaptive ȱʧ��ֱ�Ӹ����� checked-in topology ��� urban Ԫ���ݹ�ʱ����ֻҪ��д topology���Ϳ��ܰ� political feature �����ͱ߽�һ���ƫ��
- ���ȵ����·���ǣ�ֻ�� external urban GeoJSON ��Լ����������ʱ��ʽ���� external layer����ҪΪ����һ�� context layer��˳���ؽ����� topology��
- focused e2e ��Ҫ�������뵱ǰ bug �޹ص� locale/hidden-city/warning ���ԣ���������ʵ�޸���������

### 62. external context layer �� owner id ���ܰ󶨵� shell/country id��Ҫֱ�Ӱ�����ʱ landIndex �� feature id
- ��� urban adaptive �� P1 �����ǰ� country_owner_id ������� FR��CY ���� shell id������Ⱦ������ɫ�õ��� runtime political feature id���� AFG-1741����
- ���ȵ������ǣ�����Ҫ��ǰ��ͨ�� state.landIndex.get(ownerId) ȡ������ɫ/���ε� external layer�����ɽ׶ξͱ������ runtime topology �� properties.id �ռ䣬�����Ƕ��� primary shell��

### 59. �� pending chunk promotion ������ exact-after-settle��ֻ���á�������족���������ɲ���ʱ�䡱�����ϳ�
- ����������޸�˵������� chunk promotion ֻ�ܵ� quiet window + exact ��ɺ�����أ��û����ȿ�����֡����ͣ�ֺ�Ҫ�ٳ�һ��ͬ�����߳��ػ
- ���ȵ����·���ǣ�idle fast frame �����ύ promotion visual stage��exact �� mesh/spatial/hit ���� infra stage ���Ӻ� idle ���롣

### 60. ��ν chunked ���ֻ��ǰ��� `yield` һ�Σ��м���������ͬ��ѭ���������ϻ�����������
- `buildIndexChunked()` / `buildSpatialIndexChunked()` ���֤�����ٷ�Ƭֻ���õ���ջ�ÿ������ܼ������̶߳��ᡣ
- �������õ������ǰ� feature slice ��Ƭ����Ҫʱ���ھֲ��������ۻ���������һ���� commit�������̨�ؽ����̰�ǰ̨����״̬Ū�ɰ��Ʒ��

### 61. ֻҪ promotion ���ذ� topology/context source��`ensureLayerDataFromTopology()` �ͱ������� visual stage
- ��� latest urban �޸��� `urban` source contract �̶��ɡ�startup ���ڿ��� + external ���� + adaptive �����ˡ������Ϊ�����ܰ� context source �ذ�Ų�� infra stage���ͻ��Ȱѻ����е��� topology���� `urbanData/urbanLayerCapability` ��ͣ�ھ�Դ��
- ���ȵı߽��ǣ�visual stage ����� topology/context source �ذ󶨣��������Ƶ��� mesh��spatial��hit��full color �����ؽ������� source ѡ������

## 2026-04-11 - chunk refresh / startup ready

### 1. `flushPending` 立即执行路径不能先清空 pending 标记再判断要不要启动 refresh
- 这次 `scheduleScenarioChunkRefresh()` 在 `resolvedDelayMs <= 0` 前先 `clearPendingScenarioChunkRefresh()`，会把 `executeScenarioChunkRefreshNow()` 需要的 pending reason 提前抹掉，结果异步 refresh 启动路径被误判成 `noop`。
- 更稳的做法是：把“是否允许启动 refresh”的语义在进入 immediate execute 前就显式带进去，不要依赖已经被清掉的 runtime 字段再二次判断。

### 40. Texture overlay 不能把纸张、线网、标签塞进同一个 render pass
- Old Paper、Draft/Grid 线条、Graticule 标签的层级目标不同；如果共用一个 pass，修海洋覆盖时很容易顺手把城市点、机场、港口或边界一起压脏。
- 更稳的最短路径是至少拆成 paper / line / label 三层，再按读图优先级排顺序。

### 41. 只把无效控件设成 disabled 不够，写状态的 handler 也要同步加 guard
- Clean 模式这种“控件存在但语义无效”的场景，若只禁 DOM，不禁 handler，脚本事件或测试 helper 仍会偷偷改 state。
- UI 禁用和状态写保护必须同一轮收口，否则很容易出现“界面看起来没变，状态其实漂了”的假通过。

### 40. 真正的 modal 不能继续挂在会被隐藏的 shell 容器里
- 如果一个 UI 从 sidebar popover 升级成全屏 modal，但 DOM 还留在 sidebar / details / utility shell 里面，那么一旦父层被 `visibility:hidden`、`opacity` 或 drawer 状态影响，modal 本体也会一起被吞掉。
- 更稳的最短路径是把 modal/backdrop 直接放到顶层，并让它自己管理 z-index、焦点和退出逻辑，不再借用 drawer scrim。

### 63. �Ӿ��ع���Բ�Ҫ�ѡ������Թ�ϵ��д��Ӳ���ԣ�����д���Ա߽��Ŀ���������
- ��� historical 1930s ҹ����ǿʱ���ɲ��԰� `historical` ǿ��ѹ�� `modern` ֮�£�����һ�����������ͻᱻ�����лع顣
- ���ȵ������ǣ��á������������� / ���������� / ���и������ / Ŀ������������ǡ���Լ���Ӿ���Ϊ����Ҫ�ѡ��������һ�ַ�������д������Լ��

### 41. Physical layer regressions need one���漶���ԣ���Ҫֻ�� render pass / regex ��Լ
- ��� atlas ���߼��ϱ����õ��Ӿ��ϼ�����ʧ�������⣬����Դ���������ץ��ס�����벹һ����С���ز����飬ֱ����֤ atlas �򿪺�����ı��ˣ�����û��ǿ������������ɫ��
### 42. �������ؼ��Ӿ���ʾ�� deferred pass Ų��ʱ��Ҫͬʱ��� staged apply ��֧
- ĳ�㼴ʹ�㼶�Ŷ��ˣ�ֻҪ�������� `deferContextBasePass` ���� staged warmup ��֧��س��������Ի��ȶ�ȱʧ���� render pass ����ʱ������ͬ����� defer ��֧�Ƿ񻹱����ò����С��֡���ơ�

### 64. �����ü���Ǩ�Ʋ�Ҫ����ͨ�� normalize �ﷴ���ط�
- �� cityPoints.radius ����ֻ������ʷ�浵����ϵͳʱǨ��һ�ε��ֶΣ����ֱ��д��ͨ�� normalize���ͻ���ÿ�ξֲ� patch / UI ����ʱ���������㣬����µ�����״̬��Ⱦ��
- ���ȵ������ǣ���ʽ�������ȣ����ֶ�ֻ��ȱ�����ֶ�ʱ����һ����Ǩ�ƣ�֮��ʹ�����ʱ�ṹ���Ƴ���

### 65. canvas ��ǩ�ػ�ع����ȶ��ԡ��ػ淢�� + Ŀ���ǩ״̬������Ҫ�� fillText hook ��Ψһ֤��
- fillText/strokeText hook �ʺ�ץ����û�л��������Գ���· i18n redraw ���������ӿڡ���ѡ��ǩ������Ӱ�����ࡣ
- ���ȵ����·���ǣ�ͬʱ���� drawLabelsPass.recordedAt ǰ������ǰ�����л��ɹ���Ŀ�� feature ��������ʾ��ǩ�Ѹ��£��ı� hook ֻ��Ϊ�ӷ�֤�ݡ�

### 66. ������ locales ������ʱ inline i18n ����˫�����Ư��
- ��� 57 �� UI key �Ѿ��� js/ui/i18n.js �������ģ��� 	ranslate_manager û�и������ǣ��������� data/locales.json ʱ�Ի��˳�Ӣ�Ļ������
- ���ȵ������ǣ���������ʱ fallback���� sync/build Ҳ����� inline translation ����������Դ֮һ������ͬһ������д��ȴι������ʽ���

### 67. i18n audit ���� JS �ַ���ʱ��Ҫ�Ƚ��� \uXXXX ���ж��ǲ��ǿɷ����İ�
- �� \u00D7��\u25B6��\u2699 ����ͼ�꣬������Ƚ��룬�ͻᱻ���гɴ���ĸ��δ�����ַ�����
- ���ȵ������ǣ��Ȱ� Unicode escape ��ԭ����ʵ�ַ������߿ɼ��İ�/�Ƿ��� token �жϡ�

### 66. 海域计划不能只验 geometry valid / ID 一致，必须补 probe coverage + seam 检查
- 这次 Baltic / Celtic-Irish 的漏区说明：只看 `water_regions.geojson` 合法、`scenario_water` 和 runtime ID 对齐，仍然会把 Gulf of Riga、Severn Estuary 这类真实缺口放过去。
- 更稳的最短路径是：对高价值 basin 固定代表点 coverage 断言，再加关键邻接海域的无细缝距离断言。

### 67. 只替换 `scenario_water` 对象而不重整 topology arcs，会把 runtime topo 体积越堆越大
- 这次为了快速刷新 `scenario_water`，如果直接把新 water arcs append 到现有 `runtime_topology`，虽然功能能跑，但会留下大量未使用旧 arcs，文件体积明显膨胀。
- 更稳的做法是：要么完整重建 runtime topology，要么在局部替换后立刻做一次 arc compaction，不能把 append 版当最终产物。

### 68. `coverage_invalid_edges` 不能直接拿来判 open ocean coverage 成败
- 这次 `ocean_macro_coverage invalid_edges=16` 的根因不是 open ocean 真有重叠，而是 validator 把 open ocean 单独当成完整 coverage 去验，结果把它和 marginal seas/海岸线形成的开放边界全记成 invalid edges。
- 更稳的做法是：对 `ocean_macro` 改查 pairwise overlap 这种真实错误；如果还想保留旧指标，只能作为调试信息，不能继续当 fail 条件。

### 69. Routine i18n sweeps should audit before full translation sync
- 	ranslate_manager.py can become disproportionately slow when it rescans every data/scenarios/**/*.json file.
- For recurring localization runs, first use 	ools/i18n_audit.py plus targeted geo-locale override checks; only rerun full translation sync when the audit exposes a real gap or data/locales.json truly needs regeneration.
### 69. 只刷新 source water 和 runtime topology 不够，startup bundles / manifest 也必须一起重建
- 这次 review 抓到的真实问题是：`water_regions.geojson` 和 `runtime_topology.bootstrap.topo.json` 已经变了，但 `manifest.json`、`startup.bundle.{en,zh}.json` 还停在旧的 `generated_at / tno_water_region_count / bootstrap sha`，默认启动仍会吃旧缓存键。
- 更稳的做法是：凡是改 `scenario_water` shipped artifacts，就把 `manifest + audit + startup bundles(.json/.gz)` 当成同一笔交付一起刷新，并加测试直接核对 bundle 里的 bootstrap sha 和 water count。

### 70. 海域第二轮细化优先用 SeaVoX 的 `mrgid_l4` 组团入口，不要一上来把所有 `mrgid_sr` 小湾口全拆开
- 这次 Celtic-Irish 证明：像 Liverpool / Cardigan / Solway 这类天然成组的水域，先用 `mrgid_l4` 收住范围，比逐个 sr 小碎片开洞更稳，也更容易测试和命名。
- 更稳的做法是：先用 `sr` 处理单个高价值子海域，用 `l4` 处理会爆炸的湾口簇；只有确实需要再继续向下拆。

### 71. Inspector 的批量动作必须默认绑定当前可见过滤结果，并且先给影响数量预览
- 这次 Water Inspector 升级如果直接对“同组/同类型全量对象”落色，很容易误伤几十个海域；尤其 open ocean 和 marine_macro 混在一起时最危险。
- 更稳的做法是：批量 scope 只作用于当前过滤后可见的候选集，并在提交前明确展示影响数量和样例名称。
### 72. �� clone �꺣���е��ٷ�Դʱ��������ͬʱ�ų��� global base id
- ��� `Black Sea / Yellow Sea / East China Sea / Bay of Bengal / Andaman Sea / Java Sea / Banda Sea` ���ֻ�ĳ� SeaVoX/IHO source��������ʽ�ų���Ӧ `marine_*` base��������ͻ�ͬʱ������ global ˮ����¹ٷ�ˮ������ͬ������
- ���ȵ����·���ǣ�������ˮ���� `exclude_base_ids`������ `TNO_EXCLUDED_BASE_WATER_REGION_IDS` һ��Խ�ȥ������ source/runtime �����������˫�ݺ���

### 73. Inspector e2e �ȱ�֤ section ��򿪣��ٶ��Խṹ��Ԫ���ݣ���Ҫ�� hint ������
- ��� `#waterRegionSearch` һֱ fill ��ʱ����������򲻴��ڣ����� `waterInspectorSection` Ĭ��ûչ�����������Ȼ�� DOM �ﵫ���ɼ���
- ���ȵ������ǣ����� helper ����ʽ�� details section���ٶ� `waterInspectorMetaList` ��� `ID / Type / Group / Parent / Source` �����ԣ�`DetailHint` ֻ�ʺ���ժҪ�����ʺ����ȶ�������Լ��

### 74. ���� seam ��ԼҪ����ʵ���ڹ�ϵд�����ܰ������е� family �ṹӲ��
- ��� `Liaodong Wan` ʵ��Ӧ�ù��� `Bo Hai` �£�����ֱ�ӹ� `Yellow Sea`��`Andaman ? Singapore`��`Banda ? Halmahera` Ҳ����ֱ�����ڣ������������� seam ֻ������ٻع顣
- ���ȵ������ǣ����ô������ bounds ȷ�� parent/adjacency����д seam pair������������΢��ʱ����С�����ݲ�� topo ��������Ҫ�� 1e-5 ����ķ�ҵ��쵱����ʵ©����
### 75. ���� Pacific / Indian ��������ʱ��parent subtract �� open-ocean clipping ����һ�𲹣�ȱһ��ͻ����˫����
- ��� Sea of Japan © subtract �Լ����� detail��South China Sea © subtract Singapore/Java��Molucca Sea © subtract Celebes/Halmahera��ͬʱһ���� SeaVoX ��������д `clip_open_ocean_ids`�����ͬһƬˮ��ͬʱ���и������ open ocean��
- ���ȵ����·���ǣ�ÿ�¼�һ����������ʱ��ͬ����� 3 ���£������Ƿ� subtract������ sibling �Ƿ� subtract���Ƿ���Ҫ��ʽ `clip_open_ocean_ids`��������Щ pair ֱ��д�� contract test��

## 2026-04-12 - landing page /app split

### 1. 路由分流时，测试入口兼容要先做中心化收口
- 当站点把编辑器从 `/` 挪到 `/app/` 后，最容易漏掉的是测试里大量历史 `/?...` 入口写法。
- 最稳做法不是逐个 spec 硬改，而是在公共 helper 里把 `/?...` 统一归一化到 `/app/?...`，先保兼容，再慢慢清理调用点。

### 2. `dist/` 分流时，根目录只放 landing 需要的东西
- 如果构建脚本顺手把 `css/js/data/vendor` 也复制到 `dist/` 根，会让 landing 和 app 重新缠在一起，还会把 Pages 产物无意义放大。
- 正确边界是：根目录只放 landing 自己的 HTML/CSS/JS/assets，编辑器静态资源只进 `dist/app/`。
### 76. Marine Regions named-water snapshot 不能混入 `supplement_bboxes`
- 这次 Alaska / Labrador / Tasman 说明：如果 snapshot 构建阶段先把 supplement union 进去，后面再从 snapshot 生成 shipped geometry，就会把“补 seam 的临时补丁”伪装成官方 source，既放大错误，也让 source-vs-final 审计失效。
- 更稳的做法是：snapshot 永远只保存 raw official source；supplement 只在最终 named-water 几何构建阶段应用。

### 77. 海域护栏要单独检查 `marine_macro` 压陆，不能只查 valid / probe / seam
- 这次的方块底座问题没有被旧护栏挡住，因为旧检查只看几何合法、代表点命中、海海 overlap 和 seam，没有看海域是否大面积压到政治 land union。
- 更稳的最短路径是：对 `marine_macro` 增加 land-overlap 审计，并配合 snapshot-vs-final 面积膨胀检查，专门抓 supplement 过大的问题。

### 78. 拆 stage 时，保留的手动 CLI 路径也要一起补齐前置 stage 自恢复
- 这次把 `water_state` 从 `countries` 拆出来后，`--stage runtime_topology` 如果还直接读取新 water checkpoints，就会把原本合法的 `countries -> runtime_topology` 两步流程打断。
- 更稳的做法是：凡是中游 stage 允许单独手跑，就必须先自动补齐它新引入的前置 checkpoints，不能默认调用方知道新依赖。

### 79. 显式 refresh 不能只进输入 payload，还要直接打断 cache hit
- 像 `--refresh-named-water-snapshot` 这种“用户明确要求重刷”的开关，光写进 stage signature 还不够；如果上次记录也是同样参数，仍可能误命中旧签名。
- 更稳的做法是：这类 refresh flag 既进入签名，也在 skip 判定里直接禁止复用对应 stage。

### 80. support file 改路径时，要先保证新位置有 checked-in 文件或兼容回填
- 这次把 `water_regions.provenance.json` 收到 `derived/...` 后，如果只改代码读取路径、却没有保证新位置文件随仓库一起存在，干净工作区默认 build 会直接因为缺文件失败。
- 更稳的做法是：要么把新 support file 一起 check in，要么保留一波 legacy mirror + 运行时/构建时自动回填，等下一波再彻底删旧路径。

### 81. bootstrap shell 一旦收成空几何，startup bundle 的政治 meta 就必须改从 full runtime topology 生成
- 这次把 `runtime_topology.bootstrap.topo.json` 收成真正 shell 后，如果 `build_startup_bundle.py` 还继续从 bootstrap 文件推 `runtime_political_meta`，featureIds 会立刻变空，startup contract 虽然对象名还在，但政治 feature 计数会直接失真。
- 更稳的做法是：bootstrap 文件只负责最小壳，政治 meta 永远从 full runtime topology 生成；chunk builder 如果还需要 coarse political 几何，也要显式回退到 full runtime，而不是偷偷依赖旧 bootstrap 里那份重几何。

### 82. coarse chunk 先做 minify + 重复字段收口，往往比先上几何级重构更稳
- 这次 `political.coarse.r0c0.json` 只靠去掉顶层重复 `feature.id`、收紧属性白名单、做 minified JSON 写出和轻量坐标收口，就从约 71 MB 降到约 28.5 MB，已经越过目标线。
- 更稳的顺序是：先吃掉明显的编码冗余，再决定是否值得做 owner 聚合或更激进的几何改写；否则很容易为了追求更大压缩，把现有 coarse 交互语义一起打坏。

### 83. 对超大 coarse GeoJSON，先比较 raw JSON 和 minified JSON 体积，再决定要不要动字段或几何
- 这次 `water.coarse.r0c0.json` 从 55MB 到 16MB，几乎全是 pretty JSON 的编码膨胀，不是运行时语义真的太重。
- 最稳的最短路径是先做 `json.dumps(..., separators=(",",":"))` 级别的体积审计；只有这一步还不够，才值得继续碰字段裁剪或几何简化。

### 84. checkpoint filename 和 publish scope 如果一起承载目录布局，就必须同步迁移
- 这次 named-water snapshot/provenance 不是只有“要不要发布”的问题；`publish_checkpoint_bundle()` 用的 filename 同时决定 checkpoint 相对路径和 scenario 相对路径。
- 所以从 root 切到 `derived/...` 时，必须同时改 checkpoint 常量和 publish scope，只改其中一边就会在干净场景目录或下次 rebuild 时缺文件。

### 85. startup bundle 优化前先做 section 体积分解，不要先删 `.json.gz`
- 这次 startup bundle 10MB 级体积的主要来源是 `base.topology_primary`、`runtime_political_meta`、`geo_aliases` 和 locale/patch 内容本身，不是 gzip sidecar。
- `.json.gz` 已经把 10MB 压到 2.3MB 左右，先删它只会让启动退化；更稳的顺序是先拆清 bundle 内各 section 的职责和重复边界。

### 86. startup family 瘦身前，要先把消费者矩阵和 section 体积分解做成机器可读报告
- 这次真正的大头不是 `.json.gz`，而是 `base.topology_primary`、`runtime_political_meta`、`geo_aliases` 和 locale/patch section 本身；如果不先做 section 级拆账，很容易把传输 sidecar 当成主问题。
- 更稳的最短路径是：先固定 consumer matrix、section role、duplication suspects，再决定第一刀切哪一块。

### 87. 对共享 arcs 的 startup topology，先删一个小对象往往只能拿到很小收益
- 这次 `base.topology_primary` 去掉默认隐藏的 `special_zones` 后，bytes 和 arc 数确实下降了，但收益只有几万字节级，说明真正的大头不在这种边缘对象上。
- 下一轮如果还要继续压 startup family，优先级应转向 `locale/alias/patch` 或 `runtime meta/apply seed` 的职责拆账，而不是继续只盯 topology 里的小对象。

### 88. startup topology 里的默认隐藏对象也可能是启动 fallback 契约的一部分
- 这次 `special_zones` 默认虽然不显示，但启动链在外部 `special_zones.geojson` 缺失时仍会回退到 `topologyPrimary.objects.special_zones`。
- 所以判断能不能从 startup bundle 删对象，不能只看默认可见性，还要把 fallback 读取路径一起纳入契约审计。

### 89. startup bundle 里如果一个 section 已经有稳定外部读取链，就优先把它移出 bundle，而不是继续在 bundle 内做压缩技巧
- 这次 `base.locales / base.geo_aliases / scenario.geo_locale_patch` 都已经有明确的外部读取路径，直接移出后启动包体积下降比继续在包内做微调更明显。
- 更稳的顺序是：先拆职责边界，再谈缓存和二次压缩；否则很容易一边背重复载荷，一边还要维护两套读取语义。

### 90. startup bundle 快路径如果吃 bundle override，缺字段时必须回退外部文件，而不是注入空对象
- 这次 `startupBootArtifactsOverride` 一旦把缺失的 locales/aliases 变成空 `{}`，`loadMapData()` 就会误以为 override 已完整，直接跳过外部文件读取，首屏本地化会静默丢失。
- 更稳的做法是：缺字段就传 `null`，再让 `loadMapData()` 明确判“override 是否完整”，不完整就继续走外部读取链。

### 34. startup bundle 里凡是按 featureId 重复上万次的 map，优先改成按 runtime feature 顺序编码
- `owners/controllers/cores` 这种载荷，真正大的不是值本身，而是重复的 featureId 键；只要运行时已经有稳定的 `featureIds` 顺序，就优先改成 feature-order array，再在前端恢复成原接口。
- 这样通常能拿到明显体积收益，而且不用新增启动请求，也不用改上层消费代码。

### 35. `apply_seed` 这类纯派生 startup 便利载荷，先验证运行时 fallback 是否已足够，再决定要不要序列化
- 如果运行时已经能从 `manifest + countries + owners` 稳定推回 `default_country_code / scenario_name_map / scenario_color_map / resolved_owners`，那就没必要继续把整块派生结果写进 startup bundle。
- 最稳的最短路径往往是：删掉序列化，保留运行时现有 fallback，而不是额外引入一套新的补丁链。

### 36. startup support 的 key 裁剪不能只靠 topology object id + patch key 推导
- 这次审计发现，`base topology + runtime bootstrap + geo patch` 推出来的 required key 集只有一万多，但 checked-in `locales.startup.json` 仍有四万多 geo keys，说明 startup 真实依赖远不止这些静态对象 id。
- 在拿到更真实的 startup key-usage 证据前，不要直接按这个静态 key 集去重建 `locales.startup.json / geo_aliases.startup.json`，不然会把启动本地化和 alias 解析收得过狠。

### 37. startup support 的真实白名单最好从 `i18n` 集中 lookup 入口采，不要继续只靠静态 topology 推导
- 这次确认真正的 locale/alias 命中都汇总在 `resolveGeoLocaleEntry()` 这一层，那里既能看到直接 key 命中，也能看到 alias -> stable key 的真实使用。
- 对 startup support 做瘦身前，先在这个集中入口加可开关的只读采集，通常比继续叠更多静态规则更稳。

### 38. 只采到 1 次 startup support runtime 样本时，generator 只能产候选白名单，不能直接反推正式裁剪规则
- 这次真实启动样本里 `candidate_locale_key_count` 只有 22、`candidate_alias_key_count` 为 0，但 `miss_key_count` 仍然很大，说明单样本只够证明静态规则不够，不够直接做 support 文件瘦身。
- 更稳的做法是先把 generator 链搭好，再补多语言、多交互样本；只有样本覆盖稳定后，才把结果写回正式 builder。

### 39. generator 和 candidate materialization 不能并行读写同一个 whitelist 文件
- 这次 342 vs 336 的差值不是数据逻辑问题，而是我把 whitelist generator 和 candidate materialization 并行跑了，后者先读到了旧版本 whitelist。
- 这类“同一输入文件的生产者/消费者”必须串行，不然摘要会看起来像算法有 bug，实际只是执行顺序错了。

### 40. 正式 support slimming 第一版要把 whitelist 当成“带护栏的正式输入”，但 post-slim 样本仍然必须回采
- 这次把多样本白名单正式接入 builder 后，体积收益很大，但 post-slim 样本里 `missKeyCount` 仍然不低，说明第一版白名单只能算“可运行的第一刀”，不是最终稳态。
- 更稳的做法是：正式接入后立刻再采一轮 post-slim 样本，把缺失 key 回补进 whitelist，而不是一次裁完就当最终答案。

### 41. scenario-scoped support slimming 输入不能偷用某个 scenario 的默认白名单
- 这次 review 暴露出一个典型问题：如果 CLI/audit 在未传参数时偷偷回落到 TNO 的 whitelist，别的 scenario 会生成“看起来合法、其实用错输入”的 startup support 报告和产物。
- 更稳的默认是：按当前 scenario 输出目录去推断自己的 `derived/startup_support_whitelist.json`；如果不存在，就明确不用 whitelist，而不是借别人的默认值。

### 42. 只把新输入接进 stage signature 还不够；默认 rebuild domain 也要走到对应 stage
- 这次 `startup_support_whitelist.json` 虽然接进了 `startup_support_assets` 的 signature，但 `startup` changed-domain 还只跑 `startup_bundle_assets`，导致 whitelist-only 修改不会自动生效。
- 最稳的做法是：凡是用户心智上属于“startup 相关”的 changed-domain，就让默认计划显式经过 support stage，再到 bundle stage。

### 43. post-slim 第二版 whitelist 校正默认应“baseline whitelist ∪ 新样本回补”，不能直接用新样本覆盖
- 这次 startup support v2 校正如果只按 post-slim 样本重生成 whitelist，会把第一版已经保住但当前样本暂时没覆盖到的 key 又裁掉，形成“刚补完又回退”的假修复。
- 更稳的做法是：第二版默认保留 baseline whitelist，只把 post-slim 新命中的 locale/alias key 增量并进去；样本在覆盖还不完整时，不负责再次收缩白名单。

### 44. startup support 剩余 miss 要先判“是不是这个系统该管的”，再决定要不要继续加白名单
- 这次第二版 whitelist 校正后，默认 startup 剩余 `250` 个 miss 里，0 个命中 full locales，0 个命中 full geo_aliases，几乎全是水域显示名、`tno_*` 水域 slug、`marine_*` 宏海域 slug。
- 更稳的做法是：先把 miss 按域分类；如果它本质上来自 feature 原始属性和水域命名链，就不要继续硬塞进 startup support whitelist，而应单独判断它是否需要一条水域 locale 资产链。

### 45. 主运行时已经切到 scenario-scoped 后，要尽快删 root legacy 文件并同步修测试夹具
- 这次 `data/locales.startup.json`、`data/geo_aliases.startup.json` 虽然主代码早就不再读取，但它们继续留在仓库里，会制造“新旧两套都还在用”的假象，e2e 夹具也更容易继续偷走旧路径。
- 更稳的做法是：一旦确认主路径和负向断言都已经就位，就把 root legacy 文件删掉，并把剩余测试夹具同步切到 `data/scenarios/<scenario>/...` 路径。

### 46. canonical whitelist 这种参与签名的正式输入，不能混入机器本地 provenance
- 这次 `startup_support_whitelist.json` 一旦参与 `startup_support_assets` stage signature，里面再写绝对路径，就会让不同开发机在内容相同的情况下也产生不同 hash 和重复重建。
- 更稳的做法是：正式输入只保留真正参与构建语义的字段；溯源信息要么写 repo-relative，要么放到独立 report，不要混进 canonical 文件。

### 47. 采样 harness 不能把启动阶段已采到的 audit state 清掉，报告文件名也要带上足够维度避免互相覆盖
- 这次 `capture_startup_support_sample.js` 在 probe 前清空 audit state，会把只在真实 startup 阶段命中的 key 全丢掉，导致后续 whitelist 低估必需键。
- 同时，startup support key-usage report 如果只用 `scenario + label` 命名，`en/zh` 或不同 source 的样本会互相覆盖；更稳的做法是保留启动阶段 state，并在文件名里至少加入 `source + language`。

### 48. 场景 relief overlay 的首帧异常，先查“默认视觉层本来就在画什么”，不要先怀疑 startup/detail 数据链
- 这次亚特兰托帕地中海首屏发黄，真正原因不是 startup support 或 detail promotion 把数据切坏，而是 TNO 的 `relief_overlays.geojson` 里本来就有 `atlantropa_*_salt_texture`，默认开启后会画偏黄盐滩填充。
- 更稳的做法是先把问题归到具体视觉层（这里是 `scenario relief overlay`），再做最小定向去黄；不要一上来动 chunk、promotion 或 startup 载荷，不然容易扩大回归面。

### 49. 首屏间歇性视觉脏块，如果只在 startup/coarse 阶段出现，除了改颜色，还要考虑推迟那类 overlay 到 detail 稳定后再显示
- 这次亚特兰托帕黄块在单独去掉 `salt_texture` 之后仍有间歇反馈，说明问题不只是某一个 fill 颜色，而是“Atlantropa relief overlay 在 startup 早期就参与绘制”这件事本身也会放大首屏不稳定。
- 更稳的做法是：对这类只在 detail 稳态下才有意义的场景 overlay，除了调色，还在 `detailPromotionCompleted` 之前直接不显示，等拓扑和遮罩稳定后再画。

### 34. Pages/部署构建如果会在 CI 里重建 `dist`，就不要把 `dist/app/data/**` 这类生成产物塞进 Git 历史
- 这次 push 失败不是代码坏了，而是本地未推送提交里混进了 `dist/app/data/**` 下的超大生成文件，远端收 pack 时直接报 HTTP 500。
- 更稳的最短路径是：把真正的 source of truth 留在 `data/**`、`js/**`、`tools/**`，把 CI 会重建出来的 `dist/app/data/**` 直接 `.gitignore`，不要等大文件进了历史再补救。
### 24. startup support slimming之后，新增顶层功能入口先默认只进 deferred runtime，不要顺手塞回 startup 主链
- 这次 `Appearance > Transport` 说明了一条边界：新增顶层 tab 的 UI 壳可以先上线，但 family 真数据应继续走启动后按需加载。
- `startup_support_whitelist` 当前主要约束 geo key / alias，不是普通 UI 文案；不要因为加一个新 tab 就误以为必须扩 startup support 资产范围。
- 更稳的最短路径是：先补 tab、state、save/load、renderer 和 lazy load，再单独评估要不要进 scenario publish / chunk contract。

### 25. 总显隐开关不能顺手覆写子图层可见性，尤其当保存链会把子图层状态当成真值写盘时
- 这次 Transport Overview 暴露出一个典型坑：如果总开关关闭时直接把 showAirports/showPorts 改成 
alse，项目保存后就会把“临时总隐藏”误写成“family 真的关闭了”。
- 更稳的做法是：总开关只负责渲染门控；family 自己的可见性继续单独保存，必要时再单独持久化“上次展开状态”，不要混用同一组字段。
### 26. 未来 family 的占位状态如果还没接通 runtime，就不要先写进项目保存链
- 这次 `showRail/showRoad` 先写进 save/load，实际却还没有对应的加载、渲染、缓存失效入口，马上就暴露出“状态能恢复，但行为没接上”的半接通风险。
- 更稳的做法是：要么一次把 family 的 state/load/render/invalidation 一起接通；要么在真正落地前只保留 style/schema 占位，不把开关真值写进项目文件。

### 50. 场景 overlay cache signature 不能只看数据数量，还要带上 detail/composite 阶段 token
- 这次 Atlantropa 黄块残留不是 relief 数据又坏了，而是 `contextScenario` pass 的缓存签名没把 `topologyBundleMode`、`detailPromotionCompleted`、`detailPromotionInFlight` 算进去，导致 coarse/detail 切换后旧画面还能留在稳定帧。
- 更稳的做法是：凡是“同一批数据在不同阶段显示规则不同”的 overlay pass，签名里必须显式带上阶段 token；不要只靠 feature count 或 revision 侥幸命中重绘。

### 51. startup bundle 先进入 ready 不代表场景视觉壳已经完整，缺 mask 的场景要提前 full hydration
- 这次首屏亚特兰托帕海域残留问题，本质上是 startup bundle 已让 TNO 进入 `ready/composite`，但 `scenarioLandMaskData` / `scenarioContextLandMaskData` 还要等默认的 post-ready full hydration，视觉上就会先看到错误海域壳。
- 更稳的做法是：如果活动场景已经声明了 runtime topology，但 ready 后关键 mask 仍为空，就不要继续按通用延后时间等 full hydration，而应立即快速调度完整场景水合。
### 27. 全球静态交通 builder 不能先把全量世界主干网物化到 Python list，再做过滤和简化
- 这次 `build_global_transport_roads.py` 审查直接暴露了一个典型问题：Overture 全球主干道路大约千万级，先 `to_pylist()` 全收进大 list 再转 `GeoDataFrame`，正常开发机和 CI 都会先被内存打爆。
- 更稳的做法是：按 Arrow batch 流式读取，批内完成字段裁剪、长度过滤、几何简化，再把中间结果落到临时 parquet chunk，最后只对过滤后的结果做汇总和正式输出。
### 38. 多产物地理 builder 不能把 preview / full / labels 绑成同一波总装
- 就算前面已经做了 batch 读和临时 chunk，只要最后还是同时把 preview、full、labels 全部回收进内存，full-scale 构建还是会在总装阶段重新变重。
- 更稳的最短路径是：先把 normalized chunks 当唯一中间真相，再串行落 preview backbone、full backbone，最后才做 sidecar labels。
### 39. 串行 staged output 只能先解决波次耦合，不能自动解决最终 materialize + TopoJSON 汇总压力
- 就算已经把 preview/full/labels 拆波次，只要 `materialize_*_from_chunks()` 还是把所有 chunk 读回内存再 `concat`，full-scale build 仍会在最终汇总阶段卡住。
- 更稳的下一步不是再加更多 sidecar，而是继续压缩进入最终 TopoJSON 的 feature 数，或把最终汇总再拆细。
### 40. 给超大全球 builder 补阶段日志，先分清是卡在扫描、归一化，还是卡在最终总装
- 这次 road trial 证明“没有正式产物写出”不等于一定卡在 TopoJSON 总装；如果没有阶段日志，很容易误判真正瓶颈。
- 最短稳路线是先在 normalize/spill、preview assemble、full assemble、labels 生成之间打清晰日志，再根据真实停留阶段收下一步优化。
### 41. 全球 Overture builder 先要判断“卡在扫描归一化”还是“卡在最终总装”，不要把两类瓶颈混在一起
- 这次 road 再跑更久后，日志证明它连 `starting preview backbone assembly` 都没走到，说明当前首要瓶颈其实还在 normalize/spill，不是后面的 preview/full/labels 波次。
- 一旦阶段日志已经把瓶颈定位到扫描归一化，就该优先考虑更早的源侧筛选、批内几何处理成本、以及是否要按区域分治，而不是继续只盯 TopoJSON 汇总。
### 42. 大文件远端扫描别轻易加大 Arrow read-ahead，先验证内存曲线
- 这次给 Overture scanner 加 `batch_readahead / fragment_readahead` 后，没有明显提升 flush 进度，反而把 road build 的 private memory 顶到了约 13.75 GB。
- 对远端大规模 parquet 扫描，read-ahead 不是默认越大越好；先用阶段日志和内存曲线确认收益，不行就立刻回退。
### 43. 把产品口径继续收窄到 motorway+trunk 也不一定够，必须看几何处理链本身是不是主瓶颈
- 这次 road phase A 已经收成 motorway+trunk only，但长试跑依然在 normalize/spill 前段就把 private memory 推到约 5 GB，说明问题不只在 feature 数，也在 GeoPandas/Shapely 处理链本身。
- 当日志显示还没进入 preview/full assembly 就已经吃掉大内存时，下一步应该优先考虑区域分治、离线分片、或替换几何处理方式，而不是继续微调 staged output 波次。
### 44. 全球分片 builder 要按密度分片，不要只按等宽经度切
- 这次 `w180_w150` 轻 shard 已经能稳定产正式产物，但 `e000_e030` 这种欧洲高密度 shard 仍然在第一个 flush 前就把内存顶到约 4.69 GB，说明“等宽经度分片”不足以覆盖密度差异。
- 真正要把全球数据准备跑完，分片规则必须开始按密度细化：高密地区更小 shard，低密海洋/荒漠区域可以保持大 shard。
### 45. 高密区分片最好支持“固定密度 shard + 自定义经度窗口”双轨
- 固定 shard 适合正式 checked-in 批处理，但当某个高密区仍然过重时，临时 `--lon-min/--lon-max/--shard-id` 能最快验证更细窗口是否可跑通。
- 这次 `e010_e012` 和 `e012_e014` 都成功落正式产物，证明高密区先用自定义细窗验证，再回填固定 shard 列表，是最稳的推进方式。
### 46. 对分片构建失败的半成品目录要及时清掉，避免把“只有 recipe”的失败尝试当成 ready shard
- 这次 `e000_e030` 只写出了 `source_recipe.manual.json`，如果不清理，后面很容易被误当成已完成 shard。
- 分片治理里，只有同时有 manifest/audit/preview/full 产物的目录才算 ready；失败尝试应及时删除或明确隔离。

### 47. 线几何简化后必须立刻重算长度，并重新应用基于长度的阈值
- reveal_rank、preview/full 过滤、导出字段只要依赖 length_m，就不能继续使用简化前长度；否则产物会和最终几何不一致。
- 更稳的最短路径是：simplify -> measure_lengths -> 再做长度阈值过滤和分级。

### 52. 城市点位 e2e 一旦依赖 labelEntries，就必须先等 exact render 稳定并在测试里显式打开 showLabels / labelMinZoom
- 这次 city reveal 回归在单独跑能过、整组跑会偶发归零，根因不是 reveal 算法本身，而是 uildCityRevealPlan() 的 label 产出受 state.deferExactAfterSettle 和 styleConfig 开关控制。
- 更稳的做法是：凡是断言 labelEntries 或 label density 差异的 Playwright 测试，都先等待
enderPhase=idle && !deferExactAfterSettle，并在测试配置里显式给出 showLabels: true、合适的 labelMinZoom。

### 47. 延迟加载的数据一旦会反推已挂载 UI 摘要，就要补显式 UI refresh 钩子
- 这次 transport summary count 不是算不出来，而是 `airports/ports` pack 在 toggle 后异步落地，toolbar 如果没有显式刷新入口，就会一直停在旧摘要，直到下一次人工操作才更新。
- 更稳的做法是：凡是 deferred data 会改变现有 summary/meta UI，都在 load success 处补一个最小刷新回调，不要赌别的交互会顺手触发重绘。

### 48. 编辑器里的精确 overlay 点击，必须先按“相关面板是否真的在用”做门控
- 这次机场/港口 marker 的点击信息卡如果全局常开，会直接抢走地图底下的 land paint 点击。
- 更稳的最短路径是：只有在对应 surface（这里是 Appearance > Transport 或 Transport workbench）真的处于活跃态时，才让 marker click 接管主点击流。

### 49. 一旦给已有视觉家族补独立主色，原来的“强度滑块顺手改色”就必须立即收口
- 这次 Airport / Port 如果继续让 `visualStrength` 同时改颜色深浅，新增 color picker 就会变成“用户刚选完色，滑一下强度又偷偷换色”。
- 更稳的做法是：color picker 只负责主色，strength 只负责大小、线宽和高亮力度，职责当场切干净。

### 50. 浮动信息卡里做展开/收起时，要保存上一次锚点，不要每次重渲染都按空 anchor 回退
- 这次 facility info card 如果在“更多字段”切换时直接重新走定位，卡片会跳到左上角。
- 更稳的最短路径是：第一次打开时记录 anchor，后续同一张卡的重渲染都复用这份 anchor，直到卡片关闭再清掉。

### 51. 如果 overlay click 还带条件门控，hover affordance 也必须跟着同一条件走
- 这次 Airport / Port marker 的问题不是 hover 或 click 各自坏了，而是 hover 总给 pointer、click 却还要过 active-surface 门槛，用户感知会直接分裂。
- 更稳的做法是：pointer 只在 click 真能生效时才出现；只读 tooltip 可以保留，但“可点击”的信号必须和真实点击能力一致。

### 52. 信息卡 polish 的第一刀优先做减法：去冗余、分主次、降重量
- 这次 facility info card 真正提升观感的不是加更多装饰，而是删掉重复的 Family 行、把 More fields 降成次级动作、把深色重弹层收成更轻的浮层。
- 做 UI polish 时，先找重复信息和同权按钮，再决定要不要加新视觉元素，通常更稳也更像成品。

### 53. 渲染 helper 里新增样式字段时，必须显式走参数链，不要偷读调用侧局部变量
- 这次 facility marker 的 `hoverScale/highlightStroke` 在 `drawContextFacilityPointLayer()` 里直接读了并不存在的 `visualStyle`，结果一开机场/港口就会在渲染阶段直接 ReferenceError。
- 更稳的做法是：凡是 renderer 需要的新样式值，都放进 options 参数并在调用处显式传入，避免 helper 隐式依赖外层局部变量。

### 54. 命中缓存一旦在每次重绘都会重建，选中态就必须同步重绑到新 entry
- 这次 facility hover cache 每轮都会换成新投影 entry，如果只保留旧 key、不把 selected/hovered 指针换到新对象，缩放和平移后高亮会停在旧像素位置。
- 更稳的最短路径是：缓存刷新时先建 key -> entry 映射，再把 selected/hovered 重绑到新 entry；找不到时才清空。

### 55. 浮动详情卡的宿主 surface 一旦被关闭，卡片和高亮必须同步撤场
- 这次 transport facility card 的问题不是打开逻辑错了，而是 workbench / appearance tab 关闭后没有主动同步可见性，导致卡片和高亮孤零零留在地图上。
- 更稳的做法是：宿主 surface 的开关点（tab 切换、overlay 关闭、相关卡片折叠后刷新）统一调用一条 visibility sync，而不是等用户下一次点地图来被动清理。

### 56. 新增 UI 文案时，凡是 `t()` 动态拼出来的 key 都要和静态 DOM 文案一起补齐
- 这次 review 暴露的不是单个翻译漏了，而是 summary 和 info card 里动态调用了 `airport/ports/Owner/Manager/Status/...` 这些 key，却只补了一部分静态按钮文案。
- 更稳的最短路径是：每次新增一条 UI 路径后，把“静态 DOM 文案 + JS 里所有 `t()` 动态 key”一起 grep 一遍，再补 i18n，避免中英文混排。

### 57. 早期 capital label phase 不能继续复用城市点位的 minZoom 门槛
- 这次 P3 label phase 死掉，不只是默认 `labelMinZoom` 偏高，更关键是 capital label 仍被 `entry.minZoom`（很多 minor capital 默认 2.9）一起卡住。
- 更稳的做法是：capital marker 可以继续有自己的 reveal 逻辑，但 capital label 的门槛要单独走 `labelMinZoom`，不要直接复用普通城市的 marker minZoom。

### 41. 连续叠加同一 feature 的 PR 时，先收口唯一 state schema，再继续加 UI 和导出分支
- 如果 state normalizer、DOM 控件、import 恢复链各自按不同字段名演化，最后合并时最容易留下“语法能过一半、运行链却分叉”的双轨残留。
- 更稳的最短路径是：先固定唯一 canonical schema，再让 toolbar / file_manager / interaction_funnel 全部只认这一套；旧字段只做单向迁移，不要长期并存。

### 58. checked-in shard 目录不能靠“看起来差不多”存活，必须和 builder 真相逐项对齐
- 这次 global road 暴露的问题不是单个 shard 坏了，而是仓库里保留了旧分片目录、旧 build_command 和新 `ROAD_SHARDS` 同时存在，catalog 一旦按目录盲扫就会把 stale 产物误当正式输入。
- 更稳的最短路径是：builder 定义的 shard 列表当唯一真相，checked-in 目录必须 exact match；多余目录直接清掉，catalog 和测试都只认这份列表。

### 59. 未来全局 transport 家族在正式产物没落地前，不要先挂进默认 eager loader
- 这次 `data_loader` 先接了还不存在的 `global_road/global_rail` 顶层 pack 路径，结果启动阶段只能一边请求一边报 missing warning，既没能力也没数据。
- 更稳的做法是：正式产物出来前，先保持 family 在 deferred/catalog 边界之外；等 catalog 和真实 pack 都 ready 后，再单独接 lazy loader，而不是提前塞进默认 context pack 列表。

### 60. 长扫描 builder 只在 flush 时打日志还不够，scan checkpoint 必须早于首次产物写出
- 这次 rail builder 一开始改成按 4000 行再 flush 后，短观察窗口里又回到了“只看到 starting scan、看不到任何后续进度”的假卡死观感。
- 更稳的做法是：除了 flush log，再单独加 batch 级 scan checkpoint，把 `raw_seen / kept / pending_rows / region_counts` 提前打出来，这样就算还没写任何 chunk，也能知道它是在慢扫、慢滤，还是完全没推进。

### 61. 支持区工具一旦升级成一级功能区块，必须同波次迁移 URL restore、旧壳清理和契约测试
- 这次 Export 从 Utilities 升成 Project 一级区块后，如果只挪 DOM、不同时改 sidebar.js / toolbar.js 的 restore 链、旧 popover 清理和 contract/e2e，界面会立刻出现‘入口新了，但状态恢复和测试还活在旧层级’的分裂。
- 最稳的最短路径是：保留按钮 id 和 overlay id，只搬入口层级；同时把旧 support-surface 残链一次删干净。

## 2026-04-15 - 外部 skill 安装

### 1. 第三方仓库把 skill 打包在通用目录名 `skill/` 时，安装器必须显式给 `--name`
- `install-skill-from-github.py` 默认用路径 basename 当目标目录；像 `--path skill` 这种仓库结构会直接撞上已有的 `~/.codex/skills/skill`。
- 更稳的做法是安装这类第三方 skill 时一开始就显式传 `--name talk-normal` 这类真实 skill 名，避免误判成“已安装”或覆盖错误目录。
### 62. 多区域/多分片的几何 builder 不能直接用 bbox intersects 当最终归属规则
- 这次 rail 在 focus region 和相邻 shard 都有重叠窗口时，只要按 intersects 收件，同一条线就会稳定落入多个 pack。
- 更稳的最短路径是：query 层仍可用 intersects 做粗筛，但真正写入 checked-in 产物前，必须再走一次唯一 owner 规则；这里用 bbox center + 固定优先顺序收口最稳。

### 63. manifest 输出层级一旦改成嵌套目录，共享 contract discovery 必须同波次递归化
- 这次 rail manifest 从顶层 family 目录移到 `regions/.../shards/...` 后，旧的单层 `glob("*/manifest.json")` 会直接把全部新产物漏掉。
- 更稳的做法是：manifest discovery 只保留一个递归 helper，CLI 和测试都复用它，避免工具修好了但测试还在偷跑旧发现逻辑。
### 64. preview shard 总量足够小时，runtime 优先一次性 lazy load 全部 preview，而不是提前做 viewport shard 调度
- 这次 global rail preview 全部 shard 加起来只有约 5 MB，如果一上来就做视口分片切换，会把 runtime、缓存、边界状态和测试复杂度一起拉高。
- 更稳的最短路径是：继续保持不进 startup eager loader，但首次打开 family 时一次性拉全 preview shards，等真实性能压力出现再升级成 viewport shard 调度。

### 65. 分阶段开放 runtime 时，要用测试把“主地图已开 / save-load 未开”这个边界钉死
- 这次 rail runtime 接入只开放了主地图显示和 UI 开关，如果不额外补静态断言，很容易顺手把 `showRail` 漏进 file_manager 或 project import/export。
- 更稳的做法是：在同一波里补一条边界测试，明确允许 state/toolbar/renderer 出现 `showRail`，但 file_manager 和 interaction_funnel 仍不许接它。
### 66. 共享阈值 helper 不能直接套到 reveal_rank 语义不同的交通家族上
- 这次 rail 的 manual threshold 如果直接复用机场/港口那套 `primary=3 / secondary=2 / all=1` 的重要度映射，会把 `all` 误变成最窄选项，因为 rail 这边的 `reveal_rank` 是数字越大范围越宽。
- 更稳的做法是：遇到不同家族字段语义不一致时，单独建 family-specific threshold helper，不要为了省事强行共用一套排序。

### 67. placeholder 数据家族一旦接进 runtime，返回值要稳定是空集合，不要在无数据时退回 null
- 这次 `rail_stations_major` 当前真实数据还是空，如果 loader 返回 `null`，UI 和渲染层就会分不清“链路没接上”和“链路已接通但暂时为空”。
- 更稳的做法是：占位数据也返回 `FeatureCollection(features=[])`，这样运行链能先接通，后面换成真实数据时不用再改状态语义。
### 68. 带结构的帮助面板一旦继续挂在 id 级 i18n 覆写表上，初始化时整块 rich content 会被 textContent 直接抹平
- 这次 Scenario Guide 从 4 条短步骤升级成章节式双语手册后，如果还保留 `scenarioGuideStep*` 在 `uiMap` 里，i18n 初始化会把 `<li>` 里的所有子节点整块覆盖掉。
- 更稳的做法是：章节式 manual 用独立容器或独立 renderer，rich content 节点不要继续放进按 id 直接覆写 `textContent` 的翻译绑定表。

### 69. 色板导入完成后，必须单独核对“已导入颜色”和“已审核映射”是不是同一层真相
- 这次 TNO 颜色资产里，`tno.palette.json` 已经导入了 511 条原始颜色，但 `tno.map.json` 的 118 个 mapped TAG 仍完全继承自 `hoi4_vanilla`。
- 更稳的做法是每次导入新剧本色板后，立刻做一轮场景国家清单 vs 色板条目 vs 映射结果的三方核对，先找出“色板有颜色但映射还没审核”的国家，再处理完全缺席的扩展 TAG。

### 70. 继承的 deny_tags 不能压过子剧本里显式确认的 verified 映射
- 这次 TNO 要把 `MAN / MEN / SHX / VIN` 从 inherited vanilla deny 清单里拉出来做 reviewed 映射，如果只叠加 local verified 而不移除 inherited deny，导入器会把它们再次过滤掉。
- 更稳的做法是：子 manual 里显式写入 verified 的 TAG，先从继承 deny 集里剔除，再应用本地 deny，保证“本地确认”优先级高于“父层保守拒绝”。

### 71. reviewed 映射层和 runtime 默认色桥拆开后，生成器与消费端都要同时认同一份白名单语义
- 这次第二波把 30 个 alt-history / regional TAG 推进到 reviewed 映射层后，只有在 `tools/import_country_palette.py`、`scenario_builder/hoi4/crosswalk.py`、`js/core/palette_manager.js` 三处同时尊重 `expose_as_runtime_default=false`，才能避免它们反向接管 `CN / RU / FR` 这类默认桥。
- 更稳的做法是：每次补 reviewed 映射时，同步补一条“生成器输出 + Python 反查 + JS 默认桥”三联保护测试。

### 72. 最后专题项如果依赖非 runtime 锚点，优先保留专题状态，不要为了清零 unmapped 强行并到大国锚点
- 这次 `SIK / TIB / XIK` 暴露的是同一类问题：它们在世界观语义上更像新疆 / 西藏 / 西康专题锚点，当前 runtime-country 体系还没有承接这些 code。
- 更稳的做法是先只收 `PRC / SIC` 这种已经能安全挂到 `CN` 的 overlay，剩余专题项维持 `unmapped`，等自定义 anchor 机制准备好再推进。

### 73. runtime default bridge 一旦引入 `expose_as_runtime_default`，scenario 主地图颜色桥也要同波次切到同一份 canonical 语义
- 这次问题的根因是默认色板已经开始尊重 `palette map + expose_as_runtime_default`，但 active scenario 仍直接吃 `countries.json` 的 tag 色和 `feature_count` 赢家色，结果 `RKM / RAJ` 这类专题 TAG 继续接管 live map 默认色。
- 更稳的最短路径是：default palette、scenario tag 色桥、coarse iso2 bridge 三条链共用同一份 runtime default bridge helper，并在 palette import 阶段强制校验“每个已映射 iso2 至少保留一个 exposed bridge”。

## 2026-04-16 - TNO 颜色桥与场景色边界

### 1. active scenario 的 tag 颜色不能复用 ISO2 runtime default bridge
- runtime bridge 适合 default palette / canonical ISO2 颜色桥。
- TNO 这类一个 ISO2 对应多个 scenario tag 的剧本里，active scenario 直接复用这条桥会把多个国家压成同色，视觉上会像边界和国家分配一起被覆盖。
- 更稳的做法是：active scenario 始终按 `countries.json` 的 tag 显式颜色渲染，runtime bridge 只留给默认 palette 路径。

### 2. TNO 静态颜色修正要放一个最终 audit 对齐口
- `patch_tno_palette_defaults`、regional rules、decolonization、manual overrides 分多步写颜色时，前面步骤对的颜色也可能被后面步骤重新带偏。
- 更稳的最短路径是：在 countries stage 末尾做一次 `tno.audit.json.map_hex -> countries.json.color_hex` 的最终同步，只覆盖 audit 已有明确颜色的 tag。

### 3. palette audit 只能覆盖 palette 优先区，不能一刀切压掉 scenario_extension 的显式色
- 这次第二轮回归暴露的关键问题是：`tno.audit.json.map_hex -> countries.json.color_hex` 的 blanket 同步会把 `PHI / MAL / LAO / ARM / BRG` 这类已有场景规则或代码显式色的国家重新刷回 palette 色。
- 更稳的做法是：最终同步阶段先划分“显式特例保留集”和“palette 优先区”；显式特例继续保留场景源色，palette 优先区再对齐 audit。

### 76. 浏览器 benchmark fallback 在 Windows 上要同时处理 transport、URL 入口和截图路径
- 这次真正卡住 benchmark 的不是单一 open 失败，而是三层问题叠加：wrapper open 不稳、根路径 `/?...` 和真实 `/app/?...` 入口混用、本地 screenshot 继续按 bash path 写入时会落错盘。
- 更稳的最短路径是：benchmark 内部同时准备 wrapper + local node-playwright 两条 transport，URL 候选默认补 `/app/` 版本，本地 fallback 写截图时直接用 Windows 原生绝对路径。

### 77. chunked runtime 的 coarse prewarm 一旦算进 time-to-interactive，首帧指标会被整段放大
- 这次 `tno_1962.timeToInteractive` 从约 2554ms 降到约 731ms，关键动作就是把 `preloadScenarioCoarseChunks()` 从 `runPostScenarioApplyEffects()` 的同步等待里挪到首帧后异步调度。
- 更稳的最短路径是：首帧只做 coarse 可见必需链，chunk prewarm 放到首帧后后台推进，指标里再单独量它自己的 ready 时间。

### 78. benchmark 串味收口后，如果 HOI4 首帧仍然接近 12s，就该直接盯 `drawPoliticalPass`
- 这次把 palette 快路径和 HOI4 Far East backfill 缓存接上后，`hoi4_1939.timeToInteractive` 只从约 12692ms 降到约 11943ms，说明 apply 前置链确实有成本，但不是最大头。
- 更稳的判断是：首帧主瓶颈已经收口到 `drawPoliticalPass`，下一刀优先切 `drawPoliticalBackgroundFills()`，再看逐要素 fill/stroke。

### 79. 只要 scenario 已有 chunked political runtime，apply 前就别再强等 detail topology
- 这次 `hoi4_1939.timeToInteractive` 从约 11943ms 直接压到约 1406ms，最大收益来自：在 `prepareScenarioApplyState()` 里确认场景已有 chunked political runtime 后，跳过 apply 前那条 detail promotion 等待链。
- 更稳的最短路径是：chunked political runtime 负责 coarse 首帧，detail topology 留给后续 promotion；不要把两套“政治细节可见”机制串联成一个同步门槛。

### 41. benchmark 汇总层必须把“same-scenario fresh metric”当成硬门槛
- 只要 perf report 会跨场景串行跑多套 suite，`timeToInteractive` 这类主指标就不能再用“最新一条看起来像新的 metric”偷懒汇总。
- 更稳的最短路径是：每条 metric 同时校验 `requestedScenarioId`、`activeScenarioId`、metric 自带的 `scenarioId/activeScenarioId` 和 `recordedAt`，缺口直接暴露成 `present=false`。
- 这样文档里的性能结论才能和同时间窗 JSON 对得上，避免 fallback 把旧场景或旧阶段数据混进新结论。

### 42. full-pass Canvas 背景合批要缓存“可重放结果”，只缓存 entry 列表收益不够
- scenario political background 如果每次重画都重新分组、重建 `Path2D.addPath()`，热点只会从 feature loop 挪到背景合批。
- 更稳的做法是把 full pass 的分组结果和 merged path 作为 durable cache 留下来，并把失效边界收紧到 scenario/runtime/color/transform/path-cache 签名。
- 这样 exact-after-settle 和重复 full redraw 才能真正复用同一批背景路径。

### 43. benchmark 主动触发型指标必须满足运行时前置条件，探针本身也要和产品逻辑同构
- `settleExactRefresh` 这类指标只调用 schedule 函数还不够，相关 state flag 也要进入“待执行”状态，metric 才会真正落盘。
- `zoomEndToChunkVisible` 这类指标还受 `detail_zoom_threshold` 约束；如果 benchmark zoom 根本没跨过阈值，就算代码没问题，报告也只会一直 `present=false`。
- 更稳的最短路径是：先把产品里真正触发该指标的前置状态复刻到 benchmark，再讨论汇总层要不要补 fallback。

### 44. 视觉阶段指标和 runtime 收尾指标要分开看，用户体感优先用 visual stage
- `scenarioChunkPromotionVisualStage` 已经能代表“首批 detail 真正可见”，而 `lastZoomEndToChunkVisibleMetric` 这类 runtime 记账经常会更晚，因为它会包含后续提交或收尾时机。
- 如果 benchmark 目标是用户感知到的可见时间，汇总层应优先采用 visual stage；runtime 记账更适合做链路诊断。
- 否则会出现“产品其实已经变快了，但报告还在读更晚的内部事件”的假慢。

### 80. 首帧 coarse gate 和 post-frame detail prewarm 必须拆成两条显式合同
- 这次红测和实现漂移的根因是把“调用方必须等待的首帧 coarse prewarm”和“首帧后的 detail cache 预热”揉成了同一个 helper，还用 `mode=sync/async` 偷渡语义，结果调用点看起来在 `await`，异步路径却没有真正等待首帧合同。
- 更稳的最短路径是：先 `await` coarse first-frame ready，再把 detail prewarm 放到 post-frame 路径；如果 detail prewarm 只写 cache，不直接 apply runtime，就要在成功后显式补一次 `scheduleScenarioChunkRefresh(...)`。
- perf metric 也要按一次 run 重建，不能沿用 merge 写法残留上一次的失败或 detail 字段。

### 81. 内部 loader 模块首轮下沉时，先抽纯加载合同和 metadata helper，facade 继续持有 active state / UI side effect
- 这次 `scenario_resources -> scenario/shared + scenario/bundle_loader` 的最稳切法，是先把 registry、baseline compare、runtime shell contract、chunked-runtime 判定这类纯加载 helper 抽走，再让 facade 继续持有 `state`、`syncScenarioUi()`、optional layer apply、hydrate、health gate。
- 如果一开始就把 active state 写回和 UI 同步一起搬进 loader，新模块会立刻跨进运行态事务，边界会重新糊掉。
- 更稳的最短路径是：新模块优先用 dependency injection 或低层 import，只保留单向依赖；facade 继续做对外 export 和副作用收口。

### 91. 边界测试如果把 helper 所有权钉死在 donor 文件上，模块下沉后会先炸测试，再误导重构判断
- 这次把 startup bundle 组装和 compaction helper 从 `scenario_resources.js` 下沉到 `scenario/bundle_loader.js` 后，旧静态断言还在 donor 文件里找 `normalizeIndexedTagAssignmentPayload`，结果代码边界已经更清楚，测试却先报红。
- 更稳的最短路径是：边界测试继续守住 facade export 和 wiring，同时把“具体 helper 属于哪个模块”的断言迁到新的 owner 文件，避免测试把合理拆分误判成回归。

### 92. 对超大 donor 文件做批量文本替换时，先锁定更窄上下文，再动同名局部变量
- 这次为了从 `loadScenarioBundle` 里删掉一个死变量，直接按整行替换 `const hints = normalizeScenarioPerformanceHints(manifest);`，顺手把 `applyScenarioPerformanceHints()` 里的同名局部变量也删掉了，静态语法检查照样会过，运行时才会炸。
- 更稳的最短路径是：先用函数级上下文或 AST 级匹配锁定目标块，再做替换；改完后要顺手 grep 同名局部变量的剩余位置，避免 donor 文件里多个相似片段互相误伤。

### 93. 当 runtime controller 和 loader helper 共享同一份单例状态时，用 late-bound 回调接线最稳
- 这次 `chunk_runtime.js` 里的 controller 需要调用 `ensureScenarioChunkRegistryLoaded(...)`，而 registry ensurer 自己又依赖 `ensureRuntimeChunkLoadState()`；这是一条天然的初始化环。
- 更稳的最短路径是：让 facade 先创建 controller，再把 `ensureScenarioChunkRegistryLoaded` 用闭包回调晚绑定进去。这样单例 state 仍然只有一份，模块之间也能继续保持单向 import。

### 94. 当 hydrate controller 需要回调 facade 的 load 函数时，也用晚绑定保住出口稳定
- 这次 `startup_hydration.js` 里的 `ensureScenarioGeoLocalePatchForLanguage()` 和 `enforceScenarioHydrationHealthGate()` 都需要回调 `loadScenarioBundle()`，如果直接反向 import `scenario_resources.js`，模块边界会立刻重新缠回去。
- 更稳的最短路径是：controller 只吃 `getLoadScenarioBundle()` 这种晚绑定依赖，facade 在函数定义完成后再把本地 `loadScenarioBundle` 填进去。这样对外出口不变，内部依赖方向也保持单向。

### 95. apply pipeline 下沉后，旧边界测试要改成“事务 owner”和“状态 owner”两层断言
- 这次把 `prepareScenarioApplyState()` 和 staged state commit 从 `scenario_manager.js` 挪到 `scenario_apply_pipeline.js` 后，旧测试里那种“字符串还在 donor 文件里”断言会把正常拆分误判成回归。
- 更稳的最短路径是：一层测试守 `scenario_manager` 继续拥有 single-flight、rollback、fatal recovery 和公开入口；另一层测试守新 owner 文件继续拥有 staged state commit、countryNames 选择、chunk runtime 激活和 localization 写入。

### 96. 模块下沉后，facade 的本地 wrapper 和新 import 必须先做符号去重
- 这次 `scenario_manager.js` 里保留了本地 `getScenarioDefaultCountryCode()` wrapper，同时又直接 import 了同名符号；`scenario_resources.js` 里也出现了本地 helper 和 startup hydration 解构结果同名，结果模块在解析阶段就直接炸掉。
- 更稳的最短路径是：下沉后统一采用 `import { foo as loaderFoo }` 或 `const { foo: fooFromController } = ...` 这类显式别名，再由 facade 决定是否保留本地公开名。

### 97. 提取 controller 时，旧 donor 文件里继续会用到的 helper 依赖要显式注入到新模块
- 这次 `startup_hydration.js` 在 donor 文件里原本依赖 `areScenarioFeatureCollectionsEquivalent()`，下沉后如果没有把它一起迁走或显式注入，运行到 hydrate fallback 分支就会直接 `ReferenceError`。
- 更稳的最短路径是：提取 controller 时逐条核对自由变量，能留在 donor 的 helper 就通过依赖注入传入；需要变成 owner 的 helper 就同波次搬走，并补 owner-file 边界测试。

### 98. UI 大文件首刀先拆“闭环面板”和“纯错误处理”，toolbar 继续保留 state callback 注册
- 这次 `toolbar.js` 第一批最稳的切口是 `export_failure_handler` 和 `palette_library_panel`：前者纯错误分类，后者是完整的色板库面板闭环；这两块下沉后能立刻减轻 donor 文件，又不会碰 guide/export overlay 的跨面板仲裁。
- 更稳的最短路径是：新模块接管面板内部 DOM 与局部逻辑，`toolbar.js` 继续保留 `state.updatePaletteSourceUIFn / state.updatePaletteLibraryUIFn / state.renderPaletteFn` 这类全局 callback 注册和主初始化编排，再用静态 owner/facade 测试钉住边界。

### 99. overlay 类 UI 第二刀先拆“面板内部闭环”，把跨 surface 仲裁和 URL restore 留在 toolbar facade
- 这次 `scenario guide` 最稳的切法是：把 section/status 渲染、guide 按钮同步和面板自己的事件绑定下沉到 `scenario_guide_popover.js`，同时把 `toggleScenarioGuidePopover / closeScenarioGuidePopover / restoreSupportSurfaceFromUrl` 继续留在 `toolbar.js`。
- 更稳的最短路径是：新模块只知道 guide 自己的 DOM 和小范围 UI helper，`toolbar.js` 继续统一处理 dock/export/special-zone 的互斥、focus return 和 URL state，这样拆分后最不容易引入 overlay 互相打架的回归。

### 100. special zone 这类编辑面板要把“面板闭环”和“popover 外壳”分两层拆
- 这次 `special_zone_editor.js` 最稳的切法是：新模块接管 `styleConfig.specialZones` 归一、manual zone 列表渲染、start/undo/finish/cancel/select/delete 事件绑定，`toolbar.js` 继续保留 `openSpecialZonePopover / closeSpecialZonePopover` 和全局 dismiss。
- 更稳的最短路径是：让编辑器模块只关心自己的表单和 core action wiring，把 overlay 打开关闭、focus restore、与 guide/export 的互斥留在 toolbar facade，这样拆分后保存链和交互链都更稳。

### 101. export workbench 这类大面板要先抽 controller，再保留 toolbar 的 overlay facade
- 这次 `export_workbench_controller.js` 最稳的切法是：新模块接管 `exportWorkbenchUi` 归一、layer/text list、preview、bake/export 动作和 workbench 内部事件绑定，`toolbar.js` 继续保留 `setExportWorkbenchState()`、URL handoff、focus return 和与 guide/dock/transport 的互斥协调。
- 更稳的最短路径是：先把面板内部闭环整块收进 controller，再让 toolbar 只负责 support surface 的壳层协调；这样既能明显减小 donor 文件，又能保住 `view=export` 恢复链和 overlay 互斥合同。

### 102. 抽离闭环 UI controller 时，owner 的 schema/default/state helper 要整块同迁
- 这次 `transport_workbench_controller.js` 拆出后，`ROAD_CLASS_OPTIONS`、`TRANSPORT_WORKBENCH_CONTROL_SCHEMAS`、`ensureTransportWorkbenchUiState()` 这一整块 owner 代码留在 donor 外面，结果 `createTransportWorkbenchController()` 在构造期就直接 `ReferenceError`。
- 更稳的最短路径是：先按“模块自己是否直接引用”收口 top-level 常量、默认配置、normalizer 和 state initializer，再做 facade wiring；拆完后至少跑一次 owner-file 的自由变量检查和构造期 smoke。

### 103. UI 面板拆分时，texture 和 dayNight 这种相邻功能也要按真实事务语义分组
- 这次 texture 和 dayNight 都在 appearance 面板里，看起来很像一组控件，但它们的事务语义不同：texture 有 `input` 预览加 `change` history commit，dayNight 只有实时 renderDirty。
- 更稳的最短路径是：可以把它们下沉到同一个 owner controller，但要继续保留两套输入语义，不能为了“统一 binder”把 history 行为混平。

### 104. 当一个独立 editor 仍然嵌在大面板里时，toolbar 继续保留 host wrapper 最稳
- 这次 `city/urban/physical/rivers` 下沉后，`special_zone_editor` 仍然要和 appearance 面板一起刷新。直接让两个 controller 互相知道对方会把边界重新搅混。
- 更稳的最短路径是：让 owner controller 只管自己的字段和事件，`toolbar.js` 保留一层 `renderSpecialZoneEditorUI` host wrapper，把 appearance owner、special zone owner、updateToolUI 串起来。

### 105. UI owner 下沉时，微型 history helper 要和事件绑定一起迁走
- 这次 lake controls 的真实风险点是 `beginLakeHistoryCapture()` / `commitLakeHistory()` 只有调用点，没有实现；静态 syntax 和大部分 boundary test 都能过，真实交互一触发就会炸。
- 更稳的最短路径是：凡是 event handler 里用到的 `before/after` history helper、style path 列表、pending state 变量，都和绑定逻辑同波次迁到 owner controller，并补一条 owner/facade 边界测试钉住它。

### 106. 大型 inspector 拆分时，先让 donor 保留 runtime 容器，再把 owner 逻辑下沉
- 这次 `country inspector` 同时被 list、detail、preset tree、scenario actions 共用，`latestCountryStatesByCode`、row refs、color picker open 这种运行态容器如果一刀切离开 donor，会立刻放大引用改动面。
- 更稳的最短路径是：先让 `sidebar.js` 保留这些 runtime 容器，通过 getter/setter 注入给新 controller，把 owner 逻辑先下沉；等 facade 稳住后，再决定要不要继续把容器和 scenario actions 一起迁走。
### 41. strategic overlay 的 history snapshot 要把 `operationalLines` 和 dirty flag 一起纳入
- `captureHistoryState({ strategicOverlay: true })` 如果只收 `annotationView / operationGraphics / unitCounters`，operational line 的 create/update/delete 就会在 undo/redo 后出现假恢复。
- 拆 strategic overlay owner 前，先把这条合同当成显式红线；owner 可以先下沉，history 缺口要单独补齐并加静态断言。
### 42. project import owner 可以下沉，但 overlay invalidation hook 必须继续显式注入
- project import / export 迁到独立 controller 后，`importProjectThroughFunnel` 这条链仍然要拿到 `invalidateFrontlineOverlayState`，不然 strategic overlay 的缓存会在导入后滞后。
- 更稳的做法是让 donor 继续持有 facade 和 hook 来源，controller 只消费注入的 callback。

### 107. 大块搬走 UI owner 时，要先点名 donor 里仍然复用的 shared helper
- 这次 `Scenario Tag Creator` 首轮抽离时，批量删掉 tag creator 旧代码时顺手把 `resolveOwnershipTargetIds`、`resolveOwnershipEditorModel`、`collectScenarioCountryOptions` 这类别的 editor 还在用的 shared helper 一起抹掉了。
- 更稳的最短路径是：先列出 donor 内剩余调用点，再按 “owner-only / shared” 两类切；shared helper 继续留 donor 或单独抽公共模块，最后再做删除。

### 108. controller 下沉后，selection 和快捷条上的 donor 绑定要单独复核
- 这次 `selection_ownership_controller` 拆出后，ownership 本体接线是通的，但 `devQuickRebuildBordersBtn`、selection sort、copy 按钮这些仍归 donor 持有的绑定被顺手删掉了。
- 更稳的最短路径是：拆 owner 前先把按钮分成 “owner 控件” 和 “donor 控件”，然后在边界测试里显式钉住 donor 侧还要继续保留的事件绑定。

### 109. 宿主 panel 的 DOM 引用和 category 显隐合同要成对保留
- 这次 `scenario_text_editors_controller` 下沉后，`scenarioCountryPanel / scenarioCapitalPanel / scenarioLocalePanel` 的宿主 query 被删掉了，但 donor 里的 `syncCategoryPanel(...)` 还在继续用，`renderWorkspace()` 首次执行就会直接炸。
- 更稳的最短路径是：只要 donor 还负责 category 显隐，它就必须继续持有对应的 panel 引用；或者把显隐逻辑和 panel 引用一起整组迁进 controller，并在边界测试里固定这条宿主合同。

### 110. 带有 draft model 和模板保存链的 editor，拆分时要把整条事务链一起迁走
- 这次 `district_editor_controller` 最稳的切法，是把 `state.devScenarioDistrictEditor`、draft tag 归一、selection assign/remove、district save、shared template save/apply 一整组 owner 逻辑一起下沉。
- 更稳的最短路径是：让 donor 只保留宿主 panel 显隐、`renderWorkspace()` 总编排和 controller 装配，把带有本地事务状态的 editor 当成一个完整闭环迁走，再用边界测试钉住 mesh rebuild、manifest url 回写和 facade 合同。

### 111. 大型宿主壳拆分时，DOM builder 和 dock chrome 要同波次迁走
- 这次 `dev_workspace.js` 最后一刀里，`createDevWorkspacePanel`、`createDevWorkspaceQuickbar`、toggle button 文案和 dock collapsed 同步本来就是同一层宿主职责。
- 更稳的最短路径是：把这组 panel/quickbar builder 和 expand chrome helper 一起迁进 `dev_workspace_shell_builder.js`，让 donor 继续保留 `initDevWorkspace`、`renderWorkspace`、持久化和 state facade。

### 112. 纯配置模块拆分时，先做 compat re-export，再补跨文件合同测试
- 这次 `state.js` 拆出 `state_defaults.js` 时，外部大量模块还在直接从 `state.js` import `PALETTE_THEMES`、`normalize*` 和 workbench helper。
- 更稳的最短路径是：先让 donor 继续 re-export 新模块，再补边界测试覆盖旧 import 面和新 owner 文件，最后再做更深的入口收口。

### 113. donor 自己在初始化期要用到的 defaults，必须继续显式 import
- 这次 `state.js` 拆分后，`defaultZoom` 已经迁到 `state_defaults.js`，但 donor 里还有 `zoomTransform: defaultZoom` 这条初始化引用，少掉本地 import 就会在模块求值阶段直接炸。
- 更稳的最短路径是：凡是 donor 初始化时直接读到的默认值，都继续保留显式 import；`export *` 只负责对外转发，不能代替 donor 自己的本地绑定。

### 114. 启动壳拆分时，先搬纯 startup helper，再让 main.js 保留状态推进
- 这次 `main.js` 最稳的切口，是把默认场景解析、startup bundle URL 组装、启动审计、视图设置持久化和 startup diagnostics 先迁进 `startup_bootstrap_support.js`。
- 更稳的最短路径是：让 `main.js` 继续保留 boot overlay、phase 进度、readonly 切换和最终 `bootstrap()` 顺序，把纯 helper 先收走，再用边界测试钉住 facade。

### 115. 启动 overlay 拆分时，用 controller 收住内部句柄最稳
- 这次 `main.js` 的 boot overlay 层里，`continue handler`、progress animation handle、readonly unlock handle 和 boot metrics log flag 都是内部句柄，直接散在 donor 里会继续撑大主文件。
- 更稳的最短路径是：把这些内部句柄收进 `startup_boot_overlay.js` 的 controller，让 `main.js` 只拿 `setBootState / startBootMetric / setStartupReadonlyState` 这类方法，外部 facade 更稳定。

### 116. donor 读取 controller 内部常量时，要改成显式 API
- 这次 `main.js` 把 `BOOT_PHASE_WINDOWS` 和 `bootMetricsLogged` 收进 `startup_boot_overlay.js` 后，donor 里仍然直接读取旧名字，启动期就会立刻抛 `ReferenceError`。
- 更稳的最短路径是：把这类内部状态改成 controller API，例如 `getBootProgressWindow()`，同时让 controller 自己在 `resetBootMetrics()` 里重置内部标记。

### 117. 文件拆分计划的验证矩阵要分成“文件存在”和“已跑通”两层
- owner 文件、donor 接线、测试文件落地，只说明结构已经到位；真实执行通过需要单独记测试名、日期和产物路径。
- 如果这两层混在一个勾选里，计划会同时出现“代码已经做完但文档全红”和“测试没跑却看起来像完成”的双重漂移。

### 118. 多日拆分推进要按自然日期留进度，不能把后续提交混写进旧日期块
- 文件拆分这类连续任务会跨多天推进，进度记录必须按当天新增内容分块写。
- 这样回看时才能直接对应提交、勾选和真实验收证据，避免主计划失去 source of truth 价值。

### 119. 启动链连续报 boot overlay 卡死时，先用浏览器直开抓首个阻断级脚本错误
- Playwright 超时只会告诉你“没 ready”，真正的首错常常是一串被前一个错误遮住的语法或绑定缺口。
- 更稳的顺序是：浏览器直开 localhost，拿到当前第一条 blocking error，再按模块求值顺序一层层清理，直到 boot 能稳定到 Ready。

### 120. 大文件拆分后，导出面和 wiring 缺口会沿启动链串联放大
- 这次 `main.js`、`scenario_resources.js`、`interaction_funnel.js`、`scenario_manager.js`、`toolbar.js` 连续暴露的都是真实的 symbol/export/wiring 缺口。
- 更稳的最短路径是：每做一刀 owner 下沉后，立刻补 `node --check`、边界测试、再用浏览器直开过一遍 startup，尽早在模块加载阶段把缺口炸出来。

### 121. boot overlay 的测试等待条件要以真实 boot state 为准，不能只盯 overlay hidden/aria-busy
- 这次应用已经到 Ready，但 `#bootOverlay` 仍保留在 DOM 里，`aria-busy` 也没及时回落，导致 Playwright 一直误判成“未就绪”。
- 更稳的最短路径是：等待 `state.bootBlocking === false` 或 `body.app-booting` 已移除，并同时确认 `!state.scenarioApplyInFlight`；overlay hidden 只作为兼容条件，不要当唯一标准。

### 122. render helper 拆分时，dirty/signature/history owner 继续留在 donor 最稳
- 这次 strategic overlay 第二刀里，leaf draw helper 可以下沉到 `strategic_overlay_helpers.js`，但 `render*IfNeeded()`、overlay signature cache、dirty flag 和 history transaction 继续留在 `map_renderer.js`，编排边界更清晰。
- 更稳的最短路径是：owner 只接管 SVG leaf draw 和 zoom-scale patch，donor 继续持有 render kernel、frontline derived overlay、dirty/signature gate 与对外 facade。

### 123. 启动链 data pipeline 可以下沉，但 boot 编排必须继续留在 main
- 这次 `startup_data_pipeline.js` 最稳的切法，是把 startup bundle 解析、base data 加载、context layer deferred load、localization/city 补水和 primary collection decode 下沉成 owner。
- 更稳的最短路径是：`main.js` 继续持有 boot overlay、render boundary、scenario apply、ready/readonly/detail promotion 顺序，把数据装配和 state hydrate 交给 owner。

### 124. startup scenario boot 拆分时，bundle apply recovery 可以下沉，ready-state 编排继续留在 main
- 这次 `startup_scenario_boot.js` 最稳的切口，是把 `scenario-bundle` metric、startup bundle apply、legacy bootstrap fallback 和 `scenarioApplyInFlight` 事务收成一个 owner。
- 更稳的最短路径是：`main.js` 继续保留 deferred UI bootstrap、render wiring、warmup flush、`finalizeReadyState()` 和顶层 error/continue facade，让 scenario boot 模块只处理默认场景启动事务。

### 125. detail promotion 拆分时，transaction 可以下沉，ready-state 分支判断继续留在 main
- 这次 `deferred_detail_promotion.js` 最稳的切口，是把 detail topology load、readonly unlock 重试、idle promote 调度和内部句柄收成一个 owner。
- 更稳的最短路径是：`main.js` 继续保留 `finalizeReadyState()`、boot shell 和 warmup/ready 编排，让 owner 专注处理 detail promotion transaction。

### 126. state singleton 拆分时，优先下沉默认 state slice factory，再让 donor 保留单例壳
- 这次 `state_catalog.js` 最稳的切口，是把 releasable catalog 和 scenario audit 的默认形状收成纯 factory，让 `state.js` 继续负责 singleton 和 compat re-export。
- 更稳的最短路径是：owner 提供 `createDefault*` factory，`scenario_ui_sync.js` 和 `scenario_manager.js` 也复用同一份 factory，避免默认形状在多个文件里漂移。

### 127. runtime hook 拆分时，要把“已声明的 hook”和“运行时动态挂上的 hook”一起显式化
- 这次 `runtime_hooks.js` 最稳的切口，是把 `state.js` 里现有的 hook 槽位和 `toolbar.js` / `sidebar.js` / `dev_workspace.js` / `main.js` 运行时会挂上的 hook 一起收成默认 shape。
- 更稳的最短路径是：owner 提供一份完整 hook surface，donor 继续保留 singleton；这样模块接线和 e2e 依赖的 state shape 都更稳定。

### 128. URL 状态拆分时，query helper 下沉，restore 编排继续留在 support-surface controller
- 这次 `ui_surface_url_state.js` 最稳的切口，是把 support surface 和 scenario guide 的 URL 读写 helper 收成 owner，让 `toolbar.js` 和 `workspace_chrome_support_surface_controller.js` 只消费同一套接口。
- 更稳的最短路径是：owner 只处理 query 解析和回写，support surface 的打开关闭、focus return、overlay 协调继续留在 controller。

### 129. donor import 面收窄后，旧边界测试要同步改成 owner 接线合同
- 这次 `main.js` 把 `scenario_resources.js` 依赖下沉到 startup owner 后，旧测试还继续要求 donor 直接 import 资源模块，结果 review 阶段才暴露红灯。
- 更稳的最短路径是：一旦 donor 只保留 facade、owner 接管真实依赖，就把边界测试同步改成“owner 持有 import、donor 不再直连”的合同。

### 130. Playwright 里的 source-level 合同检查要优先读 repo 文件，不要依赖页面 fetch 当前源码
- 这次 `physical_layer_regression.spec.js` 的静态断言一开始从浏览器侧 `fetch("/js/...")` 读源码，结果 donor/source of truth 迁移后，排查路径被 dev server 状态和旧假设一起搅乱。
- 更稳的最短路径是：source-level 合同直接在 Node 侧用 `fs.readFileSync(...)` 读取仓库文件，再把真正的运行态断言留给页面交互和 canvas snapshot。

### 131. clear 场景时，detail ready 状态要看 `topologyDetail`，不要拿 runtime topology 代替
- startup coarse 模式也可能已经有 `defaultRuntimePoliticalTopology`；它只说明 runtime political baseline 在，不能说明 detail promotion 已完成。
- 更稳的最短路径是：`clearActiveScenario()` 恢复 base map 时，用 `state.topologyDetail` 判断 `topologyBundleMode` 和 `detailPromotionCompleted`，再用 `defaultRuntimePoliticalTopology && !topologyDetail` 恢复 `detailDeferred`。
- 这样退出 scenario 后，deferred detail promotion 还能继续按原计划执行。

### 132. 拆 bundle/cache owner 时，让 facade 继续持有对外 export 和 getter 桥接最稳
- `loadScenarioBundle`、bootstrap cache probe/write、cache-hit restore 很适合下沉成独立 owner。
- 更稳的最短路径是：`scenario_resources.js` 继续保留对外 import 面、`loadScenarioBundleForStartupHydration` 这类 getter 桥接，以及 audit/startup hydration 接线；新 owner 只接管主交易。
- 这样 startup hydration、UI 和外部调用方都不用改 import 路径，回归面最小。

### 133. strategic overlay 默认形状要有单一真源，尤其是 `unitCounterEditor`
- `state.js`、project import reset、renderer fallback 三条路径很容易各写一份默认对象，字段一多就会漂。
- 更稳的最短路径是：把 `specialZoneEditor / operationGraphicsEditor / unitCounterEditor / operationalLineEditor / strategicOverlayUi` 收成同一组 factory，然后让 `state.js`、`interaction_funnel.js`、`map_renderer.js` 全部复用。
- `unitCounterEditor` 至少要统一守住 `presetId / iconId / layoutAnchor / attachment / returnSelectionId` 这组字段。

### 134. scenario runtime 默认 shape 也要让 reset / rollback / health 共用同一组 factory
- `activeScenarioChunks`、`runtimeChunkLoadState`、`scenarioDataHealth`、`scenarioHydrationHealthGate` 这种状态会同时出现在 cold init、chunk reset、clear、rollback、health fallback。
- 更稳的最短路径是：把它们收成 `scenario_runtime_state` factory，然后让 `state.js`、`chunk_runtime.js`、`lifecycle_runtime.js`、`scenario_rollback.js`、`scenario_data_health.js` 统一复用。
- 这样一处新增字段时，chunk runtime、rollback 和 clear 路径都会一起跟上。

### 41. map_renderer 后续拆分先抽 mesh builder，再动 draw 和 render pass
- owner border、source border、coastline source 这类“输入 topology，输出 mesh”的 helper 很适合先下沉成 owner；draw pass、render invalidation、viewport 驱动延迟加载继续留在 donor，回归面最小。
- 这样可以先把几何生成链和 transaction/render 链切开，再决定下一刀是否继续拆 `drawHierarchicalBorders`。
### 42. border draw 拆分先搬纯 helper，draw 主体后移一刀更稳
- `drawMeshCollection`、viewport-aware coastline simplify、boundary mesh transform 这类纯绘制 helper 很适合先下沉到独立 owner；`drawHierarchicalBorders()` 主体里还带着 detailAdm 调度、parent border 缓存和 scenario_owner_only 警告链，继续留 donor 回归面更小。
- 这样可以先把 canvas helper 和 draw transaction 分开，再在下一刀单独处理 `drawHierarchicalBorders()` 主体。
### 43. drawHierarchicalBorders 主体下沉时，要把共用 coastline simplify 链继续收口在 donor facade 上
- `drawHierarchicalBorders()` 和 `drawTnoCoastalAccentLayer()` 共用 `getViewportAwareCoastlineCollection()` 时，最稳的做法是让 donor facade 保持唯一入口，owner 通过同一条 wrapper 取结果。
- 这样可以避免主描边和 accent 层在同一缩放级别出现 coastline LOD 漂移。
### 44. interaction border snapshot 这类“离屏缓存小事务”适合独立 owner，drawBordersPass 继续留 donor
- snapshot 的 layout、canvas、capture、draw、invalidate 属于一组很完整的局部事务，抽成 owner 后边界很清楚。
- `drawBordersPass()` 继续留在 donor，可以保证 snapshot 和主渲染共用同一条 border pass 入口，运行态更稳。
### 45. spatial/index runtime 拆分时，索引构建可以下沉，runtime refresh 交易继续留 donor
- `buildIndex`、`buildSpatialIndex`、chunked 版本和 secondary spatial 这类“只重建交互索引”的函数很适合集中进 owner。
- `rebuildRuntimeDerivedState()` 同时处理 runtimePoliticalMeta、color sanitize、projected bounds cache 和 UI refresh，这类跨多个状态面的交易继续留在 donor 更稳。

### 41. 抽 shared presentation owner 时，要把 stateless parser 和 stateful runtime 一起分层
- 这次 `normalizeScenarioPerformanceHints` 既被资源/预热链消费，也被激活事务消费；只搬走 stateful helper 会先把 resources 里的 live consumer 打断。
- 更稳的最短路径是：shared 文件同时导出 stateless parser 和 stateful runtime controller，manager 负责事务调用，resources 继续消费 parser。

### 42. startup runtime topology baseline 不能在 scenario apply 里二次播种
- 这次 clear blank baseline 漂移的根因，是 scenario_apply_pipeline.js 把 defaultRuntimePoliticalTopology 从场景 runtime 里补写了一次，导致退出场景后 blank 底图被 scenario runtime 污染。
- 更稳的最短路径是：startup baseline 只在 startup 链建立；scenario apply 只消费它，不能回写它。
- 遇到这类 clear/revert 漂移，优先抓两次基线的 untimePoliticalTopology / defaultRuntimePoliticalTopology / landDataFull 计数对比，很快能定位污染源。

### 135. 做 state owner 拆分时，合同测试要直接封住 consumer 里的第二份默认 shape
- 只检查 donor import owner、只检查某些 reset 路径复用 factory 还不够；`chunk_runtime.ensureRuntimeChunkLoadState()` 这类 consumer 很容易继续藏一份 inline fallback 默认对象。
- 更稳的最短路径是：合同里同时校验 owner factory 命中、consumer 不再内联完整默认 shape、关键字段只在 owner 真源里定义一次。

### 136. renderer runtime / border cache / spatial index 要按“默认 shape + 复位点”一起收口
- 只把 `state.js` 里的大对象搬进 owner 还不够，`map_renderer.js`、`sidebar.js`、`spatial_index_runtime_owner.js` 里的 fallback / reset 也要一起切到同一组 factory。
- 更稳的最短路径是：把 `renderPassCache`、`sidebarPerf`、projected-bounds cache、border cache、spatial index 都收成小 factory，再让 renderer 的 reset/fallback 直接复用。

### 137. opening-owner mesh 的 mesh-pack 直用路径要和 runtime fallback 路径分开判断
- `opening_owner_borders` 已经在 mesh pack 里存在时，`refreshScenarioOpeningOwnerBorders()` 只需要场景模式和 mesh 可用；runtime fallback 才需要 `scenarioBaselineOwnersByFeatureId`。
- startup/bootstrap 到 full hydrate 的窗口里，mesh pack 和 baseline owners 很容易不同步；把两条路径绑在同一个条件里，缓存会被错误清空成 `null`。

### 138. startup 场景 ready 判定要包含 opening-owner cache，就绪条件只看 mesh pack 会放过半完成状态
- `activeScenarioMeshPack.meshes.opening_owner_borders` 已到位，只说明资源到了；真正绘制 `scenario_owner_only` 依赖的是 `cachedScenarioOpeningOwnerBorders`。
- `waitForAppInteractive()`、`ensureScenario()` 和 startup full hydrate 的轻量测试应该至少有一层把 opening-owner cache ready 纳入断言，否则 blocker 会从断言失败漂成 startup timeout。

### 139. Playwright 的 `waitForFunction(async ...)` 会把 Promise 本身当成 truthy，ready gate 必须改成同步轮询
- 这次 `waitForAppInteractive()` 和 `scenario_boundary_regression` 都用了 `page.waitForFunction(async () => ...)`，结果 gate 提前放行，表面像 runtime 状态漂移，实际是测试自己没等到。
- 更稳的最短路径是：先在页面里挂住 live state 引用，再让 `waitForFunction(() => ...)` 同步读取；一旦 `bootError` 有值，立即早失败。
- 这种坑会直接把 startup boot、scenario apply、opening-owner 这类异步链的真实问题藏起来，必须用 source contract 锁住。

### 140. 收紧 namespace import 时，要把仍然向 controller 传递的 helper bag 一起显式化
- 这次把 sidebar 的 `mapRenderer` namespace import 改成 named import 后，真正的运行时缺口出在 controller 依赖的 helper bag 还需要一个 `mapRenderer` 对象。
- 更稳的最短路径是：把 controller 真正命中的 renderer 方法收成局部 Object.freeze({...}) helper，再把 app 文件本体继续保持 named import。

### 141. 把 read helper 下沉到 owner 时，要把原本顺手做的 state 初始化副作用一起带走
- 这次 getUnitCounterPreviewData() 迁进 strategic overlay runtime owner 后，最先丢的不是返回值计算，而是 nsureUnitCounterEditorState() 这类播种和归一化副作用。
- 更稳的最短路径是：只要公开 facade 过去会顺手初始化 editor state，owner 版实现也要先保住这层副作用，再谈纯读 helper。

### 142. strategic overlay 的浏览器回归要对齐真实 DOM 壳层，不要继续假设旧的 Frontline tab
- 这次 smoke 暴露的真实问题，是页面已经切到 `Project` panel + `#frontlineProjectSection` 结构，旧 spec 还在找 `#inspectorSidebarTabFrontline`。
- 更稳的最短路径是：先用当前 DOM 真相重写 open helper，再让 full regression 继续复用这层 helper。

### 143. project roundtrip full regression 里，schema 和 annotationView 断言要跟着真实导出契约走
- 这次 roundtrip 先被 `schemaVersion === 19` 卡住，随后又被 annotationView 新字段卡住，问题都出在 spec 继续硬编码旧导出形状。
- 更稳的最短路径是：schemaVersion 跟当前 source of truth 对齐，annotationView 用 `toMatchObject(...)` 约束关键字段，把完整深比较留给真正需要的 payload。

### 144. strategic-only roundtrip regression 适合直连 import transaction，不必绑死 file input 壳层
- 这次 `strategic_overlay_roundtrip.spec.js` 真正想守的是 operational line 和 counter attachment 的持久化关系，不是 project upload 控件本身。
- 更稳的最短路径是：导出仍走真实 download，导入直接用 `importProjectThroughFunnel(new File(...))`，把 file input 交互留给更通用的 `project_save_load_roundtrip.spec.js`。

### 145. Playwright 遇到 hidden overlay 拦截点击时，优先走 DOM 侧 value+event 驱动
- 这次 `frontlineEnabledToggle` 的真实问题不是控件不可见，而是 hidden boot overlay 仍在命中 pointer interception。
- 更稳的最短路径是：对 checkbox/select 这类控件直接在页面里写值并派发 `input/change`，避免把测试稳定性绑在层叠点击命中上。

### 146. 运行态 server metadata 字段要兼容 `url` 和 `base_url`，否则工具会误判“服务未启动”
- 这次 baseline 脚本最开始只读 `base_url`，而 `.runtime/dev/active_server.json` 当前字段是 `url`，导致脚本一直轮询超时。
- 更稳的做法是工具层统一兼容两个字段，并在探活失败时再启动新 server。

### 147. perf 采样脚本的 ready 条件要直接绑定核心 state，不要直接复用更严格的 UI e2e gate
- 这次直接复用 `waitForAppInteractive` 会被 UI 层细节卡住，出现 `bootPhase=ready` 仍被判定超时。
- 更稳的做法是 perf 脚本只使用 `bootPhase/bootBlocking/scenarioApplyInFlight/startupReadonlyUnlockInFlight` 这组核心条件，并在超时时回传状态快照。

### 148. Playwright 的 project import watch 更稳的做法是页面轮询 debug snapshot，不要把整段完成判定塞进 `page.waitForFunction`
- 这次 `strategic_overlay_roundtrip.spec.js` 先遇到 `Object with guid handle ... was not bound in the connection`，随后又卡在长时间 evaluate，根因都在 import 完成判定和 test 自己的额外 render 依赖太重。
- 更稳的最短路径是：像 `project_save_load_roundtrip.spec.js` 一样，先在页面里暴露 debug getter，再由测试侧循环 `page.evaluate(() => getDebugState())` 读纯 JSON snapshot，完成条件用主线程轮询判断。
- roundtrip 只验证数据时，直接改 state 并导出即可，避免把 render/UI 刷新一起塞进同一个验证步骤。

### 149. state write allowlist 必须和检查器共用同一套扫描逻辑，不能一边用 rg，一边用另一套正则
- 这次 guardrail 初版先用 `rg` 生成 allowlist，再用 `scanContentForStateWrites()` 校验，结果立刻出现一批 stale entry。
- 更稳的最短路径是：allowlist 生成和校验都复用同一个 scanner，实现上只保留一套 `scanContentForStateWrites()` 真源。
- 这样才能保证“新增 direct state write 会报错、已迁移文件会自动退出 allowlist”这两个目标同时成立。

### 150. startup scenario apply 不要串行等待 deferred UI bootstrap
- 这次 `runStartupScenarioBoot()` 先等 `deferredUiBootstrapPromise`，把 toolbar/sidebar/scenario controls 的初始化时间整段算进 `scenarioAppliedMs`。
- 更稳的最短路径是：先启动 deferred UI bootstrap，让它和 startup scenario apply 并行；等 apply 完成后再 await UI promise 并补一次 UI 同步。
- 这样能把 UI 初始化时间从 startup apply 的关键路径里挪开，同时保持最终 ready 前 UI 状态一致。

### 151. Playwright 的 `boundingBox()` 不适合直接驱动深度 transform 的 SVG 交互
- 这次 strategic overlay 里的 `g.unit-counter` / `operation-graphics` 叠了 viewport transform 和局部 scale，Playwright 取到的 `boundingBox()` 会落到负坐标或失真坐标。
- 更稳的最短路径是：E2E 里优先验证稳定的显式更新路径；如果必须拿屏幕坐标，就从 SVG 自己的 transform / rect 真值换算，不直接把 `boundingBox()` 当拖拽坐标真源。

### 152. startup 里的并行 promise 不能只挂全局引用，必须保留本次启动的局部 promise
- 这次 deferred UI bootstrap 一旦在全局 promise 的 catch 里把引用清空，后面的 startup catch 和 continue 分支就可能直接跳过 await。
- 更稳的最短路径是：每次 bootstrap 都保存一份局部 promise 引用，主流程和恢复分支都基于这份局部引用判断是否已经 await、是否失败。
- 如果 UI 在 scenario apply 之后失败，continue 分支还要先回退 active scenario，再进入 base map 恢复语义。

### 153. startup cache key 的输入要走显式参数，不要让 data loader 偷读全局 state
- 这次 `loadStartupBootArtifacts()` 只为了拿 `currentLanguage` 去拼 localization cache key，却直接 import `state`，让启动链的底层 loader 和全局运行态重新耦合在一起。
- 更稳的最短路径是：把 cache key 需要的输入显式放进 `loadStartupBootArtifacts/loadMapData` 参数，由启动编排层传入。
- 这样 startup loader 能保持纯输入驱动，后续再切 boot/content accessor 时改动面也会更小。

### 154. scenario Playwright 长测里，资源加载超时和 UI 操作路径要分开定性
- 这次 `scenario_apply_concurrency.spec.js` 和 `scenario_shell_overlay_contract.spec.js` 一开始看起来像 apply 事务坏了，继续拆后才发现 contract、node 行为、`scenario_apply_resilience.spec.js` 都是绿的，红灯集中在 Playwright 下的资源加载超时和控制面操作路径。
- 更稳的最短路径是：先用 command-driven repro 确认 `applyScenarioByIdCommand` 是否真能走通，再单独判断是资源层 timeout、UI 控件路径，还是 shell overlay 合同本身。
- 这样不会把场景资源慢路径、UI click flaky、状态 accessor 回归混成一个问题一起追。

### 155. scenario rollback snapshot 要覆盖资源 owner 和 capability，不能只回滚 id 与 assignment map
- 这次 `scenario_rollback.js` 漏掉了 `activeScenarioMeshPack` 和 chunk refresh capability，导致 apply 失败后 active scenario 能回去，mesh/runtime capability 还停在失败场景。
- 更稳的最短路径是：rollback snapshot 把“资源 owner + capability flag”一起带上，恢复时按快照写回，不再用 `activeScenarioId` 猜能力。

### 156. same-scenario early return 要看 cached bundle 的完整就绪条件，不要只看 active id 和几张 map
- 这次 `scenario_manager.js` 的 same-scenario early return 只看 active id、full cache 和几张 shell/baseline map，startup 或恢复后的半成品状态会被误判成“可复用”。
- 更稳的最短路径是：同时校验 cached manifest id、active manifest id、baseline hash、split 场景 shell readiness，以及 `mesh_pack_url` 对应的 `activeScenarioMeshPack`。

### 157. scenario single-flight 的 promise 要先建立，再同步 UI
- 这次并发 apply 卡住，真正的风险点在 `state.scenarioApplyInFlight = true` 和 `activeScenarioApplyPromise = ...` 中间还插了 `syncScenarioUi()`。
- 更稳的最短路径是：先把共享 promise 建好，再让 UI 看到 in-flight 状态，这样任何重入路径都只能复用同一个 promise。

### 158. bundle load 也需要按 scenarioId + bundleLevel 做 in-flight 复用
- 这次 `applyScenarioById()` 已经有 single-flight，但 `loadScenarioBundle()` 自己没有同键复用，遇到重入或边缘重排时，bundle 层仍可能被重复启动。
- 更稳的最短路径是：在 bundle runtime controller 里按 `scenarioId + bundleLevel` 建 promise map，加载结束后统一清理。

### 159. 延迟到下一帧的 reset 后处理要自己补 render
- 这次把 reset 的 shell/opening-owner/UI 刷新延到帧后，标准 reset 按钮路径就会先完成 dispatcher 的 render，再落地副作用，屏幕上留下陈旧 overlay。
- 更稳的最短路径是：保留帧后执行，但在副作用落地后显式 `requestRender()`，让同一轮用户路径一定看到更新后的边界和 overlay。

### 160. renderer 大门面继续拆时，先收 state 写口，再动 facade 和调用链
- 这次 Lane E1 只把 `refreshResolvedColorsForFeatures` 和 `refreshColorState` 命中的 root state 写口收进 `color_state.js` accessor，`map_renderer/public.js`、`scenario_renderer_bridge.js`、`refreshColorStateFn` 注册位都保持原样。
- 更稳的最短路径是：先把 donor 里的直接 state 写入压成 owner/accessor，再保留原函数名和原导出位置，等行为稳定后再推进更深的 seam 和事件总线替换。

### 161. hydration health gate 的主合同要以当前运行时语义为真源，恢复链测试要跟随统一
- 这次 `startup_hydration.js` 在 overlay-only mismatch 下会清 overlay，但保持 editable fallback，`startupReadonly` 会回到 false。
- 更稳的最短路径是：先用 `tno_ready_state_contract.spec.js` 锁住当前主合同，再把 `startup_bundle_recovery_contract.spec.js` 跟到同一口径，避免两条 e2e 各自维护一套相反语义。

### 162. perf gate 的 render median 对偶数样本必须取两中位数均值
- 这次 `tno_1962.renderSampleMedianMs` 超线，根因是样本数从 3 变成 2 后，旧实现直接取上中位数，把同一量级的总渲染时间放大成超线。
- 更稳的最短路径是：`js/core/perf_probe.js` 和 `tools/perf/run_baseline.mjs` 都用标准 median 语义，偶数样本取中间两个值的均值。
- 这样能把真实渲染变慢和采样口径漂移分开，gate 才有稳定意义。

### 41. 批量把 `state` 改名时，导入路径和标识符要分开替换
- 这次用脚本把 `state` 改成 `runtimeState` 时，连 `state.js` 路径也一起改成了 `runtimeState.js`，会直接打断整条 import 链。
- 更稳的做法是先只改 import specifier，再按 `state.` 这种明确访问模式改调用点。

### 42. 把函数指针改成 helper 调用时，要保留“无 handler 时的本地回退”
- `startup_hydration.js` 里原来会在 `setStartupReadonlyStateFn` 缺席时走本地字段回退；直接改成 `callRuntimeHook(...)` 后，这条回退会静默消失。
- 更稳的做法是用 helper 返回值判定是否已由 owner 接管，没有接管就继续跑原本的本地清理逻辑。
