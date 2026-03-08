from __future__ import annotations

import hashlib
import json
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone

from .crosswalk import (
    assign_feature_owners,
    build_active_controller_tags,
    build_active_owner_tags,
    build_country_registry,
    build_feature_indexes,
    build_iso2_to_mapped_tag,
)


CRITICAL_REGION_IDS = [
    "europe_germany_poland_1936",
    "europe_east_prussia",
    "europe_soviet_poland_1936",
    "europe_vilnius_override",
    "europe_subcarpathian_ruthenia",
    "europe_bessarabia",
    "china_mengjiang",
    "china_prc_shaanbei",
    "china_shanxi",
    "china_manchukuo_frontier",
    "africa_somaliland",
    "africa_western_sahara",
    "soviet_core_coverage",
]


def _stable_json_hash(payload: object) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )
    return hashlib.sha256(encoded).hexdigest()


def _normalize_name_key(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    ascii_text = "".join(char for char in text if not unicodedata.combining(char))
    return " ".join(ascii_text.casefold().strip().split())


def _build_name_index(runtime_features: list[object]) -> dict[str, set[str]]:
    name_index: dict[str, set[str]] = defaultdict(set)
    for feature in runtime_features:
        name_key = _normalize_name_key(getattr(feature, "name", ""))
        if name_key:
            name_index[name_key].add(feature.feature_id)
    return name_index


def _resolve_targets(
    *,
    feature_by_id: dict[str, object],
    ids_by_country: dict[str, set[str]],
    ids_by_group: dict[str, set[str]],
    name_index: dict[str, set[str]],
    include_country_codes: list[str] | None = None,
    include_hierarchy_group_ids: list[str] | None = None,
    include_feature_ids: list[str] | None = None,
    include_names: list[str] | None = None,
    name_country_code: str = "",
) -> dict[str, object]:
    selected: set[str] = set()
    missing_country_codes: list[str] = []
    missing_groups: list[str] = []
    missing_feature_ids: list[str] = []
    missing_names: list[str] = []

    for code in include_country_codes or []:
        feature_ids = ids_by_country.get(code, set())
        if not feature_ids:
            missing_country_codes.append(code)
            continue
        selected.update(feature_ids)

    for group_id in include_hierarchy_group_ids or []:
        feature_ids = ids_by_group.get(group_id, set())
        if not feature_ids:
            missing_groups.append(group_id)
            continue
        selected.update(feature_ids)

    for feature_id in include_feature_ids or []:
        if feature_id not in feature_by_id:
            missing_feature_ids.append(feature_id)
            continue
        selected.add(feature_id)

    for name in include_names or []:
        matching_ids = {
            feature_id
            for feature_id in name_index.get(_normalize_name_key(name), set())
            if not name_country_code or getattr(feature_by_id.get(feature_id), "country_code", "") == name_country_code
        }
        if not matching_ids:
            missing_names.append(name)
            continue
        selected.update(matching_ids)

    return {
        "feature_ids": sorted(selected),
        "missing_country_codes": sorted(set(missing_country_codes)),
        "missing_groups": sorted(set(missing_groups)),
        "missing_feature_ids": sorted(set(missing_feature_ids)),
        "missing_names": sorted(set(missing_names)),
    }


def _build_region_check(
    *,
    region_id: str,
    status: str,
    notes: str,
    affected_owner_tags: set[str] | list[str],
    affected_feature_ids: set[str] | list[str],
) -> dict[str, object]:
    return {
        "status": status,
        "notes": notes,
        "affected_owner_tags": sorted({str(tag).strip().upper() for tag in affected_owner_tags if str(tag).strip()}),
        "affected_feature_ids": sorted({str(feature_id).strip() for feature_id in affected_feature_ids if str(feature_id).strip()}),
    }


def _append_missing_target_blockers(
    *,
    topology_blockers: list[dict[str, object]],
    region_id: str,
    selection_label: str,
    expected_owner_tag: str,
    resolved: dict[str, object],
) -> None:
    if resolved["missing_country_codes"]:
        topology_blockers.append(
            {
                "blocker_id": f"{region_id}:{selection_label}:missing_country_codes",
                "region_id": region_id,
                "kind": "missing_country_codes",
                "notes": f"Selection `{selection_label}` could not resolve country codes: {', '.join(resolved['missing_country_codes'])}.",
                "affected_owner_tags": [expected_owner_tag],
                "affected_feature_ids": [],
            }
        )
    if resolved["missing_groups"]:
        topology_blockers.append(
            {
                "blocker_id": f"{region_id}:{selection_label}:missing_groups",
                "region_id": region_id,
                "kind": "missing_groups",
                "notes": f"Selection `{selection_label}` could not resolve hierarchy groups: {', '.join(resolved['missing_groups'])}.",
                "affected_owner_tags": [expected_owner_tag],
                "affected_feature_ids": [],
            }
        )
    if resolved["missing_feature_ids"]:
        topology_blockers.append(
            {
                "blocker_id": f"{region_id}:{selection_label}:missing_feature_ids",
                "region_id": region_id,
                "kind": "missing_feature_ids",
                "notes": f"Selection `{selection_label}` references unknown feature ids: {', '.join(resolved['missing_feature_ids'])}.",
                "affected_owner_tags": [expected_owner_tag],
                "affected_feature_ids": [],
            }
        )
    if resolved["missing_names"]:
        topology_blockers.append(
            {
                "blocker_id": f"{region_id}:{selection_label}:missing_names",
                "region_id": region_id,
                "kind": "missing_names",
                "notes": f"Selection `{selection_label}` could not resolve feature names: {', '.join(resolved['missing_names'])}.",
                "affected_owner_tags": [expected_owner_tag],
                "affected_feature_ids": [],
            }
        )


def _evaluate_region_check(
    *,
    region_id: str,
    owner_by_feature_id: dict[str, str],
    topology_blockers: list[dict[str, object]],
    batches: list[dict[str, object]],
) -> dict[str, object]:
    affected_feature_ids: set[str] = set()
    affected_owner_tags: set[str] = set()
    failures: list[str] = []
    blockers_before = len(topology_blockers)

    for batch in batches:
        label = str(batch.get("label") or batch["expected_owner_tag"])
        expected_owner_tag = str(batch["expected_owner_tag"]).strip().upper()
        resolved = batch["resolved"]
        feature_ids = resolved["feature_ids"]
        affected_feature_ids.update(feature_ids)
        affected_owner_tags.add(expected_owner_tag)
        _append_missing_target_blockers(
            topology_blockers=topology_blockers,
            region_id=region_id,
            selection_label=label,
            expected_owner_tag=expected_owner_tag,
            resolved=resolved,
        )
        if not feature_ids:
            failures.append(f"{label}: no matching runtime features were found.")
            continue
        wrong_feature_ids = [
            feature_id
            for feature_id in feature_ids
            if owner_by_feature_id.get(feature_id, "") != expected_owner_tag
        ]
        if wrong_feature_ids:
            wrong_owner_tags = {
                owner_by_feature_id.get(feature_id, "")
                for feature_id in wrong_feature_ids
                if owner_by_feature_id.get(feature_id, "")
            }
            affected_owner_tags.update(wrong_owner_tags)
            failures.append(
                f"{label}: {len(wrong_feature_ids)} of {len(feature_ids)} features are not owned by {expected_owner_tag}."
            )

    if failures:
        notes = " ".join(failures)
        if len(topology_blockers) > blockers_before:
            notes = f"{notes} Topology blockers were detected for this region."
        return _build_region_check(
            region_id=region_id,
            status="fail",
            notes=notes,
            affected_owner_tags=affected_owner_tags,
            affected_feature_ids=affected_feature_ids,
        )

    return _build_region_check(
        region_id=region_id,
        status="pass",
        notes=f"All {len(affected_feature_ids)} targeted features match the expected 1936 ownership.",
        affected_owner_tags=affected_owner_tags,
        affected_feature_ids=affected_feature_ids,
    )


def _evaluate_region_checks(
    *,
    runtime_features: list[object],
    hierarchy_groups: dict[str, list[str]],
    assignments: dict[str, object],
) -> tuple[dict[str, dict[str, object]], list[dict[str, object]]]:
    feature_by_id, ids_by_country, ids_by_group = build_feature_indexes(runtime_features, hierarchy_groups)
    name_index = _build_name_index(runtime_features)
    owner_by_feature_id = {
        feature_id: assignment.owner_tag
        for feature_id, assignment in assignments.items()
        if feature_id in feature_by_id
    }
    region_checks: dict[str, dict[str, object]] = {}
    topology_blockers: list[dict[str, object]] = []

    region_checks["europe_germany_poland_1936"] = _evaluate_region_check(
        region_id="europe_germany_poland_1936",
        owner_by_feature_id=owner_by_feature_id,
        topology_blockers=topology_blockers,
        batches=[
            {
                "label": "Germany western/eastern frontier",
                "expected_owner_tag": "GER",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_hierarchy_group_ids=[
                        "RU_Kaliningrad",
                        "PL_Warmian_Masurian",
                        "PL_Lower_Silesian",
                        "PL_Opole",
                        "PL_Lubusz",
                        "PL_West_Pomeranian",
                    ],
                ),
            },
            {
                "label": "Polish eastern frontier",
                "expected_owner_tag": "POL",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_hierarchy_group_ids=[
                        "UA_Lviv",
                        "UA_Volyn",
                        "UA_Rivne",
                        "UA_Ternopil",
                        "UA_Ivano_Frankivsk",
                        "BY_Brest",
                        "BY_Grodno",
                    ],
                    include_feature_ids=[
                        "BY_HIST_POL_MINSK_WEST",
                        "BY_RAY_67162791B18102707107362",
                        "BY_RAY_67162791B41761210959552",
                    ],
                ),
            },
        ],
    )

    region_checks["europe_east_prussia"] = _evaluate_region_check(
        region_id="europe_east_prussia",
        owner_by_feature_id=owner_by_feature_id,
        topology_blockers=topology_blockers,
        batches=[
            {
                "label": "East Prussia",
                "expected_owner_tag": "GER",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_hierarchy_group_ids=["RU_Kaliningrad", "PL_Warmian_Masurian"],
                ),
            },
        ],
    )

    region_checks["europe_soviet_poland_1936"] = _evaluate_region_check(
        region_id="europe_soviet_poland_1936",
        owner_by_feature_id=owner_by_feature_id,
        topology_blockers=topology_blockers,
        batches=[
            {
                "label": "Polish Kresy",
                "expected_owner_tag": "POL",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_hierarchy_group_ids=[
                        "UA_Lviv",
                        "UA_Volyn",
                        "UA_Rivne",
                        "UA_Ternopil",
                        "UA_Ivano_Frankivsk",
                        "BY_Brest",
                        "BY_Grodno",
                    ],
                    include_feature_ids=[
                        "BY_HIST_POL_MINSK_WEST",
                        "BY_RAY_67162791B18102707107362",
                        "BY_RAY_67162791B41761210959552",
                    ],
                ),
            },
            {
                "label": "Belarus Soviet interior anchor",
                "expected_owner_tag": "SOV",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_hierarchy_group_ids=["BY_Gomel", "BY_Mogilev"],
                    include_feature_ids=[
                        "BY_INT_MINSK",
                        "BY_INT_VITEBSK",
                        "BY_CITY_MINSK",
                        "BY_HIST_POL_VITEBSK_WEST",
                    ],
                ),
            },
            {
                "label": "Core Soviet interior anchor",
                "expected_owner_tag": "SOV",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_hierarchy_group_ids=["RU_Volgograd"],
                ),
            },
        ],
    )

    region_checks["europe_vilnius_override"] = _evaluate_region_check(
        region_id="europe_vilnius_override",
        owner_by_feature_id=owner_by_feature_id,
        topology_blockers=topology_blockers,
        batches=[
            {
                "label": "Vilnius project override",
                "expected_owner_tag": "LIT",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_feature_ids=["LT011"],
                ),
            },
        ],
    )

    region_checks["europe_subcarpathian_ruthenia"] = _evaluate_region_check(
        region_id="europe_subcarpathian_ruthenia",
        owner_by_feature_id=owner_by_feature_id,
        topology_blockers=topology_blockers,
        batches=[
            {
                "label": "Subcarpathian Ruthenia",
                "expected_owner_tag": "CZE",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_hierarchy_group_ids=["UA_Zakarpattia"],
                ),
            },
        ],
    )

    region_checks["europe_bessarabia"] = _evaluate_region_check(
        region_id="europe_bessarabia",
        owner_by_feature_id=owner_by_feature_id,
        topology_blockers=topology_blockers,
        batches=[
            {
                "label": "Bessarabia and Bukovina",
                "expected_owner_tag": "ROM",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_country_codes=["MD"],
                    include_hierarchy_group_ids=["UA_Chernivtsi"],
                    include_feature_ids=[
                        "UA_RAY_74538382B97641778556925",
                        "UA_RAY_74538382B34887074672752",
                        "UA_RAY_74538382B4443211725898",
                        "UA_RAY_74538382B21342332427534",
                        "UA_RAY_74538382B88986400051477",
                        "UA_RAY_74538382B92147387256537",
                        "UA_RAY_74538382B97836372307066",
                        "UA_RAY_74538382B95291552499633",
                        "UA_RAY_74538382B44725547103458",
                    ],
                ),
            },
        ],
    )

    region_checks["china_mengjiang"] = _evaluate_region_check(
        region_id="china_mengjiang",
        owner_by_feature_id=owner_by_feature_id,
        topology_blockers=topology_blockers,
        batches=[
            {
                "label": "Mengjiang core steppe and South Chahar corridor",
                "expected_owner_tag": "MEN",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_feature_ids=[
                        "CN_CITY_17275852B50417809016381",
                        "CN_CITY_17275852B88620213203291",
                        "CN_CITY_17275852B84578587562532",
                        "CN_CITY_17275852B60640643165285",
                        "CN_CITY_17275852B79222988236433",
                        "CN_CITY_17275852B24432249933156",
                        "CN_CITY_17275852B22612364472373",
                        "CN_CITY_17275852B82302902278950",
                        "CN_CITY_17275852B97242903030707",
                        "CN_CITY_17275852B76051276542746",
                        "CN_CITY_17275852B68916318815205",
                        "CN_CITY_17275852B193788097700",
                        "CN_CITY_17275852B38490404484695",
                        "CN_CITY_17275852B86551151627376",
                        "CN_CITY_17275852B22182624504514",
                        "CN_CITY_17275852B74586174185496",
                        "CN_CITY_17275852B28404307874661",
                        "CN_CITY_17275852B92392502748538",
                        "CN_CITY_17275852B15523465043405",
                        "CN_CITY_17275852B37803356904979",
                        "CN_CITY_17275852B97301454350730",
                        "CN_CITY_17275852B70900834557546",
                        "CN_CITY_17275852B56985443636553",
                    ],
                ),
            },
            {
                "label": "Alashan frontier no longer belongs to Mengjiang",
                "expected_owner_tag": "XSM",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_feature_ids=[
                        "CN_CITY_17275852B45855584289295",
                        "CN_CITY_17275852B71309875308299",
                        "CN_CITY_17275852B82593256052894",
                    ],
                ),
            },
        ],
    )

    region_checks["china_prc_shaanbei"] = _evaluate_region_check(
        region_id="china_prc_shaanbei",
        owner_by_feature_id=owner_by_feature_id,
        topology_blockers=topology_blockers,
        batches=[
            {
                "label": "Shaanbei base area",
                "expected_owner_tag": "PRC",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_feature_ids=[
                        "CN_CITY_17275852B92543718728466",
                        "CN_CITY_17275852B71560826208449",
                        "CN_CITY_17275852B78338650280434",
                        "CN_CITY_17275852B2823373927353",
                        "CN_CITY_17275852B21226359210240",
                        "CN_CITY_17275852B56546823889197",
                        "CN_CITY_17275852B25631219939186",
                        "CN_CITY_17275852B69887483986817",
                        "CN_CITY_17275852B65012922952769",
                        "CN_CITY_17275852B75774687226557",
                        "CN_CITY_17275852B32624511377382",
                        "CN_CITY_17275852B74624363636090",
                        "CN_CITY_17275852B50263043640706",
                        "CN_CITY_17275852B66160899159190",
                        "CN_CITY_17275852B99998846476531",
                        "CN_CITY_17275852B25721670330334",
                        "CN_CITY_17275852B12112577569162",
                        "CN_CITY_17275852B97849821920285",
                        "CN_CITY_17275852B53870940672933",
                        "CN_CITY_17275852B29907680476951",
                        "CN_CITY_17275852B51213205937459",
                        "CN_CITY_17275852B21100527045866",
                        "CN_CITY_17275852B21944814919046",
                        "CN_CITY_17275852B75982784014179",
                        "CN_CITY_17275852B69590886182052",
                    ],
                ),
            },
            {
                "label": "Xi'an core remains Chinese",
                "expected_owner_tag": "CHI",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_names=["Xian", "Xianyang", "Baoji", "Weinan"],
                    name_country_code="CN",
                ),
            },
        ],
    )

    region_checks["china_shanxi"] = _evaluate_region_check(
        region_id="china_shanxi",
        owner_by_feature_id=owner_by_feature_id,
        topology_blockers=topology_blockers,
        batches=[
            {
                "label": "Shanxi core anchors",
                "expected_owner_tag": "SHX",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_names=["Taiyuan", "Datong", "Changzhi"],
                    name_country_code="CN",
                ),
            },
            {
                "label": "Suiyuan and Ordos extension",
                "expected_owner_tag": "SHX",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_feature_ids=[
                        "CN_CITY_17275852B24544375432219",
                        "CN_CITY_17275852B38329795368035",
                        "CN_CITY_17275852B71745014009476",
                        "CN_CITY_17275852B42573248116242",
                        "CN_CITY_17275852B58561192252896",
                        "CN_CITY_17275852B83584927302596",
                        "CN_CITY_17275852B36655604222163",
                        "CN_CITY_17275852B27242410268573",
                        "CN_CITY_17275852B93625175463286",
                        "CN_CITY_17275852B20617662043886",
                        "CN_CITY_17275852B631335600884",
                        "CN_CITY_17275852B60762833036568",
                        "CN_CITY_17275852B6490161611892",
                        "CN_CITY_17275852B50024648693467",
                        "CN_CITY_17275852B73146949110998",
                        "CN_CITY_17275852B97961566945863",
                        "CN_CITY_17275852B45264822840629",
                        "CN_CITY_17275852B6563591332882",
                        "CN_CITY_17275852B79263520770816",
                        "CN_CITY_17275852B12777490029839",
                        "CN_CITY_17275852B68283317499250",
                        "CN_CITY_17275852B50201707862643",
                        "CN_CITY_17275852B56784937332062",
                        "CN_CITY_17275852B41932351427715",
                        "CN_CITY_17275852B94979203224281",
                        "CN_CITY_17275852B3088754118842",
                        "CN_CITY_17275852B83380661850476",
                        "CN_CITY_17275852B72607841305823",
                        "CN_CITY_17275852B17909208638027",
                    ],
                ),
            },
        ],
    )

    region_checks["china_manchukuo_frontier"] = _evaluate_region_check(
        region_id="china_manchukuo_frontier",
        owner_by_feature_id=owner_by_feature_id,
        topology_blockers=topology_blockers,
        batches=[
            {
                "label": "Manchukuo provincial and eastern Inner Mongolian frontier",
                "expected_owner_tag": "MAN",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_feature_ids=[
                        "CN_CITY_17275852B22736277138860",
                        "CN_CITY_17275852B24114902469869",
                        "CN_CITY_17275852B26654787502327",
                        "CN_CITY_17275852B53613184067027",
                        "CN_CITY_17275852B83272093468807",
                        "CN_CITY_17275852B64635512622708",
                        "CN_CITY_17275852B64529865795141",
                        "CN_CITY_17275852B8726104203357",
                        "CN_CITY_17275852B86652780330995",
                        "CN_CITY_17275852B96399789734520",
                        "CN_CITY_17275852B62742745762805",
                        "CN_CITY_17275852B65388914557323",
                        "CN_CITY_17275852B70108594636400",
                        "CN_CITY_17275852B86600169878018",
                        "CN_CITY_17275852B13766311075127",
                        "CN_CITY_17275852B52963426746769",
                        "CN_CITY_17275852B82032886612970",
                        "CN_CITY_17275852B82709828135465",
                        "CN_CITY_17275852B51527717601337",
                        "CN_CITY_17275852B92520018864052",
                        "CN_CITY_17275852B69502424824259",
                        "CN_CITY_17275852B31670342403562",
                        "CN_CITY_17275852B77637740681005",
                        "CN_CITY_17275852B65249545845720",
                        "CN_CITY_17275852B35052748065606",
                        "CN_CITY_17275852B49862163937258",
                        "CN_CITY_17275852B29845184565126",
                        "CN_CITY_17275852B54886532312122",
                        "CN_CITY_17275852B94258836786068",
                        "CN_CITY_17275852B56398394923562",
                        "CN_CITY_17275852B15742590166346",
                        "CN_CITY_17275852B95858400881783",
                        "CN_CITY_17275852B75702344877030",
                        "CN_CITY_17275852B31406563178063",
                        "CN_CITY_17275852B3517476181701",
                        "CN_CITY_17275852B94154852407414",
                        "CN_CITY_17275852B95395692507678",
                        "CN_CITY_17275852B75499036549183",
                        "CN_CITY_17275852B34095213471930",
                        "CN_CITY_17275852B4549102365820",
                        "CN_CITY_17275852B65428368000852",
                        "CN_CITY_17275852B55327839943474",
                        "CN_CITY_17275852B65824385792838",
                        "CN_CITY_17275852B61781573612206",
                        "CN_CITY_17275852B22648415427517",
                        "CN_CITY_17275852B28695877218425",
                        "CN_CITY_17275852B56850756381420",
                        "CN_CITY_17275852B46788818510645",
                        "CN_CITY_17275852B66983384026241",
                        "CN_CITY_17275852B21539803830882",
                        "CN_CITY_17275852B35501076254176",
                        "CN_CITY_17275852B45953294841051",
                        "CN_CITY_17275852B21529969500985",
                        "CN_CITY_17275852B78610390708344",
                        "CN_CITY_17275852B83634722552305",
                        "CN_CITY_17275852B20323770219280",
                    ],
                ),
            },
            {
                "label": "Jidong Japanese occupation corridor",
                "expected_owner_tag": "JAP",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_feature_ids=["CN_CITY_17275852B82452317993245"],
                ),
            },
        ],
    )

    region_checks["africa_somaliland"] = _evaluate_region_check(
        region_id="africa_somaliland",
        owner_by_feature_id=owner_by_feature_id,
        topology_blockers=topology_blockers,
        batches=[
            {
                "label": "Somaliland northern features",
                "expected_owner_tag": "SOM",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_names=["Awdal", "Woqooyi Galbeed", "Sanaag", "Sool", "Togdheer"],
                    name_country_code="SO",
                ),
            },
        ],
    )

    region_checks["africa_western_sahara"] = _evaluate_region_check(
        region_id="africa_western_sahara",
        owner_by_feature_id=owner_by_feature_id,
        topology_blockers=topology_blockers,
        batches=[
            {
                "label": "Western Sahara",
                "expected_owner_tag": "SSH",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_country_codes=["EH"],
                ),
            },
        ],
    )

    region_checks["soviet_core_coverage"] = _evaluate_region_check(
        region_id="soviet_core_coverage",
        owner_by_feature_id=owner_by_feature_id,
        topology_blockers=topology_blockers,
        batches=[
            {
                "label": "Volgograd",
                "expected_owner_tag": "SOV",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_hierarchy_group_ids=["RU_Volgograd"],
                ),
            },
            {
                "label": "Arkhangelsk",
                "expected_owner_tag": "SOV",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_hierarchy_group_ids=["RU_Arkhangelsk"],
                ),
            },
            {
                "label": "Sverdlovsk",
                "expected_owner_tag": "SOV",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_hierarchy_group_ids=["RU_Sverdlovsk"],
                ),
            },
            {
                "label": "Chelyabinsk",
                "expected_owner_tag": "SOV",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_hierarchy_group_ids=["RU_Chelyabinsk"],
                ),
            },
            {
                "label": "Tyumen",
                "expected_owner_tag": "SOV",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_hierarchy_group_ids=["RU_Tyumen"],
                ),
            },
            {
                "label": "Kazakhstan",
                "expected_owner_tag": "SOV",
                "resolved": _resolve_targets(
                    feature_by_id=feature_by_id,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                    name_index=name_index,
                    include_country_codes=["KZ"],
                ),
            },
        ],
    )

    return region_checks, topology_blockers


