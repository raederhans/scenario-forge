# 已审计接缝修复 — 2026-10-05

本轮承接东欧/中欧及南欧/小亚细亚/黎凡特审计，执行三项修复：全局公共边界的混合 LOD 生成、黎凡特同 ID 来源恢复、巴尔干及小亚细亚的来源接缝恢复。工作分支为 `codex/europe-land-gaps`，主 checkout 的其他工作不在本次写入范围。

## 实现与约束

政治粗层现在按实际 detail shard 联合简化，保持每个独立加载单元的外轮廓，取消实际生成路径逐地块取整。已有重叠、无效 coverage 边及不能证明 union 不变的组保留输入轮廓。原 precision 声明允许块内联合简化的语义继续保留，没有全局 buffer 或扩大描边。算法是共享生成器的全局改进；正式资源接入范围须以本次重建及验收记录为准。

`validate_mixed_lod_coverage.py` 将每个 chunk 看作 coarse/detail 的原子选择。对第 i 个 chunk 的两种覆盖 Cᵢ、Dᵢ，任意加载组合的保证覆盖为 `G = union(Cᵢ ∩ Dᵢ)`。同一加载状态下可能暴露的旧覆盖损失为 `union((C旧ᵢ - C新ᵢ) ∪ (D旧ᵢ - D新ᵢ)) - G新`。工具在原始政治来源陆地及新增区域内检查回归，并要求新增来源支持面积在全部组合中存在；该集合公式已经与显式穷举的重叠、缺失单元案例对照，不需要枚举全球所有组合。它只验覆盖，不替代归属、重叠、水域或浏览器验证。

修复工具固定已审计缺口、来源版本和 ID，仅增加同 ID 来源支持的空缺。现有地块领土、属性、owners/controllers/cores 保留；跨来源冲突不能因为 owner 相同就任意分配。死海、黑海沿岸等需要地表定义审查的区域不自动补为陆地。

## 复现入口

- `tools/repair_tno_slovakia_ukraine_seams.py`：四个 SK ID 的来源支持部分。
- `tools/repair_tno_levant_seams.py`：叙利亚沙漠、PAL–LEB、黎巴嫩内部、Jerusalem–West Bank 四处同 ID 接缝。
- `tools/repair_tno_balkan_anatolia_seams.py`：已恢复 pinned BIH 来源，以及 NE/NUTS 同 ID 的无冲突支持区域。
- `tools/regional_scenario_assets.py`：保留 scenario 元数据、重建受影响 detail 与全局 coarse。
- `tools/build_tno_russia_precision_assets.py::finalize_stage`：复用现有通用 staging 收尾实现，同步 startup、gzip、snapshot、audit。
- `tools/validate_mixed_lod_coverage.py`：任意独立加载状态覆盖 gate。

每份候选报告记录输入和来源身份、实际恢复与残余面积、changed IDs、编码及邻接检查。候选首先保存在 `.runtime/tmp/reviewed-seam-repairs-20261005/`；检查结果在 `.runtime/reports/generated/reviewed-seam-repairs-20261005/`，浏览器证据在 `.runtime/browser/reviewed-seam-repairs-20261005/`。

## 已接入结果

三项实现已接入本独立工作区的正式 `data/scenarios/tno_1962/`，共更新 26 个既有资源文件，含全局 coarse、11 个受影响 detail 文件、runtime、startup、mesh 和关联 manifest/snapshot。其他 scenario 使用共享生成器时会获得同一算法，但本轮没有重建其资源。主 checkout 未写入，没有提交、推送、生产部署或线上验证。

| 修复组 | 原 ID 数 | 真实新增覆盖 km² |
| --- | ---: | ---: |
| SK/UA 来源支持部分 | 4 | 18.011944558 |
| 黎凡特四处接缝 | 13 | 229.519909913 |
| 巴尔干／小亚细亚四处接缝 | 12 | 283.032512860 |
| 合计 | 29 | 530.564367212 |

实际新增从组合候选减去所有相交旧政治面计算；未选面及属性没有变化，owners/cores/countries 和手工归属输入字节不变，辅助对象几何完全相同。7 个目标面逐 ID 差集有最大 3.07e-16 deg² 浮点薄片，低于既有 1e-12 deg² 容差；不将其表述成逐坐标完全相同。巴尔干部分类几何运算还产生零面积线残余，已显式记录并仅保留面部分；没有用 buffer、snap 或 make_valid 补地。

