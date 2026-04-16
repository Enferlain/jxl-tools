"""FastAPI server — serves the web UI and conversion API."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import io
import json
import logging
import zipfile
import re
import shutil
from pathlib import Path
from typing import Any


from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backend import jobs, local_files
from backend.converter import (
    cjxl_available,
    convert_single,
    has_cjxl,
    has_djxl,
)
from backend.metadata import build_metadata_summary
from backend.models import (
    ConversionSettings,
    LocalBatchConversionRequest,
    LocalSelectionRequest,
)

def sanitize_filename(filename: str) -> str:
    """Sanitize a filename to prevent path traversal."""
    # Preserve more characters, only block dangerous ones and directory traversal
    filename = re.sub(r'[\\/\0:*?"<>|]', '_', filename)
    return filename

log = logging.getLogger(__name__)


def configure_runtime_logging() -> None:
    """Show backend job progress in the terminal and quiet noisy access logs."""
    backend_logger = logging.getLogger("backend")
    backend_logger.setLevel(logging.INFO)
    backend_logger.propagate = False

    if not backend_logger.handlers:
        handler = logging.StreamHandler()
        handler.setLevel(logging.INFO)
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%H:%M:%S"))
        backend_logger.addHandler(handler)

    access_logger = logging.getLogger("uvicorn.access")
    access_logger.handlers.clear()
    access_logger.propagate = False
    access_logger.disabled = True

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

PACKAGE_DIR = Path(__file__).parent
LEGACY_STATIC_DIR = PACKAGE_DIR / "static"
FRONTEND_DIR = PACKAGE_DIR.parent / "frontend"
FRONTEND_DIST_DIR = FRONTEND_DIR / "dist"
WORK_DIR = jobs.WORK_DIR
JOB_TTL_SECONDS = jobs.JOB_TTL_SECONDS
JOB_CLEANUP_INTERVAL_SECONDS = jobs.JOB_CLEANUP_INTERVAL_SECONDS


def get_frontend_dir() -> Path:
    """Return the directory that should be served for the web frontend."""
    if FRONTEND_DIST_DIR.is_dir():
        return FRONTEND_DIST_DIR

    return LEGACY_STATIC_DIR


def cleanup_work_dir(max_age_seconds: int = JOB_TTL_SECONDS) -> int:
    """Delete stale temporary job folders from the work directory."""
    jobs.WORK_DIR = WORK_DIR
    return jobs.cleanup_work_dir(max_age_seconds)


async def cleanup_old_jobs_forever() -> None:
    """Continuously trim old temp job folders while the server is running."""
    while True:
        try:
            removed = cleanup_work_dir()
            if removed:
                log.info("Cleaned up %d stale job folder(s)", removed)
        except Exception:
            log.exception("Background temp-job cleanup failed")

        await asyncio.sleep(JOB_CLEANUP_INTERVAL_SECONDS)


def create_job_dirs() -> tuple[str, Path, Path, Path]:
    """Create a fresh job directory after opportunistic cleanup."""
    jobs.WORK_DIR = WORK_DIR
    return jobs.create_job_dirs()


def get_local_roots() -> list[dict[str, str]]:
    """Return filesystem roots suitable for the current platform."""
    return local_files.get_local_roots()


def resolve_local_path(path_str: str | None) -> Path:
    """Expand and validate a local filesystem path for browser-driven browsing."""
    return local_files.resolve_local_path(path_str)


def list_local_path(path: Path) -> dict[str, Any]:
    """Return a browsable listing of directories plus supported files."""
    return local_files.list_local_path(path)


def collect_supported_files(path: Path, recursive: bool = True) -> list[Path]:
    """Return supported image files from a path, optionally recursively for directories."""
    return local_files.collect_supported_files(path, recursive=recursive)


def build_local_selection(paths: list[str], recursive: bool = True) -> dict[str, Any]:
    """Group selected local files into a tree plus aggregate breakdowns."""
    return local_files.build_local_selection(paths, recursive=recursive)


def get_output_extension(input_path: Path, settings: ConversionSettings) -> str:
    """Return the output extension for a source file under the chosen settings."""
    return local_files.get_output_extension(input_path, settings)


def ensure_unique_output_path(output_path: Path, reserved_paths: set[Path]) -> Path:
    """Avoid overwriting outputs when multiple inputs collapse to the same filename."""
    return local_files.ensure_unique_output_path(output_path, reserved_paths)


def build_local_conversion_pairs(
    paths: list[str],
    output_dir: str,
    settings: ConversionSettings,
) -> tuple[Path, list[tuple[Path, Path]]]:
    """Resolve local inputs into concrete conversion pairs for a batch job."""
    return local_files.build_local_conversion_pairs(paths, output_dir, settings)


def show_native_picker(kind: str) -> list[str]:
    """Open a native local file/folder dialog and return absolute paths."""
    return local_files.show_native_picker(kind)


def build_job_snapshot(job_id: str) -> dict[str, Any]:
    """Return a JSON-safe snapshot for a tracked batch job."""
    return jobs.build_job_snapshot(job_id)


def create_job_control() -> dict[str, asyncio.Event]:
    """Create cooperative pause/cancel primitives for a tracked job."""
    return jobs.create_job_control()


def initialize_job_state(
    job_id: str,
    *,
    total: int,
    workers: int,
    job_kind: str = "upload",
    output_dir: str | None = None,
) -> None:
    """Create tracked state, lock, and control primitives for a new job."""
    jobs.initialize_job_state(
        job_id,
        total=total,
        workers=workers,
        job_kind=job_kind,
        output_dir=output_dir,
    )


async def set_job_paused(job_id: str, paused: bool) -> dict[str, Any]:
    """Pause or resume a tracked job cooperatively."""
    return await jobs.set_job_paused(job_id, paused)


async def request_job_cancel(job_id: str) -> dict[str, Any]:
    """Stop a job from starting any more files and mark it cancelled when active work drains."""
    return await jobs.request_job_cancel(job_id)


async def run_batch_job(
    job_id: str,
    conversion_pairs: list[tuple[Path, Path]],
    settings: ConversionSettings,
) -> None:
    """Process a batch job in the background while updating in-memory progress."""
    await jobs.run_batch_job(job_id, conversion_pairs, settings)


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Start and stop background temp-job cleanup with the app lifecycle."""
    configure_runtime_logging()
    cleanup_work_dir()
    frontend_dir = get_frontend_dir()
    if frontend_dir == FRONTEND_DIST_DIR:
        log.info("Serving Vite frontend from %s", frontend_dir)
    else:
        log.warning(
            "Vite frontend build not found at %s; falling back to legacy static UI in %s",
            FRONTEND_DIST_DIR,
            LEGACY_STATIC_DIR,
        )
    cleanup_task = asyncio.create_task(cleanup_old_jobs_forever())
    try:
        yield
    finally:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="JXL Tools",
    version="0.1.0",
    docs_url="/api/docs",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Capabilities endpoint
