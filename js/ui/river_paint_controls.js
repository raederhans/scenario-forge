import { getRiverPaintRuntime } from '../core/river_paint/runtime.js';
import { loadRiverPaintPilot } from '../core/river_paint/pilot_loader.js';
import { RIVER_PAINT_PILOT } from '../core/river_paint/pilot_manifest.js';
import { RIVER_PAINT_RIVERS, getRiverPaintLocations, filterRiverPaintLocations } from './river_paint_locations.js';

// Optional pilot controls. Loading is cancellable and never changes the current
// scenario or turns an unavailable half-cell click into an entire-parent edit.
export function createRiverPaintControls({ state, button, statusNode = null, locationSelect = null,
  navigationPanel = null, searchInput = null, riverSelect = null, resultsNode = null, locationButton = null,
  focusParent = () => false,
  onLocation = () => {}, onSync = () => {},
  rebuildGeometry, render = () => {}, markDirty = () => {}, announce = () => {},
  loadPack = loadRiverPaintPilot, runtime = getRiverPaintRuntime(state),
} = {}) {
  let disposed = false;
  let locations = [], selectedPack = null;
  const zh = () => state.currentLanguage === 'zh';
  const availableNow = info => state.activeScenarioId === RIVER_PAINT_PILOT.sceneId
    && !!state.riverPaint?.editMode && info.active && !info.pending && !state.startupReadonly;
  function setOptions(select, options) {
    if (!select) return;
    const key = JSON.stringify(options);
    if (select.dataset.optionsKey === key) return;
    select.replaceChildren(...options.map(([value, text]) => {
      const option = select.ownerDocument.createElement('option');
      option.value = value; option.textContent = text; return option;
    }));
    select.dataset.optionsKey = key;
    select.value = '';
  }
  function sync() {
    if (!button || disposed) return;
    const info = runtime.diagnostics();
    const supported = state.activeScenarioId === RIVER_PAINT_PILOT.sceneId;
    const enabled = supported && !!state.riverPaint?.editMode;
    button.disabled = !supported || !!state.startupReadonly;
    button.classList.toggle('is-active', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-busy', String(info.pending));
    const label = info.pending ? (zh() ? '取消加载' : 'Cancel loading') : (zh() ? '沿河填色' : 'River cells');
    button.textContent = label;
    const description = !supported
      ? (zh() ? '试点仅支持 Modern World。' : 'Pilot available in Modern World only.')
      : info.error ? (zh() ? `沿河分区未就绪：${info.error}` : `River partitions unavailable: ${info.error}`)
      : (zh() ? '搜索已加载的沿河地点，按河流筛选。旧项目保留原范围；关闭工具保留颜色。'
        : 'Search loaded river locations or filter by river. Existing projects retain their coverage. Turning off the tool preserves paint.');
    button.title = description;
    button.setAttribute('aria-label', `${label}. ${description}`);
    if (statusNode) statusNode.textContent = description;
    const pack = availableNow(info) ? runtime.getActivePack() : null;
    const available = !!pack;
    if (pack !== selectedPack) {
      selectedPack = pack;
      locations = getRiverPaintLocations(pack);
      if (searchInput) searchInput.value = '';
      if (riverSelect) riverSelect.value = '';
    }
    if (navigationPanel) {
      navigationPanel.hidden = !available;
      navigationPanel.setAttribute('aria-label', zh() ? '沿河地点' : 'River locations');
    }
    for (const node of [searchInput, riverSelect, locationSelect, resultsNode, locationButton]) {
      if (node) node.hidden = !available;
    }
    if (searchInput) {
      searchInput.disabled = !available;
      const label = zh() ? '搜索地点名称或 ID' : 'Search location name or ID';
      searchInput.setAttribute('aria-label', label);
      searchInput.placeholder = label;
    }
    const language = zh() ? 'zh' : 'en';
    const rivers = new Set(locations.flatMap(location => location.rivers));
    if (riverSelect) {
      const river = riverSelect.value;
      const label = zh() ? '按河流筛选' : 'Filter by river';
      riverSelect.setAttribute('aria-label', label);
      riverSelect.title = label;
      riverSelect.disabled = !available;
      setOptions(riverSelect, [['', zh() ? '全部河流' : 'All rivers'],
        ...Object.entries(RIVER_PAINT_RIVERS).filter(([key]) => rivers.has(key))
          .map(([key, labels]) => [key, labels[language]])]);
      riverSelect.value = rivers.has(river) ? river : '';
    }
    const matches = filterRiverPaintLocations(locations, { query: searchInput?.value, river: riverSelect?.value });
    if (resultsNode) resultsNode.textContent = matches.length
      ? (zh() ? `${matches.length} / ${locations.length} 个地点` : `${matches.length} / ${locations.length} locations`)
      : (zh() ? '无匹配地点，请调整搜索或河流筛选。' : 'No matching locations. Adjust the search or river filter.');
    if (locationSelect) {
      const selectedId = locationSelect.value;
      locationSelect.disabled = !available || !matches.length;
      const label = zh() ? '定位沿河地点' : 'Go to river location';
      locationSelect.setAttribute('aria-label', label);
      locationSelect.title = label;
      setOptions(locationSelect, [['', matches.length ? label : (zh() ? '无匹配地点' : 'No matching locations')],
        ...matches.map(location => [location.id, location.labels[language]])]);
      locationSelect.value = matches.some(location => location.id === selectedId) ? selectedId : '';
    }
    if (locationButton) {
      locationButton.textContent = zh() ? '定位' : 'Go';
      locationButton.setAttribute('aria-label', zh() ? '定位所选地点' : 'Go to selected location');
      locationButton.disabled = !available || !locationSelect?.value;
    }
    onSync();
  }
  function navigate() {
    if (disposed || locationSelect?.disabled) return;
    if (!locationSelect?.value) {
      if (locationButton) locationButton.disabled = true;
      return;
    }
    const id = locationSelect.value;
    // Retain the native select value so ArrowDown can reach the next option.
    // The Go button recentres the same location after panning the map.
    const info = runtime.diagnostics();
    const pack = availableNow(info) ? runtime.getActivePack() : null;
    const location = getRiverPaintLocations(pack).find(entry => entry.id === id);
    if (pack !== selectedPack || !location || !focusParent(id)) {
      sync();
      announce(zh() ? '当前无法定位这个地点。' : 'This location cannot be located right now.');
    } else {
      if (locationButton) locationButton.disabled = false;
      onLocation(id, location.labels);
    }
  }
  async function toggle() {
    if (!button || button.disabled || disposed) return;
    if (state.riverPaint?.editMode) {
      runtime.setMode(false); markDirty('river-paint-mode'); sync(); render(); return;
    }
    const promise = runtime.enable(loadPack);
    sync();
    try {
      const result = await promise;
      if (disposed || !result.ready) return;
      if (result.geometryChanged) {
        // Rebuild the existing display and interaction indexes once. Source
        // topology and administrative/scenario membership remain untouched.
        await rebuildGeometry();
      }
      markDirty('river-paint-enable');
      render();
      announce(zh() ? '沿河填色已启用。搜索或选择地点，点击地图或使用分区预览填色。'
        : 'River cells enabled. Search or choose a location, then paint on the map or use the cell preview.');
    } catch (failure) {
      if (!disposed) announce(zh() ? `无法启用沿河分区：${failure.message}` : `Cannot enable river partitions: ${failure.message}`);
    } finally { sync(); }
  }
  if (button) button.addEventListener('click', toggle);
  locationSelect?.addEventListener('change', navigate);
  searchInput?.addEventListener('input', sync);
  riverSelect?.addEventListener('change', sync);
  locationButton?.addEventListener('click', navigate);
  sync();
  return Object.freeze({ sync, toggle,
    dispose() { disposed = true; button?.removeEventListener('click', toggle);
      locationSelect?.removeEventListener('change', navigate);
      searchInput?.removeEventListener('input', sync);
      locationButton?.removeEventListener('click', navigate);
      riverSelect?.removeEventListener('change', sync); runtime.cancel(); },
  });
}
