# Showcase images

The README and landing page share the same product images under `landing/assets/`.

- `product-workspace.webp`: captured on 2026-09-22 from the current local editor at `/app/`, using the TNO 1962 scenario. The 1280 × 720 capture shows a European viewport at 480% zoom, with the right inspector collapsed. Presentation settings: ocean `#c8dadd`, rivers off, city marker scale 0.45, density 0.35, sparse labels, and capital emphasis off. Camera and appearance were adjusted in the local editor; map geometry and political ownership were not retouched. This is a styled workspace capture, not the default sample export.
- `work-alt-history-med.*`, `work-scenario-switch-europe.*`, and `work-atlas-japan-corridor.*`: generated overview illustrations. Rebuild SVG and source metadata with `npm run build:landing-work-maps`; raster targets remain defined in `tools/rasterize_landing_assets.py`. Their JSON companions record source paths, projection, bounds, and selection policies. They accompany starter projects rather than promising pixel-identical default exports.
- `social-preview.svg` and `social-preview.png`: the link-preview artwork, using the same workspace capture and landing typography/colors.

HOI4 and TNO illustrations represent their game settings, including alternate-history geography. Generated previews simplify presentation, not source ownership. Geographic assets retain their dataset terms; consult the JSON companions and `data/source_ledger.json`.

Early `hero-workspace.webp` and `shot-*.webp` files in this directory are retired from the README, retained only to avoid breaking historical references. Do not use them for new product material.
