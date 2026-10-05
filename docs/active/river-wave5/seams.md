# Wave 5：五个 held parents 接缝复核

结论：**五父继续暂缓，未准入**。在 `bb510a54` 的源数据与既有算法上，
完整 307 父候选可保持已批准 302 父的全部记录、cell IDs 与 geometry，
但仍增加三对跨父共享边。没有找到同时保持源坐标、完整切分和现有身份契约的安全修复；
本次不修改生成器、批准包、runtime 或验收容差。

## 真实全地图结果

使用 11,983 个交互源面；baseline 为正式 `modern_world_wave3.json`。
构建得到 307 父 / 938 cells / 106 support / 2,014,125 UTF-8 bytes。
生成器兼容检查通过，302 个旧父记录变更为 0；完整地图检查返回失败：

| 父对 | baseline 长度（度） | 候选长度（度） | 新增长度（度） | 源面重叠面积（平方度） |
| --- | ---: | ---: | ---: | ---: |
| Zungeerqi `CN_CITY_17275852B50201707862643` / Hequxian `CN_CITY_17275852B70463469741157` | 0 | 0.004221672835697853 | 0.004221672835697853 | 0.0007811350726231095 |
| Dalateqi `CN_CITY_17275852B68283317499250` / Baotou `CN_CITY_17275852B83584927302596` | 1.0272885623316328 | 1.0950776217489766 | 0.06778905941734381 | 2.5579794285315164e-16 |
| Kleve `DEA1B` / Arnhem/Nijmegen `NL226` | 0 | 0.032353447539548 | 0.032353447539548 | 8.043690995253409e-05 |

其余邻接无差异；baseline 与候选的全部内部 seam 检查通过；旧父内部 seam 无变化。
`invalidRings` 0→0，`ambiguousSegments` 550→550，无新增歧义位置。
以上正常指标无法抵消新增共享边，完整地图 verdict 仍是 FAIL。

## 根因与修复边界

新增三段均沿行政**外边界**，并非两个父面内河线切缝的重合。
源边界的分段端点不同，精确坐标下几乎共线，新增段中点至两侧源边的距离为
约 6e-16 至 8e-15 度。原始长边经 runtime 的 1e-7 身份网格取整后，
具有不同的整数直线方向；河线交点将两边截出相同的短段后，图将其认作共享边。
NL226 的交点同时被 joint noding 插入未切分的 DEA1B support。

下表列出整数网格线的约分方向 `(dx, dy)`；三对原始方向均不相同：

| 父对 | 第一条源边 | 第二条源边 | 新共享短段 |
| --- | --- | --- | --- |
| Zungeerqi / Hequxian | (1080011, -260376) | (90001, -21698) | (41041, -9894) |
| Dalateqi / Baotou | (90001, 21698) | (1080011, 260375) | (329505, 79439) |
| DEA1B / NL226 | (288003, -34717) | (720007, -86792) | (321209, -38720) |

Dalateqi / Baotou 的偏差主要体现源边分段与浮点表示；不能把它等同于后两对明显的面积重叠。
三个案例都不是普通遗漏 joint node：两侧新增短段已经有相同端点，补齐共同节点会加强匹配。
调整身份精度、挪动交点、重画或裁掉重叠、以及为逃避整数共线匹配添加任意中间点，
都没有源数据契约或行为证据支持。本次未采用这些方法。
未来若改变源面或 runtime 边界语义，须另立明确契约；现有全图门禁保持有效。

## 回归与复现

`tests/fixtures/river_paint/held_seams.json` 保存六个有关源面、五个候选父及 DEA1B support 的精确坐标，
并以不相关且保持不变的 AT130 作为 baseline 父。fixture 不修复、取整或删减 polygon 顶点。
`tests/river_held_seams.test.mjs` 的两项测试调用真实 `verifyContours`：
检查三对新增边被拒绝、旧记录和内部 seam 不变，以及从原始端点重新计算身份网格直线差异。
实际结果为 2/2 通过。该回归无需再次构建全世界数据。
另运行生成器现有 Python 测试 33/33 通过；独立 Shapely 核对确认 fixture 的七个源面
逐坐标等于当前土地输入、AT130 逐字段等于批准记录、两份内部 seam 预期与真实覆盖计算一致。

本次运行 owner 为 `wave5_seams`，所有离线产物独占 `.runtime/rv5-seams/`：
`build307.log`、`joint307.json`、`joint307.audit.json`、`inputs307.json`、
`contours307.json`、`verify307.log`、`source-edges.json`、`diagnosis.json`、`test-held.log`。
独立 fixture 与生成器检查日志分别为 `fixture-check.log`、`test-generator.log`。

```powershell
python -X utf8 -B tools/build_river_partitions.py --land data/scenarios/modern_world/runtime_topology.topo.json --selection tools/river_partitions/selections/wave3-joint.json --include-lake-centerlines --scene-id modern_world --max-parents 307 --compare-against data/river_partitions/modern_world_wave3.json --output .runtime/rv5-seams/joint307.json
python -X utf8 -B tools/river_partitions/prepare_contour_inputs.py --land data/scenarios/modern_world/runtime_topology.topo.json --baseline data/river_partitions/modern_world_wave3.json --candidate .runtime/rv5-seams/joint307.json --output .runtime/rv5-seams/inputs307.json
node tools/river_partitions/verify_contours.mjs --input .runtime/rv5-seams/inputs307.json --baseline data/river_partitions/modern_world_wave3.json --candidate .runtime/rv5-seams/joint307.json --output .runtime/rv5-seams/contours307.json
node --test tests/river_held_seams.test.mjs
```

前两条退出码为 0；完整地图验收退出码为 1，原因仅为上述三对新增边；回归测试退出码为 0。
这不是 307 父的 runtime 或浏览器验收，也不授予这五父上线资格。
