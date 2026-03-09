import json
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    import geopandas as gpd
except ImportError as exc:
    raise SystemExit(
        "geopandas is required. Install with: uv pip install geopandas"
    ) from exc

try:
    import requests
except ImportError as exc:
    raise SystemExit(
        "requests is required. Install with: uv pip install requests"
    ) from exc

try:
    from map_builder import config as cfg
except Exception:
    cfg = None

try:
    from map_builder.io.fetch import fetch_or_load_geojson, fetch_or_load_vector_archive
except Exception:
    fetch_or_load_geojson = None
    fetch_or_load_vector_archive = None

try:
    from map_builder.processors.ru_city_overrides import (
        RU_CITY_GROUP_BY_ID,
        build_ru_city_overrides,
    )
except Exception:
    RU_CITY_GROUP_BY_ID = {}
    build_ru_city_overrides = None

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
FEATURE_MIGRATION_PATH = DATA_DIR / "feature-migrations" / "by_hybrid_v1.json"
DEFAULT_CHINA_ADM2 = DATA_DIR / "china_adm2.geojson"
DEFAULT_FR_ARR = DATA_DIR / "france_arrondissements.geojson"
DEFAULT_PL_POW = DATA_DIR / "poland_powiaty.geojson"
DEFAULT_IND_ADM2 = DATA_DIR / "geoBoundaries-IND-ADM2.geojson"
DEFAULT_RUS_ADM2 = DATA_DIR / "geoBoundaries-RUS-ADM2.geojson"
DEFAULT_UKR_ADM2 = DATA_DIR / "geoBoundaries-UKR-ADM2.geojson"
DEFAULT_ADMIN0_COUNTRIES = DATA_DIR / "ne_50m_admin_0_countries.zip"
NE_ADMIN1_URL = "https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_1_states_provinces.zip"

DEFAULT_NE_ADM1_CANDIDATES = [
    DATA_DIR / "ne_10m_admin_1_states_provinces.shp",
    DATA_DIR / "ne_10m_admin_1_states_provinces.geojson",
    DATA_DIR / "ne_10m_admin_1_states_provinces.json",
    DATA_DIR / "ne_10m_admin_1_states_provinces.gpkg",
]

CN_NAME_COLS = ["name_en", "name", "name_long", "name_local", "gn_name", "namealt"]
CN_TYPE_COLS = ["type_en", "type", "adm1_type", "name_type"]
ADMIN1_NAME_COLS = ["name_en", "name", "name_long", "name_local", "gn_name", "namealt"]
ADMIN1_ISO_COLS = ["iso_a2", "adm0_a2", "iso_3166_1_", "iso_3166_1_alpha_2"]
ADMIN1_ADM0_COLS = ["admin", "adm0_name", "admin0_name"]
ADMIN1_ID_COLS = ["adm1_code", "gn_id", "id"]
URAL_LONGITUDE = 60.0
RUSSIA_COASTAL_FAR_EAST_DETAIL_PARENT_IDS = set(
    getattr(
        cfg,
        "RUSSIA_COASTAL_FAR_EAST_DETAIL_PARENT_IDS",
        (
            "RUS-2609",
            "RUS-2613",
            "RUS-2614",
            "RUS-2611",
            "RUS-2616",
            "RUS-2615",
            "RUS-3468",
            "RUS-2321",
        ),
    )
)
COUNTRY_GROUP_CONTINENT_ORDER = [
    "Africa",
    "Asia",
    "Europe",
    "North America",
    "South America",
    "Oceania",
    "Antarctica",
    "Other",
]
VALID_COUNTRY_GROUP_CONTINENTS = set(COUNTRY_GROUP_CONTINENT_ORDER) | {"Americas"}

POLAND_VOIVODESHIPS = {
    "02": "Lower Silesian",
    "04": "Kuyavian-Pomeranian",
    "06": "Lublin",
    "08": "Lubusz",
    "10": "Lodz",
    "12": "Lesser Poland",
    "14": "Masovian",
    "16": "Opole",
    "18": "Subcarpathian",
    "20": "Podlaskie",
    "22": "Pomeranian",
    "24": "Silesian",
    "26": "Holy Cross",
    "28": "Warmian-Masurian",
    "30": "Greater Poland",
    "32": "West Pomeranian",
}

