from __future__ import annotations

import binascii
import json
import struct
import zlib
from pathlib import Path

import numpy as np


def read_bmp24(path: Path) -> np.ndarray:
    data = path.read_bytes()
    if data[:2] != b"BM":
        raise ValueError(f"Unsupported BMP header in {path}")

    pixel_offset = struct.unpack_from("<I", data, 10)[0]
    width = struct.unpack_from("<I", data, 18)[0]
    height_signed = struct.unpack_from("<i", data, 22)[0]
    bits_per_pixel = struct.unpack_from("<H", data, 28)[0]
    compression = struct.unpack_from("<I", data, 30)[0]
    if bits_per_pixel != 24 or compression != 0:
        raise ValueError(f"Unsupported BMP format in {path}: bpp={bits_per_pixel}, compression={compression}")

    height = abs(height_signed)
    row_stride = ((width * 3 + 3) // 4) * 4
    payload = np.frombuffer(data, dtype=np.uint8, offset=pixel_offset)
    payload = payload[: row_stride * height].reshape((height, row_stride))
    rgb = payload[:, : width * 3].reshape((height, width, 3))[:, :, ::-1]
    if height_signed > 0:
        rgb = np.flipud(rgb)
    return rgb.copy()


def write_png_rgb(path: Path, image: np.ndarray) -> None:
    image = np.asarray(image, dtype=np.uint8)
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("PNG writer expects an RGB image array.")

    height, width, _channels = image.shape
    raw = b"".join(b"\x00" + image[y].tobytes() for y in range(height))
    compressed = zlib.compress(raw, level=9)

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", binascii.crc32(tag + payload) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", ihdr),
            chunk(b"IDAT", compressed),
            chunk(b"IEND", b""),
        ]
    )
    path.write_bytes(png)


def build_source_atlas(
    *,
    provinces_bmp_path: Path,
    definition_entries: dict[int, object],
    states_by_id: dict[int, object],
    palette_pack: dict,
    output_dir: Path,
    downsample: int = 4,
) -> list[str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    rgb_image = read_bmp24(provinces_bmp_path)
    sampled = rgb_image[::downsample, ::downsample, :]

    write_png_rgb(output_dir / "source_preview.png", sampled)

    province_owner_by_rgb: dict[int, str] = {}
    province_rgb_key_by_id = {
        definition_entry.province_id: (
            (definition_entry.r << 16) | (definition_entry.g << 8) | definition_entry.b
        )
        for definition_entry in definition_entries.values()
    }
    for state in states_by_id.values():
        for province_id in getattr(state, "province_ids", []) or []:
            rgb_key = province_rgb_key_by_id.get(province_id)
            if rgb_key is not None:
                province_owner_by_rgb[rgb_key] = str(state.owner_tag).strip().upper()

    palette_entries = palette_pack.get("entries", {}) if isinstance(palette_pack, dict) else {}
    owner_color_by_tag: dict[str, np.ndarray] = {}
    for tag, entry in palette_entries.items():
        color = str(entry.get("map_hex") or entry.get("country_file_hex") or "").strip().lower()
        if not color.startswith("#") or len(color) != 7:
            continue
        owner_color_by_tag[str(tag).strip().upper()] = np.array(
            [int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)],
            dtype=np.uint8,
        )

    sampled_key = (
        sampled[:, :, 0].astype(np.uint32) << 16
    ) | (
        sampled[:, :, 1].astype(np.uint32) << 8
    ) | sampled[:, :, 2].astype(np.uint32)
    owner_preview = np.zeros_like(sampled, dtype=np.uint8)
    owner_preview[:, :] = np.array([77, 98, 122], dtype=np.uint8)
    for rgb_key in np.unique(sampled_key):
        owner_tag = province_owner_by_rgb.get(int(rgb_key))
        if not owner_tag:
            continue
        owner_rgb = owner_color_by_tag.get(owner_tag)
        if owner_rgb is None:
            continue
        owner_preview[sampled_key == rgb_key] = owner_rgb

    write_png_rgb(output_dir / "owners_preview.png", owner_preview)
    return [
        str((output_dir / "source_preview.png").as_posix()),
        str((output_dir / "owners_preview.png").as_posix()),
    ]


