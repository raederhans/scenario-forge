# 继续执行结果：来源裁剪修复与扩大试点

2026-09-20。正式场景尚未替换；以下候选和报告位于`.runtime/tmp/russia-precision-20260920/`。

## 完成的修复

`map_builder/processors/russia_ukraine.py`删除了仅保留[-20,179.99]经度的俄罗斯源裁剪。改为检查每个Polygon环的WGS84范围与跨日期变更线边；合法的正负经度分片保持原样，未拆分的跨界边明确报错。不会把经度强行平移至180以外。

固定源文件2,327个地块全部通过检查；其中3个含负经度，均不存在超过180度的环边跳跃。完整RU/UA替换入口的模拟回归验证两侧地块都能保留，同时覆盖拆分MultiPolygon、不合法经度和未拆分跨界边。本次没有运行全球数据重建，因此这项源码修复尚未把缺失ID插入正式场景。

## 重叠复核与扩大结果

逐对比对665处跨owner重叠与其原始父区，原始父区交叠面积均未超过1e-6km²；仅1对存在超过1km²、两个原始父区都解释不了的区域。这是来源几何证据，不能替代剧本国界依据。

在避开跨owner重叠、城市覆盖冲突、面积比例异常后，选出同owner连通组件。首次153-ID组合在TAT三岔点的公共边界节点检查失败；保留日志`expanded.log`，未放宽容差，暂缓该35-ID组件。最终候选118个ID，比首批新增73个，实际改变112个；owner计数CHT23、FIN26、OMS36、RKK25、RKM1、VOL7。坐标数6,099→30,070。

- 候选：`expanded-v2/runtime-candidate.topo.json`。
- 构建资产：`expanded-stage/tno_1962/`。
- 独立资产校验：`expanded-stage-validation.json`，118目标PASS。
- 严格剧本契约：`expanded-strict.json`，零错误、零警告。
- 构建测量：`expanded-stage/tno_1962.build-report.json`，188.203秒、峰值工作集11,648,430,080字节；gzip6分块总量相对原始快照增加782,747字节。
- 来源重叠逐对明细及保守选区：`triage-next/report.json`；实际选区`triage-next/accepted-selection.json`，TAT暂缓原因`triage-next/deferred-component.json`。

## 缺失区归属的新证据与限制

本地TNO源文件`891-Chukotka.txt`的历史owner/core为OMO，`1564-Dagestan.txt`为CAU。壳层USA/PFC后缀来自`build_coalesced_runtime_shell_fragment_gdf`：在EPSG:3413中找最近的参考地块，再借用其owner作为hint；它不构成缺失源区的精确剧本归属证据。

对本地游戏州栅格执行现有raw affine坐标转换后，Chukotka州落在69.33–82.48N，与两个缺失原始行政区完全不相交。这暴露了游戏图与地理图的配准问题，不能直接用这个旧交叉映射补归属。Dagestan原始州几何覆盖了第三个源区，但其陆水掩膜冲突仍待复核。证据及源文件身份见`missing-state-evidence.json`。未执行旧审计main，未覆盖人工归属规则。

下一步的关键是复核游戏图到地理图的局部配准，以及TAT三岔点节点判定。尚未完成全国替换、缺失ID正式恢复或浏览器视觉验收；当前PASS只覆盖明确选区和资产契约，非选区遗留问题仍存在。
