# SOV 默认残留清理与 TAT 扩展

用户于本轮明确授权将SOV残留地块就近合理分配给剧本势力。本轮已将SOV清理写回本地`data/scenarios/tno_1962`；俄罗斯精度扩展仍保留为独立候选，未远端部署。

## 已写回的 SOV 修复

20个可交互地块的目标归属：

| 势力 | 地块数 |
| --- | ---: |
| RKM | 4 |
| IRK | 3 |
| CHT | 2 |
| RUR | 2 |
| RKK、ALT、SVR、BRY、TOM、WRS、RSF、YAK、PFC | 各1 |

17个地块有唯一非SOV共边势力。Svirsk、Zima和Anadyr没有精确共边，使用EPSG:3413测量现有俄罗斯地块的相交/最近关系，分别归IRK、RUR、PFC。这是用户授权的现有剧本邻接修正，没有把本地原版TNO州名推断强加到现有分配上。

另有一个非交互壳层`RU_ARCTIC_FB_SOV_038`位于基兹利亚尔附近。最近地块为本次改归RKK的Kizlyar，邻近地块也为RKK。将其owner/controller提示及显示名改为RKK；ID和几何保持不变。

清除了1,655条核心列表中的SOV引用，保留其他核心；仅有SOV核心时改用当前owner。同步清理默认国家条目、featured列表、首都提示，以及两个人工编辑载体中12项SOV核心引用；移除SOV专属政治分块。中英文启动包不再包含值或键为SOV的引用。旧SOV辅助地块ID作为稳定身份保留，不代表SOV仍为活动国家。

持久规则为`data/scenario-rules/tno_1962.sov_residuals.manual.json`，在场景构建器应用人工覆盖后执行。只替换仍为SOV的已审核地块，保留后来已有的非SOV人工归属；新出现的未审核SOV地块或壳层会报错。核心清理复用既有注册国家校验逻辑。场景baseline_hash同步到新的owner映射，启动包及快照重新绑定。

## TAT 与 153 地块候选

三岔点故障来自极薄面的representative_point落到第三个地块边界，`covers(point)`产生零面积的额外命中。改为仅将正面积交集视为该面的归属；保留原有1e-10面积和1e-9边界带容差。CLI初版把所有边界覆盖改成任一边界覆盖，主代理未采用；主代理完成更严格修正。

真实失败区域已缩小为三个地块，保存在`tests/fixtures/tno_russia_tat_junction.json`。测试证明旧判断会失败，新判断保留各地块表面、有效覆盖和外轮廓，同时拒绝微小但真实的内部重叠。

新候选153个ID，实际改变147个：CHT23、FIN26、OMS36、RKK25、RKM1、TAT35、VOL7；坐标7,827→40,279。已同步本轮SOV清理后的元数据及分配。完整资产校验、严格剧本契约和相邻owner四种混合LOD状态通过。构建约186.53秒，峰值工作集11,738,357,760字节；gzip6分块总量相对SOV清理后的基线增加1,028,067字节。该测量不代表浏览器内存或全国替换成本。

## 证据与范围

以下路径相对`.runtime/tmp/russia-precision-20260920/`：

- `sov/decisions.json`：20个地块的位置、邻接与分配明细。
- `sov/baseline/tno_1962/`：本轮应用前的完整本地快照，包含原有未提交工作。
- `sov/application.json`及`cache-identity-update.json`：本地写回和版本标识同步记录。
- `sov/stage-v2/tno_1962/`：经过验证的SOV修复资产。早期stage因遗漏辅助壳层而被拒绝。
- `tat-stage/tno_1962/`：153地块精度候选；正式地图几何未应用该候选。
- `sov/validation-final.json`、`sov/strict-formal-final.json`及`tat-strict-final.json`：最终校验记录。
- `tat-stage-validation.json`：153个目标的几何、分块、压缩资产和混合LOD验证；随后仅更新归属版本绑定，几何和分块未改变。

已运行SOV归属/核心/幂等回归、实际TAT三岔点与真实重叠回归、数据目录生成、data health及18项目录契约测试。data health仅报告既有大文件警告。

未完成事项：153地块的浏览器视觉验收和正式应用；缺失Chukotka地块的地图配准及新增身份恢复；里海陆水边界复核；全国几何替换。SOV默认清理已完成，不再属于这些待办。
