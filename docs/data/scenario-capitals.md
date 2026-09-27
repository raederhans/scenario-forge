# 剧本首都核查与边界适配

本轮覆盖五个公开剧本：`blank_base`、`modern_world`、`hoi4_1936`、`hoi4_1939`、`tno_1962`。
以仓库当前国家身份和边界为准。MOD 的首都州、城市名和译名是参考依据，不能直接按相同 tag 覆盖。
首都采用稳定城市 ID；境外首都改选境内真实城市，不移动国界，也不把旧首都名字套到替代城市上。

## 可维护的来源

- `map_builder/scenario_capital_rules.py`：经过核对的首都城市及中英文名称。
- `map_builder/scenario_capital_placement.py`：按剧本实际多边形验证点位、绑定 host，以及处理有界的海岸线简化偏差。
- `map_builder/cities.py`：完整城市构建时应用相同规则。明确指定的首都不会再被另一个自动候选覆盖 hint。
- `tools/repair_scenario_capitals.py`：更新已有首都/城市资产、默认输入、公开 hints、gzip 副本和 snapshot 元数据，不修改国家或领土资产。
- 已有 `scenario_mutations.json` 中的显式首都编辑仍优先于默认数据。

维护命令：

```powershell
python tools/repair_scenario_capitals.py --scenario-id tno_1962 --dry-run
python tools/repair_scenario_capitals.py --scenario-id tno_1962
python tools/check_scenario_contracts.py --scenario-dir data/scenarios/tno_1962 --strict
```

`--geometry-cache` 只允许只读诊断，不能用于写入；正式修复读取当前 topology。

## 本地 TNO 与原版 HOI4 依据

核对本地 Steam workshop `2438003901`（The New Order: Last Days of Europe，descriptor 1.10.0b）中的
`history/countries`、`history/states`、`localisation/english/TNO_victory_points_l_english.yml` 和
`common/scripted_effects/state_control_*_effects.txt`。
中文名称对照 workshop `2243912940` 的
`localisation/simp_chinese/TNO_victory_points_l_simp_chinese.yml`。
1936/1939 的国家历史和首都州另对照本地原版 Hearts of Iron IV；不把 1962 的名称及迁都套入这两个剧本。

例如 Germania/日耳曼尼亚使用 `VICTORY_POINTS_6521_ger`；Xinjing/新京使用
`VICTORY_POINTS_14633_man`；Kōshū/廣州使用 `VICTORY_POINTS_1047_gng_jap`。
这类剧本命名仅保存为城市覆盖，退出剧本后恢复基础名称。

标签身份例外：项目 `MAG` 是马格尼托哥尔斯克，本地新版 MOD `MAG` 是马加丹；
项目 `GUI` 是贵州，不是本地 MOD 的几内亚。`RGC` 按项目说明是四川军政监。
`KRS` 的国家名称与本轮核对的领土有差异：其当前领土位于克拉斯诺亚尔斯克，故首都落在该城，未扩展修改国家名称。

## 当前边界下的调整

以下是项目适配选择，不声称是 MOD 的原设定首都：

| 剧本/政权 | 境外参考首都 | 采用的境内城市 | 理由 |
| --- | --- | --- | --- |
| TNO BKR | 乌法 | 彼尔姆 | 保留境内的主要行政中心 |
| TNO VYT | 维亚特卡 | 伊热夫斯克 | 当前领土内的主要行政中心 |
| TNO WRS | 阿尔汉格尔斯克 | 北德文斯克 | 保留邻近、境内的主要城市 |
| TNO GOR | 高尔基 | 切博克萨雷 | 保留境内的主要行政中心 |
| TNO VOL | 沃洛格达 | 韦利斯克 | 保留境内已有首都候选 |
| TNO ALT | 奥伊罗特-图拉 | 阿巴坎 | 当前领土内的行政中心 |
| TNO ZLT | 兹拉托乌斯特 | 昆古尔 | 境内的区域中心 |
| TNO OUR | 奥伦堡 | 斯捷尔利塔马克 | 奥伦堡属于 ORN，选择 OUR 境内主要城市 |
| TNO TOM | 托木斯克 | 科尔帕舍沃 | 托木斯克位于当前 NOV 领土，选择境内历史聚落 |
| TNO PRM | 彼尔姆 | 切尔登 | 彼尔姆属于 BKR，切尔登在 PRM 的 Cherdynsky District |
| TNO LAO | 万象 | 琅勃拉邦 | 万象属于 SIA，使用境内历史王都 |
| TNO XIK | 西昌 | 理塘 | 西昌属于 RGC，理塘位于 XIK 境内 |
| TNO GCE | 布里斯托尔 | 特鲁罗 | 当前只拥有康沃尔地区 |
| HOI4 MEN | 张家口 | 锡林浩特 | 张家口属于当前 CHI 领土 |

