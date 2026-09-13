# 全球区域增量构建流程

这套流程用于“同一政治 feature ID 的几何替换”。主拓扑装配入口接受全局 master 和同 ID GeoJSON；剧本分块入口接受已经完成历史裁剪和归属转换的 scenario runtime。二者不能混用。

## 数据链路

推荐的边界和产物顺序是：

```text
master source
  -> 历史裁剪 / 剧本归属转换
  -> scenario runtime candidate
  -> regional incremental plan
  -> scenario chunk candidate
  -> startup / bundle / audit / browser checks
```

`tools/plan_regional_rebuild.py` 比较解码后的 baseline/candidate political geometry。它只把同 ID 的真实 geometry 变化列为可评估对象；ID 增删、无效 geometry、属性变化、非目标 feature 变化和未知 selector 都会阻塞直接 apply。候选 topology 省略时，命令只生成 selector preview 和影响范围，`apply_eligible` 必须保持 false。

`tools/regional_scenario_assets.py` 接受已经完成历史裁剪的 scenario candidate runtime，复制 baseline 到新的 staging 目录，校验 owner/chunk/gzip，复用未受影响政治 detail chunks，并在成功后原子 rename。输出定位为 build-stage candidate（报告状态为 `candidate`），当前 `release_ready=false`。

不能用现代国家边界自动代替剧本国家。source selector 读取 political feature 的 ISO alpha-2 属性或 feature ID；processor registry 当前实际支持 **97 个国家代码**。当前 registry 不包含 `DE`、`JP`、`CN`，所以德国、日本、中国的高精度来源需要显式 candidate 数据和对应的历史转换，不能因为 owner/tag 存在就自动推断 source country。

现有 processor 还声明了联动单元。`RU` 可能需要和 `UA` 一起规划；`CZ`、`SK` 及北美相关单元也可能被 registry 合并。规划输出中的 `requested_countries` 与扩展后的 `countries` 都必须检查，不能把“用户选择 RU”误读成“只影响现代俄罗斯”。联动仍需经过 scenario owner、邻接、水陆 mask 和剧本归属复核。

## 当前数据阻塞

当前 master 快照仍有 **7 个不可读取输入** 和 **81 个 invalid geometry**。在这些问题处理前，任何全球高精度升级都只能停在诊断或 preview，不能称为已修复、已发布或已完成性能验证。

2026-09-13 对当前 6 个剧本运行时执行相同几何检查：HGO 1936、TNO 1962 通过；blank_base、modern_world 各有 1 个不可解码和 1 个无效几何；HOI4 1936、1939 各有 50 个不可解码和 2,519 个无效几何。完整 ID 和错误原因在 `.runtime/reports/generated/world-incremental-build/baseline-quality.json`。这是输入几何合法性检查，不是画面接缝或剧本语义认证。

计划器和 scenario builder 都应 fail closed：候选缺失、重复/空 ID、invalid geometry、chunk hash 或 gzip 不一致时停止，并保持 baseline 不变。水陆 mask、邻接关系、owner mesh、startup/bootstrap topology 和历史归属不能由“政治 chunk 已生成”推定为有效。

## 命令模板

以下命令只把报告写入 `.runtime`，不会下载源数据，也不会把结果写入 `data/` 或 `dist/`。

### 1. 只看某国 selector 的影响范围

省略 candidate topology 即 preview：

```powershell
py tools/plan_regional_rebuild.py `
  --baseline-topology data/scenarios/tno_1962/runtime_topology.topo.json `
  --source-countries RU `
  --scenario-dir data/scenarios/tno_1962 `
  --output .runtime/reports/regional-preview-ru.json
```

检查 `source_selection.requested_countries`、扩展后的 `countries`、`selected_ids` 和 scenario/chunk 影响；preview 不具备 apply eligibility。

### 2. 比较已完成历史裁剪的 candidate

```powershell
py tools/plan_regional_rebuild.py `
  --baseline-topology data/scenarios/tno_1962/runtime_topology.topo.json `
  --candidate-topology .runtime/candidates/tno_1962/runtime_topology.candidate.json `
  --source-countries RU,UA `
  --scenario-dir data/scenarios/tno_1962 `
  --output .runtime/reports/regional-plan-ru-ua.json
```

该报告只说明实际 old/new geometry diff、非目标变化、owner 和直接受影响 chunks。存在 scenario lineage 时应显示 `scenario_rebuild_required`；不能把 master-level eligibility 当成可直接写入 scenario。

### 3. 在新目录生成 scenario build-stage candidate

```powershell
py tools/regional_scenario_assets.py `
  --baseline-dir data/scenarios/tno_1962 `
  --candidate-runtime .runtime/candidates/tno_1962/runtime_topology.candidate.json `
  --candidate-owners .runtime/candidates/tno_1962/owners.by_feature.candidate.json `
  --output-dir .runtime/candidates/tno_1962/scenario-assets
