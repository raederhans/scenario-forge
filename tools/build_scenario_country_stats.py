"""Build country statistics from scenario baseline owners and strategic state buckets."""
import argparse
import json
from collections import Counter, defaultdict
from math import isclose
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"
GHSL = DATA / "thematic_layers/population/ghsl_population_2020_v1"
OUTPUT = DATA / "thematic_layers/scenario/country_stats_v1"
SCENARIOS = ("hoi4_1936", "hoi4_1939", "tno_1962")
HEADER = {"schema_version": 1, "layer_id": "scenario_country_stats_v1",
          "data_version": "scenario-country-stats-v1"}
FACTORIES = ("factories_total", "civilian_factories", "military_factories")
RESOURCES = ("steel", "oil", "aluminium", "rubber", "tungsten", "chromium", "coal")
ADDITIVE = ("manpower", *FACTORIES, *RESOURCES)
UNITS = {
    "population": "persons", "land_area_km2": "km2", "population_density": "persons_per_km2",
    **dict.fromkeys(FACTORIES, "factories"), "factories_per_million": "factories_per_million_persons",
    "military_factory_share": "percent", **dict.fromkeys(("steel", "oil", "resources_total"), "resource_points"),
    "core_share": "percent",
}


def read(path):
    return json.loads(path.read_bytes())


def balance(source, allocated, unallocated):
    if not isclose(source, allocated + unallocated, rel_tol=1e-6, abs_tol=1e-9):
        raise ValueError(f"Allocation imbalance: {source} != {allocated} + {unallocated}")
    return {"source_total": source, "allocated_total": allocated, "unallocated_total": unallocated}


def allocate(strategic, owners, features):
    buckets = strategic["buckets"]
    population = defaultdict(Counter)
    area = defaultdict(Counter)
    counts = defaultdict(Counter)
    source_area = defaultdict(Counter)
    for fid, bid in strategic["bucket_by_feature"].items():
        tag = owners[fid]
        row = features.get(fid, {})
        size = row.get("land_area_km2") or 0
        counts[bid][tag] += 1
        population[bid][tag] += row.get("population") or 0
        area[bid][tag] += size
        source_area[buckets[bid]["owner_tag"]][tag] += size

    hosts = defaultdict(Counter)
    for point in strategic["victory_points"]:
        tag = owners.get(point.get("host_feature_id"))
        if tag:
            hosts[f"s{point['state_id']}"][tag] += point["value"]

    totals = {tag: Counter() for tag in sorted(set(owners.values()))}
    missing = Counter()
    unallocated = []
    shared = 0
    for bid, bucket in buckets.items():
        source = bucket["owner_tag"]
        if bid in counts:
            resource_weights = +area[bid] or counts[bid]
            people_weights = +population[bid] or resource_weights
        else:
            weights = +hosts[bid] or +source_area[source]
            if not weights and source in totals:
                weights = {source: 1}
            resource_weights = people_weights = weights
        if not people_weights:
            unallocated.append({"id": bid, "owner_tag": source, "manpower": bucket["manpower"]})
            missing.update({key: bucket[key] for key in ADDITIVE})
            continue
        if len(people_weights.keys() | resource_weights.keys()) > 1:
            shared += 1
        for keys, weights in ((("manpower", *FACTORIES), people_weights), (RESOURCES, resource_weights)):
            denominator = sum(weights.values())
            for tag, weight in weights.items():
                for key in keys:
                    totals[tag][key] += bucket[key] * (weight / denominator)

    audit = {key: balance(sum(b[key] for b in buckets.values()), sum(t[key] for t in totals.values()),
                          missing[key]) for key in ADDITIVE}
    audit["resources_total"] = balance(sum(b[k] for b in buckets.values() for k in RESOURCES),
                                       sum(t[k] for t in totals.values() for k in RESOURCES),
                                       sum(missing[k] for k in RESOURCES))
    return totals, {"metrics": audit, "unallocated_buckets": unallocated, "cross_country_buckets": shared}


def ratio(numerator, denominator):
    return round(numerator / denominator, 2) if denominator else None


