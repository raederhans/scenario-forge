# QA-085 城市点工作流与 TNO 1962 地块命名修复归档

**Date**: 2026-03-16  
**Status**: Implemented, browser-verified, archived for follow-up  
**Scope**: 城市点独立图层、HOI4 风格 reveal/样式、城市命名仲裁、`TNO 1962` feature-keyed 地块命名补丁  
**Constraints**: 最小影响现有 `urban` 面图层；不回退成 name-first；优先走稳定 ID / feature ID；避免 `Brest -> Brest-Litowsk`、`Volgograd -> Paulusburg` 类串扰

---

## 0) 当前进度总览

这一轮工作已经完成四个连续阶段：

1. 新增独立的 `city points` 图层，保留原有 `urban` 面图层不变。
2. 将城市点改成 HOI4 风格的分阶段 reveal 与石墨样式表达。
3. 修正城市中文/剧本命名优先级，加入标签预算和长名压缩策略。
4. 修复 `TNO 1962` 地块一级命名回归，改为按 `feature_id` 精确命中剧本 patch。

当前结果：

- 城市点图层已可独立于 `urban` 工作。
- `TNO 1962` 的地块一级不再被 en-only `featureId` locale 覆盖。
- 德系和德势力范围内已确认的 1962 改名地块恢复显示剧本名。
- 中文模式下，地块一级已恢复大规模中文 feature patch，而不是之前的 `0 / 13222`。

---

## 1) 方法论与演进

### 1.1 城市层方法论

城市层不再依赖单一的 `urban` 面强度，而是拆成两条链：

- `urban` 继续负责面状城市化背景
- `city points` 负责低缩放可见性、城市存在感、首都/中大型城市分层和标签控制

数据源策略采用混合源：

- Natural Earth populated places 作为基础显示集
- GeoNames `cities15000` 作为补点、别名和首都回退候选

运行时方法论：

- 不靠单点 `min_zoom` 粗放放出
- 采用 `视口预算 + 国家档位 + 分阶段 reveal`
- 标签预算和点位预算分开算
- 城市名走 `stable_key / city_id / host_feature_id`，不直接依赖裸名字

### 1.2 剧本命名方法论

剧本命名修复的核心原则是：

- 城市和地块都不能再走全局字符串碰运气
- 已改名 feature 必须按 `feature_id` 精确绑定
- name-based locale 只允许在“安全翻译”场景下使用

具体规则：

- 如果 `feature_id` 有剧本显式 patch，优先使用 patch
- 如果只有 raw-name locale，则仅当 `locale.en === raw_name` 才允许把这个 locale 当作该 feature 的显示名
- 若 `locale.en !== raw_name`，说明这是全局改名条目，不能直接用于别的 feature

这样可以同时满足两件事：

- `BE211 -> Bezirk Antwerpen / 安特卫普区` 这类确实改过的地块能够恢复
- `FR_ARR_29001 -> Brest`、`RU_RAY_50074027B61241799946425 -> Volgograd` 不会再被错误改成 `Brest-Litowsk` / `Paulusburg`

### 1.3 TNO 1962 命名 patch 的生成方法

`TNO 1962` 的 feature patch 分成两层：

- `safe copy`
  - 从 `data/locales.json -> geo[raw_name]` 读取
  - 只有 `locale.en === raw_name` 且 `locale.zh` 存在时，才安全复制到 `feature_id`
- `manual override`
  - 对 `locale.en !== raw_name` 的条目，不自动复制
  - 这些条目只允许来自 `geo_name_overrides.manual.json`

这条链是为了切断旧问题：

- 旧问题不是“翻译丢了”
- 而是“翻译仍在，但 raw-name 级别的改名条目会误伤别的 feature”

---

## 2) 本轮修改文件

### 2.1 前端运行时

- `js/core/state.js`
- `js/core/data_loader.js`
- `js/core/scenario_manager.js`
- `js/core/map_renderer.js`
- `js/ui/i18n.js`
- `js/ui/sidebar.js`
- `js/ui/toolbar.js`
- `js/core/file_manager.js`
- `js/main.js`
- `index.html`

### 2.2 城市与场景数据构建

- `map_builder/cities.py`
- `map_builder/config.py`
- `map_builder/io/readers.py`
- `map_builder/outputs/save.py`
- `init_map_data.py`

### 2.3 新增或新增接入的脚本

- `tools/build_tno_1962_geo_locale_patch.py`
- `tools/patch_tno_1962_bundle.py`

### 2.4 新增或更新的数据资源