def _build_belarus_topology_summary(runtime_features: list[object]) -> dict[str, object]:
    belarus_features = [
        feature
        for feature in runtime_features
        if str(getattr(feature, "country_code", "")).strip().upper() == "BY"
    ]
    if not belarus_features:
        return {}

    border_ids = sorted(
        feature.feature_id
        for feature in belarus_features
        if str(getattr(feature, "detail_tier", "")).strip() == "adm2_hybrid_border"
    )
    historical_ids = sorted(
        feature.feature_id
        for feature in belarus_features
        if str(getattr(feature, "detail_tier", "")).strip() == "adm2_hybrid_historical"
    )
    interior_ids = sorted(
        feature.feature_id
        for feature in belarus_features
        if str(getattr(feature, "detail_tier", "")).strip() == "adm2_hybrid_interior"
    )
    admin1_breakdown = Counter(
        str(getattr(feature, "admin1_group", "")).strip()
        for feature in belarus_features
        if str(getattr(feature, "admin1_group", "")).strip()
    )
    return {
        "total_feature_count": len(belarus_features),
        "border_rayons_kept": len(border_ids),
        "historical_composites_built": len(historical_ids),
        "interior_groups_built": len(interior_ids),
        "border_feature_ids": border_ids,
        "historical_feature_ids": historical_ids,
        "interior_feature_ids": interior_ids,
        "admin1_group_breakdown": dict(sorted(admin1_breakdown.items())),
    }


