# 德国机场专题研究归档

日期：2026-03-28

## 1. 一句话结论

德国机场可以直接按 `官方点位主源 + 准官方排序补强` 来做：全国官方开放点位主源可用，但如果业务口径明确要求“主要公共/民航机场”，仍要用 `ADV` 之类准官方来源补强筛选和重要性判断。

## 2. 研究边界

- 只研究 `设施本体`
- 只做 `点图层优先`
- 只优先收 `主要公共/民航机场`
- 不研究航线、机场范围面、军用专题设施、直升机场专题
- 当前判断以是否适合做上下文设施层为准

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [BKG POI-Open](https://gdz.bkg.bund.de/index.php/default/digitale-geodaten/poi-open.html) | 德国全国 | 点 | 产品页说明半年更新一次 | BKG 开源数据，适用 `Datenlizenz Deutschland – Namensnennung – Version 2.0` | Tier A | 是 | 这是最稳的全国官方开放机场点位主源，但它是通用 POI 体系，不自动等于“主要民航机场清单” |
| [ADV Verkehrszahlen](https://www.adv.aero/verkehrszahlen/) | 德国主要商用机场 | 统计表/名录 | 持续更新 | 机场协会公开统计，适合做重要性与筛选参考，不是官方 GIS 点位主源 | Tier B | 否，适合补强 | 适合判断哪些机场应进入“主要公共/民航机场”首版层 |
| [ADV Mitglieder](https://www.adv.aero/der-verband/mitglieder/) | 德国主要机场运营主体 | 名录 | 持续更新 | 协会公开名录，不是统一 GIS 数据源 | Tier B | 否，适合补强 | 有助于核对机场名单和业务口径，但不适合单独当点位主源 |
| [Geofabrik Germany / OpenStreetMap](https://download.geofabrik.de/europe/germany.html) | 德国全国 | 点、面 | 频繁更新 | ODbL；衍生使用需遵守 OSM 规则 | Tier C | 是，但只适合补缺 | 若需要补充 IATA/ICAO、缺失点或更细设施几何，OSM 可作为降级补缺源 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- `BKG POI-Open`

它已经满足当前项目最关键的几点：

- 全国覆盖
- 官方开放
- 点位形态
- 适合直接进入设施点层

### 4.2 后备源

- `ADV Verkehrszahlen`：判断首版哪些机场算“主要公共/民航机场”
- `ADV Mitglieder`：补强运营主体与名单核对
- `OSM / Geofabrik Germany`：只在需要补代码、补点位或补细节时降级使用

### 4.3 排除项

- 航线网络
- 机场范围面
- 军用机场专题
- 直升机场专题
- 把通用 POI 点位直接等同于“已经筛好的主要民航机场业务层”

## 5. 与现有仓库架构的承接判断

德国机场最适合直接复用现有 `city points` 风格的点层链路：

- 资源层命名可直接落到 `airports`
- 几何形态保持为点
- 重要性筛选通过构建时规则完成，不要把排序逻辑塞到渲染层

最稳的首版结构是：

- `airports_all_official_points`：官方点位全集
- `airports_major`：按 `ADV` 或其他准官方公开统计筛出来的主要民航机场子集

## 6. 与日本最明显的不同

日本机场试点更像“国家专题空港数据本身就很贴近业务对象”；德国机场更像“官方开放点位是稳的，但业务筛选语义需要再补一层”。

- 日本更接近专题空港数据包
- 德国更接近通用官方 POI 主源 + 准官方民航重要性补强

## 7. 风险与下一步建议

### 7.1 风险

1. `POI-Open` 的优点是官方、全国、开放，但它不是为“主要公共/民航机场图层”这个业务目标专门设计的。
2. 如果不做筛选，机场层很容易混入不想要的特种机场或语义不一致对象。
3. 如果后续强行追求完整 IATA/ICAO、运营方、跑道等富属性，全国统一官方开放主源并不充分，必须接受准官方或降级补充。

### 7.2 下一步建议

1. 首版德国机场先以 `BKG POI-Open` 跑通全国点位层。
2. 同时用 `ADV` 做“主要民航机场”筛选规则，优先保留大型公共机场。
3. 只有在需要富属性航空代码时，再显式引入 `OSM` 或机场运营方公开资料做补强，并写清来源层级。

## 8. 关键来源列表

- Tier A: [BKG POI-Open](https://gdz.bkg.bund.de/index.php/default/digitale-geodaten/poi-open.html)
- Tier B: [ADV Verkehrszahlen](https://www.adv.aero/verkehrszahlen/)
- Tier B: [ADV Mitglieder](https://www.adv.aero/der-verband/mitglieder/)
- Tier C: [Geofabrik Germany](https://download.geofabrik.de/europe/germany.html)
