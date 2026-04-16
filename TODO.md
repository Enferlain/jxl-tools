# Todos

- [x] ui display for fallback behavior
- [x] ui performance section disrupts the layout
- [x] ui hover tooltips for core options
- [x] progress bar actually shows current progress for what's happening in real time instead of being invisible
- [x] session logs that show what happens to each file in processing order, including size changes, timing, errors, and fallback decisions without overwhelming the UI
- [x] ui summary at the end
- [x] short guide/description for quality/compression settings
- [x] Temporary Jobs Cleanup (`review_output.txt` / stale temp jobs)
- [x] ui results list view detail view buttons
- [x] drag folder into the drop images area to add all images in the folder
- [ ] queue view that shows folders and items that are queued for conversion
- [ ] showing time spending during the process in ui/cli so we know how long we've been doing something?
- [ ] ui session log/cli session log saying time taken at the end? instead of "105961ms total active work"
- [ ] session log printed as a txt to output folder (timestamps/proper order of how it happened would be nice for session logs in general, 25352ms is a bit hard to read for time taken)
- [ ] are all jxl options exposed in the ui?
- [ ] ui preview with slider for input-output comparison for the selected image at the end
- [ ] local toggle instead of webui so it doesn't upload and download but uses existing files and saves results to target folder
- [ ] check if threads/workers actually does something
- [ ] tracking time taken and filesize reductions based on attributes to a db or something so we can offer estimates later on
- [ ] history of what has been processed so we get a disclamer if we want to reprocess the same things in the same direction again

## Backend / Product Gaps

- [ ] richer local selection editing APIs: support interactive include/exclude mutations for the local selection tree, including removing a subfolder, deselecting individual files, and patching a selection incrementally instead of rebuilding from scratch every time
- [ ] fuller backend-driven local browser workflow if we still want the original browse-first version: `GET /api/local/browse` exists, but selection semantics for choosing/editing from the browser are still missing
- [ ] stronger server-side cancel awareness inside the worker loop: cancel is cooperative now, but we may still want finer-grained checks and clearer draining behavior while work is queued/active
- [ ] upload guardrails: max upload size policy, clearer validation for very large batches, and possibly chunked/resumable uploads instead of plain multipart "accept and try"
- [ ] persistent job/history storage: job state is still in memory plus temp files, so results/history disappear across server restarts
- [ ] better per-file download/history ergonomics if we want durable revisitability: named batches, older-job browsing, and stronger file indexing for revisiting prior results
