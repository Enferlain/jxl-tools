"""CLI interface for JXL Tools."""

from __future__ import annotations

import sys
from pathlib import Path

import click
from rich.console import Console
from rich.progress import BarColumn, Progress, SpinnerColumn, TextColumn, TimeElapsedColumn
from rich.table import Table

from jxl_tools.converter import (
    cjxl_available,
    convert_batch_sync,
    convert_single,
    get_image_info,
)
from jxl_tools.models import ConversionDirection, ConversionSettings, OutputFormat

console = Console()


def _format_size(size_bytes: int) -> str:
    """Format bytes as human-readable size."""
    for unit in ("B", "KB", "MB", "GB"):
        if abs(size_bytes) < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024  # type: ignore[assignment]
    return f"{size_bytes:.1f} TB"


@click.group()
@click.version_option(package_name="jxl-tools")
def cli():
    """JXL Tools — JPEG XL conversion suite."""
    pass


# ---------------------------------------------------------------------------
# convert
# ---------------------------------------------------------------------------

@cli.command()
@click.argument("input_path", type=click.Path(exists=True))
@click.option("-o", "--output", "output_path", type=click.Path(), default=None, help="Output file or directory.")
@click.option("-q", "--quality", type=int, default=85, help="Quality (1-100). Default: 85.")
@click.option("--lossless", is_flag=True, default=False, help="Lossless compression.")
@click.option("-e", "--effort", type=int, default=7, help="Effort (1-9). Default: 7.")
@click.option("-d", "--distance", type=float, default=None, help="Butteraugli distance (0.0-25.0).")
@click.option("--format", "output_format", type=click.Choice(["png", "jpeg", "webp", "tiff"]), default="png", help="Output format when converting from JXL.")
@click.option("--jpeg-lossless", is_flag=True, default=False, help="Byte-exact JPEG reconstruction (requires cjxl/djxl).")
@click.option("--strip-metadata", is_flag=True, default=False, help="Strip all metadata.")
@click.option("--strip-exif", is_flag=True, default=False, help="Strip EXIF data only.")
@click.option("--strip-icc", is_flag=True, default=False, help="Strip ICC profile only.")
@click.option("-r", "--recursive", is_flag=True, default=True, help="Recurse into subdirectories (batch mode).")
@click.option("--no-recursive", is_flag=True, default=False, help="Don't recurse into subdirectories.")
@click.option("--flat", is_flag=True, default=False, help="Don't mirror directory structure in output.")
@click.option("-w", "--workers", type=int, default=None, help="Parallel worker threads. Default: CPU count.")
def convert(
    input_path: str,
    output_path: str | None,
    quality: int,
    lossless: bool,
    effort: int,
    distance: float | None,
    output_format: str,
    jpeg_lossless: bool,
    strip_metadata: bool,
    strip_exif: bool,
    strip_icc: bool,
    recursive: bool,
    no_recursive: bool,
    flat: bool,
    workers: int | None,
):
    """Convert images to/from JPEG XL.

    INPUT_PATH can be a single file or a directory for batch conversion.
    """
    if jpeg_lossless and not cjxl_available():
        console.print(
            "[bold red]Error:[/] --jpeg-lossless requires cjxl and djxl on PATH.\n"
            "Install libjxl-tools or download from https://github.com/libjxl/libjxl/releases",
            highlight=False,
        )
        sys.exit(1)

    settings_kwargs: dict = dict(
        quality=quality,
        lossless=lossless,
        effort=effort,
        distance=distance,
        output_format=OutputFormat(output_format),
        preserve_metadata=not strip_metadata,
        strip_exif=strip_exif or strip_metadata,
        strip_icc=strip_icc or strip_metadata,
        jpeg_lossless=jpeg_lossless,
        recursive=recursive and not no_recursive,
        mirror_structure=not flat,
    )
    if workers is not None:
        settings_kwargs["workers"] = workers
    settings = ConversionSettings(**settings_kwargs)

    src = Path(input_path)

    # --- Single file ---
    if src.is_file():
        out = Path(output_path) if output_path else None
        with console.status(f"Converting [bold]{src.name}[/]…"):
            result = convert_single(src, out, settings)

        if result.error:
            console.print(f"[bold red]Error:[/] {result.error}")
            sys.exit(1)

        table = Table(title="Conversion Result", show_header=False, border_style="dim")
        table.add_row("Input", result.input_path)
        table.add_row("Output", result.output_path)
        table.add_row("Input size", _format_size(result.input_size))
        table.add_row("Output size", _format_size(result.output_size))
        savings_style = "green" if result.savings_pct > 0 else "red"
        table.add_row("Savings", f"[{savings_style}]{result.savings_pct:+.1f}%[/]")
        table.add_row("Duration", f"{result.duration_ms:.0f} ms")
        if result.used_jpeg_lossless:
            table.add_row("Mode", "[cyan]Byte-exact JPEG reconstruction[/]")
        if result.metadata and result.metadata.has_exif:
            table.add_row("EXIF", "[green]preserved[/]")
        if result.metadata and result.metadata.has_icc:
            table.add_row("ICC", "[green]preserved[/]")
        console.print(table)
        return

    # --- Batch ---
    if not src.is_dir():
        console.print(f"[bold red]Error:[/] {src} is not a file or directory.")
        sys.exit(1)

    if output_path is None:
        out_dir = src.parent / (src.name + "_jxl")
    else:
        out_dir = Path(output_path)

    # Determine direction by scanning files
    # If the folder has mostly JXL files, assume FROM_JXL
    jxl_count = sum(1 for f in src.rglob("*") if f.suffix.lower() == ".jxl")
    total_count = sum(1 for f in src.rglob("*") if f.is_file())
    if jxl_count > total_count / 2:
        settings.direction = ConversionDirection.FROM_JXL
        console.print(f"[dim]Detected JXL files — converting FROM JXL to {output_format.upper()}[/]")
    else:
        settings.direction = ConversionDirection.TO_JXL
        console.print("[dim]Converting TO JXL[/]")

    console.print(f"[dim]Using {settings.workers} worker thread{'s' if settings.workers != 1 else ''}[/]")

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        TimeElapsedColumn(),
        console=console,
    ) as prog:
        task = prog.add_task("Converting", total=0)

        def _on_progress(batch_progress):
            prog.update(task, total=batch_progress.total, completed=batch_progress.completed)

        result = convert_batch_sync(src, out_dir, settings, on_progress=_on_progress)
        prog.update(task, total=result.total, completed=result.completed)

    # Summary
    errors = [r for r in result.results if r.error]
    success = [r for r in result.results if not r.error]

    table = Table(title="Batch Conversion Summary", border_style="dim")
    table.add_column("File", style="cyan")
    table.add_column("Input", justify="right")
    table.add_column("Output", justify="right")
    table.add_column("Savings", justify="right")
    table.add_column("Time", justify="right")

    for r in success:
        savings_style = "green" if r.savings_pct > 0 else "red"
        table.add_row(
            Path(r.input_path).name,
            _format_size(r.input_size),
            _format_size(r.output_size),
            f"[{savings_style}]{r.savings_pct:+.1f}%[/]",
            f"{r.duration_ms:.0f}ms",
        )

    console.print(table)

    if errors:
        console.print(f"\n[bold red]{len(errors)} error(s):[/]")
        for r in errors:
            console.print(f"  • {Path(r.input_path).name}: {r.error}")

    total_savings = (
        (1 - result.total_output_size / result.total_input_size) * 100
        if result.total_input_size > 0
        else 0
    )
    console.print(
        f"\n[bold]Total:[/] {len(success)} files, "
        f"{_format_size(result.total_input_size)} → {_format_size(result.total_output_size)} "
        f"([{'green' if total_savings > 0 else 'red'}]{total_savings:+.1f}%[/] savings)"
    )


