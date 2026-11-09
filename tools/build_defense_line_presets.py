import argparse
import json
import math
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/operational_presets/defense_lines.json"
WAYPOINTS = {
    "maginot": [
        (5.6014, 49.4478),  # Longuyon
        (5.7606, 49.52),  # Longwy
        (6.1604, 49.3599),  # Thionville
        (6.3656, 49.3414),  # Ouvrage Hackenberg
        (6.6642, 49.0578),  # Téting-sur-Nied
        (7.1467, 49.0553),  # Wittring
        (7.43, 49.0525),  # Bitche
        (7.8337, 48.9845),  # Ouvrage Hochwald
        (8.1744, 48.9761),  # Lauterbourg
        (7.7455, 48.5839),  # Strasbourg
        (7.5285, 48.0177),  # Neuf-Brisach
        (7.5844, 47.5919),  # Huningue
    ],
    "siegfried": [
        (6.1838, 51.2405),  # Brüggen
        (6.1176, 50.9674),  # Geilenkirchen
        (6.0834, 50.7766),  # Aachen
        (6.2564, 50.56),  # Monschau
        (6.4244, 50.2081),  # Prüm
        (6.4561, 49.8472),  # Irrel
        (6.6387, 49.4433),  # Merzig
        (7.0098, 49.2326),  # Saarbrücken
        (7.3698, 49.2469),  # Zweibrücken
        (7.6053, 49.2015),  # Pirmasens
        (8.2097, 48.8585),  # Rastatt
        (7.8152, 48.573),  # Kehl
        (7.583, 48.033),  # Breisach
        (7.6208, 47.5933),  # Weil am Rhein
    ],
    "mannerheim": [
        (29.0124, 60.5073),  # Summa
        (29.567, 60.55),  # Muolaa
        (30.001, 60.678),  # Kiviniemi
        (30.5, 60.633),  # Taipale
    ],
    "metaxas": [
        (23.083, 41.217),  # Kerkini
        (23.371, 41.346),  # Fort Roupel
        (23.867, 41.35),  # Kato Nevrokopi
        (24.5, 41.267),  # Paranesti
        (24.9717, 41.275),  # Echinos
        (25.4059, 41.1176),  # Komotini
    ],
    "stalin": [
        (28.6141, 59.3763),  # Kingisepp
        (28.3318, 57.8192),  # Pskov
        (28.3536, 57.3438),  # Ostrov [1938]
        (28.483, 56.267),  # Sebezh [1938]
        (28.7856, 55.4879),  # Polotsk
        (27.5665, 53.9002),  # Minsk
        (27.5416, 53.0152),  # Slutsk [1938]
        (29.2163, 52.0416),  # Mazyr
        (28.6386, 50.9512),  # Korosten
        (27.6088, 50.5914),  # Novohrad-Volynskyi
        (27.0652, 50.1812),  # Shepetivka [1938]
        (26.8, 50.117),  # Iziaslav [1938]
        (27.2208, 49.7556),  # Starokostiantyniv [1938]
        (27.5642, 49.7978),  # Ostropil [1938]
        (27.617, 49.383),  # Letychiv
        (26.5852, 48.6788),  # Kamianets-Podilskyi [1938]
        (27.7998, 48.4428),  # Mohyliv-Podilskyi
        (29.01, 47.7682),  # Rîbnița
        (29.6284, 46.8428),  # Tiraspol
    ],
    "stalin_karelia": [
        (29.97, 60.1),  # Sestroretsk
        (30.333, 60.417),  # Lembolovo
    ],
}
STALIN_1938 = {2, 3, 6, 10, 11, 12, 13, 15}
METADATA = {
    "maginot": ("Maginot Line", "马其诺防线", "1929–1938", "https://en.wikipedia.org/wiki/Maginot_Line"),
    "siegfried": ("Siegfried Line (Westwall)", "齐格菲防线（西墙）", "1936–1940", "https://en.wikipedia.org/wiki/Siegfried_Line"),
    "mannerheim": ("Mannerheim Line", "曼纳海姆防线", "1920–1924, 1932–1939", "https://en.wikipedia.org/wiki/Mannerheim_Line"),
    "metaxas": ("Metaxas Line", "梅塔克萨斯防线", "1936–1941", "https://en.wikipedia.org/wiki/Metaxas_Line"),
    "stalin": ("Stalin Line", "斯大林防线", "1928–1939", "https://ru.wikipedia.org/wiki/Линия_Сталина"),
    "stalin_karelia": ("Stalin Line – Karelian Fortified Region", "斯大林防线·卡累利阿筑垒地域", "1928–1939", "https://ru.wikipedia.org/wiki/Линия_Сталина"),
}