FR_DEPT_TO_REGION = {
    "01": "Auvergne-Rhone-Alpes",
    "02": "Hauts-de-France",
    "03": "Auvergne-Rhone-Alpes",
    "04": "Provence-Alpes-Cote d'Azur",
    "05": "Provence-Alpes-Cote d'Azur",
    "06": "Provence-Alpes-Cote d'Azur",
    "07": "Auvergne-Rhone-Alpes",
    "08": "Grand Est",
    "09": "Occitanie",
    "10": "Grand Est",
    "11": "Occitanie",
    "12": "Occitanie",
    "13": "Provence-Alpes-Cote d'Azur",
    "14": "Normandie",
    "15": "Auvergne-Rhone-Alpes",
    "16": "Nouvelle-Aquitaine",
    "17": "Nouvelle-Aquitaine",
    "18": "Centre-Val de Loire",
    "19": "Nouvelle-Aquitaine",
    "2A": "Corse",
    "2B": "Corse",
    "21": "Bourgogne-Franche-Comte",
    "22": "Bretagne",
    "23": "Nouvelle-Aquitaine",
    "24": "Nouvelle-Aquitaine",
    "25": "Bourgogne-Franche-Comte",
    "26": "Auvergne-Rhone-Alpes",
    "27": "Normandie",
    "28": "Centre-Val de Loire",
    "29": "Bretagne",
    "30": "Occitanie",
    "31": "Occitanie",
    "32": "Occitanie",
    "33": "Nouvelle-Aquitaine",
    "34": "Occitanie",
    "35": "Bretagne",
    "36": "Centre-Val de Loire",
    "37": "Centre-Val de Loire",
    "38": "Auvergne-Rhone-Alpes",
    "39": "Bourgogne-Franche-Comte",
    "40": "Nouvelle-Aquitaine",
    "41": "Centre-Val de Loire",
    "42": "Auvergne-Rhone-Alpes",
    "43": "Auvergne-Rhone-Alpes",
    "44": "Pays de la Loire",
    "45": "Centre-Val de Loire",
    "46": "Occitanie",
    "47": "Nouvelle-Aquitaine",
    "48": "Occitanie",
    "49": "Pays de la Loire",
    "50": "Normandie",
    "51": "Grand Est",
    "52": "Grand Est",
    "53": "Pays de la Loire",
    "54": "Grand Est",
    "55": "Grand Est",
    "56": "Bretagne",
    "57": "Grand Est",
    "58": "Bourgogne-Franche-Comte",
    "59": "Hauts-de-France",
    "60": "Hauts-de-France",
    "61": "Normandie",
    "62": "Hauts-de-France",
    "63": "Auvergne-Rhone-Alpes",
    "64": "Nouvelle-Aquitaine",
    "65": "Occitanie",
    "66": "Occitanie",
    "67": "Grand Est",
    "68": "Grand Est",
    "69": "Auvergne-Rhone-Alpes",
    "70": "Bourgogne-Franche-Comte",
    "71": "Bourgogne-Franche-Comte",
    "72": "Pays de la Loire",
    "73": "Auvergne-Rhone-Alpes",
    "74": "Auvergne-Rhone-Alpes",
    "75": "Ile-de-France",
    "76": "Normandie",
    "77": "Ile-de-France",
    "78": "Ile-de-France",
    "79": "Nouvelle-Aquitaine",
    "80": "Hauts-de-France",
    "81": "Occitanie",
    "82": "Occitanie",
    "83": "Provence-Alpes-Cote d'Azur",
    "84": "Provence-Alpes-Cote d'Azur",
    "85": "Pays de la Loire",
    "86": "Nouvelle-Aquitaine",
    "87": "Nouvelle-Aquitaine",
    "88": "Grand Est",
    "89": "Bourgogne-Franche-Comte",
    "90": "Bourgogne-Franche-Comte",
    "91": "Ile-de-France",
    "92": "Ile-de-France",
    "93": "Ile-de-France",
    "94": "Ile-de-France",
    "95": "Ile-de-France",
    "971": "Guadeloupe",
    "972": "Martinique",
    "973": "Guyane",
    "974": "La Reunion",
    "975": "Saint-Pierre-et-Miquelon",
    "976": "Mayotte",
}


def pick_column(columns, candidates):
    for col in candidates:
        if col in columns:
            return col
    return None


def filter_admin1_by_iso(adm1, iso_code, fallback_names=None):
    iso_col = pick_column(adm1.columns, ADMIN1_ISO_COLS)
    if iso_col:
        return adm1[adm1[iso_col] == iso_code].copy()
    name_col = pick_column(adm1.columns, ADMIN1_ADM0_COLS + ADMIN1_NAME_COLS)
    if name_col and fallback_names:
        return adm1[adm1[name_col].isin(fallback_names)].copy()
    return adm1.copy()


def ensure_crs(gdf, epsg=4326):
    if gdf.crs is None:
        gdf = gdf.set_crs(f"EPSG:{epsg}", allow_override=True)
    elif gdf.crs.to_epsg() != epsg:
        gdf = gdf.to_crs(f"EPSG:{epsg}")
    return gdf


def centroid_points(gdf, epsg=3857):
    original_crs = gdf.crs
    if original_crs is None:
        gdf = gdf.set_crs("EPSG:4326", allow_override=True)
        original_crs = gdf.crs
    projected = gdf.to_crs(f"EPSG:{epsg}")
    projected = projected.copy()
    projected["geometry"] = projected.geometry.centroid
    return projected.to_crs(original_crs)


def nearest_join_projected(left, right, distance_col="distance"):
    left = ensure_crs(left)
    right = ensure_crs(right)
    metric_crs = getattr(cfg, "AREA_CRS", "EPSG:6933") if cfg is not None else "EPSG:6933"
    left_proj = left.to_crs(metric_crs).copy()
    right_proj = right.to_crs(metric_crs).copy()
    return gpd.sjoin_nearest(
        left_proj,
        right_proj,
        how="left",
        distance_col=distance_col,
    )


