"""Core conversion engine — Pillow-based and cjxl/djxl paths."""

from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import shutil
import subprocess
import time
import uuid
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

from PIL import Image

from jxl_tools.metadata import (
    build_metadata_summary,
    build_save_kwargs,
)
from jxl_tools.models import (
    BatchProgress,
    ConversionDirection,
    ConversionResult,
    ConversionSettings,
    ImageInfo,
    MetadataSummary,
)

log = logging.getLogger(__name__)

# Formats Pillow can open that we support converting TO jxl
SUPPORTED_INPUT_FORMATS = {".png", ".jpg", ".jpeg", ".webp", ".tiff", ".tif", ".bmp"}
JXL_EXTENSIONS = {".jxl"}

# ---------------------------------------------------------------------------
# cjxl / djxl detection
# ---------------------------------------------------------------------------

_cjxl_path: str | None = None
_djxl_path: str | None = None
_tools_checked = False


def _find_tools() -> None:
    global _cjxl_path, _djxl_path, _tools_checked
    if _tools_checked:
        return
    _cjxl_path = shutil.which("cjxl")
    _djxl_path = shutil.which("djxl")
    _tools_checked = True
    if _cjxl_path:
        log.info("Found cjxl at %s", _cjxl_path)
    if _djxl_path:
        log.info("Found djxl at %s", _djxl_path)


def has_cjxl() -> bool:
    _find_tools()
    return _cjxl_path is not None


def has_djxl() -> bool:
    _find_tools()
    return _djxl_path is not None


def cjxl_available() -> bool:
    """Return True if byte-exact JPEG reconstruction is available."""
    return has_cjxl() and has_djxl()


# ---------------------------------------------------------------------------
# cjxl / djxl wrappers
# ---------------------------------------------------------------------------

def _run_cjxl(
    input_path: Path,
    output_path: Path,
    *,
    lossless_jpeg: bool = False,
    quality: int = 85,
    lossless: bool = False,
    effort: int = 7,
    distance: float | None = None,
) -> subprocess.CompletedProcess:
    """Run cjxl to encode an image to JXL."""
    _find_tools()
    assert _cjxl_path is not None

    cmd: list[str] = [_cjxl_path]

    if lossless_jpeg:
        # Byte-exact JPEG reconstruction
        cmd += ["--lossless_jpeg=1"]
    elif lossless:
        cmd += ["-d", "0"]
    elif distance is not None:
        cmd += ["-d", str(distance)]
    else:
        cmd += ["-q", str(quality)]

    cmd += ["-e", str(effort)]
    cmd += [str(input_path), str(output_path)]

    log.debug("Running: %s", " ".join(cmd))
    return subprocess.run(cmd, capture_output=True, text=True, timeout=300)


def _run_djxl(
    input_path: Path,
    output_path: Path,
) -> subprocess.CompletedProcess:
    """Run djxl to decode a JXL file."""
    _find_tools()
    assert _djxl_path is not None

    cmd = [_djxl_path, str(input_path), str(output_path)]
    log.debug("Running: %s", " ".join(cmd))
    return subprocess.run(cmd, capture_output=True, text=True, timeout=300)


# ---------------------------------------------------------------------------
# Single-file conversion
# ---------------------------------------------------------------------------

def _is_jpeg(path: Path) -> bool:
    return path.suffix.lower() in {".jpg", ".jpeg"}


