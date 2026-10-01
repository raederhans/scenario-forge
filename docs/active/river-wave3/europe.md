# 欧洲沿河填色 Wave 3 离线候选

本对话交付 **60 个新增父地块 / 151 个完整分区**，覆盖 Seine、Elbe、Oder、Rhine、Danube 的沿河走廊与关键城镇。候选仅在本 worktree 的 `.runtime/river-eu/` 中，尚未进入批准清单或运行时。生成器、场景源、两份正式包、loader、registry、CATALOG、dist 均未修改。

基线：`main@2da4db61c3533f621afe2be0fe6ff494d567eb92`（PR #194 已合并）。
独立 worktree：`C:/Users/raede/.codex/worktrees/6f5a/mapcreator`。
分支：`codex/river-wave3-europe`；只有本报告和 `tools/river_partitions/selections/europe.json` 纳入提交。

## 源身份与统计口径

- Land：`data/scenarios/modern_world/runtime_topology.topo.json`，32,568,268 字节，`sha256:917320332f37571d2fa1cca21881e0b5fc2cc9ede4966abe914a1e9259eabf1e`。
- Rivers：`data/global_rivers.geojson`，5,590,332 字节，`sha256:60dbebd1fc2d4f9ba8b6d5327a99960c6bfcbe9c6df1d5d4508d0b70fa950a04`。
- 当前 manifest 的 ownership baseline：`7ee2527fd2eef0f5f50356a3e41089499f08c0573b642be295453389fbdc8966`。这是归属摘要；几何身份另由上述 land digest 与逐父指纹证明。
- 两个源 digest 均与正式 wave-2 包一致；未依赖旧 Oder 缓存，五条河都从当前源重新生成。
- 名称按生成器的 `name` / `name_en` 精确匹配，并开启现有 lake centerline 选项：Seine=`river_399`；Elbe=`river_636`；Oder=`river_622`；Rhine=`Rhein/river_392`、`Rhein/river_394`（Lake Centerline）、`Rhin/river_396`、`Rhine/river_619`；Danube=`Donau/river_397`、`Danube/river_1273`。只检索本地 `name` 会漏掉 Rhin 段。
- 源 scalerank：Seine/Oder/Rhine 为 4，Elbe 为 5，Danube 为 2。Rhine 和 Danube 具备本任务所需的主要河流范围。
- 全面统计指普通可交互父地块与所选河线实际相交后，生成器得到的 partitioned/uncut 项。广域 audit 中每条河重复出现的 10,965 个 `excluded_auxiliary` 是全地图辅助层过滤，**不是欧洲河段相交地块数**，不计入下表。

## 全范围分类

“候选”表示离线几何、源线吻合、稳定 ID、前端结构与叠加图审查通过，供主对话准入；“待修”表示叠加图已见精度/用途问题；“下一层待审”仅几何通过，不能自动准入；“未切开排除”是当前源无法闭合完整切割；“原批准”继续沿用历史记录。

| 河流 | 相交父域 | 全部切开父域 / 分区 | 新增候选 / 分区 | 待修 | 下一层待审 | 未切开排除 | 原批准 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Seine | 25 | 24 / 78 | 10 / 33 | 0 | 12 | 1 | 2 |
| Elbe | 30 | 28 / 90 | 16 / 36 | 1 | 9 | 2 | 2 |
| Oder | 37 | 36 / 132 | 8 / 20 | 2 | 24 | 1 | 2 |
| Rhine | 58 | 56 / 168 | 10 / 25 | 4 | 42 | 2 | 0 |
| Danube | 72 | 70 / 216 | 16 / 37 | 4 | 50 | 2 | 0 |
| 总计 | **222** | **214 / 684** | **60 / 151** | **11** | **137** | **8** | **6** |

选择清单保存每个候选的 canonical parent ID、源名称、区段、选择理由、分区数、最小面平面占比、对应 atlas 与审计路径；还保存全部待修、未切开及下一层待审 ID。`corridor` 是按父域位置组织的地理规划标签，不是测量河里程。

## 沿河组织与视觉判定

