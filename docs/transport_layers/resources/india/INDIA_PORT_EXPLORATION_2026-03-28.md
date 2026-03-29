# 印度港口专题研究归档

日期：2026-03-28

## 1. 一句话结论

印度港口这条线当前最稳的写法是 `官方 major ports 名单/统计 + 点位几何补充`：官方 major ports 体系和月度/年度统计都很强，但全国主要港口点几何主源不够整齐，首版应明确只做 `主要商港/关键港口节点层`。

## 2. 研究边界

- 只研究 `设施本体`
- 只做 `点图层优先`
- 只优先收 `主要商港/关键港口节点`
- 不研究航路
- 不研究港域界
- 不研究港湾区域线
- 不研究渔港专题

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [Ports Wing | Ministry of Ports, Shipping and Waterways](https://shipmin.gov.in/en/division/ports-wing) | 印度 major ports 体系 | 名录 | 页面最近修改 2026-03-06 | 官方网站内容，适合作对象范围判断 | Tier A | 是，作为 major ports 主名录 | 当前 major ports 口径最清楚的官方入口 |
| [Basic Port Statistics of India 2023-24](https://www.shipmin.gov.in/en/content/basic-port-statistics-india-2023-24) | 印度 major ports 与更广港口统计 | 统计 | Page Last Update 2025-08-20 | 官方 PDF 统计，适合作重要度判断 | Tier A | 否，适合作排序补强 | 适合决定关键节点，不解决点位几何 |
| [Traffic Handled at Major Ports in India | OGD India](https://jk.data.gov.in/catalog/traffic-handled-major-ports-india) | 印度 12 major ports | 统计、名录 | 页面显示 2024-06-13 更新 | Government Open Data License - India | Tier A | 否，适合作 major ports 流量核对 | 对 major ports 节点层很有用 |
| [Monthly Cargo Traffic handled at Non-Major Ports during December 2025](https://shipmin.gov.in/hi/content/monthly-cargo-traffic-handled-non-major-ports-during-december-2025) | 印度 non-major ports | 统计 | Page Last Update 2026-01-15 | 官方 PDF 统计，说明非 major ports 存在单独体系 | Tier A | 否 | 说明 non-major ports 需要单独处理，不能混成一张天然全国主层 |
| [OpenStreetMap / Geofabrik India](https://download.geofabrik.de/asia/india.html) | 印度全国 | 点、线、面 | 频繁更新 | ODbL | Tier C | 是，但只适合作几何补充 | 当前最现实的全国港口点位补充源 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- major ports 名录主源：`Ports Wing`
- 重要度主源：`Basic Port Statistics of India` + `Traffic Handled at Major Ports in India`
- 点位几何：`OSM / Geofabrik India`

### 4.2 后备源

- `Monthly Cargo Traffic handled at Non-Major Ports`：证明 non-major ports 需要单独处理
- 必要时再引入州级港务机构公开资料，做 selected non-major port 补强

### 4.3 排除项

- 航路和国家水道网络
- 港域边界和港区面
- 把全部 non-major ports 一次性混入首版
- 把官方统计体系误写成已经具备干净点主源

## 5. 与现有仓库架构的承接判断

- 继续按 `ports` 点图层承接。
- 首版最稳的产品写法是 `major ports / critical ports` 节点层，而不是“全国港口设施全景层”。
- 如果后续需要加入 non-major ports，文档里应显式写成 `全国 major ports 骨架 + 州级/地方补强`。
- 这条线很适合作为点层快速试点，但前提是范围要收紧。

## 6. 与日本最明显的不同

- 日本港口更像旧但相对贴题的专题地理源；印度港口更像 official major ports 体系统计强、空间点源弱。
- 日本的问题更偏源旧和许可边界；印度的问题更偏“major / non-major 双体系”与点位几何补充。
- 因此印度港口首版更适合先做一个范围受控的 `主要商港/关键港口节点层`。

## 7. 风险与下一步建议

1. 最大风险是把 major ports 名录和统计强度误写成全国港口几何主层已经成立。
2. 第二个风险是把 non-major ports 也硬塞进首版，导致中央 + 邦级碎片化问题提前爆炸。
3. 第三个风险是把国家水道或水运网络混进港口设施层。
4. 建议首版先围绕 major ports 和少数关键节点落地；只有在明确存在高质量州级公开源时，再增补 non-major ports。

## 8. 关键来源列表

- <https://shipmin.gov.in/en/division/ports-wing>
- <https://www.shipmin.gov.in/en/content/basic-port-statistics-india-2023-24>
- <https://jk.data.gov.in/catalog/traffic-handled-major-ports-india>
- <https://shipmin.gov.in/hi/content/monthly-cargo-traffic-handled-non-major-ports-during-december-2025>
- <https://download.geofabrik.de/asia/india.html>
