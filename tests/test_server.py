"""Tests for web-server helpers."""

from __future__ import annotations

import os
import time
from pathlib import Path

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