- **Seine**：Montbard → Troyes → Nogent → Fontainebleau/Melun → Évry → 原批准 Paris → Nanterre/Saint-Germain → Mantes/Andelys → 原批准 Rouen。不是只选 Paris 附近二分点；Troyes、Nogent、Melun 的 4–5 面保留，Nogent 的原洞也保留。Havre 源端点停在父域内，河口不能称为已完整覆盖。
- **Elbe**：Hradec/Pardubice → Kolín/Nymburk/Prague-East → Mělník/Litoměřice/Ústí/Děčín → Sächsische Schweiz/Dresden/Meißen → Dessau/Salzland/Magdeburg → 原批准 Jerichower/Stendal → Hamburg。补上捷克城市间与中游连接段，Hamburg 保留五面及源多支线；下游若干边界区仍待审，Prignitz 暂缓。
- **Oder**：Nový Jičín/Ostrava → raciborski/krapkowicki → 原批准 Opole → oławski → 原批准 Wrocław → głogowski/krośnieński → Szczecin。德波边界用途确实重要，但 DE409 与 gryfiński 的主体单侧、窄条重复进出，不能为了连续外观纳入。此段明确有缺口。
- **Rhine**：Schaffhausen/Basel → Speyer/Mainz → Koblenz/Bonn/Köln/Düsseldorf → Wesel → Arnhem/Nijmegen。Rhein/Rhin/湖中心线均已纳入源选择；瑞奥和法德边界窄条暂缓。荷兰源线没有覆盖完整入海多支系统，不能宣称全河连续。
- **Danube**：Tuttlingen/Sigmaringen → Alb-Donau/Ulm → Dillingen/Donau-Ries/Ingolstadt/Kelheim/Regensburg/Deggendorf/Passau → Wien/Bratislava II → Budapest → 南巴奇卡/Belgrade。新增六个德国连接父域，减少只挑孤立城市的偏差。Iron Gates–河口已全面生成和抽查，但本轮源精度不足，下游候选暂缓；**本轮未实现 Danube 上中下游无缺口覆盖**。

实际叠加审查共 71 个初选/连接候选：最初 61 个的十张 atlas，加 Elbe/Danube 的两张 supplement atlas。最终保留 60 个，11 个待修。每条河另有一张最终走廊图和一张复杂地块/最小面放大图。蓝线是所选真实源河线，黑线是原父边界，颜色是未删减分区；这里的“真实源”指仓库数据，未与外部实测河道独立校准。

重点证据：

| 河流 | 文件（均在 `.runtime/river-eu/`） | 判定 |
| --- | --- | --- |
| Seine | `seine-atlas-1.png`、`seine-focus.png` | Nogent 五面、原洞与约 0.012% 小面保留；Troyes 主体跨岸与小面并存。不能仅因最小面小就删除整个父域。 |
| Elbe | `elbe-atlas-2.png`、`elbe-focus.png`、`elbe-supplement-1.png` | Hamburg 主体分区可辨，悬支不补长；约 0.015% 边缘小面保留。Prignitz 主要为沿边界窄条，暂缓。 |
| Oder | `oder-atlas-1.png`、`oder-atlas-2.png`、`oder-focus.png` | raciborski 主体跨岸且四面完整；DE409 与 gryfiński 主要为边界薄条，暂缓。 |
| Rhine | `rhine-atlas-1.png`、`rhine-atlas-2.png`、`rhine-focus.png` | Düsseldorf 五面包含可辨重复进出面；瑞奥/法德边界四地暂缓。 |
| Danube | `danube-atlas-2.png`、`danube-focus.png`、`danube-supplement-1.png` | Belgrade 的 Danube 主体跨岸可辨，Sava 淡蓝叠加作汇流上下文，未将 Sava 偷加为切割源；下游边界/河口四地暂缓。 |

## 待修与排除

11 个待修父域的完整分片仍保存在广域包中；没有删面、snap、端点延长或放宽检查容差。

| 河流 | 父 ID | 具体问题 |
| --- | --- | --- |
| Elbe | `DE40F` | Prignitz 河线沿父边界反复进出，新增面主要为窄条；需源精度审查。 |
| Oder | `DE409`, `PL_POW_3206` | 德波边界的 6/10 面主要贴在单侧，不能冒充跨岸主体分区。 |
| Rhine | `CH055`, `AT342`, `FR_ARR_67008`, `DE122` | 瑞奥、法德或局部父界错位薄条；Karlsruhe 仅有约 0.85% 窄条。本轮不准入。 |
| Danube | `RS221`, `RO413`, `RO314`, `RO225` | 铁门、罗塞/罗保边界与河口父域出现连续薄条或极少局部切入；Tulcea 三面不证明三角洲完整多支覆盖。 |

