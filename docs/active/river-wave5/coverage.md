# Wave 5：覆盖缺口复审

本工作面完成 **82 个新增父 / 338 个完整分区**的离线几何和源叠加复审。与旧 302 父共同重建得到 **384 父 / 1,243 分区 / 108 support**，旧 302 父的全部父几何、cell ID 和 cell 几何保持逐项相等。整合者的全图轮廓 gate 又排除 8 个新增父，因此供正式准入的收敛清单为 **74 新父 / 259 新分区，合计 376 父 / 1,164 分区**。最终联合准入以整合者的 `wave5-reviewed.json` 和对应轮廓收据为准；不能把本页的离线 PASS 当作全图或运行时 PASS。

没有为了达到最初 100–180 父目标，纳入已见主要沿父边界的细带。剩余模型预算保留，当前批次仍对八条河的主要覆盖缺口有明确收益。

## 输入与范围

- Worktree：`C:/Users/raede/.codex/worktrees/river-paint-integration/mapcreator`；基线 `bb510a54997c66f9bd161bc5fd5537509ce8c37a`。
- Land：`data/scenarios/modern_world/runtime_topology.topo.json`，`sha256:917320332f37571d2fa1cca21881e0b5fc2cc9ede4966abe914a1e9259eabf1e`。
- Rivers：`data/global_rivers.geojson`，`sha256:60dbebd1fc2d4f9ba8b6d5327a99960c6bfcbe9c6df1d5d4508d0b70fa950a04`。
- Ownership baseline：`7ee2527fd2eef0f5f50356a3e41089499f08c0573b642be295453389fbdc8966`。保留既有 river aliases 和 lake centerlines。
- 复用 `6f5a/.runtime/river-eu/` 五个广域包和 `f7ce/.runtime/river-east/broad.json`，当前字节摘要和每个缓存父的原始坐标逐项核对；缓存不等于沿用历史审计结论。本次重新进行几何、ID 与源线检查。
- 长江、黄河既有合格范围保持原选择。已读中国报告的未切开和旧轮廓失败记录，没有将其自动加入；本次新增复审集中于欧洲和东欧八河。
- 生成器使用 `.runtime/rv5-coverage/generator-baseline.py` 固定副本。该工作面不改生成器、源、正式 pack、runtime loader、导航或 dist。

## 选择与走廊

八河广域包中有 289 个未批准切开父。本次独立几何审计后，3% 的实际次要切割面比例阈值给出 103 个视觉待审项；另检查 29 个 2–3% 项，合计 **132 个源叠加面板**。比例只用于复审排序，既不是 validity 容差，也不是自动准入门槛。

统计按每个实际被分开的原 Polygon component，累加除最大面以外的其余面面积，除以原父总面积。原有独立岛屿不能被算成第二岸。任何正面积碎片均完整保留，不删小片，不补线，不 snap，不修改 source，不放宽生成器容差。

逐图暂缓 50 个主要沿父边界的细带、外缘组件或既有全图排除项；剩余 82 个是可辨的跨组件主体或明确岸侧瓣。机器可读记录含 `parentId / name / country / rivers / cells / status / reason / checks / visualEvidence / visualPanel`。河流来自当前选定源线的内部交段，不能从国家反推。

| 河流 | 离线新增父 | 联合收敛新增父 | 重点补充 |
| --- | ---: | ---: | --- |
| Danube | 16 | 16 | 德国上游连接区、奥地利中段、Bratislava I/IV、Pest 与 Brăila；下游国界长细带仍暂缓 |
| Dnieper | 12 | 9 | Myronivka、Kakhovka/Solone、Smolensky/Kardymovsky/Yartsevsky；Belarus 重叠源父转入联合排除 |
| Don | 9 | 8 | Bagayevsky、Bogucharsky、Ostrogozhsky、Kurkinsky 与中下游明确岸侧瓣 |
| Elbe | 4 | 4 | Náchod、Anhalt-Bitterfeld、Wittenberg、Lüneburg 的连接区 |
| Oder | 6 | 6 | kędzierzyńsko-kozielski、opolski、brzeski、wrocławski、nowosolski、zielonogórski |
| Rhine | 10 | 9 | Zürich、Worms/Wiesbaden、Mayen-Koblenz、Rhein-Sieg、Duisburg、Zuidwest-Gelderland |
| Seine | 7 | 7 | Provins、Paris 周边 Créteil/Haÿ/Boulogne/Nogent/Saint-Denis/Argenteuil |
| Volga | 18 | 15 | Saratov 至库区的明确岸侧瓣、Yenotayevsky/Chernoyarsky、Zubtsovsky、Penovsky/Kineshma |

这些是源地理走廊的补点，不证明全河连续、所有城镇启用，或行政名称与现实最新版本一致。

## 覆盖收益

