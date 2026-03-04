# QA-029: East Asia Boundary Deviation Analysis

**Date**: 2026-03-03
**Scope**: Manchukuo (MAN), Mengjiang (MEN), Shanxi (SHX), Communist China (PRC) boundary accuracy vs HOI4 1936 game data
**Severity**: HIGH — affects visual correctness of entire East Asian theatre
**Status**: Root causes identified, corrections pending

---

## Executive Summary

The East Asian 1936 scenario boundaries exhibit **significant deviations** from the HOI4 game data, despite the underlying topology having sufficient geographic precision. The root cause is a **systematic misalignment between modern Chinese administrative divisions and 1936 historical boundaries** in the manual rules file. Specifically:

1. **Manchukuo (MAN)** is missing ~35-45 features from eastern Inner Mongolia and northern Hebei (Jehol/Rehe area)
2. **Mengjiang (MEN)** incorrectly claims ~25-30 features that belong to SHX (Suiyuan + Ordos)
3. **Shanxi (SHX)** is missing the Suiyuan and Ordos territories it controlled in 1936
4. The **compiler region checks** themselves encode incorrect assertions (e.g. "eastern Inner Mongolia stays CHI" when it should be MAN)

---

## 1. HOI4 Ground Truth vs Current Assignment

### 1.1 Manchukuo (MAN) — 7 HOI4 States, 182 provinces

| HOI4 State | Name | Provinces | Modern Region | Hierarchy Group | Current Status |
|-----------|------|-----------|---------------|-----------------|----------------|
| 328 | Kirin | 39 | Jilin | CN_Jilin | CORRECT — covered by hierarchy group |
| 610 | Jehol | 27 | Hebei (Chengde) + Inner Mongolia (Chifeng) | CN_Hebei + CN_Inner_Mongolia | **BROKEN** — only 1 of ~25 features assigned |
| 714 | Heilungkiang | 28 | Heilongjiang + Inner Mongolia (Wulanhaote) | CN_Heilongjiang + CN_Inner_Mongolia | **PARTIAL** — Heilongjiang OK, Wulanhaote area missing |
| 715 | Liaobei | 21 | Jilin (west) + Inner Mongolia (Tongliao) | CN_Jilin + CN_Inner_Mongolia | **PARTIAL** — Jilin features OK, Tongliao area missing |
| 716 | Liaoning | 25 | Liaoning | CN_Liaoning | CORRECT — covered by hierarchy group |
| 717 | Sungkiang | 30 | Heilongjiang (east) | CN_Heilongjiang | CORRECT — covered by hierarchy group |
| 761 | Hulunbuir | 12 | Inner Mongolia (Hulunbuir) | CN_Inner_Mongolia | **BROKEN** — all 13 features left as CHI |

### 1.2 Missing MAN Features — Eastern Inner Mongolia (~35 features)

These CN_Inner_Mongolia features are left as CHI but should be MAN:

**Hulunbuir area (HOI4 State 761):**
| Feature ID | City Name | Notes |
|-----------|-----------|-------|
| CN_CITY_17275852B65388914557323 | Geergunyouqi | Hulunbuir |
| CN_CITY_17275852B70108594636400 | Geergunzuoqi | Hulunbuir |
| CN_CITY_17275852B86600169878018 | Elunchunzizhiqi | Hulunbuir |
| CN_CITY_17275852B13766311075127 | Yakeshei | Hulunbuir |
| CN_CITY_17275852B52963426746769 | Molidawadahanerzuzizhiqi | Hulunbuir |
| CN_CITY_17275852B82032886612970 | Chenbaerhuqi | Hulunbuir |
| CN_CITY_17275852B82709828135465 | Xinbaerhuyouqi | Hulunbuir |
| CN_CITY_17275852B51527717601337 | Xinbaerhuzuoqi | Hulunbuir |
| CN_CITY_17275852B92520018864052 | Arongqi | Hulunbuir |
| CN_CITY_17275852B69502424824259 | Manzhouli | Hulunbuir — border crossing |
| CN_CITY_17275852B31670342403562 | Hailaer | Hulunbuir — major city |
| CN_CITY_17275852B77637740681005 | Ewenkezuzizhiqi | Hulunbuir |
| CN_CITY_17275852B65249545845720 | Zalantun | Hulunbuir |