8 个未切开的排除项：Seine `FR_ARR_76002`；Elbe `DED53`、`CZ_ADM2_57006924B50363024387408`；Oder `CZ_ADM2_57006924B13474079400168`；Rhine `CH056`、`NL33A`；Danube `DE136`、`UA_RAY_74538382B95291552499633`。它们都有当前源线悬段/端点，不制造补长来得到 PASS。其逐父原因与悬线长度见 `survey.json` / `classification.json`。

137 个下一层候选 ID 完整列在 selection 的 `nextReview` 中。优先补齐走廊缺口和 border 精度审查，其后才考虑扩增城市数量；它们尚未完成视觉准入。

## 实际审计结果与体积

- 五个广域包共 **214 父 / 684 分区**，全部做独立逐父有效性、正面积、父指纹、覆盖、两两重叠、Hausdorff、反向河线和反向原环的稳定 ID 检查；214/214 通过。
- 最大覆盖对称差 `9.412568923068687e-16` 平方度；重叠面积全部 `0`；最大 Hausdorff `3.552713678800501e-15` 度。单位是源平面，不能当作 geodesic 面积。
- 每个父域内部切缝在原父边界的现有 `1e-9` 度检查邻域外，均包含于所选河线 `1e-9` 度邻域；离开源线邻域的切缝长度全部 `0`。缓冲只用于审计，未修改输入或输出坐标；它证明与源线吻合，不证明独立现实精度或屏幕像素无缝。
- 前端 `normalizeRiverPartitionPack`、`verifyRiverPartitionFingerprints` 与仓库 vendor D3 对五个广域包和最终候选包均通过：所有分区球面面积为正且小于半球，Mercator 预览面积为正、SVG 坐标有限。实际 UI 选取、Canvas 接缝、Undo/Redo、导入/导出尚未在新包上验证。
- 最终候选：**60 父 / 151 分区 / 64 support**，**781,876 字节**，19,545 坐标（含父域及 support 的原/辅助几何），低于现有 250,000 坐标预算。
- 广域 compact pack 体积：Seine 195,905；Elbe 339,331；Oder 279,413；Rhine 170,878；Danube 442,878 字节。这些未注册为 runtime asset。
- 官方 CLI 精确复现最终候选，JSON 内容逐项相等；pack ID 为 `sha256:2fa1cb8655636f54dc81eef28794cc44d4c75d4b208fa037edf289fedf5f454d`。
- 当前源生成的六个原批准欧洲父记录与 wave-2 逐项相等：`FR_ARR_75001`, `FR_ARR_76003`, `DEE06`, `DEE0D`, `PL_POW_0264`, `PL_POW_1661`。最终新增父集合与全部原批准 12 父无重叠。

## 可重复命令

从上述 worktree 根目录运行，Python 3.12 / Shapely 2.1.2，绘图 Matplotlib 3.10.9，Node 22.23.0。先核对 selection 的两个输入 digest；任一不同应重新调查，不能沿用旧审计。

以下 PowerShell 命令只读取正式生成器，并把 60 个选定 ID 传给它；生成结果与当前 candidate 完全相同：

```powershell
$env:PYTHONPYCACHEPREFIX = '.runtime/python/pycache'
$selection = Get-Content tools/river_partitions/selections/europe.json -Raw | ConvertFrom-Json
$spec = $selection.generatorCommand
$buildArgs = @($spec.script, '--land', $spec.land, '--rivers', $spec.rivers,
  '--scene-id', $spec.sceneId, '--base-commit', $spec.baseCommit,
  '--baseline-hash', $spec.baselineHash, '--include-lake-centerlines',
  '--max-parents', [string]$spec.maxParents, '--output', '.runtime/river-eu/repro.json')
foreach ($river in $spec.riverNames) { $buildArgs += @('--river', $river) }
foreach ($parentId in $spec.parentIds) { $buildArgs += @('--parent', $parentId) }
python @buildArgs
if ($LASTEXITCODE -ne 0) { throw 'European candidate build failed' }
```

