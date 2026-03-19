"""North America detail replacement (US/CA/MX hybrid tiers)."""
from __future__ import annotations

import csv
import math
import os
from collections import deque
from pathlib import Path
import tempfile

import geopandas as gpd
import pandas as pd
import requests
from shapely.geometry import LineString
from shapely.ops import unary_union
from shapely.ops import split as split_geometry

from map_builder import config as cfg
from map_builder.geo.utils import pick_column
from map_builder.io.fetch import fetch_or_load_geojson, get_headers

_PROVINCE_BY_FED_PREFIX = {
    "10": "Newfoundland and Labrador",
    "11": "Prince Edward Island",
    "12": "Nova Scotia",
    "13": "New Brunswick",
    "24": "Quebec",
    "35": "Ontario",
    "46": "Manitoba",
    "47": "Saskatchewan",
    "48": "Alberta",
    "59": "British Columbia",
    "60": "Yukon",
    "61": "Northwest Territories",
    "62": "Nunavut",
}

_US_TERRITORY_CODES = {"AS", "GU", "MP", "PR", "VI"}


def _data_dir() -> Path:
    path = Path(__file__).resolve().parents[2] / "data"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _ensure_epsg4326(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326", allow_override=True)
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")
    return gdf


def _sjoin_nearest_projected(
    left: gpd.GeoDataFrame,
    right: gpd.GeoDataFrame,
    *,
    distance_col: str,
) -> gpd.GeoDataFrame:
    left_proj = _ensure_epsg4326(left).to_crs(cfg.AREA_CRS).copy()
    right_proj = _ensure_epsg4326(right).to_crs(cfg.AREA_CRS).copy()
    return gpd.sjoin_nearest(
        left_proj,
        right_proj,
        how="left",
        distance_col=distance_col,
    )


def _download_to_cache(
    url: str,
    filename: str,
    *,
    fallback_urls: list[str] | None = None,
) -> Path:
    path = _data_dir() / filename
    if path.exists() and path.stat().st_size > 0:
        return path

    sources = [url]
    if fallback_urls:
        sources.extend(fallback_urls)

    last_error: Exception | None = None
    for source in sources:
        try:
            response = requests.get(source, timeout=(10, 180), headers=get_headers())
            response.raise_for_status()
            path.write_bytes(response.content)
            return path
        except requests.RequestException as exc:
            last_error = exc
            print(f"[North America] Download failed ({source}): {exc}")

    raise SystemExit(f"[North America] Failed to download {filename}: {last_error}")


def _read_zip_layer(
    url: str,
    filename: str,
    label: str,
    *,
    fallback_urls: list[str] | None = None,
) -> gpd.GeoDataFrame:
    cache_path = _download_to_cache(url, filename, fallback_urls=fallback_urls)
    print(f"[North America] Loading {label} from {cache_path.name} ...")
    try:
        gdf = gpd.read_file(f"zip://{cache_path}")
    except Exception as exc:
        raise SystemExit(f"[North America] Failed reading {label} zip: {exc}") from exc
    if gdf.empty:
        raise SystemExit(f"[North America] {label} dataset is empty.")
    return _ensure_epsg4326(gdf)


def _load_cached_csv(url: str, filename: str) -> pd.DataFrame:
    cache_path = _data_dir() / filename
    required_columns = {"STATE", "COUNTY"}

    def _validate_csv(path: Path) -> None:
        try:
            with path.open("r", encoding="latin1", newline="") as handle:
                header = next(csv.reader(handle), [])
        except Exception as exc:
            raise SystemExit(f"[North America] Failed reading cached CSV {path.name}: {exc}") from exc
        header_set = {str(value).strip().upper() for value in header if str(value).strip()}
        if not required_columns.issubset(header_set):
            raise SystemExit(
                f"[North America] Invalid CSV cache {path.name}: missing expected columns {sorted(required_columns)}."
            )

    if cache_path.exists() and cache_path.stat().st_size > 0:
        try:
            _validate_csv(cache_path)
        except SystemExit:
            cache_path.unlink(missing_ok=True)
    if not cache_path.exists() or cache_path.stat().st_size == 0:
        fd, temp_name = tempfile.mkstemp(
            prefix=f".{cache_path.name}.",
            suffix=".tmp",
            dir=cache_path.parent,
        )
        temp_path = Path(temp_name)
        try:
            os.close(fd)
            try:
                response = requests.get(url, timeout=(10, 180), headers=get_headers())
                response.raise_for_status()
            except requests.RequestException as exc:
                raise SystemExit(f"[North America] Failed downloading {filename} from {url}: {exc}") from exc
            temp_path.write_bytes(response.content)
            _validate_csv(temp_path)
            temp_path.replace(cache_path)
        finally:
            temp_path.unlink(missing_ok=True)
    try:
        return pd.read_csv(cache_path, encoding="latin1", dtype={"STATE": str, "COUNTY": str})
    except Exception as exc:
        cache_path.unlink(missing_ok=True)
        raise SystemExit(f"[North America] Failed parsing cached CSV {cache_path.name}: {exc}") from exc


def _clean_text(value: object) -> str:
    if value is None:
        return ""
    try:
        if bool(pd.isna(value)):
            return ""
    except (TypeError, ValueError):
        pass
    return " ".join(str(value or "").split())


def _county_legal_name(row: pd.Series | dict[str, object]) -> str:
    if isinstance(row, pd.Series):
        data = row.to_dict()
    else:
        data = row
    return _clean_text(data.get("NAMELSAD")) or _clean_text(data.get("NAME")) or _clean_text(data.get("GEOID"))


def _best_us_anchor_county(frame: pd.DataFrame) -> pd.Series:
    if frame.empty:
        raise ValueError("Cannot select anchor county from empty frame.")

    work = frame.copy()
    work["population"] = pd.to_numeric(work.get("population"), errors="coerce").fillna(0.0)
    work["ALAND"] = pd.to_numeric(work.get("ALAND"), errors="coerce").fillna(0.0)
    work["GEOID"] = work.get("GEOID", "").fillna("").astype(str)
    work = work.sort_values(
        by=["population", "ALAND", "GEOID"],
        ascending=[False, False, True],
        kind="stable",
    )
    return work.iloc[0]


def _assign_us_feature_names(us_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if us_gdf.empty:
        return us_gdf

    out = _ensure_epsg4326(us_gdf.copy())
    for col in ("legacy_name", "anchor_county_name"):
        if col not in out.columns:
            out[col] = ""
        out[col] = out[col].fillna("").astype(str).str.strip()

    city_name_by_feature: dict[str, str] = {}
    top_n = int(getattr(cfg, "US_CITY_RENAME_TOP_N", 25) or 0)
    if top_n > 0:
        from map_builder.cities import build_country_city_catalog

        city_catalog = build_country_city_catalog("US", top_n=top_n)
        if not city_catalog.empty:
            city_points = city_catalog[["id", "name", "population", "capital_kind", "geometry"]].copy()
            feature_ref = out[["id", "geometry"]].copy()
            try:
                joined = gpd.sjoin(city_points, feature_ref, how="left", predicate="within")
            except Exception:
                joined = gpd.sjoin(city_points, feature_ref, how="left", predicate="intersects")
            joined = joined.rename(columns={"id_left": "city_id", "id_right": "feature_id"})
            joined = joined[joined["feature_id"].fillna("").astype(str) != ""].copy()
            if not joined.empty:
                joined["population"] = pd.to_numeric(joined["population"], errors="coerce").fillna(0.0)
                joined["capital_score"] = joined["capital_kind"].apply(
                    lambda value: 3 if _clean_text(value) == "country_capital" else 2 if _clean_text(value) == "admin_capital" else 1
                )
                joined["name_sort"] = joined["name"].fillna("").astype(str)
                joined["city_id"] = joined["city_id"].fillna("").astype(str)
                joined = joined.sort_values(
                    by=["feature_id", "population", "capital_score", "name_sort", "city_id"],
                    ascending=[True, False, False, True, True],
                    kind="stable",
                )
                best = joined.groupby("feature_id", sort=False).first()
                city_name_by_feature = {
                    str(feature_id): _clean_text(name)
                    for feature_id, name in best["name"].items()
                    if _clean_text(name)
                }

    final_names: list[str] = []
    for row in out.itertuples(index=False):
        city_name = city_name_by_feature.get(str(row.id), "")
        anchor_name = _clean_text(getattr(row, "anchor_county_name", ""))
        current_name = _clean_text(getattr(row, "name", ""))
        final_names.append(city_name or anchor_name or current_name)
    out["name"] = final_names
    return out


def _load_admin0_country(iso_code: str, country_names: list[str] | None = None) -> gpd.GeoDataFrame:
    admin0 = _read_zip_layer(
        cfg.BORDERS_URL,
        cfg.BORDERS_URL.rsplit("/", 1)[-1],
        "Natural Earth admin0",
    )
    iso_col = pick_column(admin0, ["ISO_A2", "iso_a2", "ADM0_A2", "adm0_a2", "iso_3166_1_"])
    name_col = pick_column(admin0, ["ADMIN", "admin", "NAME", "name", "NAME_LONG", "name_long"])

    if iso_col:
        subset = admin0[admin0[iso_col].astype(str).str.upper() == iso_code].copy()
        if not subset.empty:
            return subset
    if name_col and country_names:
        subset = admin0[admin0[name_col].isin(country_names)].copy()
        if not subset.empty:
            return subset
    return admin0.iloc[0:0].copy()


def _load_admin1_country(iso_code: str, country_names: list[str] | None = None) -> gpd.GeoDataFrame:
    local_admin1 = _data_dir() / "ne_10m_admin_1_states_provinces.shp"
    if local_admin1.exists():
        admin1 = gpd.read_file(local_admin1)
    else:
        from map_builder.io.fetch import fetch_ne_zip

        admin1 = fetch_ne_zip(cfg.ADMIN1_URL, "admin1_north_america")

    admin1 = _ensure_epsg4326(admin1)
    iso_col = pick_column(admin1, ["iso_a2", "adm0_a2", "iso_3166_1_", "iso_3166_1_alpha_2"])
    name_col = pick_column(admin1, ["admin", "adm0_name", "admin0_name"])

    if iso_col:
        subset = admin1[admin1[iso_col] == iso_code].copy()
        if not subset.empty:
            return subset
    if name_col and country_names:
        subset = admin1[admin1[name_col].isin(country_names)].copy()
        if not subset.empty:
            return subset
    return admin1.iloc[0:0].copy()


def _assign_admin1_group(
    source: gpd.GeoDataFrame,
    admin1: gpd.GeoDataFrame,
    *,
    fallback_col: str,
    output_col: str = "admin1_group",
) -> gpd.GeoDataFrame:
    if source.empty:
        source[output_col] = ""
        return source

    out = source.copy()
    if fallback_col in out.columns:
        fallback_values = out[fallback_col]
    else:
        fallback_values = pd.Series([""] * len(out), index=out.index)
    out[output_col] = fallback_values.fillna("").astype(str).str.strip()
    if admin1.empty:
        return out

    name_col = pick_column(admin1, ["name_en", "name", "name_long", "name_local", "gn_name", "namealt"])
    if not name_col:
        return out

    candidates = admin1[[name_col, "geometry"]].copy()
    reps = out.copy()
    reps["geometry"] = reps.geometry.representative_point()
    try:
        joined = gpd.sjoin(reps, candidates, how="left", predicate="within")
    except Exception:
        joined = gpd.sjoin(reps, candidates, how="left", predicate="intersects")

    mapped = joined[name_col].groupby(level=0).first()
    out.loc[mapped.index, output_col] = (
        out.loc[mapped.index, output_col]
        .where(out.loc[mapped.index, output_col] != "", mapped.astype(str))
    )

    unresolved = out[output_col].fillna("").astype(str).str.strip() == ""
    if unresolved.any():
        try:
            nearest = _sjoin_nearest_projected(
                reps.loc[unresolved].copy(),
                candidates,
                distance_col="__dist",
            )
            nearest_map = nearest[name_col].groupby(level=0).first()
            out.loc[nearest_map.index, output_col] = (
                out.loc[nearest_map.index, output_col]
                .where(out.loc[nearest_map.index, output_col] != "", nearest_map.astype(str))
            )
        except Exception:
            pass

    out[output_col] = out[output_col].fillna("").astype(str).str.strip()
    return out


def _build_adjacency(gdf: gpd.GeoDataFrame) -> list[set[int]]:
    geoms = list(gdf.geometry)
    n = len(geoms)
    adjacency = [set() for _ in range(n)]
    sindex = gdf.sindex

    for i in range(n):
        geom_i = geoms[i]
        if geom_i is None or geom_i.is_empty:
            continue
        try:
            candidates = list(sindex.query(geom_i, predicate="intersects"))
        except TypeError:
            candidates = list(sindex.intersection(geom_i.bounds))
        for j in candidates:
            j = int(j)
            if j <= i:
                continue
            geom_j = geoms[j]
            if geom_j is None or geom_j.is_empty:
                continue
            try:
                if geom_i.intersects(geom_j):
                    adjacency[i].add(j)
                    adjacency[j].add(i)
            except Exception:
                continue
    return adjacency


def _connected_components(nodes: set[int], adjacency: list[set[int]]) -> list[list[int]]:
    remaining = set(nodes)
    components: list[list[int]] = []
    while remaining:
        seed = min(remaining)
        queue = deque([seed])
        remaining.remove(seed)
        comp = [seed]
        while queue:
            cur = queue.popleft()
            for nxt in sorted(adjacency[cur]):
                if nxt not in remaining:
                    continue
                remaining.remove(nxt)
                queue.append(nxt)
                comp.append(nxt)
        components.append(comp)
    return components


def _allocate_component_quotas(component_sizes: list[int], target: int) -> list[int]:
    if not component_sizes:
        return []

    n_comp = len(component_sizes)
    if target <= 0:
        return [0] * n_comp

    if target >= sum(component_sizes):
        return component_sizes[:]

    if target < n_comp:
        ranked = sorted(range(n_comp), key=lambda idx: component_sizes[idx], reverse=True)
        quotas = [0] * n_comp
        for idx in ranked[:target]:
            quotas[idx] = 1
        return quotas

    quotas = [1] * n_comp
    remaining = target - n_comp
    weights = [float(size) for size in component_sizes]
    total_weight = max(sum(weights), 1.0)
    raw = [remaining * w / total_weight for w in weights]
    floors = [int(math.floor(v)) for v in raw]
    remainders = [v - f for v, f in zip(raw, floors)]

    for idx in range(n_comp):
        quotas[idx] += floors[idx]

    current = sum(quotas)
    ranked = sorted(range(n_comp), key=lambda idx: remainders[idx], reverse=True)
    cursor = 0
    while current < target and ranked:
        idx = ranked[cursor % len(ranked)]
        quotas[idx] += 1
        current += 1
        cursor += 1

    while current > target:
        idx = max(range(n_comp), key=lambda i: quotas[i] - 1)
        if quotas[idx] <= 1:
            break
        quotas[idx] -= 1
        current -= 1

    # Respect component capacity (cannot create more zones than polygons in a component).
    overflow = 0
    for idx in range(n_comp):
        cap = component_sizes[idx]
        if quotas[idx] > cap:
            overflow += quotas[idx] - cap
            quotas[idx] = cap

    while overflow > 0:
        eligible = [idx for idx in range(n_comp) if quotas[idx] < component_sizes[idx]]
        if not eligible:
            break
        idx = max(
            eligible,
            key=lambda i: (component_sizes[i] - quotas[i], component_sizes[i], -i),
        )
        quotas[idx] += 1
        overflow -= 1

    current = sum(quotas)
    while current < target:
        eligible = [idx for idx in range(n_comp) if quotas[idx] < component_sizes[idx]]
        if not eligible:
            break
        idx = max(
            eligible,
            key=lambda i: (component_sizes[i] - quotas[i], component_sizes[i], -i),
        )
        quotas[idx] += 1
        current += 1

    while current > target:
        eligible = [idx for idx in range(n_comp) if quotas[idx] > 0]
        if not eligible:
            break
        idx = max(eligible, key=lambda i: (quotas[i], component_sizes[i], -i))
        quotas[idx] -= 1
        current -= 1

    return quotas


def _sq_dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    dx = a[0] - b[0]
    dy = a[1] - b[1]
    return dx * dx + dy * dy


def _partition_component(
    nodes: list[int],
    adjacency: list[set[int]],
    points: list[tuple[float, float]],
    quota: int,
) -> list[list[int]]:
    if not nodes:
        return []
    if quota <= 1:
        return [nodes[:]]
    if quota >= len(nodes):
        return [[idx] for idx in sorted(nodes)]

    remaining = set(nodes)
    groups: list[list[int]] = []

    for group_idx in range(quota):
        if not remaining:
            groups.append([])
            continue

        rem_nodes = len(remaining)
        rem_groups = quota - group_idx
        target_size = max(1, int(round(rem_nodes / rem_groups)))
        target_size = min(target_size, rem_nodes - (rem_groups - 1))

        seed = min(remaining, key=lambda i: (points[i][0], points[i][1], i))
        seed_pt = points[seed]
        frontier = deque([seed])
        queued: set[int] = {seed}
        group: list[int] = []

        while len(group) < target_size:
            if frontier:
                cur = frontier.popleft()
                queued.discard(cur)
                if cur not in remaining:
                    continue
                remaining.remove(cur)
                group.append(cur)
                neighbors = [n for n in adjacency[cur] if n in remaining]
                neighbors.sort(key=lambda i: (_sq_dist(points[i], seed_pt), i))
                for nxt in neighbors:
                    if nxt not in remaining or nxt in queued:
                        continue
                    queued.add(nxt)
                    frontier.append(nxt)
                    if len(group) + len(frontier) >= target_size:
                        break
                continue

            if not remaining:
                break

            # Keep growth connected whenever possible.
            boundary: set[int] = set()
            for node in group:
                boundary.update(n for n in adjacency[node] if n in remaining)
            if boundary:
                cx = sum(points[i][0] for i in group) / max(len(group), 1)
                cy = sum(points[i][1] for i in group) / max(len(group), 1)
                nxt = min(boundary, key=lambda i: (_sq_dist(points[i], (cx, cy)), i))
            else:
                nxt = min(remaining, key=lambda i: (_sq_dist(points[i], seed_pt), i))
            if nxt not in queued:
                queued.add(nxt)
                frontier.append(nxt)

        groups.append(group)

    if remaining:
        groups[-1].extend(sorted(remaining))
    return [grp for grp in groups if grp]


def _clip_features_to_country_shell(
    detail_gdf: gpd.GeoDataFrame,
    shell_gdf: gpd.GeoDataFrame | None,
    *,
    label: str,
) -> gpd.GeoDataFrame:
    if detail_gdf.empty or shell_gdf is None or shell_gdf.empty:
        return detail_gdf

    shell_gdf = _ensure_epsg4326(shell_gdf.copy())
    shell_gdf = shell_gdf[shell_gdf.geometry.notna() & ~shell_gdf.geometry.is_empty].copy()
    if shell_gdf.empty:
        print(f"[North America] {label}: shell empty; skipping clip.")
        return detail_gdf

    if hasattr(shell_gdf.geometry, "make_valid"):
        shell_gdf["geometry"] = shell_gdf.geometry.make_valid()
    else:
        shell_gdf["geometry"] = shell_gdf.geometry.buffer(0)

    shell_union = unary_union(shell_gdf.geometry.tolist())
    if shell_union is None or shell_union.is_empty:
        print(f"[North America] {label}: shell union empty; skipping clip.")
        return detail_gdf

    clipped = detail_gdf.copy()
    if hasattr(clipped.geometry, "make_valid"):
        clipped["geometry"] = clipped.geometry.make_valid()
    else:
        clipped["geometry"] = clipped.geometry.buffer(0)
    clipped["geometry"] = clipped.geometry.intersection(shell_union)
    clipped = clipped[clipped.geometry.notna() & ~clipped.geometry.is_empty].copy()
    if clipped.empty:
        print(f"[North America] {label}: clip produced empty result; keeping original detail.")
        return detail_gdf
    return clipped


def _rebalance_groups(groups: list[list[int]], target: int) -> list[list[int]]:
    normalized = [list(dict.fromkeys(group)) for group in groups if group]
    if target <= 0:
        return []
    if not normalized:
        return []

    while len(normalized) > target:
        normalized.sort(key=lambda grp: (len(grp), grp[0]))
        merged = normalized.pop(0)
        normalized[0].extend(merged)
        normalized[0] = list(dict.fromkeys(normalized[0]))

    while len(normalized) < target:
        split_idx = max(range(len(normalized)), key=lambda idx: len(normalized[idx]))
        members = normalized[split_idx]
        if len(members) <= 1:
            break
        half = max(1, len(members) // 2)
        left = members[:half]
        right = members[half:]
        normalized[split_idx] = left
        normalized.append(right)

    return [group for group in normalized if group]


def _partition_indices(gdf: gpd.GeoDataFrame, quota: int) -> list[list[int]]:
    if gdf.empty:
        return []
    n = len(gdf)
    if quota <= 1:
        return [list(range(n))]
    if quota >= n:
        return [[idx] for idx in range(n)]

    adjacency = _build_adjacency(gdf)
    reps = gdf.geometry.representative_point()
    points = [(float(pt.x), float(pt.y)) for pt in reps]
    all_nodes = set(range(n))
    components = _connected_components(all_nodes, adjacency)
    components.sort(
        key=lambda comp: (
            min(points[i][0] for i in comp),
            min(points[i][1] for i in comp),
            min(comp),
        )
    )
    quota = max(len(components), min(quota, n))
    component_sizes = [len(comp) for comp in components]
    component_quotas = _allocate_component_quotas(component_sizes, quota)

    groups: list[list[int]] = []
    for comp, comp_quota in zip(components, component_quotas):
        if comp_quota <= 0:
            continue
        groups.extend(_partition_component(comp, adjacency, points, comp_quota))
    return [group for group in groups if group]


def _component_floor(gdf: gpd.GeoDataFrame) -> int:
    if gdf.empty:
        return 0
    adjacency = _build_adjacency(gdf)
    components = _connected_components(set(range(len(gdf))), adjacency)
    return len(components)


def _select_us_locked_indices(
    state_df: gpd.GeoDataFrame,
    quota: int,
    fine_threshold: float,
) -> tuple[set[int], gpd.GeoDataFrame, int, int]:
    candidates = (
        state_df[state_df["population"] >= fine_threshold]
        .sort_values("population", ascending=False)
        .index.tolist()
    )
    max_locked = min(len(candidates), max(0, quota - 1))

    for locked_count in range(max_locked, -1, -1):
        locked_indices = set(candidates[:locked_count])
        rest_df = state_df.drop(index=list(locked_indices)).reset_index(drop=True)
        if rest_df.empty:
            return locked_indices, rest_df, 0, 0
        component_floor = _component_floor(rest_df)
        rest_quota = max(1, quota - locked_count)
        if rest_quota >= component_floor:
            return locked_indices, rest_df, rest_quota, component_floor

    locked_indices: set[int] = set()
    rest_df = state_df.reset_index(drop=True)
    component_floor = _component_floor(rest_df)
    return locked_indices, rest_df, max(1, component_floor), component_floor


def _split_geometry_once(geom):
    if geom is None or geom.is_empty:
        return None
    minx, miny, maxx, maxy = geom.bounds
    width = maxx - minx
    height = maxy - miny
    if width <= 0 or height <= 0:
        return None

    if width >= height:
        midx = (minx + maxx) / 2.0
        cutter = LineString([(midx, miny - height), (midx, maxy + height)])
    else:
        midy = (miny + maxy) / 2.0
        cutter = LineString([(minx - width, midy), (maxx + width, midy)])

    try:
        parts = split_geometry(geom, cutter)
    except Exception:
        return None
    candidates = [part for part in parts.geoms if part is not None and not part.is_empty]
    if len(candidates) < 2:
        return None
    candidates = sorted(candidates, key=lambda g: g.area, reverse=True)
    first = candidates[0]
    second = unary_union(candidates[1:]) if len(candidates) > 2 else candidates[1]
    if second is None or second.is_empty:
        return None
    return first, second


def _top_up_us_feature_count(us_out: gpd.GeoDataFrame, target_count: int) -> gpd.GeoDataFrame:
    if us_out.empty or len(us_out) >= target_count:
        return us_out

    work = _ensure_epsg4326(us_out.copy().reset_index(drop=True))
    known_ids = set(work["id"].astype(str))
    blocked: set[str] = set()
    guard = 0
    max_guard = max(2000, (target_count - len(work)) * 50)

    while len(work) < target_count and guard < max_guard:
        guard += 1
        coarse = work[work["detail_tier"] == "coarse"].copy()
        if coarse.empty:
            break

        coarse = coarse[~coarse["id"].astype(str).isin(blocked)]
        if coarse.empty:
            break

        coarse_metric = coarse.to_crs("EPSG:6933")
        coarse["__area"] = coarse_metric.geometry.area
        pick_idx = int(coarse.sort_values("__area", ascending=False).index[0])
        base = work.loc[pick_idx].copy()
        split_parts = _split_geometry_once(base.geometry)
        if not split_parts:
            blocked.add(str(base["id"]))
            continue

        left_geom, right_geom = split_parts
        base_id = str(base["id"])
        left_id = f"{base_id}__A"
        right_id = f"{base_id}__B"
        suffix = 1
        while left_id in known_ids:
            left_id = f"{base_id}__A{suffix}"
            suffix += 1
        suffix = 1
        while right_id in known_ids or right_id == left_id:
            right_id = f"{base_id}__B{suffix}"
            suffix += 1

        left_row = base.copy()
        left_row["id"] = left_id
        left_row["geometry"] = left_geom

        right_row = base.copy()
        right_row["id"] = right_id
        right_row["geometry"] = right_geom

        work = work.drop(index=[pick_idx]).reset_index(drop=True)
        work = gpd.GeoDataFrame(
            pd.concat([work, gpd.GeoDataFrame([left_row, right_row], crs=work.crs)], ignore_index=True),
            crs=work.crs,
        )
        known_ids.update({left_id, right_id})

    return work


def _hamilton_quotas(
    weights: dict[str, float],
    target: int,
    *,
    min_each: int = 1,
    max_each: dict[str, int] | None = None,
) -> dict[str, int]:
    keys = list(weights.keys())
    if not keys:
        return {}

    quotas = {k: min_each for k in keys}
    base = sum(quotas.values())
    if base > target:
        raise ValueError(f"Target {target} smaller than minimum required {base}.")

    remaining = target - base
    if remaining == 0:
        return quotas

    total_weight = sum(max(float(weights[k]), 0.0) for k in keys)
    if total_weight <= 0:
        equal = remaining // len(keys)
        rem = remaining % len(keys)
        for idx, key in enumerate(sorted(keys)):
            quotas[key] += equal + (1 if idx < rem else 0)
        return quotas

    raw: dict[str, float] = {}
    for key in keys:
        raw[key] = remaining * max(float(weights[key]), 0.0) / total_weight

    for key in keys:
        quotas[key] += int(math.floor(raw[key]))

    current = sum(quotas.values())
    remainders = sorted(
        keys,
        key=lambda k: (raw[k] - math.floor(raw[k]), raw[k], k),
        reverse=True,
    )
    cursor = 0
    while current < target and remainders:
        key = remainders[cursor % len(remainders)]
        if max_each and quotas[key] >= max_each.get(key, quotas[key]):
            cursor += 1
            if cursor > len(remainders) * 4:
                break
            continue
        quotas[key] += 1
        current += 1
        cursor += 1

    while current > target:
        key = max(keys, key=lambda k: (quotas[k] - min_each, raw[k], k))
        if quotas[key] <= min_each:
            break
        quotas[key] -= 1
        current -= 1

    if max_each:
        changed = True
        while changed:
            changed = False
            overflow = []
            for key in keys:
                max_val = max_each.get(key, quotas[key])
                if quotas[key] > max_val:
                    overflow.append((key, quotas[key] - max_val))
                    quotas[key] = max_val
                    changed = True
            if not changed:
                break
            need = target - sum(quotas.values())
            if need <= 0:
                break
            eligible = [k for k in keys if quotas[k] < max_each.get(k, quotas[k])]
            if not eligible:
                break
            extra = _hamilton_quotas(
                {k: weights[k] for k in eligible},
                need,
                min_each=0,
                max_each={k: max_each[k] - quotas[k] for k in eligible},
            )
            for key, val in extra.items():
                quotas[key] += val
            changed = True

    return quotas


def _build_canada_fed() -> gpd.GeoDataFrame:
    ca = _read_zip_layer(
        cfg.CA_FED_2023_URL,
        cfg.CA_FED_2023_FILENAME,
        "Canada FED 2023",
        fallback_urls=cfg.CA_FED_2023_FALLBACK_URLS,
    )
    fed_num_col = pick_column(ca, ["FED_NUM", "fed_num"])
    name_col = pick_column(ca, ["ED_NAMEE", "ed_namee", "ED_NAME", "name"])
    if not fed_num_col or not name_col:
        raise SystemExit(
            f"[North America] Canada FED schema missing columns. Available: {ca.columns.tolist()}"
        )

    ca = ca.copy()
    ca["fed_num"] = ca[fed_num_col].astype(str).str.zfill(5)
    ca["id"] = "CA_FED_" + ca["fed_num"]
    ca["name"] = ca[name_col].fillna("").astype(str).str.strip()
    ca["cntr_code"] = "CA"
    ca["admin1_group"] = ca["fed_num"].str[:2].map(_PROVINCE_BY_FED_PREFIX).fillna("Canada")
    ca["detail_tier"] = "standard"
    ca["geometry"] = ca.geometry.simplify(cfg.SIMPLIFY_CANADA_FED, preserve_topology=True)
    ca = ca[ca.geometry.notna() & ~ca.geometry.is_empty].copy()
    return ca[["id", "name", "cntr_code", "admin1_group", "detail_tier", "geometry"]].copy()


def _build_mexico_zones() -> gpd.GeoDataFrame:
    mx_adm2 = fetch_or_load_geojson(
        cfg.MEX_ADM2_URL,
        cfg.MEX_ADM2_FILENAME,
        fallback_urls=cfg.MEX_ADM2_FALLBACK_URLS,
    )
    if mx_adm2.empty:
        raise SystemExit("[North America] Mexico ADM2 source is empty.")
    mx_adm2 = _ensure_epsg4326(mx_adm2)
    mx_adm2 = mx_adm2[mx_adm2.geometry.notna() & ~mx_adm2.geometry.is_empty].copy()

    name_col = pick_column(mx_adm2, ["shapeName", "name", "NAME"])
    iso_col = pick_column(mx_adm2, ["shapeISO", "shapeIso", "iso_3166_2"])
    id_col = pick_column(mx_adm2, ["shapeID", "id", "ID"])
    if not name_col or not id_col:
        raise SystemExit(
            f"[North America] Mexico ADM2 missing name/id columns. Available: {mx_adm2.columns.tolist()}"
        )

    mx = mx_adm2.copy()
    mx["child_id"] = mx[id_col].astype(str).str.strip()
    mx["name"] = mx[name_col].fillna("").astype(str).str.strip()
    mx["state_name"] = ""

    mx_admin1 = _load_admin1_country("MX", country_names=["Mexico"])
    if not mx_admin1.empty:
        mx = _assign_admin1_group(mx, mx_admin1, fallback_col="__none__", output_col="state_name")

    if iso_col:
        iso_fallback = mx[iso_col].fillna("").astype(str).str.upper()
        iso_fallback = iso_fallback.apply(lambda value: value.split("-")[-1] if "-" in value else value)
    else:
        iso_fallback = pd.Series([""] * len(mx), index=mx.index)
    mx["state_name"] = mx["state_name"].where(mx["state_name"] != "", iso_fallback)
    mx["state_name"] = mx["state_name"].where(mx["state_name"] != "", "MEX")
    mx["state_name"] = mx["state_name"].astype(str).str.strip()

    unique_states = sorted(mx["state_name"].unique().tolist())
    state_code_map = {name: f"{idx + 1:02d}" for idx, name in enumerate(unique_states)}
    mx["state_code"] = mx["state_name"].map(state_code_map).fillna("00")

    state_counts = mx.groupby("state_code").size().to_dict()
    weights = {code: float(count) for code, count in state_counts.items()}
    quotas = _hamilton_quotas(
        weights,
        cfg.MX_TARGET_UNITS,
        min_each=1,
        max_each=state_counts,
    )

    records: list[dict] = []
    for state_code in sorted(state_counts.keys()):
        part = mx[mx["state_code"] == state_code].copy().reset_index(drop=True)
        if part.empty:
            continue
        quota = int(quotas.get(state_code, 1))
        quota = max(1, min(quota, len(part)))
        state_name = str(part["state_name"].iloc[0]).strip() or state_code
        groups = _partition_indices(part, quota)

        for idx, members in enumerate(groups, start=1):
            if not members:
                continue
            zone_geom = unary_union(part.loc[members, "geometry"].tolist())
            if zone_geom is None or zone_geom.is_empty:
                zone_geom = part.loc[members[0], "geometry"]
            records.append(
                {
                    "id": f"MX_ZN_{state_code}_{idx:03d}",
                    "name": f"{state_name} Zone {idx}",
                    "cntr_code": "MX",
                    "admin1_group": state_name,
                    "detail_tier": "synthetic_300",
                    "geometry": zone_geom,
                }
            )

    mx_out = gpd.GeoDataFrame(records, crs="EPSG:4326")
    mx_out = mx_out[mx_out.geometry.notna() & ~mx_out.geometry.is_empty].copy()
    mx_out["geometry"] = mx_out.geometry.simplify(
        cfg.SIMPLIFY_MEXICO_ZONES, preserve_topology=True
    )
    return mx_out


def _solve_us_state_quotas(stats: pd.DataFrame, target: int) -> dict[str, int]:
    if stats.empty:
        return {}
    if target <= 0:
        return {row.state: 0 for row in stats.itertuples(index=False)}

    exponent = float(getattr(cfg, "US_POP_WEIGHT_EXPONENT", 0.5))
    work = stats.copy().reset_index(drop=True)
    work["scale_weight"] = work["pop"].astype(float).clip(lower=1.0).apply(
        lambda value: (value / 1_000_000.0) ** exponent
    )

    def compute(mid: float) -> pd.Series:
        values = work["scale_weight"].apply(lambda val: int(round(mid * val)))
        values = values.clip(lower=1, upper=work["county_count"])
        return values.astype(int)

    lo, hi = 0.0, 20.0
    for _ in range(80):
        mid = (lo + hi) / 2.0
        total = int(compute(mid).sum())
        if total < target:
            lo = mid
        else:
            hi = mid

    work["quota"] = compute(hi)
    current = int(work["quota"].sum())

    guard = 0
    while current < target:
        candidates = work[work["quota"] < work["county_count"]]
        if candidates.empty:
            break
        idx = (candidates["pop"] / (candidates["quota"] + 1.0)).idxmax()
        work.loc[idx, "quota"] += 1
        current += 1
        guard += 1
        if guard > 10000:
            break

    guard = 0
    while current > target:
        candidates = work[work["quota"] > 1]
        if candidates.empty:
            break
        idx = (candidates["quota"] / candidates["pop"]).idxmax()
        work.loc[idx, "quota"] -= 1
        current -= 1
        guard += 1
        if guard > 10000:
            break

    return {row.state: int(row.quota) for row in work.itertuples(index=False)}


def _build_us_zones() -> gpd.GeoDataFrame:
    counties = _read_zip_layer(
        cfg.US_COUNTY_2024_500K_URL,
        cfg.US_COUNTY_2024_500K_FILENAME,
        "US counties 2024 (500k)",
    )
    states = _read_zip_layer(
        cfg.US_STATE_2024_500K_URL,
        cfg.US_STATE_2024_500K_FILENAME,
        "US states 2024 (500k)",
    )
    pop_df = _load_cached_csv(cfg.US_COUNTY_POP_2024_URL, cfg.US_COUNTY_POP_2024_FILENAME)

    counties = counties.copy()
    for col in ("STATEFP", "COUNTYFP", "GEOID", "NAME", "NAMELSAD", "STUSPS"):
        if col not in counties.columns:
            raise SystemExit(
                f"[North America] US county dataset missing '{col}'. Available: {counties.columns.tolist()}"
            )
    counties["STATEFP"] = counties["STATEFP"].astype(str).str.zfill(2)
    counties["COUNTYFP"] = counties["COUNTYFP"].astype(str).str.zfill(3)
    counties["GEOID"] = counties["STATEFP"] + counties["COUNTYFP"]
    counties["STUSPS"] = counties["STUSPS"].astype(str).str.upper().str.strip()
    counties = counties[~counties["STUSPS"].isin(_US_TERRITORY_CODES)].copy()
    counties = counties[counties.geometry.notna() & ~counties.geometry.is_empty].copy()

    states = states.copy()
    states["STUSPS"] = states["STUSPS"].astype(str).str.upper().str.strip()
    states = states[~states["STUSPS"].isin(_US_TERRITORY_CODES)].copy()
    state_name_map = {
        str(row.STUSPS).upper(): str(row.NAME).strip()
        for row in states.itertuples(index=False)
        if str(row.STUSPS).strip()
    }
    counties["state_name"] = counties["STUSPS"].map(state_name_map).fillna(counties["STUSPS"])

    for col in ("STATE", "COUNTY", "POPESTIMATE2024"):
        if col not in pop_df.columns:
            raise SystemExit(
                f"[North America] US county population CSV missing '{col}'. "
                f"Available: {pop_df.columns.tolist()}"
            )
    pop = pop_df.copy()
    pop["STATE"] = pop["STATE"].astype(str).str.zfill(2)
    pop["COUNTY"] = pop["COUNTY"].astype(str).str.zfill(3)
    pop = pop[pop["COUNTY"] != "000"].copy()
    pop["GEOID"] = pop["STATE"] + pop["COUNTY"]
    pop_map = pop.set_index("GEOID")["POPESTIMATE2024"].to_dict()
    counties["population"] = counties["GEOID"].map(pop_map).fillna(0).astype(float)

    fixed_states = {str(code).upper() for code in cfg.US_FIXED_FINE_STATES}
    state_target_overrides = {
        str(code).upper(): int(target)
        for code, target in getattr(cfg, "US_STATE_ZONE_TARGET_OVERRIDES", {}).items()
    }
    skip_merge_states = {
        str(code).upper() for code in getattr(cfg, "US_STATE_ZONE_SKIP_MERGE_STATES", set())
    }
    fixed_count = int(counties[counties["STUSPS"].isin(fixed_states)].shape[0])
    target_total = int(cfg.US_HYBRID_TARGET)
    target_rest = max(0, target_total - fixed_count)

    rest_stats = (
        counties[~counties["STUSPS"].isin(fixed_states)]
        .groupby("STUSPS")
        .agg(pop=("population", "sum"), county_count=("GEOID", "count"))
        .reset_index()
        .rename(columns={"STUSPS": "state"})
    )
    state_quota = _solve_us_state_quotas(rest_stats, target_rest)
    fine_threshold = float(
        counties["population"].quantile(float(cfg.US_FINE_POP_PERCENTILE) / 100.0)
    )

    records: list[dict] = []
    for stusps, state_frame in counties.groupby("STUSPS", sort=True):
        state_df = state_frame.copy().reset_index(drop=True)
        n_counties = len(state_df)
        state_name = str(state_df["state_name"].iloc[0]).strip() or stusps
        statefp = str(state_df["STATEFP"].iloc[0]).zfill(2)

        if stusps in fixed_states:
            for row in state_df.itertuples(index=False):
                anchor_county_name = _county_legal_name(pd.Series(row._asdict()))
                legacy_name = _clean_text(row.NAME)
                records.append(
                    {
                        "id": f"US_CNTY_{row.GEOID}",
                        "name": legacy_name,
                        "legacy_name": legacy_name if legacy_name and legacy_name != anchor_county_name else "",
                        "anchor_county_name": anchor_county_name,
                        "cntr_code": "US",
                        "admin1_group": state_name,
                        "detail_tier": "fine",
                        "geometry": row.geometry,
                    }
                )
            continue

        quota = int(state_quota.get(stusps, 1))
        override_quota = state_target_overrides.get(stusps)
        if override_quota is not None and stusps not in skip_merge_states:
            quota = int(override_quota)
        quota = max(1, min(quota, n_counties))
        if quota >= n_counties:
            for row in state_df.itertuples(index=False):
                anchor_county_name = _county_legal_name(pd.Series(row._asdict()))
                legacy_name = _clean_text(row.NAME)
                records.append(
                    {
                        "id": f"US_CNTY_{row.GEOID}",
                        "name": legacy_name,
                        "legacy_name": legacy_name if legacy_name and legacy_name != anchor_county_name else "",
                        "anchor_county_name": anchor_county_name,
                        "cntr_code": "US",
                        "admin1_group": state_name,
                        "detail_tier": "fine",
                        "geometry": row.geometry,
                    }
                )
            continue

        locked_indices, rest_df, rest_quota, component_floor = _select_us_locked_indices(
            state_df,
            quota,
            fine_threshold,
        )
        effective_quota = len(locked_indices) + (
            len(rest_df) if rest_quota >= len(rest_df) else rest_quota
        )
        if effective_quota > quota:
            print(
                "[North America] US "
                f"{stusps}: lifted target from {quota} to {effective_quota} "
                f"to preserve coarse-zone connectivity (component floor {component_floor})."
            )

        for idx in sorted(locked_indices):
            row = state_df.loc[idx]
            anchor_county_name = _county_legal_name(row)
            legacy_name = _clean_text(row.get("NAME"))
            records.append(
                {
                    "id": f"US_CNTY_{row['GEOID']}",
                    "name": legacy_name,
                    "legacy_name": legacy_name if legacy_name and legacy_name != anchor_county_name else "",
                    "anchor_county_name": anchor_county_name,
                    "cntr_code": "US",
                    "admin1_group": state_name,
                    "detail_tier": "fine",
                    "geometry": row.geometry,
                }
            )

        if rest_df.empty:
            continue
        if rest_quota >= len(rest_df):
            for row in rest_df.itertuples(index=False):
                anchor_county_name = _county_legal_name(pd.Series(row._asdict()))
                legacy_name = _clean_text(row.NAME)
                records.append(
                    {
                        "id": f"US_CNTY_{row.GEOID}",
                        "name": legacy_name,
                        "legacy_name": legacy_name if legacy_name and legacy_name != anchor_county_name else "",
                        "anchor_county_name": anchor_county_name,
                        "cntr_code": "US",
                        "admin1_group": state_name,
                        "detail_tier": "fine",
                        "geometry": row.geometry,
                    }
                )
            continue
        groups = _partition_indices(rest_df, rest_quota)
        rest_adjacency = _build_adjacency(rest_df)
        contiguous_groups: list[list[int]] = []
        for members in groups:
            contiguous_groups.extend(_connected_components(set(members), rest_adjacency))
        if len(contiguous_groups) > len(groups):
            print(
                "[North America] US "
                f"{stusps}: split {len(groups)} coarse groups into "
                f"{len(contiguous_groups)} connected groups after partitioning."
            )
        group_points = rest_df.geometry.representative_point()
        groups = sorted(
            contiguous_groups,
            key=lambda members: (
                min(float(group_points.iloc[idx].x) for idx in members),
                min(float(group_points.iloc[idx].y) for idx in members),
                min(members),
            ),
        )
        for zone_idx, members in enumerate(groups, start=1):
            if not members:
                continue
            group_frame = rest_df.loc[members].copy()
            anchor_row = _best_us_anchor_county(group_frame)
            geom = unary_union(rest_df.loc[members, "geometry"].tolist())
            if geom is None or geom.is_empty:
                geom = rest_df.loc[members[0], "geometry"]
            legacy_name = f"{state_name} Zone {zone_idx}"
            records.append(
                {
                    "id": f"US_ZN_{statefp}_{zone_idx:03d}",
                    "name": legacy_name,
                    "legacy_name": legacy_name,
                    "anchor_county_name": _county_legal_name(anchor_row),
                    "cntr_code": "US",
                    "admin1_group": state_name,
                    "detail_tier": "coarse",
                    "geometry": geom,
                }
            )

    us_out = gpd.GeoDataFrame(records, crs="EPSG:4326")
    us_out = us_out[us_out.geometry.notna() & ~us_out.geometry.is_empty].copy()
    us_out = _assign_us_feature_names(us_out)
    us_out["geometry"] = us_out.geometry.simplify(
        cfg.SIMPLIFY_US_COUNTY, preserve_topology=True
    )
    return us_out


def apply_north_america_replacement(hybrid_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if hybrid_gdf.empty:
        return hybrid_gdf
    if "cntr_code" not in hybrid_gdf.columns:
        print("[North America] cntr_code missing; skipping replacement.")
        return hybrid_gdf

    normalized_codes = hybrid_gdf["cntr_code"].astype(str).str.upper()
    fallback_shells = {
        code: hybrid_gdf[normalized_codes == code].copy()
        for code in ("US", "CA", "MX")
    }
    country_shells = {
        "US": _load_admin0_country("US", ["United States of America", "United States"]),
        "CA": _load_admin0_country("CA", ["Canada"]),
        "MX": _load_admin0_country("MX", ["Mexico"]),
    }
    for code, shell in list(country_shells.items()):
        if shell.empty:
            country_shells[code] = fallback_shells[code]
    base = hybrid_gdf[~normalized_codes.isin({"US", "CA", "MX"})].copy()
    base = _ensure_epsg4326(base)

    print("[North America] Building Canada FED detail...")
    ca = _build_canada_fed()
    ca = _clip_features_to_country_shell(ca, country_shells.get("CA"), label="Canada")
    print(f"[North America] Canada features: {len(ca)}")

    print("[North America] Building Mexico synthetic 300 detail...")
    mx = _build_mexico_zones()
    mx = _clip_features_to_country_shell(mx, country_shells.get("MX"), label="Mexico")
    print(f"[North America] Mexico features: {len(mx)}")

    print("[North America] Building US hybrid detail...")
    us = _build_us_zones()
    us = _clip_features_to_country_shell(us, country_shells.get("US"), label="United States")
    print(f"[North America] US features: {len(us)}")

    combined = gpd.GeoDataFrame(pd.concat([base, ca, mx, us], ignore_index=True), crs="EPSG:4326")
    combined = combined[combined.geometry.notna() & ~combined.geometry.is_empty].copy()
    combined = _ensure_epsg4326(combined)
    print(
        "[North America] Replacement complete: "
        f"US={len(us)}, CA={len(ca)}, MX={len(mx)}, total={len(combined)}"
    )
    return combined


