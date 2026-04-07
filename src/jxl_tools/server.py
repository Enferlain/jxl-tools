"""FastAPI server — serves the web UI and conversion API."""

from __future__ import annotations

import asyncio
import io
import json
import logging
import tempfile
import uuid
import zipfile
from pathlib import Path


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

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

STATIC_DIR = Path(__file__).parent / "static"
WORK_DIR = Path(tempfile.gettempdir()) / "jxl-tools-work"
WORK_DIR.mkdir(exist_ok=True)

app = FastAPI(
    title="JXL Tools",
    version="0.1.0",
    docs_url="/api/docs",
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
    job_id = uuid.uuid4().hex[:12]
    job_dir = WORK_DIR / job_id
    input_dir = job_dir / "input"
    output_dir = job_dir / "output"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Save uploaded file
    assert file.filename is not None
    input_path = input_dir / file.filename
    with open(input_path, "wb") as f:
        content = await file.read()
        f.write(content)

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
    """Convert multiple uploaded files with parallel processing."""
    try:
        settings_dict = json.loads(settings_json)
        settings = ConversionSettings(**settings_dict)
    except Exception as e:
        raise HTTPException(400, f"Invalid settings: {e}")

    job_id = uuid.uuid4().hex[:12]
    job_dir = WORK_DIR / job_id
    input_dir = job_dir / "input"
    output_dir = job_dir / "output"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Phase 1: Save all uploaded files to disk
    conversion_pairs: list[tuple[Path, Path]] = []
    for upload in files:
        if not upload.filename:
            continue

        input_path = input_dir / upload.filename
        with open(input_path, "wb") as f:
            content = await upload.read()
            f.write(content)

        suffix = input_path.suffix.lower()
        if suffix == ".jxl":
            out_ext = f".{settings.output_format.value}"
            if out_ext == ".jpeg":
                out_ext = ".jpg"
        else:
            out_ext = ".jxl"

        output_path = output_dir / (input_path.stem + out_ext)
        conversion_pairs.append((input_path, output_path))

    # Phase 2: Convert all files concurrently with bounded parallelism
    sem = asyncio.Semaphore(settings.workers)

    async def _convert_one(inp: Path, outp: Path) -> ConversionResult:
        async with sem:
            return await asyncio.to_thread(convert_single, inp, outp, settings)

    results_list = await asyncio.gather(
        *[_convert_one(inp, outp) for inp, outp in conversion_pairs]
    )

    total_input = sum(r.input_size for r in results_list)
    total_output = sum(r.output_size for r in results_list)

    return {
        "job_id": job_id,
        "results": [r.model_dump() for r in results_list],
        "total_input_size": total_input,
        "total_output_size": total_output,
        "total_savings_pct": round(
            (1 - total_output / total_input) * 100 if total_input > 0 else 0, 2
        ),
    }


# ---------------------------------------------------------------------------
# File serving
# ---------------------------------------------------------------------------

@app.get("/api/preview/{job_id}/{filename}")
async def preview_file(job_id: str, filename: str):
    """Serve a converted file for preview."""
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
