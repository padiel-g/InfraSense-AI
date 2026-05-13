import math
from dataclasses import dataclass
from functools import lru_cache
from typing import List, Optional, Callable


# -------------------------
# Data Models
# -------------------------

@dataclass(frozen=True)
class Point:
    latitude: float
    longitude: float

    def validate(self):
        if not (-90 <= self.latitude <= 90):
            raise ValueError(f"Invalid latitude: {self.latitude}")
        if not (-180 <= self.longitude <= 180):
            raise ValueError(f"Invalid longitude: {self.longitude}")


@dataclass(frozen=True)
class Crew:
    id: str
    location: Point


@dataclass(frozen=True)
class CrewDistance:
    crew: Crew
    distance_km: float


# -------------------------
# Geo Service
# -------------------------

class GeoService:
    EARTH_RADIUS_KM = 6371.0

    # -------------------------
    # Distance (Cached)
    # -------------------------

    @staticmethod
    @lru_cache(maxsize=100_000)
    def haversine_distance(
        lat1: float, lon1: float, lat2: float, lon2: float
    ) -> float:
        """Distance in kilometers (cached)."""
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)

        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat1))
            * math.cos(math.radians(lat2))
            * math.sin(dlon / 2) ** 2
        )
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return GeoService.EARTH_RADIUS_KM * c

    @staticmethod
    def distance(p1: Point, p2: Point) -> float:
        return GeoService.haversine_distance(
            p1.latitude, p1.longitude, p2.latitude, p2.longitude
        )

    # -------------------------
    # Nearest Crew
    # -------------------------

    @staticmethod
    def find_nearest_crew(
        incident: Point,
        crews: List[Crew],
        distance_fn: Callable[[Point, Point], float] = None,
    ) -> Optional[CrewDistance]:
        if not crews:
            return None

        incident.validate()
        distance_fn = distance_fn or GeoService.distance

        nearest = None
        min_distance = float("inf")

        for crew in crews:
            dist = distance_fn(incident, crew.location)
            if dist < min_distance:
                min_distance = dist
                nearest = crew

        return CrewDistance(crew=nearest, distance_km=round(min_distance, 3))

    # -------------------------
    # K Nearest Crews
    # -------------------------

    @staticmethod
    def find_k_nearest_crews(
        incident: Point,
        crews: List[Crew],
        k: int = 3,
    ) -> List[CrewDistance]:
        incident.validate()

        distances = [
            CrewDistance(
                crew=c,
                distance_km=GeoService.distance(incident, c.location),
            )
            for c in crews
        ]

        return sorted(distances, key=lambda x: x.distance_km)[:k]

    # -------------------------
    # Route Optimization
    # -------------------------

    @staticmethod
    def optimize_route(points: List[Point]) -> List[Point]:
        """Nearest neighbour + 2-opt optimization."""
        if len(points) <= 2:
            return points

        # Step 1: Nearest neighbour
        route = [points[0]]
        remaining = points[1:]

        while remaining:
            last = route[-1]
            next_point = min(remaining, key=lambda p: GeoService.distance(last, p))
            route.append(next_point)
            remaining.remove(next_point)

        # Step 2: 2-opt improvement
        return GeoService._two_opt(route)

    @staticmethod
    def _two_opt(route: List[Point]) -> List[Point]:
        """Improve route using 2-opt swaps."""
        best = route
        improved = True

        while improved:
            improved = False
            for i in range(1, len(best) - 2):
                for j in range(i + 1, len(best)):
                    if j - i == 1:
                        continue

                    new_route = best[:]
                    new_route[i:j] = reversed(best[i:j])

                    if GeoService._route_distance(new_route) < GeoService._route_distance(best):
                        best = new_route
                        improved = True

        return best

    @staticmethod
    def _route_distance(route: List[Point]) -> float:
        return sum(
            GeoService.distance(route[i], route[i + 1])
            for i in range(len(route) - 1)
        )

    # -------------------------
    # Geofencing
    # -------------------------

    @staticmethod
    def point_in_bounds(point: Point, bounds: dict) -> bool:
        """
        Supports anti-meridian crossing.
        bounds = {
            "min_lat": float,
            "max_lat": float,
            "min_lon": float,
            "max_lon": float,
        }
        """
        point.validate()

        lat_ok = bounds["min_lat"] <= point.latitude <= bounds["max_lat"]

        if bounds["min_lon"] <= bounds["max_lon"]:
            lon_ok = bounds["min_lon"] <= point.longitude <= bounds["max_lon"]
        else:
            # Anti-meridian case
            lon_ok = (
                point.longitude >= bounds["min_lon"]
                or point.longitude <= bounds["max_lon"]
            )

        return lat_ok and lon_ok