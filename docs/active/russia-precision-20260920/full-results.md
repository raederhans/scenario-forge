# 俄罗斯全量替换：独立 worktree 最终结果

状态：已在 `C:/Users/raede/.codex/worktrees/russia-full-replacement/mapcreator` 本地应用。原项目目录未改动；未提交、推送或部署。

整合补记（2026-09-20）：上述独立实施状态为交付时快照。用户随后授权整合，成果已迁入主工作区，独立工作树在逐文件保全后移除。本文下方的运行证据现保存在主目录 `.runtime/worktree-archives/russia-full-replacement-20260920/runtime/`；远端验收与合并以 [整合任务](../precision-integration-20260920/task.md) 及其 PR 回执为准。

## Worktree 恢复

原检出流程在导出未提交二进制差异时超过 32 MiB 输出上限。改用干净的托管 worktree，再按文件继承原有 WIP，逐字节校验 149 个文件（218,729,793 字节）及 1 项删除。恢复清单为 `.runtime/tmp/russia-full-replacement/inheritance.json`。没有 reset、stash 或清理原目录。

## 结果与归属

- 保留原有 2,343 个 RU_RAY ID、44 个剧本势力归属、25 个拆分子地块和 853 个非 RU 国家标签。既有 owner/controller/core/manual/mutation 记录保留。
- 新增 Chukotsky 与 Providensky，归属 PFC；新增 Izberbash，归属 RKK。最终 2,346 个地块覆盖固定源数据的全部 2,327 个父区域。
- 补回 Iultinsky 日期变更线两侧的裁剪缺失；修剪两个非交互辅助面，保留其 ID。
- 无默认 SOV owner/core/国家注册记录。此前 SOV 清理是继承的工作，本阶段验证其继续成立。

| 补回区域 | 面积 km² |
| --- | ---: |
| Iultinsky | 58,402.0487 |
| Providensky | 26,984.1859 |
| Chukotsky | 28,957.4060 |
| Izberbash | 1.2508 |

新增区域仅取固定源数据中位于既有陆地掩膜内、排除水体与现有交互地块后的部分。Izberbash 的源面积并未全部恢复：大部分位于现行掩膜外或与既有地块重合。以上不构成对现实海岸线或原始数据全部正确的保证。

## 验证与应用

以下路径相对于 `.runtime/tmp/russia-full-replacement/`：

- `full-v7/geometry-validation.json`：2,343 个既有地块的独立几何与守恒检查 PASS。
- `recovered-v2/validation.json`、`recovered-v3/metadata-validation.json`：缺失区域及新增顶层 ID 修复 PASS。
- `stage-v2/assignment-and-binding-validation.json`：原有归属保持、仅新增三项、源父区域完整覆盖、无默认 SOV，PASS。
- `stage-v2/lod-validation.json`：2,346 个目标、396 个相邻势力混合 LOD 状态 PASS；该报告来自完整枚举验证，不是后加的坐标身份快捷路径。
- `stage-v2/neighbor-lod-validation.json`：169 个相邻/城市/辅助约束地块 PASS。
- `stage-v2/strict.json` 与 `strict-formal.json`：阶段产物与实际应用目录的严格剧本契约通过。
- `local-application-result.json`：63 项修改、14 个新增引用分片、3 个过时分片删除；应用后 441 个文件与选定阶段产物逐字节一致。
- 相关覆盖、守恒、恢复、资产成员、精度及 LOD 目标测试通过；目录测试 18 项通过。数据健康检查完成，10 项既有非 TNO 大文件提示仍为 report-only。

覆盖验证修复保留原生快速路径；在原生工具对点接触孔洞误报时，使用输入边段/顶点的精确交集及内部不相交检查。没有放宽坐标容差或修改几何来通过该检查。CLI 提供独立诊断和对抗用例，主代理逐项复核。

localhost quick 检查完成：TNO 启动、缩放、PFC 国家检索、层级面板与一次分组着色/撤销正常；最终撤销完成，未保存项目。捕获日志无 warning/error。未完成全国逐块放大视觉验收或 FPS/客户端内存基准。详细记录见 `.runtime/reports/generated/browser/ai-browser-mcp-smoketest.md`。

## 体积与限制

几何一致的第一版资产构建耗时 293.985 秒，离线构建峰值工作集约 17.3 GB。政治分片由 197 增至 208；gzip6 合计估计 24.06 MB → 52.17 MB；coarse gzip6 为 8.13 MB → 21.29 MB；每种语言 startup gzip6 为 2.78 MB → 2.87 MB。第二版只修复新增三项顶层 ID 并重新绑定派生产物，分片几何未变。这些压缩测量不等于实际网络传输量。

俄罗斯选定目标及相邻约束通过验证，但报告仍记录 7,776 项目标外 coarse 接缝限制；AU_ADM1_AUS-2654、US_ZN_13_015、AQ 三个继承的非目标 coarse 无效几何保持基线坐标。不能将本次 PASS 外推到全球几何。

后续集成应以当前独立 worktree 及本报告为准，区分继承 WIP 与本阶段新增修改。尚未合入原项目目录，也未执行 Git 提交或远端发布。
