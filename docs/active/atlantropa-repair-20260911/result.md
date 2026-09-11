# TNO Atlantropa 四轮修复结果

2026-09-11：四轮代码与数据修复已落地到本地工作区。完整候选经严格检查后更新了26个TNO资产；29个相关dist文件完成范围内同步，并重建dist清单。没有提交、推送或部署。

## 四轮结果

1. **海岸线**：生成独立 `scenario_coastline`，使用原陆地与实际填海陆地的合并外边界；保留于bootstrap和startup bundle。实际绘制使用所选择的对象，图层显隐触发海岸线缓存及渲染签名更新。没有放宽全球拓扑保护阈值。
2. **接岸与缺口**：以原始来源部件为依据恢复接岸，逐个保留部件检查，限制shore seal/weld的来源范围并避免堵塞原有海峡。集成检查另发现替换旧岛后海域仍避让旧岛的问题，已统一sea reference与replacement规则。
3. **冲突与飞地**：修复Shapely原生snap产生无效几何、或累计移动超过声明容差时继续修复成远方碎片的问题。按来源和旧归属足迹处理岛屿身份、拆分与合并，保留旧core并阻止不明确的控制权合并。未启用争议归属优先级。仅处理有证据的新加工残片，保留原始小岛。
4. **精度与生成链**：后处理简化预算收紧至0.0025度，并检查部件、孔洞、边界偏移与接岸保持；保留原始栅格分辨率及既有仿射配准，不把控制点质心残差当作海岸误差。另修复stage校验误读canonical资产、donor ledger错误解析编号岛ID，以及独立ATL导出误带世界弧线的问题。

## 实际数据对照

| 指标 | 修复前 | 修复后 |
|---|---:|---:|
| ATL总要素 | 898 | 721 |
| 实际陆地要素 | 365 | 172 |
| 陆地连通部件 | 626 | 277 |
| 陆地内部孔洞 | 37 | 13 |
| 面积小于0.0001平方度的部件 | 79 | 16 |
| 陆地重叠对 | 140 | 0 |
| 与海域重叠的陆地要素 | 84 | 0 |

最终721要素包含172陆地、69浅滩和480海域。重叠检测容差为1e-12平方度。数量减少本身不是正确性的证明：16个剩余微小部件均与原始来源相交，五个原生Eolie岛仍保留；Lazio18230由12部件降为2部件，最终几何全部在raw来源内。

## 验证证据与范围

- 43项海岸线/mesh/signature Node测试通过；58项最终核心Python测试通过，随后海域reference修复的18项land-join/stage复验通过。此前51项stage/scenario-contract测试通过。
- 最终源数据、coarse/detail分块：几何有效，覆盖一致，没有超出数值容差的陆地互叠或陆海重叠。
- 完整stage严格契约和修复后baseline语义检查通过：非ATL政治几何、归属/core和人工地名等配置保持一致。
- 地中海source/coarse/detail覆盖检查全部通过，三处Ionian探针全部被覆盖。内部缺口面积在现有0.0324度沿岸容差下为0；这不等于证明所有沿岸微小间隙均为0。
- 最终海岸线：449内部环/2074部件=0.21649，球面面积差比0.0027134，实际运行时选择 `scenario_accepted`。500环、0.25环比、0.02面积差门槛未放宽。
- 聚焦Playwright：开发目录通过1例，31.3秒；同步后的dist静态服务通过同一例，18.8秒。检查实际mesh、旧海岸样本消失、新外海岸保留、图层显隐及bootstrap空mask契约。
- 内置浏览器确认TNO detail-ready、实际加载721要素和专用海岸线，并在764%缩放查看地中海。截图位于 `.runtime/browser/atlantropa-repair/adriatic-final.png`。
- Pages隔离构建成功；仅同步本任务相关文件，保留city lights等其他任务改动。data catalog生成、data health及18项catalog契约测试通过，现有大文件仅产生报告性warning。
- 本次临时浏览器页及8000/8001服务已关闭。没有远端发布验证。

## 保留的精度边界

原始HGO地图仍为5120×2560栅格；本次改善加工过程，未创造更高分辨率来源。0.0025度是简化预算，不是绝对地理精度承诺。

`ATLISL_adriatica_CRO_9`（该旧ID现有归属为ITA）最大孔洞仍有未定案的源轮廓差异。孔面积0.23698443平方度，大部分继承旧孔；相较旧孔向原有陆地区域扩大0.02502264平方度。归属裁剪与最终重叠消除在相关raw区域没有删地，剩余差异来自更上游几何加工，尚不足以判定应该填平。浏览器查看未提供能替代来源判定的证据，因此保留并披露，不能宣称13个孔洞全部已被证明是设计水域。

详细机器证据：`.runtime/reports/generated/atlantropa-repair-20260911/{geometry-final,water-final,coast-final,contracts-final,adopted-files,dist-synchronized-files}.json`。残留部件及CRO9追踪分别位于 `.runtime/reports/generated/atlantropa-remaining-components.json` 和 `.runtime/reports/generated/atlantropa-cro9-hole.json`；后者海域面积来自上一候选，不作最终水域覆盖结论。