- `data/world_cities.geojson`
- `data/city_aliases.json`
- `data/scenarios/blank_base/city_overrides.json`
- `data/scenarios/blank_base/capital_hints.json`
- `data/scenarios/hoi4_1936/city_overrides.json`
- `data/scenarios/hoi4_1936/capital_hints.json`
- `data/scenarios/hoi4_1939/city_overrides.json`
- `data/scenarios/hoi4_1939/capital_hints.json`
- `data/scenarios/modern_world/city_overrides.json`
- `data/scenarios/modern_world/capital_hints.json`
- `data/scenarios/tno_1962/city_overrides.json`
- `data/scenarios/tno_1962/capital_hints.json`
- `data/scenarios/tno_1962/geo_name_overrides.manual.json`
- `data/scenarios/tno_1962/geo_locale_patch.json`
- `data/scenarios/tno_1962/manifest.json`

---

## 3) 关键实现结果

### 3.1 城市点图层

- 新增 `world_cities` 混合源点集
- 新增 `city_aliases`
- 城市点支持 `major / regional / minor / capital`
- `urban` 关闭或低强度时，城市点仍可见
- reveal 逻辑已改成预算式放出，不再是全图标签同时说话

### 3.2 城市标签与样式

- 现有城市点已切到 HOI4-inspired 的石墨风格
- `Label Density` 已改成显式预算而不是不透明倍率
- 地图标签已支持长名压缩，完整名通过城市 hover 保留
- 城市中文/剧本名显示链已改成 strict/fallback 双轨

### 3.3 TNO 1962 地块命名

`geo_locale_patch.json` 当前统计：

- `12287` 个 feature locale
- `12223` 条 safe copy
- `64` 条 manual override
- `2` 条 collision candidate
- `933` 条 omitted feature

manual override 当前覆盖：

- `BRG` 勃艮第相关改名 feature
- `RKO` 已确认的 `Brest-Litowsk` 目标 feature
- `RKM` 已确认的 `Paulusburg` 目标 feature

明确排除的碰撞：

- `FR_ARR_29001` 不应被改成 `Brest-Litowsk`
- `RU_RAY_50074027B61241799946425` 不应被改成 `Paulusburg`

---

## 4) 验证结果

### 4.1 静态检查

已通过：

- `node --check js/core/data_loader.js`
- `node --check js/core/scenario_manager.js`
- `node --check js/ui/i18n.js`
- `python -m py_compile tools/build_tno_1962_geo_locale_patch.py tools/patch_tno_1962_bundle.py`

### 4.2 浏览器验证

本地地址：

- `http://127.0.0.1:8001/?render_profile=auto`

Console：

- `0` error
- `7` warning
- warning 均为既有的 `Scenario political background merge fallback engaged ...`

Network：

- 无 `4xx / 5xx`
- `data/scenarios/tno_1962/geo_locale_patch.json` 已正常返回 `200 OK`

截图：

- `.runtime/browser/tno-1962-geo-locale-fix.png`

### 4.3 关键样例

中文模式：

- `AT130 -> 维也纳`
- `BE211 -> 安特卫普区`
- `RU_CITY_VOLGOGRAD -> 保卢斯堡`

英文模式：

- `AT130 -> Wien`
- `BE211 -> Bezirk Antwerpen`
- `RU_CITY_VOLGOGRAD -> Paulusburg`

碰撞回归：

- `FR_ARR_29001 -> Brest`
- `RU_RAY_50074027B61241799946425 -> Volgograd`

运行时 feature patch 覆盖：

- `politicalFeatureCount = 13222`
- `featureIdZhCount = 12287`
- `scenarioGeoPatchCount = 12287`

---

## 5) 当前已知边角

还没有完全做完的不是“错误剧本名”，而是“剩余 omitted feature 的中文完整度”。

当前状态：

- 已确认剧本改名的 feature 会按 `feature_id` 正确显示
- 未被安全复制、又没有 manual override 的 feature，不会再误吃到别人的剧本改名
- 但其中一部分会安全回退到原始英文名，而不是中文真实名

这意味着：

- 现在已经解决“显示错的剧本名”
- 还没有完全解决“所有 omitted feature 都有高质量中文”

如果后续继续补：

- 应优先扩 `data/scenarios/tno_1962/geo_name_overrides.manual.json`
- 不建议回退到 raw-name 全局覆盖

---

## 6) 建议的后续顺序

1. 先继续补 `geo_name_overrides.manual.json` 中高价值、频繁可见的 omitted feature。
2. 再做一次 `TNO 1962` 的中欧、勃艮第、莫斯科专员辖区、俄区军阀 close-up 浏览器巡检。
3. 如果后续要把这套 feature-keyed patch 扩展到别的 scenario，再抽象成通用 scenario geo locale build step，而不是只挂在 `tno_1962`。

---

## 7) 结论

这轮修复已经把问题从“运行时 feature locale 被错误覆盖、剧本改名失效、中文地块一级大面积退回英文”收敛为：

- feature-keyed scenario patch 正常工作
- 德系 / 德势力范围内已确认改名地块恢复显示
- 中文模式下地块一级已恢复大规模中文
- name collision 不再污染错误 feature

剩余工作是补中文完整度，不是再修一次显示链。
