# 交通图层规划归档

日期：2026-03-28

## 1. 目的

这份文档用于归档当前对 `交通运输图层` 的整体判断，作为后续真正开工前的统一入口。当前讨论范围已经扩展到 `铁路`、`公路/高速公路`、`机场`、`港口`，其中铁路和公路的方法论已收口，机场与港口进入下一阶段研究范围，航道、航线仍记为后续扩展。

## 2. 当前已经锁定的需求

### 2.1 产品定位

- 首版不是情景编辑层。
- 首版定位为 `半业务图层`。
- 图层至少要支持：
  - 开关显示
  - 按类别筛选
  - 点击查看属性
  - 项目保存/导入后恢复状态

### 2.2 当前优先级

- 先做 `铁路`，暂不先做公路。
- 历史维度不做连续时间轴。
- 铁路首版只做：
  - `当前网络`
  - `状态分层`
- 状态分层先收口为：
  - `active`
  - `disused`
  - `abandoned`
  - `construction`

### 2.3 日本试点的已确认边界

- 试点国家：`日本`
- 数据策略：`官方源优先，OSM 补缺`
- 线路属性优先级：`状态 + 主干等级`
- 站点范围：`主要车站`
- 主要车站定义：`行政/城市权重优先`

### 2.4 机场与港口的已确认边界

- 先研究 `设施本体`
- 不把 `航线/航路` 一起并进来
- 几何形态优先采用 `点图层`
- 收录粒度采用 `主要节点优先`
- 推进顺序采用 `机场先行，港口并行研究`
- 当前场景默认是 `个人非传播用途`

## 3. 公开数据研究结论

## 3.1 铁路

### 结论

- 如果只要一个世界级粗底图，`Natural Earth Railroads` 可用，但只适合小比例尺背景，不适合高精度交互。
- 如果要做真正可扩展的全球铁路层，现实上还是要围绕 `OSM / Geofabrik` 建统一补缺能力。
- 如果要先做一个法律边界清晰、字段可控的试点，最优先的是 `官方全国铁路源`。
- 已识别的高价值官方试点国家：
  - 美国
  - 加拿大
  - 日本

### 主要候选源

