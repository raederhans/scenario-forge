# Centralized configuration for map data pipeline.

# Data source URLs
URL = (
    "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/"
    "NUTS_RG_10M_2021_3035_LEVL_3.geojson"
)
RIVERS_URL = "https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_rivers_lake_centerlines.zip"
BORDERS_URL = "https://naturalearth.s3.amazonaws.com/50m_cultural/ne_50m_admin_0_countries.zip"
BORDER_LINES_URL = "https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_0_boundary_lines_land.zip"
OCEAN_URL = "https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_ocean.zip"
LAND_BG_URL = "https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_land.zip"
URBAN_URL = "https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_urban_areas.zip"
PHYSICAL_URL = "https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_geography_regions_polys.zip"
ADMIN1_URL = "https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_1_states_provinces.zip"

FR_ARR_URL = "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/arrondissements.geojson"
FR_ARR_FALLBACK_URLS = [
    "https://cdn.jsdelivr.net/gh/gregoiredavid/france-geojson@master/arrondissements.geojson",
]
PL_POWIATY_URL = "https://raw.githubusercontent.com/jusuff/PolandGeoJson/main/data/poland.counties.json"
PL_POWIATY_FALLBACK_URLS = [
    "https://cdn.jsdelivr.net/gh/jusuff/PolandGeoJson@main/data/poland.counties.json",
]
CHINA_CITY_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/CHN/ADM2/"
    "geoBoundaries-CHN-ADM2.geojson"
)
CHINA_CITY_FALLBACK_URLS = [
    "https://raw.githubusercontent.com/wmgeolab/geoBoundaries/main/releaseData/gbOpen/CHN/ADM2/"
    "geoBoundaries-CHN-ADM2.geojson",
    "https://cdn.jsdelivr.net/gh/wmgeolab/geoBoundaries@main/releaseData/gbOpen/CHN/ADM2/"
    "geoBoundaries-CHN-ADM2.geojson",
]
RUS_ADM2_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/RUS/ADM2/"
    "geoBoundaries-RUS-ADM2.geojson"
)
RUS_ADM2_FALLBACK_URLS = [
    "https://cdn.jsdelivr.net/gh/wmgeolab/geoBoundaries@main/releaseData/gbOpen/RUS/ADM2/"
    "geoBoundaries-RUS-ADM2.geojson",
]
UKR_ADM2_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/UKR/ADM2/"
    "geoBoundaries-UKR-ADM2.geojson"
)
UKR_ADM2_FALLBACK_URLS = [
    "https://cdn.jsdelivr.net/gh/wmgeolab/geoBoundaries@main/releaseData/gbOpen/UKR/ADM2/"
    "geoBoundaries-UKR-ADM2.geojson",
]

IND_ADM2_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/IND/ADM2/"
    "geoBoundaries-IND-ADM2.geojson"
)
IND_ADM2_FALLBACK_URLS = [
    "https://cdn.jsdelivr.net/gh/wmgeolab/geoBoundaries@main/releaseData/gbOpen/IND/ADM2/"
    "geoBoundaries-IND-ADM2.geojson",
]

# Local filenames (cache)
FR_ARR_FILENAME = "france_arrondissements.geojson"
PL_POWIATY_FILENAME = "poland_powiaty.geojson"
CHINA_ADM2_FILENAME = "china_adm2.geojson"
RUS_ADM2_FILENAME = "geoBoundaries-RUS-ADM2.geojson"
UKR_ADM2_FILENAME = "geoBoundaries-UKR-ADM2.geojson"
IND_ADM2_FILENAME = "geoBoundaries-IND-ADM2.geojson"

# Geography configuration
MAP_NAME = "Eurasia Optimized Cut"
MAP_DESCRIPTION = (
    "Eurasia-focused topology with latitude crop (-55 to 73) to remove polar overhead."
)

COUNTRY_CODES = {"DE", "PL", "IT", "FR", "NL", "BE", "LU", "AT", "CH"}
SUBDIVISIONS = {"DE", "JP", "GB"}
EXTENSION_COUNTRIES = {
    "RU",
    "BY",
    "MD",
    "MA",
    "DZ",
    "TN",
    "LY",
    "EG",
    "SA",
    "AE",
    "QA",
    "BH",
    "KW",
    "OM",
    "YE",
    "SY",
    "JO",
    "LB",
    "IL",
    "PS",
    "KZ",
    "UZ",
    "TM",
    "KG",
    "TJ",
    "IR",
    "IQ",
    "AF",
    "GE",
    "AM",
    "AZ",
    "MN",
    "JP",
    "KR",
    "KP",
    "TW",
    "NP",
    "BT",
    "MM",
    "LK",
    "PK",
    "BD",
    "TH",
    "KH",
    "VN",
    "LA",
    "MY",
    "SG",
    "PH",
}
EXCLUDED_NUTS_PREFIXES = ("FRY", "PT2", "PT3", "ES7")
MAP_BOUNDS = (-25.0, 0.0, 180.0, 83.0)

PROJECTION = {
    "center": (85.0, 30.0),
    "parallels": (20.0, 55.0),
    "scale": 0.9,
}

# Equal-area CRS + global visibility threshold used for geometry culling.
AREA_CRS = "EPSG:6933"
MIN_VISIBLE_AREA_KM2 = 50.0
TOPOLOGY_QUANTIZATION = 10_000

# Simplification tolerances (WGS84 degrees)
SIMPLIFY_NUTS3 = 0.002
SIMPLIFY_ADMIN1 = 0.02
SIMPLIFY_BORDERS = 0.005
SIMPLIFY_BORDER_LINES = 0.003
SIMPLIFY_BACKGROUND = 0.03
SIMPLIFY_URBAN = 0.01
SIMPLIFY_PHYSICAL = 0.02
SIMPLIFY_CHINA = 0.01
SIMPLIFY_RU_UA = 0.025
SIMPLIFY_INDIA = 0.015
URAL_LONGITUDE = 60.0

VIP_POINTS = [
    ("Malta", (14.3754, 35.9375)),
    ("Isle of Wight", (-1.3047, 50.6938)),
    ("Ibiza", (1.4206, 38.9067)),
    ("Menorca", (4.1105, 39.9496)),
    ("Rugen", (13.3915, 54.4174)),
    ("Bornholm", (14.9141, 55.127)),
    ("Jersey", (-2.1312, 49.2144)),
    ("Aland Islands", (19.9156, 60.1785)),
]
