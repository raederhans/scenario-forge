#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import warnings

import geopandas as gpd
import pandas as pd
from shapely.geometry import shape
from shapely.validation import make_valid

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scenario_builder.hoi4.parser import load_hierarchy_groups, load_runtime_features  # noqa: E402


DEFAULT_SPEC_PATH = PROJECT_ROOT / "data/releasables/hoi4_reichskommissariat_boundaries.internal.json"
DEFAULT_TOPOLOGY_PATH = PROJECT_ROOT / "data/europe_topology.runtime_political_v1.json"
DEFAULT_HIERARCHY_PATH = PROJECT_ROOT / "data/hierarchy.json"
DEFAULT_REPORTS_DIR = PROJECT_ROOT / "reports/generated/releasables"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rewrite Reichskommissariat boundary variants as explicit feature masks and export review artifacts."
    )
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC_PATH)
    parser.add_argument("--runtime-topology", type=Path, default=DEFAULT_TOPOLOGY_PATH)
    parser.add_argument("--hierarchy", type=Path, default=DEFAULT_HIERARCHY_PATH)
    parser.add_argument("--reports-dir", type=Path, default=DEFAULT_REPORTS_DIR)
    parser.add_argument("--check-only", action="store_true")
    return parser.parse_args()


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalize_tag(raw: object) -> str:
    return "".join(char for char in str(raw or "").strip().upper() if char.isalnum())


def topology_to_gdf(path: Path) -> gpd.GeoDataFrame:
    topo_dict = load_json(path)
    arcs_raw = topo_dict.get("arcs", [])
    transform = topo_dict.get("transform")
    decoded_arcs: list[list[tuple[float, float]]] = []
    for arc in arcs_raw:
        coords: list[tuple[float, float]] = []
        x = 0.0
        y = 0.0
        for point in arc:
            if len(point) < 2:
                continue
            x += point[0]
            y += point[1]
            if transform:
                sx, sy = transform.get("scale", [1.0, 1.0])
                tx, ty = transform.get("translate", [0.0, 0.0])
                coords.append((x * sx + tx, y * sy + ty))
            else:
                coords.append((x, y))
        decoded_arcs.append(coords)

    def decode_arc_ref(ref: int) -> list[tuple[float, float]]:
        if ref < 0:
            return list(reversed(decoded_arcs[~ref]))
        return decoded_arcs[ref]

    def decode_ring(ring_refs: list[int]) -> list[tuple[float, float]]:
        coords: list[tuple[float, float]] = []
        for ref in ring_refs:
            arc_coords = decode_arc_ref(ref)
            if coords:
                coords.extend(arc_coords[1:])
            else:
                coords.extend(arc_coords)
        return coords

    def sanitize_ring(coords: list[tuple[float, float]]) -> list[tuple[float, float]]:
        if len(coords) < 3:
            return []
        if coords[0] != coords[-1]:
            coords = [*coords, coords[0]]
        if len(coords) < 4:
            return []
        return coords

    def decode_geometry(geom: dict[str, object]) -> dict[str, object] | None:
        gtype = str(geom.get("type") or "")
        arcs = geom.get("arcs", [])
        if gtype == "Polygon":
            rings = [sanitize_ring(decode_ring(ring)) for ring in arcs]
            rings = [ring for ring in rings if ring]
            if not rings:
                return None
            return {"type": "Polygon", "coordinates": rings}
        if gtype == "MultiPolygon":
            polygons = []
            for polygon_arcs in arcs:
                rings = [sanitize_ring(decode_ring(ring)) for ring in polygon_arcs]
                rings = [ring for ring in rings if ring]
                if rings:
                    polygons.append(rings)
            if not polygons:
                return None
            return {
                "type": "MultiPolygon",
                "coordinates": polygons,
            }
        if gtype == "LineString":
            return {"type": "LineString", "coordinates": decode_ring(arcs)}
        if gtype == "MultiLineString":
            return {"type": "MultiLineString", "coordinates": [decode_ring(line) for line in arcs]}
        if gtype == "Point":
            coords = geom.get("coordinates", [0, 0])
            if transform:
                sx, sy = transform.get("scale", [1.0, 1.0])
                tx, ty = transform.get("translate", [0.0, 0.0])
                coords = [coords[0] * sx + tx, coords[1] * sy + ty]
            return {"type": "Point", "coordinates": coords}
        return None

    geometries = topo_dict.get("objects", {}).get("political", {}).get("geometries", [])
    features: list[dict[str, object]] = []
    for geom in geometries:
        decoded = decode_geometry(geom)
        if not decoded:
            continue
        shapely_geom = shape(decoded)
        if shapely_geom.is_empty:
            continue
        props = geom.get("properties", {}) or {}
        features.append(
            {
                "id": str(props.get("id") or geom.get("id") or "").strip(),
                "name": str(props.get("name") or "").strip(),
                "cntr_code": str(props.get("cntr_code") or "").strip(),
                "geometry": shapely_geom,
            }
        )
    gdf = gpd.GeoDataFrame(features, geometry="geometry", crs="EPSG:4326")
    gdf["geometry"] = gdf.geometry.map(lambda geom: make_valid(geom) if geom is not None and not geom.is_valid else geom)
    gdf["geometry"] = gdf.geometry.map(lambda geom: geom.buffer(0) if geom is not None and not geom.is_empty else geom)
    return gdf


