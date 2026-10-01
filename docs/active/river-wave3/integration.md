# Wave 3 联合验收（2026-10-01）

## 结论与合并范围

四份交付已在 `main@2da4db61` 上顺序整合。批量工具通过审查和 33 项 Python 测试。
本批交付工具、区域调查、完整候选清单与经过联合边界筛选的离线清单；**不批准新的 runtime pack**。
默认功能仍是 wave2 的 12 父 / 43 cells，未修改行政 ID、scenario ownership、正式包、loader、UI 或 dist。

| 范围 | 新增父 | 含旧父总数 | cells | support | UTF-8 bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| 四份交付合并候选 | 295 | 307 | 938 | 106 | 2,014,263 |
| 联合复核后的离线候选 | 290 | 302 | 905 | 108 | 1,993,389 |

欧洲提供 60 个新增父、中国 175 个、东欧 60 个；复核后分别保留 59、171、60 个。
完整候选使用 `tools/river_partitions/selections/wave3-joint.json`；
后续 runtime 接入应从 `wave3-reviewed.json` 开始，不能直接拼接区域 pack。

## 本次独立验证

整合后的 adaptive 路由执行 27 条命令全部通过；4 条主线程检查按规则延后，未将其计入通过数。
验证路由已覆盖新增 admission 模块、选择清单及 wave2 fixture。日志见 `.runtime/rv3/adaptive.log`。

- 两次联合构建均检查审计字段：`buildPassed`、`selectionComplete`、`compatibilityPassed` 为 true。
- 原有 12 个父的原始 geometry、cell IDs 和 cell geometry 精确一致。
- 302 父 / 905 cells 的整个 pack 通过 JS normalize、fingerprints 及逐父 D3 正面积、有限路径检查。
- 用当前土地 TopoJSON 解码后的 **11,983 个可交互原始面**组成全地图图形。
  基线使用正式 wave2，候选使用本次 joint-noding 后的 parents 和 support。
  调用真实 `buildPaintContourGraph`，将 cell owner 折叠回 parent 后比较所有邻接对长度。
- 原始 307 父候选有 3 对邻接长度增加；排除下列 5 父后，全部邻接对差异不超过 1e-9 度。
- 原有 12 父内部 seam 长度差为 0；302 父内部 seam 与
  `(sum(cell boundary length) - parent boundary length) / 2` 几何预期差均不超过 1e-9 度。
- 完整地图 `invalidRings` 为 0 → 0，`ambiguousSegments` 为 550 → 550。
  后者是全地图已有问题，不代表候选消除了源数据歧义。

## 联合复核新增暂缓项

| 暂缓父 ID / 地名 | 完整图新增共享边界长度（度） | 证据 |
| --- | ---: | --- |
| CN_CITY_17275852B68283317499250 / Dalateqi 与 CN_CITY_17275852B83584927302596 / Baotou | 0.06778905941734381 | 原源精确共享边界 1.0272885623316326；候选图变为 1.0950776217489766 |
| CN_CITY_17275852B50201707862643 / Zungeerqi 与 CN_CITY_17275852B70463469741157 / Hequxian | 0.004221672835697853 | 原源精确共享边界为 0；源面已有正面积重叠 |
| NL226 / Arnhem/Nijmegen | 0.032353447539548 | 与 support DEA1B / Kleve 的原源精确共享边界为 0；源面已有正面积重叠 |

这里将两端均为候选的父同时暂缓，以保留可明确解释的最小准入范围；未修改原坐标或删除碎片。
前三个区域报告描述的是各自交付时的局部验证，本节的联合结果优先，不能将“没有丢失已有边界”当成“没有新增错误边界”。

## 复现联合构建

在整合 checkout 执行（输出仅放 `.runtime`）：

```powershell
python -X utf8 -B tools/build_river_partitions.py `
  --land data/scenarios/modern_world/runtime_topology.topo.json `
  --selection tools/river_partitions/selections/wave3-reviewed.json `
  --include-lake-centerlines --scene-id modern_world `
  --base-commit 2da4db61c3533f621afe2be0fe6ff494d567eb92 `
  --baseline-hash 7ee2527fd2eef0f5f50356a3e41089499f08c0573b642be295453389fbdc8966 `
  --max-parents 302 `
  --compare-against data/river_partitions/modern_world_wave2.json `
  --output .runtime/rv3/reviewed.json
```

本次额外全地图审计脚本、输入和输出保留于整合 worktree 的 `.runtime/rv3/`：
`adjacency.mjs`、`source.json`、`internal.json`、`reviewed-contours.json`、
`frontend.mjs`、`frontend-reviewed.json`、`reviewed.audit.json`。
临时脚本未作为长期公共接口发布。区域 atlas 和其他证据仍保留在原四个 worktree 中。

## 仍需完成的运行时准入

1. 补齐 302 父的可检索、分河流/区域导航；当前 UI 仍是 12 个固定位置。
2. 对整合 pack 做真实地图点击、独立填色、撤销/重做、保存/载入、旧项目兼容及 contour 渲染检查。
   本次数值模型与边界图验证不替代屏幕可点击性，尤其极小碎片。
3. 明确继承的行政面重叠与河线/湖泊中心线偏差如何展示；各区域报告列出了局部已知风险。
   当前河线不能证明最新真实河道、库区岸线或整条河流连续覆盖。
4. 验证完成后再接入正式包认证、导航和对应发布资产。复核包已在现有 2,000,000 字符预算内，
   但余量很小，后续新增元数据必须重新测量，不自动提高限制。

本批未进行新的浏览器 UI 验收，也未宣称 290 个新增父已经上线。