按选定源河线落在候选父域并集内的**平面角长度**统计。并集消除重叠重复计数；该指标不是公里、面积、现实河道精度或功能完成率。记录在 `.runtime/rv5-coverage/coverage-metrics.json`，以旧 302 父和整合者 376 父 pack 计算。

| 河流 | 旧 302 父 | 联合收敛 376 父 |
| --- | ---: | ---: |
| Danube | 19.85% | 39.78% |
| Dnieper | 29.86% | 45.63% |
| Don | 52.05% | 68.44% |
| Elbe | 62.06% | 77.85% |
| Oder | 35.45% | 58.41% |
| Rhine | 13.60% | 30.49% |
| Seine | 79.52% | 92.81% |
| Volga | 30.98% | 51.39% |
| Huang | 74.55% | 74.55% |
| Yangtze | 89.86% | 89.86% |

## 实际验证与准入边界

本次联合 384 pack 新增 82 父再次独立复核：父及所有正面积 face 有效，父与 cell 指纹一致；覆盖差最大 `1.3481647439042566e-15` 度²，父内重叠全部 0，Hausdorff 最大 `7.105427357601002e-15` 度，离开所选源河线 `1e-9` 度审计邻域的内部 seam 长度全部 0；反向河线重生成 cell ID 全部相等。容差沿用 `max(1e-14, parentArea*1e-12)` 和 `1e-9` 度。缓冲只用于审计，不改坐标。

`combined.audit.json` 的 comparison 为 PASS，old/retained/unchanged 均为 302，missing/changed 为空。联合 pack 身份为 `sha256:d512f4e1a312dd6e249ac7ff0bc0f46967298ebd2b83440bad9d1ff7042c521c`，2,484,325 bytes。支持邻居可以重新生成或晋升为父，不代表旧父身份发生变化。

既有五个 held 父全部排除于新 selection 和 combined 可编辑父集：`CN_CITY_17275852B50201707862643`、`CN_CITY_17275852B68283317499250`、`CN_CITY_17275852B70463469741157`、`CN_CITY_17275852B83584927302596`、`NL226`。held 父可能仅作为未切开的轮廓 support 出现。

整合者全图检查发现跨父源重叠、内部 seam 或共享边交互，另排除以下 8 个离线合格新增父：`BY_INT_GOMEL`、`BY_INT_MOGILEV`、`DEA1B`、`RU_CITY_VOLGOGRAD`、`RU_RAY_50074027B24471111608761`、`RU_RAY_50074027B51726500082089`、`RU_RAY_50074027B61241799946425`、`UA_RAY_74538382B4751802602524`。源父内 PASS 不证明全地图邻接无问题，不通过删碎片或修改源掩盖此区别。

`python -m unittest tests.test_river_coverage` 实际通过 3 项：未切岛屿不计第二岸、仅统计实际切开 component、微小正面积面不被忽略。图集 `atlas-01.png` 至 `atlas-11.png` 的 132 个面板全部实际检视。图集只证明供应 source 叠加，不证明真实世界位置或库区现状；特别是第聂伯河旧 lake centerline 不能冒充当前现实水体证据。

全图图构造、实际 picker / Canvas / Undo / 导入导出、运行时 asset 认证、压缩传输、CI 与发布由整合者负责，本页不独立声称它们通过。

## 可重复命令与交接

新 `tools/river_partitions/survey_coverage.py` 是单一复审工具，不修改 source 或自动批准 pack。`wave5-new.json` 为严格 disjoint 82 父 selection；`wave5-combined.json` 为旧 302 与它的联合；`wave5-review.json` 为逐父视觉判断和 50 个暂缓项。最终正式准入使用整合者拥有的 `wave5-reviewed.json`。

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
python tools/river_partitions/survey_coverage.py --land data/scenarios/modern_world/runtime_topology.topo.json --rivers data/global_rivers.geojson --approved data/river_partitions/modern_world_wave3.json --generator .runtime/rv5-coverage/generator-baseline.py --pack .runtime/rv5-coverage/combined.json --output .runtime/rv5-coverage/combined-new-audit.json
python tools/build_river_partitions.py --land data/scenarios/modern_world/runtime_topology.topo.json --rivers data/global_rivers.geojson --scene-id modern_world --base-commit bb510a54997c66f9bd161bc5fd5537509ce8c37a --baseline-hash 7ee2527fd2eef0f5f50356a3e41089499f08c0573b642be295453389fbdc8966 --include-lake-centerlines --selection tools/river_partitions/selections/wave5-combined.json --compare-against data/river_partitions/modern_world_wave3.json --max-parents 512 --output .runtime/rv5-coverage/reproduced.json
python -m unittest tests.test_river_coverage
```

实际本次构建通过固定副本执行；完整调用参数、owner、日志和退出条件保留在 `.runtime/rv5-coverage/build-command.json`，日志为 `build.log`。生成器变更后复现须说明版本，不能把新版本的输出当作固定副本的字节级再现。所有一次性证据留在 `.runtime/rv5-coverage/`。
