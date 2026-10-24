"""Build the landing page's map stage (landing/assets/history-scrubber.json).

The landing page draws one Europe map and recolours it for every state it
shows: HOI4 1936, HOI4 1939, TNO 1962 (the history scrubber) and Modern World.
These scenarios do not share geometry, so this script cuts the HOI4 1936
political features into "atoms" whose owner is constant in every state.
Atoms are simplified as one coverage so neighbours keep identical edges.
The same file carries the rail network and major cities the page draws in.

Re-run after any change to these scenarios' owners, colours or topology.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import shapely
from shapely.geometry import MultiPolygon, Polygon, box, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from tools import build_landing_europe_1936_showcase as hero  # noqa: E402

OUTPUT = REPO_ROOT / "landing" / "assets" / "history-scrubber.json"
WIDTH, HEIGHT = 1600, 1000
VIEW_BBOX = (-11.0, 33.0, 41.0, 66.0)
CLIP_BBOX = (-32.0, 22.0, 66.0, 76.0)
SIMPLIFY_DEGREES = 0.05
MIN_PART_AREA = 0.012  # square degrees; roughly 9 px² on the 1600 px canvas
MIN_LINE_PX = 4.0
LABEL_MIN_AREA = 9.0  # square degrees inside the view
SHORT_NAMES = {
    "Union of Soviet Socialist Republics": ("Soviet Union", "苏联"),
    "United Kingdom of Great Britain and Northern Ireland": ("United Kingdom", "英国"),
    "French Republic": ("France", "法国"),
    "German Reich": ("German Reich", "德国"),
    "Republic of Turkey": ("Turkey", "土耳其"),
    "Spanish Republic": ("Spain", "西班牙"),
    "Spanish State": ("Spain", "西班牙"),
    "Czechoslovak Republic": ("Czechoslovakia", "捷克斯洛伐克"),
    "French Mandate for Syria": ("Syria", "叙利亚"),
    "Reichskommissariat Moskowien": ("RK Moskowien", "莫斯科维恩"),
    "Reichskommissariat Ukraine": ("RK Ukraine", "乌克兰专员辖区"),
    "Reichskommissariat Ostland": ("RK Ostland", "东方专员辖区"),
    "Reichskommissariat Norwegen": ("RK Norwegen", "挪威专员辖区"),
    "General Government of Poland": ("General Government", "波兰总督府"),
}
# TNO's "Germany" is the Greater German Reich; Modern World keeps its plain name.
STATE_SHORT_NAMES = {"1962": {"Germany": ("Greater German Reich", "大日耳曼国")}}
PREFIXES = ("Kingdom of ", "Republic of ", "Principality of ", "Grand Duchy of ", "Tsardom of ", "Hellenic ")
RAIL_CATALOG = REPO_ROOT / "data" / "transport_layers" / "global_rail" / "catalog.json"
RAIL_REGIONAL_MIN_DEGREES = 0.12
RAIL_CHUNKS = 12  # compound paths, main lines first; the page draws them in order
CITY_LIMIT = 46
# Aggregate tiers the editor hides where detailed districts exist (INTERACTIVE_AGGREGATE_TIER_FILTERS).
AGGREGATE_TIERS = {"GB": ("nuts1_basic",), "GR": ("adm1_basic",)}
OWNER_SNAP_DEGREES = 0.5  # nearest-feature fallback when topologies disagree on a coastline
CITY_MIN_DISTANCE_PX = 34.0
# (state id, family, manifest). The first three drive the history scrubber.
STATES = (
    ("1936", "HOI4", hero.HERO_SCENARIOS[1].manifest_path),
    ("1939", "HOI4", hero.HERO_SCENARIOS[2].manifest_path),
    ("1962", "TNO", hero.HERO_SCENARIOS[3].manifest_path),
    ("modern", "Modern World", REPO_ROOT / "data" / "scenarios" / "modern_world" / "manifest.json"),
)


def load_state(manifest_path):
    paths = hero.scenario_paths(manifest_path)
    countries = hero.read_json(paths["countries"])["countries"]
    owners = hero.read_json(paths["owners"])["owners"]
    return paths, countries, owners


def short_names(country: dict, tag: str, state: str) -> tuple[str, str]:
    full_name = country.get("display_name") or tag
    names = {**SHORT_NAMES, **STATE_SHORT_NAMES.get(state, {})}
    name_en, name_zh = names.get(full_name, (full_name, country.get("display_name_zh") or full_name))
    for prefix in PREFIXES:
        if name_en.startswith(prefix):
            name_en = name_en[len(prefix):]
    return name_en, name_zh


def drop_specks(geometry):
    polygons = []
    for part in hero.polygon_parts(geometry):
        if part.area < MIN_PART_AREA:
            continue
        holes = [ring for ring in part.interiors if Polygon(ring).area >= MIN_PART_AREA]
        polygons.append(Polygon(part.exterior, holes))
    return MultiPolygon(polygons) if polygons else Polygon()


def project_lines(geometry, canvas):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        points = [canvas.project(float(x), float(y)) for x, y, *_ in geometry.coords]
        rounded = []
        for x, y in points:
            vertex = (hero.fmt(x), hero.fmt(y))
            if not rounded or rounded[-1] != vertex:
                rounded.append(vertex)
        length = sum(math.hypot(x2 - x1, y2 - y1) for (x1, y1), (x2, y2) in zip(points, points[1:]))
        if len(rounded) < 2 or length < MIN_LINE_PX:
            return []
        return ["M" + " L".join(f"{x} {y}" for x, y in rounded)]
    if hasattr(geometry, "geoms"):
        return [path for part in geometry.geoms for path in project_lines(part, canvas)]
    return []


def graticule(canvas):
    lines = []
    for lon in range(-40, 80, 10):
        coords = [(lon, lat / 2) for lat in range(2 * int(CLIP_BBOX[1]), 2 * int(CLIP_BBOX[3]) + 1)]
        lines.append(coords)
    for lat in range(20, 80, 10):
        coords = [(lon / 2, lat) for lon in range(2 * int(CLIP_BBOX[0]), 2 * int(CLIP_BBOX[2]) + 1)]
        lines.append(coords)
    paths = []
    for coords in lines:
        points = [canvas.project(lon, lat) for lon, lat in coords]
        paths.append("M" + " L".join(f"{hero.fmt(x)} {hero.fmt(y)}" for x, y in points))
    return " ".join(paths)


def rail_lines(canvas, clip) -> list[str]:
    """European railways as projected paths, main lines first.

    Main and secondary lines are always kept; regional lines only when long
    enough to read at page scale, so the network stays connected without
    shipping every branch line.
    """
    candidates = []
    for entry in hero.read_json(RAIL_CATALOG).get("entries", []):
        if entry.get("region_id") != "europe":
            continue
        manifest = hero.read_json(REPO_ROOT / entry["manifest_path"])
        shard = manifest.get("paths", {}).get("full", {}).get("railways")
        if not shard:
            continue
        for feature in hero.topology_features(REPO_ROOT / shard, "railways"):
            properties = feature.get("properties") or {}
            rank = int(properties.get("reveal_rank") or 3)
            if not feature.get("geometry"):
                continue
            geometry = hero.valid_geometry(shape(feature["geometry"]))
            if rank >= 2 and geometry.length < RAIL_REGIONAL_MIN_DEGREES or not geometry.intersects(clip):
                continue
            simplified = geometry.intersection(clip).simplify(0.03, preserve_topology=False)
            for path in project_lines(simplified, canvas):
                candidates.append((rank, -geometry.length, path))
    candidates.sort()
    paths = [path for _rank, _length, path in candidates]
    size = -(-len(paths) // RAIL_CHUNKS)
    return [" ".join(paths[index:index + size]) for index in range(0, len(paths), size)]


def major_cities(canvas) -> list[dict]:
    """Large cities inside the view, spaced so their dots and labels do not crowd."""
    min_lon, min_lat, max_lon, max_lat = VIEW_BBOX
    candidates = []
    for feature in hero.geojson_features(REPO_ROOT / "data" / "world_cities.geojson"):
        properties = feature.get("properties") or {}
        lon, lat = properties.get("lon"), properties.get("lat")
        if lon is None or lat is None or not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
            continue
        population = float(properties.get("population") or 0)
        capital = bool(properties.get("is_country_capital"))
        if population < 400_000 and not capital:
            continue
        candidates.append((population + (2_000_000 if capital else 0), properties, lon, lat, population, capital))
    candidates.sort(key=lambda item: -item[0])
    selected = []
    for _rank, properties, lon, lat, population, capital in candidates:
        x, y = canvas.project(lon, lat)
        if any(math.hypot(x - city["x"], y - city["y"]) < CITY_MIN_DISTANCE_PX for city in selected):
            continue
        name = properties.get("name_en") or properties.get("name")
        selected.append({
            "n": name,
            "z": properties.get("name_zh") or name,
            "x": round(x, 1),
            "y": round(y, 1),
            "p": int(population),
            "cap": capital,
        })
        if len(selected) >= CITY_LIMIT:
            break
    return selected


def is_shell_fallback(properties: dict) -> bool:
    """Coarse fallback shells the editor paints under the detailed features (js/core/renderer/political_feature_policy.js)."""
    feature_id = str(properties.get("id") or "").upper()
    return (
        str(properties.get("scenario_helper_kind") or "").lower() == "shell_fallback"
        or feature_id.startswith("RU_ARCTIC_FB_")
        or "shell fallback" in str(properties.get("name") or "").lower()
    )


def resolve_overlaps(features: list[tuple[str, object]]) -> list[tuple[str, object]]:
    """Make features non-overlapping the way the editor paints them: a later feature covers earlier ones.

    The runtime topology has a few overlaps (for example a Russian fallback
    polygon over Crimea's districts); without this the result depends on
    which atom happens to be drawn last.
    """
    tree = STRtree([geometry for _id, geometry in features])
    resolved = []
    for index, (feature_id, geometry) in enumerate(features):
        later = [
            features[int(other)][1]
            for other in tree.query(geometry, predicate="intersects")
            if int(other) > index and geometry.intersection(features[int(other)][1]).area > 1e-9
        ]
        if later:
            geometry = hero.renderable_geometry(geometry.difference(unary_union(later)))
        if not geometry.is_empty:
            resolved.append((feature_id, geometry))
    return resolved


def atlantropa_layers(canvas, clip, tno_state) -> dict:
    """TNO's Atlantropa: sea and shoals keep their own look, land takes its owner's colour (as in the editor)."""
    paths, countries, owners = tno_state
    groups = defaultdict(list)
    for feature in hero.topology_features(paths["atlantropa_topology"], "scenario_atlantropa"):
        properties = feature.get("properties") or {}
        layer = properties.get("atl_render_layer")
        if layer not in {"water", "shoal", "land"} or not feature.get("geometry"):
            continue
        geometry = hero.renderable_geometry(shape(feature["geometry"]))
        if geometry.is_empty or not geometry.intersects(clip):
            continue
        owner = owners.get(properties.get("id")) or properties.get("owner_tag") if layer == "land" else None
        groups[(layer, owner)].append(geometry.intersection(clip))
    result = {"water": "", "shoal": "", "land": []}
    for (layer, owner), parts in sorted(groups.items(), key=lambda item: (item[0][0], item[0][1] or "")):
        merged = hero.canonicalize_hero_geometry(unary_union(parts)).simplify(SIMPLIFY_DEGREES / 2, preserve_topology=True)
        path = " ".join(hero.polygon_path(merged, canvas, include_interiors=True))
        if not path:
            continue
        if layer == "land":
            color = hero.clamp_hex((countries.get(owner) or {}).get("color_hex"), "#3a4a45")
            result["land"].append({"d": path, "o": owner, "c": color})
        else:
            result[layer] = " ".join(filter(None, [result[layer], path]))
    return result


def build(output: Path = OUTPUT) -> dict:
    canvas = hero.Canvas.create(WIDTH, HEIGHT, VIEW_BBOX, padding=0)
    clip = box(*CLIP_BBOX)
    view = box(*VIEW_BBOX)
    states = [load_state(manifest_path) for _state, _family, manifest_path in STATES]

    base_paths = states[0][0]
    underlays, base_features = [], []
    for feature in hero.topology_features(base_paths["runtime_topology"], "political"):
        properties = feature.get("properties") or {}
        if properties.get("render_as_base_geography") is False or not feature.get("geometry"):
            continue
        if str(properties.get("detail_tier") or "").lower() in AGGREGATE_TIERS.get(str(properties.get("cntr_code") or "").upper(), ()):
            continue
        geometry = hero.renderable_geometry(shape(feature["geometry"]))
        if geometry.is_empty or not geometry.intersects(clip):
            continue
        (underlays if is_shell_fallback(properties) else base_features).append((properties.get("id"), geometry.intersection(clip)))
    # Same paint order as the editor: shell fallbacks underneath, detail on top.
    base_features = resolve_overlaps(underlays + base_features)

    def owner_lookup(paths, owners):
        """Owner by feature ID, else the owner of this state's feature under a representative point.

        TNO replaces Mediterranean islands with Atlantropa land, so its owned
        Atlantropa land joins the candidate features.
        """
        geometries, tags = [], []
        candidates = list(hero.topology_features(paths["runtime_topology"], "political"))
        if "atlantropa_topology" in paths:
            candidates += [
                feature for feature in hero.topology_features(paths["atlantropa_topology"], "scenario_atlantropa")
                if (feature.get("properties") or {}).get("atl_render_layer") == "land"
            ]
        for feature in candidates:
            feature_id = (feature.get("properties") or {}).get("id")
            if feature_id in owners and feature.get("geometry"):
                geometry = hero.renderable_geometry(shape(feature["geometry"]))
                if not geometry.is_empty and geometry.intersects(clip):
                    geometries.append(geometry)
                    tags.append(owners[feature_id])
        tree = STRtree(geometries)

        def lookup(feature_id, geometry):
            if feature_id in owners:
                return owners[feature_id]
            point = geometry.representative_point()
            for index in tree.query(point, predicate="intersects"):
                return tags[int(index)]
            # Coastlines differ between topologies (TNO redraws the Mediterranean
            # for Atlantropa), so islands can miss every feature by a little.
            index = tree.nearest(point)
            if index is not None and geometries[int(index)].distance(point) <= OWNER_SNAP_DEGREES:
                return tags[int(index)]
            return None

        return lookup

    lookups = [owner_lookup(paths, owners) for paths, _countries, owners in states]
    atoms = defaultdict(list)
    for feature_id, geometry in base_features:
        atoms[tuple(lookup(feature_id, geometry) for lookup in lookups)].append(geometry)

    def color(state_index, tag):
        country = states[state_index][1].get(tag) if tag else None
        return hero.clamp_hex((country or {}).get("color_hex"), "#3a4a45")

    atom_records = []
    merged_by_key = {}
    keys = list(atoms)
    merged_list = [
        MultiPolygon([part for part in hero.polygon_parts(hero.canonicalize_hero_geometry(unary_union(atoms[key]))) if part.geom_type == "Polygon"])
        for key in keys
    ]
    # Simplify the atoms as one coverage so neighbours keep identical shared edges.
    simplified_list = shapely.coverage_simplify(merged_list, SIMPLIFY_DEGREES)
    for key, merged, simplified in zip(keys, merged_list, simplified_list):
        # coverage_simplify can return invalid rings for large atoms; repair before use.
        simplified = drop_specks(hero.renderable_geometry(simplified))
        merged_by_key[key] = simplified
        path = " ".join(hero.polygon_path(simplified, canvas, include_interiors=True))
        if not path:
            continue
        centroid = merged.centroid
        cx, _cy = canvas.project(centroid.x, centroid.y)
        atom_records.append({
            "area": merged.area,
            "d": path,
            "c": [color(index, tag) for index, tag in enumerate(key)],
            "o": list(key),
            "x": round(max(0.0, min(1.0, cx / WIDTH)), 3),
        })

    # Largest first: an enclave is drawn after its container, so it stays visible
    # even where the container's tiny hole was dropped as a speck.
    atom_records.sort(key=lambda record: -record.pop("area"))
    land = hero.canonicalize_hero_geometry(unary_union(list(merged_by_key.values())))
    coast = land.boundary
    coast_band = coast.buffer(0.002)
    borders, labels, names = [], [], []
    for year_index in range(len(STATES)):
        by_owner = defaultdict(list)
        for key, merged in merged_by_key.items():
            by_owner[key[year_index]].append(merged)
        owner_shapes = {tag: hero.canonicalize_hero_geometry(unary_union(parts)) for tag, parts in by_owner.items()}
        boundary = unary_union([geometry.boundary for geometry in owner_shapes.values()]).difference(coast_band).intersection(clip)
        borders.append(" ".join(project_lines(boundary, canvas)))

        year_labels = []
        countries = states[year_index][1]
        for tag, geometry in owner_shapes.items():
            visible = geometry.intersection(view)
            if not tag or visible.is_empty or visible.area < LABEL_MIN_AREA:
                continue
            parts = list(getattr(visible, "geoms", [visible]))
            anchor = max(parts, key=lambda part: part.area).representative_point()
            x, y = canvas.project(anchor.x, anchor.y)
            name_en, name_zh = short_names(countries.get(tag) or {}, tag, STATES[year_index][0])
            year_labels.append({
                "t": name_en,
                "z": name_zh,
                "x": round(x, 1),
                "y": round(y, 1),
                "s": round(min(30.0, 9.0 + math.sqrt(visible.area) * 1.15), 1),
            })
        labels.append(sorted(year_labels, key=lambda label: -label["s"]))
        names.append({tag: list(short_names(countries.get(tag) or {}, tag, STATES[year_index][0])) for tag in sorted(tag for tag in owner_shapes if tag)})

    atlantropa = atlantropa_layers(canvas, clip, states[2])
    payload = {
        "schema_version": 1,
        "width": WIDTH,
        "height": HEIGHT,
        "states": [{"id": state, "family": family} for state, family, _manifest in STATES],
        "graticule": graticule(canvas),
        "atoms": atom_records,
        "coast": " ".join(project_lines(coast.intersection(clip), canvas)),
        "borders": borders,
        "labels": labels,
        "names": names,
        "atlantropa": atlantropa,
        "rail": rail_lines(canvas, clip),
        "cities": major_cities(canvas),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8", newline="\n")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    payload = build(args.output)
    labels = sum(len(state) for state in payload["labels"])
    print(
        f"[build_landing_history_scrubber] {len(payload['atoms'])} atoms, {labels} labels, "
        f"{len(payload['rail'])} rail chunks, {len(payload['cities'])} cities -> {args.output}"
    )


if __name__ == "__main__":
    main()
