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

CA_FED_2023_URL = (
    "https://ftp.maps.canada.ca/pub/elections_elections/"
    "Electoral-districts_Circonscription-electorale/"
    "federal_electoral_districts_boundaries_2023/FED_CA_2023_EN-SHP.zip"
)
CA_FED_2023_FALLBACK_URLS = [
    "https://ftp.cartes.canada.ca/pub/elections_elections/"
    "Electoral-districts_Circonscription-electorale/"
    "federal_electoral_districts_boundaries_2023/FED_CA_2023_EN-SHP.zip",
]
MEX_ADM2_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/MEX/ADM2/"
    "geoBoundaries-MEX-ADM2.geojson"
)
MEX_ADM2_FALLBACK_URLS = [
    "https://cdn.jsdelivr.net/gh/wmgeolab/geoBoundaries@main/releaseData/gbOpen/MEX/ADM2/"
    "geoBoundaries-MEX-ADM2.geojson",
]
US_COUNTY_2024_500K_URL = "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip"
US_STATE_2024_500K_URL = "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_500k.zip"
US_COUNTY_POP_2024_URL = (
    "https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/"
    "counties/totals/co-est2024-alldata.csv"
)
GB_NUTS1_2021_URL = (
    "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/"
    "NUTS_RG_10M_2021_4326_LEVL_1.geojson"
)
BIH_ADM1_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/BIH/ADM1/"
    "geoBoundaries-BIH-ADM1.geojson"
)
BIH_ADM1_FALLBACK_URLS = [
    "https://cdn.jsdelivr.net/gh/wmgeolab/geoBoundaries@main/releaseData/gbOpen/BIH/ADM1/"
    "geoBoundaries-BIH-ADM1.geojson",
]
IDN_ADM1_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/IDN/ADM1/"
    "geoBoundaries-IDN-ADM1.geojson"
)
IDN_ADM1_FALLBACK_URLS = [
    "https://cdn.jsdelivr.net/gh/wmgeolab/geoBoundaries@main/releaseData/gbOpen/IDN/ADM1/"
    "geoBoundaries-IDN-ADM1.geojson",
]
ABS_SUA_2021_GDA94_URL = (
    "https://www.abs.gov.au/statistics/standards/"
    "australian-statistical-geography-standard-asgs-edition-3/"
    "jul2021-jun2026/access-and-downloads/digital-boundary-files/"
    "SUA_2021_AUST_GDA94.zip"
)
ABS_SUA_2021_GDA94_FALLBACK_URLS: list[str] = []

# Local filenames (cache)
FR_ARR_FILENAME = "france_arrondissements.geojson"
PL_POWIATY_FILENAME = "poland_powiaty.geojson"
CHINA_ADM2_FILENAME = "china_adm2.geojson"
RUS_ADM2_FILENAME = "geoBoundaries-RUS-ADM2.geojson"
UKR_ADM2_FILENAME = "geoBoundaries-UKR-ADM2.geojson"
IND_ADM2_FILENAME = "geoBoundaries-IND-ADM2.geojson"
MEX_ADM2_FILENAME = "geoBoundaries-MEX-ADM2.geojson"
CA_FED_2023_FILENAME = "FED_CA_2023_EN-SHP.zip"
US_COUNTY_2024_500K_FILENAME = "cb_2024_us_county_500k.zip"
US_STATE_2024_500K_FILENAME = "cb_2024_us_state_500k.zip"
US_COUNTY_POP_2024_FILENAME = "co-est2024-alldata.csv"
GB_NUTS1_2021_FILENAME = "gisco_nuts_2021_level1.geojson"
BIH_ADM1_FILENAME = "geoBoundaries-BIH-ADM1.geojson"
IDN_ADM1_FILENAME = "geoBoundaries-IDN-ADM1.geojson"
ABS_SUA_2021_GDA94_FILENAME = "abs_sua_2021_aust_gda94_shp.zip"

