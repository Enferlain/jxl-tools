"""Tests for round-trip conversion and concurrent batch processing."""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

import pytest

from jxl_tools.converter import convert_batch_sync, convert_single
from jxl_tools.models import ConversionDirection, ConversionSettings, OutputFormat

ASSETS_DIR = Path(__file__).parent / "assets"
# Collect every image file across all asset subdirectories
ASSET_FILES = sorted(
    f
    for f in ASSETS_DIR.rglob("*")
    if f.is_file() and f.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".tiff", ".bmp"}
)


@pytest.fixture()
def tmp_out(tmp_path: Path) -> Path:
    """Return a clean temporary output directory."""
    out = tmp_path / "output"
    out.mkdir()
    return out


# ------------------------------------------------------------------
# Round-trip: source → JXL → original format
# ------------------------------------------------------------------

class TestRoundTrip:
    """Convert each asset to JXL, then back to its original format."""

    @pytest.mark.parametrize("src", ASSET_FILES, ids=lambda p: p.name)
    def test_to_jxl_and_back(self, src: Path, tmp_out: Path):
        settings = ConversionSettings(quality=90, effort=3)

        # Step 1: source → JXL
        jxl_path = tmp_out / (src.stem + ".jxl")
        r1 = convert_single(src, jxl_path, settings)

        assert r1.error is None, f"to-JXL failed: {r1.error}"
        assert jxl_path.exists()
        assert r1.output_size > 0

        # Step 2: JXL → original format
        ext = src.suffix.lower()
        if ext in {".jpg", ".jpeg"}:
            out_fmt = OutputFormat.JPEG
            back_ext = ".jpg"
        elif ext == ".webp":
            out_fmt = OutputFormat.WEBP
            back_ext = ".webp"
        else:
            out_fmt = OutputFormat.PNG
            back_ext = ".png"

        settings_back = ConversionSettings(
            quality=90,
            effort=3,
            output_format=out_fmt,
        )
        back_path = tmp_out / (src.stem + "_back" + back_ext)
        r2 = convert_single(jxl_path, back_path, settings_back)

        assert r2.error is None, f"from-JXL failed: {r2.error}"
        assert back_path.exists()
        assert r2.output_size > 0


# ------------------------------------------------------------------
# Batch concurrency
# ------------------------------------------------------------------

class TestBatchConcurrency:
    """Verify batch conversion runs files in parallel and completes correctly."""

    def _prepare_batch_dir(self, tmp_out: Path, name: str = "batch_input") -> Path:
        """Copy all assets into a flat directory for batch conversion."""
        batch_in = tmp_out / name
        batch_in.mkdir(parents=True, exist_ok=False)
        for f in ASSET_FILES:
            shutil.copy2(f, batch_in / f.name)
        return batch_in

    def test_batch_converts_all_files(self, tmp_out: Path):
        """All files should be converted without errors."""
        batch_in = self._prepare_batch_dir(tmp_out)
        batch_out = tmp_out / "batch_output"

        settings = ConversionSettings(
            quality=85,
            effort=1,
            direction=ConversionDirection.TO_JXL,
        )

        result = convert_batch_sync(batch_in, batch_out, settings)

        assert result.done
        assert result.total == len(ASSET_FILES)
        assert result.completed == len(ASSET_FILES)

        errors = [r for r in result.results if r.error]
        assert len(errors) == 0, f"Batch errors: {[r.error for r in errors]}"

        # Every output file must exist
        for r in result.results:
            assert Path(r.output_path).exists(), f"Missing output: {r.output_path}"
            assert r.output_size > 0

    def test_multi_worker_faster_than_single(self, tmp_out: Path):
        """Batch with multiple workers should not be slower than sequential.

        We run the batch twice — once with 1 worker, once with max workers —
        and confirm the parallel run completes (correctness is the main goal;
        the timing assertion is lenient to avoid flakiness on slow CI).
        """
        # --- Single worker ---
        batch_in_1 = self._prepare_batch_dir(tmp_out)
        batch_out_1 = tmp_out / "out_single"

        settings_1 = ConversionSettings(
            quality=85, effort=1,
            direction=ConversionDirection.TO_JXL,
            workers=1,
        )

        t0 = time.perf_counter()
        r1 = convert_batch_sync(batch_in_1, batch_out_1, settings_1)
        t_single = time.perf_counter() - t0

        assert r1.done
        assert all(r.error is None for r in r1.results)

        # --- Multi worker ---
        batch_in_n = self._prepare_batch_dir(tmp_out, name="batch_input_multi")
        batch_out_n = tmp_out / "out_multi"

        cpu_count = min(os.cpu_count() or 4, 16)
        settings_n = ConversionSettings(
            quality=85, effort=1,
            direction=ConversionDirection.TO_JXL,
            workers=cpu_count,
        )

        t0 = time.perf_counter()
        rn = convert_batch_sync(batch_in_n, batch_out_n, settings_n)
        t_multi = time.perf_counter() - t0

        assert rn.done
        assert all(r.error is None for r in rn.results)
        assert rn.completed == r1.completed

        # Lenient check: multi should not be ≥2x slower than single
        # (this mostly validates correctness, not strict speedup)
        assert t_multi < t_single * 2.0, (
            f"Multi-worker ({cpu_count}w) took {t_multi:.2f}s vs "
            f"single-worker {t_single:.2f}s — unexpectedly slow"
        )

        print(
            f"\n  Single-worker: {t_single:.2f}s"
            f"\n  Multi-worker ({cpu_count}w): {t_multi:.2f}s"
            f"\n  Speedup: {t_single / t_multi:.2f}x"
        )

    def test_batch_progress_callback(self, tmp_out: Path):
        """The progress callback should fire once per file."""
        batch_in = self._prepare_batch_dir(tmp_out)
        batch_out = tmp_out / "out_progress"

        settings = ConversionSettings(
            quality=85, effort=1,
            direction=ConversionDirection.TO_JXL,
        )

        progress_calls: list[int] = []

        def _on_progress(p):
            progress_calls.append(p.completed)

        result = convert_batch_sync(batch_in, batch_out, settings, on_progress=_on_progress)

        assert result.done
        assert len(progress_calls) == len(ASSET_FILES)
        # Completed counts should be monotonically increasing
        assert progress_calls == sorted(progress_calls)
        assert progress_calls[-1] == len(ASSET_FILES)
