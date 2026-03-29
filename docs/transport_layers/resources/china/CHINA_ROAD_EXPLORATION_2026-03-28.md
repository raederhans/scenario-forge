# 中国公路专题研究归档

日期：2026-03-28

## 1. 一句话结论

中国公路这条线当前最稳的判断也是 `OSM 主几何 + 官方属性加固`：中国大陆有很强的国家公路网规划、路线编号和高速公路建设口径，但公开可直接承接全国主干路网的静态线几何主源不够顺；台湾高速公路局公开设施点、路径和坐标数据更丰富，但也没有像英国那样一张天然干净的全国主干路开源主表。

## 2. 研究边界

- 只研究 `最新快照`
- 只研究 `motorway / trunk / primary`
- 不研究历史回溯
- 不研究 routing、收费、复杂节点体系
- 不研究 `secondary` 及以下道路

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [《国家公路网规划》解读](https://www.mot.gov.cn/2022zhengcejd/202207/t20220711_3660992.html) | 中国大陆国家公路网 | 路线方案、编号口径 | 2022-07 | 官方政策解读，不是 GIS 主包 | Tier A | 否 | 大陆公路的路线口径强，但不是线几何主源 |
| [公路“十四五”发展规划](https://www.mot.gov.cn/zhuanti/shisiwujtysfzgh/202201/t20220129_3639054.html) | 中国大陆公路骨架 | 规划、骨架说明 | 2022-01 | 官方规划文件 | Tier A | 否 | 适合做主干路等级映射和国家通道核对 |
| [高速公路交流道座標](https://data.gov.tw/dataset/166496) | 台湾国道 | 点 | 詮釋資料更新时间 2024-08-01 | 政府资料开放授权条款第1版 | Tier A | 否，但适合补强 | 台湾高速路关键节点公开得很清楚 |
| [國道計費門架座標及里程牌價表](https://data.gov.tw/dataset/21165) | 台湾国道 | 点 | data.gov.tw 持续可取 | 政府资料开放授权条款第1版 | Tier A | 否，但适合补强 | 可辅助识别台湾国道主走廊与编号口径 |
| [臺灣地區主要公路路網圖](https://data.gov.tw/dataset/72417) | 台湾主要公路 | 路网图/路线信息 | data.gov.tw 页面长期可取 | 政府资料开放授权条款第1版 | Tier A | 否，适合作为路线核对 | 适合做台湾主要公路对象范围与路线口径核对 |
| [各旅次路徑原始資料 (M06A)](https://data.gov.tw/dataset/37760) | 台湾国道 | 路径序列 | data.gov.tw 可取 | 政府资料开放授权条款第1版 | Tier A | 否，适合后备 | 更像通行路径数据，不是首版静态路网主层 |
| [OpenStreetMap / Geofabrik China](https://download.geofabrik.de/asia/china.html) | 中国大陆 | 线 | 频繁更新 | ODbL | Tier C | 是 | 当前最现实的大陆主几何来源 |
| [OpenStreetMap / Geofabrik Taiwan](https://download.geofabrik.de/asia/taiwan.html) | 台湾 | 线 | 频繁更新 | ODbL | Tier C | 是 | 当前最现实的台湾静态主几何来源 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- `roads` 线主几何：OpenStreetMap / Geofabrik

### 4.2 后备源

- 大陆：交通运输部国家公路网规划、路线编号、建设进展信息
- 台湾：高速公路局交流道坐标、计费门架坐标、路径数据

### 4.3 排除项

- 历史回溯
- 匝道体系和导航级连通性
- 省道、县道、乡道的全量并表
- 把规划类文章误写成线几何主源

## 5. 大陆与台湾差异

### 5.1 大陆

- 规划和国家骨架口径强。
- 公开 GIS 主几何弱。
- 因此大陆部分必须接受 `OSM 主几何 + 官方路线口径加固`。

### 5.2 台湾

- 高速公路设施点、门架、里程和路径类数据公开更丰富。
- 但静态全国主干路线开源主表仍不如英国公路那样干净。
- 因此台湾部分虽然属性支撑更好，首版几何仍建议让 OSM 扛主位。

## 6. 与现有仓库架构的承接判断

- 继续走 `roads` + `road_labels` 两个 pack
- `roads` 用 OSM 主几何
- `road_labels` 和等级映射按大陆/台湾分别补强
- 构建期保留 `subregion = mainland / Taiwan`

## 7. 与日本最明显的不同

- 日本公路还能比较自然地围绕单国官方专题层做高速加固。
- 中国整体更像“国家路线方案和设施坐标强，但公开静态主干路线几何主源弱”。
- 台湾辅助数据比大陆丰富，但不足以改变中国整体仍需 `OSM 主几何` 的现实。

## 8. 风险与下一步建议

1. 最大风险是把路线规划、公报和动态路径误写成现成静态路网层。
2. 第二个风险是因为台湾点数据丰富，就误以为中国整体也有同等级主源。
3. 第三个风险是把这条线做成导航级道路系统；当前研究只允许做到主干上下文层。
4. 中国公路首版如果真要开工，应先只保留 `motorway / trunk / primary`，不要贪多。

## 9. 关键来源列表

- <https://www.mot.gov.cn/jiaotongyaowen/202207/t20220726_3661842.html>
- <https://www.mot.gov.cn/2022zhengcejd/202207/t20220711_3660992.html>
- <https://www.mot.gov.cn/zhuanti/shisiwujtysfzgh/202201/t20220129_3639054.html>
- <https://data.gov.tw/dataset/166496>
- <https://data.gov.tw/dataset/21165>
- <https://data.gov.tw/dataset/72417>
- <https://data.gov.tw/dataset/37760>
- <https://download.geofabrik.de/asia/china.html>
- <https://download.geofabrik.de/asia/taiwan.html>
