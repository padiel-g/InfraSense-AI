import io
from PIL import Image, ExifTags


MAX_DIMENSION = 1280  # Max width/height for YOLO input
JPEG_QUALITY = 85


def process_upload_image(contents: bytes, save_path: str) -> str:
    """
    Process an uploaded image: strip EXIF, resize, and save.
    Returns the path to the processed image.
    Raises ValueError on any processing failure so callers can surface a
    clean HTTP 422 instead of an opaque 500.
    """
    try:
        image = Image.open(io.BytesIO(contents))
    except Exception as exc:
        raise ValueError(f"Cannot open image file: {exc}") from exc

    try:
        # Auto-orient BEFORE stripping EXIF so the orientation tag is still present.
        image = auto_orient(image)

        # Strip EXIF metadata (privacy: remove device identifiers)
        image = strip_exif(image)

        # Resize if too large
        image = resize_for_detection(image, MAX_DIMENSION)

        # Convert to RGB if necessary (YOLO requires RGB)
        if image.mode != "RGB":
            image = image.convert("RGB")

        # Save processed image
        image.save(save_path, "JPEG", quality=JPEG_QUALITY)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"Failed to process image: {exc}") from exc

    return save_path


def strip_exif(image: Image.Image) -> Image.Image:
    """Remove all EXIF metadata from image."""
    # Palette images must be converted to RGB first — Image.new("P", ...) would
    # create a palette-less image that later crashes on convert("RGB").
    if image.mode == "P":
        image = image.convert("RGBA" if "transparency" in image.info else "RGB")

    data = list(image.getdata())
    clean = Image.new(image.mode, image.size)
    clean.putdata(data)
    return clean


def auto_orient(image: Image.Image) -> Image.Image:
    """Auto-orient image based on EXIF orientation tag."""
    try:
        exif = image.getexif()
        orientation_key = None
        for key, val in ExifTags.TAGS.items():
            if val == "Orientation":
                orientation_key = key
                break

        if orientation_key and orientation_key in exif:
            orientation = exif[orientation_key]
            rotations = {3: 180, 6: 270, 8: 90}
            if orientation in rotations:
                image = image.rotate(rotations[orientation], expand=True)
    except (AttributeError, KeyError):
        pass
    return image


def resize_for_detection(image: Image.Image, max_dim: int) -> Image.Image:
    """Resize image so the largest dimension is max_dim, preserving aspect ratio."""
    w, h = image.size
    if max(w, h) <= max_dim:
        return image

    scale = max_dim / max(w, h)
    new_w = int(w * scale)
    new_h = int(h * scale)
    return image.resize((new_w, new_h), Image.LANCZOS)


def extract_gps_from_exif(contents: bytes) -> dict:
    """Extract GPS coordinates from image EXIF data if available."""
    try:
        image = Image.open(io.BytesIO(contents))
        exif = image.getexif()
        gps_info = exif.get(34853)  # GPSInfo tag
        if not gps_info:
            return {}

        def to_decimal(dms, ref):
            d, m, s = dms
            decimal = d + m / 60 + s / 3600
            if ref in ["S", "W"]:
                decimal = -decimal
            return decimal

        lat = to_decimal(gps_info[2], gps_info[1])
        lon = to_decimal(gps_info[4], gps_info[3])
        return {"latitude": lat, "longitude": lon}
    except Exception:
        return {}