新增的小聚落只存在于对应剧本，不改写共享世界城市集。
理塘坐标来自 [GeoNames Gaocheng/Litang](https://www.geonames.org/1810604/gaocheng.html)，
经当前理塘县多边形包含检查；切尔登使用 [NOAA 的 Cherdyn 地理记录](https://www.ncei.noaa.gov/nerms/api/document/5B167FD050714B37BBCB7E3D08D8AFB4/download)
中的近似位置（60°24′N，56°31′E），位于当前 Cherdynsky District 内，位置精度为聚落级而非具体政府建筑。

## 现代首都与名称依据

现代剧本统一采用国家首都；多首都国家在当前单首都模型中选择行政首都。
香港、澳门仍沿用项目现有地区条目，标记其行政中心，不改变政治分类。
参考 [日本政府 Tokyo](https://www.japan.go.jp/japan/index.html)、
[菲律宾财政部 Manila](https://www.treasury.gov.ph/wp-content/uploads/2019/12/TAB-1-Profile.pdf)、
[南非政府的多首都说明](https://www.gov.za/south-africa-glance)、
[UN Data 的 Dodoma](https://data.un.org/en/iso/tz.html)、
[联合国统计手册的 Gitega](https://unstats.un.org/unsd/publications/pocketbook/files/world-stats-pocketbook-2024.pdf)、
[非盟驻联合国代表团的 Porto-Novo](https://unmission.au.int/docroot/en/member-states/benin)，以及
[哈萨克斯坦总统府的 Astana](https://www.akorda.kz/en/republic_of_kazakhstan/kazakhstan)。
其余点位沿用仓库 Natural Earth/GeoNames 的真实城市坐标和稳定 ID，修正从省会/人口候选中选错城市的映射。
多多马原有中文误称“松巴万加”同步纠正，内比都与阿斯塔纳采用对应中文名称。
瓜德罗普首府采用 Basse-Terre／巴斯特尔，而非 Pointe-à-Pitre，依据
[INSEE 2026 行政区划](https://www.insee.fr/fr/metadonnees/geographie/commune/97120-pointe-a-pitre)。
斯里兰卡依单一行政首都政策采用 Sri Jayawardenepura Kotte／斯里贾亚瓦德纳普拉科特，依据
[斯里兰卡外交部](https://www.mfa.gov.lk/national-profile-and-geography)。
圣皮埃尔和密克隆的首府采用 Saint-Pierre／圣皮埃尔，依据
[INSEE 行政区划](https://www.insee.fr/fr/information/7929495)，坐标来自
[GeoNames 3424934](https://www.geonames.org/3424934/saint-pierre.html)。
现代拓扑原先漏了圣皮埃尔岛，首都点距剩余领土约 9.47 km；重建器从仓库
`ne_50m_admin_0_countries.zip` 恢复该独立岛组件，并入既有 `PM` 地块。
仅补现有覆盖不足 5% 的独立组件并裁去既有世界覆盖，不扩大首都海岸内移容差。
圣赫勒拿采用 Jamestown／詹姆斯敦，依据
[圣赫勒拿政府驻地](https://www.sainthelena.gov.sh/contact/)，坐标来自
[GeoNames 3370903](https://www.geonames.org/3370903/jamestown.html)。这两座小城作为现代剧本城市补充。

现代 `HM` 没有常住居民行政首府（[澳大利亚南极局](https://www.antarctica.gov.au/antarctic-operations/stations-and-field-locations/heard-island/)）；
`IO` 行政机构位于伦敦（[领地政府](https://www.biot.gov.io/governance/)），
`TF` 行政总部位于留尼汪圣皮埃尔（[法属南方和南极领地政府](https://taaf.fr/collectivites/presentation/)）。
三者按当前“首都标记必须位于本领土内”的模型明确记录 `no_capital`，不虚构境内城市；
它表示不绘制境内首都星标，不表示这些领地没有行政管理机构。

## 历史剧本地名隔离

`scenario_capital_rules.py` 的 `REVIEWED_CITY_NAMES` 以稳定城市 ID 保存非首都历史名，
与首都规则一起由城市构建和首都修复入口应用；它不改共享现代底图，也不覆盖 TNO 的架空设定。
1936/1939 补充 Dihua／迪化、Akmolinsk／阿克莫林斯克、Alma-Ata／阿拉木图、Keijō／京城。
既有 Hsinking／新京、Taihoku／台北、Leningrad／列宁格勒、Stalingrad／斯大林格勒及
Sverdlovsk／斯维尔德洛夫斯克继续保留。Perm 在这两个年份仍为彼尔姆。

- [北京市政府城市沿革](https://www.beijing.gov.cn/renwen/sy/whkb/201907/t20190715_1866582.html)
  记载 1928 年改北平、1937 年日占当局改北京。当前两版地图的北京地块均归 CHI，
  1939 的 `1939_hebei_chahar_owner_chi` 为明确作者规则，因此均采用中华民国命名 Beiping／北平；
  本次命名修复不改变归属，也不把现实日占名称强加到该剧本地块。
- [哈萨克斯坦政府城市沿革](https://www.gov.kz/memleket/entities/vko-altay-polyanskoe/press/events/details/29850)
  说明 Akmolinsk 至 1961 年；现代使用 Astana，不将现代 Nur-Sultan 基础旧名带进历史剧本。
  [政府阿拉木图历史资料](https://kgd.gov.kz/sites/default/files/UIT/kgd-kniga60h90_posledniy_compressed.pdf)
  记录 Alma-Ata 与 Almaty 的年代变化。
- [首尔历史博物馆](https://museum.seoul.go.kr/eng/exhibition/permanent/permExhibit/permExhibit3.jsp)
  记载殖民时期 Gyeongseong；[日本国立国会图书馆 1930 年地图](https://ndlsearch.ndl.go.jp/books/R100000136-I1970023484984750979)
  标为 Keijo。两版 KOR 均为 `Government-General of Korea`、`parent_owner_tag=JAP`，故采用日方拼写 Keijō。
- 迪化于 1954 年改乌鲁木齐，见
  [新疆政府收录的城市沿革资料](https://sthjt.xinjiang.gov.cn/xjepd/hjyxpjsl/201903/9006e595669b4a0aac7654f660e1beb7/files/%E4%B9%8C%E9%B2%81%E6%9C%A8%E9%BD%90%E5%B8%82%E7%B1%B3%E4%B8%9C%E5%8C%BA%E5%A4%A7%E7%94%B0%E9%BB%84%E7%89%9B%E5%85%BB%E6%AE%96%E8%82%B2%E8%82%A5%E5%9F%BA%E5%9C%B0%E6%94%B9%E6%89%A9%E5%BB%BA%E9%A1%B9%E7%9B%AE.pdf)。
  TNO 保留自己既有的 Dihua；它采用架空年代政策，不由现实 1962 年名称反推。

TNO 另按本机模组 `2438003901/localisation/english/TNO_victory_points_l_english.yml`
核对胜利点：`7125` 基准 Keijō、朝鲜变体 Seoul；`10308` 基准 Akmola、俄方变体 Akmolinsk；
`15887` 基准 Taihoku、中国变体 Taipei。
项目 KOR 是日本附属的 `Korean Residency-General`，故城市用 Keijō／京城；
KAZ 独立，用 Akmola／阿克莫拉；台北城市宿主目前归 CHI，采用 Taipei／台北。
最后一项遵循项目现有地图归属，与原模组该州初始归 JAP 的设定有差异，不调整边界。

## 坐标和例外

- 首都 hint 和最终城市标记使用同一套位置及 host；验证要求 host 属于本国且标记位于该多边形内。
- 在海岸线简化导致原始点略落水的情况下，最多 5 km 内移；保存 `source_coordinates` 和 `coordinate_adjustment`。
- 具名例外：阿布扎比岛被粗海岸线省略，允许最多 12 km 的制图内移；澳门 passthrough 与中国粗多边形重叠，允许最多 4 km 的内移。摩纳哥亦只在自己的 passthrough 内进行最多 5 km 的制图内移。
- 真正位于外国领土内的普通城市不会通过此机制跨境移动，必须更换为经过核查的城市。
- TNO `AFA`、`RFA` 为无政府地区，`AQ` 为南极，`ATL` 为填海工程区，明确不自动选首都。
- TNO `SPR` 当前仅拥有三个 `ATLPRV_*` 和一个 `ATLSHL_*` 填海地块，没有可信的境内聚落，标记为不分配首都；不能把马德里移到填海区。
- 无领土的释放标签不再生成额外首都星标。
- `hgo_1936` 是开发预览，其现有构建器明确没有可靠首都城市源，仅存 featured 国家名称 hints；本轮没有把这些国家名称伪装成城市或填入未经坐标转换核查的世界城市。
