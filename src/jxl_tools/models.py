"""Pydantic models for API requests/responses and shared data structures."""

from __future__ import annotations

import os
from enum import Enum

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class OutputFormat(str, Enum):
    """Supported output formats when converting FROM JXL."""
    PNG = "png"
    JPEG = "jpeg"
    WEBP = "webp"
    TIFF = "tiff"


class ConversionDirection(str, Enum):
    TO_JXL = "to_jxl"
    FROM_JXL = "from_jxl"


class QualityPreset(str, Enum):
    """Built-in quality presets."""
    WEB = "web"            # q80, e4  — good balance for web
    ARCHIVE = "archive"    # lossless, e7 — maximum preservation
    FAST = "fast"          # q70, e1  — quick preview
    CUSTOM = "custom"      # user-specified values


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

class ConversionSettings(BaseModel):
    """Settings for a conversion job."""
    # Quality
    lossless: bool = False
    quality: int = Field(default=85, ge=1, le=100)
    distance: float | None = Field(default=None, ge=0.0, le=25.0)
    effort: int = Field(default=7, ge=1, le=9)

    # Output
    output_format: OutputFormat = OutputFormat.PNG  # only used for from_jxl
    direction: ConversionDirection = ConversionDirection.TO_JXL

    # Metadata
    preserve_metadata: bool = True
    strip_exif: bool = False
    strip_icc: bool = False

    # JPEG byte-exact reconstruction (requires cjxl/djxl)
    jpeg_lossless: bool = False

    # Timeout
    timeout_seconds: int = Field(default=300, ge=1)

    # Batch
    recursive: bool = True
    mirror_structure: bool = True
    workers: int = Field(default_factory=lambda: max(1, min((os.cpu_count() or 4) - 1, 16)))

    def apply_preset(self, preset: QualityPreset) -> None:
        """Apply a named quality preset, mutating self."""
        if preset == QualityPreset.WEB:
            self.lossless = False
            self.quality = 80
            self.effort = 4
        elif preset == QualityPreset.ARCHIVE:
            self.lossless = True
            self.effort = 7
        elif preset == QualityPreset.FAST:
            self.lossless = False
            self.quality = 70
            self.effort = 1


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------

class MetadataSummary(BaseModel):
    """Human-readable metadata pulled from an image."""
    dimensions: tuple[int, int] = (0, 0)
    mode: str = ""
    format: str = ""
    has_exif: bool = False
    has_icc: bool = False
    exif_fields: dict[str, str] = Field(default_factory=dict)
    icc_description: str = ""


class ConversionResult(BaseModel):
    """Result of a single file conversion."""
    input_path: str
    output_path: str
    input_size: int        # bytes
    output_size: int       # bytes
    savings_pct: float     # negative means output is larger
    duration_ms: float
    metadata: MetadataSummary | None = None
    error: str | None = None
    used_jpeg_lossless: bool = False


class BatchProgress(BaseModel):
    """Progress update for a batch conversion job."""
    job_id: str
    current_file: str = ""
    completed: int = 0
    total: int = 0
    results: list[ConversionResult] = Field(default_factory=list)
    done: bool = False
    total_input_size: int = 0
    total_output_size: int = 0


class ImageInfo(BaseModel):
    """Information about a single image file."""
    path: str
    size: int
    format: str
    dimensions: tuple[int, int]
    mode: str
    metadata: MetadataSummary
