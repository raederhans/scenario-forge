# TNO 1962 资产体积无损优化

本轮在 `codex/europe-land-gaps` 工作区完成实现、数据重建及本地产物验证。未提交、推送或部署。此前欧洲地块修复保留；本轮没有改变地块坐标、ID、属性或归属。

## 实际结果

MB 使用十进制字节；MiB 使用 1,048,576 字节。

| 资源 | 修改前 | 修改后 | 减少 |
|---|---:|---:|---:|
| 完整 runtime topology | 106,610,299 B | 103,264,414 B | 3.14% |
| political coarse 源 JSON | 71,262,910 B | 50,776,489 B | 28.75% |
| coarse 的 gzip level 6 | 22,108,519 B | 15,820,147 B | 28.44% |
| 全部分块 gzip level 6 合计 | 75,489,169 B | 69,200,797 B | 8.33% |

完整拓扑现在为 98.48 MiB，距离 GitHub 100 MiB 单文件限制有 1,593,186 B 余量。实际 Pages 发布准备产物为 **821.49 MiB**，通过 1 GiB 体积门槛。打包器移除 JSON 末尾换行后，发布 coarse 为 50,776,488 B，gzip 为 15,820,143 B。

本轮同步 13 个数据文件。196 个 political detail 分块逐字节不变，owners、cores、countries、manual overrides、mutations 逐字节不变；没有 controllers 文件的场景仍沿用既有契约。regional rebuild 的 changed/added/removed/owner-changed IDs 全为空。

## 实现及约束

- `tools/lossless_topology.py` 共享完全相同的子弧，不量化、取整、简化或移动坐标。每条原弧都必须精确重建，浮点负零保留。
- 完整 runtime 默认保护消费者使用的弧身份：同一对象内不同原弧保持独立；`political` 与 `scenario_atlantropa` 因共同参与选区合并，属于同一保护域。只在不共同参与这些运算的域之间共享子弧。
- 完整 TNO 构建及 regional rebuild 在源 JSON 达到 100 MiB 时尝试无损压缩；仍达上限会明确失败并要求拆分，不自动降低精度。
- `tools/scenario_chunk_assets.py` 对至少 1 MiB 的 political coarse 尝试绝对坐标 TopoJSON 编码，仅在体积更小时采用。粗层使用共享弧存储，加载后还原 GeoJSON。
- `js/core/scenario_chunk_format_shared.js` 由主线程和 startup worker 共用。两条路径都在进入缓存和地图消费者之前解码；完整 runtime topology 的加载契约不变。
- Python 严格契约、mixed-LOD、地块账本、display LOD、TNO precision 和 US county 验证入口同步支持新格式。

采用标准 [TopoJSON 格式](https://github.com/topojson/topojson-specification)，没有引入额外压缩依赖或自定义二进制格式。发布端继续使用已有 portable gzip 流程。

**内存及绘制成本没有因此减少。** coarse 的 `cache_byte_size` 仍是展开后的 **71,262,910 B**，高于 64 MiB 缓存软预算。`decoded_byte_size` 表示解压后的 wire JSON，`byte_size` 表示对应 URL 字节数。不得用较小的传输格式低报缓存成本。本轮解决文件与传输体积，不能据此宣称堆内存或全局 FPS 改善。

## 验证

- 生产 helper 与原型在真实完整拓扑上的输出逐字节一致。
- 使用实际 vendored topojson-client：553 项检查通过，覆盖 7 个对象的完整 feature 坐标、metadata、neighbors、五种 mesh 过滤，以及对象/国家/政治和 ATL 联合域的 merge。
- 8 组额外空间近邻政治/ATL 双选区 merge 一致；具有重复整环的 IN/FRI 地块仍保留独立弧身份。
- coarse 的 12,035 个 feature 经真实 JS decoder 解码后与原 FeatureCollection 逐项一致。实际 stage coarse 与该已验证候选的 JSON 完全一致，完整 runtime 与候选逐字节一致。因此没有引入新的粗细混合覆盖差异；此前 mixed-LOD 覆盖结果保持适用。
- stage 与 canonical 的 strict scenario contracts 均通过；data catalog 重建后内容不变，data health 只有 report-only 大文件警告；19 项 catalog contract tests 通过。
- lossless/codec 的 16 项 Python 单元测试通过；主线程/worker、plain/gzip、取消及 payload loader 组合 25 项 Node 测试通过。
- wire builder、gzip packing、display LOD 的 19 项目标测试通过；格式/contract/US county 组合 17 项及 precision expansion 的 20 项验证通过。
- 新版 coarse 对原 checked-in chunk test 的格式假设已更新，实际坐标数、部件数、bounds、文件大小、hash、缓存成本和 LOD diagnostics 检查通过。
- 缓存预算与路由组合 18 项通过；最终路由 9 项通过，无 route gap。
- 新 Pages 产物的大小/文件完整性、模块依赖、data manifest、runtime registry、scenario URLs、modern world runtime 6 项检查通过。worker 依赖清单已增加共享 decoder。
- 发布 gzip 解压 JSON 与 canonical coarse 相同，字节数、hash、cache weight 和 worker helper 发布路径核对通过。
- 内置浏览器打开新 Pages 产物，冷启动进入 TNO，选中瑞典、填色、撤销和重做可用状态验证通过；操作前后未捕获 warn/error。初次 DOM 读取曾因繁忙超时，截图捕获不可用，没有像素截图或冷启动提速声明。测试页及本任务服务器已关闭。

本机 Node 的 5 轮交替测量中，旧 coarse parse 中位 469.81 ms，新格式 parse+decode 中位 399.23 ms。它排除网络、gzip、浏览器调度和绘制，只作局部 CPU 参考。完整 stage 重建约 355 秒，峰值工作集约 3.68 GB；压缩有构建开销。

## 尚未通过的较宽范围

`tests.test_scenario_chunk_assets + tests.test_regional_scenario_assets + tests.test_tno_bundle_builder` 首次组合共 154 项，145 通过、9 项未通过。8 个非 OOM 项在把新增 runtime compactor mock 为 identity 后仍按同样异常/断言失败，且 compactor 调用次数为 0；包括旧海域 fixture、方向标记、地块命名及极地面积预期。另一项在 land reference 的旧 topojson NumPy 解码中申请 12.5 GiB，发生在进入新增 compactor 前，没有重复执行该内存分配。没有放宽这些测试。

直接运行完整旧 Pages 测试时，默认检查尚未物化完整的 tracked `dist`，出现大量缺失文件子断言；另有既存 landing hero 快照不匹配。随后以本次 `.runtime` 新产物为根运行了上述六项相关发布契约检查。完整旧 Pages 套件不标为通过。

当前旧工作区没有 `npm run pr:plan` 脚本。实际调用记录了 missing-script；随后通过已有只读兼容入口载入当前工作区的 catalog/routes，输出 `status=planned`、`exitCode=0`、无 route gap。该计划不是测试或 CI 通过证明。

## 复核材料

本次报告位于 `.runtime/reports/generated/asset-size-20261005/`：

- `stage-exactness.json`、`production_helper_runtime_check.json`
- `vendor_subarc_validation.json`、`vendor_cross_selections_and_cpu.json`
- `staged-contracts.json`、`canonical-contracts.json`
- `published-wire.json`、`canonical-integration.json`
- `builder_failure_baseline_attribution.json`、`pr-plan.json`

本地产物：`.runtime/tmp/asset-size-20261005/pages/`。本轮覆盖前的 13 个文件保存在 `.runtime/tmp/asset-size-20261005/canonical-before/`，供恢复及字节身份核对。
