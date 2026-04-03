# 数据合成、发布与锁专题审计

## 结论和修复方案

这一部分的核心结论很直接：现在的 materialize、publish、lock 还没有形成真正的事务边界。只要这一层不收口，后面所有 bundle、startup、chunk 优化都会被脏状态和竞态拖垮。

建议按下面顺序修：

1. 先把目录锁改成真正的 owner-based lock，不允许同进程不同线程借 depth 复入。
2. 再把 publish 变成原子替换，不允许半发布。
3. 再把 build session 输入集补全。
4. 最后把 `tools/dev_server.py` 从 orchestration 中瘦身，只留 HTTP 层。

## 已确认问题

### 1. 目录锁不是严格线程拥有者语义

证据：

- `tools/dev_server.py:87` 使用 `socketserver.ThreadingMixIn`
- `map_builder/scenario_locks.py:12` 使用 `_SCENARIO_LOCK_DEPTHS`
- `map_builder/scenario_locks.py:39-47` 只要同一个进程内已经持锁，后续进入就增加 depth

问题：

- 当前 lock 只区分“这个进程有没有拿过锁”
- 不区分“是不是同一线程、同一事务”
- 这对 `ThreadingMixIn` server 来说是不够的

直接风险：

- 同进程不同请求线程有机会误入同一场景写路径
- 你以为是可重入，实际是跨线程放行

建议：

- lock file 里记录 `pid + thread_id + holder + transaction_id`
- 进程内复入只允许同一线程同一 transaction
- 更稳的方案是把所有 scenario write 串到单 worker owner，上层线程只排队

### 2. publish 不是原子事务

证据：

- `map_builder/scenario_bundle_platform.py:450` 的 `publish_checkpoint_bundle(...)` 逐文件写入 scenario 目录
- `map_builder/scenario_publish_service.py` 对各 target 分段执行，没有 staging dir + atomic swap

问题：

- 中途失败时，scenario 目录可能一半是新文件，一半是旧文件
- 之后 manifest 和 runtime 实际文件可能不一致

建议：

- 所有 publish 先写临时 staging 目录
- staging 校验通过后再原子替换目标目录或目标文件集
- `published_targets` 状态只在 commit 成功后记录

### 3. `chunk-assets` 发布破坏 checkpoint -> publish 边界

证据：

- `map_builder/scenario_publish_service.py:174-189`
- `chunk-assets` 分支调用 `tno_bundle.build_chunk_assets_stage(scenario_dir, resolved_checkpoint_dir)`
- 返回结果标记为 `rebuilt_from_published_inputs`

问题：

- 这不是 publish
- 这是“发布时顺手又 build 一次”
- 且 build 输入直接来自 live scenario 目录

后果：

- checkpoint 不再是完整真相源
- 复盘一次构建结果会变得困难
- 同一 build session 的可重复性被破坏

建议：

- `chunk-assets` 必须只消费 checkpoint 内的 runtime/startup inputs
- 如果 checkpoint 里还缺 chunk build 所需输入，就说明 checkpoint schema 本身不完整，应补 schema，不应回到 live tree 重建

### 4. `startup-assets` 发布依赖全局副产物，不是 checkpoint 自给

证据：

- `map_builder/scenario_publish_service.py:156-162`
- 发布时额外读取：
  - `root / data / locales.startup.json`
  - `root / data / geo_aliases.startup.json`

问题：

- 这两个文件不是从 checkpoint copy 出去
- 它们是全局侧写物
- 结果是 startup-assets 发布成功，不代表 startup 所需依赖都来自同一次 build snapshot

建议：

- 把这两个文件也纳入 startup checkpoint artifact 集
- publish 只能从 checkpoint 拿 startup 完整包

### 5. build session 输入集合过窄

证据：

- `map_builder/scenario_build_session.py:12-18` 的 `_CANONICAL_INPUT_FILENAMES`
- 只覆盖：
  - `manifest.json`
  - `scenario_mutations.json`
  - `city_assets.partial.json`
  - `capital_defaults.partial.json`
  - `geo_locale_reviewed_exceptions.json`

问题：

- 这不足以代表真实构建输入
- 像 startup 资产规则、chunk 生成规则、共享资源、外部 builder 脚本变化都不会让 snapshot hash 变化

建议：

- build session 分 stage 记录 inputs
- 至少把下列输入纳入：
  - stage script version
  - 共享 startup asset rule files
  - chunk build config
  - geo-locale builder inputs
  - 任何从根目录读取的 supporting artifacts

### 6. `dev_server` 仍然承担 orchestration

证据：

- `tools/dev_server.py:534` 直接持有 `scenario_build_lock`
- `tools/dev_server.py:858` 直接调 `publish_scenario_outputs_in_locked_context(...)`
- `map_builder/scenario_materialization_service.py` 仍调用 `dev_server` 内部 helper

问题：

- HTTP 层、事务层、场景 service 层没有分开
- CLI 和 server 都在重复包锁、包上下文、包发布

建议：

- 让 `map_builder/` 真正成为唯一 orchestration 层
- `tools/dev_server.py` 只负责：
  - request parse
  - auth / route
  - 调 service
  - 返回 response

### 7. 小编辑会串到重发布

证据：

- `tools/dev_server.py:2392-2402`
- geo-locale 保存时会把 `publish_targets` 从 `("geo-locale",)` 扩成 `("geo-locale", "startup-assets")`

问题：

- 一个局部 locale 改动会直接进入更重的 startup-assets 发布链
- 小事务和大事务边界混在一起

建议：

- 先 materialize geo-locale
- 再按 manifest 中真实依赖决定是否需要异步刷新 startup bundle
- 让“立刻可见”和“重建 startup cache”分成两步

## 为什么现在会拖慢性能

不是算法慢，而是事务粒度太大：

- 锁持有时间太长
- 发布时又重建
- 小编辑触发大链路
- checkpoint 不能稳定复用

这几件事叠加后，开发者体感就会变成“很多操作都很重，而且还不确定重在哪里”。

## 建议重构图

### 目标事务边界

- `load context`
- `validate baseline`
- `materialize to checkpoint`
- `validate checkpoint`
- `publish from checkpoint`
- `commit build session`

整个过程中：

- 只有一个 owner
- checkpoint 是唯一中间真相
- publish 不得回读 live scenario

## 证据定位

- `tools/dev_server.py:87`
- `tools/dev_server.py:534`
- `tools/dev_server.py:858`
- `tools/dev_server.py:2392`
- `map_builder/scenario_locks.py:12`
- `map_builder/scenario_locks.py:39`
- `map_builder/scenario_publish_service.py:117`
- `map_builder/scenario_publish_service.py:144`
- `map_builder/scenario_publish_service.py:174`
- `map_builder/scenario_build_session.py:12`
- `map_builder/scenario_bundle_platform.py:450`

## 建议优先顺序

1. 锁语义改成真正 owner-based
2. publish 改成 staging + atomic commit
3. checkpoint schema 补全
4. dev server 脱离 orchestration
5. 把小编辑和重发布拆开