def build_scenario(scenario, geometry_version):
    root = DATA / "scenarios" / scenario
    strategic = read(root / "strategic_values.by_feature.json")
    owners = read(root / "owners.by_feature.json")["owners"]
    cores = read(root / "cores.by_feature.json")["cores"]
    ghsl = read(GHSL / "features" / f"{scenario}.json")
    if ghsl["geometry_version"] != geometry_version:
        raise ValueError(f"{scenario}: GHSL feature and manifest geometry versions differ")
    features = ghsl["features"]
    totals, audit = allocate(strategic, owners, features)
    audit["geometry_version"] = geometry_version
    holdings = defaultdict(list)
    land = Counter()
    source_land = 0
    for fid, tag in owners.items():
        holdings[tag].append(fid)
        row = features.get(fid, {})
        if row.get("status") in ("ok", "partial_coverage") and row.get("land_area_km2") is not None:
            land[tag] += row["land_area_km2"]
            source_land += row["land_area_km2"]
    audit["metrics"]["land_area_km2"] = balance(source_land, sum(land.values()), 0)
    unavailable = (*FACTORIES, "factories_per_million", "military_factory_share") if scenario == "tno_1962" else ()
    metrics = {f"scenario_{key}": {"unit": unit, "available": key not in unavailable}
               for key, unit in UNITS.items()}
    countries = {}
    for tag, t in totals.items():
        fids = holdings[tag]
        sizes = [features.get(fid, {}).get("land_area_km2") or 0 for fid in fids]
        if not sum(sizes):
            sizes = [1] * len(fids)
        core_area = sum(size for fid, size in zip(fids, sizes) if tag in cores.get(fid, []))
        values = {
            "population": round(t["manpower"]),
            "land_area_km2": round(land[tag], 1) if tag in land else None,
            "population_density": ratio(t["manpower"], land[tag]),
            **{key: round(t[key], 2) for key in FACTORIES},
            "factories_per_million": ratio(t["factories_total"] * 1e6, t["manpower"]),
            "military_factory_share": ratio(100 * t["military_factories"], t["factories_total"]),
            "steel": round(t["steel"], 2), "oil": round(t["oil"], 2),
            "resources_total": round(sum(t[k] for k in RESOURCES), 2),
            "core_share": ratio(100 * core_area, sum(sizes)),
        }
        countries[tag] = {f"scenario_{k}": None if k in unavailable else v for k, v in values.items()}
    metadata = {"baseline_hash": read(root / "manifest.json")["baseline_hash"], "as_of_date": strategic["as_of_date"]}
    return {**HEADER, "scenario_id": scenario, **metadata, "metrics": metrics, "countries": countries}, metadata, audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    manifest = {**HEADER, "status": "experimental", "source_policy": "scenario_derived", "scenarios": {},
                "metric_ids": [f"scenario_{key}" for key in UNITS],
                "limitations": [
                    "州人口与工厂按现代人口空间分布拆分，资源按面积拆分。 State splits use 2020 population or land area.",
                    "缺测地块可能低估国土面积。 Missing coverage can understate land area.",
                    "TNO 建筑体系缺少可比工厂数据。 Comparable TNO factory counts are unavailable.",
                ]}
    outputs = {}
    audits = {}
    ghsl = read(GHSL / "manifest.json")
    for scenario in SCENARIOS:
        filename = f"{scenario}.json"
        payload, metadata, audits[scenario] = build_scenario(scenario, ghsl["scenarios"][scenario]["geometry_version"])
        outputs[filename] = payload
        manifest["scenarios"][scenario] = {"path": filename, **metadata}
    outputs["manifest.json"] = manifest
    outputs["audit.json"] = {"scenarios": audits}
    if not args.check:
        OUTPUT.mkdir(parents=True, exist_ok=True)
    for filename, payload in outputs.items():
        path = OUTPUT / filename
        if args.check:
            if not path.exists() or read(path) != payload:
                raise SystemExit(f"Stale or missing: {path}")
        else:
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