def _append_belarus_topology_blockers(
    topology_blockers: list[dict[str, object]],
    belarus_summary: dict[str, object],
) -> None:
    if not belarus_summary:
        topology_blockers.append(
            {
                "blocker_id": "belarus_hybrid:missing_runtime_features",
                "region_id": "belarus_hybrid",
                "kind": "missing_runtime_features",
                "notes": "Belarus hybrid runtime features were not found in the current topology.",
                "affected_owner_tags": ["POL", "SOV"],
                "affected_feature_ids": [],
            }
        )
        return

    total_count = int(belarus_summary.get("total_feature_count", 0))
    if total_count not in range(35, 38):
        topology_blockers.append(
            {
                "blocker_id": "belarus_hybrid:feature_count",
                "region_id": "belarus_hybrid",
                "kind": "feature_count",
                "notes": f"Belarus hybrid topology expected 35-37 features, found {total_count}.",
                "affected_owner_tags": ["POL", "SOV"],
                "affected_feature_ids": [],
            }
        )

    required_feature_ids = {
        "BY_CITY_MINSK",
        "BY_INT_BREST",
        "BY_INT_GOMEL",
        "BY_INT_GRODNO",
        "BY_INT_MINSK",
        "BY_INT_MOGILEV",
        "BY_INT_VITEBSK",
        "BY_HIST_POL_MINSK_WEST",
        "BY_HIST_POL_VITEBSK_WEST",
    }
    present_feature_ids = (
        set(belarus_summary.get("border_feature_ids", []))
        | set(belarus_summary.get("historical_feature_ids", []))
        | set(belarus_summary.get("interior_feature_ids", []))
    )
    missing_feature_ids = sorted(required_feature_ids - present_feature_ids)
    if missing_feature_ids:
        topology_blockers.append(
            {
                "blocker_id": "belarus_hybrid:required_features",
                "region_id": "belarus_hybrid",
                "kind": "required_features",
                "notes": "Belarus hybrid topology is missing required features: "
                + ", ".join(missing_feature_ids),
                "affected_owner_tags": ["POL", "SOV"],
                "affected_feature_ids": missing_feature_ids,
            }
        )


