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


Detail:


1. **Queue visibility in the UI**
   Users need confidence before they hit convert. A clear queue view showing selected folders/files, counts, and what will actually be processed would reduce mistakes more than almost anything else.

2. **Editable local selection**
   The biggest usability gap after visibility is control. Being able to exclude a subfolder, remove a file, or tweak the local tree without starting over would make Local mode feel like a real batch tool instead of a one-shot picker. This is also called out in the backend/product gaps.

3. **Readable timing and durable session logs**
   The raw `105961ms` style output is useful to us, but not friendly to normal usage. Converting that into human time, showing elapsed time live, and exporting a timestamped session log into the output folder would make batches much easier to trust and review later.

4. **Preview / compare slider on results**
   Once conversion works, the next question is “did this quality setting actually look okay?” A before/after preview for a selected result would directly help users tune settings and feel safe using lossy conversion.

5. **Verify workers / threads behavior**
   This is less flashy, but high-value because it affects every batch. If those settings are misleading or not doing what users expect, the app feels unpredictable. I’d treat this as a reliability task near the top.

6. **Replace blocking `alert()`s with in-app notices/toasts**
   I found several `window.alert(...)` calls in the current React code, including [useConversionEngine.ts](/mnt/d/Projects/jxl-tools/frontend/src/hooks/useConversionEngine.ts:201) and [LocalModeView.tsx](/mnt/d/Projects/jxl-tools/frontend/src/components/LocalModeView.tsx:212). Swapping those for inline errors or toasts would noticeably improve polish and flow.

7. **Expose remaining meaningful JXL options**
   Only after the core workflow is easier to understand and trust. Advanced controls are valuable for power users, but they’re not as impactful as better queueing, selection control, and reviewability.

8. **Persistent history / reprocessing warnings**
   This is useful once people start using the tool repeatedly. It helps prevent accidental duplicate work and opens the door to job history, but it’s a step behind the core batch workflow improvements.

9. **Upload guardrails for large batches**
   Important, but secondary if Local mode is becoming the primary path. Still worth doing before wider usage.

10. **Longer-term analytics / estimate database**
   Helpful later, but I’d leave it last. It improves optimization, not immediate usability.

If we want the highest-impact next sprint, I’d bundle it like this:

- **Sprint 1:** queue view, editable local selection, better errors/toasts
- **Sprint 2:** readable timing, exported session logs, preview slider
- **Sprint 3:** verify concurrency settings, expose more JXL options, persistent history