**Hinggan / Xing'an area (HOI4 States 714/715):**
| Feature ID | City Name | Notes |
|-----------|-----------|-------|
| CN_CITY_17275852B35052748065606 | Wulanhaote | Hinggan League capital |
| CN_CITY_17275852B49862163937258 | Tuquanxian | Hinggan League |
| CN_CITY_17275852B29845184565126 | Keerqinyouyiqianqi | Hinggan League |
| CN_CITY_17275852B54886532312122 | Zhafente | Hinggan League |
| CN_CITY_17275852B94258836786068 | Keerqinyouyizhongqi | Hinggan League |
| CN_CITY_17275852B56398394923562 | Huolinguole | Tongliao/Hinggan border |

**Tongliao area (HOI4 State 715):**
| Feature ID | City Name | Notes |
|-----------|-----------|-------|
| CN_CITY_17275852B15742590166346 | Tongliao | Major city — Liaobei |
| CN_CITY_17275852B95858400881783 | Keerqinzuoyizhongqi | Tongliao area |
| CN_CITY_17275852B75702344877030 | Keerqinzuoyihouqi | Tongliao area |
| CN_CITY_17275852B31406563178063 | Naimanqi | Tongliao area |
| CN_CITY_17275852B3517476181701 | Kailuxian | Tongliao area |
| CN_CITY_17275852B94154852407414 | Kulunqi | Tongliao area |
| CN_CITY_17275852B95395692507678 | Zaluteqi | Tongliao area |

**Chifeng / Rehe area (HOI4 State 610):**
| Feature ID | City Name | Notes |
|-----------|-----------|-------|
| CN_CITY_17275852B75499036549183 | Cifeng | Chifeng — major city in Rehe |
| CN_CITY_17275852B34095213471930 | Aohanqi | Chifeng area |
| CN_CITY_17275852B4549102365820 | Balinzuoqi | Chifeng area |
| CN_CITY_17275852B65428368000852 | Balinyouqi | Chifeng area |
| CN_CITY_17275852B55327839943474 | Linxixian | Chifeng area |
| CN_CITY_17275852B65824385792838 | Ningchengxian | Chifeng area |
| CN_CITY_17275852B61781573612206 | Keshenketengqi | Chifeng area |
| CN_CITY_17275852B22648415427517 | Wengniuteqi | Chifeng area |
| CN_CITY_17275852B28695877218425 | Alukeerqinqi | Chifeng area |
| CN_CITY_17275852B56850756381420 | Zuozixian | Chifeng area (Holingol) |
| CN_CITY_17275852B46788818510645 | Kelinqinqi | Chifeng area |

### 1.3 Missing MAN Features — Northern Hebei / Jehol (~8 features)

These CN_Hebei features should also be MAN (Jehol/Rehe area):

| Feature ID | City Name | Notes |
|-----------|-----------|-------|
| CN_CITY_17275852B66983384026241 | Weichangxian | Chengde prefecture |
| CN_CITY_17275852B21539803830882 | Fengningmanzuzizhixian | Chengde prefecture |
| CN_CITY_17275852B35501076254176 | Longhuaxian | Chengde prefecture |
| CN_CITY_17275852B45953294841051 | Chengdexian | Chengde county (distinct from city) |
| CN_CITY_17275852B21529969500985 | Pingquanxian | Chengde prefecture |
| CN_CITY_17275852B78610390708344 | Luanpingxian | Chengde prefecture |
| CN_CITY_17275852B83634722552305 | Xinglongxian | Chengde prefecture |
| CN_CITY_17275852B20323770219280 | Kuanchengmanzuzizhixian | Chengde prefecture |

(CN_CITY_17275852B22736277138860 Chengde city is already correctly assigned.)

### 1.4 Mengjiang (MEN) — 3 HOI4 States, 26 provinces

| HOI4 State | Name | Provinces | Modern Region | Status |
|-----------|------|-----------|---------------|--------|
| 611 | Chahar (South) | 10 | Hebei (Zhangbei area) + Inner Mongolia | **BROKEN** — Zhangbei area features in CN_Hebei not assigned to MEN |
| 612 | Xilingol | 14 | Inner Mongolia (Xilingol) | Mostly correct |
| 1043 | Pailingmiao | 2 | Inner Mongolia (deep steppe) | Correct |

