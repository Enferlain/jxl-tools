"""FastAPI server — serves the web UI and conversion API."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import io
import json
import logging
import tempfile
import time
import uuid
import zipfile
import re
import shutil
from pathlib import Path
from typing import Any


from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from jxl_tools.converter import (
    cjxl_available,
    convert_single,
    has_cjxl,
    has_djxl,
)
from jxl_tools.metadata import build_metadata_summary
from jxl_tools.models import ConversionResult, ConversionSettings

def sanitize_filename(filename: str) -> str:
    """Sanitize a filename to prevent path traversal."""
    # Preserve more characters, only block dangerous ones and directory traversal
    filename = re.sub(r'[\\/\0:*?"<>|]', '_', filename)
    return filename

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

STATIC_DIR = Path(__file__).parent / "static"
WORK_DIR = Path(tempfile.gettempdir()) / "jxl-tools-work"
WORK_DIR.mkdir(exist_ok=True)
JOB_TTL_SECONDS = 60 * 60
JOB_CLEANUP_INTERVAL_SECONDS = 5 * 60
JOB_STATES: dict[str, dict[str, Any]] = {}
JOB_LOCKS: dict[str, asyncio.Lock] = {}


def cleanup_work_dir(max_age_seconds: int = JOB_TTL_SECONDS) -> int:
    """Delete stale temporary job folders from the work directory."""
    now = time.time()
    removed = 0

    for child in WORK_DIR.iterdir():
        if not child.is_dir():
            continue

        try:
            age_seconds = now - child.stat().st_mtime
        except FileNotFoundError:
            continue

        if age_seconds <= max_age_seconds:
            continue

        shutil.rmtree(child, ignore_errors=True)
        JOB_STATES.pop(child.name, None)
        JOB_LOCKS.pop(child.name, None)
        removed += 1

    return removed


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
    cleanup_work_dir()
    job_id = uuid.uuid4().hex[:12]
    job_dir = WORK_DIR / job_id
    input_dir = job_dir / "input"
    output_dir = job_dir / "output"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    return job_id, job_dir, input_dir, output_dir


def build_job_snapshot(job_id: str) -> dict[str, Any]:
    """Return a JSON-safe snapshot for a tracked batch job."""
    state = JOB_STATES.get(job_id)
    if state is None:
        raise HTTPException(404, "Job not found")

    return {
        "job_id": job_id,
        "total": state["total"],
        "workers": state["workers"],
        "completed": state["completed"],
        "active": state["active"],
        "queued": state["queued"],
        "done": state["done"],
        "events": list(state["events"]),
        "results": list(state["results"]),
        "total_input_size": state["total_input_size"],
        "total_output_size": state["total_output_size"],
        "success_count": state["success_count"],
        "error_count": state["error_count"],
        "fallback_count": state["fallback_count"],
        "total_duration_ms": state["total_duration_ms"],
        "total_savings_pct": round(
            (1 - state["total_output_size"] / state["total_input_size"]) * 100
            if state["total_input_size"] > 0
            else 0,
            2,
        ),
    }


async def run_batch_job(
    job_id: str,
    conversion_pairs: list[tuple[Path, Path]],
    settings: ConversionSettings,
) -> None:
    """Process a batch job in the background while updating in-memory progress."""
    state = JOB_STATES[job_id]
    lock = JOB_LOCKS[job_id]
    sem = asyncio.Semaphore(settings.workers)

    async def emit(event: dict[str, Any]) -> None:
        async with lock:
            state["events"].append(event)

    async def start_file(filename: str) -> None:
        async with lock:
            state["active"] += 1
            state["queued"] = max(0, state["queued"] - 1)
            state["events"].append({
                "type": "file_started",
                "file": filename,
                "completed": state["completed"],
                "total": state["total"],
                "active": state["active"],
                "queued": state["queued"],
            })

    async def finish_file(result: ConversionResult) -> None:
        result_payload = result.model_dump()
        name = Path(result.input_path).name

        if result.error:
            log.error("  ✗ %s — %s", name, result.error)
        else:
            log.info("  ✓ %s  %.1f%% savings  %.0fms", name, result.savings_pct, result.duration_ms)

        async with lock:
            state["completed"] += 1
            state["active"] = max(0, state["active"] - 1)
            state["results"].append(result_payload)
            state["total_input_size"] += result.input_size
            state["total_output_size"] += result.output_size
            state["total_duration_ms"] += result.duration_ms

            if result.error:
                state["error_count"] += 1
            else:
                state["success_count"] += 1
                if Path(result.output_path).suffix.lower() != ".jxl":
                    state["fallback_count"] += 1

            state["events"].append({
                "type": "file_finished",
                "completed": state["completed"],
                "total": state["total"],
                "active": state["active"],
                "queued": state["queued"],
                "current_file": name,
                "result": result_payload,
            })

    async def process_one(inp: Path, outp: Path) -> None:
        async with sem:
            await start_file(inp.name)
            result = await asyncio.to_thread(convert_single, inp, outp, settings)
            await finish_file(result)

    try:
        await asyncio.gather(*(process_one(inp, outp) for inp, outp in conversion_pairs))
    except Exception as exc:
        log.exception("Unexpected batch task failure for %s", job_id)
        await emit({
            "type": "job_error",
            "message": str(exc),
        })
    finally:
        async with lock:
            state["done"] = True


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Start and stop background temp-job cleanup with the app lifecycle."""
    cleanup_work_dir()
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

    JOB_STATES[job_id] = {
        "total": total,
        "workers": settings.workers,
        "completed": 0,
        "active": 0,
        "queued": total,
        "done": False,
        "events": [{
            "type": "job_started",
            "job_id": job_id,
            "total": total,
            "workers": settings.workers,
        }],
        "results": [],
        "total_input_size": 0,
        "total_output_size": 0,
        "success_count": 0,
        "error_count": 0,
        "fallback_count": 0,
        "total_duration_ms": 0.0,
    }
    JOB_LOCKS[job_id] = asyncio.Lock()

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

app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
