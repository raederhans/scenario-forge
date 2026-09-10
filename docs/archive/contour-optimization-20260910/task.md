# 等值线优化：首轮实现完成

- [x] 隔离分支 codex/contour-optimization，起点 24169584；原工作区未修改。
- [x] P1 海洋球面几何修复：global 原46个、TNO原2个补球面异常已消除；实际资产保留全部1534/90个要素。现代世界/TNO浏览器均无跨洋错误色带。
- [x] P2 陆地等高线减密、延后次线、降低对比，拆分真实pass样式依赖。默认atlas_only保持。
- [x] P3 三档几何与按需加载：粗主线0.78MB，中主线2.73MB，中次线6.95MB，原detail保持；常规physical context生成链及CLI都能重建。旧导入默认值、取消接收者、旧LOD响应、往返缩放、同情景重置及失败后重试均有覆盖。
- [x] P4 投影路径缓存、整批stroke、海洋裁剪路径复用、屏幕外预剔除及分项计时。首次切换峰值仍存在，未宣称全项目性能问题完全解决。
- [x] 目标测试、数据健康、import graph、dist构建和对应发布契约检查。

## 最终本地观测

Windows本机，Playwright Chromium，1280x720、DPR1、balanced、TNO；baseline使用同worktree基线JS与资产注册表。每组3次强制重绘，表内为局部指标中位数，不能代替整帧FPS、跨设备或CI性能门槛。

| 局部指标 | 基线 | 本轮 |
| --- | ---: | ---: |
| 3倍缩放等高线重复绘制 | 123.6ms | 10.6ms |
| 4.5倍缩放等高线重复绘制 | 59.3ms | 6.7ms |
| 世界视图海洋clip重复调用 | 342.7ms | 0.1ms |

世界视图仅请求global_contours.low.major.topo.json，显示4525个粗主线源要素、0次线；4.5倍加载原detail；返回世界视图恢复4525/0；3.2倍次线门槛启用13828/35664中档集合。同情景清空显示引用后可从缓存恢复。

冷帧仍有约0.3–0.9秒的局部峰值，不能用上述warm数据掩盖：最终3.2倍切换样本871.6ms，其中主线样式613.5ms、次线样式81.5ms、主次筛选约155.4ms。TNO新缩放首次海洋clip384.4ms，重复调用0–0.1ms。下一轮应优先把空间归属/自适应颜色计算移出首次同步绘制，研究分批预热，并单独优化首次遮罩构建。

## 验证

- 核心JS组合106项通过，日志final-node.log。
- LOD渲染入口/失败重试新增回归、海深契约、state写边界组合15项通过（其中LOD策略6项与核心组合重叠），日志final-wiring.log。
- Python生成器、原contour契约、catalog、renderer state边界34项通过，日志final-python.log。
- data_health.py完成治理域检查，仅既有大文件warning，日志data-health-final.log。
- node tools/build_test_import_graph.mjs已更新57个spec导入图。
- npm run python -- tools/build_pages_dist.py成功，dist931.38MiB，日志build-final.log。
- Python发布文件/registry/catalog/renderer facade契约9项通过；JS renderer inventory/dist一致性9项通过，日志dist-contracts-final.log及dist-inventory-final.log。
- 最终TNO陆地、TNO海洋及modern_world海洋三组浏览器检查PASS，均无pageerror。TNO无失败请求；modern_world有2个既有启动本地化404（locales.startup.json、geo_aliases.startup.json），这两个文件在本轮基线也不存在，不是等值线资源。未将其报告为全站无网络失败。
- git diff --check通过。未运行全量CI、发布或冻结性能门槛。

所有日志、JSON采样和截图位于.runtime/browser/contour-optimization/。浏览器实例已关闭，本轮8008服务已停止。

## 交付与边界

当前为独立worktree未提交实现，不提交、推送、合并或发布。未整合原工作区城市/海域WIP。全球海深覆盖扩建、TNO真实海底重建、首次样式/遮罩峰值的进一步消除不属于本轮已完成声明。
