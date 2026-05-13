def validate_coordinates(latitude: float, longitude: float) -> bool:
    """Validate that coordinates fall within Zimbabwe's bounding box."""
    # Zimbabwe approximate bounds
    ZW_BOUNDS = {
        "min_lat": -22.5,
        "max_lat": -15.3,
        "min_lon": 25.2,
        "max_lon": 33.1,
    }
    return (
        ZW_BOUNDS["min_lat"] <= latitude <= ZW_BOUNDS["max_lat"]
        and ZW_BOUNDS["min_lon"] <= longitude <= ZW_BOUNDS["max_lon"]
    )


def format_coordinates(latitude: float, longitude: float) -> str:
    """Format coordinates for display."""
    lat_dir = "S" if latitude < 0 else "N"
    lon_dir = "E" if longitude > 0 else "W"
    return f"{abs(latitude):.5f}°{lat_dir}, {abs(longitude):.5f}°{lon_dir}"