def build_indexes(runtime_features: list[object], hierarchy_groups: dict[str, list[str]]) -> dict[str, object]:
    feature_ids_by_country: dict[str, set[str]] = {}
    feature_name_by_id: dict[str, str] = {}
    country_by_feature_id: dict[str, str] = {}
    group_ids_by_feature_id: dict[str, set[str]] = {}
    all_feature_ids: set[str] = set()

    for group_id, feature_ids in hierarchy_groups.items():
        for feature_id in feature_ids:
            group_ids_by_feature_id.setdefault(str(feature_id), set()).add(str(group_id))

    for feature in runtime_features:
        feature_id = str(getattr(feature, "feature_id", "") or "").strip()
        if not feature_id:
            continue
        country_code = str(getattr(feature, "country_code", "") or "").strip().upper()
        feature_name = str(getattr(feature, "name", "") or "").strip()
        all_feature_ids.add(feature_id)
        feature_name_by_id[feature_id] = feature_name
        country_by_feature_id[feature_id] = country_code
        if country_code:
            feature_ids_by_country.setdefault(country_code, set()).add(feature_id)

    return {
        "all_feature_ids": all_feature_ids,
        "feature_ids_by_country": feature_ids_by_country,
        "feature_name_by_id": feature_name_by_id,
        "country_by_feature_id": country_by_feature_id,
        "group_ids_by_feature_id": group_ids_by_feature_id,
    }


def sorted_ids(values: set[str] | list[str]) -> list[str]:
    return sorted({str(value).strip() for value in values if str(value).strip()})


class FeatureUniverse:
    def __init__(self, hierarchy_groups: dict[str, list[str]], indexes: dict[str, object]) -> None:
        self.hierarchy_groups = hierarchy_groups
        self.feature_ids_by_country = indexes["feature_ids_by_country"]
        self.feature_name_by_id = indexes["feature_name_by_id"]

    def expand_groups(self, *group_ids: str) -> set[str]:
        selected: set[str] = set()
        for group_id in group_ids:
            selected.update(str(feature_id).strip() for feature_id in self.hierarchy_groups.get(group_id, []) if str(feature_id).strip())
        return selected

    def by_country(self, *country_codes: str) -> set[str]:
        selected: set[str] = set()
        for country_code in country_codes:
            selected.update(self.feature_ids_by_country.get(str(country_code).strip().upper(), set()))
        return selected

    def pick_names(self, group_id: str, names: set[str]) -> set[str]:
        return {
            feature_id
            for feature_id in self.hierarchy_groups.get(group_id, [])
            if self.feature_name_by_id.get(str(feature_id).strip(), "") in names
        }


