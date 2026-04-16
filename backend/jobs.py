"""Tracked batch-job runtime helpers."""

from __future__ import annotations

import asyncio
import logging
import shutil
import tempfile
import time
import uuid
from datetime import datetime
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


def now_ms() -> int:
    return int(time.time() * 1000)


def stamp_event(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "ts_ms": now_ms(),
        **event,
    }


def format_elapsed_ms(duration_ms: float) -> str:
    total_seconds = max(0, int(round(duration_ms / 1000)))
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def format_processing_duration(duration_ms: float) -> str:
    if duration_ms < 1000:
        return f"{int(round(duration_ms))} ms"

    total_seconds = duration_ms / 1000
    if total_seconds < 60:
        return f"{total_seconds:.1f} s"

    return format_elapsed_ms(duration_ms)


def format_bytes(num_bytes: int) -> str:
    if num_bytes <= 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(num_bytes)
    unit_index = 0
    while size >= 1024 and unit_index < len(units) - 1:
        size /= 1024
        unit_index += 1
    precision = 0 if unit_index == 0 else 1
    return f"{size:.{precision}f} {units[unit_index]}"


def get_extension_label(path: str) -> str:
    suffix = Path(path).suffix.lower().lstrip(".")
    return suffix.upper() if suffix else "-"


def format_session_log_line(event: dict[str, Any]) -> str | None:
    ts_ms = event.get("ts_ms")
    stamp = datetime.fromtimestamp(ts_ms / 1000).strftime("%H:%M:%S") if ts_ms else "--:--:--"

    if event.get("type") == "job_started":
        return f"[{stamp}] Started batch {event.get('job_id', '')} with {event.get('workers', 0)} workers."

    if event.get("type") == "file_started":
        return f"[{stamp}] Processing {event.get('file', 'file')}..."

    if event.get("type") == "job_error":
        return f"[{stamp}] {event.get('message', 'Unexpected batch error.')}"

    if event.get("type") == "job_paused":
        return f"[{stamp}] Batch paused. Active files will finish before the queue stops."

    if event.get("type") == "job_resumed":
        return f"[{stamp}] Batch resumed."

    if event.get("type") == "job_cancel_requested":
        return f"[{stamp}] Cancellation requested. No new files will start."

    if event.get("type") == "job_cancelled":
        return f"[{stamp}] Batch cancelled after active files drained."

    if event.get("type") == "file_finished" and event.get("result"):
        result = event["result"]
        name = event.get("current_file") or result.get("input_path", "")
        processing_duration_ms = event.get("processing_duration_ms", result.get("duration_ms", 0))
        input_ext = get_extension_label(result.get("input_path", ""))
        output_ext = get_extension_label(result.get("output_path", ""))

        if result.get("error"):
            return f"[{stamp}] {name} [{input_ext}]: {result['error']}"

        if result.get("skipped"):
            return f"[{stamp}] {name} [{input_ext} -> SKIP]: skipped ({result.get('skip_reason') or 'no action needed'})."

        status_note = " fallback" if output_ext != "JXL" else ""

        return (
            f"[{stamp}] {name} [{input_ext} -> {output_ext}{status_note}]: "
            f"{format_bytes(result['input_size'])} -> {format_bytes(result['output_size'])} "
            f"({result['savings_pct']:.1f}%, {format_processing_duration(processing_duration_ms)})."
        )

    return None


def create_session_log(job_id: str, state: dict[str, Any]) -> str | None:
    output_dir_raw = state.get("output_dir")
    if state.get("job_kind") != "local" or not output_dir_raw:
        return None

    output_dir = Path(output_dir_raw)
    output_dir.mkdir(parents=True, exist_ok=True)
    started_at_ms = state.get("started_at_ms") or now_ms()
    timestamp = datetime.fromtimestamp(started_at_ms / 1000).strftime("%Y%m%d-%H%M%S")
    log_path = output_dir / f"jxl-session-{timestamp}-{job_id}.txt"
    log_path.write_text("", encoding="utf-8")
    return str(log_path)


def append_session_log_line(state: dict[str, Any], event: dict[str, Any]) -> None:
    log_path_raw = state.get("session_log_path")
    if not log_path_raw:
        return

    line = format_session_log_line(event)
    if not line:
        return

    Path(log_path_raw).open("a", encoding="utf-8").write(f"{line}\n")


def record_event(state: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    stamped = stamp_event(event)
    state["events"].append(stamped)
    append_session_log_line(state, stamped)
    return stamped


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
        "session_log_path": state.get("session_log_path"),
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
        "started_at_ms": state.get("started_at_ms"),
        "finished_at_ms": state.get("finished_at_ms"),
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
        "started_at_ms": now_ms(),
        "finished_at_ms": None,
        "paused": False,
        "cancel_requested": False,
        "cancelled": False,
        "session_log_path": None,
        "events": [],
        "results": [],
        "total_input_size": 0,
        "total_output_size": 0,
        "success_count": 0,
        "error_count": 0,
        "fallback_count": 0,
        "skipped_count": 0,
        "total_duration_ms": 0.0,
    }
    if job_kind == "local" and output_dir:
        JOB_STATES[job_id]["session_log_path"] = create_session_log(job_id, JOB_STATES[job_id])

    record_event(JOB_STATES[job_id], {
            "type": "job_started",
            "job_id": job_id,
            "total": total,
            "workers": workers,
        })
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
        record_event(state, {
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
            record_event(state, {
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
    active_started_at: dict[str, int] = {}
    for pair in conversion_pairs:
        work_queue.put_nowait(pair)

    async def emit(event: dict[str, Any]) -> None:
        async with lock:
            record_event(state, event)

    async def start_file(input_path: Path) -> None:
        started_at = now_ms()
        async with lock:
            active_started_at[str(input_path)] = started_at
            state["active"] += 1
            state["queued"] = work_queue.qsize()
            record_event(state, {
                "type": "file_started",
                "file": input_path.name,
                "completed": state["completed"],
                "total": state["total"],
                "active": state["active"],
                "queued": state["queued"],
            })

    async def finish_file(result: ConversionResult) -> None:
        result_payload = result.model_dump()
        name = Path(result.input_path).name
        processing_duration_ms = max(0, now_ms() - active_started_at.pop(result.input_path, now_ms()))

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

            record_event(state, {
                "type": "file_finished",
                "completed": state["completed"],
                "total": state["total"],
                "active": state["active"],
                "queued": work_queue.qsize() if not state["cancel_requested"] else 0,
                "current_file": name,
                "processing_duration_ms": processing_duration_ms,
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

            await start_file(inp)
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
                record_event(state, {
                    "type": "job_cancelled",
                    "job_id": job_id,
                })
            state["finished_at_ms"] = now_ms()
            state["done"] = True