def representative_longitudes(gdf):
    gdf = ensure_crs(gdf)
    reps = gdf.geometry.representative_point()
    return reps.x


def load_feature_migration_map(path: Path = FEATURE_MIGRATION_PATH) -> dict[str, list[str]]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    out: dict[str, list[str]] = {}
    for parent_id, child_ids in payload.items():
        parent_key = str(parent_id or "").strip()
        if not parent_key or not isinstance(child_ids, list):
            continue
        normalized = [str(child_id).strip() for child_id in child_ids if str(child_id).strip()]
        if normalized:
            out[parent_key] = normalized
    return out


def should_refine_ru_parent(feature_id, rep_lon) -> bool:
    value = str(feature_id or "").strip()
    if not value:
        return False
    if value in RUSSIA_COASTAL_FAR_EAST_DETAIL_PARENT_IDS:
        return True
    try:
        rep_lon_value = float(rep_lon)
    except (TypeError, ValueError):
        return False
    return value.startswith("RUS-") and rep_lon_value < URAL_LONGITUDE


def slugify(text):
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", str(text).strip())
    return cleaned.strip("_")


def normalize_country_code(raw):
    code = re.sub(r"[^A-Z]", "", str(raw or "").strip().upper())
    if not code or code == "ZZ":
        return ""
    return cfg.COUNTRY_CODE_ALIASES.get(code, code)


def normalize_country_group_continent(continent, region_un):
    continent_label = str(continent or "").strip()
    region_un_label = str(region_un or "").strip()

    if continent_label in COUNTRY_GROUP_CONTINENT_ORDER:
        return continent_label
    if region_un_label in COUNTRY_GROUP_CONTINENT_ORDER:
        return region_un_label
    if continent_label == "Americas" or region_un_label == "Americas":
        return "Other"
    if continent_label in VALID_COUNTRY_GROUP_CONTINENTS:
        return continent_label
    if region_un_label in VALID_COUNTRY_GROUP_CONTINENTS:
        return region_un_label
    return "Other"


def normalize_country_group_subregion(subregion):
    subregion_label = str(subregion or "").strip()
    if not subregion_label or subregion_label == "Seven seas (open ocean)":
        return "Unclassified"
    return subregion_label


def load_admin0_countries(admin0_path: Path):
    if not admin0_path.exists():
        if cfg is None or fetch_or_load_vector_archive is None:
            raise FileNotFoundError(f"Missing admin0 countries source: {admin0_path}")
        print(
            "[Hierarchy] Admin0 countries archive missing locally; "
            f"downloading {admin0_path.name}..."
        )
        return fetch_or_load_vector_archive(
            cfg.BORDERS_URL,
            admin0_path.name,
        )
    source = f"zip://{admin0_path}" if admin0_path.suffix.lower() == ".zip" else admin0_path
    return gpd.read_file(source)


def collect_active_country_codes(topology_path: Path):
    if not topology_path.exists():
        raise FileNotFoundError(f"Missing topology for country groups: {topology_path}")

    topo = json.loads(topology_path.read_text(encoding="utf-8"))
    geoms = topo.get("objects", {}).get("political", {}).get("geometries", [])
    codes = set()
    for geom in geoms:
        props = geom.get("properties", {}) or {}
        code = normalize_country_code(props.get("cntr_code") or props.get("CNTR_CODE") or "")
        if code:
            codes.add(code)
    return codes


def build_country_groups_from_admin0(admin0_path: Path, active_country_codes: set[str]):
    admin0 = load_admin0_countries(admin0_path)
    records = {}

    for _, row in admin0.iterrows():
        continent = normalize_country_group_continent(
            row.get("CONTINENT", ""),
            row.get("REGION_UN", ""),
        )
        subregion = normalize_country_group_subregion(row.get("SUBREGION", ""))
        country_name = (
            str(row.get("NAME_LONG", "") or "").strip()
            or str(row.get("ADMIN", "") or "").strip()
        )

        for key in ("ISO_A2_EH", "ISO_A2"):
            if key not in admin0.columns:
                continue
            code = normalize_country_code(row.get(key))
            if not code or code == "-99" or code in records:
                continue
            records[code] = {
                "country_name": country_name or code,
                "continent_label": continent,
                "subregion_label": subregion,
            }

    buckets = defaultdict(lambda: defaultdict(list))
    country_meta = {}
    country_name_by_code = {}

    for code in sorted(active_country_codes):
        record = records.get(code)
        continent_label = record["continent_label"] if record else "Other"
        subregion_label = record["subregion_label"] if record else "Unclassified"
        country_name = record["country_name"] if record else code

        continent_id = f"continent_{slugify(continent_label).lower() or 'other'}"
        subregion_id = f"subregion_{slugify(subregion_label).lower() or 'unclassified'}"

        country_meta[code] = {
            "continent_id": continent_id,
            "continent_label": continent_label,
            "subregion_id": subregion_id,
            "subregion_label": subregion_label,
        }
        country_name_by_code[code] = country_name
        buckets[continent_label][subregion_label].append(code)

    ordered_continents = []
    seen_continents = set()
    for continent in COUNTRY_GROUP_CONTINENT_ORDER:
        if continent in buckets:
            ordered_continents.append(continent)
            seen_continents.add(continent)
    for continent in sorted(set(buckets.keys()) - seen_continents):
        ordered_continents.append(continent)

    continents = []
    for continent_label in ordered_continents:
        subregions = []
        continent_buckets = buckets[continent_label]
        for subregion_label in sorted(continent_buckets.keys()):
            countries = sorted(
                continent_buckets[subregion_label],
                key=lambda code: country_name_by_code.get(code, code),
            )
            subregions.append(
                {
                    "id": f"subregion_{slugify(subregion_label).lower() or 'unclassified'}",
                    "label": subregion_label,
                    "countries": countries,
                }
            )

        continents.append(
            {
                "id": f"continent_{slugify(continent_label).lower() or 'other'}",
                "label": continent_label,
                "subregions": subregions,
            }
        )

    return {
        "version": 1,
        "continents": continents,
        "country_meta": country_meta,
    }


