from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from shapely.geometry import LineString, Polygon, box, mapping, shape
from shapely.ops import unary_union

from map_builder.geo import marine_refinement as marine


WAVE7_PROBES = json.loads((Path(__file__).parent / "fixtures/ocean_wave7_probes.json").read_text(encoding="utf-8"))


NORTH_SEA_DETAILS = (
    ("dornoch_firth", "Dornoch Firth", "多诺赫湾", "24186", "channel"),
    ("firth_of_tay", "Firth of Tay", "泰湾", "24189", "channel"),
    ("tees_bay", "Tees Bay", "蒂斯湾", "24190", "bay"),
    ("bridlington_bay", "Bridlington Bay", "布里德灵顿湾", "24191", "bay"),
    ("westray_firth", "Westray Firth", "韦斯特雷海峡", "24180", "channel"),
    ("stronsay_firth", "Stronsay Firth", "斯特朗赛海峡", "24181", "channel"),
    ("scapa_flow", "Scapa Flow", "斯卡帕湾", "24182", "bay"),
    ("yell_sound", "Yell Sound", "耶尔海峡", "24184", "channel"),
)


OLD_MACRO_SLUGS = frozenset((
    "flores_sea", "bali_sea", "sunda_strait", "sumba_strait", "sawu_sea", "gulf_of_tomini",
    "gulf_of_bone", "aru_sea", "ceram_sea", "berau_gulf", "florida_strait", "kara_sea",
    "laptev_sea", "east_siberian_sea", "chukchi_sea", "bering_strait", "strait_of_hormuz",
    "bay_of_fundy", "gulf_of_maine", "rio_de_la_plata", "davis_strait", "gulf_of_panama",
    "gulf_of_california", "coastal_waters_of_southeast_alaska_and_british_columbia",
    "solomon_sea", "bismarck_sea", "riiser_larsen_sea", "cooperation_sea", "davis_sea",
    "lazarev_sea", "cosmonauts_sea", "bellingshausen_sea", "amundsen_sea", "mawson_sea",
    "dumont_durville_sea", "somov_sea", "white_sea", "iceland_sea", "lincoln_sea",
    "gulf_of_mannar", "palk_strait_and_palk_bay", "lakshadweep_sea", "bransfield_strait",
    "drake_passage", "tryoshnikova_gulf",
))


WAVE6_SEAS = (
    ("kilbrannan_sound", "Kilbrannan Sound", "基尔布兰南海峡", "24238", "channel"),
    ("firth_of_clyde", "Firth of Clyde", "克莱德湾", "24239", "channel"),
    ("inner_seas_off_west_coast_scotland", "Inner Seas off the West Coast of Scotland", "苏格兰西岸内海", "24234", "sea"),
    ("little_minch", "Little Minch", "小明奇海峡", "24242", "channel"),
    ("firth_of_lorn", "Firth of Lorn", "洛恩湾", "24240", "channel"),
    ("sea_of_hebrides", "Sea of the Hebrides", "赫布里底海", "24241", "sea"),
    ("lough_foyle", "Lough Foyle", "福伊尔湾", "24235", "estuary"),
    ("sound_of_jura", "Sound of Jura", "朱拉海峡", "24237", "channel"),
    ("northern_minch", "Northern Minch", "北明奇海峡", "24243", "channel"),
    ("st_magnus_bay", "St. Magnus Bay", "圣马格努斯湾", "24183", "bay"),
    ("gulf_of_kutch", "Gulf of Kutch", "卡奇湾", "17457", "gulf"),
    ("gulf_of_martaban", "Gulf of Martaban", "莫塔马湾", "22290", "gulf"),
    ("phang_nga_bay", "Phang Nga Bay", "攀牙湾", "22447", "bay"),
    ("tambalagam_bay", "Tambalagam Bay", "坦巴拉加姆湾", "32543", "bay"),
    ("king_sound", "King Sound", "金湾", "33014", "bay"),
    ("cockburn_sound", "Cockburn Sound", "科伯恩湾", "32380", "bay"),
    ("spencer_gulf", "Spencer Gulf", "斯宾塞湾", "17864", "gulf"),
    ("van_diemen_gulf", "Van Diemen Gulf", "范迪门湾", "14930", "gulf"),
    ("melville_bay", "Melville Bay", "梅尔维尔湾", "32384", "bay"),
    ("port_darwin", "Port Darwin", "达尔文港湾", "32868", "bay"),
    ("champion_bay", "Champion Bay", "钱皮恩湾", "32439", "bay"),
    ("two_peoples_bay", "Two people's Bay", "双人湾", "21543", "bay"),
    ("ambaro_bay", "Ambaro Bay", "安巴鲁湾", "32959", "bay"),
    ("khalij_tarut", "Tarut Bay", "塔鲁特湾", "32980", "bay"),
    ("adventure_bay", "Adventure Bay", "探险湾", "32462", "bay"),
    ("balayan_bay", "Balayan Bay", "巴拉延湾", "32947", "bay"),
    ("cleveland_bay", "Cleveland Bay", "克利夫兰湾", "31575", "bay"),
    ("corner_inlet", "Corner Inlet", "科纳湾", "32722", "bay"),
    ("disaster_bay", "Disaster Bay", "迪萨斯特湾", "32379", "bay"),
    ("enshu_nada", "Enshu-nada", "远州滩", "32816", "sea"),
    ("fife_bay", "Fife Bay", "法伊夫湾", "33823", "bay"),
    ("halifax_bay", "Halifax Bay", "哈利法克斯湾", "32377", "bay"),
    ("kerema_bay", "Kerema Bay", "凯雷马湾", "33873", "bay"),
    ("manila_bay", "Manila Bay", "马尼拉湾", "31579", "bay"),
    ("nha_trang_bay", "Bay of Nha Trang", "芽庄湾", "8902", "bay"),
    ("sagami_bay", "Sagami Bay", "相模湾", "26748", "bay"),
    ("tosa_bay", "Tosa Bay", "土佐湾", "15313", "bay"),
)
WAVE6_DETAIL_PARENTS = {
    "gulf_of_kutch": "arabian_sea", "gulf_of_martaban": "andaman_sea",
    "melville_bay": "arafura_sea", "khalij_tarut": "persian_gulf",
}
WAVE6_ROUTE_GROUPS = {
    "northeast_atlantic_ocean": tuple(row[0] for row in WAVE6_SEAS[:10]),
    "western_indian_ocean": ("gulf_of_kutch", "ambaro_bay", "khalij_tarut"),
    "eastern_indian_ocean": ("gulf_of_martaban", "phang_nga_bay", "tambalagam_bay", "king_sound", "van_diemen_gulf", "port_darwin"),
    "southern_indian_ocean": ("cockburn_sound", "spencer_gulf", "champion_bay", "two_peoples_bay"),
    "west_central_pacific_ocean": ("melville_bay", "balayan_bay", "cleveland_bay", "fife_bay", "halifax_bay", "kerema_bay", "manila_bay", "nha_trang_bay"),
    "southwest_pacific_ocean": ("adventure_bay", "corner_inlet", "disaster_bay"),
    "northwest_pacific_ocean": ("enshu_nada", "sagami_bay", "tosa_bay"),
}


def feature(feature_id, geometry, **props):
    return {"type": "Feature", "properties": {"id": feature_id, **props}, "geometry": mapping(geometry)}


