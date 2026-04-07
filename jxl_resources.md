# can you look up what libraries and resources are needed to use jxl and the kind of stuff I described?

Yes — if you want to **build** or script a JPEG XL converter with lossy/lossless, batch folders, and metadata handling, the core thing you need is `libjxl`; everything else sits around it as wrappers, UI, and file-management code.[^1][^2]
For Rust specifically, the most practical route is `libjxl` plus a binding such as `jpegxl-rs`, because `libjxl` is the reference implementation and `jpegxl-rs` is a safe Rust wrapper around it.[^3][^1]

## Core pieces

| Need | What to use |
| :-- | :-- |
| Actual JPEG XL encode/decode | `libjxl`, which exposes a C API for encoding and decoding JPEG XL files. [^1] |
| Command-line testing | `cjxl` and `djxl`, which come from the `libjxl` toolset and expose the same practical features you’d want to mirror in an app. [^4][^5] |
| Rust integration | `jpegxl-rs`, described as a safe Rust wrapper for the JPEG XL reference implementation. [^3] |
| Format behavior reference | The libjxl format overview and API docs, especially the metadata and common API pages. [^6][^7][^8] |

## Features you asked for

Lossless and lossy are already first-class concepts in `cjxl`: `-d 0` or `-q 100` gives lossless encoding, while higher distance values trade quality for size, and `-e` controls encoder effort.[^9]
Metadata is also built in at the format/library level: JPEG XL containers can store Exif, XMP, and JUMBF, and the encoder API includes metadata-box support plus JPEG reconstruction metadata support.[^6][^2]
For JPEG inputs specifically, `cjxl` supports `--lossless_jpeg=1`, `--container=1`, and `--jpeg_store_metadata=1`, which is the feature set you want when “preserve everything” matters.[^4]

## Metadata details

The metadata API documents orientation values matching EXIF and includes ICC profile encode/decode helpers, so color/profile handling is part of the library surface rather than an afterthought.[^10]
The format overview says JPEG XL separates image data from metadata and allows Exif, XMP, and JUMBF in the container, including compressed metadata boxes.[^6]
That means your app can preserve metadata properly, but the exact UI behavior — for example “copy all metadata from source unless disabled” — is something you implement in your app layer on top of `libjxl`.[^2][^6]

## What your app still needs

`libjxl` solves the codec side, but folder selection, recursive batch conversion, progress bars, overwrite rules, and per-folder presets are normal application features you would add separately.
A practical stack would be: `libjxl` for encoding/decoding, a Rust wrapper such as `jpegxl-rs` for integration, your own file-walking and folder-picker code, and `cjxl` as a reference to confirm your settings map cleanly to real JPEG XL behavior.[^4][^3]

## Best resource set

Start with these three resources: the `libjxl` API reference, the metadata API page, and the `cjxl` man page.[^4]
Those cover the library surface, metadata capabilities, and the concrete knobs you probably want in a GUI: lossless/lossy mode, effort, JPEG reconstruction, and container/metadata behavior.[^2][^6][^4]

<span style="display:none">[^11][^12][^13][^14][^15][^16]</span>

<div align="center">⁂</div>

[^1]: https://libjxl.readthedocs.io/en/latest/api.html

[^2]: https://github.com/libjxl/libjxl/blob/main/CHANGELOG.md

[^3]: https://docs.rs/crate/jpegxl-rs/latest/source/Cargo.toml

[^4]: https://manpages.debian.org/unstable/libjxl-tools/cjxl.1.en.html

[^5]: https://manpages.debian.org/unstable/libjxl-tools/djxl.1.en.html

[^6]: https://github.com/libjxl/libjxl/blob/main/doc/format_overview.md

[^7]: https://libjxl.readthedocs.io

[^8]: https://libjxl.readthedocs.io/en/latest/api_common.html

[^9]: https://man.archlinux.org/man/cjxl.1.en

[^10]: https://libjxl.readthedocs.io/en/latest/api_metadata.html

[^11]: https://github.com/libjxl/libjxl/blob/main/README.md

[^12]: https://github.com/libjxl/libjxl/issues/2685

[^13]: https://lib.rs/crates/jxl

[^14]: https://www.reddit.com/r/jpegxl/comments/y3aegn/need_help_to_convert_jpg_to_jxl_and_conserve/

[^15]: https://lib.rs/crates/jxl-image

[^16]: https://chromium.googlesource.com/external/github.com/libjxl/libjxl/+/refs/heads/upstream/v0.4.x/README.md

