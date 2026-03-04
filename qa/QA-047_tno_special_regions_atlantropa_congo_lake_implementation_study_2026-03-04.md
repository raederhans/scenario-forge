# QA-047 TNO 特殊区域实现研究：Atlantropa 盐碱地与 Congo Lake

**Date:** 2026-03-04  
**Scope:** TNO 优化 mod 中 Atlantropa / Adriatica 干涸区与 Congo Lake 的本地地图证据、世界观参考、对当前地图填色 app 的实现建议  
**Method:** 本地 TNO mod 文件只读审阅 + HOI4 原版地图资产对照 + 像素级 province 近邻扫描 + 网络资料检索  
**Deliverable Type:** 只读型 QA / 研究与落地建议文档，不修改任何 mod 文件、不改当前 app 代码

## Evidence

### Local evidence

- TNO mod 地图核心资产与 HOI4 原版哈希全部不同，说明不是只改文本，而是确实改了底层地图：
  - `map/provinces.bmp`
  - `map/heightmap.bmp`
  - `map/terrain.bmp`
  - `map/rivers.bmp`
  - `map/definition.csv`
- `history/states/163-Dalmatia.txt` 中 `STATE_163` 被做成 `wasteland`，并在 localisation 中显示为 `Adriatica`。
- HOI4 原版 `history/states/163-Dalmatia.txt` 还是单省沿海 enclave；TNO 优化 mod 把它扩成 12 个 land province 的 wasteland state，属于明确的地形-地块重构。
- `map/strategicregions/168-Adriatic Sea.txt` 的 province 集合为空，说明旧“亚得里亚海海区”在战略层级已被抽空。
- `map/strategicregions/29-Central Mediterranean Sea.txt`、`68-Western Mediterranean Sea.txt`、`69-Eastern mediterranean Sea.txt` 仍承担地中海海区命名，但 province 列表并不总是纯海 province，说明它们更像 HOI4 战略任务区，而不是可直接复用的前端海块。
- `history/states/295-Congo.txt` 对应本地化 `Leopoldville`；`history/states/1181-ZentralafricanState20.txt` 对应本地化 `Hitlerstadt`。
- 基于 `provinces.bmp + definition.csv` 的近邻扫描，在 Leopoldville / Hitlerstadt 周边都能检测到真实 `lake` province，而不是只有 land province 和文本描述。
- 你当前 app 中：
  - `ocean` 是上下文层，不是主交互层。
  - `special_zones` 是覆盖层，不是国家式主交互层。

### Web evidence

- Atlantropa / Herman Sörgel 档案与项目背景：
  - Deutsches Museum archive: https://www.deutsches-museum.de/forschung/archiv/nachlaesse/nachlass/s/soergel-herman
  - Deutsches Museum article: https://blog.deutsches-museum.de/2019/01/23/atlantropa
  - History of Bavaria / Deutsches Museum archive summary: https://histbav.hypotheses.org/5610
- Messinian Salinity Crisis 作为“地中海干涸-蒸发岩-盐碱地”类比：
  - Nature chronology paper: https://www.nature.com/articles/23231
- Congo Basin / Cuvette Centrale 水文与泥炭地：
  - Nature 2017 peatland mapping: https://www.nature.com/articles/nature21048
  - Nature 2024 hydroclimatic vulnerability: https://www.nature.com/articles/s41586-022-05389-3
  - NASA NTRS Congo water dynamics: https://ntrs.nasa.gov/citations/20120001944
  - NASA Earth Observatory, Ruki River / blackwater / swamp forest context: https://science.nasa.gov/earth/earth-observatory/shedding-light-on-a-very-dark-river-152578
  - Congo Basin Science hydrology observatory: https://congobasinscience.net/projects/craft/hydrology/

## Executive Summary

本地文件证据显示，TNO 优化 mod 对两个区域采用了**完全不同的空间表达策略**：

- **Atlantropa / Adriatica**：通过把原本的海域改造为陆地 `wasteland state` 来表达。这是“海变陆”的实现路径。
- **Congo Lake**：通过保留/构建真实 `lake province`，再配合沿湖 land state（Leopoldville、Hitlerstadt 等）来表达。这是“新增大型内陆水体”的实现路径。

对你的 app 来说，这两种区域不应混成同一种图层：

- Atlantropa 盐碱地应当视为 **special land region**。
- Congo Lake 应当视为 **interactive water region**，并可附带 shoreline / wasteland 过渡区。

因此，最重要的工程结论不是“怎么画”，而是“怎么分层”：