```

输出目录必须尚不存在，且不能与 baseline 相互嵌套。成功只代表分块阶段候选已生成；仍需 startup bundle 更新、runtime/meta 一致性审计、邻接和水陆检查、以及 localhost 浏览器验证后，才可重新评估发布资格。当前流程不会自动发布，也不代表全球数据已经升级，更不提供 FPS 或性能改善声明。

### 主拓扑的同 ID 装配入口

```powershell
py tools/build_regional_topology.py `
  --baseline-topology .runtime/tmp/verified-master.topo.json `
  --replacement-geojson .runtime/tmp/replacement-de.geojson `
  --source-countries DE `
  --output-topology .runtime/tmp/master-de-candidate.topo.json
```

可将 `--replacement-geojson ...` 替换为 `--run-processors`，选择 registry 已注册的来源国家；该模式可能加载或下载对应来源。显式 GeoJSON 模式不要求国家在 registry 中。两种模式都会拒绝 ID 增删、非目标写入和无效基线。来源处理并不保证恢复最高精度；具体精度沿用所选处理器规则，后续仍须逐来源升级。

局部装配验证替换区域内部 coverage、绕向、解码一致性及全政治邻接。它保留非目标坐标，但不自动修复相邻国家的边界，也不认证替换区与未替换区的共享 arc 关系；诊断中 `adjacent_country_seams_verified=false` 必须保留，后续全局拓扑拼接和水陆边界检查仍有必要。

缓存依据文件内容和输出完整性，不再依赖 mtime。首次运行时下载了原先不存在的来源文件，下一次可能保守地多重建一次；保留构建前签名，避免构建中改变的代码被错误地认定为本次产物来源。

同时选择多个非洲或 Global Basic 国家时，执行阶段按同一处理器批量调用，共享源读一次；规划输出仍保留各国家 unit，便于审计。

## 本次实际验证

真实 TNO 无输入变化候选复用了 172 个政治 detail 和 16 个 context chunk；全局 coarse 重新生成。189 个分块全部通过 hash、字节数、gzip 检查，其中 188 个与基线字节相同。证据位于 `.runtime/reports/generated/world-incremental-build/tno-noop-acceptance.json`。另用实际分块 builder 的小型多 owner 场景验证了 owner-only transfer、旧 owner 清理、完整/增量结果一致、缓存损坏拒绝和失败回滚。没有运行正式发布或浏览器帧率测试。

## 发布前最低检查

法国 TNO 试点另有显式入口 `tools/pilot_tno_france_precision.py --reconcile-boundaries`。它只选择现有 315 个 FR_ARR，保留科西嘉替换与场景 owner，再用共同平面分区协调边界。候选内部边界来自恢复后的源；原场景在候选外侧的覆盖按旧地块归属补回，但不会填平候选整体覆盖中的孔洞。特殊水域、Atlantropa、邻国和 published land_mask 外侧构成约束，禁止新增冲突位置。输出仍写独立路径。

共同边界须在协调和裁剪两个阶段分别统一计算交点后重组，不能独立逐地块追加细片或裁剪后直接编码。每阶段检查合法覆盖、逐地块面积守恒及整体范围残差；平方坐标单位容差必须显式报告，不通过舍入、buffer 或放宽检查消除失败。

局部装配对已验证 coverage 使用精确共享链编码：从现有线段建立节点关系，在分叉处切分 arc，闭环使用规范起点，并合并正反向相同的链。此步骤不再次求交或删减坐标。真实法国协调候选曾在第三方 TopoJSON 转换中发生少量顶点丢失并破坏 coverage，因此编码后仍必须逐 ID 解码比对、检查 coverage 与 D3 绕向；有文件输出不代表这些检查通过。

这是一项保留旧场景外部行为的试点策略，允许已有基线重叠，不等同于修正旧国界的地理真实性。相邻国家先后升级可能得到不同接边结果，因此不能把法国单国策略直接循环推广全球；后续应按相邻来源区域共同处理共享边界，再分别重放各剧本历史约束。来源国家与剧本 owner 是不同维度，同 ID 几何升级不会更改 owner；拆分、合并与新增历史裁剪需要独立迁移步骤。

本轮法国独立海岸验收保留累计面积检查的原始失败值，同时采用显式线性数值容差：所有新增 mask 外残差必须完整位于 published land_mask 边界的 `1e-9°` 范围内（保守约 0.111 毫米）。真实数据的等价浮点集合运算给出不同累计面积，精确有理数点分类也确认部分残差是真实的亚毫米位移，所以不能声称数学上的零越界。边界带只用于诊断，不用于修改或遮盖候选几何；该容差是法国试点的明确验收决定，不是自动适用于所有 CRS 的默认阈值。

1. 处理 master 的 7 个不可读输入和 81 个 invalid geometry，并重新生成可追溯的 source/candidate。
2. 复核同 ID geometry、properties、owner、邻接、water/land mask 和 owner mesh。
3. 验证 coarse/detail chunk 的 byte/hash/gzip、清理已消失 owner chunk，并确认未受影响 chunk 的字节复用确实成立。
4. 更新并审计 startup/bootstrap embedded topology、runtime metadata 和 bundle manifest。
5. 在 localhost 完成高 zoom、跨 chunk、hit/export、Undo 和视觉覆盖检查；这些检查通过前保持 `release_ready=false`。
