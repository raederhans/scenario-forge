# 分级资产与加载实现交接

三份派生资产已生成并登记 registry/catalog：low major 4525 features / 780190 bytes；mid major 13828 / 2730247；mid minor 35664 / 6949647。detail 主次线原文件保持。没有 low minor runtime 资产。

map_builder/processors/contour_lod.py 是常规 physical context pipeline 与 tools/build_contour_lod_assets.py 共同使用的生成库。复现命令：py -3 tools/build_contour_lod_assets.py；随后 py -3 tools/build_data_catalog.py。

physical_contour_lod_policy 统一规范化旧导入样式：k<1.4 粗主线，1.4<=k<4 中主线，达到 preset 次线阈值才请求中次线；显式100m次线使用detail原数据；k>=4进入detail。异步结果缓存与display aliases分别提交，取消接收者不发布，旧LOD响应不覆盖当前选择。

地图帧准备入口触发LOD选择，包含复用缓存画布的缩放路径。请求去重同时考虑缓存及显示引用，数据重置后可以恢复。最终浏览器与构建验收以 task.md 为准。
