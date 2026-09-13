# TNO 按来源地区恢复精度

法国试点之后，德国、比利时和荷兰作为一组共同替换。来源国家与剧本控制国分开：DE 的 401 面属于 GER，BE 的 44 面属于 BRG，NL 的 40 面属于 RKN。GER、BRG 分块同时包含法国面，所以不能按控制国整块覆盖源几何。

## 来源和身份

使用 GISCO 同年份 2021 NUTS3 的 01M 源，不迁移行政区年份或 ID：

https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_01M_2021_3035_LEVL_3.geojson

原文件 EPSG:3035，选出 CNTR_CODE 为 DE/BE/NL、LEVL_CODE 为 3 的面，NUTS_ID 映射为 id，CNTR_CODE 映射为 cntr_code，再统一转 EPSG:4326。三国共 485 个 ID 与现有 TNO 完全匹配；单体及联合 coverage 检查通过。原始源、提取结果和来源记录保存在 `.runtime/tmp/de-benelux/source/`。原始源无需 buffer 或 snap。

## 候选构建

`tools/pilot_tno_regional_precision.py` 接受显式同 ID GeoJSON；保留剧本元数据，三个来源国家共同对齐，然后施加非目标政治面、水域、亚特兰托帕和 published land_mask 约束。丹麦历史切割、已经升级的法国和全部辅助对象属于不可写基线。额外历史切割仍需逐剧本审查，不能从同 ID 自动推断历史形状相同。

```powershell
py tools/pilot_tno_regional_precision.py --scenario-dir data/scenarios/tno_1962 --replacement-geojson .runtime/tmp/de-benelux/source/source.geojson --source-countries DE BE NL --output .runtime/tmp/de-benelux/runtime-candidate.topo.json
py tools/regional_scenario_assets.py --baseline-dir data/scenarios/tno_1962 --candidate-runtime .runtime/tmp/de-benelux/runtime-candidate.topo.json --output-dir .runtime/tmp/de-benelux/scenario-assets
```

输出路径须不存在，不能覆盖正式数据。候选完成后还需要元数据/几何身份、混合 LOD、实际邻接变化、启动包、审计及浏览器检查。正式目录有完整备份后再由整合所有者写入。

## 防止远景重新开缝

候选 runtime 顶层的 `political_precision_source_countries` 声明已共同处理的来源国家，分块构建按声明选择共享简化。每个控制国的外围边界保持精确，只简化其内部共享边界，保证不同控制国 coarse/detail 分别加载仍能拼接。共享简化不满足条件时保留原坐标，不回退到逐面简化和坐标取整。

法国仍沿用既有独立共享简化路径；未声明地区保持原有规则。该声明不会修改 feature 属性或运行时加载预算。未来全量历史重建必须重放精度步骤并保留声明，不能把旧的全量输出直接覆盖已升级 runtime。

## 验收边界

允许视觉上无关紧要的小误差，但 ID/归属/核心领土/非目标几何必须保留，裁剪不能误删地块。面积残差单列，不把浮点零或非零等同于视觉好坏。性能应区分全体分块体积、启动包体积、实际加载集合与渲染采样，不能由其中一个推导全局 FPS。

## 本次正式试点结果

2026-09-13 已写入本地正式 TNO 目录。485 目标面、315 法国面及其余非目标身份检查通过；189 分块完整性及 8 种混合 LOD 组合通过。全局 coarse 与 BRG/GER/RKN detail 共 4 分块变化，其余 185 个不变。全部分块同口径 gzip 增加约 8.19%，启动包增加 68/70 字节。

真实浏览器确认加载 121,378 个目标坐标，并通过德国、比利时、荷兰各一个地块的填色/撤销。局部缩放采样中位数约 4.60 -> 4.50 ms，最大重绘样本约 826.6 -> 892.8 ms；这是小样本，不是全局性能保证。沿岸色带、未升级邻国接缝仍可能存在。离线构建内存曾观察到约 11.2 GB，需要在大规模批量替换前继续优化。

保护面裁剪新增回归：范围求交可能得到同时含多边形与接触线的 GeometryCollection，不能直接依赖其 boundary；须递归收集多边形边界。此次保留所有原严格裁剪条件，未通过放宽面积阈值掩盖缺陷。
