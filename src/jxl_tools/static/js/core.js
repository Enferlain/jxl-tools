(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const app = {
    $,
    $$,
    els: {
      inputStage: $("#input-stage"),
      inputModeBtns: $$("#input-mode-toggle .toggle-btn"),
      inputModeDescription: $("#input-mode-description"),
      localPanel: $("#local-panel"),
      uploadPanel: $("#upload-panel"),
      btnSwitchToUpload: $("#btn-switch-to-upload"),
      dropZone: $("#drop-zone"),
      fileInput: $("#file-input"),
      folderInput: $("#folder-input"),
      settingsPanel: $("#settings-panel"),
      resultsPanel: $("#results-panel"),
      progressOverlay: $("#progress-overlay"),
      directionBtns: $$("#direction-toggle .toggle-btn"),
      outputFmtGroup: $("#output-format-group"),
      outputFmtSelect: $("#output-format"),
      fallbackHint: $("#jxl-fallback-hint"),
      presetBtns: $$(".preset-btn"),
      losslessToggle: $("#lossless-toggle"),
      qualitySlider: $("#quality-slider"),
      qualityValue: $("#quality-value"),
      qualityGroup: $("#quality-slider-group"),
      effortSlider: $("#effort-slider"),
      effortValue: $("#effort-value"),
      effortGroup: $("#effort-group"),
      qualityCard: $("#quality-card"),
      preserveMeta: $("#preserve-metadata"),
      jpegLossless: $("#jpeg-lossless"),
      jpegHint: $("#jpeg-lossless-hint"),
      workersSlider: $("#workers-slider"),
      workersValue: $("#workers-value"),
      threadsSlider: $("#threads-slider"),
      threadsValue: $("#threads-value"),
      fileCountEl: $("#file-count"),
      fileListEl: $("#file-list"),
      btnAddMore: $("#btn-add-more"),
      btnAddFolder: $("#btn-add-folder"),
      btnClear: $("#btn-clear"),
      btnConvert: $("#btn-convert"),
      btnDownloadAll: $("#btn-download-all"),
      btnNew: $("#btn-new"),
      resultsSummaryStrip: $("#results-summary-strip"),
      resultsViewBtns: $$("#results-view-toggle .view-toggle-btn"),
      statFiles: $("#stat-files"),
      statInputSize: $("#stat-input-size"),
      statOutputSize: $("#stat-output-size"),
      statSavings: $("#stat-savings"),
      resultsList: $("#results-list"),
      resultsLog: $("#results-log"),
      progressEyebrow: $("#progress-eyebrow"),
      progressPercent: $("#progress-percent"),
      progressFilesPill: $("#progress-files-pill"),
      progressFallbacksPill: $("#progress-fallbacks-pill"),
      progressErrorsPill: $("#progress-errors-pill"),
      progressFill: $("#progress-bar-fill"),
      progressStatus: $("#progress-status"),
      badgeCjxl: $("#badge-cjxl"),
    },
    state: {
      selectedFiles: [],
      currentJobId: null,
      currentResultsView: "list",
      currentInputMode: "local",
      currentDirection: "to_jxl",
      currentPreset: "web",
      sessionLogs: [],
      displayedProgress: 0,
      desiredProgress: 0,
      progressSoftCap: 92,
      progressTimer: null,
      progressFallbackCount: 0,
      progressErrorCount: 0,
      capabilities: { cjxl_available: false, djxl_available: false, jpeg_lossless: false },
    },
    utils: {},
  };

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

  function isImageFile(file) {
    const validExts = new Set(["png", "jpg", "jpeg", "webp", "tiff", "tif", "bmp", "jxl"]);
    return validExts.has(getExt(file.name));
  }

  function isFallbackResult(result, direction) {
    return !result.error && direction === "to_jxl" && getExt(result.output_path) !== "jxl";
  }

  app.utils = {
    formatSize,
    getExt,
    getBaseName,
    getFileDisplayName,
    getFileId,
    ellipsizeMiddle,
    escapeHtml,
    getExtClass,
    isImageFile,
    isFallbackResult,
  };

  window.JXLApp = app;
})();