# Geography configuration
MAP_NAME = "Global Admin-0 Skeleton"
MAP_DESCRIPTION = (
    "Global-focused topology with Admin-0 baseline and micro-island exclusions for stable first-pass coverage."
)

GLOBAL_BOUNDS = (-180.0, -90.0, 180.0, 90.0)

COUNTRY_CODES = {"DE", "PL", "IT", "FR", "NL", "BE", "LU", "AT", "CH"}
SUBDIVISIONS = {"DE", "JP", "GB"}
DETAIL_PARENT_SUBDIVISIONS = {"US", "CA", "MX"}
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
MAP_BOUNDS = GLOBAL_BOUNDS

MICRO_ISLAND_BLACKLIST = {
    # Pacific
    "AS", "CK", "FJ", "FM", "GU", "KI", "MH", "MP", "NC", "NF", "NR",
    "NU", "PF", "PN", "PW", "SB", "TK", "TO", "TV", "VU", "WF", "WS",
    # Caribbean
    "AG", "AI", "AW", "BB", "BL", "BM", "CW", "DM", "GD", "KN", "KY",
    "LC", "MF", "MS", "SX", "TC", "VC", "VG", "VI",
}

GLOBAL_TARGET_COUNTRIES = {
    # North America
    "BZ", "CA", "CR", "CU", "DO", "SV", "GL", "GT", "HT", "HN", "JM",
    "MX", "NI", "PA", "PR", "PM", "BS", "TT", "US",
    # South America
    "AR", "BO", "BR", "CL", "CO", "EC", "FK", "GY", "PY", "PE", "SR",
    "UY", "VE",
    # Africa
    "AO", "BJ", "BW", "BF", "BI", "CV", "CM", "CF", "TD", "KM", "CD",
    "DJ", "GQ", "ER", "ET", "GA", "GM", "GH", "GN", "GW", "CI", "KE",
    "LS", "LR", "MG", "MW", "ML", "MR", "MZ", "NA", "NE", "NG", "CG",
    "RW", "SN", "SL", "SO", "ZA", "SS", "SD", "ST", "TG", "UG", "TZ",
    "EH", "ZM", "ZW", "SZ",
    # Oceania
    "AU", "NZ", "PG",
    # Asia
    "BN", "TL", "HK", "ID", "MO",
    # Europe (remaining)
    "AX", "AD", "FO", "GR", "GG", "IM", "JE", "MC", "SM", "GB", "VA",
}

# Global Admin-0 skeleton mode:
# Leave allowlist empty to include all countries from the source dataset,
# then remove deferred micro-islands via MICRO_ISLAND_BLACKLIST.
COUNTRIES: set[str] = set()

GLOBAL_SKELETON_MODE = True
ENABLE_SUBDIVISION_ENRICHMENT = False

US_HYBRID_TARGET = 900
US_FIXED_FINE_STATES = {"CA", "TX", "FL"}
US_FINE_POP_PERCENTILE = 97.0
US_POP_WEIGHT_EXPONENT = 0.5
MX_TARGET_UNITS = 300