def convert_to_jxl(
    input_path: Path,
    output_path: Path,
    settings: ConversionSettings,
) -> ConversionResult:
    """Convert a single image file to JXL."""
    t0 = time.perf_counter()
    input_path = Path(input_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    input_size = input_path.stat().st_size
    metadata_summary: MetadataSummary | None = None
    used_jpeg_lossless = False

    try:
        # --- Byte-exact JPEG path ---
        if (
            settings.jpeg_lossless
            and _is_jpeg(input_path)
            and has_cjxl()
        ):
            result = _run_cjxl(
                input_path, output_path,
                lossless_jpeg=True,
                effort=settings.effort,
            )
            if result.returncode != 0:
                raise RuntimeError(f"cjxl failed: {result.stderr.strip()}")
            used_jpeg_lossless = True

            # Still get metadata from the source for the summary
            with Image.open(input_path) as img:
                metadata_summary = build_metadata_summary(img)

        # --- cjxl path (non-jpeg-lossless but cjxl available) ---
        elif has_cjxl() and settings.distance is not None:
            # Use cjxl for distance-based encoding (finer control)
            result = _run_cjxl(
                input_path, output_path,
                lossless=settings.lossless,
                quality=settings.quality,
                effort=settings.effort,
                distance=settings.distance,
            )
            if result.returncode != 0:
                raise RuntimeError(f"cjxl failed: {result.stderr.strip()}")

            with Image.open(input_path) as img:
                metadata_summary = build_metadata_summary(img)

        # --- Pillow path ---
        else:
            with Image.open(input_path) as img:
                metadata_summary = build_metadata_summary(img)

                save_kwargs: dict[str, Any] = {}
                save_kwargs["lossless"] = settings.lossless

                if not settings.lossless:
                    save_kwargs["quality"] = settings.quality

                save_kwargs["effort"] = settings.effort

                # Metadata
                meta_kwargs = build_save_kwargs(
                    img,
                    preserve_metadata=settings.preserve_metadata,
                    strip_exif=settings.strip_exif,
                    strip_icc=settings.strip_icc,
                )
                save_kwargs.update(meta_kwargs)

                # pillow-jxl-plugin only supports RGB, RGBA, L, LA.
                # Palette (P/PA) → RGB/RGBA is a lossless depalettization.
                if img.mode not in ("RGB", "RGBA", "L", "LA"):
                    if img.mode == "P":
                        if "transparency" in img.info:
                            img = img.convert("RGBA")
                        else:
                            img = img.convert("RGB")
                    elif img.mode == "PA":
                        img = img.convert("RGBA")
                    else:
                        raise ValueError(
                            f"Unsupported color mode '{img.mode}' — "
                            f"only RGB, RGBA, L, LA, P, PA are supported."
                        )

                img.save(str(output_path), format="JXL", **save_kwargs)

        output_size = output_path.stat().st_size
        elapsed = (time.perf_counter() - t0) * 1000

        savings = (1 - output_size / input_size) * 100 if input_size > 0 else 0.0

        return ConversionResult(
            input_path=str(input_path),
            output_path=str(output_path),
            input_size=input_size,
            output_size=output_size,
            savings_pct=round(savings, 2),
            duration_ms=round(elapsed, 1),
            metadata=metadata_summary,
            used_jpeg_lossless=used_jpeg_lossless,
        )

    except Exception as e:
        elapsed = (time.perf_counter() - t0) * 1000
        log.exception("Conversion failed: %s", input_path)
        return ConversionResult(
            input_path=str(input_path),
            output_path=str(output_path),
            input_size=input_size,
            output_size=0,
            savings_pct=0.0,
            duration_ms=round(elapsed, 1),
            metadata=metadata_summary,
            error=str(e),
        )


def convert_from_jxl(
    input_path: Path,
    output_path: Path,
    settings: ConversionSettings,
) -> ConversionResult:
    """Convert a JXL file back to a conventional format."""
    t0 = time.perf_counter()
    input_path = Path(input_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    input_size = input_path.stat().st_size
    metadata_summary: MetadataSummary | None = None
    used_jpeg_lossless = False

    try:
        out_fmt = settings.output_format.value  # "png", "jpeg", etc.
        out_ext = output_path.suffix.lower()

        # --- djxl path for JPEG reconstruction ---
        if (
            settings.jpeg_lossless
            and out_fmt == "jpeg"
            and has_djxl()
        ):
            result = _run_djxl(input_path, output_path)
            if result.returncode != 0:
                raise RuntimeError(f"djxl failed: {result.stderr.strip()}")
            used_jpeg_lossless = True

            # Get metadata from output
            with Image.open(output_path) as img:
                metadata_summary = build_metadata_summary(img)

        # --- Pillow path ---
        else:
            with Image.open(input_path) as img:
                metadata_summary = build_metadata_summary(img)

                save_kwargs: dict[str, Any] = {}

                # Format-specific quality
                if out_fmt in ("jpeg", "webp"):
                    save_kwargs["quality"] = settings.quality

                # Metadata
                meta_kwargs = build_save_kwargs(
                    img,
                    preserve_metadata=settings.preserve_metadata,
                    strip_exif=settings.strip_exif,
                    strip_icc=settings.strip_icc,
                )
                save_kwargs.update(meta_kwargs)

                # Ensure JPEG compatibility (no alpha)
                if out_fmt == "jpeg" and img.mode in ("RGBA", "LA", "P"):
                    img = img.convert("RGB")

                pillow_format = out_fmt.upper()
                if pillow_format == "JPEG":
                    pillow_format = "JPEG"

                img.save(str(output_path), format=pillow_format, **save_kwargs)

        output_size = output_path.stat().st_size
        elapsed = (time.perf_counter() - t0) * 1000
        savings = (1 - output_size / input_size) * 100 if input_size > 0 else 0.0

        return ConversionResult(
            input_path=str(input_path),
            output_path=str(output_path),
            input_size=input_size,
            output_size=output_size,
            savings_pct=round(savings, 2),
            duration_ms=round(elapsed, 1),
            metadata=metadata_summary,
            used_jpeg_lossless=used_jpeg_lossless,
        )

    except Exception as e:
        elapsed = (time.perf_counter() - t0) * 1000
        log.exception("Conversion failed: %s", input_path)
        return ConversionResult(
            input_path=str(input_path),
            output_path=str(output_path),
            input_size=input_size,
            output_size=0,
            savings_pct=0.0,
            duration_ms=round(elapsed, 1),
            metadata=metadata_summary,
            error=str(e),
        )


def convert_single(
    input_path: Path,
    output_path: Path | None,
    settings: ConversionSettings,
) -> ConversionResult:
    """Convert a single file, auto-detecting direction from extension."""
    input_path = Path(input_path)

    if input_path.suffix.lower() in JXL_EXTENSIONS:
        # FROM JXL
        if output_path is None:
            out_ext = f".{settings.output_format.value}"
            if out_ext == ".jpeg":
                out_ext = ".jpg"
            output_path = input_path.with_suffix(out_ext)
        return convert_from_jxl(input_path, output_path, settings)
    else:
        # TO JXL
        if output_path is None:
            output_path = input_path.with_suffix(".jxl")
        return convert_to_jxl(input_path, output_path, settings)


# ---------------------------------------------------------------------------
# Batch conversion
# ---------------------------------------------------------------------------

def _collect_files(
    input_dir: Path,
    direction: ConversionDirection,
    recursive: bool,
) -> list[Path]:
    """Collect all convertible files in a directory."""
    if direction == ConversionDirection.TO_JXL:
        valid_exts = SUPPORTED_INPUT_FORMATS
    else:
        valid_exts = JXL_EXTENSIONS

    pattern = "**/*" if recursive else "*"
    files = [
        f for f in input_dir.glob(pattern)
        if f.is_file() and f.suffix.lower() in valid_exts
    ]
    files.sort()
    return files


def _build_output_path(
    f: Path,
    input_dir: Path,
    output_dir: Path,
    settings: ConversionSettings,
) -> Path:
    """Compute the output path for a single file in a batch."""
    if settings.mirror_structure:
        rel = f.relative_to(input_dir)
    else:
        rel = Path(f.name)

    if settings.direction == ConversionDirection.TO_JXL:
        return output_dir / rel.with_suffix(".jxl")
    else:
        out_ext = f".{settings.output_format.value}"
        if out_ext == ".jpeg":
            out_ext = ".jpg"
        return output_dir / rel.with_suffix(out_ext)


def convert_batch_sync(
    input_dir: Path,
    output_dir: Path,
    settings: ConversionSettings,
    on_progress: Any = None,
) -> BatchProgress:
    """Convert all matching files in a directory using parallel threads.

    Args:
        on_progress: Optional callback(progress: BatchProgress) called after
                     each file completes. Useful for CLI progress bars.
    """
    input_dir = Path(input_dir)
    output_dir = Path(output_dir)

    files = _collect_files(input_dir, settings.direction, settings.recursive)
    job_id = uuid.uuid4().hex[:12]
    workers = max(1, settings.workers)

    progress = BatchProgress(
        job_id=job_id,
        total=len(files),
    )

    # Build all (input, output) pairs upfront
    tasks = [(f, _build_output_path(f, input_dir, output_dir, settings)) for f in files]

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(convert_single, inp, outp, settings): inp
            for inp, outp in tasks
        }

        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            progress.results.append(result)
            progress.completed += 1
            progress.current_file = result.input_path
            progress.total_input_size += result.input_size
            progress.total_output_size += result.output_size

            if on_progress:
                on_progress(progress)

    progress.done = True
    return progress


async def convert_batch_async(
    input_dir: Path,
    output_dir: Path,
    settings: ConversionSettings,
) -> AsyncGenerator[BatchProgress, None]:
    """Convert all matching files with bounded concurrency, yielding progress."""
    input_dir = Path(input_dir)
    output_dir = Path(output_dir)

    files = _collect_files(input_dir, settings.direction, settings.recursive)
    job_id = uuid.uuid4().hex[:12]
    workers = max(1, settings.workers)

    progress = BatchProgress(
        job_id=job_id,
        total=len(files),
    )

    # Build all (input, output) pairs upfront
    tasks = [(f, _build_output_path(f, input_dir, output_dir, settings)) for f in files]

    sem = asyncio.Semaphore(workers)
    results_queue: asyncio.Queue[ConversionResult] = asyncio.Queue()

    async def _convert_one(inp: Path, outp: Path) -> None:
        async with sem:
            result = await asyncio.to_thread(convert_single, inp, outp, settings)
            await results_queue.put(result)

    # Launch all tasks
    async_tasks = [asyncio.create_task(_convert_one(inp, outp)) for inp, outp in tasks]

    # Yield progress as results come in
    for _ in range(len(tasks)):
        result = await results_queue.get()
        progress.results.append(result)
        progress.completed += 1
        progress.current_file = result.input_path
        progress.total_input_size += result.input_size
        progress.total_output_size += result.output_size
        yield progress

    # Ensure all tasks have finished
    await asyncio.gather(*async_tasks)

    progress.done = True
    yield progress


# ---------------------------------------------------------------------------
# Image info
# ---------------------------------------------------------------------------

def get_image_info(path: Path) -> ImageInfo:
    """Return information about an image file."""
    path = Path(path)
    size = path.stat().st_size

    with Image.open(path) as img:
        meta = build_metadata_summary(img)
        return ImageInfo(
            path=str(path),
            size=size,
            format=img.format or path.suffix.lstrip(".").upper(),
            dimensions=img.size,
            mode=img.mode,
            metadata=meta,
        )
