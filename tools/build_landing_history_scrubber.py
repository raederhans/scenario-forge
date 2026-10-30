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
GAP_MAX_AREA = 0.05  # square degrees; larger holes are lakes unless thinner than GAP_MAX_WIDTH
GAP_MAX_WIDTH = 0.02
BORDER_PROBE_DEGREES = 1e-5
SHELL_FOLLOW_MAX_AREA = 0.2  # square degrees
NEIGHBOUR_DEGREES = 0.05
COAST_BAND_DEGREES = 0.002
# Stage palette (OKLCH): game hues, lifted so dark colours read on the dark sea.
FALLBACK_COLOUR = "#3a4a45"
MIN_LIGHTNESS, MAX_LIGHTNESS = 0.5, 0.86
GREY_CHROMA = 0.015  # below this a colour is a deliberate grey and stays one
CHROMA_LIFT, MAX_CHROMA = 1.2, 0.17
# Overlord -> its own lightness; subjects take distinct steps around it.
SPHERES = {"GER": 0.47}
SPHERE_LIGHTNESS = (0.55, 0.62, 0.69, 0.76)
SPHERE_MIN_STEP = 0.07
SPHERE_MIN_CHROMA = 0.035
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
    # The stage shows a sphere's members, not their internal districts: a
    # subject of a subject (a Generalbezirk) is drawn as its Reichskommissariat.
    def stage_owner(tag):
        parent = countries.get(tag, {}).get("parent_owner_tag")
        return parent if countries.get(parent, {}).get("parent_owner_tag") in SPHERES else tag
    owners = {feature_id: stage_owner(tag) for feature_id, tag in owners.items()}
    return paths, countries, owners


def hex_to_oklch(color: str) -> tuple[float, float, float]:
    def linear(channel):
        return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4

    r, g, b = (linear(int(color[index:index + 2], 16) / 255) for index in (1, 3, 5))
    l, m, s = (
        (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3),
        (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3),
        (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3),
    )
    lightness = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return lightness, math.hypot(a, b), math.atan2(b, a)


def oklch_to_hex(lightness: float, chroma: float, hue: float) -> str:
    """Nearest sRGB colour, lowering chroma until it fits the gamut."""
    def encode(channel):
        return 12.92 * channel if channel <= 0.0031308 else 1.055 * channel ** (1 / 2.4) - 0.055

    while True:
        a, b = chroma * math.cos(hue), chroma * math.sin(hue)
        l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
        m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
        s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
        rgb = (
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
        )
        if all(-1e-4 <= channel <= 1.0001 for channel in rgb) or chroma < 1e-3:
            return "#" + "".join(f"{round(max(0.0, min(1.0, encode(max(0.0, channel)))) * 255):02x}" for channel in rgb)
        chroma *= 0.96


def stage_colour(color: str, lightness: float | None = None, min_chroma: float = 0.0) -> str:
    """A game colour lifted for the dark stage: same hue, lightness and chroma kept in range."""
    source_lightness, chroma, hue = hex_to_oklch(color)
    if chroma >= GREY_CHROMA:
        chroma = min(max(chroma * CHROMA_LIFT, min_chroma), MAX_CHROMA)
    lightness = lightness if lightness is not None else min(max(source_lightness, MIN_LIGHTNESS), MAX_LIGHTNESS)
    return oklch_to_hex(lightness, chroma, hue)