- **短期过渡：** Atlantropa 可以先借 `special_zones` 做视觉区；Congo Lake 最多做展示型轮廓，别硬塞进国家层。
- **长期方案：** 新增 `water_regions` 与 `special_regions` 两套独立数据层。

## 1. 目标与约束

这份文档的目标不是复刻 HOI4/TNO 的完整地图制作流程，而是回答下面三个问题：

1. TNO 本地文件到底怎么表达这两个特殊区域。
2. 哪些做法值得借鉴到你的 web map。
3. 你的当前架构下，长期正确实现路径是什么。

约束也很明确：

- 你的 app 不是 HOI4，不需要 `provinces.bmp -> definition.csv -> state` 的整套 Paradox 地图流水线。
- 你的目标不是让 Atlantropa 或 Congo Lake 成为国家领土。
- 你的前端当前不存在海洋主交互层。

## 2. TNO 本地文件证据清单

## 2.1 地图资产级证据：这是实改地图，不是文案幻觉

对比 HOI4 原版目录 `C:\Program Files (x86)\Steam\steamapps\common\Hearts of Iron IV\map` 后，以下文件哈希全部不同：

| 文件 | TNO mod hash 前缀 | HOI4 原版 hash 前缀 | 结论 |
|---|---|---|---|
| `provinces.bmp` | `3E449F94899A` | `44A1B0A8D975` | 已改 |
| `heightmap.bmp` | `BA51F3392C9E` | `615300EA13A1` | 已改 |
| `terrain.bmp` | `F2646939DE89` | `E2085944974B` | 已改 |
| `rivers.bmp` | `381CDCBEEDFF` | `4491190A6577` | 已改 |
| `definition.csv` | `1D3CED359EA1` | `B43FF199A684` | 已改 |

这意味着后面关于 Atlantropa 和 Congo Lake 的判断，必须把它们当成**真实地图表达**看，而不是只把它们当成剧情文本。

## 2.2 Atlantropa / Adriatica 证据

| 证据 | 文件 | 发现 | 含义 |
|---|---|---|---|
| 本地化名称 | `localisation/english/state_names_l_english.yml` | `STATE_163 = Adriatica` | 显示层已经把该州语义改成“干涸海盆” |
| state 文件 | `history/states/163-Dalmatia.txt` | `state_category=wasteland` | 它不再被视为普通沿海州 |
| province 集合 | `history/states/163-Dalmatia.txt` | 从原版单 province 变成 12 个 province | 明确的地块重构 |
| province 类型 | `map/definition.csv` | 该州各 province 为 `land`，地形以 `desert/hills` 为主 | 它被做成陆地，不是海 |
| strategic region | `map/strategicregions/168-Adriatic Sea.txt` | `provinces={ }` 空集合 | 原有“亚得里亚海海区”在战略海区层已被抽空 |
| 其他地中海海区 | `map/strategicregions/29/68/69-*.txt` | 仍保留 Central / Western / Eastern Mediterranean 命名，但样本中混有沿岸 land province | HOI4 strategic region 不能直接当成前端海块数据 |
| 原版对照 | HOI4 原版 `history/states/163-Dalmatia.txt` | 原版为 `state_category=enclave`，单省沿海州 | TNO 改动不是小修小补，而是语义重建 |

### 关键判断

TNO 对 Adriatica 的实现，本质是：

**把海域撤掉，把一块新的特殊陆地塞进来。**

这不是 overlay，也不是简单重命名。

## 2.3 Congo Lake 证据

| 证据 | 文件 | 发现 | 含义 |
|---|---|---|---|
| Leopoldville 州 | `history/states/295-Congo.txt` | `STATE_295` 本地化为 `Leopoldville` | 湖岸主城存在 |
| Hitlerstadt 州 | `history/states/1181-ZentralafricanState20.txt` | `STATE_1181` 本地化为 `Hitlerstadt` | 湖岸特殊节点存在 |
| 胜利点 | `localisation/english/TNO_victory_points_l_english.yml` | `VICTORY_POINTS_10071 = Hitlerstadt` | 湖岸地标被地图化 |
| 本地剧情 | 多个 `TNO_Africa_Mandate*` / `TNO_Mozambique*` 文本 | 多次出现 shipping、boat、shore、resort、north Congo Lake | 世界观把它当作可航行大湖 |
| 像素近邻扫描 | `provinces.bmp + definition.csv` | Leopoldville 周边检测到 `lake` province `2281/5786/6672` | 大湖有真实水体表达 |
| 像素近邻扫描 | `provinces.bmp + definition.csv` | Hitlerstadt 周边检测到 `lake` province `2281/5786` | 湖岸 resort 与水体相邻，不是纯文案 |