AFRICA_BASIC_NE_COUNTRIES = {
    "AO": 18,
    "BJ": 12,
    "BW": 15,
    "BI": 17,
    "CM": 10,
    "CV": 22,
    "CF": 17,
    "TD": 22,
    "KM": 3,
    "CD": 11,
    "DJ": 6,
    "GQ": 7,
    "ER": 6,
    "SZ": 4,
    "ET": 11,
    "GA": 9,
    "GH": 10,
    "GW": 9,
    "KE": 8,
    "LS": 10,
    "LR": 15,
    "MG": 22,
    "ML": 9,
    "MR": 13,
    "MZ": 11,
    "NA": 13,
    "NE": 8,
    "NG": 37,
    "CG": 12,
    "RW": 5,
    "SN": 14,
    "SL": 4,
    "SO": 13,
    "ZA": 9,
    "SS": 10,
    "SD": 17,
    "ST": 2,
    "TZ": 30,
    "GM": 6,
    "TG": 5,
    "ZM": 10,
    "ZW": 10,
}
AFRICA_BASIC_GB_OVERRIDES = {
    "BF": {
        "iso3": "BFA",
        "url": (
            "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/BFA/ADM1/"
            "geoBoundaries-BFA-ADM1.geojson"
        ),
        "fallback_urls": [
            "https://cdn.jsdelivr.net/gh/wmgeolab/geoBoundaries@main/releaseData/gbOpen/BFA/ADM1/"
            "geoBoundaries-BFA-ADM1.geojson",
        ],
        "filename": "geoBoundaries-BFA-ADM1.geojson",
        "expected_count": 13,
    },
    "GN": {
        "iso3": "GIN",
        "url": (
            "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/GIN/ADM1/"
            "geoBoundaries-GIN-ADM1.geojson"
        ),
        "fallback_urls": [
            "https://cdn.jsdelivr.net/gh/wmgeolab/geoBoundaries@main/releaseData/gbOpen/GIN/ADM1/"
            "geoBoundaries-GIN-ADM1.geojson",
        ],
        "filename": "geoBoundaries-GIN-ADM1.geojson",
        "expected_count": 8,
    },
    "CI": {
        "iso3": "CIV",
        "url": (
            "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/CIV/ADM1/"
            "geoBoundaries-CIV-ADM1.geojson"
        ),
        "fallback_urls": [
            "https://cdn.jsdelivr.net/gh/wmgeolab/geoBoundaries@main/releaseData/gbOpen/CIV/ADM1/"
            "geoBoundaries-CIV-ADM1.geojson",
        ],
        "filename": "geoBoundaries-CIV-ADM1.geojson",
        "expected_count": 14,
    },
    "MW": {
        "iso3": "MWI",
        "url": (
            "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/MWI/ADM1/"
            "geoBoundaries-MWI-ADM1.geojson"
        ),
        "fallback_urls": [
            "https://cdn.jsdelivr.net/gh/wmgeolab/geoBoundaries@main/releaseData/gbOpen/MWI/ADM1/"
            "geoBoundaries-MWI-ADM1.geojson",
        ],
        "filename": "geoBoundaries-MWI-ADM1.geojson",
        "expected_count": 3,
    },
    "UG": {
        "iso3": "UGA",
        "url": (
            "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/UGA/ADM1/"
            "geoBoundaries-UGA-ADM1.geojson"
        ),
        "fallback_urls": [
            "https://cdn.jsdelivr.net/gh/wmgeolab/geoBoundaries@main/releaseData/gbOpen/UGA/ADM1/"
            "geoBoundaries-UGA-ADM1.geojson",
        ],
        "filename": "geoBoundaries-UGA-ADM1.geojson",
        "expected_count": 4,
    },
}
AFRICA_BASIC_SKIP_COUNTRIES = {"EH"}
GLOBAL_BASIC_NE_COUNTRIES = {
    "AD": 7,
    "AR": 24,
    "BN": 4,
    "BO": 9,
    "BR": 27,
    "BZ": 6,
    "CL": 16,
    "CO": 34,
    "CR": 7,
    "DO": 32,
    "EC": 24,
    "GR": 14,
    "GT": 22,
    "GY": 10,
    "HN": 18,
    "HT": 10,
    "HK": 18,
    "LI": 11,
    "LU": 3,
    "ME": 21,
    "NI": 17,
    "PA": 12,
    "PE": 26,
    "PG": 20,
    "PY": 18,
    "SM": 9,
    "SR": 10,
    "SV": 14,
    "TL": 13,
    "UY": 19,
    "VE": 26,
    "XK": 30,
}
GLOBAL_BASIC_NE_COUNTRY_RULES = {
    iso_code: {
        "source_type": "ne_admin1",
        "expected_count": expected_count,
        "include_adm1_codes": [],
        "merge_minor_adm1_to_parent": {},
        "preserve_primary_features": [],
        "rename_map": {},
        "detail_tier": "adm1_basic",
    }
    for iso_code, expected_count in GLOBAL_BASIC_NE_COUNTRIES.items()
}
GLOBAL_BASIC_NE_COUNTRY_RULES.update(
    {
        "AU": {
            "source_type": "ne_admin1",
            "expected_count": 10,
            "include_adm1_codes": [
                "AUS-2651",
                "AUS-2650",
                "AUS-2655",
                "AUS-2657",
                "AUS-2654",
                "AUS-2656",
                "AUS-2660",
                "AUS-2653",
            ],
            "merge_minor_adm1_to_parent": {
                "AUS-1932": "AUS-2653",
                "AUS-2659": "AUS-2654",
                "AUS+00?": "AUS-2660",
            },
            "preserve_primary_features": [
                {
                    "source_id": "AU__1",
                    "target_id": "AU_REMOTE_ASHMORE_CARTIER",
                    "target_name": "Ashmore and Cartier Islands",
                    "detail_tier": "admin0_passthrough",
                    "fallback_ne_code": "ATC+00?",
                },
                {
                    "source_id": "AU__2",
                    "target_id": "AU_REMOTE_INDIAN_OCEAN_TERRITORIES",
                    "target_name": "Indian Ocean Territories",
                    "detail_tier": "admin0_passthrough",
                },
            ],
            "rename_map": {},
            "detail_tier": "adm1_basic",
        },
        "NZ": {
            "source_type": "ne_admin1",
            "expected_count": 17,
            "include_adm1_codes": [
                "NZL-3408",
                "NZL-3401",
                "NZL-3402",
                "NZL-3403",
                "NZL-3406",
                "NZL-3407",
                "NZL-3400",
                "NZL-3398",
                "NZL-5468",
                "NZL-5469",
                "NZL-3334",
                "NZL-3405",
                "NZL-3404",
                "NZL-3399",
                "NZL-3396",
                "NZL-3397",
                "NZL-5470",
            ],
            "merge_minor_adm1_to_parent": {},
            "preserve_primary_features": [],
            "rename_map": {},
            "detail_tier": "adm1_basic",
        },
    }
)
GLOBAL_BASIC_SPECIAL_SOURCES = {
    "GB": {
        "source_type": "gisco_nuts1",
        "url": GB_NUTS1_2021_URL,
        "fallback_urls": [],
        "filename": GB_NUTS1_2021_FILENAME,
        "expected_count": 12,
    },
    "BA": {
        "source_type": "geoBoundaries_adm1",
        "url": BIH_ADM1_URL,
        "fallback_urls": BIH_ADM1_FALLBACK_URLS,
        "filename": BIH_ADM1_FILENAME,
        "expected_count": 3,
    },
    "ID": {
        "source_type": "geoBoundaries_adm1",
        "url": IDN_ADM1_URL,
        "fallback_urls": IDN_ADM1_FALLBACK_URLS,
        "filename": IDN_ADM1_FILENAME,
        "expected_count": 34,
    },
}
GLOBAL_BASIC_PASSTHROUGH_COUNTRIES = {"MC", "MO", "EH"}
TOPOLOGY_ADMIN1_HIERARCHY_CODES = (
    set(DETAIL_PARENT_SUBDIVISIONS)
    | set(AFRICA_BASIC_NE_COUNTRIES.keys())
    | set(AFRICA_BASIC_GB_OVERRIDES.keys())
    | set(GLOBAL_BASIC_NE_COUNTRY_RULES.keys())
    | set(GLOBAL_BASIC_SPECIAL_SOURCES.keys())
)

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
SIMPLIFY_US_COUNTY = 0.01
SIMPLIFY_CANADA_FED = 0.01
SIMPLIFY_MEXICO_ZONES = 0.012
SIMPLIFY_AFRICA_ADMIN1 = 0.02
SIMPLIFY_GLOBAL_BASIC_ADMIN1 = 0.02
SIMPLIFY_GB_NUTS1 = 0.01
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
