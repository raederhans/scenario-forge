"""Shared ordinary marine partitions; no scenario coast or bathymetry inputs."""
from copy import deepcopy
import json
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from .water_region_authority import polygonal

ROOT = Path(__file__).resolve().parents[2]
SOURCE_PATH = ROOT / "data/marine_regions.refined.source.geojson"
ADDITIONAL_SOURCE_PATH = ROOT / "data/marine_regions.additional.source.geojson"

# SeaVoX v19 sub_region identifiers, not points or inferred bounding boxes.
ADDITIONAL_SEAS = (
    ("flores_sea", "Flores Sea", "弗洛勒斯海", "24126", "sea"),
    ("bali_sea", "Bali Sea", "巴厘海", "24125", "sea"),
    ("sunda_strait", "Sunda Strait", "巽他海峡", "24127", "strait"),
    ("sumba_strait", "Sumba Strait", "松巴海峡", "24123", "strait"),
    ("sawu_sea", "Sawu Sea", "萨武海", "24124", "sea"),
    ("gulf_of_tomini", "Gulf of Tomini", "托米尼湾", "24134", "gulf"),
    ("gulf_of_bone", "Gulf of Bone", "波尼湾", "24129", "gulf"),
    ("aru_sea", "Aru Sea", "阿鲁海", "24128", "sea"),
    ("ceram_sea", "Ceram Sea", "塞兰海", "24132", "sea"),
    ("berau_gulf", "Berau Gulf", "贝劳湾", "24131", "gulf"),
    ("florida_strait", "Straits of Florida", "佛罗里达海峡", "24043", "strait"),
)
OCEAN_SECTORS = (
    ("northwest_atlantic_ocean", "Northwest Atlantic Ocean", "西北大西洋", "24047", "atlantic"),
    ("northeast_atlantic_ocean", "Northeast Atlantic Ocean", "东北大西洋", "24178", "atlantic"),
    ("southwest_atlantic_ocean", "Southwest Atlantic Ocean", "西南大西洋", "24039", "atlantic"),
    ("southeast_atlantic_ocean", "Southeast Atlantic Ocean", "东南大西洋", "24040", "atlantic"),
    ("northwest_pacific_ocean", "Northwest Pacific Ocean", "西北太平洋", "24115", "pacific"),
    ("northeast_pacific_ocean", "Northeast Pacific Ocean", "东北太平洋", "24116", "pacific"),
    ("southwest_pacific_ocean", "Southwest Pacific Ocean", "西南太平洋", "24102", "pacific"),
    ("southeast_pacific_ocean", "Southeast Pacific Ocean", "东南太平洋", "24103", "pacific"),
)

# Explicit source seam ownership. Detailed straits/bays keep their footprint;
# at basin seams the named adjoining source below supplies the shared edge.
# This reconciles independently simplified IHO/SeaVoX polygons, independent of
# input or paint order. Ocean/parent subtraction remains in the water compiler.
MARINE_BOUNDARY_EXCLUSIONS = {
    "banda_sea": ("timor_sea", "gulf_of_bone"),
    "barents_sea": ("norwegian_sea", "fram_strait"),
    "black_sea": ("sea_of_azov", "sea_of_marmara"),
    "celebes_sea": ("sulu_sea",),
    "east_china_sea": ("philippine_sea", "yellow_sea", "sea_of_japan"),
    "greenland_sea": ("norwegian_sea", "barents_sea"),
    "irish_sea": ("celtic_sea", "belfast_lough"),
    "north_sea": ("norwegian_sea",),
    "philippine_sea": ("south_china_sea", "molucca_sea", "seto_naikai"),
    "scotia_sea": ("weddell_sea",),
    "english_channel": ("rye_bay",),
    "gulf_of_papua": ("torres_strait",),
    "great_barrier_reef_coastal_waters": ("torres_strait",),
    "central_baltic_sea": ("lillebaelt", "gulf_of_riga"),
    "natuna_sea": ("singapore_strait", "malacca_strait"),
    "halmahera_sea": ("ceram_sea",),
    "flores_sea": ("bali_sea", "sumba_strait"),
    "aru_sea": ("ceram_sea",),
}


