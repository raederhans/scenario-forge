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
    from map_builder.processors.ru_city_overrides import (
        RU_CITY_GROUP_BY_ID,
        build_ru_city_overrides,
    )
except Exception:
    RU_CITY_GROUP_BY_ID = {}
    build_ru_city_overrides = None

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
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
COUNTRY_CODE_ALIASES = {
    "UK": "GB",
    "EL": "GR",
}
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

def representative_longitudes(gdf):
    gdf = ensure_crs(gdf)
    reps = gdf.geometry.representative_point()
    return reps.x


def slugify(text):
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", str(text).strip())
    return cleaned.strip("_")


def normalize_country_code(raw):
    code = re.sub(r"[^A-Z]", "", str(raw or "").strip().upper())
    if not code or code == "ZZ":
        return ""
    return COUNTRY_CODE_ALIASES.get(code, code)


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
        raise FileNotFoundError(f"Missing admin0 countries source: {admin0_path}")
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
            nearest = gpd.sjoin_nearest(
                centroids.loc[missing].copy(),
                adm1_china,
                how="left",
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
            nearest = gpd.sjoin_nearest(
                centroids.loc[missing].copy(),
                adm1_country,
                how="left",
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

    try:
        rep_lon = representative_longitudes(adm2)
        adm2_west = adm2.loc[rep_lon < URAL_LONGITUDE].copy()
    except Exception:
        adm2_west = adm2.copy()

    adm1 = gpd.read_file(adm1_path)
    adm1 = ensure_crs(adm1)
    adm1_country = filter_admin1_by_iso(adm1, "RU", fallback_names=["Russia"])

    name_col = pick_column(adm1_country.columns, ADMIN1_NAME_COLS)
    if not name_col:
        raise ValueError("RU ADM1 missing name columns.")

    groups = defaultdict(list)
    labels = {}

    if not adm2_west.empty:
        centroids = centroid_points(adm2_west)
        adm1_join = adm1_country[[name_col, "geometry"]].copy()
        joined = gpd.sjoin(centroids, adm1_join, how="left", predicate="within")

        if joined[name_col].isna().any():
            try:
                missing = joined[name_col].isna()
                nearest = gpd.sjoin_nearest(
                    centroids.loc[missing].copy(),
                    adm1_join,
                    how="left",
                    distance_col="distance",
                )
                joined.loc[missing, name_col] = nearest[name_col].values
            except Exception:
                pass

        for _, row in joined.iterrows():
            region = row.get(name_col)
            if not region or str(region).strip() == "":
                continue
            group_id = f"RU_{slugify(region)}"
            child_id = f"RU_RAY_{row['shapeID']}"
            if child_id not in groups[group_id]:
                groups[group_id].append(child_id)
            if group_id not in labels:
                labels[group_id] = str(region)

    try:
        rep_lon_adm1 = representative_longitudes(adm1_country)
        adm1_east = adm1_country.loc[rep_lon_adm1 >= URAL_LONGITUDE].copy()
    except Exception:
        adm1_east = adm1_country.copy()

    if not adm1_east.empty:
        id_col = pick_column(adm1_east.columns, ADMIN1_ID_COLS)
        if not id_col:
            iso_col = pick_column(adm1_east.columns, ADMIN1_ISO_COLS)
            adm1_east = adm1_east.copy()
            if iso_col:
                adm1_east["adm1_code"] = (
                    adm1_east[iso_col].astype(str)
                    + "_"
                    + adm1_east[name_col].astype(str)
                )
            else:
                adm1_east["adm1_code"] = "RU_" + adm1_east[name_col].astype(str)
            id_col = "adm1_code"

        for _, row in adm1_east.iterrows():
            region = row.get(name_col)
            if not region or str(region).strip() == "":
                continue
            child_id = str(row.get(id_col, "")).strip()
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

    primary_topology_path = DATA_DIR / "europe_topology.json"
    active_country_codes = collect_active_country_codes(primary_topology_path)
    country_groups = build_country_groups_from_admin0(
        DEFAULT_ADMIN0_COUNTRIES,
        active_country_codes,
    )

    output = {
        "groups": groups,
        "labels": labels,
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
