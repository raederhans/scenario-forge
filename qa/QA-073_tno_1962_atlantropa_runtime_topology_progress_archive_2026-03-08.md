# QA-073 TNO 1962 Atlantropa Runtime Topology Progress Archive

**日期**: 2026-03-08  
**状态**: 阶段归档 / 可继续迭代  
**范围**: `tno_1962` 的 Atlantropa / Congo Lake 真拓扑建模、欧洲 1962 基线修正、相关渲染与交互收口  
**文档目的**: 记录到目前为止采用的方法、已完成的进展、当前目标、已达成结果，以及仍需精修的边界问题

---

## 0. 结论摘要

`tno_1962` 已经从“手画 overlay + 特殊区域占位”阶段，推进到“**runtime topology + donor geometry 驱动**”阶段。

当前稳定下来的总体模型是：

- `Congo Lake` 作为 **true water** 保留在 `scenario_water`
- `Atlantropa` 不再走 `scenario_special_land` 终态，而是拆成：
  - `ATL land`
  - `ATL sea`
- `ATL sea` 仍然是 **真实可选中的政治 feature**，但视觉上应该尽量接近普通海洋
- 地中海基础宏观水域在 `tno_1962` 中被排除，避免与 `ATL sea` 叠层竞争
- 大岛与关键岛链已基本 donor 化并具备交互能力

这意味着当前系统已经解决了最关键的三件事：

1. 1962 不再依赖纯视觉 overlay 假装存在 Atlantropa  
2. 刚果湖不再是错误椭圆，而是真湖面  
3. 地中海新增陆地、残余海面、沿岸国家归属，已经进入同一套 runtime feature 语义

---

## 1. 目标演进

## 1.1 最初目标

最初的 1962 目标有三条：

- 把 1962 的德国 annex / companion action 直接烘进剧本基线，而不是依赖运行时按钮
- 把 `Atlantropa` 从“涂黄的特殊区域”升级为真实可读的地貌与空间对象
- 把 `Congo Lake` 从“错误的大椭圆”升级为真实湖泊语义

## 1.2 中期目标

随着实现推进，目标进一步升级为：

- `Congo Lake` 做成 **真实水域**
- `Atlantropa` 做成 **真实地块 + 真实海面**
- 让 1962 的几何不是只靠视觉层，而是直接参与：
  - `political`
  - `land_mask`
  - coastline / hit-testing

## 1.3 当前目标

到本阶段结束时，当前目标已经明确为：

- 继续保持 `ATL land + ATL sea` 的总体语义
- 收口西地中海和亚得里亚海残余 seam
- 一次完成东地中海主要批次：
  - 安纳托利亚南岸
  - 塞浦路斯
  - 黎凡特
  - 巴勒斯坦 / 加沙
  - 埃及北岸 / 亚历山大 / 苏伊士
- 让 `ATL sea` 在视觉上与普通海洋接近，而不是显示成独立深色政治块

---

## 2. 方法演进

## 2.1 被淘汰的方法

### A. 纯 overlay / special region 占位

早期尝试的问题很明确：

- 看起来像贴图，不像真实地貌
- 无法承载国家归属
- 无法承载真实 coastline
- 会与底层海洋 / 陆地逻辑冲突

### B. TNO delta mask + bbox fit

中期曾尝试直接用 TNO 原始 mask 做 bbox 拉伸 / AOI 拟合。

这个方法暴露出几个结构性问题：

- 容易镜像
- 容易拉伸
- 容易区块漂移
- 不适合复杂沿岸收口
- 容易把错误的 donor 片段套到不正确的位置

因此它被降级为局部 fallback 思路，而不再作为主方案。

## 2.2 当前主方案

当前主方案是：

### A. `historic geographic overhaul` 作为 donor map source

使用本地 HGO mod 作为主 donor：

- `map/provinces.bmp`
- `map/definition.csv`
- `history/states/*.txt`

原因：

