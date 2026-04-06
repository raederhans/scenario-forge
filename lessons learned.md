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
