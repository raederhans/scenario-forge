import { getRiverPaintRuntime } from '../core/river_paint/runtime.js';

// Transient UI selection only: project paint and history remain owned by the editor.
export function createRiverCellPicker({ state, panel, select, preview, applyButton,
  title, closeButton, caption, applyCell, announce = () => {}, runtime = getRiverPaintRuntime(state),
  d3 = globalThis.d3 } = {}) {
  let parentId = '', parentLabels = null, cellId = '', selectedPack = null;
  const zh = () => state.currentLanguage === 'zh';
  function currentParent() {
    if (state.startupReadonly || !state.riverPaint?.editMode) return null;
    const pack = runtime.getActivePack();
    if (!pack || pack !== selectedPack) return null;
    return pack.parents.find(parent => parent.parentId === parentId) || null;
  }
  function draw(parent, cell) {
    if (!preview || !d3) return;
    const ns = 'http://www.w3.org/2000/svg';
    const node = (tag, attrs) => {
      const el = preview.ownerDocument.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
      return el;
    };
    preview.replaceChildren();
    if (!cell) return;
    for (const [index, geometry] of [parent.parentGeometry, cell.geometry].entries()) {
      const projection = d3.geoMercator().fitExtent([[8, 8], [112, 94]], geometry);
      const path = d3.geoPath(projection);
      const group = node('g', { transform: `translate(${index * 120},0)` });
      group.append(node('path', { d: path(geometry), fill: index ? '#f59e0b' : '#cbd5e1', stroke: '#334155', 'stroke-width': 1 }));
      if (!index) {
        group.append(node('path', { d: path(cell.geometry), fill: '#f59e0b', stroke: '#b45309', 'stroke-width': 1.5 }));
        const [[x0, y0], [x1, y1]] = path.bounds(cell.geometry);
        group.append(node('circle', { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
          r: 5, fill: 'none', stroke: '#b45309', 'stroke-width': 1.5 }));
      }
      preview.append(group);
    }
    preview.setAttribute('aria-label', zh() ? '左：分区在地块中的位置；右：所选分区放大' : 'Left: location within parent. Right: selected cell enlarged.');
  }
  function sync() {
    const parent = currentParent();
    panel.hidden = !parent;
    if (!parent) {
      parentId = ''; parentLabels = null; cellId = ''; selectedPack = null;
      select.replaceChildren(); select.disabled = true;
      preview?.replaceChildren(); applyButton.disabled = true;
      return;
    }
    const cell = parent.cells.find(entry => entry.id === cellId);
    const parentLabel = parentLabels?.[zh() ? 'zh' : 'en'];
    title.textContent = parentLabel
      ? `${parentLabel} · ${parent.cells.length}`
      : (zh() ? `河岸分区 · ${parent.cells.length}` : `River cells · ${parent.cells.length}`);
    select.setAttribute('aria-label', zh() ? '选择河岸分区' : 'Choose river cell');
    select.disabled = false;
    select.replaceChildren(...parent.cells.map((entry, index) => {
      const option = select.ownerDocument.createElement('option');
      option.value = entry.id;
      option.textContent = zh() ? `分区 ${index + 1} / ${parent.cells.length}` : `Cell ${index + 1} / ${parent.cells.length}`;
      return option;
    }));
    select.value = cellId;
    applyButton.textContent = zh() ? '应用当前工具' : 'Apply current tool';
    applyButton.disabled = !cell;
    if (closeButton) closeButton.textContent = zh() ? '关闭' : 'Close';
    if (caption) caption.textContent = zh() ? '左：地块内位置　右：分区放大' : 'Left: location · Right: enlarged cell';
    draw(parent, cell);
  }
  function open(id, labels = null) {
    parentLabels = labels;
    selectedPack = runtime.getActivePack(); parentId = id;
    cellId = currentParent()?.cells[0]?.id || ''; sync();
  }
  function change() { cellId = select.value; sync(); }
  function close() { parentId = ''; sync(); }
  function apply() {
    const parent = currentParent();
    if (!parent?.cells.some(cell => cell.id === cellId)) { sync(); return; }
    if (!['fill', 'eraser', 'eyedropper'].includes(state.currentTool)
      || (state.currentTool !== 'eyedropper' && state.interactionGranularity === 'country')) {
      announce(zh() ? '请使用地块级填色、橡皮或取色工具。' : 'Use subdivision fill, eraser or eyedropper.'); return;
    }
    if (!applyCell(parentId, cellId)) {
      announce(zh() ? '分区当前不可编辑，请重新选择试点。' : 'Cell unavailable. Choose the pilot again.');
    }
  }
  select.addEventListener('change', change); applyButton.addEventListener('click', apply);
  closeButton?.addEventListener('click', close);
  sync();
  return { open, sync, dispose() { select.removeEventListener('change', change);
    applyButton.removeEventListener('click', apply); panel.hidden = true;
    closeButton?.removeEventListener('click', close);
    selectedPack = null; parentId = ''; cellId = ''; } };
}
