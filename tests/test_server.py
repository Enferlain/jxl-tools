"""Tests for web-server helpers."""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from jxl_tools import server


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
