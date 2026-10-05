# Self-hosted map label fonts

These fonts give map labels a consistent face without relying on fonts installed
on the viewer's computer. `css/map-label-fonts.css` registers them under dedicated
CSS aliases; it deliberately has no `local()` source or `unicode-range` subset.

| File | CSS family | Weight | Purpose |
| --- | --- | --- | --- |
| `ebgaramond/EBGaramond-500.woff2` | `Map Garamond` | 500, upright | English map names |
| `notoserifsc/NotoSerifSC-400.woff2` | `Map Noto Serif SC` | 400, upright | Simplified Chinese map names |

Verified generated sizes: EB Garamond **177,488 bytes** (2,091 mapped codepoints;
3,247 glyphs); Noto Serif SC **5,732,620 bytes** (30,928 mapped codepoints; 31,058
glyphs). Both preserve the complete character and glyph sets of their pinned TTF.

Both fonts are distributed under the SIL Open Font License 1.1. Each font's
directory contains the original upstream `OFL.txt`, including its copyright
notice. CSS family aliases do not modify the embedded upstream family names.

## Provenance

Downloaded from the official Google Fonts repository at commit
`9710da1eacb3be272583c3224dcb70f9da6eadbb`:

- EB Garamond, embedded version `Version 1.003`:
  <https://raw.githubusercontent.com/google/fonts/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf>
- Noto Serif SC, embedded version `Version 2.003-H1;hotconv 1.1.1;makeotfexe 2.6.0`:
  <https://raw.githubusercontent.com/google/fonts/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf>
- License sources: the `OFL.txt` files in those same pinned directories.

Only the `wght` axis is instantiated. No character or glyph subsetting is applied;
all upstream cmap entries, glyphs, shaping and kerning tables are retained.
Coverage is bounded by the upstream fonts: this does not add characters missing
from the original distributions.

## Processing and verification

Generated using Python 3.12, fontTools 4.63.0 and Brotli 1.2.0. Brotli was installed
only in the workspace's temporary runtime directory, not the system environment.
Run the following from the repository root in PowerShell:

```powershell
python -m pip install --target .runtime/python/map_label_font_deps 'Brotli==1.2.0'
$env:PYTHONPATH = (Join-Path (Get-Location) '.runtime/python/map_label_font_deps')
$env:PYTHONPYCACHEPREFIX = (Join-Path (Get-Location) '.runtime/python/pycache')
@'
from pathlib import Path
from urllib.request import urlretrieve
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

commit = '9710da1eacb3be272583c3224dcb70f9da6eadbb'
sources = Path('.runtime/tmp/map-label-font-sources')
sources.mkdir(parents=True, exist_ok=True)
for family, stem, weight in [
    ('ebgaramond', 'EBGaramond', 500),
    ('notoserifsc', 'NotoSerifSC', 400),
]:
    base = f'https://raw.githubusercontent.com/google/fonts/{commit}/ofl/{family}/'
    target = Path('vendor/fonts') / family
    target.mkdir(parents=True, exist_ok=True)
    source_path = sources / f'{stem}-source.ttf'
    urlretrieve(base + stem + '%5Bwght%5D.ttf', source_path)
    urlretrieve(base + 'OFL.txt', target / 'OFL.txt')
    source = TTFont(source_path)
    coverage = set(source.getBestCmap())
    glyphs = set(source.getGlyphOrder())
    static = instantiateVariableFont(source, {'wght': weight}, inplace=True, optimize=True)
    static.flavor = 'woff2'
    output = target / f'{stem}-{weight}.woff2'
    static.save(output)
    parsed = TTFont(output)
    assert 'fvar' not in parsed
    assert parsed['OS/2'].usWeightClass == weight
    assert coverage == set(parsed.getBestCmap())
    assert glyphs == set(parsed.getGlyphOrder())
    print(output, output.stat().st_size, len(coverage), len(glyphs))
'@ | python -
```

The original generation staged WOFF2 files in the temporary source directory,
verified their parsed coverage and weight, then copied them to the paths above.
The reproduction command writes the same generated font bytes directly to the
destination. The HTML/CSS entry point and renderer font selection are managed
separately; creating these assets alone does not load them in the browser.