def _build_scenario_rule_blockers(
    *,
    diagnostics: dict[str, object],
    countries: dict[str, object],
    rules: list[object],
    critical_unresolved_count: int,
    enforce_scenario_extensions: bool = True,
) -> list[dict[str, object]]:
    blockers: list[dict[str, object]] = []

    empty_rules = sorted({str(rule_id).strip() for rule_id in diagnostics.get("empty_rules", []) if str(rule_id).strip()})
    if empty_rules:
        blockers.append(
            {
                "blocker_id": "empty_rules",
                "kind": "empty_rules",
                "notes": f"These rules did not select any runtime features: {', '.join(empty_rules)}.",
                "affected_owner_tags": [],
                "affected_feature_ids": [],
            }
        )

    missing_rule_groups = sorted(
        {str(entry).strip() for entry in diagnostics.get("missing_rule_groups", []) if str(entry).strip()}
    )
    if missing_rule_groups:
        blockers.append(
            {
                "blocker_id": "missing_rule_groups",
                "kind": "missing_rule_groups",
                "notes": f"These rule/group references were missing from hierarchy data: {', '.join(missing_rule_groups)}.",
                "affected_owner_tags": [],
                "affected_feature_ids": [],
            }
        )

    missing_rule_feature_ids = sorted(
        {str(entry).strip() for entry in diagnostics.get("missing_rule_feature_ids", []) if str(entry).strip()}
    )
    if missing_rule_feature_ids:
        blockers.append(
            {
                "blocker_id": "missing_rule_feature_ids",
                "kind": "missing_rule_feature_ids",
                "notes": f"These direct feature references were missing from runtime topology: {', '.join(missing_rule_feature_ids)}.",
                "affected_owner_tags": [],
                "affected_feature_ids": [],
            }
        )

    if enforce_scenario_extensions:
        scenario_extension_tags = {
            str(rule.owner_tag).strip().upper()
            for rule in rules
            if getattr(rule, "source_type", "") == "scenario_extension"
        }
        for tag in sorted(scenario_extension_tags):
            record = countries.get(tag)
            if not record:
                blockers.append(
                    {
                        "blocker_id": f"missing_scenario_extension:{tag}",
                        "kind": "missing_scenario_extension_country",
                        "notes": f"Scenario extension `{tag}` does not appear in the final country registry.",
                        "affected_owner_tags": [tag],
                        "affected_feature_ids": [],
                    }
                )
                continue
            if not record.display_name or not record.color_hex or record.feature_count <= 0:
                blockers.append(
                    {
                        "blocker_id": f"incomplete_scenario_extension:{tag}",
                        "kind": "incomplete_scenario_extension_country",
                        "notes": (
                            f"Scenario extension `{tag}` is missing required metadata "
                            f"(name/color/feature_count={record.feature_count})."
                        ),
                        "affected_owner_tags": [tag],
                        "affected_feature_ids": [],
                    }
                )

    if critical_unresolved_count > 0:
        blockers.append(
            {
                "blocker_id": "critical_unresolved_assignments",
                "kind": "critical_unresolved_assignments",
                "notes": (
                    f"{critical_unresolved_count} critical features remain below `manual_reviewed`/`direct_country_copy` quality."
                ),
                "affected_owner_tags": [],
                "affected_feature_ids": [],
            }
        )

    return blockers