| 已审阅缺口 | 本轮恢复 km² | 尚余 km² |
| --- | ---: | ---: |
| Uzhhorod 北侧 | 17.95 | 250.24 |
| Uzhhorod 南侧 | 0.06 | 0.20 |
| 叙利亚沙漠 | 172.42 | 约 0 |
| PAL–LEB | 27.18 | 约 0 |
| 黎巴嫩内部 | 16.13 | 约 0 |
| Jerusalem–West Bank | 13.79 | 约 0 |
| 波黑—黑山—塞尔维亚 | 120.99 | 210.64 |
| Aleppo–Kilis–Hatay | 70.37 | 153.18 |
| Raqqah–Şanlıurfa | 58.14 | 55.71 |
| Hasaka–Mardin | 33.54 | 47.73 |

上表残余合计约 717.70 km²，仅指这十处已审阅缺口，不是整个区域的剩余缺口总量。巴尔干、小亚细亚来源冲突面积分别为 43.31、2.35、0、1.89 km²，均留在残余中。两个 SK 原探针和 Hasaka–Mardin 原探针仍位于残余；没有把全部空缺清零，也没有修改死海／黑海的地表定义。下一步需要对应残余的可核对来源分区及历史归属证据。

## 测量修正与来源

真实 SYR-137、SYR-141、TRC11 碎片证明 GEOS `segmentize` 会静默把有效正面积面压到近零。新增 `map_builder/geo/measurement.py` 对测量副本逐边插点，保留每个原顶点，不通过 GEOS 重建边界。审计用局部 LAEA，统一组合核算用 EPSG:3035；实际数据坐标未因此变化。数值无效的测量副本显式给出 `measurement_valid=false`，宽度留空。四个真实碎片及孔洞、多部件、加密收敛有回归测试。

最终面积以 `restoration-area-v3.json` 为准，替代旧候选报告中的 km² 字段。0.001° 与 0.0005° 测量步长的总新增差为 2.84e-7 km²；分组和 union 差为 7.15e-9 km²，十处缺口的面积守恒误差合计 1.54e-7 km²。

来源身份固定为 geoBoundaries SVK ADM2 `9469f09`、BIH ADM1 `90a1d52`、GISCO NUTS 2021 1M、Natural Earth Admin1 5.1.1。工具校验原始字节 SHA；NE 的 DBF、CRS、编码等 sidecars 一并绑定。巴尔干 lane 由验证后的同一内存字节快照读取 ZIP，避免误读目录外同名 sidecar。湖泊面作为排除项；河流线不虚构 buffer。

## 验收

- `actual-global-mixed-lod.json`：实际构建 manifest 的 12,035 个政治 ID、191 个独立 detail 单元，完整全球范围通过。candidate 来源未保证覆盖面积为 0；原有来源未保证覆盖面积为 0；新增差集再叠加的数值残差为 1.55e-17 deg²。baseline 旧 coarse 的 AQ 存在自交，所以明确使用更强的 `--full-source-coverage` 模式，直接要求所有原始／新增来源陆地在所有候选组合中保留；未跳过坏面或修改旧几何来制造基线通过。
- staging 与本地正式数据的 `check_scenario_contracts.py --strict` 均通过：0 errors、0 warnings、0 forbidden violations。canonical 写入后逐文件字节核对，旧版本备份在 `.runtime/tmp/reviewed-seam-repairs-20261005/canonical-before/`。
- 全局生成与分片／区域重建回归：61 tests、553 subtests 通过。测量、三条修复 lane、组合覆盖工具的 113 个目标测试最终分批通过。JS 分片载荷与验证路由测试通过。
- `build_data_catalog.py` 已执行，672 条入口，无语义变更；`data_health.py` 通过，仅既有大文件提示；catalog contract 19 tests 通过。`git diff --check` 通过。
- localhost 浏览器检查：黎凡特四探针对应 LBN-3060、LBN-3059、ISR-3058、JOR-850；巴尔干主探针对应原 BA ID，阿勒颇主探针对应 SYR-137，均在加载完成的 idle 帧确认。LBN-3060 原缺口点击生成真实 `fill-feature-color` 历史记录，撤销后恢复原色。2111%／3200%／5000% 视图有截图；没有做全页面巡检或完整 console 事件捕获。一次尝试串行检查所有全球面超过浏览器工具时间限额，后改为检查探针所在区域的实际面，未改应用行为。

最终 coarse 原始大小 59,100,483 bytes，低于现有 64 MiB source-byte 预算；同 gzip-6 测量从 15,639,439 增至 17,876,108 bytes，约 +14.3%，未提高缓存预算。单次本地 coarse 可交互时间由 8.30s 到 8.04s；并行构建和缓存因素未受控，只证明本次能正常启动，不作为性能改善结论。

机器报告在 `.runtime/reports/generated/reviewed-seam-repairs-20261005/`；浏览器结果在 `.runtime/browser/reviewed-seam-repairs-20261005/coverage-and-edit.json`，截图 `levant-close-restored.png`、`balkan-restored.png`、`anatolia-restored.png`。这些是本地验收证据，不能替代 CI 和线上发布证据。
