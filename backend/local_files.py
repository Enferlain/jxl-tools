"""Helpers for local filesystem browsing, selection, and native pickers."""

from __future__ import annotations

import os
from pathlib import Path
from string import ascii_uppercase
from typing import Any

from fastapi import HTTPException

from backend.converter import JXL_EXTENSIONS, SUPPORTED_INPUT_FORMATS
from backend.models import ConversionSettings

LOCAL_SUPPORTED_EXTENSIONS = SUPPORTED_INPUT_FORMATS | JXL_EXTENSIONS


def get_local_roots() -> list[dict[str, str]]:
    """Return filesystem roots suitable for the current platform."""
    roots: list[dict[str, str]] = []

    if os.name == "nt":
        for drive in ascii_uppercase:
            drive_path = Path(f"{drive}:/")
            if drive_path.exists():
                roots.append({"name": f"{drive}:", "path": str(drive_path)})
        return roots

    root = Path("/")
    home = Path.home()
    roots.append({"name": "Root", "path": str(root)})
    if home != root:
        roots.append({"name": "Home", "path": str(home)})
    return roots


def resolve_local_path(path_str: str | None) -> Path:
    """Expand and validate a local filesystem path for browser-driven browsing."""
    candidate = Path(path_str).expanduser() if path_str else Path.home()

    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError as exc:
        raise HTTPException(404, f"Path not found: {candidate}") from exc
    except OSError as exc:
        raise HTTPException(400, f"Invalid path: {candidate}") from exc

    return resolved


def list_local_path(path: Path) -> dict[str, Any]:
    """Return a browsable listing of directories plus supported files."""
    if not path.is_dir():
        raise HTTPException(400, "Browse path must be a directory")

    try:
        children = sorted(path.iterdir(), key=lambda child: (not child.is_dir(), child.name.lower()))
    except PermissionError as exc:
        raise HTTPException(403, f"Permission denied: {path}") from exc

    directories: list[dict[str, Any]] = []
    files: list[dict[str, Any]] = []
    hidden_unsupported = 0

    for child in children:
        try:
            if child.is_dir():
                directories.append({
                    "name": child.name or str(child),
                    "path": str(child),
                })
                continue

            if not child.is_file():
                continue
        except PermissionError:
            continue

        ext = child.suffix.lower()
        if ext not in LOCAL_SUPPORTED_EXTENSIONS:
            hidden_unsupported += 1
            continue

        try:
            size = child.stat().st_size
        except OSError:
            size = 0

        files.append({
            "name": child.name,
            "path": str(child),
            "size": size,
            "extension": ext.lstrip("."),
        })

    parent_path = str(path.parent) if path.parent != path else None

    return {
        "current_path": str(path),
        "parent_path": parent_path,
        "roots": get_local_roots(),
        "directories": directories,
        "files": files,
        "hidden_unsupported_count": hidden_unsupported,
    }


def collect_supported_files(path: Path, recursive: bool = True) -> list[Path]:
    """Return supported image files from a path, optionally recursively for directories."""
    if path.is_file():
        return [path] if path.suffix.lower() in LOCAL_SUPPORTED_EXTENSIONS else []

    try:
        iterator = path.rglob("*") if recursive else path.iterdir()
        files = [child for child in iterator if child.is_file() and child.suffix.lower() in LOCAL_SUPPORTED_EXTENSIONS]
    except PermissionError as exc:
        raise HTTPException(403, f"Permission denied while scanning: {path}") from exc

    return sorted(files, key=lambda child: str(child).lower())


def build_local_selection(paths: list[str], recursive: bool = True) -> dict[str, Any]:
    """Group selected local files into a tree plus aggregate breakdowns."""
    if not paths:
        raise HTTPException(400, "Select at least one local path")

    grouped_files: dict[str, dict[str, Any]] = {}
    extension_totals: dict[str, dict[str, Any]] = {}
    seen_paths: set[str] = set()
    total_size = 0
    total_count = 0

    resolved_paths = [resolve_local_path(path_str) for path_str in paths]

    for selected_path in resolved_paths:
        if selected_path.is_dir():
            group_root = selected_path
            files = collect_supported_files(selected_path, recursive=recursive)
        else:
            group_root = selected_path.parent
            files = collect_supported_files(selected_path, recursive=recursive)

        group_key = str(group_root)
        group = grouped_files.setdefault(
            group_key,
            {
                "folder_name": group_root.name or str(group_root),
                "folder_path": str(group_root),
                "selection_kind": "folder" if selected_path.is_dir() else "files",
                "recursive": recursive,
                "files": [],
            },
        )

        for file_path in files:
            file_key = str(file_path)
            if file_key in seen_paths:
                continue

            seen_paths.add(file_key)

            try:
                size = file_path.stat().st_size
            except OSError:
                size = 0

            relative_path = (
                str(file_path.relative_to(group_root))
                if file_path.is_relative_to(group_root)
                else file_path.name
            )

            ext = file_path.suffix.lower().lstrip(".") or "(none)"
            group["files"].append({
                "name": file_path.name,
                "path": file_key,
                "relative_path": relative_path,
                "size": size,
                "extension": ext,
            })

            bucket = extension_totals.setdefault(ext, {"extension": ext, "count": 0, "size": 0})
            bucket["count"] += 1
            bucket["size"] += size
            total_count += 1
            total_size += size

    groups: list[dict[str, Any]] = []
    for group in sorted(grouped_files.values(), key=lambda item: item["folder_path"].lower()):
        group["files"].sort(key=lambda item: item["relative_path"].lower())
        group["file_count"] = len(group["files"])
        group["total_size"] = sum(item["size"] for item in group["files"])
        group["folder_count"] = len({
            str(Path(item["relative_path"]).parent)
            for item in group["files"]
            if Path(item["relative_path"]).parent != Path(".")
        })
        groups.append(group)

    extensions = sorted(
        extension_totals.values(),
        key=lambda item: (-item["count"], -item["size"], item["extension"]),
    )

    for item in extensions:
        item["percent"] = (item["size"] / total_size * 100) if total_size else 0.0

    return {
        "groups": groups,
        "totals": {
            "file_count": total_count,
            "total_size": total_size,
        },
        "extensions": extensions,
        "recursive": recursive,
    }


