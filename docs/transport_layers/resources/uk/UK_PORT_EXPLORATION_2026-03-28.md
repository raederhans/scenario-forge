# 英国港口试点探索归档

日期：2026-03-28

## 1. 一句话结论

英国港口这条线最稳的写法是 `官方 major ports 名单/统计 + 点位几何补充`：DfT 与 HMRC 足够强，可以稳定回答“哪些是主要港口、叫什么、代码是什么”，但当前没有找到同样干净的英国全国港口点位主源，所以这条线适合先做 `主要商港节点层`，不宜伪装成完整港口设施系统。

## 2. 研究边界

- 固定为 `设施本体`
- 固定为 `点图层优先`
- 固定优先收 `主要商港 / 关键港口节点`
- 不研究航路
- 不研究港域界和港湾区域线
- 不研究渔港专题
- 不研究码头、泊位、仓储等细设施体系

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [DfT Port and domestic waterborne freight statistics (PORT)](https://www.gov.uk/government/statistical-data-sets/port-and-domestic-waterborne-freight-statistics-port) | UK ports，重点是 major ports | 统计表；附港口名单与 tonnage map，不是标准 GIS 点层 | 2025-12-17 更新 | GOV.UK 统计发布，OGL 路线明确 | Tier A | 适合作为 major ports 主名单与重要度主源，不适合作为点位主源 | 这是英国港口研究里最强的官方锚点 |
| [Port freight annual statistics: 2024 overview](https://www.gov.uk/government/statistics/port-freight-annual-statistics-2024/port-freight-annual-statistics-2024-overview-of-port-freight-statistics-and-useful-information) | UK sea ports | 无独立几何 | 2025 年发布 2024 统计 | OGL | Tier A | 适合作为口径说明层 | 明确说明“多数出版物覆盖 major ports”以及数据收集方法 |
| [HMRC UK ports and port codes](https://www.gov.uk/government/collections/uk-ports-and-port-codes) | UK port lists and codes | 名录，无统一几何 | 2023-04-18 总页更新，子页持续更新 | OGL | Tier A | 适合作为名称/代码核对层 | 很适合统一 port name / code，不适合作为点位主源 |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | UK 全域 | 点、面 | 持续更新 | ODbL | Tier C | 适合作为点位几何补充 | 如果首版必须快速出 major ports 点层，现实上要靠它或人工核点 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- `港口名单与重要度主源`：DfT PORT 系列
- `港口名称/代码核对`：HMRC UK ports and port codes

### 4.2 后备源

- DfT 年度统计说明，用于统一“major ports”口径解释
- OpenStreetMap，用于点位几何补充

### 4.3 排除项

- 渔港专题
- 航路、海上流通线
- 港域面、港区界线
- 码头与泊位级细设施

## 5. 与现有仓库架构的承接判断

- 继续走点设施层，不走线层。
- 首版最好直接写成 `ports_major` 或等价的“主要商港节点层”概念，而不是“全国港口设施全景层”。
- 数据层同样要把 `官方名单/重要度` 与 `点位几何` 分离保存。
- 样式上建议只做少量等级：`national hub / major port / secondary included port`，不要在首版发明更细碎的港口业务分类。

## 6. 与日本最明显的不同

- 日本港口研究的主难点是“源旧但专题性强”；英国的主难点是“统计口径强，但 GIS 设施层不直接给你”。
- 日本更容易碰到非商用或旧数据风险；英国这一条线更多是 `统计强、点位弱`。
- 英国比日本更适合先直接缩成 `major ports node layer`，而不是试图保留完整港口体系语义。

## 7. 风险与下一步建议

1. 最大风险是把 DfT major port statistics 误写成“全国港口点位主层”。它不是。
2. 第二个风险是忽略 HMRC port codes 的价值，导致后续港口命名和代码体系不稳定。
3. 第三个风险是把研究可用和产品可用混成一句话。英国港口这条线研究很可用，但几何仍需补充。
4. 建议首版就接受这个收缩口径：
   1. 先只做 `major commercial ports`
   2. 用 DfT 统计定重要度
   3. 用 HMRC 代码清洗名称
   4. 再补点位几何

## 8. 关键来源列表

- <https://www.gov.uk/government/statistical-data-sets/port-and-domestic-waterborne-freight-statistics-port>
- <https://www.gov.uk/government/statistics/port-freight-annual-statistics-2024/port-freight-annual-statistics-2024-overview-of-port-freight-statistics-and-useful-information>
- <https://www.gov.uk/government/statistics/port-freight-annual-statistics-2024/port-freight-statistics-notes-and-definitions>
- <https://www.gov.uk/government/collections/uk-ports-and-port-codes>
- <https://www.openstreetmap.org/copyright>
