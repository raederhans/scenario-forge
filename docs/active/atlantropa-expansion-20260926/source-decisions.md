# Atlantropa 来源候选决策记录（2026-09-26）

**最终更新：** Marmara `9038 / 18349 → TUR` 与 Constantine `9070 / 18332 → IAL` 已通过最终隔离构建和验收，并采纳到正式 `data/scenarios/tno_1962`。最终新增面积分别约 816.26、1,718.35 km²。以下保留试建时的来源探针和延期理由；原始探针面积不等于最终几何面积。最终结果见 [results.md](results.md)。

## 试建前的判断记录

本记录是**试建候选与延期理由**，不是最终采纳表。依据冻结场景 `.runtime/tmp/atlantropa-expansion-20260926/baseline/tno_1962`、八区 [source inventory](../../../.runtime/tmp/atlantropa-expansion-20260926/inventory/source_inventory.json)、[Turkey recommendation](../../../.runtime/tmp/atlantropa-expansion-20260926/turkey/recommendation.json)、[Cyprus/Marmara verification](../../../.runtime/tmp/atlantropa-expansion-20260926/turkey/cyprus_9038_verification.json)、[North Africa templates](../../../.runtime/tmp/atlantropa-expansion-20260926/turkey/north_africa_templates.json) 与 [Africa candidate probe](../../../.runtime/tmp/atlantropa-expansion-20260926/africa/candidate-probe.json)。清单有 4,655 条 region/province 记录、3,002 个不同源省份；同一省份可因不同区域配准重复出现，不能把记录数当成漏地数。

## 试建顺序

| 状态 | 来源及判断 | 试建前提 |
| --- | --- | --- |
| 本轮接纳**隔离试建** | Marmara 9038 / 18349，`aegean` 配准后有约 0.054648 平方经纬度的原陆地以外候选，且与现有 Atlantropa land 不重合；邻接 TUR 的 Yalova、Kocaeli、Bursa，三者现有 owner/controller/core 均包含 TUR。 | 仅在隔离 stage 尝试 `aegean.land_state_ids += 9038`、owner override `9038: TUR`。保留 8621/8622 水源配置；必须检查 `tno_sea_of_marmara`、`tno_bosporus_dardanelles` 及 ATL sea 与新陆地的排斥、海峡连续性、归属/core、岛屿身份和本地渲染。来源推荐尚不等于试建或严格验证通过。 |
| 下一阶段接纳**隔离试建候选** | Constantine 9070 / 18332，`west_med` 候选约 1,552.30 km² 尚无 ATL land，直接接岸长度约 0.514944 度；相邻 `DZA-2166` 的 owner/controller/core 均为 IAL。 | 待 Marmara 单独结果明确后，按 IAL 沿海来源处理，并检查其与 west_med、tyrrhenian、sicily_tunis 的 ATL sea 接口。现阶段没有据此修改 canonical 场景或宣称通过构建。 |

## 延期、已有覆盖与范围外

| 来源 | 本次处理依据 |
| --- | --- |
| Oran 9069 / 18320 | 延期。约 6,504.36 km² 是现有 ATL land 以外候选，但源同时触及 IBR 的 `MAR-1454` 和 ALC 的 `DZA-2200` 等政治区；单一 owner 会掩盖跨境归属。需先按可信源边界拆分并验证海岸接触。 |
| Benghasi 9084 / 18310 | 延期。约 562.08 km² 候选虽与 LBA 基准区重叠，但探针的海岸边界接触长度为 0，只有点接岸；现有 ATL sea 覆盖大部。不能仅据点接触生成陆桥。 |
| Western Lesvos 9843 / 19191、Eastern Chios 9844 / 19190 | 延期。区域仿射把两者分别投到土耳其西南岸附近，与名称所指岛屿不符；尚无可信原岛锚点及专属配准。 |
| Gemlik Island 9039 / 18350、Dam 9089 / 18346 | 已有原 TUR 陆地完整覆盖；Turkey 探针拟合面积分别约 0.086686、0.023642 平方经纬度，没有新增填海候选。 |
| Cyprus 2657 / 14139 | **专属原岛锚点配准后**拟合面积约 0.068532 平方经纬度，100% 落在原 `CY000` 和当前 `ATLISL_levant_cyprus` 中，外部残余为 0。清单中使用 Levant 通用仿射产生的 `unresolved` 不可据此判为缺口；原岛锚点判据优先。 |
| Unnamed/template 2682 / 14164、2694 / 14176、2745 / 13049、2875 / 14284 | 四个不同源省份暂缓。14164 在 west_med、sicily_tunis、gabes 下落点与现有覆盖不同；其余三个在各自区域也有表面未覆盖面积，但缺少可靠来源身份、归属和跨区域配准选择。不能按 `outside_both_area` 自动接纳或猜 owner。 |
| 8543 / 18169、8544 / 18163 | 已由既有区域配置覆盖。把同一来源换用相邻区域仿射会出现小片“缺口”（探针约 0.002717、0.015111 平方经纬度）；这是配准缝问题，不能重复加入另一 region。 |
| Black Sea 全盆 | 本次范围外。八个 AOI 只延伸到黑海口；`full_black_sea` 中 8444、8630、8632–8644 只是**非空间**来源索引，8631 为普通州而未列入。未完成全盆配准或候选接纳。 |

## 证据单位与继续执行

Turkey 探针及 inventory 的面积是**平方经纬度（deg²）**；Africa 探针的 `*_km2` 是其单独面积换算，不能直接和 deg² 相加或按固定比例换算。`source_sea_contact_length_deg` 是角度长度，0.04 度邻近判据只能说明局部关联，不能证明海岸线精度。HGO 原始名称含 `sea` 的省份在这批源数据中的 `province_type` 仍为 `land`，不能凭名称或 type 判断实际海水、填海或归属。清单的 0.35 度邻接带只是**扫描窗口**；通用区域仿射来自州质心控制点，原岛应使用专属锚点；生成器的 0.0025 度源几何简化也不是绝对源精度保证。清单和探针均不代替生成器的 snap、简化、岸线接触恢复、身份协调和最终水域生成。

复核当前冻结来源可用：

```powershell
py -3 -B tools/audit_atlantropa_sources.py --baseline-dir .runtime/tmp/atlantropa-expansion-20260926/baseline/tno_1962 --output-dir .runtime/tmp/atlantropa-expansion-20260926/inventory
```

主代理拥有隔离构建与采纳权；待试建配置完成后，在新的 stage 运行现有入口，再针对该 stage 检查几何和非目标保留：

```powershell
py -3 -B -m tools.rebuild_atlantropa_stage --source-dir .runtime/tmp/atlantropa-expansion-20260926/baseline/tno_1962 --stage-dir .runtime/tmp/atlantropa-expansion-20260926/candidate/tno_1962
py -3 -B tools/check_atlantropa_geometry.py --scenario-dir .runtime/tmp/atlantropa-expansion-20260926/candidate/tno_1962 --baseline-dir .runtime/tmp/atlantropa-expansion-20260926/baseline/tno_1962
```

以上是可用命令，**不是本记录已执行的候选试建或验收结果**。最终采用仍须以隔离构建、严格场景契约、非目标数据保留、海陆互斥和聚焦 localhost 编辑/撤销检查为准。