# ---------------------------------------------------------------------------
# info
# ---------------------------------------------------------------------------

@cli.command()
@click.argument("file_path", type=click.Path(exists=True))
def info(file_path: str):
    """Show information about an image file."""
    try:
        result = get_image_info(Path(file_path))
    except Exception as e:
        console.print(f"[bold red]Error:[/] {e}")
        sys.exit(1)

    table = Table(title=f"Image Info: {Path(file_path).name}", show_header=False, border_style="dim")
    table.add_row("Path", result.path)
    table.add_row("Format", result.format)
    table.add_row("Dimensions", f"{result.dimensions[0]} × {result.dimensions[1]}")
    table.add_row("Mode", result.mode)
    table.add_row("Size", _format_size(result.size))
    table.add_row("EXIF", "[green]yes[/]" if result.metadata.has_exif else "[dim]no[/]")
    table.add_row("ICC Profile", result.metadata.icc_description if result.metadata.has_icc else "[dim]no[/]")

    console.print(table)

    if result.metadata.exif_fields:
        exif_table = Table(title="EXIF Data", border_style="dim")
        exif_table.add_column("Tag", style="cyan")
        exif_table.add_column("Value")
        for tag, val in sorted(result.metadata.exif_fields.items()):
            exif_table.add_row(tag, val)
        console.print(exif_table)


# ---------------------------------------------------------------------------
# serve
# ---------------------------------------------------------------------------

@cli.command()
@click.option("-p", "--port", type=int, default=8787, help="Port to run on. Default: 8787.")
@click.option("-h", "--host", "host", default="127.0.0.1", help="Host to bind to. Default: 127.0.0.1.")
@click.option("--open/--no-open", default=True, help="Open browser automatically.")
def serve(port: int, host: str, open: bool):
    """Start the web UI server."""
    import logging
    import uvicorn
    import webbrowser

    # Configure app-level logging so converter/server messages show in terminal
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s:     %(message)s",
    )

    console.print(f"\n[bold]JXL Tools[/] — Web UI starting at [link]http://{host}:{port}[/link]\n")

    if cjxl_available():
        console.print("  [green]✓[/] cjxl/djxl detected — byte-exact JPEG reconstruction available")
    else:
        console.print("  [yellow]○[/] cjxl/djxl not found — byte-exact JPEG mode unavailable")
        console.print("    Install from: https://github.com/libjxl/libjxl/releases\n")

    if open:
        import threading
        threading.Timer(1.5, lambda: webbrowser.open(f"http://{host}:{port}")).start()

    uvicorn.run("jxl_tools.server:app", host=host, port=port, log_level="info")
