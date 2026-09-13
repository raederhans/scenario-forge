# 数据分块与体积优化结果

三个部分已实现：发布 JSON 无损紧凑化、主线程及 Worker 的显式 gzip 加载、大体积 owner 数据的完整要素空间分块。源码数据未重写，未提交或部署。

## 实测

| 项目 | 原构建 | 优化构建 |
| --- | ---: | ---: |
| Pages 产物 | 994.27 MiB | 512.17 MiB |
| 三个剧本的注册分块 | 438 | 462 |
| TNO 巴黎视野所选细节文件体积 | 20,514,697 B | 896,479 B |
| 同视野待解析 JSON | 20,514,697 B | 2,833,264 B |
| 同视野估算路径成本 | 262,734 | 129,091 |

产物减少 482.10 MiB / 48.49%，包含紧凑化、分块 gzip 和清除复制产物中不再被清单引用的旧分块。基线为 `.runtime/reports/generated/geometry-refresh-pages-final`，结果为 `.runtime/reports/generated/data-packing-ready`。

视野数据来自实际清单和生产选择器，固定 zoom=4、巴黎 bbox=[1.8,48.5,2.7,49.1]、focus=FRA，只计必需政治细节，不包括常驻全球底图。它证明所选文件与解析工作量变化，不是 FPS 或广域网络速度测试。保持现有数量、路径成本和缓存预算，因此宽视野仍可能先显示部分地区的粗层；完整细节随视野按需加载。

TNO 实际生成 FRA 4 块、GER 4 块、USA 2 块。默认目标为每块 2 MiB 紧凑 JSON / 100,000 路径成本，任一超限即按完整要素划分。单个超大要素保持完整，允许超过目标，不裁剪或舍入坐标。两种构建共用纯 Python 分块算法，精简 Pages 构建不增加 GIS 依赖。

## 验证

- 462 个发布分块的 gzip、字节数、摘要、缓存权重与清单一致；58,871 个政治细节要素的 ID、属性、几何、owner 和完整集合一致；另 245 份独立几何资源一致。
- 新分块的 feature_bounds 与 payload 顺序逐项匹配，context LOD 引用及 runtime_meta 数量一致；startup bundle 摘要和 gzip/plain 内容一致。
- Python 打包、空间分块、增量缓存等专项 26 项通过。既有生成器及契约组合 63 项中 62 项通过、1 项现存台账断言失败，见下文。
- 解压与取消相关 Node 测试 25 项通过；既有 chunk quick/payload/cancellation 70 项、新空间选择及缓存 4 项通过；项目导入导出往返 41 项通过。
- 对最终产物的体积、模块可达性、剧本资源 URL、数据输出清单四项 Pages 检查通过。浏览器探针清理后核对最终文件清单尺寸一致。
- Codex 内置浏览器 localhost：TNO 启动并显示地图，缩放至 200%、自动填色、撤销可操作。真实法国分块在主线程原生解压、禁用 DecompressionStream 后的 fflate、真实 startup Worker 的 fflate 路径均成功，完整 payload 相同。没有更改解压能力的全局用户设置。
- 当前预览以 app 为服务器根目录，favicon 和 landing sample-runs 的根资源请求出现 404；分块请求正常。未进行全站巡检或稳定 FPS 基准。此次创建的两个页面、临时探针文件和 8003 服务均已清理。

现存失败：`tests.test_scenario_contracts.ScenarioContractTest.test_checked_in_tno_coverage_ledgers_expose_strict_machine_fields` 要求 `runtime_feature_count > 800`，当前台账为 725。优化前基线产物的同一台账亦为 725。本次没有修改此数据或放宽断言，因此不能宣称全部仓库测试通过。

证据：`.runtime/reports/generated/data-packing-validation.json`、`data-packing-selection.json`、`data-packing-browser-proof.json`，以及 `.runtime/tmp/data-packing-*-tests.log` 和对应构建日志。

## 委派与实现入口

智谱 GLM-5.3 和 Antigravity 均实际启动。智谱返回 1113 额度/资源包错误后，路由自动由 Antigravity 接续；Antigravity 两个任务在写状态/检查点时分别出现 WinError 5。主代理核实相关进程结束后接管文件，通过实际差异、回归测试和浏览器验证收尾，未把 CLI 状态当作实现验收。

入口：`tools/runtime_json_packing.py`、`tools/political_detail_partition.py`、`tools/scenario_chunk_assets.py`、`tools/build_pages_dist.py`、`tools/check_scenario_contracts.py`、`tools/regional_scenario_assets.py`；加载入口为 `js/core/json_resource_decoder_shared.js`、`js/core/data_loader.js`、`js/workers/startup_boot.worker.js`。选择、预热和缓存成本在 `js/core/scenario_chunk_manager.js`、`js/core/scenario/chunk_runtime.js`、`js/core/scenario/bundle_cache_policy.js`。