def select_ru_arctic_island_ids(topology_gdf: gpd.GeoDataFrame) -> set[str]:
    if topology_gdf.empty:
        return set()

    ru = topology_gdf[topology_gdf["cntr_code"].astype(str) == "RU"].copy()
    if ru.empty:
        return set()

    ru["id"] = ru["id"].astype(str)
    ru["name"] = ru["name"].astype(str)
    ru["is_shell"] = ru["id"].str.contains("_FB_", na=False) | ru["name"].str.contains("shell fallback", case=False, na=False)
    bounds = ru.geometry.bounds
    ru["miny"] = bounds["miny"]
    ru["maxy"] = bounds["maxy"]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        ru["area"] = ru.geometry.area

    selected: set[str] = set()
    shell_candidates = ru[(ru["is_shell"]) & (ru["maxy"] >= 70.0) & (ru["miny"] >= 69.9)]
    selected.update(shell_candidates["id"].tolist())

    non_shell = ru[~ru["is_shell"]].copy()
    isolated_candidates = non_shell[(non_shell["maxy"] >= 66.5) & (non_shell["area"] <= 20.0)]
    for _, row in isolated_candidates.iterrows():
        others = non_shell[non_shell["id"] != row["id"]]
        if others.empty:
            continue
        if others.geometry.intersects(row.geometry.buffer(1e-6)).any():
            continue
        selected.add(str(row["id"]))

    return selected