def _select_rule_target_ids(
    *,
    rule,
    feature_by_id: dict[str, object],
    ids_by_country: dict[str, set[str]],
    ids_by_group: dict[str, set[str]],
) -> set[str]:
    selected: set[str] = set()
    for code in getattr(rule, "include_country_codes", []) or []:
        selected.update(ids_by_country.get(code, set()))
    for group_id in getattr(rule, "include_hierarchy_group_ids", []) or []:
        selected.update(ids_by_group.get(group_id, set()))
    for feature_id in getattr(rule, "include_feature_ids", []) or []:
        if feature_id in feature_by_id:
            selected.add(feature_id)

    excluded: set[str] = set()
    for code in getattr(rule, "exclude_country_codes", []) or []:
        excluded.update(ids_by_country.get(code, set()))
    for group_id in getattr(rule, "exclude_hierarchy_group_ids", []) or []:
        excluded.update(ids_by_group.get(group_id, set()))
    for feature_id in getattr(rule, "exclude_feature_ids", []) or []:
        if feature_id:
            excluded.add(feature_id)

    return {feature_id for feature_id in selected if feature_id in feature_by_id and feature_id not in excluded}


def _build_controller_assignments(
    *,
    runtime_features: list[object],
    hierarchy_groups: dict[str, list[str]],
    owner_assignments: dict[str, str],
    controller_rules: list[object],
) -> tuple[dict[str, str], dict[str, list[str]]]:
    controller_assignments = {feature.feature_id: owner_assignments.get(feature.feature_id, "") for feature in runtime_features}
    feature_by_id, ids_by_country, ids_by_group = build_feature_indexes(runtime_features, hierarchy_groups)
    diagnostics: dict[str, list[str]] = defaultdict(list)

    for rule in sorted(controller_rules, key=lambda item: (item.priority, item.rule_id)):
        missing_groups = [
            group_id
            for group_id in rule.include_hierarchy_group_ids + rule.exclude_hierarchy_group_ids
            if group_id and group_id not in ids_by_group
        ]
        if missing_groups:
            diagnostics["missing_rule_groups"].extend(
                f"{rule.rule_id}:{group_id}" for group_id in sorted(set(missing_groups))
            )
        missing_feature_ids = [
            feature_id
            for feature_id in rule.include_feature_ids + rule.exclude_feature_ids
            if feature_id and feature_id not in feature_by_id
        ]
        if missing_feature_ids:
            diagnostics["missing_rule_feature_ids"].extend(
                f"{rule.rule_id}:{feature_id}" for feature_id in sorted(set(missing_feature_ids))
            )
        target_ids = _select_rule_target_ids(
            rule=rule,
            feature_by_id=feature_by_id,
            ids_by_country=ids_by_country,
            ids_by_group=ids_by_group,
        )
        if not target_ids:
            diagnostics["empty_rules"].append(rule.rule_id)
            continue
        for feature_id in target_ids:
            controller_assignments[feature_id] = str(rule.owner_tag).strip().upper()

    controller_assignments = {feature_id: owner_tag for feature_id, owner_tag in controller_assignments.items() if owner_tag}
    return controller_assignments, diagnostics


