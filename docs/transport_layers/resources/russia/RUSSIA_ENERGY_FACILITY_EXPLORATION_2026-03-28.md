# 俄罗斯能源设施研究归档

日期：2026-03-28

## 1. 一句话结论

俄罗斯 `energy_facilities` 这条线当前最稳的结论不是“全国官方点位主源已经成立”，而是：`官方统计与系统规划强，但全国统一公开点位主源偏弱`。如果要把这条线做成可落地首版，最现实的写法是 `power-plants-first + Tier C 点位补充`。

## 2. 研究边界

- 研究对象是 `点状能源设施`
- 不研究输电网、油气管线、成品油管线、天然气管网
- 首版优先保证全国统一口径
- 接受首版先收敛到 `power_plants-first`

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [СО ЕЭС - СИПР 2026-2031 проект](https://www.so-ups.ru/fileadmin/files/company/future_plan/public_discussion/2025/project_sipr_2026-31.pdf) | 俄罗斯统一电力系统及相关区域 | 以统计表、项目清单为主，不是标准 GIS 点层 | 2026 年规划文件 | 官方系统规划文档，可用于设施类别、规模与区域判断，不是现成点位主源 | Tier A | 否，适合作主判断骨架 | 这是官方、全国、现势较新的发电设施骨架说明，但缺点位形态 |
| [СО ЕЭС - 公司与运行资料入口](https://www.so-ups.ru/) | 俄罗斯全国，偏 UES 体系 | 统计、名录、系统资料 | 持续更新 | 官方入口，适合核对发电结构与区域系统边界 | Tier A | 否 | 适合作背景与核对，不适合直接当点图层源 |
| [OpenInfraMap](https://openinframap.org/) | 俄罗斯全国 | 点、线 | 持续更新 | 基于 OSM，按 ODbL 约束使用 | Tier C | 是，但属于降级几何主源 | 对电厂点位、变电设施等几何显示很有用，但不是官方数据 |
| [OpenStreetMap / Geofabrik Russia](https://download.geofabrik.de/russia.html) | 俄罗斯全国 | 点、线、面 | 频繁更新 | ODbL；衍生使用需遵守 OSM 规则 | Tier C | 是，但属于降级几何主源 | 适合补电厂点位、设施名称和远东弱覆盖区 |
| [Global Energy Monitor](https://globalenergymonitor.org/) | 俄罗斯及全球多能源子类 | 点、项目目录 | 持续更新 | 公开研究数据库，适合核对项目状态与子类 | Tier C | 否，适合子类补强 | 可补炼厂、油气、煤电等子类，但不是俄罗斯官方主源 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主判断

- 官方全国统一的 `energy_facilities` 点位主源偏弱
- 官方最强的是 `发电体系统计与规划骨架`
- 真正的点位层现实上要靠 `OpenInfraMap / OSM` 这类 Tier C 几何补充

### 4.2 欧洲俄罗斯与非欧洲俄罗斯

- 欧洲俄罗斯：统一电力系统覆盖更强，官方统计与系统资料更容易形成稳定判断。
- 非欧洲俄罗斯：远东和部分孤立系统更容易出现点位缺口，因此更容易被迫降到 Tier C。
- 也就是说，东部放宽不是因为完全没有数据，而是因为官方公开点位主源更不整齐。

### 4.3 后备源

- `OpenInfraMap`：电厂等设施点位显示
- `OSM / Geofabrik Russia`：点位、名称与局部补缺
- `Global Energy Monitor`：多子类项目级补强

### 4.4 排除项

- 管线
- 用企业地址或新闻报道反推全国点层
- 把官方规划文档伪装成 GIS 点位主源

## 5. 与现有仓库架构的承接判断

这条线仍然适合点图层，但实现口径必须保守：

- 首版最好写成 `energy_facilities (power_plants-first)`
- `facility_subtype` 必须明确区分 `power_plant` 与其他子类
- 不要一开始就强行承诺全国炼厂、LNG、油库、变电站都齐

## 6. 与日本最明显的不同

- 日本至少能先把能源设施收口成相对明确的发电设施锚点。
- 俄罗斯更像“官方统计和系统资料强，点位主源弱”。
- 所以俄罗斯这条线的难点不是有没有能源数据，而是有没有可直接进点层的公开主源。

## 7. 风险与下一步建议

### 7.1 风险

1. 最大风险是把官方规划文档和运行资料误当成点图层主源。
2. 第二个风险是把欧洲俄罗斯的较强覆盖外推到整个西伯利亚和远东。
3. 第三个风险是把 `energy_facilities` 写成大全层，导致炼厂、LNG、油库这些子类被硬塞进同一主表。

### 7.2 下一步建议

1. 首版如需落地，先按 `power_plants-first` 收口。
2. 文档里明确写出：全国统一官方点源缺口存在，几何层为 Tier C 降级使用。
3. 如后续业务必须扩更多子类，按子类单独开表，不要伪装成一个统一口径的俄罗斯能源点层。

## 8. 关键来源列表

- Tier A: [СО ЕЭС - СИПР 2026-2031 проект](https://www.so-ups.ru/fileadmin/files/company/future_plan/public_discussion/2025/project_sipr_2026-31.pdf)
- Tier A: [СО ЕЭС - 官方入口](https://www.so-ups.ru/)
- Tier C: [OpenInfraMap](https://openinframap.org/)
- Tier C: [Geofabrik Russia](https://download.geofabrik.de/russia.html)
- Tier C: [Global Energy Monitor](https://globalenergymonitor.org/)