def build_report_json(bundle: dict, atlas_paths: list[str]) -> dict:
    audit = bundle["audit"]
    owner_stats = audit.get("owner_stats", {}) if isinstance(audit, dict) else {}
    approx_owners = sorted(
        (
            {
                "tag": tag,
                "display_name": data.get("display_name"),
                "feature_count": data.get("feature_count", 0),
                "quality": data.get("quality"),
                "synthetic_owner": data.get("synthetic_owner", False),
                "source_type": data.get("source_type", ""),
                "historical_fidelity": data.get("historical_fidelity", ""),
            }
            for tag, data in owner_stats.items()
            if data.get("quality") == "approx_existing_geometry"
        ),
        key=lambda item: (-int(item.get("feature_count", 0)), item.get("tag", "")),
    )
    return {
        "version": 2,
        "scenario_id": bundle["manifest"]["scenario_id"],
        "generated_at": bundle["audit"]["generated_at"],
        "summary": bundle["audit"]["summary"],
        "atlas_paths": atlas_paths,
        "critical_regions": bundle["audit"].get("critical_regions", []),
        "region_checks": bundle["audit"].get("region_checks", {}),
        "topology_blockers": bundle["audit"].get("topology_blockers", []),
        "scenario_rule_blockers": bundle["audit"].get("scenario_rule_blockers", []),
        "topology_summaries": bundle["audit"].get("topology_summaries", {}),
        "approx_owner_sample": approx_owners[:40],
        "synthetic_owner_sample": [item for item in approx_owners if item.get("synthetic_owner")][:40],
        "empty_rule_ids": bundle["audit"].get("diagnostics", {}).get("empty_rules", []),
    }