- donor 已经为地中海大量 Atlantropa 区域提供了 province 级几何
- donor 既有新陆地也有海水省份
- donor 不只提供“概念形状”，而是给出可提取的省份轮廓

### B. `runtime_topology.topo.json` 作为 1962 真几何入口

`tno_1962` 不再只依赖静态 political layer，而是使用：

- [data/scenarios/tno_1962/runtime_topology.topo.json](../data/scenarios/tno_1962/runtime_topology.topo.json)

同时 manifest 显式声明：

- [data/scenarios/tno_1962/manifest.json](../data/scenarios/tno_1962/manifest.json)
  - `runtime_topology_url`
  - `excluded_water_region_groups = ["mediterranean"]`

### C. `ATL land + ATL sea`

Atlantropa 当前不是 `special_regions` 终态，而是：

- `ATL land`: 新曝露陆地、盐碱地、沿岸 donor 新陆地
- `ATL sea`: 残余海面、水道、海盆级 donor 海域

其中：

- `ATL land` 和 `ATL sea` 都是政治 feature
- `ATL` 是隐藏的 synthetic owner
- 视觉层再区分 sea / land，而不是语义上拆第二个 dummy tag

### D. `Congo Lake = true_water`

刚果湖保留为真实水域：

- [data/scenarios/tno_1962/water_regions.geojson](../data/scenarios/tno_1962/water_regions.geojson)

当前 `scenario_water` 只保留：

- `congo_lake`

---

## 3. 当前实现模型

## 3.1 1962 欧洲基线修正

以下 companion / annex 行为已直接烘进 `tno_1962` 基线：

- `RKP -> GER / annexed_poland_to_ger`
- `RKO -> GER / ostland_marijampole_to_ger`
- `RKU -> ROM / transnistria_to_rom`
- `RKM -> FIN / greater_finland_to_fin`

仍明确未自动应用：

- `RKU -> GER / crimea_to_ger`
- `RKM -> GER / arctic_islands_to_ger`

Germany 在 1962 中的三个 preset 仍保留 disabled。

## 3.2 Atlantropa cluster 体系

当前 donor / runtime 链已扩展为完整 cluster 体系：

- `adriatica`
- `sicily_tunis`
- `gabes`
- `levant`
- `tyrrhenian`
- `west_med`
- `aegean`
- `libya_suez`

每个 cluster 现在都已具备一套明确参数：

- donor land state allowlist
- donor sea state allowlist
- control points
- `gap_fill`
- `boolean_weld`
- `shore_seal`
- island replacement
- owner overrides

主配置集中在：

- [tools/patch_tno_1962_bundle.py](../tools/patch_tno_1962_bundle.py)

## 3.3 大岛 donor replacement

目前已稳定 donor 化并可交互的大岛 / 关键岛链包括：

- `Sicily -> ITA`
- `Malta -> ITA`
- `Corsica -> ITA`
- `Sardinia -> ITA`
- `Balearics -> SPR`
- `Crete -> GRE`
- `Cyprus -> TUR`
- `Euboea -> GRE`
- `Lesvos -> GRE`
- `Chios -> GRE`
- `Rhodes -> GRE`

owner 映射可直接在这里看到：

- [data/scenarios/tno_1962/owners.by_feature.json](../data/scenarios/tno_1962/owners.by_feature.json)

关键 feature 例子：

- `ATLISL_sicily_tunis_sicily`
- `ATLISL_sicily_tunis_malta`
- `ATLISL_levant_cyprus`
- `ATLISL_tyrrhenian_corsica`
- `ATLISL_tyrrhenian_sardinia`
- `ATLISL_west_med_balearics`
- `ATLISL_aegean_crete`
- `ATLISL_aegean_euboea`
- `ATLISL_aegean_lesvos`
- `ATLISL_aegean_chios`
- `ATLISL_aegean_rhodes`

## 3.4 几何策略

目前实际采用的是四层混合策略：

### A. `donor_land`

来自 donor province 的普通新陆地。

### B. `donor_island`

用于整岛 donor replacement 或 donor 岛链替换。

