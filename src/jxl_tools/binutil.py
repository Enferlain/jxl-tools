"""Resolve bundled cjxl/djxl binaries with PATH fallback."""

from __future__ import annotations

import logging
import platform
import shutil
import stat
from pathlib import Path

log = logging.getLogger(__name__)

_VENDOR_DIR = Path(__file__).parent / "_vendor"
# Dev mode: binaries are at repo root vendor/, not inside the package
_DEV_VENDOR_DIR = Path(__file__).parent.parent.parent / "vendor"


def _get_bundled_path(name: str) -> Path | None:
    """Return the path to a bundled binary, or None if not available."""
    system = platform.system().lower()

    if system == "windows":
        suffix = "windows"
        exe = f"{name}.exe"
    elif system == "linux":
        suffix = "linux"
        exe = name
    else:
        return None

    # Check installed _vendor/ first (wheel install), then repo-root vendor/ (dev)
    for base in (_VENDOR_DIR, _DEV_VENDOR_DIR):
        candidate = base / suffix / exe
        if candidate.exists():
            # Ensure the binary is executable (Linux)
            if system == "linux" and not (candidate.stat().st_mode & stat.S_IXUSR):
                candidate.chmod(candidate.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
            return candidate

    return None


def get_tool_path(name: str) -> str | None:
    """Find cjxl/djxl: check PATH first, then bundled vendor binaries.

    Returns the absolute path to the tool, or None if not found anywhere.
    """
    # 1. System PATH — respect user's own install
    found = shutil.which(name)
    if found:
        log.debug("Found %s on PATH: %s", name, found)
        return found

    # 2. Bundled binary
    bundled = _get_bundled_path(name)
    if bundled:
        log.debug("Found bundled %s: %s", name, bundled)
        return str(bundled)

    return None