def decode_arcs(topology):
    transform = topology.get("transform")
    if not transform:
        return topology["arcs"]
    decoded = []
    for arc in topology["arcs"]:
        x = y = 0
        points = []
        for dx, dy in arc:
            x += dx
            y += dy
            points.append([
                x * transform["scale"][0] + transform["translate"][0],
                y * transform["scale"][1] + transform["translate"][1],
            ])
        decoded.append(points)
    return decoded


def distance_km(a, b):
    return math.hypot(
        (a[0] - b[0]) * 111 * math.cos(math.radians((a[1] + b[1]) / 2)),
        (a[1] - b[1]) * 111,
    )


def stitch_arcs(segments):
    pool = list(segments)
    start = max(range(len(pool)), key=lambda i: max(pool[i][0][1], pool[i][-1][1]))
    segment = pool.pop(start)
    line = list(segment if segment[0][1] >= segment[-1][1] else segment[::-1])
    while pool:
        distance, index, reverse = min(
            (distance_km(line[-1], segment[-1] if reverse else segment[0]), index, reverse)
            for index, segment in enumerate(pool)
            for reverse in (False, True)
        )
        if distance > 60:
            break
        segment = pool.pop(index)
        if reverse:
            segment = segment[::-1]
        line.extend(segment[1:] if distance < 1e-6 else segment)
    return line


def simplify(points, tolerance=0.04):
    if len(points) < 3:
        return points
    a, b = points[0], points[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    distances = [
        abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / length
        if length else math.dist(a, p)
        for p in points[1:-1]
    ]
    index = max(range(len(distances)), key=distances.__getitem__)
    if distances[index] > tolerance:
        return simplify(points[:index + 2], tolerance)[:-1] + simplify(points[index + 1:], tolerance)
    return [a, b]


def derive_aa_line():
    paths = [f"data/scenarios/tno_1962/{name}" for name in (
        "runtime_topology.topo.json", "owners.by_feature.json", "countries.json",
    )]
    topology, ownership, country_data = [json.loads((ROOT / path).read_text(encoding="utf-8")) for path in paths]
    reich = {"GER", "RKM", "RKK", "RKU"}
    russia = {tag for tag, country in country_data["countries"].items()
              if country.get("inspector_group_id") == "scenario_group_russia_region"}
    sides = defaultdict(set)
    for geometry in topology["objects"]["political"]["geometries"]:
        owner = ownership["owners"].get(geometry.get("properties", {}).get("id"))
        side = "reich" if owner in reich else "russia" if owner in russia else None
        if side is None:
            continue
        polygons = geometry["arcs"] if geometry["type"] == "MultiPolygon" else [geometry["arcs"]]
        for polygon in polygons:
            for ring in polygon:
                for arc_id in ring:
                    sides[arc_id if arc_id >= 0 else ~arc_id].add(side)
    arcs = decode_arcs(topology)
    segments = [arcs[index] for index, groups in sides.items()
                if groups == {"reich", "russia"}
                and all(28 <= p[0] <= 60 and 48 <= p[1] <= 66 for p in arcs[index])]
    return {
        "id": "aa_line", "label_en": "A-A Line (Reich eastern frontier)",
        "label_zh": "A-A 线（帝国东方边界）", "built": "", "sources": paths,
        "derivation": "scenario-ownership", "points": simplify(stitch_arcs(segments)),
    }


def build_payload():
    scenarios = {}
    for scenario in ("hoi4_1936", "hoi4_1939"):
        lines = []
        for line_id, (label_en, label_zh, built, source) in METADATA.items():
            if scenario == "hoi4_1936" and line_id in {"siegfried", "metaxas"}:
                continue
            points = WAYPOINTS[line_id]
            if scenario == "hoi4_1936" and line_id == "stalin":
                points = [point for index, point in enumerate(points) if index not in STALIN_1938]
            lines.append({"id": line_id, "label_en": label_en, "label_zh": label_zh,
                          "built": built, "sources": [source], "derivation": "waypoints", "points": points})
        scenarios[scenario] = lines
    scenarios["tno_1962"] = [derive_aa_line()]
    for lines in scenarios.values():
        for line in lines:
            line["points"] = [[round(lon, 3), round(lat, 3)] for lon, lat in line["points"]]
    return {"version": 1, "scenarios": scenarios}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    payload = build_payload()
    for scenario, lines in payload["scenarios"].items():
        for line in lines:
            print(f"{scenario}/{line['id']}: {len(line['points'])} points")
    content = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.check:
        return 0 if OUTPUT.exists() and OUTPUT.read_bytes() == content.encode("utf-8") else 1
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(content.encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
