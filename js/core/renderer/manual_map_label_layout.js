export function layoutManualMapLabel({ lines, point, size, rotation, transform }) {
  const angle = rotation * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const positioned = lines.map(({ text, metrics }, index) => {
    const y = (index - (lines.length - 1) / 2) * size * 1.2;
    const left = -(metrics.actualBoundingBoxLeft ?? metrics.width / 2);
    const right = metrics.actualBoundingBoxRight ?? metrics.width / 2;
    const top = y - (metrics.actualBoundingBoxAscent ?? size / 2);
    const bottom = y + (metrics.actualBoundingBoxDescent ?? size / 2);
    const centerX = (left + right) / 2, centerY = (top + bottom) / 2;
    const x = (point[0] + centerX * cos - centerY * sin) * transform.k + transform.x;
    const screenY = (point[1] + centerX * sin + centerY * cos) * transform.k + transform.y;
    const w = (Math.abs(cos) * (right - left) + Math.abs(sin) * (bottom - top) + size * 0.14) * transform.k;
    const h = (Math.abs(sin) * (right - left) + Math.abs(cos) * (bottom - top) + size * 0.14) * transform.k;
    return { text, y, box: { x: x - w / 2, y: screenY - h / 2, w, h } };
  }).filter(line => line.text.trim());
  return { angle, lines: positioned };
}