class MarineRefinementTests(unittest.TestCase):
    def test_source_seam_reconciliation_is_order_independent_and_keeps_union(self):
        a = feature("marine_north_sea", box(0, 0, 5, 5))
        b = feature("marine_norwegian_sea", box(0, 4, 5, 8))
        first = marine.reconcile_marine_source_boundaries({"features": [a, b]})
        second = marine.reconcile_marine_source_boundaries({"features": [b, a]})
        geometries = {f["properties"]["id"]: shape(f["geometry"]) for f in first["features"]}
        for f in second["features"]:
            self.assertTrue(shape(f["geometry"]).equals(geometries[f["properties"]["id"]]))
        left, right = geometries.values()
        self.assertEqual(left.intersection(right).area, 0)
        self.assertTrue(left.union(right).equals(box(0, 0, 5, 8)))

    def test_new_source_seams_keep_union_for_base_and_scenario_ids(self):
        pairs = (("barents_sea", "kara_sea"), ("kara_sea", "laptev_sea"),
                 ("laptev_sea", "east_siberian_sea"), ("beaufort_sea", "chukchi_sea"),
                 ("bering_sea", "bering_strait"), ("persian_gulf", "strait_of_hormuz"),
                 ("davis_strait", "hudson_strait"),
                 ("white_sea", "barents_sea"), ("iceland_sea", "greenland_sea"),
                 ("iceland_sea", "norwegian_sea"), ("lincoln_sea", "baffin_bay"),
                 ("gulf_of_mannar", "palk_strait_and_palk_bay"),
                 ("lakshadweep_sea", "arabian_sea"), ("bransfield_strait", "scotia_sea"),
                 ("bransfield_strait", "weddell_sea"), ("drake_passage", "scotia_sea"),
                 ("drake_passage", "bransfield_strait"))
        for prefix in ("marine_", "tno_"):
            for parent, child in pairs:
                with self.subTest(prefix=prefix, parent=parent, child=child):
                    inputs = [feature(prefix + parent, box(0, 0, 5, 5)),
                              feature(prefix + child, box(4, 0, 7, 5))]
                    result = marine.reconcile_marine_source_boundaries({"features": inputs})
                    left, right = [shape(f["geometry"]) for f in result["features"]]
                    self.assertEqual(left.intersection(right).area, 0)
                    self.assertTrue(left.union(right).equals(box(0, 0, 7, 5)))
                    self.assertEqual(inputs[0]["geometry"], mapping(box(0, 0, 5, 5)))

    def test_real_wave4_source_reconciliation_is_exclusive_and_preserves_union(self):
        source_by_id = {
            f["properties"]["id"]: f
            for f in marine.load_collection(marine.SOURCE_PATH)["features"]
        }
        groups = (
            ("white_sea", "barents_sea"),
            ("iceland_sea", "greenland_sea", "norwegian_sea"),
            ("lincoln_sea", "baffin_bay"),
            ("gulf_of_mannar", "palk_strait_and_palk_bay"),
            ("lakshadweep_sea", "arabian_sea"),
            ("drake_passage", "bransfield_strait", "scotia_sea", "weddell_sea"),
        )
        for slugs in groups:
            originals = [source_by_id["marine_" + slug] for slug in slugs]
            expected_union = unary_union([shape(f["geometry"]) for f in originals])
            for prefix in ("marine_", "tno_"):
                with self.subTest(group=slugs, prefix=prefix):
                    inputs = [{**f, "properties": {**f["properties"], "id": prefix + slug}}
                              for f, slug in zip(originals, slugs)]
                    result = marine.reconcile_marine_source_boundaries({"features": inputs})
                    reverse = marine.reconcile_marine_source_boundaries({"features": list(reversed(inputs))})
                    output = {f["properties"]["id"]: shape(f["geometry"]) for f in result["features"]}
                    for f in reverse["features"]:
                        self.assertTrue(shape(f["geometry"]).equals(output[f["properties"]["id"]]))
                    geometries = list(output.values())
                    for index, left in enumerate(geometries):
                        for right in geometries[index + 1:]:
                            self.assertLessEqual(left.intersection(right).area, 1e-8)
                    self.assertLessEqual(unary_union(geometries).symmetric_difference(expected_union).area, 1e-8)
                    # Each group ends with the protected owner of its shared seam.
                    protected = slugs[-1]
                    expected = shape(source_by_id["marine_" + protected]["geometry"])
                    self.assertTrue(output[prefix + protected].equals(expected))

    def test_real_alaska_and_davis_source_seams_preserve_named_interiors(self):
        source_by_id = {}
        for path in (marine.ROOT / "data/water_regions.geojson", marine.ADDITIONAL_SOURCE_PATH):
            source_by_id.update({
                feature["properties"]["id"]: feature
                for feature in marine.load_collection(path)["features"]
            })

        cases = (
            ("marine_coastal_waters_of_southeast_alaska_and_british_columbia", "marine_salish_sea"),
            ("marine_davis_strait", "marine_hudson_strait"),
        )
        for broad_id, protected_id in cases:
            with self.subTest(broad=broad_id, protected=protected_id):
                broad = source_by_id[broad_id]
                protected = source_by_id[protected_id]
                broad_geometry = shape(broad["geometry"])
                protected_geometry = shape(protected["geometry"])
                overlap = broad_geometry.intersection(protected_geometry)
                self.assertFalse(overlap.is_empty)
                self.assertGreater(overlap.area, 0)
                probe = overlap.representative_point()

                result = marine.reconcile_marine_source_boundaries({"features": [broad, protected]})
                output = {f["properties"]["id"]: shape(f["geometry"]) for f in result["features"]}
                self.assertTrue(output[protected_id].covers(probe))
                self.assertFalse(output[broad_id].covers(probe))
                self.assertLessEqual(output[broad_id].intersection(output[protected_id]).area, 1e-8)
                self.assertLessEqual(
                    output[broad_id].union(output[protected_id]).symmetric_difference(
                        broad_geometry.union(protected_geometry)
                    ).area,
                    1e-8,
                )

    def test_shared_source_preserves_lakes_med_and_old_identity(self):
        lake = feature("lake", box(0, 0, 1, 1), water_type="lake")
        med = feature("med", box(2, 2, 3, 3), region_group="mediterranean")
        ocean = feature("ocean", box(0, 0, 10, 10), water_type="ocean")
        old = feature("sea", box(0, 0, 4, 4), name="Sea")
        new = feature("sea", box(0, 0, 3, 4), name="Sea")
        sector = feature("sector", box(-5, -5, 5, 5), water_type="ocean", parent_id="ocean")
        source = {"type": "FeatureCollection", "features": [lake, med, ocean, old]}
        with patch.object(marine, "load_collection", return_value={"features": [new, sector]}):
            result = marine.refine_base_water_regions(source)
        by_id = {f["properties"]["id"]: f for f in result["features"]}
        self.assertEqual(by_id["lake"], lake)
        self.assertEqual(by_id["med"], med)
        self.assertEqual(by_id["sea"], new)
        self.assertEqual(len(by_id), 5)
        self.assertTrue(shape(by_id["sector"]["geometry"]).equals(box(0, 0, 5, 5)))
        self.assertEqual(source["features"][-1], old)

    def test_legacy_ocean_union_recovers_subdivided_source_without_mutation(self):
        parent = feature("ocean", box(5, 0, 10, 10), water_type="ocean")
        child = feature("sector", box(0, 0, 5, 10), water_type="ocean", parent_id="ocean")
        original = {"type": "FeatureCollection", "features": [parent, child]}
        result = marine.restore_ocean_parent_footprints(original)
        self.assertTrue(shape(result["features"][0]["geometry"]).equals(box(0, 0, 10, 10)))
        self.assertEqual(original["features"][0], parent)

    def test_supplement_is_public_polygon_data_with_unique_source_ids(self):
        source = marine.load_collection(marine.ADDITIONAL_SOURCE_PATH)
        self.assertEqual(len(source["features"]), len(marine.ADDITIONAL_SEAS) + len(marine.OCEAN_SECTORS))
        ids = [f["properties"]["id"] for f in source["features"]]
        self.assertEqual(len(set(ids)), len(ids))
        old_source_slugs = (
            OLD_MACRO_SLUGS | {row[0] for row in NORTH_SEA_DETAILS}
            | {row[0] for row in marine.OCEAN_SECTORS}
        )
        old_source_ids = {"marine_" + slug for slug in old_source_slugs}
        for f in source["features"]:
            self.assertTrue(shape(f["geometry"]).is_valid)
            self.assertFalse(shape(f["geometry"]).is_empty)
            props = f["properties"]
            count = props["source_feature_count"]
            self.assertIs(type(count), int)
            self.assertGreater(count, 0, props["id"])
            if props["id"] in old_source_ids:
                self.assertEqual(count, 1, props["id"])
            elif props["id"] == "marine_cockburn_sound":
                self.assertEqual(count, 2)
            self.assertTrue(f["properties"]["source_record_ids"])
            self.assertNotIn("scenario_id", f["properties"])
        tno = marine.additional_snapshot_features()
        self.assertEqual(len(tno), len(marine.ADDITIONAL_SEAS))
        self.assertTrue(all(f["properties"]["id"].startswith("tno_") for f in tno))

    def test_next_antarctic_sea_ids_sources_and_tno_routes(self):
        expected_records = {
            "marine_mawson_sea": "mrgid_sr:24155",
            "marine_dumont_durville_sea": "mrgid_sr:24156",
            "marine_somov_sea": "mrgid_sr:24157",
        }
        source = marine.load_collection(marine.ADDITIONAL_SOURCE_PATH)
        source_by_id = {f["properties"]["id"]: f for f in source["features"]}
        for feature_id, source_record_id in expected_records.items():
            with self.subTest(feature_id=feature_id):
                entry = source_by_id[feature_id]
                self.assertEqual(entry["properties"]["source_record_ids"], [source_record_id])
                self.assertEqual(entry["properties"]["source_feature_count"], 1)
                self.assertTrue(shape(entry["geometry"]).is_valid)
                self.assertFalse(shape(entry["geometry"]).is_empty)

        snapshot_ids = {f["properties"]["id"] for f in marine.additional_snapshot_features()}
        self.assertTrue({feature_id.replace("marine_", "tno_", 1) for feature_id in expected_records} <= snapshot_ids)

        specs = {spec["id"]: spec for spec in marine.tno_additional_specs()}
        expected_routes = {
            "tno_mawson_sea": {"tno_south_indian_antarctic_ocean"},
            "tno_dumont_durville_sea": {"tno_south_indian_antarctic_ocean"},
            "tno_somov_sea": {"tno_south_indian_antarctic_ocean", "tno_south_pacific_antarctic_ocean"},
        }
        for feature_id, route in expected_routes.items():
            with self.subTest(feature_id=feature_id):
                self.assertEqual(set(specs[feature_id]["clip_open_ocean_ids"]), route)

    def test_wave4_sources_preserve_independent_record_identities(self):
        expected_records = {
            "white_sea": "24020",
            "iceland_sea": "24021",
            "lincoln_sea": "24032",
            "gulf_of_mannar": "24067",
            "palk_strait_and_palk_bay": "24068",
            "lakshadweep_sea": "24070",
            "bransfield_strait": "24158",
            "drake_passage": "24160",
            "tryoshnikova_gulf": "24149",
        }
        macro_rows = [row for row in marine.ADDITIONAL_SEAS if row[0] in OLD_MACRO_SLUGS]
        self.assertEqual(len(macro_rows), 45)
        self.assertEqual({row[0] for row in macro_rows}, OLD_MACRO_SLUGS)
        sources = {f["properties"]["id"]: f for f in marine.load_collection(marine.ADDITIONAL_SOURCE_PATH)["features"]}
        snapshots = {f["properties"]["id"]: f for f in marine.additional_snapshot_features()}
        specs = {spec["id"]: spec for spec in marine.tno_additional_specs()}
        expected_routes = {
            "white_sea": {"tno_eastern_arctic_ocean"},
            "iceland_sea": {"tno_northeast_atlantic_ocean", "tno_western_arctic_ocean"},
            "lincoln_sea": {"tno_western_arctic_ocean"},
            "gulf_of_mannar": {"tno_western_indian_ocean", "tno_eastern_indian_ocean"},
            "palk_strait_and_palk_bay": {"tno_western_indian_ocean", "tno_eastern_indian_ocean"},
            "lakshadweep_sea": {"tno_western_indian_ocean", "tno_eastern_indian_ocean"},
            "bransfield_strait": {"tno_south_atlantic_antarctic_ocean"},
            "drake_passage": {"tno_southwest_atlantic_ocean", "tno_south_atlantic_antarctic_ocean"},
            "tryoshnikova_gulf": {"tno_south_indian_antarctic_ocean"},
        }
        for slug, record in expected_records.items():
            with self.subTest(slug=slug):
                source = sources["marine_" + slug]
                props = source["properties"]
                self.assertEqual(props["source_record_ids"], ["mrgid_sr:" + record])
                self.assertEqual(props["source_query"], f"mrgid_sr='{record}'")
                self.assertEqual(props["source_feature_count"], 1)
                self.assertEqual(props["source_simplify_degrees"], 0.005)
                self.assertEqual(props["region_group"], "marine_macro")
                self.assertEqual(props["parent_id"], "")
                self.assertEqual(snapshots["tno_" + slug]["properties"]["source_record_ids"], ["mrgid_sr:" + record])
                self.assertTrue(shape(source["geometry"]).is_valid)
                self.assertFalse(shape(source["geometry"]).is_empty)
                self.assertEqual(specs["tno_" + slug]["source_query"], f"mrgid_sr='{record}'")
                self.assertEqual(set(specs["tno_" + slug]["clip_open_ocean_ids"]), expected_routes[slug])

        gulf = sources["marine_tryoshnikova_gulf"]["properties"]
        self.assertEqual(gulf["water_type"], "gulf")
        self.assertFalse(gulf["is_chokepoint"])
        self.assertEqual(specs["tno_tryoshnikova_gulf"]["region_group"], "marine_macro")
        self.assertEqual(specs["tno_tryoshnikova_gulf"]["water_type"], "gulf")
        self.assertEqual(
            set(specs["tno_tryoshnikova_gulf"]["clip_open_ocean_ids"]),
            {"tno_south_indian_antarctic_ocean"},
        )

    def test_north_sea_detail_specs_keep_five_field_rows_and_precise_source_contract(self):
        rows = {row[0]: row for row in marine.ADDITIONAL_SEAS}
        self.assertTrue(all(len(row) == 5 for row in marine.ADDITIONAL_SEAS))
        self.assertEqual(
            {slug for slug, parent in marine.ADDITIONAL_DETAIL_PARENTS.items() if parent == "north_sea"},
            {row[0] for row in NORTH_SEA_DETAILS},
        )
        specs = {spec["id"]: spec for spec in marine.tno_additional_specs()}
        for row in NORTH_SEA_DETAILS:
            slug, name, _zh, record, kind = row
            with self.subTest(slug=slug):
                self.assertEqual(rows[slug], row)
                spec = specs["tno_" + slug]
                self.assertEqual(spec["name"], name)
                self.assertEqual(spec["water_type"], kind)
                self.assertEqual(spec["region_group"], "marine_detail")
                self.assertEqual(spec["parent_id"], "tno_north_sea")
                self.assertEqual(spec["source_query"], f"mrgid_sr='{record}'")
                self.assertEqual(spec["source_standard"], "marine_regions_seavox_v19")
                self.assertEqual(spec["simplify_tolerance"], 0.004)
                self.assertEqual(spec["clip_open_ocean_ids"], ("tno_northeast_atlantic_ocean",))
                self.assertEqual(marine.additional_source_simplify_degrees(slug), 0.004)
        macro_rows = [row for row in marine.ADDITIONAL_SEAS if row[0] in OLD_MACRO_SLUGS]
        self.assertEqual(len(macro_rows), 45)
        self.assertEqual({row[0] for row in macro_rows}, OLD_MACRO_SLUGS)
        for slug, *_ in macro_rows:
            with self.subTest(macro=slug):
                self.assertEqual(specs["tno_" + slug]["region_group"], "marine_macro")
                self.assertFalse(specs["tno_" + slug].get("parent_id"))
                self.assertEqual(specs["tno_" + slug]["simplify_tolerance"], 0.005)
                self.assertEqual(marine.additional_source_simplify_degrees(slug), 0.005)
        for slug, *_ in marine.OCEAN_SECTORS:
            self.assertEqual(marine.additional_source_simplify_degrees(slug), 0.005)

    def test_detail_snapshot_converts_parent_without_mutating_base_source(self):
        slug = NORTH_SEA_DETAILS[0][0]
        source = {"features": [feature(
            "marine_" + slug, box(0, 0, 1, 1), region_group="marine_detail",
            parent_id="marine_north_sea", source_record_ids=["mrgid_sr:24186"],
        )]}
        original = deepcopy(source)
        with patch.object(marine, "load_collection", return_value=source):
            snapshots = marine.additional_snapshot_features()
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(snapshots[0]["properties"]["id"], "tno_" + slug)
        self.assertEqual(snapshots[0]["properties"]["parent_id"], "tno_north_sea")
        self.assertEqual(source, original)
        snapshots[0]["properties"]["source_record_ids"].append("fixture:changed")
        snapshots[0]["geometry"] = mapping(box(2, 2, 3, 3))
        self.assertEqual(source, original)

    def test_refresh_simplifies_detail_geometry_at_004_and_macro_and_ocean_at_005(self):
        from tools import build_marine_refinement_sources as builder

        # The peak survives .004 but disappears at .005, proving geometry precision,
        # rather than merely checking the recorded source_simplify_degrees property.
        raw = Polygon([(0, 0), (1, 0), (1, 1), (0.5, 1.0045), (0, 1), (0, 0)])
        expected_detail = raw.simplify(0.004, preserve_topology=True)
        expected_macro = raw.simplify(0.005, preserve_topology=True)
        self.assertFalse(expected_detail.equals(expected_macro))
        detail = NORTH_SEA_DETAILS[0]
        macro = next(row for row in marine.ADDITIONAL_SEAS if row[0] == "white_sea")
        ocean = marine.OCEAN_SECTORS[0]

        def response(_url, *, params, timeout):
            self.assertEqual(timeout, 60)
            record = params["CQL_FILTER"].split("'")[1]
            return Mock(
                url=builder.WFS + "?CQL_FILTER=" + params["CQL_FILTER"],
                json=Mock(return_value={"features": [feature("fixture", raw, mrgid_sr=record)]}),
            )

        with TemporaryDirectory(dir=marine.ROOT / ".runtime/tmp") as directory:
            path = Path(directory) / "source.geojson"
            with patch.object(builder, "ADDITIONAL_SOURCE_PATH", path), \
                    patch.object(builder, "ADDITIONAL_SEAS", (detail, macro)), \
                    patch.object(builder, "OCEAN_SECTORS", (ocean,)), \
                    patch.object(builder.requests, "get", side_effect=response) as get:
                builder.refresh()
            sources = {f["properties"]["id"]: f for f in json.loads(path.read_text(encoding="utf-8"))["features"]}
        self.assertEqual(get.call_count, 3)
        for row, expected, precision in ((detail, expected_detail, 0.004),
                                         (macro, expected_macro, 0.005), (ocean, expected_macro, 0.005)):
            slug, name, zh, record, _kind = row
            with self.subTest(slug=slug):
                source = sources["marine_" + slug]
                props = source["properties"]
                self.assertTrue(shape(source["geometry"]).equals(expected))
                self.assertEqual(props["source_simplify_degrees"], precision)
                self.assertEqual(props["source_record_ids"], ["mrgid_sr:" + record])
                self.assertEqual(props["source_query"], f"mrgid_sr='{record}'")
                self.assertEqual(props["source_feature_count"], 1)
                self.assertEqual((props["name"], props["name_zh"]), (name, zh))
        self.assertEqual(sources["marine_" + detail[0]]["properties"]["region_group"], "marine_detail")
        self.assertEqual(sources["marine_" + detail[0]]["properties"]["parent_id"], "marine_north_sea")
        self.assertEqual(sources["marine_" + macro[0]]["properties"]["region_group"], "marine_macro")
        self.assertEqual(sources["marine_" + macro[0]]["properties"]["parent_id"], "")
        self.assertEqual(sources["marine_" + ocean[0]]["properties"]["region_group"], "ocean_macro")
        self.assertEqual(sources["marine_" + ocean[0]]["properties"]["parent_id"], f"marine_{ocean[4]}_ocean")

    def test_refresh_mixed_layers_use_exact_queries_and_union_all_matching_records(self):
        from tools import build_marine_refinement_sources as builder

        detail = NORTH_SEA_DETAILS[0]
        macro = ("white_sea", "White Sea", "白海", "24020", "sea")
        world = ("fixture_world_bay", "Fixture Bay", "测试湾", "32380", "bay")
        detail_geometry = Polygon([(0, 0), (1, 0), (1, 1), (0.5, 1.0045), (0, 1), (0, 0)])
        left, right = box(2, 0, 4, 2), box(3, 0, 5, 2)
        requested = []

        def response(url, *, params, timeout):
            self.assertEqual(url, builder.WFS)
            self.assertEqual(timeout, 60)
            request = (params["typeName"], params["CQL_FILTER"])
            requested.append(request)
            if request == ("MarineRegions:seavox_v19", "mrgid_sr='24186'"):
                rows = [feature("detail", detail_geometry, mrgid_sr="24186")]
            elif request == ("MarineRegions:seavox_v19", "mrgid_sr='24020'"):
                rows = [feature("macro", detail_geometry, mrgid_sr="24020")]
            elif request == ("MarineRegions:world_bay_gulf", "mrgid=32380"):
                rows = [feature("world.1", left, mrgid=32380), feature("world.2", right, mrgid=32380)]
            else:
                self.fail(f"Unexpected layer or exact query: {request}")
            return Mock(status_code=200, url=builder.WFS + "?CQL_FILTER=" + params["CQL_FILTER"],
                        json=Mock(return_value={"features": rows}))

        with TemporaryDirectory(dir=marine.ROOT / ".runtime/tmp") as directory:
            path = Path(directory) / "source.geojson"
            with patch.object(builder, "ADDITIONAL_SOURCE_PATH", path), \
                    patch.object(builder, "ADDITIONAL_SEAS", (detail, macro, world)), \
                    patch.object(builder, "OCEAN_SECTORS", ()), \
                    patch.object(marine, "WORLD_BAY_GULF_SLUGS", frozenset({world[0]})), \
                    patch.object(builder.requests, "get", side_effect=response):
                builder.refresh()
            collection = json.loads(path.read_text(encoding="utf-8"))
        sources = {f["properties"]["id"]: f for f in collection["features"]}
        self.assertEqual(len(requested), 3)
        self.assertTrue(shape(sources["marine_" + world[0]]["geometry"]).equals(left.union(right)))
        for slug, layer, query, record_id, count, precision in (
            (detail[0], "seavox_v19", "mrgid_sr='24186'", "mrgid_sr:24186", 1, 0.004),
            (macro[0], "seavox_v19", "mrgid_sr='24020'", "mrgid_sr:24020", 1, 0.005),
            (world[0], "world_bay_gulf", "mrgid=32380", "mrgid:32380", 2, 0.005),
        ):
            with self.subTest(slug=slug):
                props = sources["marine_" + slug]["properties"]
                self.assertEqual(props["source_layer"], layer)
                self.assertEqual(props["source_standard"], "marine_regions_" + layer)
                self.assertEqual(props["source_query"], query)
                self.assertEqual(props["source_record_ids"], [record_id])
                self.assertEqual(props["source_feature_count"], count)
                self.assertEqual(props["source_simplify_degrees"], precision)
                self.assertIn(query, props["source_url"])
        self.assertTrue(shape(sources["marine_" + detail[0]]["geometry"]).equals(detail_geometry.simplify(0.004)))
        self.assertTrue(shape(sources["marine_" + macro[0]]["geometry"]).equals(detail_geometry.simplify(0.005)))
        datasets = {row["source_layer"]: row for row in collection["source_datasets"]}
        self.assertEqual(set(datasets), {"seavox_v19", "world_bay_gulf"})
        self.assertEqual(datasets["seavox_v19"]["citation"], "https://doi.org/10.14284/590")
        self.assertEqual(datasets["world_bay_gulf"]["source_standard"], "marine_regions_world_bay_gulf")
        self.assertNotIn("source_version", datasets["world_bay_gulf"])
        self.assertNotEqual(collection["source_version"], "SeaVoX v19 (2023)")

    def test_refresh_rejects_http_200_wrong_ids_in_either_layer_or_any_record(self):
        from tools import build_marine_refinement_sources as builder

        cases = (
            (False, [{"mrgid_sr": "24021"}]),
            (False, [{"mrgid": 24020}]),
            (True, [{"mrgid": 32381}]),
            (True, [{"mrgid_sr": "32380"}]),
            (True, [{"mrgid": 32380}, {"mrgid": 32381}]),
            (True, [{"mrgid": True}]),
        )
        for world, records in cases:
            with self.subTest(world=world, records=records), TemporaryDirectory(dir=marine.ROOT / ".runtime/tmp") as directory:
                slug, record = ("fixture_world_bay", "32380") if world else ("white_sea", "24020")
                path = Path(directory) / "rejected.geojson"
                response = Mock(status_code=200, url=builder.WFS,
                                json=Mock(return_value={"features": [feature(str(index), box(0, 0, 1, 1), **props)
                                                                      for index, props in enumerate(records)]}))
                with patch.object(builder, "ADDITIONAL_SOURCE_PATH", path), \
                        patch.object(builder, "ADDITIONAL_SEAS", ((slug, "Fixture", "测试", record, "bay"),)), \
                        patch.object(builder, "OCEAN_SECTORS", ()), \
                        patch.object(marine, "WORLD_BAY_GULF_SLUGS", frozenset({slug}) if world else frozenset()), \
                        patch.object(builder.requests, "get", return_value=response) as get:
                    with self.assertRaises(ValueError):
                        builder.refresh()
                self.assertEqual(get.call_count, 1)
                response.raise_for_status.assert_called_once()
                self.assertFalse(path.exists(), "A mismatched public response must not be published")

    def test_source_collection_metadata_tracks_actual_layers_without_false_seavox_attribution(self):
        from tools import build_marine_refinement_sources as builder

        sea = feature("sea", box(0, 0, 1, 1), source_layer="seavox_v19")
        bay = feature("bay", box(1, 0, 2, 1), source_layer="world_bay_gulf")
        sea_only = builder.source_collection_metadata([sea])
        self.assertEqual(sea_only["source_version"], "SeaVoX v19 (2023)")
        self.assertEqual(sea_only["citation"], "https://doi.org/10.14284/590")
        bay_only = builder.source_collection_metadata([bay])
        self.assertEqual([row["source_layer"] for row in bay_only["source_datasets"]], ["world_bay_gulf"])
        self.assertNotIn("SeaVoX", bay_only["source_version"])
        self.assertNotIn("10.14284/590", bay_only["citation"])
        mixed = builder.source_collection_metadata([sea, bay, bay])
        self.assertEqual(mixed, builder.source_collection_metadata([bay, sea]))
        self.assertEqual(len(mixed["source_datasets"]), 2)
        self.assertIn("10.14284/590", mixed["citation"])
        self.assertIn("Marine Regions", mixed["citation"])
        expected_datasets = deepcopy(mixed["source_datasets"])
        mixed["source_datasets"][0]["citation"] = "fixture changed"
        self.assertEqual(builder.source_collection_metadata([sea, bay])["source_datasets"],
                         expected_datasets)

    def test_decimal_mrgids_accept_integral_floats_and_reject_invalid_numbers(self):
        from tools import build_marine_refinement_sources as builder

        self.assertEqual(builder._numeric_source_id(32380.0, context="decimal fixture"), 32380)
        self.assertIs(type(builder._numeric_source_id(32380.0, context="decimal fixture")), int)
        for value in (32380.5, float("nan"), float("inf"), float("-inf"), True, False, "32380.0"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                builder._numeric_source_id(value, context="invalid decimal fixture")
        with TemporaryDirectory(dir=marine.ROOT / ".runtime/tmp") as directory:
            path = Path(directory) / "decimal-source.geojson"
            response = Mock(status_code=200, url=builder.WFS, json=Mock(return_value={
                "features": [feature("decimal", box(0, 0, 1, 1), mrgid=32380.0)],
            }))
            with patch.object(builder, "ADDITIONAL_SOURCE_PATH", path), \
                    patch.object(builder, "ADDITIONAL_SEAS", (("fixture_decimal_bay", "Decimal Bay", "测试湾", "32380", "bay"),)), \
                    patch.object(builder, "OCEAN_SECTORS", ()), \
                    patch.object(marine, "WORLD_BAY_GULF_SLUGS", frozenset({"fixture_decimal_bay"})), \
                    patch.object(builder.requests, "get", return_value=response):
                builder.refresh()
            props = json.loads(path.read_text(encoding="utf-8"))["features"][0]["properties"]
        self.assertEqual(props["source_record_ids"], ["mrgid:32380"])
        self.assertEqual(props["source_query"], "mrgid=32380")
        self.assertEqual(props["source_feature_count"], 1)

    def test_wave6_specs_use_exact_source_identity_verified_parents_and_explicit_routes(self):
        rows = {row[0]: row for row in marine.ADDITIONAL_SEAS}
        specs = {spec["id"]: spec for spec in marine.tno_additional_specs()}
        expected_routes = {
            slug: ("tno_" + ocean,) for ocean, slugs in WAVE6_ROUTE_GROUPS.items() for slug in slugs
        }
        expected_slugs = {row[0] for row in WAVE6_SEAS}
        world_slugs = {row[0] for row in WAVE6_SEAS[10:]}
        self.assertEqual(len(specs), 90 + len(WAVE7_PROBES))
        self.assertEqual(len(expected_slugs), 37)
        self.assertEqual(len(world_slugs), 27)
        self.assertEqual(set(expected_routes), expected_slugs)
        wave7_slugs = {row["slug"] for row in WAVE7_PROBES}
        self.assertEqual(set(marine.WORLD_BAY_GULF_SLUGS), world_slugs | wave7_slugs)
        self.assertEqual(set(marine.ADDITIONAL_OCEAN_CLIP_OVERRIDES), expected_slugs | wave7_slugs)
        self.assertNotIn("oro_bay", rows)
        for index, row in enumerate(WAVE6_SEAS):
            slug, name, _zh, record, kind = row
            with self.subTest(slug=slug):
                self.assertEqual(rows[slug], row)
                spec = specs["tno_" + slug]
                world = index >= 10
                layer = "world_bay_gulf" if world else "seavox_v19"
                parent = WAVE6_DETAIL_PARENTS.get(slug)
                self.assertEqual((spec["name"], spec["water_type"]), (name, kind))
                self.assertEqual(spec["region_group"], "marine_detail" if parent else "marine_macro")
                self.assertEqual(spec["parent_id"], "tno_" + parent if parent else "")
                self.assertEqual(spec["source_layer"], layer)
                self.assertEqual(spec["source_standard"], "marine_regions_" + layer)
                self.assertEqual(spec["source_query"], f"mrgid={record}" if world else f"mrgid_sr='{record}'")
                self.assertEqual(spec["source_record_ids"], [f"mrgid:{record}" if world else f"mrgid_sr:{record}"])
                self.assertEqual(spec["simplify_tolerance"], 0.004 if parent else 0.005)
                self.assertEqual(spec["clip_open_ocean_ids"], expected_routes[slug])
                self.assertEqual(marine.ADDITIONAL_OCEAN_CLIP_OVERRIDES[slug], expected_routes[slug])

    def test_wave6_real_mixed_sources_and_snapshots_preserve_record_count_and_identity(self):
        from urllib.parse import parse_qs, urlparse

        collection = marine.load_collection(marine.ADDITIONAL_SOURCE_PATH)
        sources = {f["properties"]["id"]: f for f in collection["features"]}
        prepared = marine.load_collection(marine.SOURCE_PATH)
        shared = {f["properties"]["id"]: f for f in prepared["features"]}
        snapshots = {f["properties"]["id"]: f for f in marine.additional_snapshot_features()}
        self.assertEqual(len(collection["features"]), 98 + len(WAVE7_PROBES))
        self.assertEqual(len(sources), 98 + len(WAVE7_PROBES))
        self.assertEqual(len(prepared["features"]), 207 + len(WAVE7_PROBES))
        self.assertEqual(len(shared), 207 + len(WAVE7_PROBES))
        self.assertEqual(len(snapshots), 90 + len(WAVE7_PROBES))
        self.assertNotIn("marine_oro_bay", sources)
        self.assertNotIn("marine_oro_bay", shared)
        self.assertNotIn("tno_oro_bay", snapshots)
        datasets = {row["source_layer"]: row for row in collection["source_datasets"]}
        self.assertEqual(set(datasets), {"seavox_v19", "world_bay_gulf"})
        self.assertEqual(len(collection["source_datasets"]), 2)
        self.assertEqual(datasets["seavox_v19"]["source_standard"], "marine_regions_seavox_v19")
        self.assertEqual(datasets["world_bay_gulf"]["source_standard"], "marine_regions_world_bay_gulf")
        self.assertNotEqual(collection["source_version"], "SeaVoX v19 (2023)")
        # The prepared collection retains its input-provenance schema; dataset
        # attribution is recorded in the supplement it references.
        self.assertIn("data/marine_regions.additional.source.geojson", prepared["source_inputs"])
        self.assertIn("data/scenarios/tno_1962/derived/marine_regions_named_waters.snapshot.geojson",
                      prepared["source_inputs"])
        for index, (slug, name, zh, record, kind) in enumerate(WAVE6_SEAS):
            with self.subTest(slug=slug):
                entry = sources["marine_" + slug]
                props = entry["properties"]
                parent = WAVE6_DETAIL_PARENTS.get(slug)
                layer = "world_bay_gulf" if index >= 10 else "seavox_v19"
                query = f"mrgid={record}" if index >= 10 else f"mrgid_sr='{record}'"
                record_ids = [f"mrgid:{record}" if index >= 10 else f"mrgid_sr:{record}"]
                expected = {
                    "name": name, "name_zh": zh, "water_type": kind,
                    "region_group": "marine_detail" if parent else "marine_macro",
                    "parent_id": "marine_" + parent if parent else "",
                    "source_layer": layer, "source_standard": "marine_regions_" + layer,
                    "source_query": query, "source_record_ids": record_ids,
                    "source_feature_count": 2 if slug == "cockburn_sound" else 1,
                    "source_simplify_degrees": 0.004 if parent else 0.005,
                }
                for key, value in expected.items():
                    self.assertEqual(props[key], value, (slug, key))
                url_params = parse_qs(urlparse(props["source_url"]).query)
                self.assertEqual(url_params["typeName"], ["MarineRegions:" + layer])
                self.assertEqual(url_params["CQL_FILTER"], [query])
                self.assertTrue(shape(entry["geometry"]).is_valid)
                self.assertFalse(shape(entry["geometry"]).is_empty)
                snapshot = snapshots["tno_" + slug]
                self.assertEqual(snapshot["geometry"], entry["geometry"])
                self.assertEqual(snapshot["properties"]["parent_id"], "tno_" + parent if parent else "")
                self.assertEqual(snapshot["properties"]["source_record_ids"], record_ids)
                shared_props = shared["marine_" + slug]["properties"]
                for key in ("name", "name_zh", "water_type", "region_group", "parent_id",
                            "source_layer", "source_standard", "source_query", "source_record_ids"):
                    self.assertEqual(shared_props[key], expected[key], (slug, key))
                shared_geom = shape(shared["marine_" + slug]["geometry"])
                self.assertTrue(shared_geom.is_valid)
                self.assertFalse(shared_geom.is_empty)
                if parent:
                    self.assertLessEqual(shared_geom.intersection(shape(shared["marine_" + parent]["geometry"])).area,
                                         1e-8, (slug, parent))

    def test_wave7_sources_specs_and_snapshots_preserve_reviewed_identity_and_precision(self):
        from urllib.parse import parse_qs, urlparse

        rows = {row[0]: row for row in marine.ADDITIONAL_SEAS}
        specs = {spec["id"]: spec for spec in marine.tno_additional_specs()}
        sources = {f["properties"]["id"]: f for f in marine.load_collection(marine.ADDITIONAL_SOURCE_PATH)["features"]}
        shared = {f["properties"]["id"]: f for f in marine.load_collection(marine.SOURCE_PATH)["features"]}
        snapshots = {f["properties"]["id"]: f for f in marine.additional_snapshot_features()}
        self.assertEqual(len(WAVE7_PROBES), 46)
        self.assertEqual(sum(bool(row["parentSlug"]) for row in WAVE7_PROBES), 7)
        self.assertEqual(sum(row["sourceSimplifyDegrees"] == 0.0005 for row in WAVE7_PROBES), 8)
        self.assertTrue({"paradise_creek", "bhatanro_creek", "kilifi", "anse_boileau"}.isdisjoint(rows))
        self.assertEqual({row["slug"]: row["sourceFeatureCount"] for row in WAVE7_PROBES if row["sourceFeatureCount"] > 1},
                         {"hauraki_gulf": 5, "magdalena_bay": 15, "saint_vincent_bay": 4})
        for row in WAVE7_PROBES:
            slug, parent = row["slug"], row["parentSlug"]
            with self.subTest(slug=slug):
                self.assertEqual(rows[slug], (slug, row["name"], row["nameZh"], row["recordId"], row["waterType"]))
                source, spec = sources["marine_" + slug], specs["tno_" + slug]
                expected = {
                    "name": row["name"], "water_type": row["waterType"], "region_group": row["regionGroup"],
                    "source_layer": row["sourceLayer"], "source_standard": row["sourceStandard"],
                    "source_query": row["sourceQuery"], "source_record_ids": [row["sourceRecordId"]],
                }
                for key, value in expected.items():
                    self.assertEqual(source["properties"][key], value, key)
                    self.assertEqual(spec[key], value, key)
                    self.assertEqual(shared["marine_" + slug]["properties"][key], value, key)
                self.assertEqual(source["properties"]["name_zh"], row["nameZh"])
                self.assertEqual(source["properties"]["source_feature_count"], row["sourceFeatureCount"])
                self.assertEqual(source["properties"]["source_simplify_degrees"], row["sourceSimplifyDegrees"])
                self.assertEqual(spec["simplify_tolerance"], row["sourceSimplifyDegrees"])
                self.assertEqual(spec["clip_open_ocean_ids"], tuple(row["oceanClipIds"]))
                self.assertEqual(source["properties"]["parent_id"], "marine_" + parent if parent else "")
                self.assertEqual(spec["parent_id"], "tno_" + parent if parent else "")
                params = parse_qs(urlparse(source["properties"]["source_url"]).query)
                self.assertEqual(params["typeName"], ["MarineRegions:" + row["sourceLayer"]])
                self.assertEqual(params["CQL_FILTER"], [row["sourceQuery"]])
                snapshot = snapshots["tno_" + slug]
                self.assertEqual(snapshot["geometry"], source["geometry"])
                self.assertEqual(snapshot["properties"]["parent_id"], spec["parent_id"])
                for key in ("source_feature_count", "source_simplify_degrees", "source_record_ids"):
                    self.assertEqual(snapshot["properties"][key], source["properties"][key])
                for entry in (source, shared["marine_" + slug]):
                    geometry = shape(entry["geometry"])
                    self.assertTrue(geometry.is_valid)
                    self.assertFalse(geometry.is_empty)
                if parent:
                    self.assertLessEqual(shape(shared["marine_" + slug]["geometry"]).intersection(
                        shape(shared["marine_" + parent]["geometry"])).area, 1e-8)

    def test_small_bay_precision_survives_refresh_and_named_preparation(self):
        from tools import build_marine_refinement_sources as builder
        from tools import patch_tno_1962_bundle as bundle

        # A 0.001-degree inlet survives the reviewed .0005 tolerance and would
        # be erased by the standard .005 macro tolerance at either build stage.
        raw = Polygon([(0, 0), (0.02, 0), (0.02, 0.02), (0.01, 0.021), (0, 0.02), (0, 0)])
        fine, coarse = raw.simplify(0.0005), raw.simplify(0.005)
        self.assertFalse(fine.equals(coarse))
        row = next(row for row in marine.ADDITIONAL_SEAS if row[0] == "tudor_creek")
        spec = next(spec for spec in marine.tno_additional_specs() if spec["id"] == "tno_tudor_creek")
        response = Mock(status_code=200, url=builder.WFS,
                        json=Mock(return_value={"features": [feature("fixture", raw, mrgid=int(row[3]))]}))
        with TemporaryDirectory(dir=marine.ROOT / ".runtime/tmp") as directory:
            path = Path(directory) / "source.geojson"
            with patch.object(builder, "ADDITIONAL_SOURCE_PATH", path), \
                    patch.object(builder, "ADDITIONAL_SEAS", (row,)), \
                    patch.object(builder, "OCEAN_SECTORS", ()), \
                    patch.object(builder.requests, "get", return_value=response):
                builder.refresh()
            source = json.loads(path.read_text(encoding="utf-8"))["features"][0]
        self.assertTrue(shape(source["geometry"]).equals(fine))
        self.assertEqual(source["properties"]["source_simplify_degrees"], 0.0005)
        snapshot = deepcopy(source)
        snapshot["properties"]["id"] = spec["id"]
        with patch.object(bundle, "load_global_water_regions_feature_index", return_value={}), \
                patch.object(bundle, "additional_snapshot_features", return_value=[]), \
                patch.object(bundle, "TNO_NAMED_MARGINAL_WATER_SPECS", (spec,)):
            prepared, _ = bundle.build_tno_named_marginal_water_features({"features": [snapshot]})
        self.assertTrue(shape(prepared[0]["geometry"]).equals(fine))
        self.assertEqual(marine.additional_source_simplify_degrees("cape_cod_bay"), 0.004)
        self.assertEqual(marine.additional_source_simplify_degrees("massachusetts_bay"), 0.005)

    def test_north_sea_subtractions_keep_existing_children_and_add_each_detail_once(self):
        from tools import patch_tno_1962_bundle as bundle

        specs = {spec["id"]: spec for spec in bundle.TNO_NAMED_MARGINAL_WATER_SPECS}
        subtract = specs["tno_north_sea"]["subtract_named_ids"]
        existing = (
            "english_channel", "strait_of_dover", "skagerrak", "kattegat", "wadden_sea",
            "thames_estuary", "blackwater_estuary", "the_wash", "humber_estuary",
            "firth_of_forth", "moray_firth", "pentland_firth",
        )
        expected_ids = {"tno_" + slug for slug in existing} | {"tno_" + row[0] for row in NORTH_SEA_DETAILS}
        self.assertEqual(set(subtract), expected_ids)
        for feature_id in expected_ids:
            self.assertEqual(subtract.count(feature_id), 1, feature_id)
            self.assertIn(feature_id, specs)

    def test_named_preparer_carves_north_sea_children_before_generic_compile_in_any_order(self):
        from tools import patch_tno_1962_bundle as bundle

        all_specs = {spec["id"]: spec for spec in bundle.TNO_NAMED_MARGINAL_WATER_SPECS}
        parent = deepcopy(all_specs["tno_north_sea"])
        selected = [parent, *(deepcopy(all_specs[feature_id]) for feature_id in parent["subtract_named_ids"])]
        parent_geometry = box(0, 0, 30, 30)
        inputs = [feature(parent["id"], parent_geometry, source_record_ids=["mrgid:2350"])]
        for index, spec in enumerate(selected[1:]):
            # Keep the production parent's complete child queue; unrelated child
            # dependencies/base subtraction are outside this focused fixture.
            spec["subtract_named_ids"] = ()
            spec["subtract_base_ids"] = ()
            inputs.append(feature(spec["id"], box(1 + index % 5 * 5, 1 + index // 5 * 5,
                                                  3 + index % 5 * 5, 3 + index // 5 * 5),
                                  source_record_ids=[spec["source_query"]]))
        parent["subtract_base_ids"] = ()
        snapshot = {"features": inputs}
        original = deepcopy(snapshot)
        outputs = []
        with patch.object(bundle, "load_global_water_regions_feature_index", return_value={}), \
                patch.object(bundle, "additional_snapshot_features", return_value=[]):
            for ordered in (selected, list(reversed(selected))):
                with patch.object(bundle, "TNO_NAMED_MARGINAL_WATER_SPECS", tuple(ordered)):
                    prepared, _ = bundle.build_tno_named_marginal_water_features(snapshot)
                outputs.append({f["properties"]["id"]: shape(f["geometry"]) for f in prepared})
        children_union = unary_union([shape(f["geometry"]) for f in inputs[1:]])
        probe = shape(inputs[1]["geometry"]).representative_point()
        self.assertFalse(outputs[0][parent["id"]].covers(probe))
        self.assertGreater(outputs[0][parent["id"]].area, 0)
        self.assertEqual(outputs[0][parent["id"]].intersection(children_union).area, 0)
        self.assertTrue(unary_union(list(outputs[0].values())).equals(parent_geometry))
        for feature_id, geometry in outputs[0].items():
            self.assertTrue(geometry.equals(outputs[1][feature_id]), feature_id)
        self.assertEqual(snapshot, original)

    def test_north_sea_detail_real_sources_and_snapshot_use_accurate_record_and_parent(self):
        sources = {f["properties"]["id"]: f for f in marine.load_collection(marine.ADDITIONAL_SOURCE_PATH)["features"]}
        snapshots = {f["properties"]["id"]: f for f in marine.additional_snapshot_features()}
        for slug, name, zh, record, kind in NORTH_SEA_DETAILS:
            with self.subTest(slug=slug):
                source = sources["marine_" + slug]
                props = source["properties"]
                self.assertEqual((props["name"], props["name_zh"], props["water_type"]), (name, zh, kind))
                self.assertEqual(props["region_group"], "marine_detail")
                self.assertEqual(props["parent_id"], "marine_north_sea")
                self.assertEqual(props["source_query"], f"mrgid_sr='{record}'")
                self.assertEqual(props["source_record_ids"], ["mrgid_sr:" + record])
                self.assertEqual(props["source_feature_count"], 1)
                self.assertEqual(props["source_simplify_degrees"], 0.004)
                self.assertTrue(shape(source["geometry"]).is_valid)
                self.assertFalse(shape(source["geometry"]).is_empty)
                snapshot = snapshots["tno_" + slug]
                self.assertEqual(snapshot["properties"]["parent_id"], "tno_north_sea")
                self.assertEqual(snapshot["properties"]["source_record_ids"], ["mrgid_sr:" + record])
                self.assertEqual(snapshot["geometry"], source["geometry"])

    def test_real_north_sea_prepared_parent_subtraction_preserves_coverage_and_order(self):
        from tools import patch_tno_1962_bundle as bundle

        all_specs = {spec["id"]: spec for spec in bundle.TNO_NAMED_MARGINAL_WATER_SPECS}
        parent = deepcopy(all_specs["tno_north_sea"])
        selected = [parent, *(deepcopy(all_specs[feature_id]) for feature_id in parent["subtract_named_ids"])]
        # Test the parent's complete production queue against real pre-coast
        # sources. Each child's own nested/base subtractions have separate tests.
        for spec in selected:
            spec["subtract_base_ids"] = ()
            if spec is not parent:
                spec["subtract_named_ids"] = ()
        snapshot = marine.load_collection(
            marine.ROOT / "data/scenarios/tno_1962/derived/marine_regions_named_waters.snapshot.geojson"
        )
        outputs = []
        with patch.object(bundle, "load_global_water_regions_feature_index", return_value={}):
            baseline_specs = deepcopy(selected)
            baseline_specs[0]["subtract_named_ids"] = ()
            for ordered in (baseline_specs, selected, list(reversed(selected))):
                with patch.object(bundle, "TNO_NAMED_MARGINAL_WATER_SPECS", tuple(ordered)):
                    prepared, _ = bundle.build_tno_named_marginal_water_features(snapshot)
                outputs.append({f["properties"]["id"]: shape(f["geometry"]) for f in prepared})
        baseline, forward, reverse = outputs
        children = [forward[feature_id] for feature_id in parent["subtract_named_ids"]]
        new_children = [forward["tno_" + row[0]] for row in NORTH_SEA_DETAILS]
        self.assertGreater(baseline[parent["id"]].intersection(unary_union(new_children)).area, 0)
        self.assertGreater(forward[parent["id"]].area, 0)
        for feature_id in parent["subtract_named_ids"]:
            self.assertLessEqual(forward[parent["id"]].intersection(forward[feature_id]).area, 1e-8, feature_id)
            self.assertTrue(forward[feature_id].equals(baseline[feature_id]), feature_id)
        self.assertLessEqual(
            unary_union([forward[parent["id"]], *children]).symmetric_difference(
                unary_union(list(baseline.values()))
            ).area,
            1e-8,
        )
        for feature_id, geometry in forward.items():
            self.assertTrue(geometry.equals(reverse[feature_id]), feature_id)

    def test_antarctic_source_areas_and_tno_clip_routes_match_admission(self):
        antarctic_slugs = (
            "riiser_larsen_sea", "cooperation_sea", "davis_sea", "lazarev_sea",
            "cosmonauts_sea", "bellingshausen_sea", "amundsen_sea", "mawson_sea",
            "dumont_durville_sea", "somov_sea",
        )
        additions = {
            f["properties"]["id"]: shape(f["geometry"])
            for f in marine.load_collection(marine.ADDITIONAL_SOURCE_PATH)["features"]
        }
        candidate_ids = ["marine_" + slug for slug in antarctic_slugs]
        self.assertTrue(set(candidate_ids) <= additions.keys())
        geometries = [additions[feature_id] for feature_id in candidate_ids]
        for index, geometry in enumerate(geometries):
            for other_index in range(index + 1, len(geometries)):
                overlap = geometry.intersection(geometries[other_index]).area
                self.assertLessEqual(overlap, 1e-8, (candidate_ids[index], candidate_ids[other_index], overlap))

        existing = {
            f["properties"]["id"]: shape(f["geometry"])
            for f in marine.load_collection(marine.SOURCE_PATH)["features"]
        }
        for candidate_id, geometry in zip(candidate_ids, geometries):
            for protected_id in ("marine_ross_sea", "marine_weddell_sea", "marine_scotia_sea"):
                overlap = geometry.intersection(existing[protected_id]).area
                self.assertLessEqual(overlap, 1e-8, (candidate_id, protected_id, overlap))

        specs = {spec["id"]: spec for spec in marine.tno_additional_specs()}
        self.assertEqual(
            set(specs["tno_riiser_larsen_sea"]["clip_open_ocean_ids"]),
            {"tno_south_atlantic_antarctic_ocean", "tno_south_indian_antarctic_ocean"},
        )
        self.assertEqual(
            set(specs["tno_bellingshausen_sea"]["clip_open_ocean_ids"]),
            {"tno_south_atlantic_antarctic_ocean", "tno_south_pacific_antarctic_ocean"},
        )

    def test_strait_interior_corridors_remain_continuous_after_coast_clipping(self):
        # Interior tracks around coastal land, not straight shortcuts across it.
        corridors = {
            "bering_strait": [(-168.8, 65.4), (-168.8, 66.1)],
            "strait_of_hormuz": [(56.1, 26.5), (56.3, 26.6), (56.8, 26.6), (56.9, 26.3)],
            "florida_strait": [(-81, 24), (-80.5, 24)],
        }
        for relative, prefix in (("data/water_regions.geojson", "marine_"),
                                 ("data/scenarios/tno_1962/water_regions.geojson", "tno_")):
            features = {f["properties"]["id"]: f for f in marine.load_collection(marine.ROOT / relative)["features"]}
            for slug, points in corridors.items():
                with self.subTest(asset=relative, strait=slug):
                    geometry = shape(features[prefix + slug]["geometry"])
                    self.assertTrue(geometry.covers(LineString(points)))

    def test_published_marine_partitions_do_not_overlap_across_hierarchy_levels(self):
        from shapely.strtree import STRtree
        for relative in ("data/water_regions.geojson", "data/scenarios/tno_1962/water_regions.geojson"):
            collection = marine.load_collection(marine.ROOT / relative)
            features = [f for f in collection["features"] if f["properties"].get("region_group") in {"marine_macro", "marine_detail", "ocean_macro"}]
            geometries = [shape(f["geometry"]) for f in features]
            tree = STRtree(geometries)
            prefix = "tno_" if "tno_1962" in relative else "marine_"
            ids = {f["properties"]["id"] for f in features}
            self.assertTrue({prefix + row[0] for row in marine.ADDITIONAL_SEAS} <= ids)
            for index, geometry in enumerate(geometries):
                self.assertTrue(geometry.is_valid, features[index]["properties"]["id"])
                self.assertFalse(geometry.is_empty, features[index]["properties"]["id"])
                for other in tree.query(geometry, predicate="intersects"):
                    if other <= index:
                        continue
                    # Integer-grid encoding may move a shared edge by one cell.
                    # Check exclusive interiors beyond that measured resolution,
                    # not exact floating-point equality at serialized boundaries.
                    grid = collection.get("water_geometry_quantization", {}).get("grid_degrees", [1e-9, 1e-9])
                    margin = (grid[0] ** 2 + grid[1] ** 2) ** 0.5
                    overlap = geometry.intersection(geometries[other]).buffer(-margin).area
                    self.assertLessEqual(overlap, 1e-8, (relative, features[index]["properties"]["id"], features[other]["properties"]["id"], overlap))


if __name__ == "__main__":
    unittest.main()