# ---------------------------------------------------------------------------

@app.get("/api/capabilities")
async def get_capabilities():
    """Return what features are available on this system."""
    defaults = ConversionSettings()
    return {
        "cjxl_available": has_cjxl(),
        "djxl_available": has_djxl(),
        "jpeg_lossless": cjxl_available(),
        "default_workers": defaults.workers,
        "default_jxl_threads": defaults.jxl_threads,
    }


@app.get("/api/local/browse")
async def browse_local_filesystem(path: str | None = None):
    """Browse a local directory for server-backed local mode selection."""
    resolved = resolve_local_path(path)
    return list_local_path(resolved)


@app.post("/api/local/inspect-selection")
async def inspect_local_selection(payload: LocalSelectionRequest):
    """Expand selected local paths into grouped files plus aggregate breakdowns."""
    return build_local_selection(payload.paths, recursive=payload.recursive)


async def run_native_picker(kind: str) -> list[str]:
    """Run a native picker in a thread and convert GUI failures into HTTP errors."""
    try:
        return await asyncio.to_thread(show_native_picker, kind)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc


@app.post("/api/local/pick-source-files")
async def pick_local_source_files(payload: LocalSelectionRequest | None = None):
    """Open a native file picker for local source files."""
    paths = await run_native_picker("source_files")
    if not paths:
        return {"cancelled": True, "paths": []}

    response = build_local_selection(paths, recursive=(payload.recursive if payload else True))
    response["cancelled"] = False
    response["picked_paths"] = paths
    return response


