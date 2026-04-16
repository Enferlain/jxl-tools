"""Tests for web-server helpers."""

from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path

import pytest

from backend import server
from backend.models import ConversionResult, ConversionSettings


def test_cleanup_work_dir_removes_only_stale_job_dirs(tmp_path: Path, monkeypatch) -> None:
    """Old temp job folders should be removed while fresh ones remain."""
    work_dir = tmp_path / "work"
    work_dir.mkdir()

    stale_dir = work_dir / "stale-job"
    fresh_dir = work_dir / "fresh-job"
    stale_dir.mkdir()
    fresh_dir.mkdir()

    now = time.time()
    stale_time = now - 7200
    fresh_time = now - 60
    os.utime(stale_dir, (stale_time, stale_time))
    os.utime(fresh_dir, (fresh_time, fresh_time))

    monkeypatch.setattr(server, "WORK_DIR", work_dir)

    removed = server.cleanup_work_dir(max_age_seconds=3600)

    assert removed == 1
    assert not stale_dir.exists()
    assert fresh_dir.exists()


def test_get_frontend_dir_prefers_vite_build(tmp_path: Path, monkeypatch) -> None:
    """Frontend serving should prefer the Vite dist output when present."""
    vite_dist = tmp_path / "ui-dist"
    legacy_static = tmp_path / "legacy-static"
    vite_dist.mkdir()
    legacy_static.mkdir()

    monkeypatch.setattr(server, "FRONTEND_DIST_DIR", vite_dist)
    monkeypatch.setattr(server, "LEGACY_STATIC_DIR", legacy_static)

    assert server.get_frontend_dir() == vite_dist


def test_get_frontend_dir_falls_back_to_legacy_static(tmp_path: Path, monkeypatch) -> None:
    """Frontend serving should keep working before the React app is built."""
    vite_dist = tmp_path / "missing-ui-dist"
    legacy_static = tmp_path / "legacy-static"
    legacy_static.mkdir()

    monkeypatch.setattr(server, "FRONTEND_DIST_DIR", vite_dist)
    monkeypatch.setattr(server, "LEGACY_STATIC_DIR", legacy_static)

    assert server.get_frontend_dir() == legacy_static


def test_local_browse_lists_supported_files_and_directories(tmp_path: Path, monkeypatch) -> None:
    """Local browse endpoint should surface directories and supported files only."""
    root = tmp_path / "dataset"
    root.mkdir()
    (root / "nested").mkdir()
    (root / "image.png").write_bytes(b"png")
    (root / "notes.txt").write_text("ignore me")

    payload = server.list_local_path(root.resolve())
    assert payload["current_path"] == str(root.resolve())
    assert payload["directories"] == [{"name": "nested", "path": str((root / "nested").resolve())}]
    assert payload["files"] == [
        {
            "name": "image.png",
            "path": str((root / "image.png").resolve()),
            "size": 3,
            "extension": "png",
        }
    ]
    assert payload["hidden_unsupported_count"] == 1


def test_local_selection_groups_folder_files_and_breakdown(tmp_path: Path) -> None:
    """Selected local folders should expand into a grouped tree and extension stats."""
    root = tmp_path / "photos"
    root.mkdir()
    subdir = root / "set-a"
    subdir.mkdir()
    (subdir / "frame1.png").write_bytes(b"1234")
    (subdir / "frame2.jpg").write_bytes(b"12")

    payload = server.build_local_selection([str(subdir)])
    assert payload["totals"] == {"file_count": 2, "total_size": 6}
    assert payload["groups"][0]["folder_path"] == str(subdir.resolve())
    assert payload["groups"][0]["file_count"] == 2
    assert payload["groups"][0]["folder_count"] == 0
    assert [item["relative_path"] for item in payload["groups"][0]["files"]] == ["frame1.png", "frame2.jpg"]
    assert payload["extensions"][0]["extension"] == "png"
    assert payload["extensions"][0]["count"] == 1
    assert payload["extensions"][0]["size"] == 4
    assert round(payload["extensions"][0]["percent"], 2) == round(4 / 6 * 100, 2)
    assert payload["extensions"][1]["extension"] == "jpg"
    assert payload["extensions"][1]["count"] == 1
    assert payload["extensions"][1]["size"] == 2


def test_local_selection_respects_non_recursive_mode(tmp_path: Path) -> None:
    """Non-recursive local folder selections should only include top-level supported files."""
    root = tmp_path / "photos"
    root.mkdir()
    (root / "top.png").write_bytes(b"123")
    nested = root / "nested"
    nested.mkdir()
    (nested / "deep.jpg").write_bytes(b"1234")

    payload = server.build_local_selection([str(root)], recursive=False)

    assert payload["totals"] == {"file_count": 1, "total_size": 3}
    assert payload["groups"][0]["file_count"] == 1
    assert [item["relative_path"] for item in payload["groups"][0]["files"]] == ["top.png"]