**Current MEN rule assigns 46 features, but many are wrong:**

Features correctly assigned to MEN (~15-18):
- Xilingol League: Xilinhaote, Abagaqi, Shunitezuoqi, Shuniteyouqi, Zhenglanqi, Zhengxiangbaiqi, Xianghuangqi, Duolunxian, Taipusiqi, Shangduxian, Erlianhaote
- Chahar: Chahaeryouyiqianqi, Chahaeryouyizhongqi, Chahaeryouyihouqi, Xinghexian

Features **wrongly** assigned to MEN — should be SHX (~25-28):

| Feature ID | City Name | Should Be | HOI4 Basis |
|-----------|-----------|-----------|------------|
| CN_CITY_17275852B58561192252896 | Huhehaote (Hohhot) | SHX | State 621 Suiyuan |
| CN_CITY_17275852B83584927302596 | Baotou | SHX | State 621 Suiyuan |
| CN_CITY_17275852B36655604222163 | Tumutezuoqi | SHX | State 621 Suiyuan |
| CN_CITY_17275852B27242410268573 | Tumuteyouqi | SHX | State 621 Suiyuan |
| CN_CITY_17275852B93625175463286 | Helingeerxian | SHX | State 621 Suiyuan |
| CN_CITY_17275852B20617662043886 | Tuoketuoqi | SHX | State 621 Suiyuan |
| CN_CITY_17275852B631335600884 | Qingshuihexian | SHX | State 621 Suiyuan |
| CN_CITY_17275852B60762833036568 | Wuchuangxian | SHX | State 621 Suiyuan |
| CN_CITY_17275852B6490161611892 | Guyangxian | SHX | State 621 Suiyuan |
| CN_CITY_17275852B50024648693467 | Wulateqianqi | SHX | State 621 Suiyuan |
| CN_CITY_17275852B73146949110998 | Wulatezhongqi | SHX | State 621 Suiyuan |
| CN_CITY_17275852B97961566945863 | Wulatehouqi | SHX | State 621 Suiyuan |
| CN_CITY_17275852B45264822840629 | Linhe | SHX | State 621 Suiyuan |
| CN_CITY_17275852B6563591332882 | Hangjinhouqi | SHX | State 621 Suiyuan |
| CN_CITY_17275852B79263520770816 | Dengkouxian | SHX | State 621 Suiyuan |
| CN_CITY_17275852B12777490029839 | Dongsheng | SHX | State 746 Ordos |
| CN_CITY_17275852B68283317499250 | Dalateqi | SHX | State 746 Ordos |
| CN_CITY_17275852B50201707862643 | Zungeerqi | SHX | State 746 Ordos |
| CN_CITY_17275852B56784937332062 | Ertuokeqi | SHX | State 746 Ordos |
| CN_CITY_17275852B41932351427715 | Ertuokeqianqi | SHX | State 746 Ordos |
| CN_CITY_17275852B94979203224281 | Wushenqi | SHX | State 746 Ordos |
| CN_CITY_17275852B3088754118842 | Yijinhuoluoqi | SHX | State 746 Ordos |
| CN_CITY_17275852B83380661850476 | Hangjinqi | SHX | State 746 Ordos |
| CN_CITY_17275852B72607841305823 | Wuhai | SHX | State 746 Ordos border |

Features assigned to MEN — **ambiguous** (Alashan area, ~3):

| Feature ID | City Name | Possible Owner | Notes |
|-----------|-----------|---------------|-------|
| CN_CITY_17275852B45855584289295 | Alashanzuoqi | XSM or SIK | Alashan League — not clearly MEN |
| CN_CITY_17275852B71309875308299 | Alashanyouqi | XSM or SIK | Alashan League |
| CN_CITY_17275852B82593256052894 | Ejinaqi | SIK or MON | Alashan League — far west |

**Missing MEN features from CN_Hebei (Zhangbei/South Chahar area):**