### 关键判断

TNO 对 Congo Lake 的实现，本质是：

**保留大型内陆水体，再围绕它布置沿岸 land state 与叙事节点。**

这和 Adriatica 的“海变陆”是两条完全不同的路线。

## 3. Atlantropa 盐碱地分析

## 3.1 世界观 / 地理含义

Herman Sörgel 的 Atlantropa 不是单一的“在直布罗陀修一个坝”而已。Deutsches Museum 的档案与介绍页都表明，这是一整套欧洲-非洲重塑方案；而德意志博物馆档案相关介绍还明确提到“第二条尼罗河”以及刚果/乍得大型内陆海的设想。  
这意味着在 alt-history 语境里，地中海干涸带不是一块普通沙漠，而是：

- 人工干预后的新生陆地
- 高盐、强蒸发、坡折复杂的暴露海盆
- 兼具交通、资源、殖民、生态灾难叙事

## 3.2 Messinian Salinity Crisis 能提供什么参考

Nature 的 Messinian chronology 研究说明，约 5.96 Ma 到 5.33 Ma 期间，地中海在与大西洋隔离后发生过大幅降水位、侵蚀与蒸发岩沉积。  
它对你的帮助不是“Atlantropa 会完全长成什么样”，而是提供一个强参考：

- 干涸海盆不会是均匀平坦单色地表。
- 不同海盆、门槛、陆架暴露区会有很强差异。
- 盐碱地、蒸发岩平原、残余咸水盆地、坡折地带会并存。

所以，如果你要做“围绕地中海诸国的盐碱地”，不建议做成一个整块同质 polygon。

## 3.3 TNO 的底层表达方式

TNO 目前最强的本地证据集中在 `Adriatica`：

- 原版沿海小州被改造成 `wasteland`
- strategic region 的 Adriatic Sea 被抽空
- province 类型改为 `land`
- terrain 偏 `desert / hills`

这说明 TNO 的设计思想是：

- 把最具戏剧性的干涸海盆做成**特殊陆地区域**
- 它从“海军空间”切换为“地表空间”

## 3.4 对你 app 可借鉴的点

### 可借鉴

1. **Atlantropa 盐碱地不应归入普通海块。**  
   它的语义已经不是海。

2. **应当有独立名称和独立样式。**  
   `Adriatica` 这种命名比“South Croatia Special Zone 1”强得多。

3. **应允许存在残余水体与不规则边缘。**  
   不要把它画成一张平整的米黄色贴图。

4. **应被当成多边形区域，而不是海洋底色特效。**

### 不可直接照搬

1. 不能把 HOI4 的 province raster 直接导入你的前端交互。
2. 不能把它挂到国家 `political` 层里冒充国家。
3. 不能照抄 TNO 的单州表达，把整个“围绕地中海诸国”的盐碱地压成一个单块。

## 3.5 对你项目的推荐实现方式

### 过渡方案

用现有 `special_zones` 先做视觉表达，类型使用 `wasteland`。  
这适合做：

- `atlantropa_adriatic_salt_flat`
- `atlantropa_sicily_tunis_exposure`
- `atlantropa_aegean_exposure`（若你想扩展）

### 长期方案

新增 `special_regions`：

```json
{
  "id": "atlantropa_adriatic",
  "name": "Adriatica Salt Basin",
  "label": "Adriatica",
  "special_type": "salt_flat",
  "interaction_mode": "region",
  "parent_context": "mediterranean_alt_history",
  "render_priority": 40,
  "interactive": true,
  "notes": "Derived from drained Adriatic concept, not sovereign territory"
}
```

### 推荐切法

如果你想把“围绕地中海诸国”的盐碱地做得更完整，我建议不是一个总多边形，而是多块：

1. Adriatica Salt Basin
2. Sicily-Tunis Salt Shelf
3. Gulf of Gabes Exposure
4. Aegean Exposed Shelf（可选）
5. Levantine Retreat Margin（可选）

其中只有 `Adriatica` 具备最强本地 TNO 文件证据；其余更偏你自己的扩展设计。

## 4. Congo Lake 分析

## 4.1 世界观 / 水文含义

TNO 的 Congo Lake 设定是把刚果盆地的一部分转化为巨型人工湖，并围绕它发展航运、湖岸聚落、 resort、 dam zone 等叙事。  
从真实地理背景看，这并非“完全脱离地貌的胡想”：

