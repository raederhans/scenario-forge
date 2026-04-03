# 构筑与启动链专题审计

## 结论和修复方案

当前构筑链最需要做的不是再补一个脚本，而是把“默认启动”“增量构筑”“startup 资产生成”这三件事彻底拆清。建议直接收成下面的结构：

1. `start_dev.bat` 默认只启动 server，不默认整仓 rebuild。
2. 新增单独的显式构筑入口，负责 full rebuild。
3. startup 资产只保留一条生成链，bootstrap 裁剪和 startup bundle 裁剪不能分别维护。
4. `init_map_data.py` 只保留 CLI glue，旧的 orchestration 逻辑完全挪出。
5. primary topology stage 恢复真实 cache key，不要再伪装成有 stage cache。

## 当前真实链路

### 默认开发启动

- `start_dev.bat`
- `build_data.bat`
- `python init_map_data.py`
- `run_server.bat`
- `python tools/dev_server.py`

这条链的直接问题是：就算只是改了一个 dev server 路由，也要先走整条数据构筑链。

## 已确认问题

### 1. 默认 dev 启动是“先全量构筑，再启动”

影响：

- 本地冷启动时间长
- 和“编辑后只想看 UI / server 行为”的开发意图不匹配
- 很容易让一次轻量编辑也卷入长构筑

建议：

- `start_dev.bat` 改成只起 server
- 另设 `start_dev_rebuild.bat` 或 `build_and_start_dev.bat`
- 如果必须保护数据一致性，做 startup-time contract check，而不是每次全量重建

### 2. `init_map_data.py` 同时承载新旧两套编排

证据：

- `init_map_data.py:4031` 仍保留 `_legacy_main_impl()`
- 文件总长 4141 行

这说明现在虽然已经有 `map_builder/build_orchestrator.py`，但旧式主入口还没有真正退出。结果是：

- 单文件职责过重
- 新旧入口容易漂移
- 测试更难收口到单一编排层

建议：

- `init_map_data.py` 只保留参数解析、调用 orchestrator、错误码和 timing 输出
- 所有 stage 拼装都从该文件移出
- `_legacy_main_impl()` 直接删除，不再保留可执行历史分支

### 3. primary stage cache 名义存在，实际被禁用

证据：

- `init_map_data.py:3714` 进入 `build_primary_topology_bundle(...)`
- 函数开头直接 `del script_dir, build_stage_cache, timings_root`

这意味着：

- 参数接口还在假装支持 stage cache
- 但真正最重的 primary topology stage 并没有参与缓存判定
- 上层 orchestrator 很难做可靠增量

建议：

- 要么真正接入 stage cache，按输入集合算 key
- 要么直接删除这个参数，不要保留伪接口
- 更推荐前者，因为 primary topology 是最该增量化的部分

### 4. startup 资产由两条重叠链路生成

证据：

- `tools/build_startup_bootstrap_assets.py`
- `tools/build_startup_bundle.py`

问题不在于文件数多，而在于它们都在做 startup 期裁剪，只是粒度不同：

- 一条负责 bootstrap 资产
- 一条负责 startup bundle

这会造成：

- 字段保留规则分裂
- 历史遗留字段无法确定谁是真正 source of truth
- 发生 drift 时很难知道应该修哪一条链

建议：

- 统一成“一个 startup shell artifact composer”
- bootstrap topology、startup bundle、startup locales 都由一个 planner 决定包含字段
- 共享同一份 allowlist / drop policy

### 5. strict publish gate 覆盖不足，detail/chunk 仍有“skip 后继续”的风险路径

证据：

- `map_builder/scenario_bundle_platform.py:433` 的 `validate_strict_publish_bundle(...)` 只依赖 `validate_publish_bundle_dir(checkpoint_dir)`
- 当前 strict 只保证最低 bundle contract，不保证所有 publish 目标完整
- 静态审计中已经看到 detail/chunk 的 skip 路径，但没有做整条长链路动态复跑

建议：

- strict gate 分成两层：
  - stage strict：每个 stage 的必需输入和输出
  - publish strict：对本次 publish target 的完整文件集做验证
- `startup-assets`、`chunk-assets` 都必须有独立 required outputs

## 构筑边界为什么不成立

现在的主要问题是“入口”和“产物”没有一一对应：

- 一个入口会触发过多产物
- 一个产物又可能来自多条链
- 结果就是开发者无法预测这次改动到底会触发什么

只要边界不收口，继续拆文件不会真正变简单。

## 建议重构图

### 目标分层

- `init_map_data.py`
  - 只负责 CLI
- `map_builder/build_orchestrator.py`
  - 只负责 stage 顺序与依赖
- `map_builder/startup_asset_pipeline.py`
  - 只负责 startup planner + composer
- `map_builder/stage_cache.py`
  - 只负责输入哈希和命中判断

### 启动入口

- `start_dev.bat`
  - 只起 server
- `build_data.bat`
  - 只做显式构筑
- `check_data_contracts.bat`
  - 只做 contract gate

## 证据定位

- `start_dev.bat`
- `build_data.bat`
- `init_map_data.py:3714`
- `init_map_data.py:4031`
- `map_builder/scenario_bundle_platform.py:433`
- `tools/build_startup_bootstrap_assets.py`
- `tools/build_startup_bundle.py`

## 建议优先级顺序

1. 删除默认 dev 全量 rebuild
2. 删掉 `_legacy_main_impl()`
3. 恢复 primary stage cache
4. 合并 startup 资产生成链
5. 把 strict gate 拆成 stage strict + publish strict
