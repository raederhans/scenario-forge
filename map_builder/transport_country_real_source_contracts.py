from __future__ import annotations

import hashlib
import json
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_CACHE_ROOT = PROJECT_ROOT / ".runtime" / "source-cache" / "transport"

FORBIDDEN_COUNTRY_PACK_BACKEND_TOKENS = (
    "checked_in_global_transport",
    "Natural Earth clip",
    "global road clip",
    "global rail clip",
    "global_road",
    "global_rail",
)


@dataclass(frozen=True)
class SourceRequirement:
    id: str
    role: str
    filename: str
    url: str
    license: str
    required_layers: tuple[str, ...] = ()
    required_fields: tuple[str, ...] = ()
    filter_rule: str = ""
    notes: str = ""
    query_params: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class CountrySourceSpec:
    pack_id: str
    family: str
    country: str
    cache_subdir: str
    source_truth: str
    geometry_truth: str
    output_contract: tuple[str, ...]
    sources: tuple[SourceRequirement, ...] = field(default_factory=tuple)


def _source(
    id: str,
    role: str,
    filename: str,
    url: str,
    license: str,
    *,
    required_layers: Iterable[str] = (),
    required_fields: Iterable[str] = (),
    filter_rule: str = "",
    notes: str = "",
    query_params: dict[str, str] | None = None,
) -> SourceRequirement:
    return SourceRequirement(
        id=id,
        role=role,
        filename=filename,
        url=url,
        license=license,
        required_layers=tuple(required_layers),
        required_fields=tuple(required_fields),
        filter_rule=filter_rule,
        notes=notes,
        query_params=dict(query_params or {}),
    )


USA_STATE_FIPS_FOR_AREALM: tuple[str, ...] = (
    "01", "02", "04", "05", "06", "08", "09", "10", "11", "12",
    "13", "15", "16", "17", "18", "19", "20", "21", "22", "23",
    "24", "25", "26", "27", "28", "29", "30", "31", "32", "33",
    "34", "35", "36", "37", "38", "39", "40", "41", "42", "44",
    "45", "46", "47", "48", "49", "50", "51", "53", "54", "55",
    "56",
)


def _usa_arealm_sources() -> tuple[SourceRequirement, ...]:
    return tuple(
        _source(
            f"census_tiger_2025_arealm_{state_fips}",
            "state_polygon_geometry",
            f"tl_2025_{state_fips}_arealm.zip",
            f"https://www2.census.gov/geo/tiger/TIGER2025/AREALM/tl_2025_{state_fips}_arealm.zip",
            "U.S. Census Bureau public data",
            required_fields=("STATEFP", "AREAID", "FULLNAME", "MTFCC", "ALAND", "AWATER", "INTPTLAT", "INTPTLON", "PARTFLG", "geometry"),
            filter_rule="Keep MTFCC K2362 Industrial Building or Industrial Park polygons.",
            notes="State-based AREALM shapefiles cover the 50 states plus DC; U.S. territories are intentionally excluded for USA carrier parity.",
        )
        for state_fips in USA_STATE_FIPS_FOR_AREALM
    )


CHINA_GEOFABRIK_SUBREGIONS: tuple[str, ...] = (
    "anhui",
    "beijing",
    "chongqing",
    "fujian",
    "gansu",
    "guangdong",
    "guangxi",
    "guizhou",
    "hainan",
    "hebei",
    "heilongjiang",
    "henan",
    "hubei",
    "hunan",
    "inner-mongolia",
    "jiangsu",
    "jiangxi",
    "jilin",
    "liaoning",
    "ningxia",
    "qinghai",
    "shaanxi",
    "shandong",
    "shanghai",
    "shanxi",
    "sichuan",
    "tianjin",
    "tibet",
    "xinjiang",
    "yunnan",
    "zhejiang",
)

INDIA_GEOFABRIK_SUBREGIONS: tuple[str, ...] = (
    "central-zone",
    "eastern-zone",
    "north-eastern-zone",
    "northern-zone",
    "southern-zone",
    "western-zone",
)

RUSSIA_GEOFABRIK_SUBREGIONS: tuple[str, ...] = (
    "central-fed-district",
    "crimean-fed-district",
    "far-eastern-fed-district",
    "kaliningrad",
    "north-caucasus-fed-district",
    "northwestern-fed-district",
    "siberian-fed-district",
    "south-fed-district",
    "ural-fed-district",
    "volga-fed-district",
)

UK_LOGISTICS_OVERPASS_QUERY = """
[out:json][timeout:120];
area["ISO3166-1"="GB"][admin_level=2]->.uk;
(
  nwr["railway"="yard"](area.uk);
  nwr["railway"="container_terminal"](area.uk);
  nwr["landuse"="railway"]["freight"="yes"](area.uk);
  nwr["industrial"="logistics"](area.uk);
  nwr["amenity"="loading_dock"](area.uk);
);
out center tags;
""".strip()

UK_INDUSTRIAL_OVERPASS_QUERY = """
[out:json][timeout:180];
area["ISO3166-1"="GB"][admin_level=2]->.uk;
(
  way["landuse"="industrial"](area.uk);
  relation["landuse"="industrial"](area.uk);
);
out center tags;
""".strip()


def _geofabrik_gpkg_sources(
    *,
    base_path: str,
    subregions: Iterable[str],
    family: str,
) -> tuple[SourceRequirement, ...]:
    if family == "road":
        required_layers = ("gis_osm_roads_free",)
        required_fields = ("osm_id", "fclass", "name", "ref", "geometry")
        filter_rule = "Read the free GeoPackage road layer, keep major road classes, then clip to the workbench carrier scope."
    else:
        required_layers = ("gis_osm_railways_free", "gis_osm_transport_free")
        required_fields = ("osm_id", "fclass", "name", "geometry")
        filter_rule = "Read the free GeoPackage rail and transport layers, keep rail lines and railway_station points, then clip to the workbench carrier scope."
    return tuple(
        _source(
            f"geofabrik_gpkg_{subregion.replace('-', '_')}",
            "osm_gpkg_subregion_extract",
            f"{subregion}-latest-free.gpkg.zip",
            f"https://download.geofabrik.de/{base_path}/{subregion}-latest-free.gpkg.zip",
            "OpenStreetMap data under ODbL 1.0 via Geofabrik public free GeoPackage extract",
            required_layers=required_layers,
            required_fields=required_fields,
            filter_rule=filter_rule,
            notes="Free GeoPackage extracts are pre-layered by Geofabrik and avoid direct country-sized PBF scans.",
        )
        for subregion in subregions
    )


def _geofabrik_facility_gpkg_sources(
    *,
    base_path: str,
    subregions: Iterable[str],
    family: str,
) -> tuple[SourceRequirement, ...]:
    if family == "industrial_zones":
        required_layers = ("gis_osm_landuse_a_free",)
        filter_rule = "Read the free GeoPackage landuse polygon layer, keep industrial landuse polygons, then filter representative points to the workbench carrier scope."
    elif family == "logistics_hubs":
        required_layers = ("gis_osm_transport_free", "gis_osm_transport_a_free")
        filter_rule = "Read the free GeoPackage transport point and area layers, keep terminal classes, then filter representative points to the workbench carrier scope."
    else:
        raise ValueError(f"Unsupported Geofabrik facility family: {family}")
    return tuple(
        _source(
            f"geofabrik_gpkg_{subregion.replace('-', '_')}",
            "osm_gpkg_subregion_extract",
            f"{subregion}-latest-free.gpkg.zip",
            f"https://download.geofabrik.de/{base_path}/{subregion}-latest-free.gpkg.zip",
            "OpenStreetMap data under ODbL 1.0 via Geofabrik public free GeoPackage extract",
            required_layers=required_layers,
            required_fields=("osm_id", "fclass", "name", "geometry"),
            filter_rule=filter_rule,
            notes="Free GeoPackage extracts are pre-layered by Geofabrik and reused across large-country road, rail, and first-wave facility packs.",
        )
        for subregion in subregions
    )


_COUNTRY_NAMES = {
    "germany": "Germany",
    "uk": "United Kingdom",
    "usa": "United States",
    "france": "France",
    "china": "China",
    "india": "India",
    "russia": "Russia",
}

_OUTPUT_CONTRACTS = {
    "road": ("roads.preview.topo.json", "roads.topo.json", "road_labels.preview.geojson", "road_labels.geojson"),
    "rail": ("railways.preview.topo.json", "railways.topo.json", "rail_stations_major.preview.geojson", "rail_stations_major.geojson"),
    "energy_facilities": ("energy_facilities.preview.geojson", "energy_facilities.geojson"),
    "industrial_zones": ("industrial_zones.preview.geojson", "industrial_zones.geojson"),
    "logistics_hubs": ("logistics_hubs.preview.geojson", "logistics_hubs.geojson"),
    "mineral_resources": ("mineral_resources.preview.geojson", "mineral_resources.geojson"),
    "airport": ("airports.preview.geojson", "airports.geojson"),
    "port": ("ports.preview.geojson", "ports.geojson"),
}