| 来源 | 覆盖 | 角色 | 适合度 | 备注 |
|---|---|---|---|---|
| [Natural Earth Railroads](https://www.naturalearthdata.com/download/downloads/10m-cultural-vectors/) | 全球 | 世界粗底图 | 中 | 公有领域，但比例尺粗 |
| [OpenStreetMap Railways](https://wiki.openstreetmap.org/wiki/Railways) | 全球 | 统一补缺与全球扩展能力 | 很高 | ODbL，需要认真处理许可 |
| [Geofabrik](https://www.geofabrik.de/data/download.html) | 全球分区 | OSM 工程化提取入口 | 很高 | 日更，适合国家包下载 |
| [BTS / FRA Rail Network](https://www.bts.gov/newsroom/rail-network-spatial-dataset) | 美国 | 官方权威试点源 | 很高 | 美国全国网络，法律边界清晰 |
| [Canada NRWN](https://open.canada.ca/data/en/dataset/ac26807e-a1e8-49fa-87bf-451175a859b8) | 加拿大 | 官方权威试点源 | 很高 | 含 track segment / station / junction |
| [日本国土数値情報（铁路）](https://nlftp.mlit.go.jp/ksj/gml/product_spec/KS-PS-N02-v3_1.pdf) | 日本 | 官方权威试点源 | 很高 | 有线路与站点规范 |
| [INSPIRE Rail](https://knowledge-base.inspire.ec.europa.eu/transport-networks_en) | 欧盟成员国分散提供 | 第二阶段欧洲官方扩展 | 中 | 数据入口碎、格式碎 |
| [EuroRegionalMap](https://eurogeographics.org/maps-for-europe/euroregionalmap/) | 欧洲 | 高质量整编参考 | 中 | 默认不是开放即取即用 |

### 历史维度判断

- “不同年份的分级铁路数据”没有现成统一全球公开底库。
- 可行路线只有三种：
  - 用 `OSM full history` 自己切历史快照
  - 用 `OpenHistoricalMap` 补历史废线
  - 各国单独找历史铁路库
- 这三条都明显比“先做当前 + 废弃状态”复杂，因此不进入首版。

## 3.2 公路 / 高速公路

### 结论

- 如果以后做公路全球主图层，最现实的统一入口仍然是 `OSM / Geofabrik`。
- `Natural Earth roads` 不适合做全球交互主路网。
- `gROADS`、`GRIP` 更适合作为低缩放研究或参考层，不适合作为首版产品底座。
- 适合做官方试点的国家优先级很清楚：
  - 英国
  - 美国
  - 加拿大
  - 墨西哥

### 主要候选源

| 来源 | 覆盖 | 角色 | 适合度 | 备注 |
|---|---|---|---|---|
| [OSM / Geofabrik](https://www.geofabrik.de/data/download.html) | 全球 | 全球主路网候选 | 很高 | 等级字段细，更新快 |
| [US Census TIGER Roads](https://www.census.gov/cgi-bin/geo/shapefiles/index.php?layergroup=Roads&year=2024) | 美国 | 官方试点源 | 很高 | 年更，层次清晰 |
| [Canada NRN](https://search.open.canada.ca/opendata/similar/3d282116-e556-400c-9306-ca1a3cada77f?html=) | 加拿大 | 官方试点源 | 很高 | 国家级统一道路中心线 |
| [OS Open Roads](https://www.ordnancesurvey.co.uk/products/os-open-roads) | 英国 | 官方试点源 | 很高 | 体量适中，质量高 |
| [INEGI RNC](https://www.inegi.org.mx/servicios/Ruteo/Default.html) | 墨西哥 | 官方试点源 | 很高 | 国家道路网 |
| [Natural Earth Roads](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/roads/) | 全球但粗 | 粗底图 | 低 | 不适合主业务图层 |
| [gROADS](https://data.nasa.gov/dataset/global-roads-open-access-data-set-version-1-groadsv1) | 全球 | 低缩放研究参考 | 低 | 数据旧 |
| [GRIP](https://www.globio.info/download-grip-dataset) | 全球 | 低缩放等级参考 | 中低 | 许可表述需二次确认 |

## 3.3 机场与港口

### 结论

- `机场` 和 `港口` 不能直接按线网思维处理，首版必须先拆成 `设施本体` 和 `运输网络` 两层。
- 日本 `机场` 的官方开放主源已经足够强，首版没有必要先退回到 OSM。
- 日本 `港口` 可以研究和试点，但官方主源更旧、分类更碎，风险明显高于机场。
- `机场` 适合先行，`港口` 适合并行研究而不是立即作为同等成熟度试点。

### 主要候选源

| 来源 | 覆盖 | 角色 | 适合度 | 备注 |
|---|---|---|---|---|
| [国土数値情報 C28 空港データ](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-C28-2021.html) | 日本全国公共用空港・飞行场 | 日本机场主源 | 很高 | 点、面；2021；商用可 |
| [国土数値情報 N08 空港時系列](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N08-v1_3.html) | 日本全国公共用空港・飞行场 | 机场后备增强 | 高 | 点、面；2021；更偏时序 |
| [国土数値情報 C02 港湾データ](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-C02-2014.html) | 日本全国港湾法港口 | 日本商港主研究源 | 中高 | 点、线；2014；非商用 |
| [国土数値情報 C09 漁港データ](https://nlftp.mlit.go.jp/ksj/jpgis/datalist/KsjTmplt-C09.html) | 日本全国渔港 | 独立专题候选 | 中 | 点、线；2006；非商用 |
| [航空局 空港一覧](https://www.mlit.go.jp/koku/15_bf_000310.html) | 日本全国机场名录 | 核对层 | 中 | 无几何，不适合做主源 |

## 4. 架构评估结论

## 4.1 现有架构能不能接交通线图层

能接，而且已经有明显先例。

现有系统已经有一整套 `context layer` 路径：

- 后端读入层：
  - `map_builder/io/readers.py`
- 几何裁剪与清洗：
  - `map_builder/geo/utils.py`
- 独立图层 TopoJSON 输出：
  - `map_builder/geo/topology.py`
  - `build_named_layer_topology(...)`
- 前端延迟加载：
  - `js/core/data_loader.js`
- 前端状态管理：
  - `js/core/state.js`
- 前端线图层渲染先例：
  - `js/core/map_renderer.js` 的河流层
- 导入导出：
  - `js/core/file_manager.js`
- UI 开关与样式：
  - `js/ui/toolbar.js`
  - `js/ui/sidebar.js`
- 回归测试先例：
  - `tests/e2e/river_layer_regression.spec.js`
  - `tests/e2e/project_save_load_roundtrip.spec.js`

## 4.2 推荐接入方式

不建议首版把铁路或公路直接塞进主拓扑，也不建议走 scenario chunk。

推荐路径：

- `deferred context layer pack`
- 优先 `独立 TopoJSON pack`

原因：

- 启动负担更小
- 更适合线网这种高密度图层
- 可以按需加载
- 复制模式后，后续扩公路、机场、港口都更稳

对于 `机场` 和 `港口`，推荐进一步固定为：

- 复用 `cityPoints` 的点图层承接链
- 分别使用 `airports` 与 `ports` 两个独立 pack
- 点样式、标签密度、项目持久化优先沿用点图层模式

## 4.3 已识别的主要风险

- 最大风险不是“能不能画出来”，而是 `数据量与显示密度`。
- 如果全球道路或铁路全量直接上图，高缩放前会非常糊。
- 现有 UI 与状态不是插件化图层系统，新图层需要多处显式接线，容易漏改。
- OSM 许可边界不能模糊处理，尤其是以后如果要导出派生数据库。
- 各国分类口径不一致，必须有一层内部统一 schema，不能把源字段直接暴露成产品字段。

## 5. 当前建议的执行顺序

## 5.1 铁路

### 第一阶段：日本铁路试点

- 只做铁路，不同时上公路。
- 只做：
  - 线路
  - 主要车站
- 历史先不做年份快照。
- 只做状态与等级分层。

### 第二阶段：铁路第二批国家

- 加拿大
- 美国

### 第三阶段：欧洲官方样板扩展

- 选 1 到 2 个 INSPIRE 数据质量高的国家先做验证。

## 5.2 公路

公路暂缓，但后续优先顺序建议如下：

1. 英国
2. 加拿大
3. 美国
4. 墨西哥

如果以后要快速铺全球，则改为：

1. OSM/Geofabrik 做全球主线
2. 官方国家源做重点国家替换或增强

## 6. 总体方法论

后续所有交通基础设施图层统一采用以下方法：

1. `先定义产品字段`，再选数据源，不反过来。
2. `官方源优先，OSM 补缺`，不追求“一套源打天下”。
3. `首版只做可解释的层级`，不要一开始塞太多业务属性。
4. `先走独立 deferred pack`，不污染主拓扑。
5. `先在一个国家跑通全链路`，再复制模式到第二个国家。

## 7. 当前冻结的范围

以下内容明确不进入本轮首版：

- 连续历史时间轴
- 全国全站点
- 公路与铁路同时开工
- 航道、航线
- routing、可达性分析、时刻表、运量模型
- 情景规则编辑和交通层写回

## 8. 后续真正开工前必须再确认的事项

- 日本铁路主干等级映射规则
- 主要车站的机械筛选规则
- 官方源与 OSM 补缺时的去重策略
- OSM 许可在产品展示、缓存和导出中的边界
- 线图层默认显示缩放阈值

机场与港口补充确认项：

- 机场主要节点的收录标准
- 港口主要节点的收录标准
- 港口是否长期排除渔港
- 设施点图层的默认标签密度与重要度映射

## 9. 下一批高价值候选

除了交通设施，还值得继续收口的专题层包括：

- `矿产/资源`
- `能源设施`
- `工业节点`

这些对象更适合作为独立专题设施图层推进，通常比航线、航路更容易在首版建立产品价值。

## 10. 一句话结论

当前最稳的路线不是“立刻做全球交通系统”，而是：

`先在日本分别把铁路、公路、机场、港口这些高价值层的口径跑顺，其中铁路与公路先收线网方法，机场与港口先收设施点层方法；等这一套模式稳定，再复制到更多国家与更多专题设施。`
