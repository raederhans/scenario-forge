# 1897 年俄罗斯帝国县界

县级几何来自 Kessler 与 Markevich 的 *Electronic Repository of Russian Historical Statistics*，使用 CC0 许可。[数据来源](https://doi.org/10.34894/NQOASN)

从仓库根目录运行 `python tools/prepare_rcw_sources.py --source <districts.gpkg>`。抽取程序保留 EPSG:4326 的 824 个县，取英文省名、英俄县名，以 `prov_ENG/Name_ENG` 排序。坐标吸附到 0.0001 度网格，县界整体用覆盖简化算法处理，共边两侧同时简化，容差参数为 0.012 度。文件保留来源经度，楚科奇东端超过东经 180 度。

`python tools/prepare_rcw_sources.py --check` 检查县键和几何有效性，原始文件可用时还逐字节核对抽取结果。剧本重建只依赖入库的 GeoJSON。