def _country_spec(
    pack_id: str,
    *,
    source_truth: str,
    geometry_truth: str,
    sources: tuple[SourceRequirement, ...],
    cache_subdir: str | None = None,
) -> CountrySourceSpec:
    country, family = pack_id.split("_", 1)
    return CountrySourceSpec(
        pack_id=pack_id,
        family=family,
        country=_COUNTRY_NAMES[country],
        cache_subdir=cache_subdir or pack_id,
        source_truth=source_truth,
        geometry_truth=geometry_truth,
        output_contract=_OUTPUT_CONTRACTS[family],
        sources=sources,
    )


def _geofabrik_osm_gpkg_spec(
    pack_id: str,
    *,
    cache_subdir: str,
    source_truth: str,
    geometry_truth: str,
    base_path: str,
    subregions: Iterable[str],
    filter_rule: str,
    notes: str,
) -> CountrySourceSpec:
    family = pack_id.split("_", 1)[1]
    return _country_spec(
        pack_id,
        cache_subdir=cache_subdir,
        source_truth=source_truth,
        geometry_truth=geometry_truth,
        sources=_geofabrik_gpkg_sources(base_path=base_path, subregions=subregions, family=family),
    )


_COUNTRY_PACKS = (
    _country_spec(
        "germany_road",
        source_truth="BKG DLM250 compact road/transport objects",
        geometry_truth="BKG DLM250 compact NAS_BDA or NAS_NBA archive",
        sources=(
            _source(
                "bkg_dlm250_compact_nas_bda",
                "primary_geometry",
                "dlm250.utm32s.nas_bda.kompakt.zip",
                "https://daten.gdz.bkg.bund.de/produkte/dlm/dlm250/aktuell/dlm250.utm32s.nas_bda.kompakt.zip",
                "Datenlizenz Deutschland Namensnennung 2.0",
                required_fields=("road_object_class", "road_class", "name", "geometry"),
                filter_rule="Map DLM250 road/transport object classes to motorway/trunk/primary; reject non-road objects.",
                notes="BKG direct download is advertised as UTM32s NAS_BDA/NAS_NBA ZIP on the product page.",
            ),
        ),
    ),
    _country_spec(
        "uk_road",
        source_truth="OS Open Roads for Great Britain plus OSNI 50K Transport Lines for Northern Ireland",
        geometry_truth="OS Open Roads GeoPackage/Shapefile and OSNI GeoJSON/Shapefile",
        sources=(
            _source(
                "os_open_roads_gb",
                "primary_geometry_gb",
                "oproad_essh_gb.zip",
                "https://api.os.uk/downloads/v1/products/OpenRoads/downloads?area=GB&format=ESRI%C2%AE+Shapefile&redirect",
                "OS OpenData / UK Open Government Licence",
                required_fields=("RoadLink", "roadClassification", "roadFunction", "formOfWay", "name1", "geometry"),
                filter_rule="Keep Great Britain motorway, trunk and primary/A-road context features; write source_region=GB.",
            ),
            _source(
                "osni_50k_transport_lines_geojson",
                "primary_geometry_ni",
                "osni_open_data_50k_transport_transport_lines.geojson",
                "https://admin.opendatani.gov.uk/dataset/bdcc2953-ed72-4f21-b012-43cbd5bbc395/resource/d09e7052-6390-4953-92da-ec3479100a7b/download/osni_open_data_50k_transport_transport_lines.geojson",
                "UK Open Government Licence / LPS Open Government Data Licence",
                required_fields=("road_class", "transport_type", "name", "geometry"),
                filter_rule="Keep Northern Ireland motorway and A-class context roads; write source_region=NI.",
            ),
        ),
    ),
    _country_spec(
        "usa_road",
        source_truth="U.S. Census TIGER/Line 2024 national primary roads",
        geometry_truth="TIGER/Line 2024 Primary Roads Shapefile",
        sources=(
            _source(
                "census_tiger_2024_primary_roads",
                "primary_geometry",
                "tl_2024_us_primaryroads.zip",
                "https://www2.census.gov/geo/tiger/TIGER2024/PRIMARYROADS/tl_2024_us_primaryroads.zip",
                "U.S. Census Bureau public data",
                required_fields=("LINEARID", "FULLNAME", "RTTYP", "MTFCC", "geometry"),
                filter_rule="Keep TIGER primary-road features; RTTYP maps Interstate/U.S./state route context classes.",
                notes="Static file is the national TIGER 2024 Primary Roads release.",
            ),
        ),
    ),
    _country_spec(
        "france_road",
        source_truth="IGN BD CARTO 5.0 September 2025 all themes for France metropolitaine",
        geometry_truth="IGN BDCARTO GeoPackage LAMB93 France metropolitaine archive",
        sources=(
            _source(
                "ign_bdcarto_5_0_fxx_gpkg",
                "primary_geometry",
                "BDCARTO_5-0_TOUSTHEMES_GPKG_LAMB93_FXX_2025-09-15.7z",
                "https://data.geopf.fr/telechargement/download/BDCARTO/BDCARTO_5-0_TOUSTHEMES_GPKG_LAMB93_FXX_2025-09-15/BDCARTO_5-0_TOUSTHEMES_GPKG_LAMB93_FXX_2025-09-15.7z",
                "Licence Ouverte / Etalab 2.0 for IGN open datasets",
                required_layers=("troncon_de_route",),
                required_fields=("cleabs", "cleabs_ge", "nature", "importance", "cpx_numero", "cpx_numero_route_europeenne", "cpx_classement_administratif", "cpx_toponyme_route_nommee", "geometry"),
                filter_rule="Use France metropolitaine FXX territory only; keep motorway and high-importance route segments for preview and broader numbered/important road context for full.",
                notes="Géoservices lists overseas territories as separate GLP/MTQ/GUF/etc archives, so the FXX archive is the intended metropolitan-France scope.",
            ),
        ),
    ),
    _geofabrik_osm_gpkg_spec(
        "china_road",
        cache_subdir="china_osm_gpkg",
        source_truth="Geofabrik China OpenStreetMap free GeoPackage subregion extracts",
        geometry_truth="OSM road lines from Geofabrik China subregion GeoPackages clipped to the China workbench carrier",
        base_path="asia/china",
        subregions=CHINA_GEOFABRIK_SUBREGIONS,
        filter_rule="Keep OSM highway motorway/trunk/primary/secondary/tertiary and link classes; clip to the China carrier scope.",
        notes="Mainland China road preview starts from the China extract; Taiwan remains a separate future sub-scope rather than being merged into this pack.",
    ),
    _geofabrik_osm_gpkg_spec(
        "india_road",
        cache_subdir="india_osm_gpkg",
        source_truth="Geofabrik India OpenStreetMap free GeoPackage zone extracts",
        geometry_truth="OSM road lines from Geofabrik India zone GeoPackages clipped to the India workbench carrier",
        base_path="asia/india",
        subregions=INDIA_GEOFABRIK_SUBREGIONS,
        filter_rule="Keep OSM highway motorway/trunk/primary/secondary/tertiary and link classes; clip to the India carrier scope.",
        notes="The first India road pack uses OSM classes as geometry truth, with national highway references retained from OSM tags when present.",
    ),
    _geofabrik_osm_gpkg_spec(
        "russia_road",
        cache_subdir="russia_osm_gpkg",
        source_truth="Geofabrik Russia OpenStreetMap free GeoPackage federal-district extracts",
        geometry_truth="OSM road lines from Geofabrik Russia federal-district GeoPackages clipped to the Russia workbench carrier",
        base_path="russia",
        subregions=RUSSIA_GEOFABRIK_SUBREGIONS,
        filter_rule="Keep OSM highway motorway/trunk/primary/secondary/tertiary and link classes; clip to the Russia carrier scope.",
        notes="Russia scope uses the national extract and carrier clipping so Kaliningrad remains in scope while foreign admin bleed is removed.",
    ),
    _country_spec(
        "france_rail",
        source_truth="SNCF RFN line shapes plus official RFN station dataset",
        geometry_truth="SNCF RFN line shapes; station points from SNCF/transport.data.gouv.fr",
        sources=(
            _source(
                "sncf_rfn_line_shapes",
                "primary_line_geometry",
                "sncf_rfn_lines_formes-des-lignes-du-rfn_2026-02-19.geojson",
                "https://data.sncf.com/api/explore/v2.1/catalog/datasets/formes-des-lignes-du-rfn/exports/geojson?lang=fr&timezone=Europe%2FParis",
                "ODbL 1.0",
                required_fields=("code_ligne", "mnemo", "libelle", "geometry"),
                filter_rule="Keep EXPLOITE lines in preview; retain full status field in full pack.",
            ),
            _source(
                "sncf_rfn_stations",
                "major_station_scope",
                "sncf_rfn_stations_liste-des-gares_2024-03-28.geojson",
                "https://data.sncf.com/api/explore/v2.1/catalog/datasets/liste-des-gares/exports/geojson?lang=fr&timezone=Europe%2FParis",
                "SNCF Open Data terms / ODbL where mirrored by data.gouv.fr",
                required_fields=("code_uic", "nom", "type", "geometry"),
                filter_rule="Major station selection comes from a repo-versioned override or official passenger/station fields.",
            ),
        ),
    ),
    _country_spec(
        "usa_rail",
        source_truth="FRA/BTS NTAD North American Rail Network mainline subset plus NTAD Amtrak Stations",
        geometry_truth="FRA/BTS ArcGIS FeatureServer exports cached as GeoJSON",
        sources=(
            _source(
                "fra_ntad_narn_lines_us_mainline",
                "arcgis_feature_service_query",
                "fra_ntad_narn_lines_us_mainline_2026-04-28.geojson",
                "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_North_American_Rail_Network_Lines/FeatureServer/0",
                "U.S. federal public data; unrestricted public use",
                required_fields=("OBJECTID", "FRAARCID", "STATEAB", "COUNTRY", "RROWNER1", "PASSNGR", "STRACNET", "NET", "MILES", "geometry"),
                filter_rule="Cache only United States NARN mainline rows where COUNTRY='US' and NET='M'; preview emphasizes passenger and STRACNET rows.",
                notes="FRA identifies NARN as the authoritative U.S. rail geospatial dataset; the cache is a paginated ArcGIS GeoJSON export.",
                query_params={
                    "where": "COUNTRY='US' AND NET='M'",
                    "outFields": "OBJECTID,FRAARCID,STATEAB,COUNTRY,RROWNER1,PASSNGR,STRACNET,NET,MILES",
                    "returnGeometry": "true",
                    "f": "geojson",
                    "resultRecordCount": "2000",
                },
            ),
            _source(
                "fra_ntad_amtrak_stations",
                "arcgis_feature_service_query",
                "fra_ntad_amtrak_stations_2026-04-22.geojson",
                "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Amtrak_Stations/FeatureServer/0",
                "U.S. federal public data; unrestricted public use",
                required_fields=("OBJECTID", "Code", "StationName", "StationFacilityName", "StaType", "geometry"),
                filter_rule="Use NTAD Amtrak station points as the major passenger-station sidecar for the U.S. rail pack.",
                notes="The NTAD layer contains Amtrak intercity railroad and bus passenger terminals in the United States.",
                query_params={
                    "where": "1=1",
                    "outFields": "OBJECTID,Code,StationName,StationFacilityName,StationAliases,StaType",
                    "returnGeometry": "true",
                    "f": "geojson",
                    "resultRecordCount": "2000",
                },
            ),
        ),
    ),
    _geofabrik_osm_gpkg_spec(
        "china_rail",
        cache_subdir="china_osm_gpkg",
        source_truth="Geofabrik China OpenStreetMap free GeoPackage subregion extracts",
        geometry_truth="OSM rail lines and railway-station points from Geofabrik China subregion GeoPackages clipped to the China workbench carrier",
        base_path="asia/china",
        subregions=CHINA_GEOFABRIK_SUBREGIONS,
        filter_rule="Keep OSM railway=rail/light_rail/subway/tram/narrow_gauge, remove service yard/siding/spur/crossover from preview, derive station sidecar from OSM point tags, and clip to the China carrier scope.",
        notes="Mainland China rail preview starts from the China extract; Taiwan rail remains a separate future sub-scope.",
    ),
    _country_spec(
        "china_energy_facilities",
        source_truth="WRI Global Power Plant Database global CSV",
        geometry_truth="WRI plant latitude/longitude points filtered to the China workbench carrier",
        sources=(
            _source(
                "wri_global_power_plant_database_csv",
                "direct_power_plant_csv",
                "global_power_plant_database.csv",
                "https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv",
                "Creative Commons Attribution 4.0 (CC BY 4.0)",
                required_fields=("country", "country_long", "name", "gppd_idnr", "capacity_mw", "latitude", "longitude", "primary_fuel", "owner", "source", "url"),
                filter_rule="Keep CHN plant rows with valid WGS84 coordinates and filter them through the China carrier scope.",
                notes="WRI publishes a global CSV release; country-specific CHN/RUS CSV files are not available in the upstream repository.",
            ),
        ),
    ),
    _country_spec(
        "china_industrial_zones",
        cache_subdir="china_osm_gpkg",
        source_truth="Geofabrik China OpenStreetMap free GeoPackage subregion extracts",
        geometry_truth="OSM landuse=industrial polygon representative points from Geofabrik China subregion GeoPackages clipped to the China workbench carrier",
        sources=_geofabrik_facility_gpkg_sources(base_path="asia/china", subregions=CHINA_GEOFABRIK_SUBREGIONS, family="industrial_zones"),
    ),
    _country_spec(
        "china_logistics_hubs",
        cache_subdir="china_osm_gpkg",
        source_truth="Geofabrik China OpenStreetMap free GeoPackage subregion extracts",
        geometry_truth="OSM transport terminal point and area representative points from Geofabrik China subregion GeoPackages clipped to the China workbench carrier",
        sources=_geofabrik_facility_gpkg_sources(base_path="asia/china", subregions=CHINA_GEOFABRIK_SUBREGIONS, family="logistics_hubs"),
    ),
    _country_spec(
        "china_mineral_resources",
        source_truth="USGS Mineral Resources Data System global point layer",
        geometry_truth="USGS MRDS point records filtered to the China workbench carrier",
        sources=(
            _source(
                "usgs_mrds_feature_service",
                "arcgis_feature_service_query",
                "usgs_mrds_global_2026-06-02.geojson",
                "https://energy.usgs.gov/arcgis/rest/services/Hosted/Mineral_Resource_Data_System/FeatureServer/0",
                "U.S. Geological Survey public data",
                required_fields=("objectid_1", "dep_id", "site_name", "dev_stat", "code_list", "grade", "geometry"),
                filter_rule="Cache global MRDS point rows, filter to the China carrier scope locally, and keep best-ranked producer/plant/prospect records first.",
                notes="MRDS is a global historical mineral occurrence database; this first China resource slice uses carrier filtering because the layer does not expose a country field.",
                query_params={
                    "where": "1=1",
                    "outFields": "objectid_1,dep_id,site_name,dev_stat,code_list,grade",
                    "returnGeometry": "true",
                    "f": "geojson",
                    "resultRecordCount": "2000",
                },
            ),
        ),
    ),
    _geofabrik_osm_gpkg_spec(
        "india_rail",
        cache_subdir="india_osm_gpkg",
        source_truth="Geofabrik India OpenStreetMap free GeoPackage zone extracts",
        geometry_truth="OSM rail lines and railway-station points from Geofabrik India zone GeoPackages clipped to the India workbench carrier",
        base_path="asia/india",
        subregions=INDIA_GEOFABRIK_SUBREGIONS,
        filter_rule="Keep OSM railway=rail/light_rail/subway/tram/narrow_gauge, remove service yard/siding/spur/crossover from preview, derive station sidecar from OSM point tags, and clip to the India carrier scope.",
        notes="The builder keeps station ref/name/operator tags where present so later Indian Railways importance ranking can enrich the sidecar.",
    ),
    _country_spec(
        "india_energy_facilities",
        source_truth="WRI Global Power Plant Database India country CSV",
        geometry_truth="WRI plant latitude/longitude points filtered to the India workbench carrier",
        sources=(
            _source(
                "wri_global_power_plant_database_india_csv",
                "direct_power_plant_csv",
                "database_IND.csv",
                "https://raw.githubusercontent.com/wri/global-power-plant-database/master/source_databases_csv/database_IND.csv",
                "Creative Commons Attribution 4.0 (CC BY 4.0)",
                required_fields=("country", "country_long", "name", "gppd_idnr", "capacity_mw", "latitude", "longitude", "primary_fuel", "owner", "source", "url"),
                filter_rule="Keep India plant rows with valid WGS84 coordinates and filter them through the India carrier scope.",
                notes="WRI publishes country-level source CSV files and the Global Power Plant Database release under CC BY 4.0.",
            ),
        ),
    ),
    _country_spec(
        "india_industrial_zones",
        cache_subdir="india_osm_gpkg",
        source_truth="Geofabrik India OpenStreetMap free GeoPackage zone extracts",
        geometry_truth="OSM landuse=industrial polygon representative points from Geofabrik India zone GeoPackages clipped to the India workbench carrier",
        sources=_geofabrik_facility_gpkg_sources(base_path="asia/india", subregions=INDIA_GEOFABRIK_SUBREGIONS, family="industrial_zones"),
    ),
    _country_spec(
        "india_logistics_hubs",
        cache_subdir="india_osm_gpkg",
        source_truth="Geofabrik India OpenStreetMap free GeoPackage zone extracts",
        geometry_truth="OSM transport terminal point and area representative points from Geofabrik India zone GeoPackages clipped to the India workbench carrier",
        sources=_geofabrik_facility_gpkg_sources(base_path="asia/india", subregions=INDIA_GEOFABRIK_SUBREGIONS, family="logistics_hubs"),
    ),
    _country_spec(
        "india_mineral_resources",
        source_truth="USGS Mineral Resources Data System global point layer",
        geometry_truth="USGS MRDS point records filtered to the India workbench carrier",
        sources=(
            _source(
                "usgs_mrds_feature_service",
                "arcgis_feature_service_query",
                "usgs_mrds_global_2026-06-02.geojson",
                "https://energy.usgs.gov/arcgis/rest/services/Hosted/Mineral_Resource_Data_System/FeatureServer/0",
                "U.S. Geological Survey public data",
                required_fields=("objectid_1", "dep_id", "site_name", "dev_stat", "code_list", "grade", "geometry"),
                filter_rule="Cache global MRDS point rows, filter to the India carrier scope locally, and keep best-ranked producer/plant/prospect records first.",
                notes="MRDS is a global historical mineral occurrence database; this first India resource slice uses carrier filtering instead of country-name fields.",
                query_params={
                    "where": "1=1",
                    "outFields": "objectid_1,dep_id,site_name,dev_stat,code_list,grade",
                    "returnGeometry": "true",
                    "f": "geojson",
                    "resultRecordCount": "2000",
                },
            ),
        ),
    ),
    _geofabrik_osm_gpkg_spec(
        "russia_rail",
        cache_subdir="russia_osm_gpkg",
        source_truth="Geofabrik Russia OpenStreetMap free GeoPackage federal-district extracts",
        geometry_truth="OSM rail lines and railway-station points from Geofabrik Russia federal-district GeoPackages clipped to the Russia workbench carrier",
        base_path="russia",
        subregions=RUSSIA_GEOFABRIK_SUBREGIONS,
        filter_rule="Keep OSM railway=rail/light_rail/subway/tram/narrow_gauge, remove service yard/siding/spur/crossover from preview, derive station sidecar from OSM point tags, and clip to the Russia carrier scope.",
        notes="Russia scope uses the national extract and carrier clipping so Kaliningrad remains in scope while foreign admin bleed is removed.",
    ),
    _country_spec(
        "russia_energy_facilities",
        source_truth="WRI Global Power Plant Database global CSV",
        geometry_truth="WRI plant latitude/longitude points filtered to the Russia workbench carrier",
        sources=(
            _source(
                "wri_global_power_plant_database_csv",
                "direct_power_plant_csv",
                "global_power_plant_database.csv",
                "https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv",
                "Creative Commons Attribution 4.0 (CC BY 4.0)",
                required_fields=("country", "country_long", "name", "gppd_idnr", "capacity_mw", "latitude", "longitude", "primary_fuel", "owner", "source", "url"),
                filter_rule="Keep RUS plant rows with valid WGS84 coordinates and filter them through the Russia carrier scope.",
                notes="WRI publishes a global CSV release; country-specific CHN/RUS CSV files are not available in the upstream repository.",
            ),
        ),
    ),
    _country_spec(
        "russia_industrial_zones",
        cache_subdir="russia_osm_gpkg",
        source_truth="Geofabrik Russia OpenStreetMap free GeoPackage federal-district extracts",
        geometry_truth="OSM landuse=industrial polygon representative points from Geofabrik Russia federal-district GeoPackages clipped to the Russia workbench carrier",
        sources=_geofabrik_facility_gpkg_sources(base_path="russia", subregions=RUSSIA_GEOFABRIK_SUBREGIONS, family="industrial_zones"),
    ),
    _country_spec(
        "russia_logistics_hubs",
        cache_subdir="russia_osm_gpkg",
        source_truth="Geofabrik Russia OpenStreetMap free GeoPackage federal-district extracts",
        geometry_truth="OSM transport terminal point and area representative points from Geofabrik Russia federal-district GeoPackages clipped to the Russia workbench carrier",
        sources=_geofabrik_facility_gpkg_sources(base_path="russia", subregions=RUSSIA_GEOFABRIK_SUBREGIONS, family="logistics_hubs"),
    ),
    _country_spec(
        "russia_mineral_resources",
        source_truth="USGS Mineral Resources Data System global point layer",
        geometry_truth="USGS MRDS point records filtered to the Russia workbench carrier",
        sources=(
            _source(
                "usgs_mrds_feature_service",
                "arcgis_feature_service_query",
                "usgs_mrds_global_2026-06-02.geojson",
                "https://energy.usgs.gov/arcgis/rest/services/Hosted/Mineral_Resource_Data_System/FeatureServer/0",
                "U.S. Geological Survey public data",
                required_fields=("objectid_1", "dep_id", "site_name", "dev_stat", "code_list", "grade", "geometry"),
                filter_rule="Cache global MRDS point rows, filter to the Russia carrier scope locally, and keep best-ranked producer/plant/prospect records first.",
                notes="MRDS is a global historical mineral occurrence database; this first Russia resource slice uses carrier filtering because the layer does not expose a country field.",
                query_params={
                    "where": "1=1",
                    "outFields": "objectid_1,dep_id,site_name,dev_stat,code_list,grade",
                    "returnGeometry": "true",
                    "f": "geojson",
                    "resultRecordCount": "2000",
                },
            ),
        ),
    ),
    _country_spec(
        "usa_energy_facilities",
        source_truth="EIA Form EIA-860 final 2024 plant and generator files",
        geometry_truth="EIA-860 plant latitude/longitude fields filtered to the United States carrier scope",
        sources=(
            _source(
                "eia_860_2024_final",
                "primary_registry_geometry",
                "eia8602024.zip",
                "https://www.eia.gov/electricity/data/eia860/xls/eia8602024.zip",
                "U.S. federal public data; preserve EIA source notice",
                required_fields=("Plant Code", "Plant Name", "State", "County", "Latitude", "Longitude", "Nameplate Capacity (MW)", "Energy Source 1", "Status"),
                filter_rule="Use plant coordinates and aggregate operable generator capacity by plant; preview sorts by capacity.",
                notes="EIA describes EIA-860 as plant/generator data for power plants with at least 1 MW combined nameplate capacity.",
            ),
        ),
    ),
    _country_spec(
        "usa_mineral_resources",
        source_truth="USGS Mineral Resources Data System FeatureServer",
        geometry_truth="USGS MRDS point layer filtered to the United States carrier scope",
        sources=(
            _source(
                "usgs_mrds_feature_service",
                "arcgis_feature_service_query",
                "usgs_mrds_2026-06-02.geojson",
                "https://energy.usgs.gov/arcgis/rest/services/Hosted/Mineral_Resource_Data_System/FeatureServer/0",
                "USGS public data; preserve USGS source notice",
                required_fields=("objectid_1", "dep_id", "site_name", "dev_stat", "code_list", "grade", "geometry"),
                filter_rule="Cache MRDS point rows, filter to USA carrier scope locally, and keep best-ranked producer/plant/prospect records first.",
                notes="MRDS is global, but USGS states the database was intended to cover the United States completely.",
                query_params={
                    "where": "1=1",
                    "outFields": "objectid_1,dep_id,site_name,dev_stat,code_list,grade",
                    "returnGeometry": "true",
                    "f": "geojson",
                    "resultRecordCount": "2000",
                },
            ),
        ),
    ),
    _country_spec(
        "usa_industrial_zones",
        source_truth="U.S. Census TIGER/Line 2025 state area landmarks",
        geometry_truth="Census AREALM polygons filtered to MTFCC K2362 Industrial Building or Industrial Park",
        sources=_usa_arealm_sources(),
    ),
    _country_spec(
        "usa_logistics_hubs",
        source_truth="BTS NTAD Intermodal Freight Facilities FeatureServer layers",
        geometry_truth="BTS ArcGIS FeatureServer point exports for rail, air-to-truck, and pipeline-terminal intermodal facilities",
        sources=(
            _source(
                "bts_intermodal_rail_tofc_cofc",
                "arcgis_feature_service_query",
                "bts_intermodal_rail_tofc_cofc_2022-07-22.geojson",
                "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_Intermodal_Freight_Facilities_Rail_TOFC_COFC/FeatureServer/0",
                "U.S. federal public data; acknowledgment of BTS",
                required_fields=("OBJECTID", "TERMINAL", "RAIL_CO", "SPLC", "geometry"),
                filter_rule="Rail TOFC/COFC intermodal freight terminals.",
                query_params={
                    "where": "1=1",
                    "outFields": "*",
                    "returnGeometry": "true",
                    "f": "geojson",
                    "resultRecordCount": "2000",
                },
            ),
            _source(
                "bts_intermodal_air_to_truck",
                "arcgis_feature_service_query",
                "bts_intermodal_air_to_truck_2020-02-24.geojson",
                "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_Intermodal_Freight_Facilities_Air_to_Truck/FeatureServer/0",
                "U.S. federal public data; acknowledgment of BTS",
                required_fields=("OBJECTID", "LOCID", "FACILITY_C", "geometry"),
                filter_rule="Air-to-truck freight intermodal facilities at major freight airports.",
                query_params={
                    "where": "1=1",
                    "outFields": "*",
                    "returnGeometry": "true",
                    "f": "geojson",
                    "resultRecordCount": "2000",
                },
            ),
            _source(
                "bts_intermodal_pipeline_terminals",
                "arcgis_feature_service_query",
                "bts_intermodal_pipeline_terminals_2021-04-21.geojson",
                "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Intermodal_Freight_Facilities_Pipeline_Terminals/FeatureServer/0",
                "U.S. federal public data; acknowledgment of BTS",
                required_fields=("OBJECTID", "TERM_NAME", "COMP_NAME", "TRUCK", "RAIL", "WATER", "geometry"),
                filter_rule="Pipeline terminals with truck/rail/water intermodal links.",
                query_params={
                    "where": "1=1",
                    "outFields": "*",
                    "returnGeometry": "true",
                    "f": "geojson",
                    "resultRecordCount": "2000",
                },
            ),
        ),
    ),
    _country_spec(
        "uk_energy_facilities",
        source_truth="DESNZ Renewable Energy Planning Database April 2026 quarterly extract",
        geometry_truth="REPD British National Grid X/Y project coordinates transformed to WGS84 and clipped to the UK carrier scope",
        sources=(
            _source(
                "desnz_repd_q1_2026_csv",
                "primary_registry_geometry",
                "REPD_publication_Q1_2026.csv",
                "https://assets.publishing.service.gov.uk/media/69fc56908cc72d2f863ea58d/REPD_publication_Q1_2026.csv",
                "UK Open Government Licence v3.0",
                required_fields=("Ref ID", "Operator (or Applicant)", "Site Name", "Technology Type", "Installed Capacity (MWelec)", "Development Status", "Country", "X-coordinate", "Y-coordinate"),
                filter_rule="Keep rows with valid British National Grid coordinates, transform EPSG:27700 to EPSG:4326, and sort preview by installed capacity.",
                notes="REPD is a UK renewable electricity project database for schemes above 150 kW and is updated quarterly by DESNZ.",
            ),
        ),
    ),
    _country_spec(
        "uk_industrial_zones",
        source_truth="OpenStreetMap UK landuse=industrial polygons via Overpass API",
        geometry_truth="Overpass JSON way/relation center coordinates for landuse=industrial polygons filtered through the UK carrier scope",
        sources=(
            _source(
                "osm_overpass_uk_industrial_landuse",
                "overpass_json_query",
                "uk_industrial_zones_osm_overpass_2026-06-02.json",
                "https://overpass-api.de/api/interpreter",
                "OpenStreetMap data under ODbL 1.0",
                required_fields=("elements", "type", "id", "tags", "center"),
                filter_rule="Keep UK way/relation landuse=industrial elements; builder converts Overpass centers to point industrial-zone features and clips to the UK carrier.",
                notes="This first UK industrial slice uses real OSM industrial polygon centers because full polygon geometry is too heavy for a stable Pages-oriented rollout.",
                query_params={"data": UK_INDUSTRIAL_OVERPASS_QUERY},
            ),
        ),
    ),
    _country_spec(
        "uk_logistics_hubs",
        source_truth="OpenStreetMap UK freight yard, container terminal, loading dock, and logistics tags via Overpass API",
        geometry_truth="Overpass JSON node coordinates and way/relation centers filtered through the UK carrier scope",
        sources=(
            _source(
                "osm_overpass_uk_logistics_facilities",
                "overpass_json_query",
                "uk_logistics_hubs_osm_overpass_2026-06-02.json",
                "https://overpass-api.de/api/interpreter",
                "OpenStreetMap data under ODbL 1.0",
                required_fields=("elements", "type", "id", "tags", "lat", "lon", "center"),
                filter_rule="Keep UK railway yards, railway container terminals, freight rail landuse, industrial=logistics, and loading_dock elements; builder converts nodes/centers to point hubs and clips to the UK carrier.",
                notes="This first UK logistics slice is a compact freight-facility point layer; it complements existing airport and port packs without publishing a country-sized OSM extract.",
                query_params={"data": UK_LOGISTICS_OVERPASS_QUERY},
            ),
        ),
    ),
    _country_spec(
        "uk_mineral_resources",
        source_truth="GSNI Northern Ireland Mineral Resources public GeoJSON package",
        geometry_truth="OpenDataNI GeoJSON mineral resource polygons converted to representative points and filtered through the UK carrier scope",
        sources=(
            _source(
                "gsni_northern_ireland_mineral_resources_json",
                "opendatani_geojson_zip",
                "mineralresourcesjson.zip",
                "https://admin.opendatani.gov.uk/dataset/a47e1630-086f-4b92-9416-1197cc8c633a/resource/d9e9d0ba-3072-4efc-ba4c-6ff26fad1c22/download/mineralresourcesjson.zip",
                "UK Open Government Licence v3.0",
                required_fields=("RESOURCE", "geometry"),
                filter_rule="Read the OpenDataNI mineral resource GeoJSON layers, convert polygons to representative points, and filter through the UK carrier scope.",
                notes="This first UK mineral resource pack covers Northern Ireland's open GSNI mineral resource layers; Great Britain BGS premium mineral-resource polygons remain a future licensed-source track.",
            ),
        ),
    ),
    _country_spec(
        "france_energy_facilities",
        source_truth="Registre national electricity production/storage above 250 kW merged with OpenStreetMap geometry",
        geometry_truth="Osmose OSM+opendata CSV.bz2 point export with lon/lat, clipped to the France metropolitan carrier scope",
        sources=(
            _source(
                "osmose_fr_power_register_opendata_250kw",
                "primary_registry_geometry",
                "registre-national-installations-electricite-250kw-osm-opendata.csv.bz2",
                "https://osmose.openstreetmap.fr/export/osm_opendata/Registre%20national%20des%20installations%20de%20production%20d'%c3%a9lectricit%c3%a9%20et%20de%20stockage-Analyser_Merge_Power_Plant_FR.byOSM.csv.bz2",
                "Open Data Commons Open Database License (ODbL)",
                required_fields=("osm_id", "lon", "lat", "name", "operator", "plant:source", "plant:method", "plant:output:electricity"),
                filter_rule="Use explicit lon/lat point rows and keep metropolitan France through the carrier scope.",
                notes="The upstream data.gouv dataset merges the French national register with OpenStreetMap power plant geometry for installations above 250 kW.",
            ),
        ),
    ),
    _country_spec(
        "france_industrial_zones",
        source_truth="IGN BD TOPO zone d'activite ou d'interet WFS",
        geometry_truth="IGN BD TOPO V3 zone_d_activite_ou_d_interet polygons filtered to industrial and commercial activity categories",
        sources=(
            _source(
                "ign_bdtopo_zone_activite_wfs",
                "wfs_feature_collection",
                "ign_bdtopo_zone_activite_industriel_commercial.geojson",
                "https://data.geopf.fr/wfs/ows",
                "Licence Ouverte / Etalab 2.0 for IGN open datasets",
                required_fields=("cleabs", "categorie", "nature", "nature_detaillee", "toponyme", "importance", "etat_de_l_objet", "geometry"),
                filter_rule="WFS CQL filter keeps categorie='Industriel et commercial'; builder further keeps industrial, activity, commercial, market, and factory polygons visible under the industrial_zones contract.",
                query_params={
                    "SERVICE": "WFS",
                    "VERSION": "2.0.0",
                    "REQUEST": "GetFeature",
                    "TYPENAMES": "BDTOPO_V3:zone_d_activite_ou_d_interet",
                    "OUTPUTFORMAT": "application/json",
                    "SRSNAME": "EPSG:4326",
                    "COUNT": "5000",
                    "CQL_FILTER": "categorie='Industriel et commercial'",
                },
            ),
        ),
    ),
    _country_spec(
        "france_mineral_resources",
        source_truth="Camino open French mining cadastre titles GeoJSON",
        geometry_truth="Camino title MultiPolygon perimeters converted to representative points and filtered to the metropolitan France carrier scope",
        sources=(
            _source(
                "camino_titles_geojson",
                "primary_cadastre_geojson",
                "camino_titres_2026-06-02.geojson",
                "https://api.camino.beta.gouv.fr/titres?format=geojson",
                "Licence Ouverte / Open Licence 2.0 via data.gouv.fr API Camino",
                required_fields=("id", "nom", "type", "domaine", "statut", "substances", "surface_totale", "departements", "regions", "geometry"),
                filter_rule="Convert public title perimeters to representative points, keep mineral/mining domains, and filter through the metropolitan France carrier scope; overseas territories are excluded by the carrier.",
                notes="Camino exposes public French mining cadastre titles and authorizations as GeoJSON through api.camino.beta.gouv.fr.",
            ),
        ),
    ),
    _country_spec(
        "france_logistics_hubs",
        source_truth="Cerema ITE 3000 French freight private sidings database",
        geometry_truth="ITE 3000 GeoJSON point locations filtered to the metropolitan France carrier scope",
        sources=(
            _source(
                "cerema_ite3000_geojson",
                "primary_logistics_geojson",
                "base-ite-3000_2026-04-15.geojson",
                "https://static.data.gouv.fr/resources/base-de-donnees-des-installations-terminales-embranchees-fret-en-france-ite-3000/20260415-093501/base-ite-3000.geojson",
                "Licence Ouverte / Open Licence 2.0",
                required_fields=("ID_ITE", "Raison_sociale", "Commune", "Utilisation_ITE", "Etat_ITE", "Convention_active", "Circulation_récente", "Produit_transporté", "geometry"),
                filter_rule="Keep point ITE records inside the metropolitan France carrier scope and map them to rail_cargo_station logistics hubs.",
                notes="ITE 3000 identifies French freight private sidings used for loading or unloading goods at industrial sites.",
            ),
        ),
    ),
    _country_spec(
        "germany_rail",
        cache_subdir="germany_road",
        source_truth="BKG DLM250 compact railway objects",
        geometry_truth="BKG DLM250 AX_Bahnstrecke and AX_Bahnverkehrsanlage objects",
        sources=(
            _source(
                "bkg_dlm250_compact_nas_bda",
                "primary_geometry",
                "dlm250.utm32s.nas_bda.kompakt.zip",
                "https://daten.gdz.bkg.bund.de/produkte/dlm/dlm250/aktuell/dlm250.utm32s.nas_bda.kompakt.zip",
                "Datenlizenz Deutschland Namensnennung 2.0",
                required_fields=("AX_Bahnstrecke", "AX_Bahnverkehrsanlage", "bahnkategorie", "geometry"),
                filter_rule="Build rail line geometry from AX_Bahnstrecke and station points from AX_Bahnverkehrsanlage.",
                notes="The cache directory intentionally reuses the Germany DLM250 source already required by germany_road.",
            ),
        ),
    ),
    _country_spec(
        "uk_rail",
        source_truth="Network Rail Infrastructure Network Model EIR release mirrored by openraildata",
        geometry_truth="Network Rail network-model GeoPackage VectorReferenceLines/VectorLinks",
        sources=(
            _source(
                "network_rail_inm_network_model_gpkg",
                "primary_line_geometry",
                "network-model.gpkg",
                "https://github.com/openraildata/network-rail-gis/releases/download/20230711-01/network-model.gpkg",
                "UK Open Government Licence via Network Rail EIR release mirror",
                required_fields=("VectorReferenceLines", "VectorNodes", "ELR", "geometry"),
                filter_rule="Use VectorReferenceLines where present, otherwise VectorLinks; station sidecar comes from named nodes.",
                notes="The upstream mirror is archived and points users to Rail Data Marketplace for current feeds; it remains the most reproducible open OGL geometry source found for this preview phase.",
            ),
            _source(
                "dft_naptan_national_access_nodes_csv",
                "major_station_scope",
                "naptan_access_nodes_2026-06-02.csv",
                "https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv",
                "UK Open Government Licence v3.0",
                required_fields=("ATCOCode", "CommonName", "StopType", "Status", "Longitude", "Latitude"),
                filter_rule="Keep Great Britain rail station and station entrance stop types; Northern Ireland stations need a later Translink/OpenDataNI source.",
                notes="NaPTAN covers England, Scotland and Wales and is the official DfT access-node register.",
            ),
        ),
    ),
    _country_spec(
        "usa_airport",
        source_truth="FAA NASR APT plus FAA passenger boarding/all-cargo statistics",
        geometry_truth="FAA NASR APT coordinates",
        sources=(
            _source(
                "faa_nasr_current",
                "primary_airport_registry_geometry",
                "14_May_2026_APT_CSV.zip",
                "https://nfdc.faa.gov/webContent/28DaySub/extra/14_May_2026_APT_CSV.zip",
                "U.S. federal public data; preserve FAA source notice",
                required_fields=("APT_BASE", "LocId", "IcaoId", "ARPLatitudeS", "ARPLongitudeS"),
                filter_rule="Object scope and coordinates come from NASR APT; exclude closed/private rows by NASR status fields.",
            ),
            _source(
                "faa_passenger_boarding_all_cargo",
                "importance_filter",
                "faa_cy2024_all_enplanements_by_state_airport.xlsx",
                "https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger/arp-cy2024-all-enplanements.xlsx",
                "U.S. federal public data; preserve FAA source notice",
                required_fields=("Locid", "CY", "Hub", "Total Enplanements"),
                filter_rule="Preview keeps airports above the agreed enplanement/cargo threshold.",
            ),
        ),
    ),
    _country_spec(
        "china_airport",
        source_truth="CAAC annual civil transport airport bulletin plus Taiwan official/open points",
        geometry_truth="Official points where available; OSM/Geofabrik only fills coordinates for official-list airports.",
        sources=(
            _source(
                "caac_2025_airport_bulletin",
                "official_scope_and_importance",
                "caac_2025_airport_throughput_ranking.xlsx",
                "https://www.caac.gov.cn/XXGK/XXGK/TJSJ/202602/P020260226360830390937.xlsx",
                "official_publication_citation_only",
                required_fields=("机场", "旅客吞吐量", "货邮吞吐量", "起降架次"),
                filter_rule="CAAC bulletin decides mainland object scope and importance.",
            ),
            _source(
                "taiwan_caa_airport_page",
                "official_scope_taiwan",
                "tw_airport_caa_airport_telephone_2024-08-08.html",
                "https://www.caa.gov.tw/Article.aspx?a=983&lang=1",
                "Taiwan Open Government Data License 1.0 where applicable",
                required_fields=("機場", "電話", "地址"),
                filter_rule="Taiwan CAA airport telephone table contributes official Taiwan airport scope; OSM only fills coordinates for matched official objects.",
            ),
            _source(
                "osm_airport_geometry_supplement",
                "coordinate_supplement_only",
                "cn_tw_airport_osm_geometry_overpass_2026-05-12.geojson",
                "https://www.openstreetmap.org/copyright",
                "ODbL 1.0",
                required_fields=("aeroway", "name", "iata", "icao", "geometry"),
                filter_rule="Match coordinates only to CAAC/Taiwan official objects; unmatched OSM rows stay out of output.",
            ),
        ),
    ),
    _country_spec(
        "russia_airport",
        source_truth="Rosaviatsiya civil aerodrome/heliport registry",
        geometry_truth="Rosaviatsiya registry if coordinates exist; OSM/Geofabrik only fills coordinates for registered objects.",
        sources=(
            _source(
                "rosaviatsiya_civil_aerodrome_registry",
                "official_scope_registry",
                "ru_airport_rosaviatsiya_civil_aerodrome_registry_2026-04-27.html",
                "https://favt.gov.ru/dejatelnost-ajeroporty-i-ajerodromy-reestr-grajdanskih-ajerodromov-rf/",
                "official_registry_citation_only",
                required_fields=("aerodrome_name", "certificate", "operator", "class", "status"),
                filter_rule="Registry decides object scope; preview uses official class/status and traffic stats when available.",
            ),
            _source(
                "osm_airport_geometry_supplement",
                "coordinate_supplement_only",
                "ru_airport_osm_geometry_overpass_2026-05-12.geojson",
                "https://download.geofabrik.de/russia.html",
                "ODbL 1.0",
                required_fields=("aeroway", "name", "name:ru", "iata", "icao", "geometry"),
                filter_rule="Match coordinates only to Rosaviatsiya registry objects; unmatched OSM rows stay out of output.",
            ),
        ),
    ),
    _country_spec(
        "india_airport",
        source_truth="AAI airport list plus AAI traffic report",
        geometry_truth="Official/AAI points where available; OSM/Geofabrik only fills coordinates for AAI-scope airports.",
        sources=(
            _source(
                "aai_airport_list_cluster_wise_2025_26",
                "official_scope_registry",
                "in_airport_aai_operational_airports_2026-05.html",
                "https://www.aai.aero/en/services/list-airports-cluster-wise-f-y-202526",
                "official_reference_citation_only",
                required_fields=("airport_name", "cluster", "region"),
                filter_rule="AAI list decides object scope.",
            ),
            _source(
                "aai_air_traffic_report_june_2025",
                "importance_filter",
                "aai_air_traffic_report_june_2025_TRJun2k25.pdf",
                "https://www.aai.aero/sites/default/files/traffic-news/TRJun2k25.pdf",
                "official_reference_citation_only",
                required_fields=("airport", "passengers", "freight", "aircraft_movements"),
                filter_rule="Preview ordering uses the repo-versioned audited extraction file whose source_pdf_sha256 must match this PDF.",
            ),
            _source(
                "osm_airport_geometry_supplement",
                "coordinate_supplement_only",
                "in_airport_osm_geometry_overpass_2026-05-12.geojson",
                "https://download.geofabrik.de/asia/india.html",
                "ODbL 1.0",
                required_fields=("aeroway", "name", "iata", "icao", "geometry"),
                filter_rule="Match coordinates only to AAI official objects; unmatched OSM rows stay out of output.",
            ),
        ),
    ),
    _country_spec(
        "germany_airport",
        source_truth="BKG POI-Open airport WFS",
        geometry_truth="BKG POI-Open flughaefen point features",
        sources=(
            _source(
                "bkg_poi_open_airports_wfs",
                "primary_airport_registry_geometry",
                "bkg_poi_open_flughaefen_2025-12.geojson",
                "https://sgx.geodatenzentrum.de/wfs_poi_open?service=WFS&version=2.0.0&request=GetFeature&typeNames=poi-open:flughaefen&outputFormat=application/json",
                "Datenlizenz Deutschland Namensnennung 2.0",
                required_fields=("poi_id", "icao_code", "typ", "geom"),
                filter_rule="Use BKG airport POI features as Germany airport scope and coordinates.",
            ),
        ),
    ),
    _country_spec(
        "france_airport",
        cache_subdir="unlocode",
        source_truth="UN/LOCODE 2025-1 function-coded airport entries",
        geometry_truth="UN/LOCODE coordinates for France airport-function locations",
        sources=(
            _source(
                "unlocode_2025_1_release",
                "primary_airport_registry_geometry",
                "unlocode_2025-1_artifacts.zip",
                "https://opensource.unicc.org/un/unece/uncefact/vocab-locode/-/jobs/artifacts/2025-1/download?job=package-release",
                "UNECE UN/LOCODE Terms and Conditions of Use",
                required_fields=("Country", "Code", "Name", "Function", "Coordinates"),
                filter_rule="Keep France rows where UN/LOCODE Function position 4 is airport and coordinates are present.",
            ),
        ),
    ),
    _country_spec(
        "uk_airport",
        cache_subdir="unlocode",
        source_truth="UN/LOCODE 2025-1 function-coded airport entries",
        geometry_truth="UN/LOCODE coordinates for Great Britain/Northern Ireland airport-function locations",
        sources=(
            _source(
                "unlocode_2025_1_release",
                "primary_airport_registry_geometry",
                "unlocode_2025-1_artifacts.zip",
                "https://opensource.unicc.org/un/unece/uncefact/vocab-locode/-/jobs/artifacts/2025-1/download?job=package-release",
                "UNECE UN/LOCODE Terms and Conditions of Use",
                required_fields=("Country", "Code", "Name", "Function", "Coordinates"),
                filter_rule="Keep United Kingdom rows where UN/LOCODE Function position 4 is airport and coordinates are present.",
            ),
        ),
    ),
    _country_spec(
        "usa_port",
        cache_subdir="unlocode",
        source_truth="UN/LOCODE 2025-1 function-coded port entries",
        geometry_truth="UN/LOCODE coordinates for U.S. port-function locations",
        sources=(
            _source(
                "unlocode_2025_1_release",
                "primary_port_registry_geometry",
                "unlocode_2025-1_artifacts.zip",
                "https://opensource.unicc.org/un/unece/uncefact/vocab-locode/-/jobs/artifacts/2025-1/download?job=package-release",
                "UNECE UN/LOCODE Terms and Conditions of Use",
                required_fields=("Country", "Code", "Name", "Function", "Coordinates"),
                filter_rule="Keep United States rows where UN/LOCODE Function position 1 is port and coordinates are present.",
            ),
        ),
    ),
    _country_spec(
        "germany_port",
        cache_subdir="unlocode",
        source_truth="UN/LOCODE 2025-1 function-coded port entries",
        geometry_truth="UN/LOCODE coordinates for Germany port-function locations",
        sources=(
            _source(
                "unlocode_2025_1_release",
                "primary_port_registry_geometry",
                "unlocode_2025-1_artifacts.zip",
                "https://opensource.unicc.org/un/unece/uncefact/vocab-locode/-/jobs/artifacts/2025-1/download?job=package-release",
                "UNECE UN/LOCODE Terms and Conditions of Use",
                required_fields=("Country", "Code", "Name", "Function", "Coordinates"),
                filter_rule="Keep Germany rows where UN/LOCODE Function position 1 is port and coordinates are present.",
            ),
        ),
    ),
    _country_spec(
        "france_port",
        cache_subdir="unlocode",
        source_truth="UN/LOCODE 2025-1 function-coded port entries",
        geometry_truth="UN/LOCODE coordinates for France port-function locations",
        sources=(
            _source(
                "unlocode_2025_1_release",
                "primary_port_registry_geometry",
                "unlocode_2025-1_artifacts.zip",
                "https://opensource.unicc.org/un/unece/uncefact/vocab-locode/-/jobs/artifacts/2025-1/download?job=package-release",
                "UNECE UN/LOCODE Terms and Conditions of Use",
                required_fields=("Country", "Code", "Name", "Function", "Coordinates"),
                filter_rule="Keep France rows where UN/LOCODE Function position 1 is port and coordinates are present.",
            ),
        ),
    ),
    _country_spec(
        "uk_port",
        cache_subdir="unlocode",
        source_truth="UN/LOCODE 2025-1 function-coded port entries",
        geometry_truth="UN/LOCODE coordinates for United Kingdom port-function locations",
        sources=(
            _source(
                "unlocode_2025_1_release",
                "primary_port_registry_geometry",
                "unlocode_2025-1_artifacts.zip",
                "https://opensource.unicc.org/un/unece/uncefact/vocab-locode/-/jobs/artifacts/2025-1/download?job=package-release",
                "UNECE UN/LOCODE Terms and Conditions of Use",
                required_fields=("Country", "Code", "Name", "Function", "Coordinates"),
                filter_rule="Keep United Kingdom rows where UN/LOCODE Function position 1 is port and coordinates are present.",
            ),
        ),
    ),
    _country_spec(
        "china_port",
        cache_subdir="unlocode",
        source_truth="UN/LOCODE 2025-1 function-coded port entries",
        geometry_truth="UN/LOCODE coordinates for China port-function locations",
        sources=(
            _source(
                "unlocode_2025_1_release",
                "primary_port_registry_geometry",
                "unlocode_2025-1_artifacts.zip",
                "https://opensource.unicc.org/un/unece/uncefact/vocab-locode/-/jobs/artifacts/2025-1/download?job=package-release",
                "UNECE UN/LOCODE Terms and Conditions of Use",
                required_fields=("Country", "Code", "Name", "Function", "Coordinates"),
                filter_rule="Keep China rows where UN/LOCODE Function position 1 is port and coordinates are present.",
            ),
        ),
    ),
    _country_spec(
        "india_port",
        cache_subdir="unlocode",
        source_truth="UN/LOCODE 2025-1 function-coded port entries",
        geometry_truth="UN/LOCODE coordinates for India port-function locations",
        sources=(
            _source(
                "unlocode_2025_1_release",
                "primary_port_registry_geometry",
                "unlocode_2025-1_artifacts.zip",
                "https://opensource.unicc.org/un/unece/uncefact/vocab-locode/-/jobs/artifacts/2025-1/download?job=package-release",
                "UNECE UN/LOCODE Terms and Conditions of Use",
                required_fields=("Country", "Code", "Name", "Function", "Coordinates"),
                filter_rule="Keep India rows where UN/LOCODE Function position 1 is port and coordinates are present.",
            ),
        ),
    ),
    _country_spec(
        "russia_port",
        cache_subdir="unlocode",
        source_truth="UN/LOCODE 2025-1 function-coded port entries",
        geometry_truth="UN/LOCODE coordinates for Russia port-function locations",
        sources=(
            _source(
                "unlocode_2025_1_release",
                "primary_port_registry_geometry",
                "unlocode_2025-1_artifacts.zip",
                "https://opensource.unicc.org/un/unece/uncefact/vocab-locode/-/jobs/artifacts/2025-1/download?job=package-release",
                "UNECE UN/LOCODE Terms and Conditions of Use",
                required_fields=("Country", "Code", "Name", "Function", "Coordinates"),
                filter_rule="Keep Russia rows where UN/LOCODE Function position 1 is port and coordinates are present.",
            ),
        ),
    ),
    _country_spec(
        "germany_energy_facilities",
        cache_subdir="germany_road",
        source_truth="BKG DLM250 compact industry and energy facility objects",
        geometry_truth="BKG DLM250 AX_BauwerkOderAnlageFuerIndustrieUndGewerbe points",
        sources=(
            _source(
                "bkg_dlm250_compact_nas_bda",
                "primary_energy_facility_geometry",
                "dlm250.utm32s.nas_bda.kompakt.zip",
                "https://daten.gdz.bkg.bund.de/produkte/dlm/dlm250/aktuell/dlm250.utm32s.nas_bda.kompakt.zip",
                "Datenlizenz Deutschland Namensnennung 2.0",
                required_fields=("AX_BauwerkOderAnlageFuerIndustrieUndGewerbe", "bauwerksfunktion", "pos"),
                filter_rule="Keep bauwerksfunktion 2530 power-plant objects.",
            ),
        ),
    ),
    _country_spec(
        "germany_mineral_resources",
        cache_subdir="germany_road",
        source_truth="BKG DLM250 quarry and open-pit objects",
        geometry_truth="BKG DLM250 AX_TagebauGrubeSteinbruch polygons converted to representative points",
        sources=(
            _source(
                "bkg_dlm250_compact_nas_bda",
                "primary_mineral_geometry",
                "dlm250.utm32s.nas_bda.kompakt.zip",
                "https://daten.gdz.bkg.bund.de/produkte/dlm/dlm250/aktuell/dlm250.utm32s.nas_bda.kompakt.zip",
                "Datenlizenz Deutschland Namensnennung 2.0",
                required_fields=("AX_TagebauGrubeSteinbruch", "name", "posList"),
                filter_rule="Build resource points from official quarry/open-pit polygons.",
            ),
        ),
    ),
    _country_spec(
        "germany_industrial_zones",
        cache_subdir="germany_road",
        source_truth="BKG DLM250 industrial and commercial area objects",
        geometry_truth="BKG DLM250 AX_IndustrieUndGewerbeflaeche polygons",
        sources=(
            _source(
                "bkg_dlm250_compact_nas_bda",
                "primary_industrial_zone_geometry",
                "dlm250.utm32s.nas_bda.kompakt.zip",
                "https://daten.gdz.bkg.bund.de/produkte/dlm/dlm250/aktuell/dlm250.utm32s.nas_bda.kompakt.zip",
                "Datenlizenz Deutschland Namensnennung 2.0",
                required_fields=("AX_IndustrieUndGewerbeflaeche", "posList"),
                filter_rule="Keep official industrial/commercial area polygons.",
            ),
        ),
    ),
    _country_spec(
        "germany_logistics_hubs",
        cache_subdir="germany_road",
        source_truth="BKG DLM250 transport facility objects",
        geometry_truth="BKG DLM250 AX_Transportanlage geometry converted to representative points",
        sources=(
            _source(
                "bkg_dlm250_compact_nas_bda",
                "primary_logistics_geometry",
                "dlm250.utm32s.nas_bda.kompakt.zip",
                "https://daten.gdz.bkg.bund.de/produkte/dlm/dlm250/aktuell/dlm250.utm32s.nas_bda.kompakt.zip",
                "Datenlizenz Deutschland Namensnennung 2.0",
                required_fields=("AX_Transportanlage", "bauwerksfunktion", "posList"),
                filter_rule="Build logistics hub points from official transport facility geometry.",
            ),
        ),
    ),
)
COUNTRY_SOURCE_SPECS: dict[str, CountrySourceSpec] = {spec.pack_id: spec for spec in _COUNTRY_PACKS}
TARGET_COUNTRY_PACK_IDS = tuple(COUNTRY_SOURCE_SPECS)


