/* ================================================================
   JXL Tools — Web UI Application
   ================================================================ */

(() => {
  "use strict";

  // ---------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dropZone       = $("#drop-zone");
  const fileInput      = $("#file-input");
  const folderInput    = $("#folder-input");
  const settingsPanel  = $("#settings-panel");
  const resultsPanel   = $("#results-panel");
  const progressOverlay = $("#progress-overlay");

  // Direction
  const directionBtns  = $$("#direction-toggle .toggle-btn");
  const outputFmtGroup = $("#output-format-group");
  const outputFmtSelect = $("#output-format");
  const fallbackHint   = $("#jxl-fallback-hint");

  // Quality
  const presetBtns     = $$(".preset-btn");
  const losslessToggle = $("#lossless-toggle");
  const qualitySlider  = $("#quality-slider");
  const qualityValue   = $("#quality-value");
  const qualityGroup   = $("#quality-slider-group");
  const effortSlider   = $("#effort-slider");
  const effortValue    = $("#effort-value");
  const effortGroup    = $("#effort-group");
  const qualityCard    = $("#quality-card");

  // Metadata
  const preserveMeta   = $("#preserve-metadata");
  const jpegLossless   = $("#jpeg-lossless");
  const jpegHint       = $("#jpeg-lossless-hint");

  // Performance
  const workersSlider  = $("#workers-slider");
  const workersValue   = $("#workers-value");
  const threadsSlider  = $("#threads-slider");
  const threadsValue   = $("#threads-value");

  // File list
  const fileCountEl    = $("#file-count");
  const fileListEl     = $("#file-list");
  const btnAddMore     = $("#btn-add-more");
  const btnAddFolder   = $("#btn-add-folder");
  const btnClear       = $("#btn-clear");
  const btnConvert     = $("#btn-convert");

  // Results
  const btnDownloadAll = $("#btn-download-all");
  const btnNew         = $("#btn-new");
  const resultsSummaryStrip = $("#results-summary-strip");
  const resultsViewBtns = $$("#results-view-toggle .view-toggle-btn");
  const statFiles      = $("#stat-files");
  const statInputSize  = $("#stat-input-size");
  const statOutputSize = $("#stat-output-size");
  const statSavings    = $("#stat-savings");
  const resultsList    = $("#results-list");
  const resultsLog     = $("#results-log");

  // Progress
  const progressEyebrow = $("#progress-eyebrow");
  const progressPercent = $("#progress-percent");
  const progressFilesPill = $("#progress-files-pill");
  const progressFallbacksPill = $("#progress-fallbacks-pill");
  const progressErrorsPill = $("#progress-errors-pill");
  const progressFill   = $("#progress-bar-fill");
  const progressStatus = $("#progress-status");

  // Badge
  const badgeCjxl      = $("#badge-cjxl");

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  let selectedFiles = [];       // Array of File objects
  let currentJobId  = null;
  let currentResultsView = "list";
  let sessionLogs = [];
  let displayedProgress = 0;
  let desiredProgress = 0;
  let progressSoftCap = 92;
  let progressTimer = null;
  let progressFallbackCount = 0;
  let progressErrorCount = 0;
  let capabilities  = { cjxl_available: false, djxl_available: false, jpeg_lossless: false };

  // ---------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------
  function formatSize(bytes) {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let val = bytes;
    while (val >= 1024 && i < units.length - 1) {
      val /= 1024;
      i++;
    }
    return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function getExt(filename) {
    const dot = filename.lastIndexOf(".");
    return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
  }

  function getBaseName(path) {
    return path.split(/[/\\]/).pop();
  }

  function getFileDisplayName(file) {
    return file.relativePath || file.webkitRelativePath || file.name;
  }

  function getFileId(file) {
    return `${getFileDisplayName(file)}::${file.size}`;
  }

  function ellipsizeMiddle(value, maxLength = 48) {
    if (value.length <= maxLength) return value;
    const keep = Math.max(8, Math.floor((maxLength - 1) / 2));
    return `${value.slice(0, keep)}…${value.slice(-keep)}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => (
      {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;",
      }[char]
    ));
  }

  function getExtClass(filename) {
    const ext = getExt(filename);
    const map = { png: "png", jpg: "jpg", jpeg: "jpeg", webp: "webp", tiff: "tiff", tif: "tif", bmp: "bmp", jxl: "jxl" };
    return map[ext] || "png";
  }

  function isFallbackResult(result) {
    return !result.error && currentDirection === "to_jxl" && getExt(result.output_path) !== "jxl";
  }

  function renderLogList(target, entries, limit = entries.length) {
    if (!target) return;
    target.innerHTML = "";
    entries.slice(-limit).forEach((entry) => {
      const li = document.createElement("li");
      li.className = `progress-log-item progress-log-item--${entry.kind}`;
      li.textContent = entry.message;
      target.appendChild(li);
    });
  }

  function addSessionLog(kind, message) {
    sessionLogs.push({ kind, message });
    if (sessionLogs.length > 200) sessionLogs.shift();
    renderLogList(resultsLog, sessionLogs);
  }

  function resetSessionLogViews() {
    sessionLogs = [];
    renderLogList(resultsLog, sessionLogs);
  }

  function resetProgressSummary(total) {
    progressFallbackCount = 0;
    progressErrorCount = 0;
    updateProgressSummary(0, total);
  }

  function updateProgressSummary(completed, total) {
    progressFilesPill.textContent = `${completed} / ${total} files`;
    progressFallbacksPill.textContent = `${progressFallbackCount} fallback${progressFallbackCount === 1 ? "" : "s"}`;
    progressErrorsPill.textContent = `${progressErrorCount} error${progressErrorCount === 1 ? "" : "s"}`;
  }

  function syncProgressDisplay(value, { indeterminate = false } = {}) {
    displayedProgress = Math.max(0, Math.min(100, value));
    progressPercent.textContent = `${Math.round(displayedProgress)}%`;
    progressFill.classList.toggle("is-indeterminate", indeterminate);
    progressFill.style.width = `${displayedProgress}%`;
  }

  function stopProgressLoop() {
    if (progressTimer !== null) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }

  function startProgressLoop({ initial = 4, cap = 92 } = {}) {
    stopProgressLoop();
    desiredProgress = initial;
    progressSoftCap = cap;
    syncProgressDisplay(initial);

    progressTimer = window.setInterval(() => {
      if (displayedProgress >= desiredProgress) {
        return;
      }

      const next = Math.min(
        desiredProgress,
        displayedProgress + Math.max(0.8, (desiredProgress - displayedProgress) * 0.18)
      );

      syncProgressDisplay(Math.min(next, progressSoftCap));
    }, 140);
  }

  function setProgressTarget(percent, { cap = progressSoftCap } = {}) {
    desiredProgress = Math.max(desiredProgress, Math.max(0, Math.min(100, percent)));
    progressSoftCap = Math.max(desiredProgress, Math.max(0, Math.min(99, cap)));
  }

  function finishProgress() {
    stopProgressLoop();
    desiredProgress = 100;
    progressSoftCap = 100;
    syncProgressDisplay(100);
  }

  function setProgressPhase(phase, detail = "") {
    progressEyebrow.textContent = phase;
    progressStatus.textContent = detail || phase;
  }

  async function pollBatchJob(jobId) {
    let lastEventIndex = 0;

    while (true) {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Could not read batch progress");
      }

      const state = await res.json();
      const events = state.events || [];

      for (const event of events.slice(lastEventIndex)) {
        if (event.type === "job_started") {
          progressEyebrow.textContent = "Preparing batch";
          setProgressTarget(12, { cap: 20 });
          updateProgressSummary(0, event.total);
          progressStatus.textContent = `Ready to convert ${event.total} file${event.total === 1 ? "" : "s"}.`;
          addSessionLog("note", `Started batch with ${event.workers} worker${event.workers === 1 ? "" : "s"}.`);
        } else if (event.type === "file_started") {
          const pct = computeLivePercent(event.completed, event.total, event.active);
          setProgressTarget(pct, { cap: 35 });
          setProgressPhase(
            `Converting ${event.completed}/${event.total}`,
            `Working on ${ellipsizeMiddle(event.file)}…`
          );
          addSessionLog("start", `Started ${event.file}.`);
        } else if (event.type === "file_finished") {
          const pct = Math.round((event.completed / event.total) * 100);
          const justFinished = getBaseName(event.current_file);
          setProgressTarget(pct, { cap: 98 });
          if (event.result?.error) {
            progressErrorCount += 1;
          } else if (event.result && isFallbackResult(event.result)) {
            progressFallbackCount += 1;
          }
          updateProgressSummary(event.completed, event.total);
          let msg = `Processed ${event.completed}/${event.total} — ${ellipsizeMiddle(justFinished)}`;

          if (event.result && isFallbackResult(event.result)) {
            const outExt = getExt(event.result.output_path).toUpperCase();
            msg = `Fallback to ${outExt} for ${ellipsizeMiddle(justFinished)} (${event.completed}/${event.total})`;
            addSessionLog(
              "fallback",
              `${justFinished}: kept ${outExt} because it beat JXL on size (${formatSize(event.result.input_size)} → ${formatSize(event.result.output_size)}, ${event.result.duration_ms.toFixed(0)}ms).`
            );
          } else if (event.result?.error) {
            addSessionLog("error", `${justFinished}: ${event.result.error}`);
          } else {
            addSessionLog(
              "success",
              `${justFinished}: ${formatSize(event.result.input_size)} → ${formatSize(event.result.output_size)} (${event.result.savings_pct.toFixed(1)}% change, ${event.result.duration_ms.toFixed(0)}ms).`
            );
          }

          progressEyebrow.textContent = `Converting ${event.completed}/${event.total}`;
          progressStatus.textContent = msg;
        } else if (event.type === "job_error") {
          addSessionLog("error", event.message || "Unexpected batch failure.");
        }
      }

      lastEventIndex = events.length;

      const livePct = computeLivePercent(state.completed, state.total, state.active);
      setProgressTarget(livePct, { cap: state.done ? 100 : 98 });
      updateProgressSummary(state.completed, state.total);

      if (state.done) {
        setProgressPhase("Finalizing results", "Preparing results…");
        finishProgress();
        setProgressPhase("Batch complete", "Done!");
        return state;
      }

      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }

  function computeLivePercent(completed, total, active) {
    if (!total) return 0;
    const inFlightWeight = Math.min(active, total - completed) * 0.08;
    return Math.min(99, ((completed + inFlightWeight) / total) * 100);
  }

  function setResultsView(view) {
    currentResultsView = view;
    resultsViewBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === view);
    });
    resultsList.dataset.view = view;
  }

  // ---------------------------------------------------------------
  // Init — check capabilities
  // ---------------------------------------------------------------
  async function checkCapabilities() {
    try {
      const res = await fetch("/api/capabilities");
      if (res.ok) {
        capabilities = await res.json();
      }
    } catch { /* ignore */ }

    if (capabilities.jpeg_lossless) {
      badgeCjxl.classList.remove("badge--inactive");
      badgeCjxl.classList.add("badge--active");
      jpegLossless.disabled = false;
      jpegHint.textContent = "Reconstructs the original JPEG stream byte-for-byte.";
    } else {
      jpegLossless.disabled = true;
      jpegLossless.checked = false;
    }

    // Set workers slider to server default
    const defaultWorkers = capabilities.default_workers || Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
    const maxWorkers = Math.min(navigator.hardwareConcurrency || 4, 16);
    workersSlider.max = maxWorkers;
    workersSlider.value = Math.min(defaultWorkers, maxWorkers);
    workersValue.textContent = workersSlider.value;

    const defaultThreads = Math.min(capabilities.default_jxl_threads || 1, 16);
    threadsSlider.max = maxWorkers;
    threadsSlider.value = defaultThreads;
    threadsValue.textContent = threadsSlider.value;
  }

  // ---------------------------------------------------------------
  // Drag & drop
  // ---------------------------------------------------------------
  async function readAllDirectoryEntries(reader) {
    const allEntries = [];
    while (true) {
      const entries = await new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      if (!entries.length) break;
      allEntries.push(...entries);
    }
    return allEntries;
  }

  async function collectFilesFromEntry(entry, parentPath = "") {
    if (!entry) return [];

    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => {
        entry.file(resolve, reject);
      });
      const relativePath = `${parentPath}${file.name}`;
      Object.defineProperty(file, "relativePath", {
        value: relativePath,
        configurable: true,
      });
      return [file];
    }

    if (!entry.isDirectory) {
      return [];
    }

    const reader = entry.createReader();
    const entries = await readAllDirectoryEntries(reader);
    const nested = await Promise.all(
      entries.map((child) => collectFilesFromEntry(child, `${parentPath}${entry.name}/`))
    );
    return nested.flat();
  }

  async function collectDroppedFiles(dataTransfer) {
    const items = Array.from(dataTransfer.items || []);
    const entryItems = items
      .map((item) => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
      .filter(Boolean);

    if (entryItems.length) {
      const nested = await Promise.all(entryItems.map((entry) => collectFilesFromEntry(entry)));
      return nested.flat().filter(isImageFile);
    }

    return Array.from(dataTransfer.files || []).filter(isImageFile);
  }

  function initDropZone() {
    let dragCounter = 0;

    dropZone.addEventListener("dragenter", (e) => {
      e.preventDefault();
      dragCounter++;
      dropZone.classList.add("drag-over");
    });

    dropZone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        dropZone.classList.remove("drag-over");
      }
    });

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
    });

    dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      dragCounter = 0;
      dropZone.classList.remove("drag-over");
      const files = await collectDroppedFiles(e.dataTransfer);
      if (files.length) addFiles(files);
    });

    // Click on drop zone triggers file input
    dropZone.addEventListener("click", (e) => {
      if (e.target.tagName === "LABEL" || e.target.tagName === "INPUT") return;
      fileInput.click();
    });

    fileInput.addEventListener("change", () => {
      const files = Array.from(fileInput.files).filter(isImageFile);
      if (files.length) addFiles(files);
      fileInput.value = "";
    });

    folderInput.addEventListener("change", () => {
      const files = Array.from(folderInput.files).filter(isImageFile);
      if (files.length) addFiles(files);
      folderInput.value = "";
    });
  }

  function isImageFile(file) {
    const validExts = new Set(["png", "jpg", "jpeg", "webp", "tiff", "tif", "bmp", "jxl"]);
    return validExts.has(getExt(file.name));
  }

  // ---------------------------------------------------------------
  // File management
  // ---------------------------------------------------------------
  function addFiles(files) {
    // Deduplicate by name + size
    for (const f of files) {
      const exists = selectedFiles.some(
        (sf) => getFileId(sf) === getFileId(f)
      );
      if (!exists) selectedFiles.push(f);
    }
    renderFileList();
    showSettings();
    autoDetectDirection();
  }

  function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFileList();
    if (selectedFiles.length === 0) hideSettings();
  }

  function clearFiles() {
    selectedFiles = [];
    renderFileList();
    hideSettings();
  }

  function renderFileList() {
    fileCountEl.textContent = selectedFiles.length;
    fileListEl.innerHTML = "";

    selectedFiles.forEach((file, i) => {
      const displayName = getFileDisplayName(file);
      const li = document.createElement("li");
      li.className = "file-item";
      li.innerHTML = `
        <div class="file-item-icon file-item-icon--${getExtClass(file.name)}">${getExt(file.name).toUpperCase()}</div>
        <span class="file-item-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
        <span class="file-item-size">${formatSize(file.size)}</span>
        <button class="file-item-remove" data-index="${i}" title="Remove">×</button>
      `;
      fileListEl.appendChild(li);
    });

    // Bind remove buttons
    fileListEl.querySelectorAll(".file-item-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeFile(parseInt(btn.dataset.index));
      });
    });

    btnConvert.disabled = selectedFiles.length === 0;
  }

  function autoDetectDirection() {
    const jxlCount = selectedFiles.filter((f) => getExt(f.name) === "jxl").length;
    if (jxlCount > selectedFiles.length / 2) {
      setDirection("from_jxl");
    } else {
      setDirection("to_jxl");
    }
  }

  // ---------------------------------------------------------------
  // Panels
  // ---------------------------------------------------------------
  function showSettings() {
    settingsPanel.style.display = "";
    resultsPanel.style.display = "none";
  }

  function hideSettings() {
    settingsPanel.style.display = "none";
  }

  function showResults() {
    settingsPanel.style.display = "none";
    dropZone.style.display = "none";
    resultsPanel.style.display = "";
  }

  function resetToStart() {
    selectedFiles = [];
    currentJobId = null;
    renderFileList();
    resetSessionLogViews();
    resultsSummaryStrip.innerHTML = "";
    setResultsView("list");
    dropZone.style.display = "";
    settingsPanel.style.display = "none";
    resultsPanel.style.display = "none";
    progressOverlay.style.display = "none";
    resultsList.innerHTML = "";
  }

  // ---------------------------------------------------------------
  // Direction toggle
  // ---------------------------------------------------------------
  let currentDirection = "to_jxl";

  function setDirection(dir) {
    currentDirection = dir;
    directionBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === dir);
    });
    outputFmtGroup.style.display = dir === "from_jxl" ? "" : "none";
    if (fallbackHint) fallbackHint.style.display = dir === "to_jxl" ? "" : "none";
    updateSettingsForDirection();
  }

  directionBtns.forEach((btn) => {
    btn.addEventListener("click", () => setDirection(btn.dataset.value));
  });

  outputFmtSelect.addEventListener("change", updateSettingsForDirection);

  function updateSettingsForDirection() {
    const isFromJxl = currentDirection === "from_jxl";
    const outFmt = outputFmtSelect.value;

    // Presets, lossless, effort: only relevant when encoding TO JXL
    presetBtns.forEach((btn) => { btn.disabled = isFromJxl; });
    losslessToggle.disabled = isFromJxl;
    effortSlider.disabled = isFromJxl;
    effortGroup.style.opacity = isFromJxl ? "0.35" : "";

    // Quality: relevant when encoding TO JXL, or FROM JXL → JPEG/WebP
    const qualityDisabled = isFromJxl && !['jpeg', 'webp'].includes(outFmt);
    qualitySlider.disabled = qualityDisabled;
    qualityGroup.style.opacity = qualityDisabled ? "0.35" : "";

    // JPEG lossless: relevant in both directions, but only for JPEG
    const jpegLosslessDisabled = isFromJxl && outFmt !== 'jpeg';
    if (jpegLosslessDisabled) {
      jpegLossless.disabled = true;
    } else if (capabilities.jpeg_lossless) {
      jpegLossless.disabled = false;
    }

    // Visual dimming for the card title area
    qualityCard.style.opacity = isFromJxl && qualityDisabled ? "0.5" : "";
  }

  // ---------------------------------------------------------------
  // Quality presets
  // ---------------------------------------------------------------
  const presets = {
    fast:    { lossless: false, quality: 70, effort: 1 },
    web:     { lossless: false, quality: 80, effort: 4 },
    archive: { lossless: true,  quality: 100, effort: 7 },
    custom:  null,
  };

  let currentPreset = "web";

  function applyPreset(name) {
    currentPreset = name;
    presetBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.preset === name);
    });

    const p = presets[name];
    if (!p) return; // custom — don't change anything

    losslessToggle.checked = p.lossless;
    qualitySlider.value = p.quality;
    qualityValue.textContent = p.quality;
    effortSlider.value = p.effort;
    effortValue.textContent = p.effort;
    updateQualityVisibility();
  }

  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
  });

  // ---------------------------------------------------------------
  // Quality controls
  // ---------------------------------------------------------------
  function updateQualityVisibility() {
    qualityGroup.style.display = losslessToggle.checked ? "none" : "";
  }

  losslessToggle.addEventListener("change", () => {
    updateQualityVisibility();
    switchToCustom();
  });

  qualitySlider.addEventListener("input", () => {
    qualityValue.textContent = qualitySlider.value;
    switchToCustom();
  });

  effortSlider.addEventListener("input", () => {
    effortValue.textContent = effortSlider.value;
    switchToCustom();
  });

  workersSlider.addEventListener("input", () => {
    workersValue.textContent = workersSlider.value;
  });

  threadsSlider.addEventListener("input", () => {
    threadsValue.textContent = threadsSlider.value;
  });

  function switchToCustom() {
    if (currentPreset !== "custom") {
      currentPreset = "custom";
      presetBtns.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.preset === "custom");
      });
    }
  }

  // ---------------------------------------------------------------
  // Build settings object
  // ---------------------------------------------------------------
  function buildSettings() {
    return {
      lossless: losslessToggle.checked,
      quality: parseInt(qualitySlider.value),
      effort: parseInt(effortSlider.value),
      preserve_metadata: preserveMeta.checked,
      jpeg_lossless: jpegLossless.checked && capabilities.jpeg_lossless,
      output_format: outputFmtSelect.value,
      direction: currentDirection,
      workers: parseInt(workersSlider.value),
      jxl_threads: parseInt(threadsSlider.value),
    };
  }

  // ---------------------------------------------------------------
  // Convert files
  // ---------------------------------------------------------------
  async function convertFiles() {
    if (selectedFiles.length === 0) return;

    const settings = buildSettings();
    const isBatch = selectedFiles.length > 1;
    resetSessionLogViews();
    resetProgressSummary(selectedFiles.length);

    // Show progress
    progressOverlay.style.display = "";
    setProgressPhase(isBatch ? "Uploading files" : "Uploading file", "Uploading…");
    startProgressLoop({ initial: 4, cap: 18 });
    btnConvert.querySelector(".btn-text").textContent = "Converting…";
    btnConvert.querySelector(".btn-spinner").style.display = "";
    btnConvert.disabled = true;
    addSessionLog("note", `Queued ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} for conversion.`);

    try {
      let data;

      if (isBatch) {
        // Batch: upload all files, then poll the background job
        const formData = new FormData();
        selectedFiles.forEach((f) => formData.append("files", f, getFileDisplayName(f)));
        formData.append("settings_json", JSON.stringify(settings));

        setProgressPhase(
          "Uploading files",
          `Uploading ${selectedFiles.length} files…`
        );
        setProgressTarget(10, { cap: 18 });

        const res = await fetch("/api/convert-batch", { method: "POST", body: formData });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || "Conversion failed");
        }
        const started = await res.json();
        data = await pollBatchJob(started.job_id);

      } else {
        // Single file
        const formData = new FormData();
        formData.append("file", selectedFiles[0], getFileDisplayName(selectedFiles[0]));
        formData.append("settings_json", JSON.stringify(settings));

        setProgressPhase(
          "Converting 0/1",
          `Working on ${ellipsizeMiddle(getFileDisplayName(selectedFiles[0]))}…`
        );
        setProgressTarget(55, { cap: 82 });
        addSessionLog("start", `Started ${getFileDisplayName(selectedFiles[0])}.`);

        const res = await fetch("/api/convert", { method: "POST", body: formData });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || "Conversion failed");
        }
        data = await res.json();
        // Normalize single result to batch shape
        data = {
          job_id: data.job_id,
          results: [data.result],
          total_input_size: data.result.input_size,
          total_output_size: data.result.output_size,
          total_savings_pct: data.result.savings_pct,
          success_count: data.result.error ? 0 : 1,
          error_count: data.result.error ? 1 : 0,
          fallback_count: isFallbackResult(data.result) ? 1 : 0,
          total_duration_ms: data.result.duration_ms,
        };
        if (data.results[0].error) {
          progressErrorCount = 1;
          addSessionLog("error", `${getBaseName(data.results[0].input_path)}: ${data.results[0].error}`);
        } else if (isFallbackResult(data.results[0])) {
          progressFallbackCount = 1;
          addSessionLog("fallback", `${getBaseName(data.results[0].input_path)}: fallback to ${getExt(data.results[0].output_path).toUpperCase()} after size comparison.`);
        } else {
          addSessionLog("success", `${getBaseName(data.results[0].input_path)} completed in ${data.results[0].duration_ms.toFixed(0)}ms.`);
        }
        updateProgressSummary(1, 1);
        setProgressPhase("Finalizing result", "Preparing result…");
        finishProgress();
        setProgressPhase("Single-file conversion complete", "Done!");
      }

      // Short delay to show completion
      await new Promise((r) => setTimeout(r, 500));
      progressOverlay.style.display = "none";

      currentJobId = data.job_id;
      renderResults(data);

    } catch (err) {
      stopProgressLoop();
      progressOverlay.style.display = "none";
      addSessionLog("error", err.message);
      showError(err.message);
    } finally {
      btnConvert.querySelector(".btn-text").textContent = "Convert";
      btnConvert.querySelector(".btn-spinner").style.display = "none";
      btnConvert.disabled = false;
    }
  }

  function showError(message) {
    // Simple inline toast-style error on the convert button
    const btnText = btnConvert.querySelector(".btn-text");
    btnText.textContent = `Error: ${message}`;
    btnText.style.color = "#f87171";
    setTimeout(() => {
      btnText.textContent = "Convert";
      btnText.style.color = "";
    }, 4000);
  }

  // ---------------------------------------------------------------
  // Render results
  // ---------------------------------------------------------------
  function renderResults(data) {
    const { results, total_input_size, total_output_size, total_savings_pct } = data;
    const successCount = data.success_count ?? results.filter((r) => !r.error).length;
    const errorCount = data.error_count ?? results.filter((r) => !!r.error).length;
    const fallbackCount = data.fallback_count ?? results.filter(isFallbackResult).length;
    const totalDurationMs = data.total_duration_ms ?? results.reduce((sum, r) => sum + r.duration_ms, 0);

    // Stats
    statFiles.textContent = results.length;
    statInputSize.textContent = formatSize(total_input_size);
    statOutputSize.textContent = formatSize(total_output_size);
    statSavings.textContent = `${total_savings_pct > 0 ? "+" : ""}${total_savings_pct.toFixed(1)}%`;

    // Highlight savings color
    const savingsCard = statSavings.closest(".stat-card");
    if (total_savings_pct > 0) {
      statSavings.style.color = "var(--success)";
    } else {
      statSavings.style.color = "var(--danger)";
    }

    resultsSummaryStrip.innerHTML = `
      <span class="summary-pill">${successCount} successful</span>
      <span class="summary-pill">${fallbackCount} fallback${fallbackCount === 1 ? "" : "s"}</span>
      <span class="summary-pill">${errorCount} error${errorCount === 1 ? "" : "s"}</span>
      <span class="summary-pill">${Math.round(totalDurationMs)}ms total active work</span>
    `;

    // Build result items
    resultsList.innerHTML = "";
    resultsList.dataset.view = currentResultsView;

    results.forEach((r) => {
      const li = document.createElement("li");
      const hasError = !!r.error;
      const inputName = getBaseName(r.input_path);
      const outputName = getBaseName(r.output_path);

      li.className = `result-item${hasError ? " result-item--error" : ""}`;

      if (hasError) {
        li.innerHTML = `
          <div class="file-item-icon file-item-icon--${getExtClass(inputName)}">${getExt(inputName).toUpperCase()}</div>
          <span class="result-name">${escapeHtml(inputName)}</span>
          <span class="result-error">Error: ${escapeHtml(r.error)}</span>
        `;
      } else {
        const savingsClass = r.savings_pct > 0 ? "result-savings--positive" : "result-savings--negative";
        const savingsLabel = `${r.savings_pct > 0 ? "-" : "+"}${Math.abs(r.savings_pct).toFixed(1)}%`;

        let badges = "";
        if (r.used_jpeg_lossless) {
          badges += `<span class="result-badge-jpeg">JPEG Lossless</span>`;
        }
        
        const outExt = getExt(outputName);
        if (isFallbackResult(r)) {
          badges += ` <span class="result-badge-jpeg" style="background: rgba(234, 179, 8, 0.15); color: #eab308; border-color: rgba(234, 179, 8, 0.3);">Fallback: ${outExt.toUpperCase()}</span>`;
        }

        const meta = r.metadata || {};
        const metaDetails = [
          meta.format ? `Format ${meta.format}` : null,
          Array.isArray(meta.dimensions) ? `${meta.dimensions[0]}×${meta.dimensions[1]}` : null,
          meta.mode ? `Mode ${meta.mode}` : null,
          meta.has_exif ? "EXIF kept" : "No EXIF",
          meta.has_icc ? "ICC kept" : "No ICC",
        ].filter(Boolean);

        li.innerHTML = `
          <div class="file-item-icon file-item-icon--${getExtClass(outputName)}">${getExt(outputName).toUpperCase()}</div>
          <span class="result-name" title="${escapeHtml(inputName)} → ${escapeHtml(outputName)}">
            ${escapeHtml(outputName)} 
            <span style="opacity: 0.5; font-size: 0.85em; font-weight: normal; margin: 0 8px;">from ${getExt(inputName).toUpperCase()}</span>
            ${badges}
          </span>
          <span class="result-sizes">
            ${formatSize(r.input_size)}
            <span class="result-arrow">→</span>
            ${formatSize(r.output_size)}
          </span>
          <span class="result-savings ${savingsClass}">${savingsLabel}</span>
          <span class="result-time">${r.duration_ms.toFixed(0)}ms</span>
          <button class="result-download" data-filename="${outputName}">Download</button>
          <div class="result-meta">
            <span class="result-meta-chip">Input: ${escapeHtml(inputName)}</span>
            <span class="result-meta-chip">Output: ${escapeHtml(outputName)}</span>
            ${metaDetails.map((item) => `<span class="result-meta-chip">${escapeHtml(item)}</span>`).join("")}
          </div>
        `;
      }

      resultsList.appendChild(li);
    });

    // Bind download buttons
    resultsList.querySelectorAll(".result-download").forEach((btn) => {
      btn.addEventListener("click", () => {
        downloadFile(btn.dataset.filename);
      });
    });

    showResults();
  }

  // ---------------------------------------------------------------
  // Download
  // ---------------------------------------------------------------
  function downloadFile(filename) {
    if (!currentJobId) return;
    const url = `/api/download/${currentJobId}/${encodeURIComponent(filename)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadAll() {
    if (!currentJobId) return;
    try {
      const res = await fetch(`/api/download-batch/${currentJobId}`, { method: "POST" });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jxl-converted-${currentJobId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
  }

  // ---------------------------------------------------------------
  // Event bindings
  // ---------------------------------------------------------------
  btnAddMore.addEventListener("click", () => fileInput.click());
  btnAddFolder.addEventListener("click", () => folderInput.click());
  btnClear.addEventListener("click", clearFiles);
  btnConvert.addEventListener("click", convertFiles);
  btnDownloadAll.addEventListener("click", downloadAll);
  btnNew.addEventListener("click", resetToStart);
  resultsViewBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      setResultsView(btn.dataset.view);
    });
  });

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  initDropZone();
  checkCapabilities();
  applyPreset("web");
  updateQualityVisibility();
  setResultsView("list");
})();
