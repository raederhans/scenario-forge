# Wave 3 批量构建与历史兼容工具

工具基于 `main@2da4db61c3533f621afe2be0fe6ff494d567eb92`，只生成离线候选包和审计。
现有 `river-joint-noding-v1`、128 faces 上限、覆盖/重叠/距离容差和碎片保留规则不变。
没有修改正式包、runtime 认证、scenario、catalog、dist 或批准 manifest。

## 主对话联合构建

将区域对话交付的 **选择清单** 转为下面的 schema；区域清单只放新增父 ID，
原批准 12 父由 `tests/river_partitions/wave2-selection.json` 提供。
各区域最终纳入的 ID 必须明确选定；不同清单重复父 ID 会直接失败。
共享河流名允许跨清单出现，统一取并集；同一清单内部或重复 CLI 参数中的重复河流名仍拒绝。

```json
{
  "schemaVersion": 1,
  "sceneId": "modern_world",
  "source": {
    "landDigest": "sha256:917320332f37571d2fa1cca21881e0b5fc2cc9ede4966abe914a1e9259eabf1e",
    "riverDigest": "sha256:60dbebd1fc2d4f9ba8b6d5327a99960c6bfcbe9c6df1d5d4508d0b70fa950a04",
    "includeLakeCenterlines": true
  },
  "parents": ["明确选定的新增父ID"],
  "rivers": ["源数据中的准确河流名"]
}
```

必须提供两项源文件摘要和 sceneId。可额外约束 `landObject`、`includeLakeCenterlines`、
`baseCommit`、`baselineHash`；提供后必须与 CLI 实际输入完全一致，类型也须一致。
摘要是源身份检查；`baseCommit` / `baselineHash` 只是调用者提供的来源标签，
工具不会认证或自动更新 runtime 批准摘要。河流名大小写匹配沿用原逻辑，
建议清单采用正式 pack 的拼写以保持来源元数据稳定。

以下 PowerShell 命令在整合 worktree 根目录执行，先把区域 JSON 放入对应 `.runtime/rv3/` 路径。
只有实际存在的清单才加入命令；`--selection-file` 是 `--selection` 的别名。

```powershell
python tools/build_river_partitions.py `
  --land data/scenarios/modern_world/runtime_topology.topo.json `
  --scene-id modern_world --include-lake-centerlines `
  --selection tests/river_partitions/wave2-selection.json `
  --selection .runtime/rv3/europe-selection.json `
  --selection .runtime/rv3/asia-selection.json `
  --selection .runtime/rv3/other-selection.json `
  --compare-against data/river_partitions/modern_world_wave2.json `
  --max-parents 500 --output .runtime/rv3/joint.json
```

这次调用读取同一土地和河线源，对全部父地块使用完整河流集合做 joint noding，
然后一次计算全部分区的 contour-support 邻居。不能拼接区域 pack JSON 作为最终包。
新增河流可能进一步切开旧父，比较失败时须调整范围或回主对话决定产品变更。
工具不会自动加入、替换或删除旧父；比较要求显式清单包括所有旧父。
重复、空白、缺失父 ID、不存在河流、源摘要/scene/object 不匹配都会拒绝。
旧的重复 `--parent` / `--river` 多值调用仍可使用；省略父参数且未提供清单时仍为原来的广域探索模式。
`--max-parents` 约束成功切分的父数，超限直接失败，不截断。

## 如何读审计

输出 `joint.json` 和 `joint.audit.json`。审计包括原有逐父几何指标、support checks，以及：

- `requestedParentCount` / `examinedParentCount` / `excludedParentCount`，每个显式父都有记录，包括 `no_intersection`。
- `parentCount` / `cellCount` / `supportCount` / `packBytes`；字节数对应写出的 UTF-8/LF JSON。
- `summary` 区分 `partitioned`、`uncut`、`no_intersection`、`excluded_auxiliary`、`rejected`。
- `geometryIssues` 将拒绝分为 invalid parent、unsupported domain、invalid linework、ambiguous membership、
  face budget、invalid face、coverage/overlap/distance、identity collision 和一般 geometry error。
  `lineworkDiagnostics` 单独计数含 cut/dangle 的父；dangle 本身不是覆盖失败，也不自动删除。
- `oldParentCount` / `newParentCount` 只在比较时有数值，否则为 null。
  `comparison` 精确检查旧父 geometry、fingerprint、cell ID 集合及每个 cell geometry/fingerprint，
  使用原始坐标序列而非仅检查七位坐标 fingerprint。
- `supportComparison` 单独报告 added/removed/changed/promotedToParent；
  旧 support 成为新增父会从 support 集合消失，这不影响旧父稳定性 verdict。
- `buildPassed` 表示没有逐父几何拒绝；`selectionComplete` 表示没有排除父。
  两者不等同：部分候选未切开时仍可生成有效子集，CLI 沿用原有退出成功行为。
  准入前须按逐父原因明确接受/排除；不能将 CLI 成功当成全部清单通过。
- `compatibilityPassed` 是旧父稳定性结果，未比较为 null。
  兼容失败会写审计、退出码 2、`candidateWritten=false`，并保留已有输出包；不要误用已有旧文件。
  输入校验、超限或 support noding 的致命失败直接退出，尚无联合审计/候选输出。

工具拒绝输出包或审计覆盖源文件、选择文件、比较基线。
比较还要求同一土地/河线摘要、scene、land object、lake-centerline 开关和算法/坐标/winding 契约，
并保留所有旧河流名；允许增加新河流名和新父。路径和来源标签变化不代替实际源身份。

