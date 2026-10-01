import { getRiverPaintRuntime } from '../core/river_paint/runtime.js';
import { loadRiverPaintPilot } from '../core/river_paint/pilot_loader.js';
import { RIVER_PAINT_PILOT } from '../core/river_paint/pilot_manifest.js';

const PILOT_LOCATIONS = [
  ['FR_ARR_75001', 'Paris · Seine', '巴黎 · 塞纳河'],
  ['FR_ARR_76003', 'Rouen · Seine', '鲁昂 · 塞纳河'],
  ['DEE0D', 'Stendal · Elbe', '施滕达尔 · 易北河'],
  ['DEE06', 'Jerichower Land · Elbe', '耶里肖地区 · 易北河'],
  ['RU_RAY_50074027B53551011789267', 'Dubna · Volga', '杜布纳 · 伏尔加河'],
  ['RU_RAY_50074027B57358126207690', 'Yaroslavl · Volga', '雅罗斯拉夫尔 · 伏尔加河'],
];

// Optional pilot controls. Loading is cancellable and never changes the current
// scenario or turns an unavailable half-cell click into an entire-parent edit.
export function createRiverPaintControls({ state, button, statusNode = null, locationSelect = null,
  focusParent = () => false,
  rebuildGeometry, render = () => {}, markDirty = () => {}, announce = () => {},
  loadPack = loadRiverPaintPilot, runtime = getRiverPaintRuntime(state),
} = {}) {
  let disposed = false;
  const zh = () => state.currentLanguage === 'zh';
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
      : (zh() ? '局部试点：巴黎、鲁昂、Stendal、Jerichower Land、Dubna、Yaroslavl。关闭工具不会清除已填颜色。'
        : 'Local pilot: Paris, Rouen, Stendal, Jerichower Land, Dubna and Yaroslavl. Turning off the tool preserves paint.');
    button.title = description;
    button.setAttribute('aria-label', `${label}. ${description}`);
    if (statusNode) statusNode.textContent = description;
    if (locationSelect) {
      const available = enabled && info.active && !info.pending && !state.startupReadonly;
      locationSelect.hidden = !available;
      locationSelect.disabled = !available;
      const label = zh() ? '定位沿河试点' : 'Go to river pilot';
      locationSelect.setAttribute('aria-label', label);
      locationSelect.title = label;
      const ids = new Set(available ? runtime.getActivePack()?.parents.map(parent => parent.parentId) : []);
      const options = [['', label], ...PILOT_LOCATIONS.filter(([id]) => ids.has(id))
        .map(([id, en, cn]) => [id, zh() ? cn : en])];
      const key = JSON.stringify(options);
      if (locationSelect.dataset.optionsKey !== key) {
        locationSelect.replaceChildren(...options.map(([value, text]) => {
          const option = locationSelect.ownerDocument.createElement('option');
          option.value = value; option.textContent = text; return option;
        }));
        locationSelect.dataset.optionsKey = key;
      }
    }
  }
  function navigate() {
    if (disposed || locationSelect?.disabled || !locationSelect?.value) return;
    const id = locationSelect.value;
    // Reset so selecting the same location again recentres a panned map.
    locationSelect.value = '';
    const allowed = runtime.getActivePack()?.parents.some(parent => parent.parentId === id);
    if (!state.riverPaint?.editMode || !allowed || !focusParent(id)) {
      announce(zh() ? '当前无法定位这个试点。' : 'This pilot cannot be located right now.');
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
      announce(zh() ? '沿河试点已启用。选择试点地点，再分别点击河流两侧填色。'
        : 'River pilot enabled. Choose a pilot location, then click each side to paint.');
    } catch (failure) {
      if (!disposed) announce(zh() ? `无法启用沿河分区：${failure.message}` : `Cannot enable river partitions: ${failure.message}`);
    } finally { sync(); }
  }
  if (button) button.addEventListener('click', toggle);
  locationSelect?.addEventListener('change', navigate);
  sync();
  return Object.freeze({ sync, toggle,
    dispose() { disposed = true; button?.removeEventListener('click', toggle);
      locationSelect?.removeEventListener('change', navigate); runtime.cancel(); },
  });
}
