# QA-074 TNO 1962 Asset Reuse And Incremental Build Plan

**日期**: 2026-03-08  
**状态**: 方案留档 / 等待后续实施并持续追加  
**范围**: `tno_1962` 资产复用、增量构建、builder 分层失效与长期归档策略  
**文档目的**: 单独归档本轮“资产复用 / 增量构建”方案，并作为后续真实实施结果的同一份长期档案

---

## 0) 结论摘要

`TNO 1962` 现在已经出现一个明确的工程问题：

- 前端运行时会复用已生成的场景 bundle
- 但 builder 侧还没有真正的跨运行持久缓存
- `tools/patch_tno_1962_bundle.py` 当前默认仍会重写整套场景产物

在 `1962` 剧本仍未完工、`geometry` 与 `mapping` 都还会继续变化的前提下，这一轮不适合直接冻结任何一块几何资产。  
因此当前决定采用的不是“先锁死 donor 几何”，而是：

- 先把 builder 拆成分层阶段
- 每个阶段都允许失效
- 每个阶段都能持久复用自己的派生产物
- 失效策略采用“自动输入 hash + 手动版本锁 + 强制重建开关”的混合模式

这份文档只负责归档方案，不把内容混入：

- [QA-071_tno_1962_runtime_political_seam_fix_2026-03-08.md](./QA-071_tno_1962_runtime_political_seam_fix_2026-03-08.md)
- [QA-073_tno_1962_atlantropa_runtime_topology_progress_archive_2026-03-08.md](./QA-073_tno_1962_atlantropa_runtime_topology_progress_archive_2026-03-08.md)

后续真正实施时，也继续写回本文件，而不是新开第二份同主题 QA。

---

## 1) Plan Archive

### 1.1 当前背景

`tno_1962` 现在的重资产主要集中在几类场景产物：

- [data/scenarios/tno_1962/runtime_topology.topo.json](../data/scenarios/tno_1962/runtime_topology.topo.json)
- [data/scenarios/tno_1962/relief_overlays.geojson](../data/scenarios/tno_1962/relief_overlays.geojson)
- [data/scenarios/tno_1962/audit.json](../data/scenarios/tno_1962/audit.json)

其中最重的是 `runtime_topology.topo.json`，已经达到约 `50 MB` 量级。  
当前体感性能虽然比最初状态有所改善，但无论是数据重建成本，还是持续迭代阶段的维护成本，都说明 builder 需要具备真正的资产复用能力。

用户当前明确说明：

- `1962` 剧本仍未完工
- 接下来一两周里，`geometry` 和 `mapping` 两边都会继续变
- 现在暂时不希望把任何一块几何层硬性冻结
- 方案先做留档，后续执行结果继续留在同一个 QA 文件里

### 1.2 为什么现在需要资产复用

当前的主要矛盾不是“页面每次打开都重建”，而是“每次跑 builder 都太容易进入全量重建路径”。

运行时已经会直接加载现成的本地 bundle：

- [data/scenarios/tno_1962/manifest.json](../data/scenarios/tno_1962/manifest.json)
- [js/core/scenario_manager.js](../js/core/scenario_manager.js)

但 builder 仍然是整条链联动：

- 读取 runtime political topo
- 读取 HGO donor
- 派生 Atlantropa land / sea
- 重算 land mask
- 重新编码 runtime topology
- 最终把 `countries / owners / controllers / cores / water / relief / manifest / audit / runtime_topology` 一起写回

这意味着：

- 改 owner/controller 时，仍可能被迫重走 donor 几何链
- 改一小段视觉派生层时，仍可能连带触发大 topo 重编码
- 后续越往完工阶段走，这种“全动”成本会越难接受

### 1.3 当前 builder 的复用现状

当前已存在的复用只到以下程度：

1. 前端运行时复用
- 浏览器直接加载已有 bundle，不会进入 Python 重建

2. 单次运行内 memory cache
- [tools/patch_tno_1962_bundle.py](../tools/patch_tno_1962_bundle.py) 在 `load_hgo_context()` 中已有：
  - `province_geom_cache`
  - `state_geom_cache`
  - `state_province_cache`
- 这些缓存只对同一次 Python 进程有效，不是跨运行持久缓存

3. 当前缺失的部分
- 没有跨运行的 donor 几何缓存
- 没有阶段化派生产物目录
- 没有 lockfile
- 没有输入 hash 失效判定
- 没有“只重建某一阶段及其下游”的默认行为

当前 `tools/patch_tno_1962_bundle.py` 的默认输出仍是整套场景文件：

- `countries.json`
- `owners.by_feature.json`
- `controllers.by_feature.json`
- `cores.by_feature.json`
- `special_regions.geojson`
- `water_regions.geojson`
- `relief_overlays.geojson`
- `manifest.json`
- `audit.json`
- `runtime_topology.topo.json`

### 1.4 已确认的用户偏好

这一轮已经确认的偏好如下：

1. 不冻结任何几何层
- 当前 `geometry` 与 `mapping` 都会继续变
- 没有哪一层已经稳定到可以直接长期锁死

2. 复用资产采用 repo-tracked 方式
- 不是只放本地临时 `.cache`
- 希望关键派生产物作为仓库内可追踪文件保存

3. 失效策略采用混合模式
- 自动输入 hash 判定是否复用
- 同时保留手动版本锁与强制重建开关

4. 归档方式固定
- 本方案单独新建 `QA-074`
- 后续第一次实施、二次调整、剧本完工后的继续优化，都继续写回本文件

