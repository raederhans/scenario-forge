export function getUncoveredRectangles(rectangles, viewport) {
  const right = viewport.x + viewport.width, bottom = viewport.y + viewport.height;
  const clipped = rectangles.map(rect => ({
    x: Math.max(viewport.x, rect.x), y: Math.max(viewport.y, rect.y),
    right: Math.min(right, rect.x + rect.width), bottom: Math.min(bottom, rect.y + rect.height),
  })).filter(rect => rect.right > rect.x && rect.bottom > rect.y);
  const edges = [...new Set([viewport.x, right, ...clipped.flatMap(rect => [rect.x, rect.right])])].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < edges.length; i++) {
    const x = edges[i - 1], width = edges[i] - x;
    const intervals = clipped.filter(rect => rect.x < edges[i] && rect.right > x).sort((a, b) => a.y - b.y);
    let y = viewport.y;
    for (const rect of intervals) {
      if (rect.y > y) gaps.push({ x, y, width, height: rect.y - y });
      y = Math.max(y, rect.bottom);
    }
    if (y < bottom) gaps.push({ x, y, width, height: bottom - y });
  }
  return gaps;
}

export function getUncoveredRatio(rectangles, viewport) {
  const area = getUncoveredRectangles(rectangles, viewport).reduce((sum, rect) => sum + rect.width * rect.height, 0);
  return area / (viewport.width * viewport.height);
}
