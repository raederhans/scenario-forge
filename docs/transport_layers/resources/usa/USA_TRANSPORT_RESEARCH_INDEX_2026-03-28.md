# 美国交通专题研究总览

日期：2026-03-28

## 1. 一句话结论

美国这四条线里，`机场` 最适合先试点，`公路` 的全国官方主干路网主源也能成立，`港口` 有强官方主要商港点层，`铁路` 主线很强但“主要车站”的全国统一官方口径明显弱于日本。

## 2. 四条线总体成熟度判断

| 线别 | 总体成熟度 | 当前最强主锚点 | 几何 | 是否存在全国统一官方主源 | 与日本相比最明显的不同 |
|---|---|---|---|---|---|
| 铁路 | 中上 | FRA/BTS `NTAD North American Rail Network (NARN)` + `Amtrak Stations` | 线 + 点 | 主线有，主要车站只有 Amtrak 这一条较稳的全国口径 | 日本铁路是“官方主网 + 官方站点”更整齐；美国是“官方主线很强，但全国主要车站口径偏弱” |
| 公路 | 高 | Census `2024 TIGER/Line Roads` + FHWA `NHPN` | 线 | 有 | 日本公路更依赖 `OSM 主几何 + 官方高速加固`；美国主干路网官方主源本身就能成立 |
| 机场 | 很高 | FAA `NASR / Airport Data` + FAA 旅客登机数据 | 点 | 有 | 美国机场点源比日本更新更勤，且国家级重要度筛选也更清楚 |
| 港口 | 中上 | BTS/USACE `NTAD Principal Ports 2013-Present` | 点 | 有，但只覆盖主要商港 | 日本港口更像“旧但分类细碎的全国港湾源”；美国有更清楚的主要商港点层，但对象范围天然收在 `principal ports` |

## 3. 哪条线最适合先试点

当前最适合先试点的是 `机场`。

原因很直接：

- FAA `28 Day NASR Subscription` 当前更新频率最高，点位口径清楚。
- 机场本来就适合 `设施本体 + 点图层优先`，与现有仓库承接方式最顺。
- 重要度筛选可以直接参考 FAA 的旅客登机数据，而不是先发明一套启发式。
- 相比公路和铁路，机场几何简单、密度可控、分类边界也最清楚。

## 4. 和日本最明显的差异

美国和日本最明显的差异，不是“美国官方源更少”，而是 `美国四条线由不同联邦机构分别维护，因此专题强弱极不平均`。

- `铁路`：美国主线很强，因为 FRA/BTS 的 NARN 很成熟；但主要车站全国统一口径更弱，现实上更接近 `Amtrak-first`。
- `公路`：美国主干公路官方源比日本强，首版没有必要默认退回到 OSM 做主几何。
- `机场`：美国机场数据比日本更现势，重要度筛选也更容易。
- `港口`：美国主要商港点层比日本更适合点图层首版，但它并不是完整港区或全部港口设施体系。

## 5. 哪些地方必须降级到非官方但可信公开源

必须明确降级的地方，主要集中在 `铁路生命周期补丁` 和 `港口细粒度设施补充`。

### 5.1 铁路

- FRA/BTS 的 NARN 足够做主线官方骨架。
- 但 `disused / abandoned / construction` 这类生命周期状态，没有同等强度的全国统一官方公开层。
- 如果首版一定要把这些状态也画出来，只能降级到 Tier C 的 OSM 做生命周期补丁。

### 5.2 港口

- `Principal Ports` 足够做主要商港点层。
- 但如果要继续扩到：
  - 码头/泊位级设施
  - 更细的港区运营主体
  - 非 principal 的次级港口
- 就会落到 USACE 设施库、地方港务局、行业目录或协作源的混合补充，不能再冒充一个整齐的全国官方主层。

### 5.3 当前不必降级的地方

- `机场` 首版不必降级。
- `公路` 首版也不必降级。

## 6. 与现有仓库架构的承接判断

- `railways`
  - 仍然适合独立 deferred context pack
  - 线路和主要车站应分开
  - 但“主要车站”在美国应先收敛到 `Amtrak-first`
- `roads`
  - 适合独立 `roads` + `road_labels` pack
  - 美国可以先尝试 `官方主几何`
- `airports`
  - 最适合复用现有 `cityPoints` 风格点图层承接链
- `ports`
  - 也适合点图层承接，但首版应明确写成 `主要商港节点层`

## 7. 风险与下一步建议

1. 最大风险是把美国每条线都想象成“同等整齐的全国官方专题层”，这不成立。
2. 铁路最容易被误做成“线路强，站点也天然一样强”；实际上美国全国统一的主要车站官方层明显比日本弱。
3. 港口最容易被误做成“已有 principal ports 点层，所以港口体系已经完整”；实际上它只够支持主要商港节点层。
4. 建议的首版试点顺序：
   1. `机场`
   2. `公路`
   3. `港口`
   4. `铁路`

## 8. 关键来源

- [BTS NTAD 主入口](https://www.bts.gov/ntad)
- [FRA/BTS NARN 数据集](https://rosap.ntl.bts.gov/view/dot/53568)
- [Amtrak Stations 数据集](https://rosap.ntl.bts.gov/view/dot/55181)
- [2024 TIGER/Line Roads](https://www.census.gov/cgi-bin/geo/shapefiles/index.php?layergroup=Roads&year=2024)
- [FHWA NHPN 数据集](https://rosap.ntl.bts.gov/view/dot/54952)
- [FAA 28 Day NASR Subscription](https://www.faa.gov/air_traffic/flight_info/aeronav/Aero_Data/NASR_Subscription/)
- [FAA Passenger Boarding / All-Cargo Data](https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger/collection)
- [NTAD Aviation Facilities 数据集](https://rosap.ntl.bts.gov/view/dot/54907)
- [NTAD Principal Ports 数据集](https://rosap.ntl.bts.gov/view/dot/56578)
- [USACE Ports and Port Stat Areas 说明](https://www.iwr.usace.army.mil/Media/News-Stories/Article/3994727/ports-and-port-stat-areas-process-description/)
- [USACE WCSC Navigation Infrastructure](https://www.iwr.usace.army.mil/About/Technical-Centers/WCSC-Waterborne-Commerce-Statistics-Center/WCSC-Navigation-Infrastructure/)