原 pilot 的土地摘要是 `sha256:000d37d2735fb80e6f03e9ef2ef1034f4a2bad659aeeab34978eed0fd196a03b`，
与当前 wave 2 土地摘要不同，不能直接用当前土地对 pilot 做同源比较。
下面历史复建使用 pilot 对应的 Git snapshot，不放宽源身份检查。

## 已完成验证与复现

Python 3.12 / Shapely 2.1.2。定向命令 `python -m unittest tests.test_river_partitions`：33 tests 通过。
测试复用真实 Stendal 源几何（9 cells），验证清单/旧 CLI 字节一致、确定性、坏源身份、重复/缺失 ID、
旧 cell/亚网格坐标变化、失败保留审计、support 晋升和输入文件保护。
固定历史 12 父清单位于 `tests/river_partitions/wave2-selection.json`，完整列出父 ID。

| 离线检查 | 显式父 | 成功父 / cells | 排除 | support | JSON 字节 | 旧父精确不变 |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| 当前 wave 2 重建 | 12 | 12 / 43 | 0 | 18 | 142149 | 12 / 12 |
| 历史 pilot 重建 | 6 | 6 / 31 | 0 | 11 | 87636 | 6 / 6 |
| 212 父规模检查 | 212 | 206 / 676 | 6 uncut | 24 | 1217677 | 12 / 12 |

全部检查逐父几何拒绝为 0。212 父检查新增 194 个成功父；support 新增 10，移出 4（全部晋升为父），
共同 support 无修改。67 父有 interior dangle，6 个 uncut 父均有内部悬线，未增加 planar faces，全部保留在审计。
此规模清单是现有六河流相交源父按 ID 排序取前 200 个非旧父后联合旧 12 父，
只用于工具规模检查，不能视作区域选择/产品准入。完整 ID 和排除理由在 `.runtime/rv3/scale-selection.json`
与 `.runtime/rv3/scale.audit.json`。

复现当前 wave 2（保留其历史来源标签，可得到相同 packId；不修改正式包）：

```powershell
python tools/build_river_partitions.py `
  --land data/scenarios/modern_world/runtime_topology.topo.json `
  --selection tests/river_partitions/wave2-selection.json `
  --include-lake-centerlines --scene-id modern_world `
  --base-commit e25b89caa2c4d1e4c4d8f827e0c22b7f52c55ca5 `
  --baseline-hash 7ee2527fd2eef0f5f50356a3e41089499f08c0573b642be295453389fbdc8966 `
  --max-parents 12 --compare-against data/river_partitions/modern_world_wave2.json `
  --output .runtime/rv3/wave2.json
```

复现历史 pilot（需仓库保有 `bfedc6b8` 对应 Git 对象）：

```powershell
@'
import json, subprocess
from pathlib import Path
root = Path('.runtime/rv3')
root.mkdir(parents=True, exist_ok=True)
old = json.loads(Path('data/river_partitions/modern_world_pilot.json').read_text(encoding='utf-8'))
root.joinpath('pilot-source.topo.json').write_bytes(subprocess.check_output([
    'git', 'show', old['source']['baseCommit'] + ':' + old['source']['landPath']]))
selection = {'schemaVersion': 1, 'sceneId': old['sceneId'], 'source': {
    k: old['source'][k] for k in ('landDigest', 'riverDigest', 'includeLakeCenterlines')},
    'parents': [p['parentId'] for p in old['parents']], 'rivers': old['source']['riverNames']}
root.joinpath('pilot-selection.json').write_text(json.dumps(selection, indent=2), encoding='utf-8')
'@ | python -
python tools/build_river_partitions.py `
  --land .runtime/rv3/pilot-source.topo.json --selection .runtime/rv3/pilot-selection.json `
  --scene-id modern_world --include-lake-centerlines `
  --base-commit bfedc6b8eb75ae6caf15fee4711f2499efe1d4d1 `
  --baseline-hash 7ee2527fd2eef0f5f50356a3e41089499f08c0573b642be295453389fbdc8966 `
  --max-parents 6 --compare-against data/river_partitions/modern_world_pilot.json `
  --output .runtime/rv3/pilot.json
```

在本交付 worktree 复现规模检查（保留完整选择清单）：

```powershell
python tools/build_river_partitions.py `
  --land data/scenarios/modern_world/runtime_topology.topo.json `
  --selection tests/river_partitions/wave2-selection.json --selection .runtime/rv3/scale-selection.json `
  --include-lake-centerlines --scene-id modern_world --max-parents 212 `
  --compare-against data/river_partitions/modern_world_wave2.json --output .runtime/rv3/scale.json
```

证据：`.runtime/rv3/{wave2,pilot,scale}.audit.json` 及对应离线包。
LF 序列化与原 Windows CRLF 文件可有一字节体积差；比较针对精确几何/IDs，不冒充整包字节相同。
原 pilot 全部 6 父记录也与当前 wave 2 对应记录完全相等。
正式运行时兼容仍由主对话执行认证/import/UI 验收；本工具验证不启用任何新范围。

## 剩余风险与准入边界

覆盖/重叠和 support domain 检查只证明几何构建契约，没有新增真实河线吻合或视觉 seam 验收。
审计将 `geographicAlignment` 明确标为未评估。小片全部保留，须由区域审计和主对话视觉检查判断。
规模检查覆盖 212 个显式父和 676 cells，不是任意全球域/千父运行证明；极区/日期变更线仍拒绝。
支持邻居仍需扫描全部土地源，多 river/顶点下的 polygonization、两两 cell overlap
和 neighbor 边上插点开销可能增长；未为这些未测规模引入并行、snap、删除碎片或更宽阈值。
主对话先整合本工具提交，再收齐区域显式清单执行一次联合构建，检查旧 12 父稳定性、
逐父排除、support 变化和视觉河线一致性，最后按原 runtime 准入流程单独处理认证/批准。