def build_report_markdown(bundle: dict, report_json: dict) -> str:
    manifest = bundle["manifest"]
    summary = bundle["audit"]["summary"]
    owner_stats = bundle["audit"].get("owner_stats", {})
    quality_counts = summary.get("quality_counts", {})
    top_owners = sorted(
        owner_stats.items(),
        key=lambda item: (-int(item[1].get("feature_count", 0)), item[0]),
    )[:20]
    approx_owners = report_json.get("approx_owner_sample", [])[:20]
    region_checks = report_json.get("region_checks", {}) or {}
    topology_blockers = report_json.get("topology_blockers", []) or []
    scenario_rule_blockers = report_json.get("scenario_rule_blockers", []) or []
    topology_summaries = report_json.get("topology_summaries", {}) or {}
    belarus_summary = topology_summaries.get("belarus_hybrid", {}) or {}

    lines = [
        "# HOI4 1936 Scenario Coverage Report",
        "",
        f"- Scenario: `{manifest['scenario_id']}`",
        f"- Display name: `{manifest['display_name']}`",
        f"- Bookmark date: `{manifest['bookmark_date']}`",
        f"- Default country: `{manifest['default_country']}`",
        f"- Baseline hash: `{manifest['baseline_hash']}`",
        "",
        "## Summary",
        "",
        f"- Features assigned: `{summary.get('feature_count', 0)}`",
        f"- Owners present: `{summary.get('owner_count', 0)}`",
        f"- Changed features vs. direct inheritance: `{summary.get('changed_feature_count', 0)}`",
        f"- Geometry blockers: `{summary.get('geometry_blocker_count', 0)}`",
        f"- Critical unresolved: `{summary.get('critical_unresolved_count', 0)}`",
        f"- Failed region checks: `{summary.get('failed_region_check_count', 0)}`",
        f"- Topology blockers: `{summary.get('topology_blocker_count', 0)}`",
        f"- Scenario rule blockers: `{summary.get('scenario_rule_blocker_count', 0)}`",
        f"- Synthetic-owner features: `{summary.get('synthetic_owner_feature_count', 0)}`",
        "",
        "## Quality Counts",
        "",
    ]
    for quality, count in sorted(quality_counts.items()):
        lines.append(f"- `{quality}`: `{count}`")

    lines.extend(
        [
            "",
            "## Atlas",
            "",
        ]
    )
    for atlas_path in report_json.get("atlas_paths", []):
        lines.append(f"- `{atlas_path}`")

    lines.extend(
        [
            "",
            "## Critical Region Checks",
            "",
            "| Region | Status | Notes |",
            "|---|---|---|",
        ]
    )
    for region_id in sorted(region_checks):
        check = region_checks[region_id]
        lines.append(
            f"| `{region_id}` | `{check.get('status', 'unknown')}` | {check.get('notes', '')} |"
        )

    lines.extend(
        [
            "",
            "## Base Topology Findings",
            "",
        ]
    )
    if topology_blockers:
        for blocker in topology_blockers:
            lines.append(
                f"- `{blocker.get('blocker_id', 'unknown')}`: {blocker.get('notes', '')}"
            )
    else:
        lines.append("- None")
    if belarus_summary:
        lines.extend(
            [
                "",
                "### Belarus Hybrid Topology",
                "",
                f"- Total features: `{belarus_summary.get('total_feature_count', 0)}`",
                f"- Border rayons kept: `{belarus_summary.get('border_rayons_kept', 0)}`",
                f"- Historical composites built: `{belarus_summary.get('historical_composites_built', 0)}`",
                f"- Interior groups built: `{belarus_summary.get('interior_groups_built', 0)}`",
            ]
        )

    lines.extend(
        [
            "",
            "## Scenario Rule Findings",
            "",
        ]
    )
    if scenario_rule_blockers:
        for blocker in scenario_rule_blockers:
            lines.append(
                f"- `{blocker.get('blocker_id', 'unknown')}`: {blocker.get('notes', '')}"
            )
    else:
        lines.append("- None")

    lines.extend(
        [
            "",
            "## Top Owners",
            "",
            "| Tag | Name | Feature Count | Quality | Base ISO2 |",
            "|---|---|---:|---|---|",
        ]
    )
    for tag, data in top_owners:
        lines.append(
            f"| `{tag}` | {data.get('display_name', tag)} | {data.get('feature_count', 0)} | "
            f"`{data.get('quality', '')}` | `{data.get('base_iso2', '')}` |"
        )

    lines.extend(
        [
            "",
            "## Approximate Owner Sample",
            "",
            "| Tag | Name | Feature Count | Synthetic | Source Type | Fidelity |",
            "|---|---|---:|---|---|---|",
        ]
    )
    if approx_owners:
        for item in approx_owners:
            lines.append(
                f"| `{item['tag']}` | {item.get('display_name', item['tag'])} | "
                f"{item.get('feature_count', 0)} | `{str(bool(item.get('synthetic_owner'))).lower()}` | "
                f"`{item.get('source_type', '')}` | `{item.get('historical_fidelity', '')}` |"
            )
    else:
        lines.append("| `-` | None | 0 | `false` | `-` | `-` |")

    empty_rules = report_json.get("empty_rule_ids", [])
    lines.extend(
        [
            "",
            "## Empty Rules",
            "",
        ]
    )
    if empty_rules:
        lines.extend([f"- `{rule_id}`" for rule_id in empty_rules])
    else:
        lines.append("- None")

    return "\n".join(lines) + "\n"


def write_report_files(
    *,
    bundle: dict,
    report_json_path: Path,
    report_markdown_path: Path,
    atlas_paths: list[str],
) -> None:
    report_json = build_report_json(bundle, atlas_paths)
    report_json_path.parent.mkdir(parents=True, exist_ok=True)
    report_json_path.write_text(json.dumps(report_json, ensure_ascii=False, indent=2), encoding="utf-8")
    report_markdown_path.write_text(build_report_markdown(bundle, report_json), encoding="utf-8")