def build_target_masks(universe: FeatureUniverse, *, topology_gdf: gpd.GeoDataFrame) -> dict[str, dict[str, object]]:
    annexed_masovian_ids = {
        "PL_POW_1402",  # ciechanowski
        "PL_POW_1404",  # gostyniński
        "PL_POW_1411",  # makowski
        "PL_POW_1413",  # mławski
        "PL_POW_1415",  # ostrołęcki
        "PL_POW_1416",  # ostrowski
        "PL_POW_1419",  # płocki
        "PL_POW_1420",  # płoński
        "PL_POW_1422",  # przasnyski
        "PL_POW_1424",  # pułtuski
        "PL_POW_1427",  # sierpecki
        "PL_POW_1437",  # żuromiński
        "PL_POW_1461",  # Ostrołęka
        "PL_POW_1462",  # Płock
    }
    gg_lodz_reference_ids = {
        "PL_POW_1005",  # łowicki
        "PL_POW_1006",  # łódzki wschodni
        "PL_POW_1007",  # opoczyński
        "PL_POW_1010",  # piotrkowski
        "PL_POW_1012",  # radomszczański
        "PL_POW_1013",  # rawski
        "PL_POW_1015",  # skierniewicki
        "PL_POW_1016",  # tomaszowski
        "PL_POW_1021",  # brzeziński
        "PL_POW_1062",  # Piotrków Trybunalski
        "PL_POW_1063",  # Skierniewice
    }
    gg_upper_silesian_reference_ids = {
        "PL_POW_2404",  # częstochowski
        "PL_POW_2409",  # myszkowski
        "PL_POW_2416",  # zawierciański
        "PL_POW_2464",  # Częstochowa
        "PL_POW_2465",  # Dąbrowa Górnicza
    }
    annexed_bialystok_ids = universe.expand_groups("PL_Podlaskie")
    southern_galicia_ids = {
        "UA_RAY_74538382B88125912704040",  # Drohobych
        "UA_RAY_74538382B27410242056643",  # Sambir
        "UA_RAY_74538382B78037249212092",  # Staryi Sambir
        "UA_RAY_74538382B24886275593146",  # Stryi
        "UA_RAY_74538382B82550284733464",  # Kalush
        "UA_RAY_74538382B92026031653361",  # Kolomyia
        "UA_RAY_74538382B11484774081003",  # Borschiv
        "UA_RAY_74538382B43402639614828",  # Chortkiv
    }

    rkp_hoi4 = (
        universe.expand_groups("PL_Masovian")
        - annexed_masovian_ids
        | universe.expand_groups(
            "PL_Holy_Cross",
            "PL_Lublin",
            "PL_Lesser_Poland",
            "PL_Subcarpathian",
            "UA_Lviv",
            "UA_Ternopil",
        )
    )
    rkp_historical = (
        rkp_hoi4
        | gg_lodz_reference_ids
        | gg_upper_silesian_reference_ids
        | universe.expand_groups("UA_Ivano_Frankivsk")
        | southern_galicia_ids
    )
    annexed_poland_to_ger = (
        universe.expand_groups("PL_Greater_Poland", "PL_Pomeranian", "PL_Kuyavian_Pomeranian")
        | (universe.expand_groups("PL_Lodz") - gg_lodz_reference_ids)
        | (universe.expand_groups("PL_Silesian") - gg_upper_silesian_reference_ids)
        | annexed_masovian_ids
        | annexed_bialystok_ids
        | {"CZ_ADM2_57006924B63031935780571"}  # Karviná
    )

    all_belarus_ids = universe.expand_groups(
        "BY_Brest",
        "BY_Minsk",
        "BY_City_of_Minsk",
        "BY_Grodno",
        "BY_Vitebsk",
        "BY_Gomel",
        "BY_Mogilev",
    )
    ostland_to_moskowien_belarus_ids = {
        "BY_RAY_67162791B11584975294724",  # Khotsimsk
        "BY_RAY_67162791B14569635979911",  # Kastsyukovichy
        "BY_RAY_67162791B52564132020414",  # Krasnapolle
        "BY_RAY_67162791B58533541453403",  # Klimavichy
    }
    rko_hoi4 = (
        (universe.by_country("EE", "LV", "LT") - {"LT024"})
        | universe.expand_groups("RU_Pskov")
        | (all_belarus_ids - ostland_to_moskowien_belarus_ids)
    )
    rko_historical = rko_hoi4

    rku_historical = universe.expand_groups(
        "UA_Volyn",
        "UA_Rivne",
        "UA_Zhytomyr",
        "UA_Khmelnytskyi",
        "UA_Vinnytsia",
        "UA_Kyiv",
        "UA_Cherkasy",
        "UA_Mykolaiv",
        "UA_Kherson",
        "UA_Dnipropetrovsk",
        "UA_Kirovohrad",
        "UA_Chernihiv",
        "UA_Kharkiv",
        "UA_Donetsk",
        "UA_Luhansk",
        "UA_Zaporizhzhia",
        "UA_Sumy",
        "UA_Poltava",
        "RU_Belgorod",
    )
    transnistria_to_rom = universe.expand_groups("UA_Odessa")
    crimea_to_ger = {
        "UA_RAY_74538382B10810755627981",  # Sovietsky
        "UA_RAY_74538382B12626856106214",  # Krasnoperekopsk
        "UA_RAY_74538382B17328028725822",  # Chornomorske
        "UA_RAY_74538382B18343308961646",  # Gagarin
        "UA_RAY_74538382B24072865224387",  # Rozdolne
        "UA_RAY_74538382B30799636343123",  # Leninskyi
        "UA_RAY_74538382B31597126471541",  # Bilohirsk
        "UA_RAY_74538382B3276437105714",  # Nakhimovskyi
        "UA_RAY_74538382B47758211773177",  # Saky
        "UA_RAY_74538382B52948461958272",  # Balakavaskyi
        "UA_RAY_74538382B62014959099240",  # Pervomaiske
        "UA_RAY_74538382B73102854459711",  # Krasnohvardiiske
        "UA_RAY_74538382B78065593112494",  # Dzhankoy
        "UA_RAY_74538382B80563569865238",  # Nyzhniohirskyi
        "UA_RAY_74538382B84040377374615",  # Simferopol
        "UA_RAY_74538382B84610439401970",  # Bakhchysarai
        "UA_RAY_74538382B85800934600856",  # Kirovske
        "UA_RAY_74538382B91806639169097",  # Lenine
    }

    rkm_explicit_extension_ids = {
        "RU_RAY_50074027B76249175703521",  # Udorsky District
        "RU_RAY_50074027B85030315682895",  # Yurinsky District
        "RU_RAY_50074027B54726203316693",  # Gornomariysky District
        "RU_RAY_50074027B31803957515687",  # Kilemarsky District
        "RU_RAY_50074027B36238165021619",  # Shabalinsky District
        "RU_RAY_50074027B45607076105456",  # Drozhzhanovsky District
        "RU_RAY_50074027B24067170808668",  # Buinsky District
        "RU_RAY_50074027B72528113691224",  # Kaybitsky District
        "RU_RAY_50074027B96608863545801",  # Apastovsky District
        "RU_RAY_50074027B47970821426630",  # Tetyushsky District
        "RU_RAY_50074027B23450993160232",  # Spassky District
        "RU_RAY_50074027B24015802345746",  # Spassky District
        "RU_RAY_50074027B87542455562769",  # Spassky District
        "RU_RAY_50074027B91359365494051",  # Spassky District
    }

    rkm_historical = (
        universe.expand_groups(
            "RU_Arkhangelsk",
            "RU_Vologda",
            "RU_Leningrad",
            "RU_Saint_Petersburg",
            "RU_Novgorod",
            "RU_Tver",
            "RU_Smolensk",
            "RU_Bryansk",
            "RU_Moscow",
            "RU_Kaluga",
            "RU_Tula",
            "RU_Oryol",
            "RU_Kursk",
            "RU_Voronezh",
            "RU_Lipetsk",
            "RU_Volgograd",
            "RU_Yaroslavl",
            "RU_Ivanovo",
            "RU_Ryazan",
            "RU_Vladimir",
            "RU_Nizhny_Novgorod",
            "RU_Penza",
            "RU_Tambov",
            "RU_Kostroma",
            "RU_Republic_of_Mordovia",
            "RU_Chuvash_Republic",
            "RU_Samara",
            "RU_Republic_of_Kalmykia",
            "RU_Astrakhan",
            "RU_Saratov",
            "RU_Ulyanovsk",
            "RU_Rostov",
        )
        | ostland_to_moskowien_belarus_ids
        | rkm_explicit_extension_ids
    ) - {
        "RU_RAY_50074027B21430544456221",  # Taganrog
    }
    greater_finland_to_fin = (
        universe.expand_groups("RU_Karelia", "RU_Murmansk")
        | universe.pick_names("RU_Leningrad", {"Vyborgsky District", "Käkisalmi District"})
    )
    arctic_islands_to_ger = select_ru_arctic_island_ids(topology_gdf)

    return {
        "RKP": {
            "notes": (
                "Feature-first Generalgouvernement masks. The historical reference footprint is the only exposed"
                " RKP boundary, and the German annexation belt is handled as a separate ownership transfer."
            ),
            "default_boundary_variant_id": "historical_reference",
            "boundary_variants": [
                {
                    "id": "historical_reference",
                    "label": "Historical",
                    "description": "Reference-map Generalgouvernement footprint using explicit feature masks.",
                    "basis": "historical_reference",
                    "include_feature_ids": sorted_ids(rkp_historical),
                },
            ],
            "companion_actions": [
                {
                    "id": "annexed_poland_to_ger",
                    "label": "Apply German-Annexed Polish Provinces",
                    "description": "Transfers the historically annexed Polish belt to Germany using explicit feature masks.",
                    "basis": "historical_reference",
                    "action_type": "ownership_transfer",
                    "target_owner_tag": "GER",
                    "auto_apply_on_core_territory": True,
                    "hidden_in_ui": True,
                    "include_feature_ids": sorted_ids(annexed_poland_to_ger),
                }
            ],
        },
        "RKO": {
            "notes": (
                "Feature-first Ostland masks. Warmia-Masuria stays with Germany, the Belarus footprint is resolved"
                " explicitly into Ostland, and Marijampole is auto-transferred to Germany when Ostland core"
                " territory is applied."
            ),
            "default_boundary_variant_id": "hoi4",
            "boundary_variants": [
                {
                    "id": "hoi4",
                    "label": "HOI4",
                    "description": "HOI4-first Ostland proxy using explicit feature masks.",
                    "basis": "hoi4_trigger",
                    "include_feature_ids": sorted_ids(rko_hoi4),
                },
                {
                    "id": "historical_reference",
                    "label": "Historical",
                    "description": "Reference-map Ostland footprint using explicit feature masks.",
                    "basis": "historical_reference",
                    "include_feature_ids": sorted_ids(rko_historical),
                },
            ],
            "companion_actions": [
                {
                    "id": "ostland_marijampole_to_ger",
                    "label": "Transfer Marijampole To Germany",
                    "description": "Auto-transfers Marijampole to Germany when Ostland core territory is applied.",
                    "basis": "historical_reference",
                    "action_type": "ownership_transfer",
                    "target_owner_tag": "GER",
                    "auto_apply_on_core_territory": True,
                    "hidden_in_ui": True,
                    "include_feature_ids": ["LT024"],
                }
            ],
        },
        "RKU": {
            "notes": (
                "Feature-first Ukraine mask. Historical is the only exposed boundary and includes the northeast,"
                " Donbas, Azov corridor, Kirovohrad, and Chernihiv while keeping Transnistria as a separate"
                " automatic Romania transfer."
            ),
            "default_boundary_variant_id": "historical_reference",
            "boundary_variants": [
                {
                    "id": "historical_reference",
                    "label": "Historical",
                    "description": "Reference-map Reichskommissariat Ukraine footprint using explicit feature masks.",
                    "basis": "historical_reference",
                    "include_feature_ids": sorted_ids(rku_historical),
                },
            ],
            "companion_actions": [
                {
                    "id": "transnistria_to_rom",
                    "label": "Transfer Transnistria To Romania",
                    "description": (
                        "Auto-transfers the Transnistria approximation to Romania when Ukraine core territory is applied."
                    ),
                    "basis": "historical_reference",
                    "action_type": "ownership_transfer",
                    "target_owner_tag": "ROM",
                    "auto_apply_on_core_territory": True,
                    "hidden_in_ui": True,
                    "include_feature_ids": sorted_ids(transnistria_to_rom),
                },
                {
                    "id": "crimea_to_ger",
                    "label": "Transfer Crimea To Germany",
                    "description": "Transfers the Crimean peninsula subset from Reichskommissariat Ukraine to Germany.",
                    "basis": "historical_reference",
                    "action_type": "ownership_transfer",
                    "target_owner_tag": "GER",
                    "include_feature_ids": sorted_ids(crimea_to_ger),
                }
            ],
        },
        "RKM": {
            "notes": (
                "Feature-first Moskowien mask. The exposed boundary is a single historical-reference footprint,"
                " including Saint Petersburg, Astrakhan, Kalmykia, the requested middle-Volga / Mari El / Komi"
                " districts, and the Belarus districts reassigned from Ostland. Greater Finland and the Russian"
                " Arctic islands are auto-transferred when Moskowien core territory is applied."
            ),
            "default_boundary_variant_id": "historical_reference",
            "boundary_variants": [
                {
                    "id": "historical_reference",
                    "label": "Historical",
                    "description": "Reference-map Moskowien footprint using explicit feature masks.",
                    "basis": "historical_reference",
                    "include_feature_ids": sorted_ids(rkm_historical),
                },
            ],
            "companion_actions": [
                {
                    "id": "greater_finland_to_fin",
                    "label": "Transfer West Karelia / West Kola To Finland",
                    "description": (
                        "Transfers the Greater Finland reference corridor west of the White Sea / Onega / Ladoga line"
                        " to Finland using explicit feature masks."
                    ),
                    "basis": "historical_reference",
                    "action_type": "ownership_transfer",
                    "target_owner_tag": "FIN",
                    "auto_apply_on_core_territory": True,
                    "hidden_in_ui": True,
                    "include_feature_ids": sorted_ids(greater_finland_to_fin),
                },
                {
                    "id": "arctic_islands_to_ger",
                    "label": "Transfer Russian Arctic Islands To Germany",
                    "description": (
                        "Auto-transfers the Russian Arctic island districts and high-Arctic shell fragments"
                        " to Germany when Moskowien core territory is applied."
                    ),
                    "basis": "historical_reference",
                    "action_type": "ownership_transfer",
                    "target_owner_tag": "GER",
                    "auto_apply_on_core_territory": True,
                    "hidden_in_ui": True,
                    "include_feature_ids": sorted_ids(arctic_islands_to_ger),
                }
            ],
        },
        "RKK": {
            "notes": (
                "Transcaucasia plus the North Caucasus groups represented by GER_is_RKK_state, including Dagestan"
                " but excluding Astrakhan and Kalmykia/Elista."
            ),
            "basis": "hoi4_trigger",
            "precedence": "hoi4_trigger",
            "include_country_codes": ["AM", "AZ", "GE"],
            "include_hierarchy_group_ids": [
                "RU_Chechen_Republic",
                "RU_Republic_of_Ingushetia",
                "RU_Republic_of_North_Ossetia_Alania",
                "RU_Kabardino_Balkaria",
                "RU_Karachay_Cherkess_Republic",
                "RU_Republic_of_Adygea",
                "RU_Krasnodar_Krai",
                "RU_Stavropol_Krai",
                "RU_Republic_of_Dagestan",
            ],
            "include_feature_ids": ["RU_RAY_50074027B22946859849779"],
        },
    }