def compile_scenario_bundle(
    *,
    scenario_id: str,
    display_name: str,
    bookmark,
    runtime_features,
    runtime_country_names,
    hierarchy_groups,
    country_meta_by_iso2,
    rules,
    states_by_id,
    country_histories,
    palette_pack,
    palette_map,
    diagnostics,
    controller_rules: list[object] | None = None,
) -> dict[str, object]:
    iso2_to_tag = build_iso2_to_mapped_tag(palette_map)
    active_owner_tags = build_active_owner_tags(states_by_id)
    active_controller_tags = build_active_controller_tags(states_by_id)
    controller_rules = list(controller_rules or [])
    assignments, crosswalk_diagnostics = assign_feature_owners(
        runtime_features=runtime_features,
        hierarchy_groups=hierarchy_groups,
        rules=rules,
        iso2_to_tag=iso2_to_tag,
        active_owner_tags=active_owner_tags,
    )
    diagnostics = {
        **diagnostics,
        **crosswalk_diagnostics,
        "active_owner_tag_count": len(active_owner_tags),
        "active_controller_tag_count": len(active_controller_tags),
    }

    rule_lookup_by_owner: defaultdict[str, list] = defaultdict(list)
    for rule in rules:
        rule_lookup_by_owner[rule.owner_tag].append(rule)

    countries = build_country_registry(
        assignments=assignments,
        runtime_features=runtime_features,
        bookmark=bookmark,
        palette_pack=palette_pack,
        iso2_to_tag=iso2_to_tag,
        country_histories=country_histories,
        country_meta_by_iso2=country_meta_by_iso2,
        rule_lookup=rule_lookup_by_owner,
        runtime_country_names=runtime_country_names,
        active_owner_tags=active_owner_tags,
    )

    owners_only = {
        feature.feature_id: assignments[feature.feature_id].owner_tag
        for feature in runtime_features
        if feature.feature_id in assignments
    }
    baseline_hash = _stable_json_hash(owners_only)

    owners_payload = {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "baseline_hash": baseline_hash,
        "owners": owners_only,
    }

    cores_payload = {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "baseline_hash": baseline_hash,
        "cores": {
            feature.feature_id: [assignments[feature.feature_id].owner_tag]
            for feature in runtime_features
            if feature.feature_id in assignments
        },
    }

    controllers_only, controller_rule_diagnostics = _build_controller_assignments(
        runtime_features=runtime_features,
        hierarchy_groups=hierarchy_groups,
        owner_assignments=owners_only,
        controller_rules=controller_rules,
    )
    diagnostics["controller_rule_diagnostics"] = controller_rule_diagnostics
    controller_baseline_hash = _stable_json_hash(controllers_only)
    controllers_payload = {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "baseline_hash": controller_baseline_hash,
        "owner_baseline_hash": baseline_hash,
        "controllers": controllers_only,
    }
    owner_controller_split_feature_count = sum(
        1
        for feature_id, owner_tag in owners_only.items()
        if controllers_only.get(feature_id, owner_tag) != owner_tag
    )

    quality_counts = Counter(assignment.quality for assignment in assignments.values())
    source_counts = Counter(assignment.source for assignment in assignments.values())
    owner_feature_counts = Counter(assignment.owner_tag for assignment in assignments.values())
    synthetic_owner_count = sum(1 for assignment in assignments.values() if assignment.synthetic_owner)

    feature_changes = []
    for feature in runtime_features:
        assignment = assignments.get(feature.feature_id)
        if not assignment:
            continue
        direct_tag = iso2_to_tag.get(feature.country_code, "")
        if assignment.owner_tag == direct_tag and assignment.source == "direct_active_owner":
            continue
        feature_changes.append(
            {
                "feature_id": feature.feature_id,
                "country_code": feature.country_code,
                "feature_name": feature.name,
                "from_tag": direct_tag,
                "to_tag": assignment.owner_tag,
                "quality": assignment.quality,
                "source": assignment.source,
                "rule_id": assignment.rule_id,
                "critical": assignment.critical,
                "notes": assignment.notes,
                "synthetic_owner": assignment.synthetic_owner,
            }
        )

    controller_changes = []
    for feature in runtime_features:
        owner_tag = owners_only.get(feature.feature_id, "")
        controller_tag = controllers_only.get(feature.feature_id, owner_tag)
        if not owner_tag or controller_tag == owner_tag:
            continue
        controller_changes.append(
            {
                "feature_id": feature.feature_id,
                "feature_name": feature.name,
                "country_code": feature.country_code,
                "owner_tag": owner_tag,
                "controller_tag": controller_tag,
            }
        )

    quality_by_owner: defaultdict[str, Counter[str]] = defaultdict(Counter)
    for assignment in assignments.values():
        quality_by_owner[assignment.owner_tag][assignment.quality] += 1

    owner_stats = {}
    for tag, record in countries.items():
        owner_stats[tag] = {
            "display_name": record.display_name,
            "feature_count": record.feature_count,
            "quality": record.quality,
            "quality_breakdown": dict(sorted(quality_by_owner[tag].items())),
            "base_iso2": record.base_iso2,
            "lookup_iso2": record.lookup_iso2,
            "provenance_iso2": record.provenance_iso2,
            "scenario_only": record.scenario_only,
            "synthetic_owner": record.synthetic_owner,
            "continent_label": record.continent_label,
            "subregion_label": record.subregion_label,
            "source_type": record.source_type,
            "historical_fidelity": record.historical_fidelity,
            "primary_rule_source": record.primary_rule_source,
            "rule_sources": record.rule_sources,
            "source_types": record.source_types,
            "historical_fidelity_summary": record.historical_fidelity_summary,
            "parent_owner_tag": record.parent_owner_tag,
            "parent_owner_tags": record.parent_owner_tags,
            "subject_kind": record.subject_kind,
            "entry_kind": record.entry_kind,
        }

    countries_payload = {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "default_country": bookmark.default_country,
        "countries": {
            tag: {
                "tag": record.tag,
                "display_name": record.display_name,
                "color_hex": record.color_hex,
                "feature_count": record.feature_count,
                "quality": record.quality,
                "source": record.source,
                "base_iso2": record.base_iso2,
                "lookup_iso2": record.lookup_iso2,
                "provenance_iso2": record.provenance_iso2,
                "scenario_only": record.scenario_only,
                "featured": record.featured,
                "capital_state_id": record.capital_state_id,
                "continent_id": record.continent_id,
                "continent_label": record.continent_label,
                "subregion_id": record.subregion_id,
                "subregion_label": record.subregion_label,
                "notes": record.notes,
                "synthetic_owner": record.synthetic_owner,
                "source_type": record.source_type,
                "historical_fidelity": record.historical_fidelity,
                "primary_rule_source": record.primary_rule_source,
                "rule_sources": record.rule_sources,
                "source_types": record.source_types,
                "historical_fidelity_summary": record.historical_fidelity_summary,
                "parent_owner_tag": record.parent_owner_tag,
                "parent_owner_tags": record.parent_owner_tags,
                "subject_kind": record.subject_kind,
                "entry_kind": record.entry_kind,
            }
            for tag, record in sorted(countries.items())
        },
    }

    enable_region_checks = bool(diagnostics.get("enable_region_checks", scenario_id == "hoi4_1936"))
    if enable_region_checks:
        region_checks, topology_blockers = _evaluate_region_checks(
            runtime_features=runtime_features,
            hierarchy_groups=hierarchy_groups,
            assignments=assignments,
        )
        belarus_topology_summary = _build_belarus_topology_summary(runtime_features)
        _append_belarus_topology_blockers(topology_blockers, belarus_topology_summary)
    else:
        region_checks = {}
        topology_blockers = []
        belarus_topology_summary = {}

    critical_unresolved_count = sum(
        1
        for item in feature_changes
        if item["critical"] and item["quality"] not in {"manual_reviewed", "direct_country_copy"}
    )
    scenario_rule_blockers = _build_scenario_rule_blockers(
        diagnostics=diagnostics,
        countries=countries,
        rules=rules,
        critical_unresolved_count=critical_unresolved_count,
        enforce_scenario_extensions=bool(
            diagnostics.get("enforce_scenario_extensions", scenario_id == "hoi4_1936")
        ),
    )
    failed_region_check_count = sum(
        1 for check in region_checks.values() if str(check.get("status") or "") == "fail"
    )

    summary = {
        "feature_count": len(assignments),
        "owner_count": len(owner_feature_counts),
        "controller_count": len({value for value in controllers_only.values() if value}),
        "quality_counts": dict(sorted(quality_counts.items())),
        "source_counts": dict(sorted(source_counts.items())),
        "approximate_count": quality_counts.get("approx_existing_geometry", 0),
        "manual_reviewed_feature_count": quality_counts.get("manual_reviewed", 0),
        "geometry_blocker_count": quality_counts.get("geometry_blocker", 0),
        "critical_unresolved_count": critical_unresolved_count,
        "synthetic_owner_feature_count": synthetic_owner_count,
        "synthetic_count": synthetic_owner_count,
        "changed_feature_count": len(feature_changes),
        "failed_region_check_count": failed_region_check_count,
        "topology_blocker_count": len(topology_blockers),
        "scenario_rule_blocker_count": len(scenario_rule_blockers),
        "blocker_count": quality_counts.get("geometry_blocker", 0) + len(topology_blockers) + len(scenario_rule_blockers),
        "owner_controller_split_feature_count": owner_controller_split_feature_count,
        "controller_rule_count": len(controller_rules),
        "critical_region_check_count": len(region_checks),
        "manual_reviewed_region_count": len(region_checks),
        "belarus_hybrid_feature_count": int(belarus_topology_summary.get("total_feature_count", 0)),
    }

    critical_regions = [
        {
            "region_id": region_id,
            "status": (
                "skipped"
                if not enable_region_checks
                else region_checks.get(region_id, {}).get("status", "fail")
            ),
        }
        for region_id in CRITICAL_REGION_IDS
    ]

    audit_payload = {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "diagnostics": diagnostics,
        "critical_regions": critical_regions,
        "region_checks": region_checks,
        "topology_blockers": topology_blockers,
        "scenario_rule_blockers": scenario_rule_blockers,
        "topology_summaries": {
            "belarus_hybrid": belarus_topology_summary,
        },
        "owner_stats": owner_stats,
        "feature_changes": feature_changes,
        "controller_changes": controller_changes,
    }

    manifest_payload = {
        "version": 1,
        "scenario_id": scenario_id,
        "display_name": display_name,
        "bookmark_name": bookmark.name,
        "bookmark_description": bookmark.description,
        "bookmark_date": bookmark.date,
        "default_country": bookmark.default_country,
        "featured_tags": bookmark.featured_tags,
        "palette_id": "hoi4_vanilla",
        "baseline_hash": baseline_hash,
        "countries_url": f"data/scenarios/{scenario_id}/countries.json",
        "owners_url": f"data/scenarios/{scenario_id}/owners.by_feature.json",
        "controllers_url": f"data/scenarios/{scenario_id}/controllers.by_feature.json",
        "cores_url": f"data/scenarios/{scenario_id}/cores.by_feature.json",
        "audit_url": f"data/scenarios/{scenario_id}/audit.json",
        "summary": summary,
    }

    failure_reasons: list[str] = []
    enforce_region_checks = bool(diagnostics.get("enforce_region_checks", scenario_id == "hoi4_1936"))
    if failed_region_check_count > 0 and enforce_region_checks:
        failed_regions = [
            region_id
            for region_id, check in region_checks.items()
            if str(check.get("status") or "") == "fail"
        ]
        failure_reasons.append(
            f"critical region checks failed: {', '.join(sorted(failed_regions))}"
        )
    if scenario_rule_blockers:
        failure_reasons.append(
            f"scenario rule blockers present: {', '.join(blocker['blocker_id'] for blocker in scenario_rule_blockers)}"
        )
    if topology_blockers:
        failure_reasons.append(
            f"topology blockers present: {', '.join(blocker['blocker_id'] for blocker in topology_blockers)}"
        )
    if quality_counts.get("geometry_blocker", 0) > 0:
        failure_reasons.append("geometry_blocker assignments remain in compiled ownership.")

    if failure_reasons:
        raise ValueError("Scenario build failed: " + " | ".join(failure_reasons))

    return {
        "manifest": manifest_payload,
        "countries": countries_payload,
        "owners": owners_payload,
        "controllers": controllers_payload,
        "cores": cores_payload,
        "audit": audit_payload,
        "baseline_hash": baseline_hash,
    }