def stage_palette(countries: dict, neighbours: dict) -> dict:
    """Every tag's stage colour in one state.

    A sphere (an overlord and its subjects) keeps each member's own hue, but
    the game draws them as near-identical greys; members get lightness steps
    so that no two neighbours share one.
    """
    palette = defaultdict(lambda: stage_colour(FALLBACK_COLOUR))
    for tag, country in countries.items():
        palette[tag] = stage_colour(hero.clamp_hex(country.get("color_hex"), FALLBACK_COLOUR))
    for overlord, overlord_lightness in SPHERES.items():
        if overlord not in countries:
            continue
        palette[overlord] = stage_colour(hero.clamp_hex(countries[overlord].get("color_hex"), FALLBACK_COLOUR), overlord_lightness)
        assigned = {overlord: overlord_lightness}
        subjects = [tag for tag, country in countries.items() if country.get("parent_owner_tag") == overlord]
        # Most-connected first, so the crowded middle gets the widest steps.
        for tag in sorted(subjects, key=lambda tag: (-len(neighbours.get(tag, ())), tag)):
            near = [assigned[other] for other in neighbours.get(tag, ()) if other in assigned]
            # A step that already reads as different is enough; then stay close to the overlord.
            assigned[tag] = max(SPHERE_LIGHTNESS, key=lambda level: (min([SPHERE_MIN_STEP, *(abs(level - other) for other in near)]), -abs(level - overlord_lightness)))
            palette[tag] = stage_colour(hero.clamp_hex(countries[tag].get("color_hex"), FALLBACK_COLOUR), assigned[tag], SPHERE_MIN_CHROMA)
    return palette


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


def shared_border(piece, other) -> float:
    return piece.boundary.intersection(other.buffer(BORDER_PROBE_DEGREES)).length


def is_gap(hole) -> bool:
    """A hole inside the land that is a crack between source datasets, not a lake."""
    return hole.area <= GAP_MAX_AREA or hole.buffer(-GAP_MAX_WIDTH / 2).is_empty


def close_coverage(atoms: dict) -> dict:
    """Make the atoms tile the land without cracks, before they are simplified.

    Neighbouring countries come from different source datasets whose borders
    do not share vertices, so the parcels leave thousands of thin cracks, and
    splitting by owner leaves slivers. coverage_simplify widens both into
    visible gaps along exactly those (often modern) borders. Each crack and
    each small inland sliver joins the atom it shares the most border with;
    lakes stay holes.
    """
    features = [(key, geometry) for key, geometries in atoms.items() for geometry in geometries]
    tree = STRtree([geometry for _key, geometry in features])

    def neighbour(piece, exclude=None):
        best, best_length = None, 0.0
        for index in tree.query(piece.buffer(BORDER_PROBE_DEGREES)):
            key, geometry = features[int(index)]
            if key == exclude:
                continue
            length = shared_border(piece, geometry)
            if length > best_length:
                best, best_length = key, length
        return best

    extra = defaultdict(list)
    for part in hero.polygon_parts(unary_union([geometry for _key, geometry in features])):
        for ring in part.interiors:
            hole = Polygon(ring)
            key = neighbour(hole) if is_gap(hole) else None
            if key is not None:
                extra[key].append(hole)
    merged = {key: unary_union(atoms[key] + extra.get(key, [])) for key in atoms}

    moved = defaultdict(list)
    for key, geometry in merged.items():
        keep = []
        for part in hero.polygon_parts(geometry):
            target = neighbour(part, exclude=key) if part.area < MIN_PART_AREA else None
            (moved[target] if target is not None else keep).append(part)
        merged[key] = MultiPolygon([part for part in keep if part.geom_type == "Polygon"])
    for key, parts in moved.items():
        merged[key] = unary_union([merged[key], *parts])
    return merged