def find_ne_admin1(data_dir: Path):
    for candidate in DEFAULT_NE_ADM1_CANDIDATES:
        if candidate.exists():
            return candidate
    patterns = ["*admin_1*states*provinces*", "*admin_1*provinces*", "*admin_1*states*"]
    for pattern in patterns:
        for path in data_dir.glob(pattern):
            if path.suffix.lower() in {".shp", ".geojson", ".json", ".gpkg"}:
                return path
    return None

def download_admin1_to_data(data_dir: Path):
    print("Downloading Natural Earth admin1 for hierarchy...")
    zip_path = data_dir / "ne_10m_admin_1_states_provinces.zip"
    try:
        response = requests.get(NE_ADMIN1_URL, timeout=(10, 120))
        response.raise_for_status()
        zip_path.write_bytes(response.content)
    except requests.RequestException as exc:
        print(f"Failed to download admin1: {exc}")
        return None

    try:
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(data_dir)
    except zipfile.BadZipFile as exc:
        print(f"Failed to extract admin1 zip: {exc}")
        return None

    return find_ne_admin1(data_dir)


def ensure_cached_geojson(
    path: Path,
    *,
    label: str,
    url: str | None,
    fallback_urls: list[str] | None = None,
) -> Path:
    if path.exists():
        return path
    if not url or fetch_or_load_geojson is None:
        raise SystemExit(f"Missing {path}")

    print(f"[Hierarchy] {label} missing locally; downloading authoritative source...")
    fetch_or_load_geojson(
        url,
        path.name,
        fallback_urls=fallback_urls,
    )
    if not path.exists():
        raise SystemExit(
            f"[Hierarchy] Expected cached source missing after download: {path}"
        )
    return path


def build_china_groups(adm2_path: Path, adm1_path: Path):
    adm2 = gpd.read_file(adm2_path)
    if "shapeID" not in adm2.columns:
        raise ValueError("China ADM2 missing shapeID column.")
    adm2 = ensure_crs(adm2)
    centroids = centroid_points(adm2)

    adm1 = gpd.read_file(adm1_path)
    adm1 = ensure_crs(adm1)
    admin_col = "admin" if "admin" in adm1.columns else None
    if admin_col:
        adm1_china = adm1[adm1[admin_col] == "China"].copy()
    elif "adm0_a3" in adm1.columns:
        adm1_china = adm1[adm1["adm0_a3"] == "CHN"].copy()
    else:
        adm1_china = adm1.copy()

    name_col = pick_column(adm1_china.columns, CN_NAME_COLS)
    if not name_col:
        raise ValueError("China ADM1 missing name columns. Checked: " + ", ".join(CN_NAME_COLS))
    type_col = pick_column(adm1_china.columns, CN_TYPE_COLS)

    keep_cols = [name_col]
    if type_col:
        keep_cols.append(type_col)
    adm1_china = adm1_china[keep_cols + ["geometry"]].copy()

    joined = gpd.sjoin(centroids, adm1_china, how="left", predicate="within")

    if joined[name_col].isna().any():
        try:
            missing = joined[name_col].isna()
            nearest = nearest_join_projected(
                centroids.loc[missing].copy(),
                adm1_china,
                distance_col="distance",
            )
            joined.loc[missing, name_col] = nearest[name_col].values
            if type_col:
                joined.loc[missing, type_col] = nearest[type_col].values
        except Exception:
            pass

    groups = defaultdict(list)
    labels = {}

    for _, row in joined.iterrows():
        province = row.get(name_col)
        if not province or str(province).strip() == "":
            continue
        group_id = f"CN_{slugify(province)}"
        child_id = f"CN_CITY_{row['shapeID']}"
        groups[group_id].append(child_id)
        if group_id not in labels:
            if type_col and row.get(type_col):
                labels[group_id] = f"{province} {row.get(type_col)}"
            else:
                labels[group_id] = str(province)

    return groups, labels


