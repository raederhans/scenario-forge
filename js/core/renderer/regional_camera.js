export function centralMeridian(region) {
  return Number.isFinite(region?.central_meridian) ? region.central_meridian : 0;
}

export function wrapLongitude(longitude) {
  if (longitude >= -180 && longitude <= 180) return longitude;
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

export function projectGeoBounds(projection, [west, south, east, north]) {
  const end = east < west ? east + 360 : east;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  function sample(lon, lat) {
    const [x, y] = projection([wrapLongitude(lon), lat]);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const columns = Math.max(1, Math.ceil((end - west) / 2));
  const rows = Math.max(1, Math.ceil((north - south) / 2));
  for (let i = 0; i <= columns; i++) {
    const lon = west + (end - west) * i / columns;
    sample(lon, south);
    sample(lon, north);
  }
  const widestLatitude = Math.max(south, Math.min(north, 0));
  for (const lon of [west, east]) {
    sample(lon, widestLatitude);
    for (let i = 0; i <= rows; i++) sample(lon, south + (north - south) * i / rows);
  }
  // Include both lips of the projection seam when it falls inside the box.
  const seam = wrapLongitude(180 - projection.rotate()[0]);
  const cut = seam < west ? seam + 360 : seam;
  if (cut > west && cut < end) {
    sample(cut - 1e-8, widestLatitude);
    sample(cut + 1e-8, widestLatitude);
  }
  return [[minX, minY], [maxX, maxY]];
}

export function fitRegionalProjection(projection, region, width, height) {
  projection.rotate([-centralMeridian(region), 0, 0]).scale(1).translate([0, 0]);
  const [[x0, y0], [x1, y1]] = projectGeoBounds(projection, region.bounds);
  const scale = Math.min(width / (x1 - x0), height / (y1 - y0));
  const x = (width - scale * (x0 + x1)) / 2;
  const y = (height - scale * (y0 + y1)) / 2;
  projection.scale(scale).translate([x, y]);
  return [[x + scale * x0, y + scale * y0], [x + scale * x1, y + scale * y1]];
}

export function constrainRegionalTransform(transform, bounds, width, height, maxScale, identity) {
  if (!bounds) return transform;
  if (transform.k <= 1) return identity;
  const k = Math.min(maxScale, transform.k);
  function constrainAxis(offset, size, min, max) {
    const start = -k * min;
    const end = size - k * max;
    if (end >= start) return (start + end) / 2;
    const padding = Math.min(12, (start - end) / 2);
    const centeredOffset = size / 2 + (offset - size / 2) * (k / transform.k);
    return Math.max(end - padding, Math.min(start + padding, centeredOffset));
  }
  const x = constrainAxis(transform.x, width, bounds[0][0], bounds[1][0]);
  const y = constrainAxis(transform.y, height, bounds[0][1], bounds[1][1]);
  return x === transform.x && y === transform.y && k === transform.k
    ? transform : identity.translate(x, y).scale(k);
}
