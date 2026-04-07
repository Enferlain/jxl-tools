"""EXIF / ICC / XMP metadata extraction and re-application."""

from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image
from PIL.ExifTags import TAGS

from jxl_tools.models import MetadataSummary

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

def extract_exif_bytes(img: Image.Image) -> bytes | None:
    """Return raw EXIF bytes from a Pillow image, or None."""
    exif_data = img.info.get("exif")
    if exif_data:
        return exif_data if isinstance(exif_data, bytes) else None

    # Try via getexif()
    try:
        exif = img.getexif()
        if exif:
            return exif.tobytes()
    except Exception:
        pass
    return None


def extract_icc_profile(img: Image.Image) -> bytes | None:
    """Return raw ICC profile bytes from a Pillow image, or None."""
    return img.info.get("icc_profile")


def extract_xmp(img: Image.Image) -> bytes | None:
    """Return raw XMP bytes from a Pillow image, or None."""
    xmp = img.info.get("xmp")
    if isinstance(xmp, bytes):
        return xmp
    if isinstance(xmp, str):
        return xmp.encode("utf-8")
    return None


def build_metadata_summary(img: Image.Image) -> MetadataSummary:
    """Build a human-readable metadata summary from a Pillow image."""
    exif_bytes = extract_exif_bytes(img)
    icc_bytes = extract_icc_profile(img)

    exif_fields: dict[str, str] = {}
    if exif_bytes:
        try:
            exif = img.getexif()
            for tag_id, value in exif.items():
                tag_name = TAGS.get(tag_id, str(tag_id))
                # Skip very long binary or thumbnail data
                str_val = str(value)
                if len(str_val) > 200:
                    str_val = str_val[:200] + "…"
                exif_fields[tag_name] = str_val
        except Exception:
            pass

    icc_desc = ""
    if icc_bytes:
        # Try to pull the profile description from the raw ICC data
        try:
            # The 'desc' tag is at a known offset in simple profiles
            desc_idx = icc_bytes.find(b"desc")
            if desc_idx >= 0:
                # Skip tag signature(4) + reserved(4) + length(4) + offset(4) + count(4)
                start = desc_idx + 12
                end = icc_bytes.find(b"\x00", start)
                if end > start:
                    icc_desc = icc_bytes[start:end].decode("ascii", errors="replace").strip()
        except Exception:
            icc_desc = "present"
        if not icc_desc:
            icc_desc = "present"

    fmt = img.format or ""
    # Pillow may not set .format on already-opened images
    return MetadataSummary(
        dimensions=img.size,
        mode=img.mode,
        format=fmt,
        has_exif=exif_bytes is not None,
        has_icc=icc_bytes is not None,
        exif_fields=exif_fields,
        icc_description=icc_desc,
    )


# ---------------------------------------------------------------------------
# Application helpers
# ---------------------------------------------------------------------------

def build_save_kwargs(
    img: Image.Image,
    *,
    preserve_metadata: bool = True,
    strip_exif: bool = False,
    strip_icc: bool = False,
) -> dict[str, Any]:
    """Build extra kwargs for Image.save() to preserve metadata."""
    kwargs: dict[str, Any] = {}
    if not preserve_metadata:
        return kwargs

    if not strip_exif:
        exif_bytes = extract_exif_bytes(img)
        if exif_bytes:
            kwargs["exif"] = exif_bytes

    if not strip_icc:
        icc = extract_icc_profile(img)
        if icc:
            kwargs["icc_profile"] = icc

    return kwargs