def build_admin2_groups(adm2_path: Path, adm1_path: Path, iso_code: str, child_prefix: str, country_names=None):
    adm2 = gpd.read_file(adm2_path)
    if "shapeID" not in adm2.columns:
        raise ValueError(f"{iso_code} ADM2 missing shapeID column.")
    adm2 = ensure_crs(adm2)
    centroids = centroid_points(adm2)

    adm1 = gpd.read_file(adm1_path)
    adm1 = ensure_crs(adm1)
    adm1_country = filter_admin1_by_iso(adm1, iso_code, fallback_names=country_names)

    name_col = pick_column(adm1_country.columns, ADMIN1_NAME_COLS)
    if not name_col:
        raise ValueError(f"{iso_code} ADM1 missing name columns.")

    adm1_country = adm1_country[[name_col, "geometry"]].copy()
    joined = gpd.sjoin(centroids, adm1_country, how="left", predicate="within")

    if joined[name_col].isna().any():
        try:
            missing = joined[name_col].isna()
            nearest = nearest_join_projected(
                centroids.loc[missing].copy(),
                adm1_country,
                distance_col="distance",
            )
            joined.loc[missing, name_col] = nearest[name_col].values
        except Exception:
            pass

    groups = defaultdict(list)
    labels = {}

    for _, row in joined.iterrows():
        region = row.get(name_col)
        if not region or str(region).strip() == "":
            continue
        group_id = f"{child_prefix}_{slugify(region)}"
        child_id = f"{child_prefix}_RAY_{row['shapeID']}"
        groups[group_id].append(child_id)
        if group_id not in labels:
            labels[group_id] = str(region)

    return groups, labels


def build_india_groups(adm2_path: Path, adm1_path: Path | None = None):
    gdf = gpd.read_file(adm2_path)
    if "shapeID" not in gdf.columns:
        raise ValueError("India ADM2 missing shapeID column.")

    if "adm1_name" in gdf.columns:
        gdf = gdf.copy()
        gdf["adm1_name"] = gdf["adm1_name"].fillna("").astype(str)
    else:
        gdf = gdf.copy()
        gdf["adm1_name"] = ""

    needs_join = gdf["adm1_name"].str.strip().eq("").all()
    if needs_join and adm1_path:
        try:
            adm1 = gpd.read_file(adm1_path)
            adm1 = ensure_crs(adm1)
            iso_col = pick_column(adm1.columns, ADMIN1_ISO_COLS)
            name_col = pick_column(adm1.columns, ADMIN1_NAME_COLS)
            admin_col = pick_column(adm1.columns, ADMIN1_ADM0_COLS)

            if name_col:
                if iso_col:
                    adm1 = adm1[adm1[iso_col] == "IN"].copy()
                elif admin_col:
                    adm1 = adm1[adm1[admin_col].str.contains("India", case=False, na=False)].copy()

                if not adm1.empty:
                    adm1 = adm1[[name_col, "geometry"]].copy()
                    joined = gpd.sjoin(gdf, adm1, how="left", predicate="intersects")
                    if name_col in joined.columns and not joined[name_col].isna().all():
                        name_map = joined[name_col].groupby(level=0).first()
                        gdf["adm1_name"] = gdf.index.to_series().map(name_map).fillna(gdf["adm1_name"])
        except Exception:
            pass

    groups = defaultdict(list)
    labels = {}

    for _, row in gdf.iterrows():
        region = str(row.get("adm1_name", "")).strip()
        if not region:
            region = "Other"
        group_id = f"IN_{slugify(region)}"
        child_id = f"IN_ADM2_{row['shapeID']}"
        if child_id not in groups[group_id]:
            groups[group_id].append(child_id)
        if group_id not in labels:
            labels[group_id] = f"IN - {region}"

    return groups, labels


