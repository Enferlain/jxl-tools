"""Tracked batch-job runtime helpers."""

from __future__ import annotations

import asyncio
import logging
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend.converter import convert_single
from backend.models import ConversionResult, ConversionSettings

log = logging.getLogger(__name__)

WORK_DIR = Path(tempfile.gettempdir()) / "jxl-tools-work"
WORK_DIR.mkdir(exist_ok=True)
JOB_TTL_SECONDS = 60 * 60
JOB_CLEANUP_INTERVAL_SECONDS = 5 * 60
JOB_STATES: dict[str, dict[str, Any]] = {}
JOB_LOCKS: dict[str, asyncio.Lock] = {}
JOB_CONTROLS: dict[str, dict[str, asyncio.Event]] = {}


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
        JOB_CONTROLS.pop(child.name, None)
        removed += 1

    return removed


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
        "job_kind": state.get("job_kind", "upload"),
        "output_dir": state.get("output_dir"),
        "total": state["total"],
        "workers": state["workers"],
        "completed": state["completed"],
        "active": state["active"],
        "queued": state["queued"],
        "done": state["done"],
        "paused": state.get("paused", False),
        "cancel_requested": state.get("cancel_requested", False),
        "cancelled": state.get("cancelled", False),
        "events": list(state["events"]),
        "results": list(state["results"]),
        "total_input_size": state["total_input_size"],
        "total_output_size": state["total_output_size"],
        "success_count": state["success_count"],
        "error_count": state["error_count"],
        "fallback_count": state["fallback_count"],
        "skipped_count": state.get("skipped_count", 0),
        "total_duration_ms": state["total_duration_ms"],
        "total_savings_pct": round(
            (1 - state["total_output_size"] / state["total_input_size"]) * 100
            if state["total_input_size"] > 0
            else 0,
            2,
        ),
    }


def create_job_control() -> dict[str, asyncio.Event]:
    """Create cooperative pause/cancel primitives for a tracked job."""
    pause_event = asyncio.Event()
    pause_event.set()
    cancel_event = asyncio.Event()
    return {
        "pause_event": pause_event,
        "cancel_event": cancel_event,
    }


def initialize_job_state(
    job_id: str,
    *,
    total: int,
    workers: int,
    job_kind: str = "upload",
    output_dir: str | None = None,
) -> None:
    """Create tracked state, lock, and control primitives for a new job."""
    JOB_STATES[job_id] = {
        "job_kind": job_kind,
        "output_dir": output_dir,
        "total": total,
        "workers": workers,
        "completed": 0,
        "active": 0,
        "queued": total,
        "done": False,
        "paused": False,
        "cancel_requested": False,
        "cancelled": False,
        "events": [{
            "type": "job_started",
            "job_id": job_id,
            "total": total,
            "workers": workers,
        }],
        "results": [],
        "total_input_size": 0,
        "total_output_size": 0,
        "success_count": 0,
        "error_count": 0,
        "fallback_count": 0,
        "skipped_count": 0,
        "total_duration_ms": 0.0,
    }
    JOB_LOCKS[job_id] = asyncio.Lock()
    JOB_CONTROLS[job_id] = create_job_control()


async def set_job_paused(job_id: str, paused: bool) -> dict[str, Any]:
    """Pause or resume a tracked job cooperatively."""
    state = JOB_STATES.get(job_id)
    if state is None:
        raise HTTPException(404, "Job not found")

    lock = JOB_LOCKS[job_id]
    controls = JOB_CONTROLS[job_id]

    async with lock:
        if state["done"]:
            return build_job_snapshot(job_id)

        if state["cancel_requested"] and paused:
            raise HTTPException(409, "Cannot pause a job that is already cancelling")

        if state.get("paused", False) == paused:
            return build_job_snapshot(job_id)

        state["paused"] = paused
        state["events"].append({
            "type": "job_paused" if paused else "job_resumed",
            "job_id": job_id,
        })

    if paused:
        controls["pause_event"].clear()
    else:
        controls["pause_event"].set()

    return build_job_snapshot(job_id)


async def request_job_cancel(job_id: str) -> dict[str, Any]:
    """Stop a job from starting any more files and mark it cancelled when active work drains."""
    state = JOB_STATES.get(job_id)
    if state is None:
        raise HTTPException(404, "Job not found")

    lock = JOB_LOCKS[job_id]
    controls = JOB_CONTROLS[job_id]

    async with lock:
        if state["done"]:
            return build_job_snapshot(job_id)

        if not state["cancel_requested"]:
            state["cancel_requested"] = True
            state["paused"] = False
            state["queued"] = 0
            state["events"].append({
                "type": "job_cancel_requested",
                "job_id": job_id,
            })

    controls["cancel_event"].set()
    controls["pause_event"].set()

    return build_job_snapshot(job_id)


async def run_batch_job(
    job_id: str,
    conversion_pairs: list[tuple[Path, Path]],
    settings: ConversionSettings,
) -> None:
    """Process a batch job in the background while updating in-memory progress."""
    state = JOB_STATES[job_id]
    lock = JOB_LOCKS[job_id]
    controls = JOB_CONTROLS[job_id]
    pause_event = controls["pause_event"]
    cancel_event = controls["cancel_event"]
    work_queue: asyncio.Queue[tuple[Path, Path]] = asyncio.Queue()
    for pair in conversion_pairs:
        work_queue.put_nowait(pair)

    async def emit(event: dict[str, Any]) -> None:
        async with lock:
            state["events"].append(event)

    async def start_file(filename: str) -> None:
        async with lock:
            state["active"] += 1
            state["queued"] = work_queue.qsize()
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
        elif result.skipped:
            log.info("  ↷ %s — skipped (%s)", name, result.skip_reason or "no action needed")
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
            elif result.skipped:
                state["skipped_count"] += 1
            else:
                state["success_count"] += 1
                if Path(result.output_path).suffix.lower() != ".jxl":
                    state["fallback_count"] += 1

            state["events"].append({
                "type": "file_finished",
                "completed": state["completed"],
                "total": state["total"],
                "active": state["active"],
                "queued": work_queue.qsize() if not state["cancel_requested"] else 0,
                "current_file": name,
                "result": result_payload,
            })

    async def worker_loop() -> None:
        while True:
            if cancel_event.is_set():
                return

            await pause_event.wait()

            if cancel_event.is_set():
                return

            try:
                inp, outp = work_queue.get_nowait()
            except asyncio.QueueEmpty:
                return

            await start_file(inp.name)
            try:
                result = await asyncio.to_thread(convert_single, inp, outp, settings)
                await finish_file(result)
            finally:
                work_queue.task_done()

    try:
        workers = min(settings.workers, max(1, len(conversion_pairs)))
        await asyncio.gather(*(worker_loop() for _ in range(workers)))
    except Exception as exc:
        log.exception("Unexpected batch task failure for %s", job_id)
        await emit({
            "type": "job_error",
            "message": str(exc),
        })
    finally:
        async with lock:
            if cancel_event.is_set():
                state["cancelled"] = True
                state["queued"] = 0
                state["paused"] = False
                state["events"].append({
                    "type": "job_cancelled",
                    "job_id": job_id,
                })
            state["done"] = True
