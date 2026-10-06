# 专题图层的剧本参考映射

当前接入 WGI 六项官方治理指标，数值固定使用 2025 revision v7 中的 2024 年记录；另接入 UNDP《人类发展报告 2025》的五项指标，采用报告中的 2023 年记录：人类发展指数（HDI）、预期寿命、预期受教育年限、平均受教育年限和人均国民总收入。HOI4 1936、1939 与 TNO 的适配只改变分数覆盖的剧本地块，不生成历史评分或调整数值。专题指标以现代国家为参考，不是历史或架空政权的测量值。

HDI 使用 UNDP 官方分级阈值 0.55、0.70 和 0.80 划分四档。其他四项指标按固定区间显示；这些区间仅用于制图，不表示官方发展等级。原始数值仍以年为预期寿命和受教育年限的单位，以 2021 年购买力平价美元为人均国民总收入单位。数据来自 [UNDP HDR 2025 综合指数时间序列](https://hdr.undp.org/sites/default/files/2025_HDR/HDR25_Composite_indices_complete_time_series.csv)，定义与计算方法见 [HDR 2025 技术说明](https://hdr.undp.org/sites/default/files/2025_HDR/HDR25_Technical_Notes.pdf)，使用条件见 [UNDP 数据使用条款](https://hdr.undp.org/terms-use)。

另接入世界银行 WDI 的五项人口指标，统一使用 2023 年观测值，固定 API `source=2`、`lastupdated=2026-07-13` 的来源快照，运行时版本为 `wdi-2026-07-13:2023`：

| 指标 | 官方代码 | 单位 |
| --- | --- | --- |
| 总人口 | `SP.POP.TOTL` | 人 |
| 国家平均人口密度 | `EN.POP.DNST` | 人／平方公里陆地面积 |
| 城镇人口占比 | `SP.URB.TOTL.IN.ZS` | 总人口的百分比 |
| 65 岁及以上人口占比 | `SP.POP.65UP.TO.ZS` | 总人口的百分比 |
| 总和生育率 | `SP.DYN.TFRT.IN` | 出生数／妇女 |

人口密度是国家平均值，不代表城市或地块内的人口空间分布；现有栅格人口 demo 仍为演示数据。总人口在历史模式下明确显示“现代参考国总人口，并非剧本疆域人口合计”，不按剧本面积分摊，也不对重复使用同一参考国的地块累加。其他人口指标同样仅作现代参考。五项指标均保留 WDI 原值，以固定制图区间着色，不把高低解读为优劣或官方等级。内部 0–100 辅助归一化只服务数据契约，不用于悬停数值或色阶；人口密度超过 1,000 的原值仍完整保留。

构建使用离线保存的五份官方 API 响应及 country 元数据；按 `country.id` 与元数据 `iso2Code` 连接，排除 `region.id=NA` 的聚合行，并审计排除复合单元 Channel Islands（CHI/JG），不拆分估算。保留官方国家／经济体记录；现有地图代码映射未覆盖的经济体仍可能无法显示。空值保留为来源缺失，禁止跨年补齐。五项指标的官方元数据均标注 CC BY 4.0；口径见[总人口](https://databank.worldbank.org/metadataglossary/world-development-indicators/series/SP.POP.TOTL)、[人口密度](https://databank.worldbank.org/metadataglossary/world-development-indicators/series/EN.POP.DNST)、[城镇人口](https://databank.worldbank.org/metadataglossary/world-development-indicators/series/SP.URB.TOTL.IN.ZS)、[65岁及以上人口](https://databank.worldbank.org/metadataglossary/world-development-indicators/series/SP.POP.65UP.TO.ZS)、[生育率](https://databank.worldbank.org/metadataglossary/world-development-indicators/series/SP.DYN.TFRT.IN)。城镇定义由各国统计机构确定，跨国比较存在口径差异。

## 映射规则

| 场景 | 边界与分数来源 |
| --- | --- |
| Modern World | 现有地理国家与所选指标 ISO A3 记录对应 |
| HOI4 1936 / 1939 | 当前剧本政治地块 → baseline owner tag → `countries[tag].base_iso2` → 所选指标记录 |
| TNO 1962 | 同样按剧本国家分组；Atlantropa、水域和特殊区域继续走原渲染规则 |

复用 `map_data_boundary.reference` 的只读国家归属，与既有政治边界使用同一分组。无需把现代国家面重新裁剪或改写剧本拓扑；专题显示也不修改原配色。

1939 的 GER 分组包含来自现代 DE、AT、CZ、PL、RU 和 LT 的地块，统一采用 DEU 分数。1936 的 CZE 包含现代捷克、斯洛伐克和部分乌克兰地块，统一采用其显式参考国 CZE。现代世界保持按原地理来源取值。

`base_iso2` 是已有剧本元数据中的现代参考身份，不代表该历史或架空国家与现代国家完全等价。TNO 的 WRS 等俄罗斯碎片政权共享 RUS 的参考值；IBR 使用 ESP 的参考值。这些近似不用于表达不同政权的治理能力差异。相邻国家即使分数相同，仍保留剧本国家边界。

## 无匹配与说明

- 仅使用显式有效的两字母 `base_iso2` 和现有 WGI 国家代码映射。禁止从三字母游戏 tag、父国、地块名称或占地面积猜参考国。
- 未知国家显示未匹配色；有明确国家但官方记录为空时显示来源缺失色。TNO 的 BOP、GAY、MAG、NIE、ONG、ORN、ORS、VOK、XIK 当前没有有效两字母参考代码，保留未匹配。
- 历史模式的覆盖统计按剧本国家 tag 计数，共用 RUS 分数的多个国家分别计算。水域、特殊区域和 Atlantropa 不纳入统计。
- 面板、悬停和导出按所选来源标明“2024／2023 参考映射，非剧本年代测量值”；悬停同时给出参考国代码。WGI 置信区间属于该现代来源记录，不是剧本政权的估计区间；UNDP 与人口专题不捏造置信区间。
- 项目保留指标和数据版本，剧本归属与参考国家表仍由该剧本基线提供。切换指标、剧本或恢复项目后重新核对数据准入；旧场景的异步请求不能覆盖新场景。

## 下一阶段的独立工作

需要区分苏联加盟地区、殖民地、跨现代国家的联合体或 TNO 政权时，应新增可审阅、带来源说明的剧本专用映射及数值版本，而不是悄悄修改现代 WGI 原始记录。历史资料与架空设定应分别标注依据。新增、重绘或细分政治地块属于剧本拓扑构建工作，不能由专题分数映射代替。

## Verification scope

The implementation tests use each checked-in scenario's political geometry IDs, owner assignments, and country metadata. They verify uniform reference joins within scenario groups, unknown-code handling, exclusion of special surfaces, scenario changes, and reference notes in tooltips and image exports. These checks validate the reference mapping contract; they do not establish historical accuracy for the reused modern scores.