全面调查：对 `Seine`, `Elbe`, `Oder`, `Rhine`, `Danube` 分别使用同一 land、scene-id、`--include-lake-centerlines`、base commit，去掉 `--parent` 与 60-parent 限额（默认 10000），输出 `.runtime/river-eu/<river>.json`。这正是 `survey.py` 调用现有 `build_pack` 的范围。

本 worktree 已保留复查脚本；它们仅在 ignored runtime 中，**cherry-pick 不会搬走证据或脚本**：

```powershell
python .runtime/river-eu/survey.py
python .runtime/river-eu/select_audit.py
python .runtime/river-eu/supplement.py
python .runtime/river-eu/finalize.py
python .runtime/river-eu/focus.py
python .runtime/river-eu/deliver.py
python .runtime/river-eu/reproduce.py
node .runtime/river-eu/frontend.mjs
```

以上是在本任务中实际运行的离线过程。`finalize.py` 在同源本地复查时复用已有全父审计；如需完全重新审计，在单独的新 runtime 目录重建，或仅移走自己的 `all-parent-checks.json` 后重跑。无需改项目 package 或共享验证收据。

## 主对话合成准入

1. 提取本提交的两个 tracked 文件，读取 selection 的 **60 个 candidate ID**；`repairBeforeAdmission`、`nextReview` 与 `excludedUncut` 不自动加入。整合前保留或复制本 worktree `.runtime/river-eu/` 证据，避免归档后丢失 ignored 输出。
2. 将这些 ID 与正式 wave-2 的原 12 父、其他负责范围的已审候选取并集；保持原 12 父/43 分区记录逐项相等。只合本欧洲范围时，目标是 **72 父 / 194 分区**，仍须由最终生成验证。
3. 在原始 land 和 river 源上用正式生成器重建 **整个并集**，河名同时保留原 wave-2 的 Seine/Elbe/Volga/Oder/Yangtze/Huang，并加入 Rhine/Danube；湖中心线选项保持一致。对全部旧父记录做 deep equality，对原项目 pack 保持独立认证和原范围。
4. **不得直接拼接 support**。当前欧洲 candidate 的 support 中 `DEE06`、`FR_ARR_75001`、`FR_ARR_76003` 已是旧包的可填色父；整个并集重建会移除这种身份重叠并重算共享轮廓节点。候选的 64 个 support 不是最终合成数。
5. 主对话单独负责批准新包内容摘要、manifest/loader、asset registry/CATALOG、双语入口与 dist。新工程可按最终准入包扩展；已有工程继续用其嵌入原包，不能隐式升级、丢失或扩增历史 paint 范围。
6. 最终合成需验证稳定 ID/有效性/覆盖/重叠/source 对齐、完整前端指纹与坐标预算，再验实际 all-cell picker、Undo/Redo、项目 roundtrip、Canvas/导出接缝和最终 CI/Pages。此离线交付不声称 UI 或发布 gate 已完成。

## 证据索引

全部路径相对于本 worktree，统一在 `.runtime/river-eu/`：

- `europe.candidate.json`, `europe.candidate.audit.json`：最终 60 父包、151 分区与 64 support 审计。
- `survey.json`, `classification.json`：222 相交普通父域的源属性、完整分类与小面统计；无全球 auxiliary 计数污染。
- `<river>.json`, `<river>.audit.json`：五个广域包及生成器原始 audit。
- `all-parent-checks.json`：214 父的独立覆盖、重叠、有效性、稳定 ID、源线吻合审计。
- `selected-checks.json`, `supplement-checks.json`：71 个初选/连接父域与 atlas 路径。
- `summary.json`, `frontend.json`, `reproduction.json`：分类总数、体积、前端实测、官方 CLI 内容一致及原批准记录相等证据。
- `<river>-route.png`：最终候选蓝色、原批准绿色、暂缓灰色的完整走廊。
- `<river>-atlas-1/2.png`、`elbe-supplement-1.png`、`danube-supplement-1.png`、`<river>-focus.png`：已实际查看的叠加与小面证据。

主要遗留风险为国际/行政边界与河线的源精度差异、部分河段和入海支流缺口、小片的实际 picker/像素可见性，以及合成后 support 重算。没有用删碎片或调整容差绕过这些问题。
