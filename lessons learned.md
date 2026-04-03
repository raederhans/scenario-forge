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