def repo_display_path(path_value: str | Path) -> str:
    path = Path(path_value)
    try:
        return path.resolve().relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def file_signature(path: Path) -> dict[str, Any]:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return {
        "filename": path.name,
        "path": repo_display_path(path),
        "size_bytes": path.stat().st_size,
        "sha256": digest.hexdigest(),
    }


def validate_overpass_json_source(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"invalid Overpass JSON: {exc}"]
    if str(payload.get("remark") or "").strip():
        errors.append(f"Overpass response contains remark: {payload.get('remark')}")
    elements = payload.get("elements")
    if not isinstance(elements, list) or not elements:
        errors.append("Overpass response has no elements")
        return errors
    for index, element in enumerate(elements):
        if not isinstance(element, dict):
            errors.append(f"element[{index}] is not an object")
            continue
        if not element.get("type") or element.get("id") is None:
            errors.append(f"element[{index}] missing type/id")
        if not isinstance(element.get("tags"), dict):
            errors.append(f"element[{index}] missing tags object")
        if element.get("type") == "node":
            if element.get("lat") is None or element.get("lon") is None:
                errors.append(f"node element[{index}] missing lat/lon")
        else:
            center = element.get("center")
            if not isinstance(center, dict) or center.get("lat") is None or center.get("lon") is None:
                errors.append(f"{element.get('type') or 'non-node'} element[{index}] missing center lat/lon")
        if errors:
            break
    return errors