def get_output_extension(input_path: Path, settings: ConversionSettings) -> str:
    """Return the output extension for a source file under the chosen settings."""
    if input_path.suffix.lower() == ".jxl":
        if settings.output_format.value == "jpeg":
            return ".jpg"
        return f".{settings.output_format.value}"

    return ".jxl"


def ensure_unique_output_path(output_path: Path, reserved_paths: set[Path]) -> Path:
    """Avoid overwriting outputs when multiple inputs collapse to the same filename."""
    candidate = output_path
    counter = 1
    while candidate in reserved_paths or candidate.exists():
        candidate = output_path.with_name(f"{output_path.stem}-{counter}{output_path.suffix}")
        counter += 1

    reserved_paths.add(candidate)
    return candidate


def build_local_conversion_pairs(
    paths: list[str],
    output_dir: str,
    settings: ConversionSettings,
) -> tuple[Path, list[tuple[Path, Path]]]:
    """Resolve local inputs into concrete conversion pairs for a batch job."""
    if not paths:
        raise HTTPException(400, "Select at least one local path")

    resolved_output_dir = Path(output_dir).expanduser().resolve(strict=False)
    resolved_output_dir.mkdir(parents=True, exist_ok=True)

    resolved_paths = [resolve_local_path(path_str) for path_str in paths]
    conversion_pairs: list[tuple[Path, Path]] = []
    seen_inputs: set[Path] = set()
    reserved_outputs: set[Path] = set()

    for selected_path in resolved_paths:
        files = collect_supported_files(selected_path, recursive=settings.recursive)
        group_root = selected_path if selected_path.is_dir() else selected_path.parent

        for input_path in files:
            if input_path in seen_inputs:
                continue
            seen_inputs.add(input_path)

            output_ext = get_output_extension(input_path, settings)

            if settings.mirror_structure:
                relative_source = (
                    input_path.relative_to(group_root)
                    if selected_path.is_dir()
                    else Path(input_path.name)
                )
                output_path = resolved_output_dir / relative_source
                output_path = output_path.with_suffix(output_ext)
            else:
                output_path = resolved_output_dir / f"{input_path.stem}{output_ext}"

            output_path.parent.mkdir(parents=True, exist_ok=True)
            unique_output_path = ensure_unique_output_path(output_path, reserved_outputs)
            conversion_pairs.append((input_path, unique_output_path))

    if not conversion_pairs:
        raise HTTPException(400, "No supported files were found in the selected local paths")

    return resolved_output_dir, conversion_pairs


def show_native_picker(kind: str) -> list[str]:
    """Open a native local file/folder dialog and return absolute paths."""
    if os.name != "nt" and not os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY"):
        raise RuntimeError("No local desktop session is available for a native picker.")

    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:
        raise RuntimeError("Tk file dialogs are not available in this Python environment.") from exc

    root = tk.Tk()
    root.withdraw()

    try:
        root.attributes("-topmost", True)
    except Exception:
        pass

    root.update_idletasks()

    supported_patterns = " ".join(sorted(f"*{ext}" for ext in LOCAL_SUPPORTED_EXTENSIONS))
    filetypes = [
        ("Supported images", supported_patterns),
        ("All files", "*.*"),
    ]

    try:
        if kind == "source_files":
            selection = list(
                filedialog.askopenfilenames(
                    title="Select source files",
                    filetypes=filetypes,
                )
            )
        elif kind == "source_folder":
            chosen = filedialog.askdirectory(
                title="Select source folder",
                mustexist=True,
            )
            selection = [chosen] if chosen else []
        elif kind == "target_folder":
            chosen = filedialog.askdirectory(
                title="Select output folder",
                mustexist=False,
            )
            selection = [chosen] if chosen else []
        else:
            raise RuntimeError(f"Unsupported picker kind: {kind}")
    finally:
        root.destroy()

    resolved: list[str] = []
    for raw_path in selection:
        if not raw_path:
            continue

        path = Path(raw_path).expanduser()
        try:
            resolved_path = path.resolve(strict=kind != "target_folder")
        except FileNotFoundError:
            resolved_path = path.resolve(strict=False)
        resolved.append(str(resolved_path))

    return resolved