- NASA NTRS 把 Congo Basin 描述为全球第三大流域、第二大流量系统之一。
- 该研究指出刚果湿地每年存在约 `111 km^3` 的充排水量，且水量来源高度依赖 local upland runoff。
- Nature 2017 显示 Cuvette Centrale 发现了约 `145,500 km²` 的热带泥炭地复合体。
- Nature 2024 进一步说明该区长期受水文波动支配，水位下降会显著改变泥炭与碳动态。

这些资料共同说明：**刚果盆地本来就是大规模低平湿地-水储系统**。  
因此，“大型人工内陆湖”作为 alt-history 设定虽然极端，但在地图表达上并不荒谬。

## 4.2 TNO 的底层表达方式

和 Atlantropa 不同，Congo Lake 并没有被表达成“大片干地”。  
它的地图表达更像：

- **真实 lake province**
- **沿岸 land state**
- **关键 shoreline settlement / resort / dam narrative**

Leopoldville 与 Hitlerstadt 的存在尤其重要，因为它们说明 TNO 不是只想告诉你“这里有个湖”，而是把这个湖当成**有岸线、有港口、有航运、有叙事节点的空间系统**。

## 4.3 对你 app 可借鉴的点

### 可借鉴

1. **刚果湖应是单独可点的水域。**
2. **岸线节点要与水体脱钩表达。**
3. **可以把大湖与 Dam Zone / 湖岸废土 / 港口节点分层。**
4. **湖不需要政治归属语义，也能有高交互价值。**

### 不可直接照搬

1. 不要直接照 HOI4 的 `lake` / `sea` province raster 做前端命中。
2. 不要把 Congo Lake 当作 `special_zones` 的一个红色覆盖块。
3. 不要把湖本身塞到国家列表和国家自动填色系统里。

## 4.4 对你项目的推荐实现方式

### 过渡方案

如果你现在只想先“做出来能看”，建议：

- 刚果湖本体先作为单独的展示性水域 polygon
- 湖岸废土、盐沼、人工区先用 `special_zones`
- Dam Zone 先用一个独立 small polygon 或 point-like region

### 长期方案

新增 `water_regions`：

```json
{
  "id": "congo_lake",
  "name": "Congo Lake",
  "label": "Congo Lake",
  "water_type": "lake",
  "region_group": "central_africa_alt_history",
  "parent_id": null,
  "neighbors": ["congo_dam_zone", "leopoldville_shore", "hitlerstadt_shore"],
  "is_chokepoint": false,
  "interactive": true,
  "source_standard": "local_design+TNO_reference"
}
```

并辅以 `special_regions`：

- `congo_dam_zone`
- `congo_lake_north_swamp`
- `congo_lake_south_shore_wasteland`（如果你想做叙事化过渡带）

### 是否要把 Congo Lake 再分块

我的建议是：

- **第一阶段不要。**  
  先做单一大湖，确保交互清晰。
- **第二阶段可选拆分。**  
  如果你未来要做更深玩法，再拆成 `north basin / central open water / dam approach`。

## 5. 两类区域的实现差异

| 维度 | Atlantropa 盐碱地 | Congo Lake |
|---|---|---|
| 几何本质 | 干涸后暴露陆地 / 废土 / 盐碱地 | 大型内陆水体 |
| 主数据层 | `special_regions` | `water_regions` |
| 是否可 hover / click | 应该可以 | 应该可以 |
| 是否进入国家列表 | 不应 | 不应 |
| 是否进入独立图例 | 应进入 special legend | 应进入 water legend |
| 是否参与国家自动填色 | 不应 | 不应 |
| 是否需要 shoreline 衍生区 | 可选 | 强烈建议 |
| 与当前 `special_zones` 的关系 | 可做短期过渡 | 只能做辅助，不足以表达本体 |

## 6. 对你项目的推荐数据方案

## 6.1 结论：分成两层，不要混

建议你未来明确引入：

- `water_regions`
- `special_regions`

并把当前 `special_zones` 定位为：

- **legacy / overlay / manual editor layer**
- 不是未来主交互区域模型

## 6.2 推荐接口

### `water_regions`

```json
{
  "id": "med_aegean",
  "name": "Aegean Sea",
  "label": "Aegean",
  "water_type": "sea",
  "region_group": "mediterranean",
  "parent_id": "mediterranean_sea",
  "neighbors": [],
  "is_chokepoint": false,
  "interactive": true,
  "source_standard": "IHO+GFCM"
}
```