### C. `shore_seal`

用于 donor land 与 baseline 大陆海岸之间的近岸补缝。

### D. `boolean_weld`

只在 donor 已经贴近 baseline 且不会封死残余海面的局部片段启用。

当前不会做的事：

- 不对整段 baseline 大陆海岸做整段 donor 替换
- 不对 causeway / dam / canal 条带做大尺度布尔
- 不把 `ATL sea` 降回普通 `scenario_water`

---

## 4. 已完成的进展

## 4.1 Congo Lake

已完成：

- 从错误椭圆升级为真实湖泊语义
- 周边岸线不再大面积被多裁
- `scenario_water` 现在只保留 `congo_lake`

仍需要继续守住的约束：

- 不要为了 Atlantropa 精修回归 Congo
- Congo 只保留真湖面，不额外吃岸

## 4.2 Mediterranea / Atlantropa

已完成：

- 地中海宏观水域从 `tno_1962` 中排除，避免与 `ATL sea` 冲突
- Atlantropa 不再依赖 `special_regions` 作为终态承载
- 主要 donor cluster 已全部入链
- 西、中、东地中海 donor owner map 已开始实落地，而不是只停在 inventory

## 4.3 West 收尾已取得的结果

已取得的效果：

- 南意大利已大幅改善
- 希腊群岛 donor 化效果总体正确
- 西地中海和第勒尼安海已有 donor fill / weld / seal 基础
- 达尔马提亚海岸已进入 donor island + residual sea 分离模型

但这部分尚未完全收口，仍需要 close-up 精修。

## 4.4 East Med 已取得的结果

当前 East Med 不是空白，而是已进入“首版可运行”状态：

- `TUR`: Mersin / Hatay / Cyprus / Anatolia south-west coast / Turkish Aegean coast
- `SYR`: Latakia
- `LEB`: Lebanon coastal additions
- `PAL`: Palestine / Gaza coastal additions
- `EGY`: Sinai / Alexandria / Suez north-coast additions
- `LBA`: Cyrenaica additions

这些 owner 分配都已经进入 1962 bundle，而不是只写在计划里。

---

## 5. 当前已达成结果

## 5.1 数据层

到本阶段结束时，以下结果已经成立：

- `tno_1962` 存在完整 runtime topology
- `scenario_water` 只剩 `congo_lake`
- `ATL land` 与 `ATL sea` 同时存在
- 大岛 donor replacement 已实装
- East Med owner map 已开始落地
- `ATL` 仍隐藏于正常国家树

## 5.2 渲染层

渲染层已经经历两次关键修正：

### A. runtime political seam 修复

详见：

- [QA-071_tno_1962_runtime_political_seam_fix_2026-03-08.md](./QA-071_tno_1962_runtime_political_seam_fix_2026-03-08.md)

其结果是：

- `TNO 1962` 高碎片 political layer 的同色 seam 伪影显著下降

### B. `ATL sea` 海色回归

`ATL sea` 不再继续用普通深色政治色块直填，而是改成接近海洋的 fill 分支。

目标是：

- 保留其政治/交互语义
- 视觉上接近普通海洋
- 不重新塞回 `scenario_water`

## 5.3 浏览器侧结果

已完成的浏览器证据包括：

- 应用页 `TNO 1962` 可正常载入
- 1962 bundle 资源均 `200 OK`
- 当前应用页只有 favicon 404 噪声
- renderer 回归后，`ATL sea` 在 overview 级别不再表现成完全独立的深色政治海块

但需要明确：

- 已做的是 overview 级和 smoke 级验证
- 还没有完成一轮高缩放逐区 close-up sweep

---

## 6. 当前方法的优点与局限

## 6.1 优点

1. 语义正确
   - 湖是水
   - 盐碱地是地
   - 残余海面不是假 overlay

2. 可持续扩展
   - donor inventory 已建立
   - cluster 模型可继续扩区域

3. 后续国家分配成本低
   - 大量新地块已经是 feature 级对象
   - 后续只需改 owner/controller/core，不必重切几何

