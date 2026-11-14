from shapely.geometry import Polygon


def _square(x: float, y: float, size: float = 1.0) -> Polygon:
    return Polygon(
        [
            (x, y),
            (x + size, y),
            (x + size, y + size),
            (x, y + size),
        ]
    )


def _polygon(min_x: float, min_y: float, max_x: float, max_y: float) -> Polygon:
    return Polygon(
        [
            (min_x, min_y),
            (max_x, min_y),
            (max_x, max_y),
            (min_x, max_y),
        ]
    )