def rewrite_spec(spec_payload: dict[str, object], target_masks: dict[str, dict[str, object]]) -> dict[str, object]:
    entries = spec_payload.get("entries", [])
    if not isinstance(entries, list):
        raise ValueError("Spec payload is missing entries[].")

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        tag = normalize_tag(entry.get("tag"))
        replacement = target_masks.get(tag)
        if not replacement:
            continue
        entry["notes"] = replacement["notes"]
        if "boundary_variants" in replacement:
            entry["default_boundary_variant_id"] = replacement["default_boundary_variant_id"]
            entry["boundary_variants"] = replacement["boundary_variants"]
            entry["companion_actions"] = replacement["companion_actions"]
            entry.pop("basis", None)
            entry.pop("precedence", None)
            entry.pop("include_country_codes", None)
            entry.pop("include_hierarchy_group_ids", None)
            entry.pop("include_feature_ids", None)
            continue
        if "basis" in replacement:
            entry["basis"] = replacement["basis"]
        if "precedence" in replacement:
            entry["precedence"] = replacement["precedence"]
        if "include_country_codes" in replacement:
            entry["include_country_codes"] = replacement["include_country_codes"]
        if "include_hierarchy_group_ids" in replacement:
            entry["include_hierarchy_group_ids"] = replacement["include_hierarchy_group_ids"]
        if "include_feature_ids" in replacement:
            entry["include_feature_ids"] = replacement["include_feature_ids"]
        entry.pop("default_boundary_variant_id", None)
        entry.pop("boundary_variants", None)
        entry.pop("companion_actions", None)

    return spec_payload