def build_russia_groups_hybrid(adm2_path: Path, adm1_path: Path):
    adm2 = gpd.read_file(adm2_path)
    if "shapeID" not in adm2.columns:
        raise ValueError("RU ADM2 missing shapeID column.")
    adm2 = ensure_crs(adm2)

    adm1 = gpd.read_file(adm1_path)
    adm1 = ensure_crs(adm1)
    adm1_country = filter_admin1_by_iso(adm1, "RU", fallback_names=["Russia"])

    name_col = pick_column(adm1_country.columns, ADMIN1_NAME_COLS)
    if not name_col:
        raise ValueError("RU ADM1 missing name columns.")

    id_col = pick_column(adm1_country.columns, ADMIN1_ID_COLS)
    if not id_col:
        iso_col = pick_column(adm1_country.columns, ADMIN1_ISO_COLS)
        adm1_country = adm1_country.copy()
        if iso_col:
            adm1_country["adm1_code"] = (
                adm1_country[iso_col].astype(str)
                + "_"
                + adm1_country[name_col].astype(str)
            )
        else:
            adm1_country["adm1_code"] = "RU_" + adm1_country[name_col].astype(str)
        id_col = "adm1_code"

    adm1_country = adm1_country.copy()
    adm1_country["__coarse_feature_id"] = adm1_country[id_col].fillna("").astype(str).str.strip()
    rep_lon_adm1 = representative_longitudes(adm1_country)
    adm1_country["__rep_lon"] = rep_lon_adm1
    adm1_country["__should_refine"] = [
        should_refine_ru_parent(feature_id, rep_lon)
        for feature_id, rep_lon in zip(adm1_country["__coarse_feature_id"], adm1_country["__rep_lon"])
    ]
    feature_migration_map = load_feature_migration_map()
    explicit_far_east_parents = {
        feature_id
        for feature_id in RUSSIA_COASTAL_FAR_EAST_DETAIL_PARENT_IDS
        if feature_migration_map.get(feature_id)
    }
    explicit_far_east_child_ids = {
        child_id
        for feature_id in explicit_far_east_parents
        for child_id in feature_migration_map.get(feature_id, [])
    }

    groups = defaultdict(list)
    labels = {}

    for _, row in adm1_country.iterrows():
        feature_id = str(row.get("__coarse_feature_id", "")).strip()
        if feature_id not in explicit_far_east_parents:
            continue
        region = row.get(name_col)
        if not region or str(region).strip() == "":
            continue
        group_id = f"RU_{slugify(region)}"
        for child_id in feature_migration_map.get(feature_id, []):
            if child_id not in groups[group_id]:
                groups[group_id].append(child_id)
        if group_id not in labels:
            labels[group_id] = str(region)

    if not adm2.empty:
        centroids = centroid_points(adm2)
        adm1_join = adm1_country[[name_col, "__coarse_feature_id", "__should_refine", "geometry"]].copy()
        joined = gpd.sjoin(centroids, adm1_join, how="left", predicate="within")

        if joined[name_col].isna().any() or joined["__coarse_feature_id"].isna().any():
            try:
                missing = joined[name_col].isna() | joined["__coarse_feature_id"].isna()
                nearest = nearest_join_projected(
                    centroids.loc[missing].copy(),
                    adm1_join,
                    distance_col="distance",
                )
                for column in (name_col, "__coarse_feature_id", "__should_refine"):
                    joined.loc[missing, column] = nearest[column].values
            except Exception:
                pass

        for _, row in joined.iterrows():
            if not bool(row.get("__should_refine")):
                continue
            if str(row.get("__coarse_feature_id", "")).strip() in explicit_far_east_parents:
                continue
            region = row.get(name_col)
            if not region or str(region).strip() == "":
                continue
            group_id = f"RU_{slugify(region)}"
            child_id = f"RU_RAY_{row['shapeID']}"
            if child_id in explicit_far_east_child_ids:
                continue
            if child_id not in groups[group_id]:
                groups[group_id].append(child_id)
            if group_id not in labels:
                labels[group_id] = str(region)

    adm1_coarse = adm1_country.loc[~adm1_country["__should_refine"]].copy()

    if not adm1_coarse.empty:
        for _, row in adm1_coarse.iterrows():
            region = row.get(name_col)
            if not region or str(region).strip() == "":
                continue
            child_id = str(row.get("__coarse_feature_id", "")).strip()
            if not child_id:
                continue
            group_id = f"RU_{slugify(region)}"
            if child_id not in groups[group_id]:
                groups[group_id].append(child_id)
            if group_id not in labels:
                labels[group_id] = str(region)

    if build_ru_city_overrides is not None and RU_CITY_GROUP_BY_ID:
        try:
            city_overrides = build_ru_city_overrides(adm2, adm1_country, strict=False)
            for _, row in city_overrides.iterrows():
                city_id = str(row.get("id", "")).strip()
                if not city_id:
                    continue
                group_id = RU_CITY_GROUP_BY_ID.get(city_id)
                if not group_id:
                    continue
                if city_id not in groups[group_id]:
                    groups[group_id].append(city_id)
                labels[group_id] = str(row.get("name", "")).strip() or group_id
        except Exception as exc:
            print(f"[Hierarchy] RU city override injection skipped: {exc}")

    return groups, labels


def build_poland_groups(powiat_path: Path):
    gdf = gpd.read_file(powiat_path)
    if "terc" not in gdf.columns:
        raise ValueError("Poland powiaty missing terc column.")

    groups = defaultdict(list)
    labels = {}

    for _, row in gdf.iterrows():
        terc = str(row.get("terc", ""))
        if len(terc) < 2:
            continue
        voiv_code = terc[:2]
        voiv_name = POLAND_VOIVODESHIPS.get(voiv_code)
        if not voiv_name:
            continue
        group_id = f"PL_{slugify(voiv_name)}"
        child_id = f"PL_POW_{terc}"
        groups[group_id].append(child_id)
        labels[group_id] = f"{voiv_name} Voivodeship"

    return groups, labels


def derive_fr_dept(code):
    code = str(code)
    if code.startswith("97") or code.startswith("98"):
        return code[:3]
    return code[:2]


def build_france_groups(arr_path: Path):
    gdf = gpd.read_file(arr_path)
    if "code" not in gdf.columns:
        raise ValueError("France arrondissements missing code column.")

    groups = defaultdict(list)
    labels = {}

    for _, row in gdf.iterrows():
        code = str(row.get("code", ""))
        if not code:
            continue
        dept = derive_fr_dept(code)
        region = FR_DEPT_TO_REGION.get(dept)
        if not region:
            continue
        group_id = f"FR_{slugify(region)}"
        child_id = f"FR_ARR_{code}"
        groups[group_id].append(child_id)
        labels[group_id] = f"{region} Region"

    return groups, labels