@app.post("/api/local/pick-source-folder")
async def pick_local_source_folder(payload: LocalSelectionRequest | None = None):
    """Open a native folder picker for a local source directory."""
    paths = await run_native_picker("source_folder")
    if not paths:
        return {"cancelled": True, "paths": []}

    response = build_local_selection(paths, recursive=(payload.recursive if payload else True))
    response["cancelled"] = False
    response["picked_paths"] = paths
    return response


@app.post("/api/local/pick-target-folder")
async def pick_local_target_folder():
    """Open a native folder picker for a local output directory."""
    paths = await run_native_picker("target_folder")
    if not paths:
        return {"cancelled": True, "path": None}

    return {
        "cancelled": False,
        "path": paths[0],
    }


@app.post("/api/convert-local-batch")
async def convert_local_batch(payload: LocalBatchConversionRequest):
    """Create and start a background batch conversion job for local filesystem paths."""
    settings = payload.settings
    resolved_output_dir, conversion_pairs = build_local_conversion_pairs(
        payload.paths,
        payload.output_dir,
        settings,
    )

    job_id, _, _, _ = create_job_dirs()
    total = len(conversion_pairs)
    log.info("Local batch %s: %d files, %d workers -> %s", job_id, total, settings.workers, resolved_output_dir)

    initialize_job_state(
        job_id,
        total=total,
        workers=settings.workers,
        job_kind="local",
        output_dir=str(resolved_output_dir),
    )

    asyncio.create_task(run_batch_job(job_id, conversion_pairs, settings))

    return {
        "job_id": job_id,
        "job_kind": "local",
        "output_dir": str(resolved_output_dir),
        "total": total,
        "workers": settings.workers,
    }


# ---------------------------------------------------------------------------
# Single file conversion
# ---------------------------------------------------------------------------