def export_rule_review_artifacts(
    *,
    reports_dir: Path,
    topology_gdf: gpd.GeoDataFrame,
    indexes: dict[str, object],
    target_masks: dict[str, dict[str, object]],
) -> None:
    feature_name_by_id: dict[str, str] = indexes["feature_name_by_id"]
    country_by_feature_id: dict[str, str] = indexes["country_by_feature_id"]
    group_ids_by_feature_id: dict[str, set[str]] = indexes["group_ids_by_feature_id"]

    political = topology_gdf.copy()
    political["id"] = political["id"].astype(str)
    political["name"] = political["id"].map(lambda feature_id: feature_name_by_id.get(feature_id, ""))
    political["country_code"] = political["id"].map(lambda feature_id: country_by_feature_id.get(feature_id, ""))
    political["group_ids"] = political["id"].map(lambda feature_id: sorted(group_ids_by_feature_id.get(feature_id, set())))

    rules: list[tuple[str, str, dict[str, object]]] = []
    for tag, entry in target_masks.items():
        for variant in entry.get("boundary_variants", []):
            rules.append((tag, "boundary_variant", variant))
        for action in entry.get("companion_actions", []):
            rules.append((tag, "companion_action", action))

    for tag, rule_kind, rule in rules:
        rule_id = str(rule.get("id") or "").strip().lower()
        feature_ids = sorted_ids(rule.get("include_feature_ids", []))
        output_dir = reports_dir / f"reichskommissariat_{tag.lower()}__{rule_kind}__{rule_id}"
        output_dir.mkdir(parents=True, exist_ok=True)

        included = political[political["id"].isin(feature_ids)].copy()
        if included.empty:
            raise ValueError(f"{tag}:{rule_kind}:{rule_id} resolved zero geometries for review export.")

        included_union = included.geometry.union_all()
        excluded_candidates = political[~political["id"].isin(feature_ids)].copy()
        excluded_candidates = excluded_candidates[excluded_candidates.geometry.intersects(included_union)].copy()

        included["status"] = "included"
        excluded_candidates["status"] = "border_candidate"

        review = gpd.GeoDataFrame(
            pd.concat(
                [
                    included[["id", "name", "country_code", "group_ids", "status", "geometry"]],
                    excluded_candidates[["id", "name", "country_code", "group_ids", "status", "geometry"]],
                ],
                ignore_index=True,
            ),
            geometry="geometry",
            crs=included.crs,
        )

        (output_dir / "included.geojson").write_text(included.to_json(drop_id=True), encoding="utf-8")
        (output_dir / "excluded_border_candidates.geojson").write_text(
            excluded_candidates.to_json(drop_id=True),
            encoding="utf-8",
        )
        review_csv = review[["id", "name", "country_code", "group_ids", "status"]].copy()
        review_csv["group_ids"] = review_csv["group_ids"].map(lambda values: "|".join(values) if isinstance(values, list) else "")
        review_csv.to_csv(output_dir / "feature_review.csv", index=False, encoding="utf-8")
        write_json(
            output_dir / "manifest.json",
            {
                "tag": tag,
                "rule_kind": rule_kind,
                "rule_id": rule_id,
                "basis": str(rule.get("basis") or "").strip(),
                "feature_count": len(feature_ids),
                "border_candidate_count": int(len(excluded_candidates)),
            },
        )


def main() -> int:
    args = parse_args()
    spec_payload = load_json(args.spec)
    if not isinstance(spec_payload, dict):
        raise SystemExit("Spec payload must be a JSON object.")

    topology_gdf = topology_to_gdf(args.runtime_topology)
    runtime_features = load_runtime_features(args.runtime_topology)
    hierarchy_groups, _country_meta = load_hierarchy_groups(args.hierarchy)
    indexes = build_indexes(runtime_features, hierarchy_groups)
    universe = FeatureUniverse(hierarchy_groups, indexes)
    target_masks = build_target_masks(universe, topology_gdf=topology_gdf)

    spec_payload = rewrite_spec(spec_payload, target_masks)
    export_rule_review_artifacts(
        reports_dir=args.reports_dir,
        topology_gdf=topology_gdf,
        indexes=indexes,
        target_masks=target_masks,
    )

    if not args.check_only:
        write_json(args.spec, spec_payload)
        print(f"[rk-masks] Updated spec: {args.spec}")
    print(f"[rk-masks] Review artifacts: {args.reports_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