def clean_coverage(geometries: list) -> list:
    """Rebuild the atoms from one noded set of edges, so neighbours share them exactly.

    Snapping each atom to the grid on its own leaves edges that nearly but not
    quite meet, and coverage_simplify then pulls them apart into hairline seams.
    Every face of the noded edges goes to the first atom that contains it; a
    face no atom contains is a lake, or a crack that joins its neighbour.
    """
    edges = shapely.get_parts(shapely.node(shapely.GeometryCollection([geometry.boundary for geometry in geometries])))
    faces = list(shapely.get_parts(shapely.polygonize(edges)))
    owner = [None] * len(faces)
    for face_index, atom_index in zip(*STRtree(geometries).query(shapely.point_on_surface(faces), predicate="within")):
        if owner[face_index] is None or atom_index < owner[face_index]:
            owner[face_index] = int(atom_index)
    face_tree = STRtree(faces)
    for index, face in enumerate(faces):
        if owner[index] is not None or not is_gap(face):
            continue
        borders = [(shared_border(face, faces[other]), owner[other]) for other in face_tree.query(face.buffer(BORDER_PROBE_DEGREES)) if owner[other] is not None]
        owner[index] = max(borders, key=lambda item: item[0], default=(0.0, None))[1]
    parts = defaultdict(list)
    for face, atom_index in zip(faces, owner):
        if atom_index is not None:
            parts[atom_index].append(face)
    return [shapely.coverage_union_all(parts[index]) if parts[index] else MultiPolygon() for index in range(len(geometries))]


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


def owner_neighbours(owner_shapes: dict) -> dict:
    tags = [tag for tag in owner_shapes if tag]
    tree = STRtree([owner_shapes[tag] for tag in tags])
    neighbours = defaultdict(set)
    for tag in tags:
        for index in tree.query(owner_shapes[tag].buffer(NEIGHBOUR_DEGREES), predicate="intersects"):
            if tags[int(index)] != tag:
                neighbours[tag].add(tags[int(index)])
    return neighbours