### `special_regions`

```json
{
  "id": "atlantropa_adriatic",
  "name": "Adriatica Salt Basin",
  "label": "Adriatica",
  "special_type": "salt_flat",
  "interaction_mode": "region",
  "parent_context": "mediterranean_alt_history",
  "render_priority": 40,
  "interactive": true,
  "notes": "Alt-history drained basin"
}
```

## 6.3 推荐接入点

从当前代码结构看，未来最自然的接入点是：

- `js/core/data_loader.js`
- `js/core/state.js`
- `js/core/map_renderer.js`
- `js/ui/sidebar.js`
- `js/ui/toolbar.js`

这里的关键不是“再加一个 overlay”，而是：

- 为 `water_regions` 建独立 spatial index
- 为 `special_regions` 建独立 hit / list / legend 语义
- 把 `ocean` 保留为背景语义，不再承担业务层区块职责

## 7. 过渡方案与长期方案

## 7.1 过渡方案

### Atlantropa

- 先用 `special_zones` 的 `wasteland` 样式画出 `Adriatica`
- 如果你要扩展到“围绕地中海诸国”的暴露带，也先用多个 special zone 多边形完成视觉验证

### Congo Lake

- 先做单一展示型水域 polygon
- 湖岸 Dam Zone / 废土 / shoreline transition 可暂时用 `special_zones`
- 不要把湖本体做成 `special_zones`

## 7.2 长期方案

### Phase A

- 新增 `water_regions`
- 先落 Mediterranean pilot

### Phase B

- 新增 `special_regions`
- 落 Atlantropa / Adriatica

### Phase C

- 落 Congo Lake + Dam Zone + shoreline subregions

### Phase D

- 再扩展更多 alt-history 大型人工地貌区

## Recommendation

### 结论性建议

1. **Atlantropa 盐碱地应被视为特殊陆地区域，不是海块。**
2. **Congo Lake 应被视为独立可交互水域，不是红色 special overlay。**
3. **当前 `special_zones` 只适合做过渡与视觉表达，不足以承担长期主交互。**
4. **长期必须新增 `water_regions` 与 `special_regions` 两套数据层。**

### 对两个目标的具体建议

#### Atlantropa

- 第一版先做 `Adriatica`
- 如果你要扩展到“围绕地中海诸国”，用多个盐碱地子区，而不是单一总多边形

#### Congo Lake

- 第一版先做单一大湖
- 第二版再决定是否拆成 shoreline / basin / dam approach 子区

## Risks

### 风险 1：把两者都当成 `special_zones`

这样短期看起来能画出来，但长期你会立刻遇到：

- 列表体系混乱
- hover / click 语义混乱
- 图例混乱
- hit-testing 难以扩展

### 风险 2：把两者都并入国家层

这会把“国家着色逻辑”和“特殊地貌逻辑”混成一团，后续难以收拾。

### 风险 3：照抄 HOI4/TNO province 粒度

你的 app 不是 `provinces.bmp` 游戏引擎。直接照抄只会得到过细、难维护、难解释的几何。

## Next Step

建议后续顺序固定为：

1. 先定义 `water_regions` / `special_regions` 数据契约。
2. 先做 Mediterranean pilot。
3. 再做 Atlantropa / Adriatica。
4. 再做 Congo Lake。
5. 最后才考虑把更多 TNO 异常地貌系统化。

## Sources

- Deutsches Museum archive, Hermann Sörgel: https://www.deutsches-museum.de/forschung/archiv/nachlaesse/nachlass/s/soergel-herman
- Deutsches Museum Atlantropa article: https://blog.deutsches-museum.de/2019/01/23/atlantropa
- History of Bavaria / Deutsches Museum archive summary: https://histbav.hypotheses.org/5610
- Nature, chronology of the Messinian salinity crisis: https://www.nature.com/articles/23231
- Nature, central Congo Basin peatland complex: https://www.nature.com/articles/nature21048
- Nature, hydroclimatic vulnerability of peat carbon in the central Congo Basin: https://www.nature.com/articles/s41586-022-05389-3
- NASA NTRS, Congo water dynamics: https://ntrs.nasa.gov/citations/20120001944
- NASA Earth Observatory, Ruki / Congo Basin waters: https://science.nasa.gov/earth/earth-observatory/shedding-light-on-a-very-dark-river-152578
- Congo Basin Science Initiative hydrology observatory: https://congobasinscience.net/projects/craft/hydrology/