def validate_opendatani_geojson_zip_source(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        with zipfile.ZipFile(path) as archive:
            json_names = [name for name in archive.namelist() if name.casefold().endswith(".json")]
            if not json_names:
                return ["GeoJSON ZIP has no .json members"]
            for name in json_names:
                with archive.open(name) as handle:
                    payload = json.load(handle)
                if payload.get("type") != "FeatureCollection":
                    errors.append(f"{name} is not a FeatureCollection")
                    break
                features = payload.get("features")
                if not isinstance(features, list) or not features:
                    errors.append(f"{name} has no features")
                    break
                properties = features[0].get("properties") or {}
                geometry = features[0].get("geometry") or {}
                if "RESOURCE" not in properties:
                    errors.append(f"{name} first feature missing RESOURCE")
                    break
                if not geometry.get("type"):
                    errors.append(f"{name} first feature missing geometry")
                    break
    except (OSError, json.JSONDecodeError, zipfile.BadZipFile) as exc:
        return [f"invalid GeoJSON ZIP: {exc}"]
    return errors


def validate_source_file(source: SourceRequirement, path: Path) -> list[str]:
    if source.role == "overpass_json_query":
        return validate_overpass_json_source(path)
    if source.role == "opendatani_geojson_zip":
        return validate_opendatani_geojson_zip_source(path)
    return []


def check_country_sources(
    spec: CountrySourceSpec,
    *,
    source_cache_root: Path = DEFAULT_SOURCE_CACHE_ROOT,
) -> dict[str, Any]:
    cache_dir = source_cache_root / spec.cache_subdir
    sources: list[dict[str, Any]] = []
    missing: list[dict[str, str]] = []
    invalid: list[dict[str, Any]] = []
    for source in spec.sources:
        path = cache_dir / source.filename
        record: dict[str, Any] = {
            "id": source.id,
            "role": source.role,
            "expected_path": path.as_posix(),
            "url": source.url,
            "license": source.license,
            "required_layers": list(source.required_layers),
            "required_fields": list(source.required_fields),
            "filter_rule": source.filter_rule,
            "notes": source.notes,
            "query_params": dict(source.query_params),
        }
        if path.is_file():
            record["signature"] = file_signature(path)
            validation_errors = validate_source_file(source, path)
            if validation_errors:
                record["validation_errors"] = validation_errors
                invalid.append({"id": source.id, "expected_path": path.as_posix(), "errors": validation_errors})
        else:
            record["missing"] = True
            missing.append({"id": source.id, "expected_path": path.as_posix(), "url": source.url})
        sources.append(record)
    return {
        "pack_id": spec.pack_id,
        "family": spec.family,
        "country": spec.country,
        "source_truth": spec.source_truth,
        "geometry_truth": spec.geometry_truth,
        "source_cache_dir": cache_dir.as_posix(),
        "sources": sources,
        "missing_sources": missing,
        "invalid_sources": invalid,
        "ready": not missing and not invalid,
    }


def build_source_recipe(spec: CountrySourceSpec, check_report: dict[str, Any]) -> dict[str, Any]:
    sanitized_sources = []
    for source in check_report.get("sources", []):
        item = dict(source)
        if "expected_path" in item:
            item["expected_path"] = repo_display_path(item["expected_path"])
        if isinstance(item.get("signature"), dict) and item["signature"].get("path"):
            item["signature"] = dict(item["signature"])
            item["signature"]["path"] = repo_display_path(item["signature"]["path"])
        sanitized_sources.append(item)
    source_signatures = {
        source["id"]: source["signature"]
        for source in check_report.get("sources", [])
        if isinstance(source, dict) and isinstance(source.get("signature"), dict)
    }
    return {
        "version": f"{spec.pack_id}_real_sources_v1",
        "pack_id": spec.pack_id,
        "family": spec.family,
        "country": spec.country,
        "source_policy": "real_source_cache_only",
        "source_cache_dir": repo_display_path(check_report["source_cache_dir"]),
        "source_truth": spec.source_truth,
        "geometry_truth": spec.geometry_truth,
        "sources": sanitized_sources,
        "source_signature": source_signatures,
        "field_mapping_status": "declared_source_requirements_only_until_source_check_is_ready",
        "output_contract": list(spec.output_contract),
    }


def scan_for_forbidden_backend_tokens(paths: Iterable[Path]) -> list[dict[str, str]]:
    offenders: list[dict[str, str]] = []
    for path in paths:
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        for token in FORBIDDEN_COUNTRY_PACK_BACKEND_TOKENS:
            if token in text:
                offenders.append({"path": repo_display_path(path), "token": token})
    return offenders
