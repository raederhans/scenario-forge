# 印度能源设施专题研究归档

日期：2026-03-28

## 1. 一句话结论

印度能源设施这条线可以研究，但最稳的结论是 `官方全国骨架 + 降级补点`：官方层里最强的是 `Energy Map of India` 与 `National Power Portal / CEA` 这一套全国电力与能源资产框架，它足够形成全国骨架；但如果要做一张字段整齐、现势统一、覆盖电力之外炼厂/LNG/POL 等点设施的成品点层，仍要接受部分 `Tier C` 补点。

## 2. 研究边界

- 只研究点状设施
- 不碰管线
- 如出现中央 + 邦级碎片化，按“全国骨架 + 邦级补强”处理

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可或使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [Energy Map of India](https://www.vedas.sac.gov.in/energymap/) | 印度全国 | 点与资源图层，涵盖传统电厂、可再生能源、电油气下游等 | 页面在线；搜索结果显示 about 页近月可访问，许多图层快照年份为 2020 左右 | 官方合作平台，由 NITI Aayog 与 ISRO 体系推动；适合研究与骨架判断 | Tier A | 是，但更适合作全国骨架 | 题目很对，但现势口径不够统一新，不能直接当德国式强主源 |
| [National Power Portal - About](https://www.npp.gov.in/aboutus) | 印度全国电力系统 | GIS 仪表盘 + 报告体系 | 页面近月可访问 | 官方全国电力门户，偏平台与报告，不是统一下载点层 | Tier A | 是，作为全国电力骨架 | 对电力设施很强，对整个能源设施范围不够全 |
| [National Power Portal - Published Reports](https://npp.gov.in/publishedReports) | 印度全国电力系统 | 报表 | 搜索结果显示 `As on 10-03-2026` | 官方、现势强，但更像报表和台账，不是直接 GIS 点层 | Tier A | 否，作后备/校验 | 适合校验现势、电站名称和装机口径 |
| [Geospatial Energy Map User Guide](https://vedas.sac.gov.in/energymap/site/content/geospatial_energy_map_India_user_guide.pdf) | 印度全国 | 平台说明 | 近月可访问 | 官方说明文档 | Tier A | 否，作佐证 | 适合确认平台覆盖哪些能源设施子类 |
| [Global Power Plant Database](https://datasets.wri.org/datasets/globalpowerplantdatabase) / GEM / OSM 等公开补点源 | 全国或局部 | 点 | 不一 | 非官方，必须显式降级使用 | Tier C | 否，作补点 | 当官方平台缺统一点表或缺细字段时可现实补缺 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- `Energy Map of India`
- `National Power Portal / CEA`

最稳的范围定义不是“印度所有能源设施一次性齐活”，而是：

- 先把 `电力设施 + 主要能源资产` 的全国骨架站住
- 再决定哪些非电力设施要继续补

### 4.2 后备源

- `NPP published reports` 用于校验现势与名称
- `Tier C` 的公开补点源，用于统一点位或补足非电力子类

### 4.3 排除项

- 输油、输气、输电管线
- 把 2020 左右快照误写成“全设施最新全国成品点层”
- 只讲政策、不带设施对象的能源规划文件

## 5. 与现有仓库架构的承接判断

印度 `energy_facilities` 仍然适合按点层承接，但要明确第一版更像“全国官方骨架 + 局部降级补点”，而不是一张单一完美主表。

最稳的承接方式是：

- 先收成 `energy_facilities` 点层
- 子类先围绕：`thermal / hydro / nuclear / major renewable / refinery / LNG / POL terminal`
- 如果某些子类只有名单没有干净点位，就明确标为后续补强，不一次性硬并

## 6. 与日本最明显的不同

日本能源设施研究更像“先锁发电设施锚点，再讨论是否扩到更多能源对象”；印度则是一开始就能看到官方能源 GIS 平台，但平台里的子类现势、颗粒度和下载形态并不完全一致。

简单说：

- 日本偏“专题包较旧但边界清楚”
- 印度偏“平台很全，但现势和成品化程度不齐”

## 7. 风险与下一步建议

### 7.1 风险

1. 最大风险是把 `Energy Map of India` 误写成“每个能源子类都同样现势、同样可下载”的统一主源。
2. 第二个风险是把 `National Power Portal` 这种强电力平台误扩成完整能源设施平台。
3. 第三个风险是为了补炼厂、LNG、POL 等子类而无区分地混入低质量公开目录。

### 7.2 下一步建议

1. 首版先把印度 `energy_facilities` 写成“官方全国骨架成立，但子类现势不齐”。
2. 真正落地图层时，优先先做 `power-first`，再决定是否扩炼厂和 LNG。
3. 如果某类设施只有 Tier C 点位补充，就在文档里明确标成降级，不要偷换成官方主源。

## 8. 关键来源列表

- Tier A: [Energy Map of India](https://www.vedas.sac.gov.in/energymap/)
- Tier A: [Energy Map of India - About](https://vedas.sac.gov.in/energymap/site/about.html)
- Tier A: [Geospatial Energy Map User Guide](https://vedas.sac.gov.in/energymap/site/content/geospatial_energy_map_India_user_guide.pdf)
- Tier A: [National Power Portal - About](https://www.npp.gov.in/aboutus)
- Tier A: [National Power Portal - Published Reports](https://npp.gov.in/publishedReports)