def reconcile_marine_source_boundaries(collection):
    """Apply reviewed seam exclusions without moving the combined coverage."""
    result = deepcopy(collection)
    by_id = {f["properties"]["id"]: f for f in collection["features"]}
    for feature in result["features"]:
        feature_id = feature["properties"]["id"]
        prefix = "tno_" if feature_id.startswith("tno_") else "marine_"
        targets = MARINE_BOUNDARY_EXCLUSIONS.get(feature_id.removeprefix(prefix), ())
        masks = [shape(by_id[prefix + suffix]["geometry"]) for suffix in targets if prefix + suffix in by_id]
        if masks:
            feature["geometry"] = mapping(polygonal(shape(feature["geometry"]).difference(unary_union(masks))))
    return result


def load_collection(path):
    return json.loads(path.read_text(encoding="utf-8"))


def tno_additional_specs():
    return tuple({
        "id": f"tno_{slug}", "name": name, "label": name,
        "water_type": kind, "region_group": "marine_macro",
        "is_chokepoint": kind == "strait", "source_layer": "seavox_v19",
        "source_query": f"mrgid_sr='{mrgid}'", "source_standard": "marine_regions_seavox_v19",
        "subtract_base_ids": (), "simplify_tolerance": 0.005,
        "clip_open_ocean_ids": (
            ("tno_northwest_atlantic_ocean", "tno_west_central_atlantic_ocean")
            if slug == "florida_strait" else (
                "tno_northwest_pacific_ocean", "tno_west_central_pacific_ocean",
                "tno_southwest_pacific_ocean", "tno_eastern_indian_ocean",
                "tno_southern_indian_ocean",
            )
        ),
    } for slug, name, _zh, mrgid, kind in ADDITIONAL_SEAS)


def additional_snapshot_features():
    result = []
    sea_ids = {f"marine_{row[0]}" for row in ADDITIONAL_SEAS}
    for source in load_collection(ADDITIONAL_SOURCE_PATH)["features"]:
        if source["properties"]["id"] not in sea_ids:
            continue
        feature = deepcopy(source)
        feature["properties"]["id"] = feature["properties"]["id"].replace("marine_", "tno_", 1)
        result.append(feature)
    return result


def refine_base_water_regions(collection):
    """Keep durable IDs and untouched lakes/Mediterranean, replace ordinary seas.

    Source features precede physical clipping. Existing ocean parents retain
    their residual surface; documented SeaVoX children own their exact footprints.
    """
    result = deepcopy(collection)
    by_id = {f["properties"]["id"]: f for f in result["features"]}
    for source in load_collection(SOURCE_PATH)["features"]:
        feature = deepcopy(source)
        props = feature["properties"]
        if props.get("water_type") == "ocean":
            props["interactive"] = True
            parent = by_id.get(props["parent_id"])
            if parent is None:
                raise ValueError(f"Missing ocean parent {props['parent_id']}")
            # Physical parent authority prevents importing a source coast into
            # another ocean. No invented rectangular completion geometry.
            feature["geometry"] = mapping(polygonal(shape(feature["geometry"]).intersection(shape(parent["geometry"]))))
        by_id[props["id"]] = feature
    result["features"] = list(by_id.values())
    return reconcile_marine_source_boundaries(result)


def restore_ocean_parent_footprints(collection):
    """Reassemble split parents for legacy TNO source-union builders."""
    result = deepcopy(collection)
    by_id = {f["properties"]["id"]: f for f in result["features"]}
    children = {}
    for feature in result["features"]:
        props = feature["properties"]
        if props.get("water_type") == "ocean" and props.get("parent_id"):
            children.setdefault(props["parent_id"], []).append(shape(feature["geometry"]))
    for parent_id, parts in children.items():
        if parent_id in by_id:
            parent = by_id[parent_id]
            parent["geometry"] = mapping(polygonal(unary_union([shape(parent["geometry"]), *parts])))
    return result
