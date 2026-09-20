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

## 2026-09-20 扩容试验（视觉验收未完成）

英国、卢森堡、意大利、奥地利、波兰、乌克兰、白罗斯、爱沙尼亚、拉脱维亚、立陶宛、西班牙、葡萄牙共1305个现有ID已写入本地试验数据。目标坐标数40092→251093；10714个非目标面和6个辅助对象保持几何不变，owners/cores/countries文件保持字节不变。源映射与白罗斯聚合成员记录见`docs/active/europe-precision-20260920/sources.json`。乌克兰使用既有缓存源恢复精度，不代表获得了更新或最高精度的行政区数据。

各国单独coverage检查及30种混合控制国LOD组合通过。圣马力诺外围原有覆盖通过显式飞地锚点保留，其他源孔洞不填充。覆盖守恒默认仍严格；此次仅对EPSG:4326启用最大1e-9度的浮点边界残差诊断带，不移动坐标，不接受内部缺口。

全部分块同口径gzip(level6)体积34,330,285→42,887,113字节（约+24.9%），英文/中文启动包分别只增127/126字节。现有构建器按大小预算拆分FRA/GER/USA，清单189→198块；全部政治ID完整，非政治分块不变。离线构建观察到峰值工作集约10.3GiB。浏览器确认候选指纹和12国实际几何，完成GB/PL/ES/IT及SM点击填色/撤销。候选局部暖缓存缩放31个渲染样本中位4.8ms、最大61.3ms；自动fit投影与基线不同，不能把它当作严格的前后性能比较或全局FPS保证。

用户指出RKP/RKU处明显接缝后，放大检查证实两套原始源边界之间仍存在大片未分配陆地，细化内部边界并未解决跨源拼接。完整诊断见`docs/active/europe-precision-20260920/seam-findings.md`。因此本次状态为本地试验已集成、视觉验收未通过；不把coverage有效、契约通过或分块完整性等同于边界无缝。原数据备份位于`.runtime/tmp/europe-precision-20260920/baseline/tno_1962/`。

后续获准修复后，PL/UA交界5段已确认陆地空白已全部补齐，共1384.51km²。仅扩展11个现有UA地块、增加191个坐标，保留TNO原归属及全部原有领土；波兰、白罗斯、斯洛伐克已有几何不变。修复入口为`tools/repair_tno_poland_ukraine_seams.py`，必须在精度扩容之后重放。它按原行政区交界和固定对岸顶点划分新增区域，并独立拒绝残留的跨源陆地空白。该边界插补不代表取得了新的历史边界资料。

PL/UA局部视觉验收通过：5处真实点击/填色/撤销命中预期ID，RKP/RKU/HUN细节分块成功加载，12种混合LOD组合与集成后的strict契约通过。runtime同口径gzip仅增5703字节，英文启动包增45字节，分块总数仍为198。修复前备份位于`.runtime/tmp/tno-seam-20260920/baseline/`；本次并未将其他UA/SK、UA/BY接缝或整个欧洲宣告为视觉验收通过。

重放顺序为NUTS八国共同处理（GB/IT/AT/EE/LV/LT/ES/PT，显式保留SM外围），随后依次LU、PL、UA、BY，每步以上一步runtime为基线，避免把不同源直接作为合法联合coverage输入。源准备入口为`tools/prepare_tno_western_precision_sources.py`与`tools/prepare_tno_eastern_precision_sources.py`，候选使用`tools/pilot_tno_regional_precision.py`的`_assemble_candidate`，派生物使用`tools/regional_scenario_assets.py`及契约安全重建。最终校验入口为`tools/validate_tno_precision_expansion.py`。安全重建后先刷新过期JSON.gz，再生成绑定压缩启动包的snapshot/audit，最后运行strict契约；否则HTTP实际内容可能与JSON或snapshot不一致。
