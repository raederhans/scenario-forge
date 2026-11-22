function inkBox(metrics, size, x, y, angle, transform, spacing = 0) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const left = -(metrics.actualBoundingBoxLeft ?? metrics.width / 2) - spacing / 2;
  const right = (metrics.actualBoundingBoxRight ?? metrics.width / 2) + spacing / 2;
  const top = -(metrics.actualBoundingBoxAscent ?? size / 2);
  const bottom = metrics.actualBoundingBoxDescent ?? size / 2;
  const centerX = (left + right) / 2, centerY = (top + bottom) / 2;
  const screenX = (x + centerX * cos - centerY * sin) * transform.k + transform.x;
  const screenY = (y + centerX * sin + centerY * cos) * transform.k + transform.y;
  const w = (Math.abs(cos) * (right - left) + Math.abs(sin) * (bottom - top) + size * 0.14) * transform.k;
  const h = (Math.abs(sin) * (right - left) + Math.abs(cos) * (bottom - top) + size * 0.14) * transform.k;
  return { x: screenX - w / 2, y: screenY - h / 2, w, h };
}

export function layoutManualMapLabel({ lines, point, size, rotation, transform }) {
  const angle = rotation * Math.PI / 180;
  const positioned = lines.map(({ text, metrics }, index) => {
    const y = (index - (lines.length - 1) / 2) * size * 1.2;
    const box = inkBox(metrics, size, point[0] - y * Math.sin(angle), point[1] + y * Math.cos(angle), angle, transform);
    return { text, y, box };
  }).filter(line => line.text.trim());
  return { angle, lines: positioned };
}

export function layoutCurvedManualMapLabel({ lines, point, size, rotation, curve, spacing, transform }) {
  const widths = lines.map(line => line.reduce((width, { metrics }) => width + metrics.width, 0)
    + Math.max(0, line.length - 1) * spacing);
  const widest = widths.reduce((max, width) => Math.max(max, width), 0);
  const radius = widest / (Math.abs(curve) * Math.PI / 180);
  const direction = Math.sign(curve);
  const angle = rotation * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const glyphs = [], boxes = [];
  lines.forEach((line, index) => {
    const offset = (index - (lines.length - 1) / 2) * size * 1.2;
    const lineRadius = Math.max(size / 2, radius - direction * offset);
    let advance = -widths[index] / 2;
    for (const { text, metrics } of line) {
      const center = advance + metrics.width / 2;
      advance += metrics.width + spacing;
      if (!text.trim()) continue;
      const tangent = direction * center / lineRadius;
      const x = tangent ? center * Math.sin(tangent) / tangent : center;
      const y = offset + 2 * center * (tangent ? Math.sin(tangent / 2) ** 2 / tangent : 0);
      glyphs.push({ text, x, y, angle: tangent });
      boxes.push(inkBox(metrics, size, point[0] + x * cos - y * sin, point[1] + x * sin + y * cos,
        angle + tangent, transform, spacing));
    }
  });
  return { angle, glyphs, boxes };
}
