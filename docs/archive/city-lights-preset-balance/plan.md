# City lights preset balance plan

Goal: execute the approved plan for Appearance > Day/Night > City Lights.

Tasks:
- [x] Modern defaults and runtime haze/texture rebalance.
- [x] Modern population/metro boost made more visible in cities while rural delta stays small.
- [x] 1930 historical builder region calibration using hierarchy country metadata.
- [x] 1930 derived warm glow without new UI state.
- [x] Asset contract test and city lights e2e updates.
- [x] Fresh verification, review, lessons check, archive.

Verification:
- [x] npm run test:node:city-lights-assets
- [x] node node_modules/@playwright/test/cli.js test tests/e2e/city_lights_layer_regression.spec.js --reporter=list --workers=1 --retries=0
- [x] python -m py_compile tools/build_city_lights_historical_1930_asset.py
- [x] node --check js/core/map_renderer.js
- [x] node --check tests/e2e/city_lights_layer_regression.spec.js