4. 交互上可用
   - 大岛、关键岛链、残余海面都可点

## 6.2 局限

1. 近岸 seam 仍然依赖局部参数调优
   - `gap_fill`
   - `boolean_weld`
   - `shore_seal`

2. 部分 cluster 仍有 donor 与 baseline 贴合度问题
   - 法国南岸 / 利古里亚 / 皮埃蒙特外海
   - 达尔马提亚海岸
   - 东地中海部分贴岸段

3. `Qattara` 仍未作为强制完成项落地
   - 目前采用的是 donor 质量门槛策略

---

## 7. 仍需继续的目标

## 7.1 立即目标

下一轮最值得做的，是完成一轮 close-up 精修与截图验收，重点区域：

- 法国南岸 / 利古里亚 / 皮埃蒙特外海
- 亚得里亚海北口与达尔马提亚海岸
- 塞浦路斯
- 黎凡特 / 巴勒斯坦 / 加沙
- 埃及北岸 / 亚历山大 / 苏伊士

## 7.2 几何目标

需要继续推进的几何目标：

- 修完第勒尼安海与法南方向的剩余漏海缝
- 继续细化达尔马提亚海岸 donor 岛链与大陆收口
- 在不封死残余海面的前提下，继续使用 donor + `gap_fill + boolean_weld`
- 若 `Qattara` donor 质量达阈值，再决定是否纳入

## 7.3 视觉目标

需要继续守住的视觉目标：

- `ATL sea` 与普通海洋观感接近
- 但仍保持轻微可辨识边缘
- 不恢复成深色独立海块

---

## 8. 相关文件索引

### 关键 QA 文档

- [QA-048_tno_special_regions_atlantropa_congo_lake_implementation_study_2026-03-04.md](./QA-048_tno_special_regions_atlantropa_congo_lake_implementation_study_2026-03-04.md)
- [QA-070_atlantropa_hgo_donor_inventory_2026-03-08.md](./QA-070_atlantropa_hgo_donor_inventory_2026-03-08.md)
- [QA-071_tno_1962_runtime_political_seam_fix_2026-03-08.md](./QA-071_tno_1962_runtime_political_seam_fix_2026-03-08.md)

### 关键生成脚本

- [tools/patch_tno_1962_bundle.py](../tools/patch_tno_1962_bundle.py)

### 关键 1962 产物

- [data/scenarios/tno_1962/manifest.json](../data/scenarios/tno_1962/manifest.json)
- [data/scenarios/tno_1962/runtime_topology.topo.json](../data/scenarios/tno_1962/runtime_topology.topo.json)
- [data/scenarios/tno_1962/owners.by_feature.json](../data/scenarios/tno_1962/owners.by_feature.json)
- [data/scenarios/tno_1962/controllers.by_feature.json](../data/scenarios/tno_1962/controllers.by_feature.json)
- [data/scenarios/tno_1962/cores.by_feature.json](../data/scenarios/tno_1962/cores.by_feature.json)
- [data/scenarios/tno_1962/water_regions.geojson](../data/scenarios/tno_1962/water_regions.geojson)
- [data/scenarios/tno_1962/audit.json](../data/scenarios/tno_1962/audit.json)

### 关键前端文件

- [js/core/map_renderer.js](../js/core/map_renderer.js)

---

## 9. 当前状态判定

当前 `tno_1962` 的 Atlantropa / Congo Lake 工作状态，可判定为：

- **方法论已稳定**
- **基础拓扑已成立**
- **主要 donor cluster 已接上**
- **大岛与关键岛链已进入可交互状态**
- **West / East Med 已具备继续精修的基础**

仍未达成的不是“有没有这套系统”，而是：

- 逐区 close-up 级的海岸精修
- 少数 cluster 的 seam / weld / donor 贴合度优化
- 东地中海剩余细部的最后收口

所以这一阶段最准确的结论是：

**1962 的 Atlantropa 已经从试点成功进入可持续迭代阶段。**