@app.post("/api/convert")
async def convert_file(
    file: UploadFile = File(...),
    settings_json: str = Form(default="{}"),
):
    """Convert a single uploaded file."""
    try:
        settings_dict = json.loads(settings_json)
        settings = ConversionSettings(**settings_dict)
    except Exception as e:
        raise HTTPException(400, f"Invalid settings: {e}")

    # Create a job directory
    job_id, job_dir, input_dir, output_dir = create_job_dirs()

    # Save uploaded file
    assert file.filename is not None
    safe_filename = sanitize_filename(file.filename)
    input_path = input_dir / safe_filename
    with open(input_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
        
    from PIL import Image
    try:
        Image.open(input_path).verify()
    except Exception:
        input_path.unlink(missing_ok=True)
        raise HTTPException(400, "Invalid image file or corrupted data")

    # Determine output filename
    suffix = input_path.suffix.lower()
    if suffix == ".jxl":
        out_ext = f".{settings.output_format.value}"
        if out_ext == ".jpeg":
            out_ext = ".jpg"
    else:
        out_ext = ".jxl"

    output_path = output_dir / (input_path.stem + out_ext)

    # Convert in a thread
    result = await asyncio.to_thread(
        convert_single, input_path, output_path, settings
    )

    name = input_path.name
    if result.error:
        log.error("✗ %s — %s", name, result.error)
    else:
        log.info("✓ %s  %.1f%% savings  %.0fms", name, result.savings_pct, result.duration_ms)

    return {
        "job_id": job_id,
        "result": result.model_dump(),
    }


# ---------------------------------------------------------------------------
# Batch conversion
# ---------------------------------------------------------------------------

@app.post("/api/convert-batch")
async def convert_batch(
    files: list[UploadFile] = File(...),
    settings_json: str = Form(default="{}"),
):
    """Create and start a background batch conversion job."""
    try:
        settings_dict = json.loads(settings_json)
        settings = ConversionSettings(**settings_dict)
    except Exception as e:
        raise HTTPException(400, f"Invalid settings: {e}")

    job_id, job_dir, input_dir, output_dir = create_job_dirs()

    # Phase 1: Save all uploaded files to disk
    conversion_pairs: list[tuple[Path, Path]] = []
    for upload in files:
        if not upload.filename:
            continue

        safe_filename = sanitize_filename(upload.filename)
        input_path = input_dir / safe_filename
        
        with open(input_path, "wb") as f:
            shutil.copyfileobj(upload.file, f)
            
        from PIL import Image
        try:
            Image.open(input_path).verify()
        except Exception:
            input_path.unlink(missing_ok=True)
            raise HTTPException(400, f"Invalid image file: {upload.filename}")

        suffix = input_path.suffix.lower()
        if suffix == ".jxl":
            out_ext = f".{settings.output_format.value}"
            if out_ext == ".jpeg":
                out_ext = ".jpg"
        else:
            out_ext = ".jxl"

        output_path = output_dir / (input_path.stem + out_ext)
        conversion_pairs.append((input_path, output_path))

    total = len(conversion_pairs)
    log.info("Batch %s: %d files, %d workers", job_id, total, settings.workers)

    initialize_job_state(
        job_id,
        total=total,
        workers=settings.workers,
        job_kind="upload",
        output_dir=str(output_dir),
    )

    asyncio.create_task(run_batch_job(job_id, conversion_pairs, settings))

    return {
        "job_id": job_id,
        "total": total,
        "workers": settings.workers,
    }


@app.get("/api/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Return the latest progress snapshot for a batch conversion job."""
    job_id = sanitize_filename(job_id)
    return build_job_snapshot(job_id)


@app.post("/api/jobs/{job_id}/pause")
async def pause_job(job_id: str):
    """Pause a running batch after its active files finish."""
    job_id = sanitize_filename(job_id)
    return await set_job_paused(job_id, True)


@app.post("/api/jobs/{job_id}/resume")
async def resume_job(job_id: str):
    """Resume a paused batch."""
    job_id = sanitize_filename(job_id)
    return await set_job_paused(job_id, False)


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    """Request cooperative cancellation for a running batch."""
    job_id = sanitize_filename(job_id)
    return await request_job_cancel(job_id)


# ---------------------------------------------------------------------------
# File serving
# ---------------------------------------------------------------------------

@app.get("/api/preview/{job_id}/{filename}")
async def preview_file(job_id: str, filename: str):
    """Serve a converted file for preview."""
    job_id = sanitize_filename(job_id)
    filename = sanitize_filename(filename)
    file_path = WORK_DIR / job_id / "output" / filename
    if not file_path.exists():
        # Try input dir
        file_path = WORK_DIR / job_id / "input" / filename
    if not file_path.exists():
        raise HTTPException(404, "File not found")

    # Determine media type
    suffix = file_path.suffix.lower()
    media_types = {
        ".jxl": "image/jxl",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".tiff": "image/tiff",
        ".tif": "image/tiff",
        ".bmp": "image/bmp",
    }
    media_type = media_types.get(suffix, "application/octet-stream")

    return FileResponse(file_path, media_type=media_type)


@app.get("/api/download/{job_id}/{filename}")
async def download_file(job_id: str, filename: str):
    """Download a converted file."""
    job_id = sanitize_filename(job_id)
    filename = sanitize_filename(filename)
    file_path = WORK_DIR / job_id / "output" / filename
    if not file_path.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(
        file_path,
        media_type="application/octet-stream",
        filename=filename,
    )


@app.post("/api/download-batch/{job_id}")
async def download_batch(job_id: str):
    """Download all converted files as a zip."""
    job_id = sanitize_filename(job_id)
    output_dir = WORK_DIR / job_id / "output"
    if not output_dir.exists():
        raise HTTPException(404, "Job not found")

    # Create zip in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in output_dir.iterdir():
            if f.is_file():
                zf.write(f, f.name)
    zip_buffer.seek(0)

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=jxl-converted-{job_id}.zip"
        },
    )


# ---------------------------------------------------------------------------
# Image info
# ---------------------------------------------------------------------------

@app.post("/api/info")
async def image_info(file: UploadFile = File(...)):
    """Return metadata about an uploaded image."""
    from PIL import Image as PILImage

    content = await file.read()
    buf = io.BytesIO(content)

    try:
        with PILImage.open(buf) as img:
            meta = build_metadata_summary(img)
            return {
                "filename": file.filename,
                "size": len(content),
                "format": img.format or "",
                "dimensions": list(img.size),
                "mode": img.mode,
                "metadata": meta.model_dump(),
            }
    except Exception as e:
        raise HTTPException(400, f"Cannot read image: {e}")


# ---------------------------------------------------------------------------
# Static files (web UI) — must be last
# ---------------------------------------------------------------------------

app.mount("/", StaticFiles(directory=str(get_frontend_dir()), html=True), name="frontend")