def build_topology_admin1_groups(topology_path: Path, subdivision_codes: set[str]):
    if not topology_path.exists() or not subdivision_codes:
        return {}, {}

    try:
        topo = json.loads(topology_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[Hierarchy] Failed to read topology for admin1 groups: {exc}")
        return {}, {}

    geoms = (
        topo.get("objects", {})
        .get("political", {})
        .get("geometries", [])
    )
    groups = defaultdict(list)
    labels = {}

    for geom in geoms:
        props = geom.get("properties", {}) or {}
        child_id = str(props.get("id", "")).strip()
        code = str(props.get("cntr_code", "")).strip().upper()
        if not child_id or not code:
            continue

        norm_code = "GB" if code == "UK" else code
        if norm_code not in subdivision_codes:
            continue

        group_name = str(props.get("admin1_group", "")).strip()
        if not group_name and norm_code == "GB":
            group_name = str(props.get("constituent_country", "")).strip()
        if not group_name:
            continue

        group_id = f"{norm_code}_{slugify(group_name)}"
        if child_id not in groups[group_id]:
            groups[group_id].append(child_id)
        labels[group_id] = group_name

    return dict(groups), labels


def load_authoritative_feature_ids() -> tuple[set[str], Path | None]:
    candidates = [
        DATA_DIR / "europe_topology.runtime_political_v1.json",
        DATA_DIR / "europe_topology.na_v2.json",
        DATA_DIR / "europe_topology.highres.json",
        DATA_DIR / "europe_topology.json",
    ]
    for path in candidates:
        if not path.exists():
            continue
        try:
            topo = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        geoms = topo.get("objects", {}).get("political", {}).get("geometries", [])
        ids = {
            str((geom.get("properties") or {}).get("id") or "").strip()
            for geom in geoms
            if str((geom.get("properties") or {}).get("id") or "").strip()
        }
        if ids:
            return ids, path
    return set(), None


def filter_groups_to_authoritative_ids(groups: dict, labels: dict, valid_ids: set[str]):
    if not valid_ids:
        return dict(groups), dict(labels), 0

    filtered_groups = {}
    filtered_labels = {}
    dropped_children = 0

    for group_id, children in groups.items():
        kept = []
        seen = set()
        for child in children or []:
            child_id = str(child or "").strip()
            if not child_id:
                continue
            if child_id not in valid_ids:
                dropped_children += 1
                continue
            if child_id in seen:
                continue
            seen.add(child_id)
            kept.append(child_id)
        if not kept:
            continue
        filtered_groups[group_id] = kept
        if group_id in labels:
            filtered_labels[group_id] = labels[group_id]

    return filtered_groups, filtered_labels, dropped_children


def validate_country_leaf_group_coverage(
    groups: dict,
    authoritative_ids: set[str],
    *,
    group_prefix: str,
    leaf_prefix: str,
) -> None:
    expected_ids = {
        feature_id
        for feature_id in authoritative_ids
        if str(feature_id or "").startswith(leaf_prefix)
    }
    if not expected_ids:
        return

    grouped_ids = set()
    duplicate_ids = set()
    for group_id, children in groups.items():
        if not str(group_id or "").startswith(group_prefix):
            continue
        for child in children or []:
            child_id = str(child or "").strip()
            if not child_id.startswith(leaf_prefix):
                continue
            if child_id in grouped_ids:
                duplicate_ids.add(child_id)
            grouped_ids.add(child_id)

    missing_ids = sorted(expected_ids - grouped_ids)
    if duplicate_ids or missing_ids:
        problems = []
        if missing_ids:
            problems.append(f"missing={len(missing_ids)}")
        if duplicate_ids:
            problems.append(f"duplicates={len(duplicate_ids)}")
        raise ValueError(
            f"{group_prefix} leaf grouping coverage invalid ({', '.join(problems)})."
        )


def build_interaction_policies() -> dict:
    return {
        "CN": {
            "leaf_source": "detail",
            "leaf_kind": "adm2",
            "parent_source": "hierarchy",
            "parent_scope_label": "Province",
            "requires_composite": True,
            "quick_fill_scopes": ["parent", "country"],
        }
    }


def main():
    adm2_path = DEFAULT_CHINA_ADM2
    adm1_path = find_ne_admin1(DATA_DIR)
    if not adm1_path:
        adm1_path = download_admin1_to_data(DATA_DIR)
    fr_path = DEFAULT_FR_ARR
    pl_path = DEFAULT_PL_POW
    ind_path = DEFAULT_IND_ADM2
    ru_path = DEFAULT_RUS_ADM2
    ua_path = DEFAULT_UKR_ADM2

    remote_geojson_inputs = [
        (
            "China ADM2",
            adm2_path,
            getattr(cfg, "CHINA_CITY_URL", None),
            getattr(cfg, "CHINA_CITY_FALLBACK_URLS", None),
        ),
        (
            "France arrondissements",
            fr_path,
            getattr(cfg, "FR_ARR_URL", None),
            getattr(cfg, "FR_ARR_FALLBACK_URLS", None),
        ),
        (
            "Poland powiaty",
            pl_path,
            getattr(cfg, "PL_POWIATY_URL", None),
            getattr(cfg, "PL_POWIATY_FALLBACK_URLS", None),
        ),
        (
            "India ADM2",
            ind_path,
            getattr(cfg, "IND_ADM2_URL", None),
            getattr(cfg, "IND_ADM2_FALLBACK_URLS", None),
        ),
        (
            "Russia ADM2",
            ru_path,
            getattr(cfg, "RUS_ADM2_URL", None),
            getattr(cfg, "RUS_ADM2_FALLBACK_URLS", None),
        ),
        (
            "Ukraine ADM2",
            ua_path,
            getattr(cfg, "UKR_ADM2_URL", None),
            getattr(cfg, "UKR_ADM2_FALLBACK_URLS", None),
        ),
    ]
    for label, path, url, fallback_urls in remote_geojson_inputs:
        ensure_cached_geojson(
            path,
            label=label,
            url=url,
            fallback_urls=fallback_urls,
        )

    if not adm2_path.exists():
        raise SystemExit(f"Missing {adm2_path}")
    if not fr_path.exists():
        raise SystemExit(f"Missing {fr_path}")
    if not pl_path.exists():
        raise SystemExit(f"Missing {pl_path}")
    if not ind_path.exists():
        raise SystemExit(f"Missing {ind_path}")
    if not ru_path.exists():
        raise SystemExit(f"Missing {ru_path}")
    if not ua_path.exists():
        raise SystemExit(f"Missing {ua_path}")
    if not adm1_path:
        raise SystemExit("Could not find ne_10m_admin_1_states_provinces in data/.")

    cn_groups, cn_labels = build_china_groups(adm2_path, adm1_path)
    ru_groups, ru_labels = build_russia_groups_hybrid(
        ru_path,
        adm1_path,
    )
    ind_groups, ind_labels = build_india_groups(ind_path, adm1_path=adm1_path)
    ua_groups, ua_labels = build_admin2_groups(
        ua_path,
        adm1_path,
        "UA",
        "UA",
        country_names=["Ukraine"],
    )
    pl_groups, pl_labels = build_poland_groups(pl_path)
    fr_groups, fr_labels = build_france_groups(fr_path)

    groups = {}
    labels = {}
    for source_groups, source_labels in [
        (cn_groups, cn_labels),
        (ru_groups, ru_labels),
        (ind_groups, ind_labels),
        (ua_groups, ua_labels),
        (pl_groups, pl_labels),
        (fr_groups, fr_labels),
    ]:
        groups.update(source_groups)
        labels.update(source_labels)

    topology_candidates = [
        DATA_DIR / "europe_topology.runtime_political_v1.json",
        DATA_DIR / "europe_topology.na_v2.json",
        DATA_DIR / "europe_topology.na_v1.json",
        DATA_DIR / "europe_topology.highres.json",
    ]
    topology_admin1_codes = set()
    if cfg is not None:
        topology_admin1_codes = {
            str(code).upper().strip()
            for code in getattr(cfg, "TOPOLOGY_ADMIN1_HIERARCHY_CODES", set())
            if str(code).strip()
        }
        if not topology_admin1_codes:
            topology_admin1_codes = {
                str(code).upper().strip()
                for code in getattr(cfg, "DETAIL_PARENT_SUBDIVISIONS", set())
                if str(code).strip()
            }
    if topology_admin1_codes:
        for candidate in topology_candidates:
            if not candidate.exists():
                continue
            topo_groups, topo_labels = build_topology_admin1_groups(
                candidate,
                topology_admin1_codes,
            )
            for group_id, children in topo_groups.items():
                if group_id not in groups:
                    groups[group_id] = children
            for group_id, label in topo_labels.items():
                if group_id not in labels:
                    labels[group_id] = label

    authoritative_ids, authoritative_path = load_authoritative_feature_ids()
    groups, labels, dropped_children = filter_groups_to_authoritative_ids(
        groups,
        labels,
        authoritative_ids,
    )
    if authoritative_path is not None:
        print(
            "[Hierarchy] Authority filter: "
            f"source={authoritative_path.name}, groups={len(groups)}, dropped_children={dropped_children}"
        )
    validate_country_leaf_group_coverage(
        groups,
        authoritative_ids,
        group_prefix="CN_",
        leaf_prefix="CN_CITY_",
    )

    primary_topology_path = DATA_DIR / "europe_topology.json"
    active_country_codes = collect_active_country_codes(primary_topology_path)
    country_groups = build_country_groups_from_admin0(
        DEFAULT_ADMIN0_COUNTRIES,
        active_country_codes,
    )
    interaction_policies = build_interaction_policies()

    output = {
        "groups": groups,
        "labels": labels,
        "interaction_policies": interaction_policies,
        "country_groups": country_groups,
    }
    output_path = DATA_DIR / "hierarchy.json"
    output_path.write_text(json.dumps(output, indent=2, ensure_ascii=True), encoding="utf-8")

    print(f"Wrote {output_path}")
    print(f"Groups: {len(groups)}")
    print(
        "[Hierarchy] Country groups: "
        f"{len(country_groups.get('continents', []))} continents, "
        f"{len(country_groups.get('country_meta', {}))} countries"
    )


if __name__ == "__main__":
    main()
