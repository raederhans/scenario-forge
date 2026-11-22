# 1897 年俄罗斯帝国县界

县级几何来自 Kessler 与 Markevich 的 *Electronic Repository of Russian Historical Statistics*，使用 CC0 许可。[数据来源](https://doi.org/10.34894/NQOASN)

从仓库根目录运行 `python tools/prepare_rcw_sources.py --source <districts.gpkg>`。抽取程序保留 EPSG:4326 的 824 个县，取英文省名、英俄县名，以 `prov_ENG/Name_ENG` 排序。坐标吸附到 0.0001 度网格，县界整体用覆盖简化算法处理，共边两侧同时简化，容差参数为 0.012 度。文件保留来源经度，楚科奇东端超过东经 180 度。

`python tools/prepare_rcw_sources.py --check` 检查县键和几何有效性，原始文件可用时还逐字节核对抽取结果。剧本重建只依赖入库的 GeoJSON。

## 现代区界

`adm2_units.geojson` 收录 geoBoundaries gbOpen 版本 `9469f09` 的六国 ADM2，共 591 个区。使用 `--adm2-dir <目录>` 指定原始 GeoJSON 所在目录。按国家分别将 EPSG:4326 坐标保留四位小数，再按 0.012 度容差简化共边。稳定键为 `shapeGroup/shapeID`，区名保留原始 `shapeName`，包括土库曼斯坦来源中的空值。

| 国家 | 署名 | 许可 |
|---|---|---|
| KAZ、TJK、LTU | OpenStreetMap, Wambacher | Open Data Commons Open Database License 1.0 |
| UZB | OCHA ROCCA | CC BY 3.0 IGO |
| TKM | CIESIN | CC BY-SA 3.0 Unported |
| KGZ | geoBoundaries, Wikipedia, Districts of Kyrgyzstan | CC BY-SA 3.0 Unported |

各国原始文件的下载地址和 SHA-256 见同目录的 `adm2_units.provenance.json`。