| Feature ID | City Name | Notes |
|-----------|-----------|-------|
| CN_CITY_17275852B74586174185496 | Zhangbeixian | HOI4 State 611 VP location |
| CN_CITY_17275852B28404307874661 | Kangbaoxian | South Chahar area |
| CN_CITY_17275852B92392502748538 | Shangyixian | South Chahar area |
| CN_CITY_17275852B15523465043405 | Chonglixian | South Chahar area |
| CN_CITY_17275852B37803356904979 | Wanquanxian | South Chahar area |

### 1.5 Shanxi (SHX) — 3 HOI4 States, 38 provinces

| HOI4 State | Name | Provinces | Modern Region | Status |
|-----------|------|-----------|---------------|--------|
| 615 | Shanxi | 22 | Shanxi | CORRECT — covered by CN_Shanxi group |
| 621 | Suiyuan | 9 | Inner Mongolia (Hohhot/Ulanqab) | **BROKEN** — assigned to MEN |
| 746 | Ordos | 7 | Inner Mongolia (Ordos) | **BROKEN** — assigned to MEN |

SHX should own CN_Shanxi (107 features) **PLUS** ~25-30 additional features from CN_Inner_Mongolia (the Suiyuan + Ordos areas listed above).

### 1.6 Ulanqab Border Zone

Some Ulanqab-area features are borderline between MEN and SHX:

| Feature ID | City Name | Current | In HOI4 |
|-----------|-----------|---------|---------|
| CN_CITY_17275852B24544375432219 | Siziwangqi | MEN | Likely SHX (Suiyuan frontier) |
| CN_CITY_17275852B38329795368035 | Liangchengxian | MEN | SHX (Suiyuan) |
| CN_CITY_17275852B71745014009476 | Fengzhen | MEN | SHX (Suiyuan) |
| CN_CITY_17275852B42573248116242 | Jining | MEN | SHX (Suiyuan/Ulanqab) |
| CN_CITY_17275852B97301454350730 | Huadexian | CHI | SHX or MEN (Chahar/Suiyuan border) |
| CN_CITY_17275852B17909208638027 | Daerhanmaominganlianheqi | CHI | SHX (Suiyuan) |

---

## 2. Root Cause Analysis

### 2.1 Fundamental Mapping Error

The crosswalk system maps features by **modern Chinese administrative boundaries** (hierarchy groups like `CN_Inner_Mongolia`, `CN_Shanxi`, `CN_Hebei`), but in 1936 China, administrative boundaries were fundamentally different:

```
Modern "Inner Mongolia" (88 features) was split in 1936:
├── MAN: ~35 features (Hulunbuir, Xing'an, Tongliao, Chifeng/Rehe)
├── MEN: ~15 features (Chahar, Xilingol, Pailingmiao)
├── SHX: ~25 features (Suiyuan, Ordos, Ulanqab)
└── CHI: ~13 features (transitional areas)

Modern "Hebei" (150 features) was split in 1936:
├── MAN: ~9 features (Chengde/Jehol/Rehe area)
├── MEN: ~5 features (Zhangbei/South Chahar)
└── CHI: ~136 features (Hebei proper)

Modern "Shanxi" (107 features) was entirely SHX:
└── SHX: 107 features ✓ (correct)
```

The manual rule authors appear to have:
1. Assigned all of `CN_Inner_Mongolia` west of Chifeng to MEN (too much)
2. Left all of `CN_Inner_Mongolia` east of Xilingol as CHI (should be MAN)
3. Not given SHX any Suiyuan/Ordos features
4. Not split CN_Hebei between MAN and MEN

### 2.2 Incorrect Compiler Verification

The compiler's `china_mengjiang` region check asserts:
```python
"Eastern Inner Mongolia remains Chinese" — checks Hailaer, Tongliao, Cifeng, Wulanhaote → CHI
```

This assertion is **factually wrong**. In HOI4 1936:
- Hailaer → MAN (State 761 Hulunbuir)
- Tongliao → MAN (State 715 Liaobei)
- Wulanhaote → MAN (State 714 Heilungkiang — VP 12485 "Ulanhot")
- Chifeng → MAN (State 610 Jehol — Rehe province)

The region check was written to validate the incorrect rule assignment, not the HOI4 ground truth.

### 2.3 Feature Count Mismatch

