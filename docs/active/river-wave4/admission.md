# Wave3 runtime 候选准入交付（2026-10-01）

本分支在 `b416e2571c1202a4de8ac68e3869dc07c14bb352` 上按唯一准入清单
`tools/river_partitions/selections/wave3-reviewed.json` 重建正式命名的 wave3 包，
并接入认证与默认 loader。这是待主对话联合验收的候选，尚未 push、合并或发布。
未修改行政 ID、ownership、源几何、切分算法、预算、旧两个包、UI、E2E、dist 或验证路由。

## 包身份与预算

| 字段 | 实测值 |
| --- | --- |
| assetKey | `river_partitions:modern_world_wave3` |
| asset URL | `data/river_partitions/modern_world_wave3.json` |
| packId | `sha256:5a05c4173b95c642f970cfa556566eca4dae7929d04aa5d74490ab04d188b25a` |
| canonicalSha256 | `0ec82d7f9c97e05507e858d762b6be93dc4b8b6aa0697e34f5cad58d2b056c18` |
| parents / cells / support | 302 / 905 / 108 |
| 新增父 / 保留旧父 | 290 / 12 |
| 生成文件字符数 / UTF-8 字节数（含末尾 LF） | 1,993,389 / 1,993,389 |
| 现有下载字符上限 / 剩余额度 | 2,000,000 / 6,611 |
| scenarioVersion | 2 |
| scenarioGeneratedAt | `2026-09-27T13:55:57.885587+00:00` |
| source.baseCommit | `2da4db61c3533f621afe2be0fe6ff494d567eb92` |
| source.baselineHash | `7ee2527fd2eef0f5f50356a3e41089499f08c0573b642be295453389fbdc8966` |

`canonicalSha256` 对真实包经 `normalizeRiverPartitionPack` 后的完整
`JSON.stringify(pack)` UTF-8 内容计算，包含 source、全部 parents/cells 和 support。
它与生成器的 packId 属于不同契约，不能互换。包内没有增加 UI 标签。
本地生成文件为 LF；Windows Git 的 CRLF checkout 可能额外增加一个字符/字节，
仍在预算内且不改变规范化认证摘要。目标测试同时验证原始下载文本未超预算。

`runtime_asset_registry.json` 仅添加该新包条目，catalog 通过项目生成器更新为 674 项；
未修改其他 registry 条目或共享 worktree registry。

## 可重复构建

保留此前联合构建的 source 身份标签，不将当前实现基线写入包内 `source.baseCommit`：

```powershell
python -X utf8 -B tools/build_river_partitions.py `
  --land data/scenarios/modern_world/runtime_topology.topo.json `
  --selection tools/river_partitions/selections/wave3-reviewed.json `
  --include-lake-centerlines --scene-id modern_world `
  --base-commit 2da4db61c3533f621afe2be0fe6ff494d567eb92 `
  --baseline-hash 7ee2527fd2eef0f5f50356a3e41089499f08c0573b642be295453389fbdc8966 `
  --max-parents 302 `
  --compare-against data/river_partitions/modern_world_wave2.json `
  --output .runtime/river-wave4-admission/modern_world_wave3.json
Copy-Item -LiteralPath .runtime/river-wave4-admission/modern_world_wave3.json `
  -Destination data/river_partitions/modern_world_wave3.json
python -X utf8 -B tools/build_data_catalog.py
```

审计在 `.runtime/river-wave4-admission/modern_world_wave3.audit.json`：
`buildPassed`、`selectionComplete`、`compatibilityPassed` 均为 true，
`geometryIssues` 为空，原 12 父的 parent geometry、cell IDs 与 cell geometry 精确保留。
审计仅作为本 worktree 的临时证据，没有写入 data。

## 认证、加载与兼容行为

- `RIVER_PAINT_WAVE3` 新增批准记录，旧 pilot 与 wave2 记录保留。
- `loadRiverPaintPilot` 保留公共函数名，默认下载 wave3；signal、cache、HTTP 失败与字符预算处理沿用。
- 源版本校验从批准记录查找 `scenarioVersion` / `scenarioGeneratedAt`，三个正式包均受约束。
- 旧项目仍使用自包含的 6 父或 12 父包；启用已有包不触发 loader，不替换包或覆盖旧颜色。
- fixture 保留已有导出，新增显式 `realWave3`、`realWave3Text`、`makeWave3Fixture`。

## 本分支验证

```powershell
node --test tests/river_paint_model.test.mjs tests/river_paint_history_import.test.mjs tests/river_paint_runtime.test.mjs
python -X utf8 -B tools/data_health.py --json
python -X utf8 -B -m unittest tests.test_data_catalog_contract -q
git diff --check
```

- Node 目标测试 39/39 通过。涵盖真实生产包认证、905 cells 的 fingerprints、正 D3 面积与有限路径、
  reviewed 清单精确匹配、旧 12 父精确保留、support/cell/source 篡改及未知身份拒绝、
  实际默认 loader 安装、源 manifest/baseline 不匹配拒绝、取消加载与错误恢复。
  真实 wave3 执行 history undo/redo、整父填色清除及恢复子颜色；
  pilot/wave2/wave3 均通过真实 JSON 项目 roundtrip 与 import commit，旧存档范围保留。
  添加 Windows 末尾换行兼容断言后，单独重跑 model 测试 15/15 通过。
- 数据 health：`ok: true`，0 errors；12 条已有的大文件报告警告，没有该包的大小警告。
- Catalog 合约 18/19 通过；唯一失败为 landing 的总资产数仍是 673，详见下节。
  checked-in catalog 与 builder 一致的测试通过。
- diff 空白检查通过。Node 的既有 `MODULE_TYPELESS_PACKAGE_JSON` 警告未改配置掩盖。

## 整合依赖与未测试边界

1. 主对话或 UI owner 将 `landing/index.html` 的两处总资产数更新到 674：
   当前第 328 行 `data-story-evidence-value="673">673</dd>`，
   第 546 行 `data-stat-value="673">673</span>`。
   保留现有 `data-stat-source="data/CATALOG.json:counts.entries"` 与文案。
   之后重跑 `tests.test_data_catalog_contract`。本分支不越权修改 landing。
2. 验证路由 owner 将 `data/river_partitions/modern_world_wave3.json` 接入
   `tools/verification/catalog/records/river_paint.mjs` 中 `node:test:node:river-paint` 的 `sourceRefs`，
   并按当前 catalog 规则登记本 admission 文档；本分支不修改 catalog 验证路由。
3. UI/E2E 两路使用上表的身份值和显式 wave3 fixture；`realPilot` 与 `realWave2` 的语义不变。
   主对话负责完整地图联合邻接复验、真实 UI 点击及小碎片可点击性、Canvas/contour 像素、
   浏览器保存/载入、完整 CI 和 Pages 资产生成/发布。

本分支没有重跑全地图联合图验收或启动浏览器，也没有改其他 core 文件。
源面重叠、河线/湖泊中心线与现实河道的偏差仍存在，不能据此宣称完整现实河道覆盖。
wave3-joint 的 307 父未准入；reviewed 清单暂缓的四个中国父及 NL226 未加回。
