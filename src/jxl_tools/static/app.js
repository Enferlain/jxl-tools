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
  const btnClear       = $("#btn-clear");
  const btnConvert     = $("#btn-convert");

  // Results
  const btnDownloadAll = $("#btn-download-all");
  const btnNew         = $("#btn-new");
  const statFiles      = $("#stat-files");
  const statInputSize  = $("#stat-input-size");
  const statOutputSize = $("#stat-output-size");
  const statSavings    = $("#stat-savings");
  const resultsList    = $("#results-list");

  // Progress
  const progressFill   = $("#progress-bar-fill");
  const progressStatus = $("#progress-status");

  // Badge
  const badgeCjxl      = $("#badge-cjxl");

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  let selectedFiles = [];       // Array of File objects
  let currentJobId  = null;
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

  function getExtClass(filename) {
    const ext = getExt(filename);
    const map = { png: "png", jpg: "jpg", jpeg: "jpeg", webp: "webp", tiff: "tiff", tif: "tif", bmp: "bmp", jxl: "jxl" };
    return map[ext] || "png";
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
  }

  // ---------------------------------------------------------------
  // Drag & drop
  // ---------------------------------------------------------------
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

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dragCounter = 0;
      dropZone.classList.remove("drag-over");
      const files = Array.from(e.dataTransfer.files).filter(isImageFile);
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
        (sf) => sf.name === f.name && sf.size === f.size
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
      const li = document.createElement("li");
      li.className = "file-item";
      li.innerHTML = `
        <div class="file-item-icon file-item-icon--${getExtClass(file.name)}">${getExt(file.name).toUpperCase()}</div>
        <span class="file-item-name" title="${file.name}">${file.name}</span>
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

    // Show progress
    progressOverlay.style.display = "";
    progressFill.style.width = "0%";
    progressStatus.textContent = "Uploading…";
    btnConvert.querySelector(".btn-text").textContent = "Converting…";
    btnConvert.querySelector(".btn-spinner").style.display = "";
    btnConvert.disabled = true;

    try {
      let data;

      if (isBatch) {
        // Batch: upload all files, stream progress
        const formData = new FormData();
        selectedFiles.forEach((f) => formData.append("files", f));
        formData.append("settings_json", JSON.stringify(settings));

        progressStatus.textContent = `Uploading ${selectedFiles.length} files…`;
        progressFill.style.width = "5%";

        const res = await fetch("/api/convert-batch", { method: "POST", body: formData });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || "Conversion failed");
        }

        // Parse streaming NDJSON response
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop(); // keep incomplete line

          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === "progress") {
              const pct = Math.round((event.completed / event.total) * 100);
              progressFill.style.width = `${pct}%`;
              let justFinished = event.current_file.split(/[/\\]/).pop();
              let msg = `Processed ${event.completed}/${event.total} — ${justFinished}`;
              
              if (event.result && currentDirection === "to_jxl") {
                const outExt = getExt(event.result.output_path);
                if (outExt !== "jxl" && !event.result.error) {
                  msg = `Falling back to ${outExt.toUpperCase()} — ${justFinished} (${event.completed}/${event.total})`;
                }
              }
              progressStatus.textContent = msg;
            } else if (event.type === "done") {
              data = event;
            }
          }
        }

        progressFill.style.width = "100%";
        progressStatus.textContent = "Done!";

      } else {
        // Single file
        const formData = new FormData();
        formData.append("file", selectedFiles[0]);
        formData.append("settings_json", JSON.stringify(settings));

        progressStatus.textContent = `Converting ${selectedFiles[0].name}…`;
        progressFill.style.width = "40%";

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
        };
        progressFill.style.width = "100%";
        progressStatus.textContent = "Done!";
      }

      // Short delay to show completion
      await new Promise((r) => setTimeout(r, 500));
      progressOverlay.style.display = "none";

      currentJobId = data.job_id;
      renderResults(data);

    } catch (err) {
      progressOverlay.style.display = "none";
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

    // Build result items
    resultsList.innerHTML = "";

    results.forEach((r) => {
      const li = document.createElement("li");
      const hasError = !!r.error;
      const inputName = r.input_path.split(/[/\\]/).pop();
      const outputName = r.output_path.split(/[/\\]/).pop();

      li.className = `result-item${hasError ? " result-item--error" : ""}`;

      if (hasError) {
        li.innerHTML = `
          <div class="file-item-icon file-item-icon--${getExtClass(inputName)}">${getExt(inputName).toUpperCase()}</div>
          <span class="result-name">${inputName}</span>
          <span class="result-error">Error: ${r.error}</span>
        `;
      } else {
        const savingsClass = r.savings_pct > 0 ? "result-savings--positive" : "result-savings--negative";
        const savingsLabel = `${r.savings_pct > 0 ? "-" : "+"}${Math.abs(r.savings_pct).toFixed(1)}%`;

        let badges = "";
        if (r.used_jpeg_lossless) {
          badges += `<span class="result-badge-jpeg">JPEG Lossless</span>`;
        }
        
        const outExt = getExt(outputName);
        if (currentDirection === "to_jxl" && outExt !== "jxl") {
          badges += ` <span class="result-badge-jpeg" style="background: rgba(234, 179, 8, 0.15); color: #eab308; border-color: rgba(234, 179, 8, 0.3);">Fallback: ${outExt.toUpperCase()}</span>`;
        }

        li.innerHTML = `
          <div class="file-item-icon file-item-icon--${getExtClass(outputName)}">${getExt(outputName).toUpperCase()}</div>
          <span class="result-name" title="${inputName} → ${outputName}">
            ${outputName} 
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
  btnClear.addEventListener("click", clearFiles);
  btnConvert.addEventListener("click", convertFiles);
  btnDownloadAll.addEventListener("click", downloadAll);
  btnNew.addEventListener("click", resetToStart);

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  initDropZone();
  checkCapabilities();
  applyPreset("web");
  updateQualityVisibility();
})();