| Entity | HOI4 Provinces | Current Features Assigned | Expected Features |
|--------|---------------|--------------------------|-------------------|
| MAN | 182 | 190 (3 groups + 1 feature) | ~230 (groups + 35 IM + 9 Hebei) |
| MEN | 26 | 46 (individual features) | ~20 (Chahar/Xilingol only) |
| SHX | 38 | 107 (CN_Shanxi only) | ~135 (Shanxi + Suiyuan + Ordos) |

---

## 3. Impact Assessment

### Visual Boundary Errors

1. **MAN southern boundary** — Missing Chifeng/Rehe area creates a gap between Manchukuo and the Great Wall where CHI (blue) appears instead of MAN (orange)
2. **MAN western boundary** — Missing Hulunbuir/Tongliao/Wulanhaote creates a large CHI wedge cutting into what should be continuous MAN territory along the Soviet/Mongolian border
3. **MEN/SHX boundary** — MEN extends far too far south and west (includes Hohhot, Baotou, Ordos) when it should be limited to the Chahar/Xilingol steppe
4. **SHX territory** — Appears as just modern Shanxi province (a rectangle) instead of the historical SHX which included a large northwestward extension through Suiyuan to the Mongolian border

### Severity

These errors are the most visually prominent boundary deviations in the entire scenario because:
- Inner Mongolia is a very large geographic area — wrong assignments cover thousands of km²
- The color contrast between MAN (orange), MEN (green), SHX (dark red), and CHI (blue) is high
- Any HOI4 player will immediately recognize these boundaries as wrong

---

## 4. Recommended Corrections

### 4.1 Rule Changes (hoi4_1936.manual.json)

**Step 1: Add MAN eastern Inner Mongolia features**
- Add a new `include_feature_ids` list to the `manchukuo` rule containing all Hulunbuir, Hinggan, Tongliao, and Chifeng-area features from CN_Inner_Mongolia (~35 features)
- Add Chengde-area features from CN_Hebei (~8 features)

**Step 2: Trim MEN to Chahar/Xilingol only**
- Remove all Suiyuan, Ordos, Bayannur, and Alashan features from MEN's `include_feature_ids`
- Consider adding Zhangbei/South Chahar features from CN_Hebei
- Resulting MEN should have ~15-20 features, not 46

**Step 3: Add SHX Suiyuan/Ordos features**
- Add `include_feature_ids` to the `shanxi_warlord` rule for the Suiyuan and Ordos features from CN_Inner_Mongolia (~25-30 features)

**Step 4: Resolve Alashan ambiguity**
- Determine correct 1936 owner for Alashanzuoqi, Alashanyouqi, Ejinaqi
- Likely XSM (Xibei San Ma) or SIK (Sinkiang) depending on HOI4 state data

### 4.2 Compiler Check Corrections

- Fix `china_mengjiang` region check: remove the "Eastern Inner Mongolia remains Chinese" batch or change expected owner to MAN
- Add a new `china_manchukuo_eastern_im` check verifying Hulunbuir/Tongliao/Chifeng features are MAN
- Update `china_manchukuo_frontier` anchors to include Hulunbuir and Chifeng area features

### 4.3 Systematic Approach for Future

Consider building an automated HOI4-province → topology-feature crosswalk using the `provinces.bmp` atlas:
1. For each HOI4 state → get its province list
2. For each province → get its RGB from `definition.csv`
3. Map the province's geographic centroid (from `provinces.bmp`) to the nearest topology feature
4. This would eliminate manual cherry-picking errors

---

## 5. Files Affected

| File | Change Required |
|------|----------------|
| `data/scenario-rules/hoi4_1936.manual.json` | Rewrite MAN, MEN, SHX rules |
| `scenario_builder/hoi4/compiler.py` | Fix `china_mengjiang` region check |
| `data/scenarios/hoi4_1936/owners.by_feature.json` | Rebuild after rule changes |
| `data/scenarios/hoi4_1936/countries.json` | Rebuild — feature counts will change |
| `data/scenarios/hoi4_1936/audit.json` | Rebuild — region checks will change |
| `data/scenarios/hoi4_1936/manifest.json` | Rebuild — baseline hash will change |