def atlantropa_layers(canvas, clip, tno_state) -> tuple[dict, dict]:
    """TNO's Atlantropa: shoals keep their own look, land takes its owner's colour (as in the editor).

    The lowered sea is not drawn: the editor paints it in the ocean colour, so
    the page's own sea shows through. Also returns each owner's land, which
    moves 1962's coast and borders.
    """
    paths, _countries, owners = tno_state
    groups = defaultdict(list)
    for feature in hero.topology_features(paths["atlantropa_topology"], "scenario_atlantropa"):
        properties = feature.get("properties") or {}
        layer = properties.get("atl_render_layer")
        if layer not in {"shoal", "land"} or not feature.get("geometry"):
            continue
        geometry = hero.renderable_geometry(shape(feature["geometry"]))
        if geometry.is_empty or not geometry.intersects(clip):
            continue
        owner = owners.get(properties.get("id")) or properties.get("owner_tag") if layer == "land" else None
        groups[(layer, owner)].append(geometry.intersection(clip))
    result, land_by_owner = {"shoal": "", "land": []}, {}
    for (layer, owner), parts in sorted(groups.items(), key=lambda item: (item[0][0], item[0][1] or "")):
        merged = hero.canonicalize_hero_geometry(unary_union(parts))
        path = " ".join(hero.polygon_path(merged.simplify(SIMPLIFY_DEGREES / 2, preserve_topology=True), canvas, include_interiors=True))
        if not path:
            continue
        if layer == "land":
            land_by_owner[owner] = merged
            result["land"].append({"d": path, "o": owner})
        else:
            result[layer] = " ".join(filter(None, [result[layer], path]))
    return result, land_by_owner


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
    underlay_ids = {feature_id for feature_id, _geometry in underlays}
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
    detail = [(feature_id, geometry) for feature_id, geometry in base_features if feature_id not in underlay_ids]
    detail_keys = [tuple(lookup(feature_id, geometry) for lookup in lookups) for feature_id, geometry in detail]
    for key, (_feature_id, geometry) in zip(detail_keys, detail):
        atoms[key].append(geometry)
    # What detail leaves of a shell fills the gaps between datasets, and the shell's
    # own owner can be wrong there (Ukraine's shells are Soviet in 1936, under Polish
    # Galicia), so a small piece follows the detail it borders most. Large shells
    # and shells with no detail around them (Arctic coasts) keep their own owner.
    detail_tree = STRtree([geometry for _feature_id, geometry in detail])
    for feature_id, geometry in base_features:
        if feature_id not in underlay_ids:
            continue
        for part in hero.polygon_parts(geometry):
            near = detail_tree.query(part.buffer(BORDER_PROBE_DEGREES)) if part.area < SHELL_FOLLOW_MAX_AREA else []
            border, index = max(((shared_border(part, detail[int(index)][1]), int(index)) for index in near), default=(0.0, None))
            atoms[detail_keys[index] if border > 0 else tuple(lookup(feature_id, part) for lookup in lookups)].append(part)

    closed = close_coverage(atoms)
    keys = list(closed)
    merged_list = [
        MultiPolygon([part for part in hero.polygon_parts(hero.canonicalize_hero_geometry(closed[key])) if part.geom_type == "Polygon"])
        for key in keys
    ]
    # Simplify the atoms as one coverage so neighbours keep identical shared edges.
    # coverage_simplify can return invalid rings for large atoms; repair before use.
    simplified_list = shapely.coverage_simplify(clean_coverage(merged_list), SIMPLIFY_DEGREES)
    merged_by_key = {key: drop_specks(hero.renderable_geometry(simplified)) for key, simplified in zip(keys, simplified_list)}

    # Atlantropa land joins 1962's owners: it moves that state's coast, borders and labels.
    atlantropa, atlantropa_land = atlantropa_layers(canvas, clip, states[2])
    land = hero.canonicalize_hero_geometry(unary_union(list(merged_by_key.values())))
    land_1962 = hero.canonicalize_hero_geometry(unary_union([land, *atlantropa_land.values()]))
    coast, coast_1962 = land.boundary, land_1962.boundary
    owner_shapes_by_state, palettes = [], []
    for year_index in range(len(STATES)):
        by_owner = defaultdict(list)
        for key, merged in merged_by_key.items():
            by_owner[key[year_index]].append(merged)
        if year_index == 2:
            for tag, geometry in atlantropa_land.items():
                by_owner[tag].append(geometry)
        owner_shapes = {tag: hero.canonicalize_hero_geometry(unary_union(parts)) for tag, parts in by_owner.items()}
        owner_shapes_by_state.append(owner_shapes)
        palettes.append(stage_palette(states[year_index][1], owner_neighbours(owner_shapes)))

    atom_records = []
    for key, merged in zip(keys, merged_list):
        path = " ".join(hero.polygon_path(merged_by_key[key], canvas, include_interiors=True))
        if not path:
            continue
        centroid = merged.centroid
        cx, _cy = canvas.project(centroid.x, centroid.y)
        atom_records.append({
            "area": merged.area,
            "d": path,
            "c": [palettes[index][tag] for index, tag in enumerate(key)],
            "o": list(key),
            "x": round(max(0.0, min(1.0, cx / WIDTH)), 3),
        })
    # Largest first: an enclave is drawn after its container, so it stays visible
    # even where the container's tiny hole was dropped as a speck.
    atom_records.sort(key=lambda record: -record.pop("area"))
    for record in atlantropa["land"]:
        record["c"] = palettes[2][record["o"]]
    # The coast Atlantropa moves: the old line fades out as the new one fades in.
    atlantropa["coast"] = " ".join(project_lines(coast_1962.difference(coast.buffer(COAST_BAND_DEGREES)).intersection(clip), canvas))
    atlantropa["old_coast"] = " ".join(project_lines(coast.difference(coast_1962.buffer(COAST_BAND_DEGREES)).intersection(clip), canvas))
    stable_coast = coast.intersection(coast_1962.buffer(COAST_BAND_DEGREES))

    borders, labels, names = [], [], []
    for year_index, owner_shapes in enumerate(owner_shapes_by_state):
        coast_band = (coast_1962 if year_index == 2 else coast).buffer(COAST_BAND_DEGREES)
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

    payload = {
        "schema_version": 1,
        "width": WIDTH,
        "height": HEIGHT,
        "states": [{"id": state, "family": family} for state, family, _manifest in STATES],
        "graticule": graticule(canvas),
        "atoms": atom_records,
        "coast": " ".join(project_lines(stable_coast.intersection(clip), canvas)),
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