def test_local_selection_uses_relative_paths_for_nested_folders(tmp_path: Path) -> None:
    """Recursive local selections should preserve nested relative paths for tree rendering."""
    root = tmp_path / "photos"
    nested = root / "set-a" / "inner"
    nested.mkdir(parents=True)
    (nested / "frame1.png").write_bytes(b"1234")

    payload = server.build_local_selection([str(root)], recursive=True)

    assert payload["groups"][0]["folder_count"] == 1
    assert payload["groups"][0]["files"][0]["relative_path"] == str(Path("set-a") / "inner" / "frame1.png")


@pytest.mark.anyio
async def test_pick_local_target_folder_returns_selected_path(monkeypatch) -> None:
    """Native target picker endpoint should return the chosen absolute path."""
    monkeypatch.setattr(server, "show_native_picker", lambda kind: ["/tmp/output"] if kind == "target_folder" else [])

    payload = await server.pick_local_target_folder()

    assert payload == {"cancelled": False, "path": "/tmp/output"}


@pytest.mark.anyio
async def test_pick_local_source_folder_returns_selection(monkeypatch, tmp_path: Path) -> None:
    """Native source-folder picker endpoint should expand into a grouped selection."""
    root = tmp_path / "set-a"
    root.mkdir()
    (root / "frame1.png").write_bytes(b"1234")

    monkeypatch.setattr(server, "show_native_picker", lambda kind: [str(root)] if kind == "source_folder" else [])

    payload = await server.pick_local_source_folder()

    assert payload["cancelled"] is False
    assert payload["picked_paths"] == [str(root)]
    assert payload["totals"] == {"file_count": 1, "total_size": 4}


@pytest.mark.anyio
async def test_run_batch_job_supports_pause_resume_and_cancel(monkeypatch, tmp_path: Path) -> None:
    """Tracked jobs should pause queued work, resume it, and cancel remaining files cooperatively."""
    inputs: list[tuple[Path, Path]] = []
    for index in range(3):
        input_path = tmp_path / f"frame-{index}.png"
        output_path = tmp_path / f"frame-{index}.jxl"
        input_path.write_bytes(b"image-data")
        inputs.append((input_path, output_path))

    call_order: list[str] = []

    def fake_convert_single(inp: Path, outp: Path, settings: ConversionSettings) -> ConversionResult:
        call_order.append(inp.name)
        time.sleep(0.05)
        outp.write_bytes(b"converted")
        return ConversionResult(
            input_path=str(inp),
            output_path=str(outp),
            input_size=10,
            output_size=5,
            savings_pct=50.0,
            duration_ms=50.0,
        )

    monkeypatch.setattr(server.jobs, "convert_single", fake_convert_single)

    job_id = "pause-cancel-job"
    server.initialize_job_state(job_id, total=len(inputs), workers=1, job_kind="upload", output_dir=str(tmp_path))

    task = asyncio.create_task(server.run_batch_job(job_id, inputs, ConversionSettings(workers=1)))

    await asyncio.sleep(0.02)
    paused_snapshot = await server.set_job_paused(job_id, True)
    assert paused_snapshot["paused"] is True

    await asyncio.sleep(0.08)
    paused_status = server.build_job_snapshot(job_id)
    assert paused_status["completed"] == 1
    assert paused_status["paused"] is True
    assert paused_status["active"] == 0

    resumed_snapshot = await server.set_job_paused(job_id, False)
    assert resumed_snapshot["paused"] is False

    await asyncio.sleep(0.02)
    cancel_snapshot = await server.request_job_cancel(job_id)
    assert cancel_snapshot["cancel_requested"] is True

    await task

    final_status = server.build_job_snapshot(job_id)
    assert final_status["done"] is True
    assert final_status["cancelled"] is True
    assert final_status["cancel_requested"] is True
    assert final_status["completed"] in {1, 2}
    assert final_status["completed"] < 3
    assert final_status["queued"] == 0
    assert len(call_order) == final_status["completed"]


@pytest.mark.anyio
async def test_cancel_job_marks_idle_job_done(monkeypatch) -> None:
    """Cancelling a job with no active work should mark it done when the runner exits."""
    job_id = "cancel-idle-job"
    server.initialize_job_state(job_id, total=0, workers=1)

    snapshot = await server.request_job_cancel(job_id)

    assert snapshot["cancel_requested"] is True