### 1.5 选定方案

当前选定的方案是“分层资产复用 + 增量构建”。

builder 拆成以下固定阶段：

1. `source_snapshot`
- 收集输入文件与当前指纹

2. `donor_geometry`
- 生成可复用 donor 派生层
- 包括 `atl_political`、`atl_sea`、`atlantropa_region_unions`、`congo_lake`

3. `land_context`
- 基于 geometry 派生：
  - `land_mask`
  - `context_land_mask`

4. `derived_visual`
- 生成：
  - `relief_overlays`
  - `water_regions`
  - `special_regions`

5. `scenario_bundle`
- 最终组装：
  - `runtime_topology`
  - `countries / owners / controllers / cores`
  - `manifest / audit`

计划新增的内部复用资产目录：

- `data/scenarios/tno_1962/derived/`

计划新增的构建锁文件：

- `data/scenarios/tno_1962/build.lock.json`

第一版失效策略固定为：

- 每个阶段记录：
  - `input_hash`
  - `upstream_stage_hash`
  - `stage_version`
- 默认按 hash 自动判定 cache hit / miss
- 允许手动 bump 某个阶段版本号强制失效
- 允许通过 `--force` 或 `--no-cache` 走强制重建路径

### 1.6 为什么当前不冻结任何几何层

本轮不冻结几何层，不是因为冻结方案错误，而是因为当前时机不合适。

已经确认的现实约束是：

- 地中海 / Atlantropa 相关 geometry 仍可能继续微调
- owners/controllers/颜色与显示语义也仍可能继续变化
- 现在若直接把 donor geometry 或 land mask 标为“稳定资产”，后面很可能马上再次失效

因此第一版要先解决的是：

- 如何避免不必要的全量重建
- 如何让每一层都“可失效但可复用”

不是先假设某一层已经永久稳定。

### 1.7 后续执行入口与预期收益

真正开始实施时，默认目标不是“完全消灭重建”，而是把“无关改动带来的重建”压下去。

预期收益包括：

1. 改 `owners/controllers/cores`
- 只重建 `scenario_bundle`
- 不重建 donor geometry / land mask / relief

2. 改 donor geometry
- 只让 `donor_geometry` 起失效
- 下游按依赖关系联动

3. 改 `context_land_mask` 简化策略
- 只让 `land_context` 与 `scenario_bundle` 失效

4. 改 relief 生成规则
- 只让 `derived_visual` 与 `scenario_bundle` 失效

如果这一套落地成功，`1962` 在未完工阶段也能保持较高迭代速度，不需要因为一类小改动而反复整条链重建。

### 1.8 与 runtime topology / 性能路线的兼容边界

后续若开始实施渲染性能优化，必须把 `tno_1962` 当前的 runtime topology 语义视为稳定接口，而不是可随意回退的实现细节。

当前需要保持不变的边界如下：

- `ATL sea` 继续是政治 feature，不回退成 `scenario_water`
- `scenario_water` 在 `tno_1962` 中继续只保留 `congo_lake`
- `manifest.excluded_water_region_groups = ["mediterranean"]` 继续成立
- Mediterranean Atlantropa AOI 内，不允许再漏到底层默认 open ocean 命中
- staged apply、lazy hit canvas、context split 必须显式兼容：
  - `ATL land / ATL sea` 的首帧可见性
  - `runtime_topology.topo.json` 的 `political / scenario_water / land_mask / context_land_mask`
  - 1962 的 island donor replacement 与 east-med owner 映射

因此性能路线的正确顺序是：

1. 先收口 1962 的地中海几何、海面覆盖与命中
2. 再做 renderer 层的 clip / context / staged apply / lazy hit canvas 优化
3. 只有在前两步仍不足够时，才进入 profile LOD 或 preraster

这条兼容边界单独留在本文件中，避免未来把性能优化和 seam fix / donor 几何方案混写到同一份 QA 里。

---

## 2) Execution Archive

**当前状态**: 本节暂不填写实施结果，只保留统一入口。  
**后续要求**: 一旦开始真正实施“资产复用 / 增量构建”，必须继续追加到本文件，而不是另开第二份同主题 QA。

后续实施归档内容固定包括：

- 实施日期
- 实际改动范围
- 新增 `derived/` 资产与 `build.lock.json`
- builder CLI 与阶段行为
- cache hit / miss 实测结果
- 冷启动与热启动耗时对比
- 浏览器回归与性能结论
- 遗留问题与下一步

---

## 3) 当前验收条件

在真正实施之前，本文件至少需要明确记录以下事实：

1. 当前没有跨运行持久缓存，只有单次运行内 memory cache

2. 当前 `tools/patch_tno_1962_bundle.py` 默认仍会重写整套场景产物

3. 第一版方案不冻结任何几何层

4. 第一版复用策略采用：
- 自动输入 hash
- 手动版本锁
- 强制重建开关

真正开始实施后，同一文件追加的验收内容固定包括：

1. 冷启动构建耗时

2. 热启动无改动时的 cache hit 结果

3. 仅改 owner/controller 时的增量行为

4. 仅改 donor geometry 时的失效链

5. 最终 bundle 与全量重建结果是否一致

---

## 4) 备注

本文件是 `TNO 1962` 资产复用主题的长期档案。

后续如果：

- 先做第一版增量构建
- 再做第二版几何冻结
- 等 `1962` 完工后继续做最终构建优化

都继续写回本文件，保持同一主题的完整时间线。
