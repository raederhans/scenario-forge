// Occupancy belongs to one labels pass. Callers own and discard the array per draw.
export function doScreenLabelBoxesOverlap(a, b) {
  return a.x < b.x + (b.w ?? b.width)
    && a.x + (a.w ?? a.width) > b.x
    && a.y < b.y + (b.h ?? b.height)
    && a.y + (a.h ?? a.height) > b.y;
}

export function claimScreenLabelPlacement(candidates, occupiedBoxes, isVisible = () => true) {
  const placement = candidates?.find((candidate) => isVisible(candidate.box)
    && !occupiedBoxes.some((box) => doScreenLabelBoxesOverlap(candidate.box, box)));
  if (!placement) return null;
  occupiedBoxes.push(placement.box);
  return placement;
}
