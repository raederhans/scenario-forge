import math


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _linear_to_srgb(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def hex_to_oklab(hex_color):
    r, g, b = (_srgb_to_linear(int(hex_color[k:k + 2], 16) / 255) for k in (1, 3, 5))
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def oklab_to_rgb(lab):
    L, a, b = lab
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return tuple(_linear_to_srgb(max(0.0, c)) if c >= 0 else -1.0 for c in (
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s))


def _halton(index, base):
    result, f = 0.0, 1.0
    while index:
        f /= base
        result += f * (index % base)
        index //= base
    return result


WIDE_FAMILIES = {"JAP": dict(hue_span=10.0, lightness_width=0.45, max_distance=0.30)}


def family_palette(parent_hex, count, hue_span=5.0, lightness_width=0.16, max_distance=0.119,
                   *, existing_colors=()):
    L0, a0, b0 = hex_to_oklab(parent_hex)
    C0, h0 = math.hypot(a0, b0), math.degrees(math.atan2(b0, a0))
    lo = min(max(0.30, L0 - lightness_width / 2), 0.90 - lightness_width)
    hi = lo + lightness_width
    pool = []
    for i in range(1, 900):
        L = lo + (hi - lo) * _halton(i, 2)
        C = C0 * (0.85 + 0.20 * _halton(i, 3))
        h = math.radians(h0 + hue_span * (2 * _halton(i, 5) - 1))
        while True:
            lab = (L, C * math.cos(h), C * math.sin(h))
            rgb = oklab_to_rgb(lab)
            if all(0 <= c <= 1 for c in rgb) or C <= 0.01:
                break
            C *= 0.92
        if all(0 <= c <= 1 for c in rgb):
            if math.dist(lab, (L0, a0, b0)) <= max_distance:
                pool.append(lab)
    chosen, anchors = [], [(L0, a0, b0), *(hex_to_oklab(color) for color in existing_colors)]
    for _ in range(count):
        best = max(pool, key=lambda p: min(math.dist(p, q) for q in anchors))
        chosen.append(best)
        anchors.append(best)
        pool.remove(best)
    return ["#%02x%02x%02x" % tuple(round(min(1, max(0, c)) * 255) for c in oklab_to_rgb(lab)) for lab in chosen]


def harmonize_family_colors(entries, countries_by_scenario):
    colors_by_scenario = {}
    for scenario, countries in countries_by_scenario.items():
        parent_of = {tag: country["parent_owner_tag"] for tag, country in countries.items()
                     if country.get("parent_owner_tag")}
        applicable = [e for e in entries if scenario in e["scenarios"]]
        for e in applicable:
            if e.get("parent_owner_tag"):
                parent_of[e["tag"]] = e["parent_owner_tag"]
        colour = {tag: country["color_hex"] for tag, country in countries.items()}
        for e in applicable:
            if e.get("color_hex") and e["tag"] not in parent_of:
                colour[e["tag"]] = e["color_hex"]
        families = {}
        for child, parent in sorted(parent_of.items()):
            families.setdefault(parent, []).append(child)

        def depth(tag, seen=()):
            return 0 if tag not in parent_of or tag in seen else 1 + depth(parent_of[tag], seen + (tag,))

        for parent in sorted(families, key=lambda t: (depth(t), t)):
            children = families[parent]
            palette = family_palette(colour[parent], len(children), **WIDE_FAMILIES.get(parent, {}))
            for child, hex_color in zip(children, palette):
                colour[child] = hex_color
        colors_by_scenario[scenario] = {tag: colour[tag] for tag in parent_of}
    colored_entries = []
    for e in entries:
        colors = {scenario: colors_by_scenario[scenario].get(e["tag"], e.get("color_hex"))
                  for scenario in e["scenarios"]}
        if len(set(colors.values())) == 1:
            if next(iter(colors.values())):
                e["color_hex"] = next(iter(colors.values()))
            colored_entries.append(e)
        else:
            for scenario, color in colors.items():
                colored_entries.append({**e, "id": f"{e['id']}_{scenario}", "scenarios": [scenario], "color_hex": color})
    entries[:] = colored_entries
