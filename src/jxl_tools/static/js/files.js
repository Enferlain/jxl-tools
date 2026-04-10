((app) => {
  "use strict";

  const { els, state, utils } = app;
  const {
    formatSize,
    getExt,
    getFileDisplayName,
    getFileId,
    escapeHtml,
    getExtClass,
    isImageFile,
  } = utils;

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

  function showSettings() {
    if (state.currentInputMode !== "upload") return;
    els.settingsPanel.style.display = "";
    els.resultsPanel.style.display = "none";
  }

  function hideSettings() {
    els.settingsPanel.style.display = "none";
  }

  function renderFileList() {
    els.fileCountEl.textContent = state.selectedFiles.length;
    els.fileListEl.innerHTML = "";

    state.selectedFiles.forEach((file, index) => {
      const displayName = getFileDisplayName(file);
      const li = document.createElement("li");
      li.className = "file-item";
      li.innerHTML = `
        <div class="file-item-icon file-item-icon--${getExtClass(file.name)}">${getExt(file.name).toUpperCase()}</div>
        <span class="file-item-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
        <span class="file-item-size">${formatSize(file.size)}</span>
        <button class="file-item-remove" data-index="${index}" title="Remove">×</button>
      `;
      els.fileListEl.appendChild(li);
    });

    els.fileListEl.querySelectorAll(".file-item-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeFile(parseInt(btn.dataset.index, 10));
      });
    });

    els.btnConvert.disabled = state.selectedFiles.length === 0;
  }

  function autoDetectDirection() {
    const jxlCount = state.selectedFiles.filter((file) => getExt(file.name) === "jxl").length;
    if (jxlCount > state.selectedFiles.length / 2) {
      app.settings.setDirection("from_jxl");
    } else {
      app.settings.setDirection("to_jxl");
    }
  }

  function syncLocalPlaceholderState() {
    if (app.local?.updateTargetSummary) {
      app.local.updateTargetSummary();
    }
  }

  function addFiles(files) {
    for (const file of files) {
      const exists = state.selectedFiles.some((selected) => getFileId(selected) === getFileId(file));
      if (!exists) state.selectedFiles.push(file);
    }
    renderFileList();
    syncLocalPlaceholderState();
    showSettings();
    autoDetectDirection();
  }

  function removeFile(index) {
    state.selectedFiles.splice(index, 1);
    renderFileList();
    syncLocalPlaceholderState();
    if (state.selectedFiles.length === 0) hideSettings();
  }

  function clearFiles() {
    state.selectedFiles = [];
    renderFileList();
    syncLocalPlaceholderState();
    hideSettings();
  }

  function setInputMode(mode) {
    state.currentInputMode = mode;

    els.inputModeBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });

    const isUploadMode = mode === "upload";
    document.body.classList.toggle("body--local-workspace", !isUploadMode);
    if (els.mainShell) {
      els.mainShell.classList.toggle("main--local-workspace", !isUploadMode);
    }
    els.localPanel.style.display = isUploadMode ? "none" : "";
    els.uploadPanel.style.display = isUploadMode ? "" : "none";
    if (els.inputModeHeader) {
      els.inputModeHeader.style.display = isUploadMode ? "" : "none";
    }
    syncLocalPlaceholderState();

    els.inputModeDescription.textContent = isUploadMode
      ? "Upload copies into this session, convert them here, then download the results."
      : "Local-first workspace for browsing originals, tuning export settings, and sending results to a target folder.";

    if (isUploadMode) {
      if (state.selectedFiles.length > 0 && els.resultsPanel.style.display === "none") {
        showSettings();
      }
      return;
    }

    hideSettings();
  }

  function resetToStart() {
    state.selectedFiles = [];
    state.currentJobId = null;
    state.localSelection = null;
    state.localTargetPath = null;
    renderFileList();
    app.progress.resetSessionLogViews();
    els.resultsSummaryStrip.innerHTML = "";
    app.results.setResultsView("list");
    els.inputStage.style.display = "";
    els.settingsPanel.style.display = "none";
    els.resultsPanel.style.display = "none";
    els.progressOverlay.style.display = "none";
    els.resultsList.innerHTML = "";
    if (app.local?.renderLocalSelection) {
      app.local.renderLocalSelection();
    }
    if (app.local?.updateTargetSummary) {
      app.local.updateTargetSummary();
    }
    syncLocalPlaceholderState();
    setInputMode("local");
  }

  function initDropZone() {
    let dragCounter = 0;

    els.dropZone.addEventListener("dragenter", (e) => {
      e.preventDefault();
      dragCounter += 1;
      els.dropZone.classList.add("drag-over");
    });

    els.dropZone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      dragCounter -= 1;
      if (dragCounter <= 0) {
        dragCounter = 0;
        els.dropZone.classList.remove("drag-over");
      }
    });

    els.dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
    });

    els.dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      dragCounter = 0;
      els.dropZone.classList.remove("drag-over");
      const files = await collectDroppedFiles(e.dataTransfer);
      if (files.length) addFiles(files);
    });

    els.dropZone.addEventListener("click", (e) => {
      if (e.target.tagName === "LABEL" || e.target.tagName === "INPUT") return;
      els.fileInput.click();
    });

    els.fileInput.addEventListener("change", () => {
      const files = Array.from(els.fileInput.files).filter(isImageFile);
      if (files.length) addFiles(files);
      els.fileInput.value = "";
    });

    els.folderInput.addEventListener("change", () => {
      const files = Array.from(els.folderInput.files).filter(isImageFile);
      if (files.length) addFiles(files);
      els.folderInput.value = "";
    });
  }

  function initInputModeControls() {
    els.inputModeBtns.forEach((btn) => {
      btn.addEventListener("click", () => setInputMode(btn.dataset.mode));
    });

    if (els.btnSwitchToUpload) {
      els.btnSwitchToUpload.addEventListener("click", () => setInputMode("upload"));
    }
  }

  app.files = {
    addFiles,
    clearFiles,
    hideSettings,
    initDropZone,
    initInputModeControls,
    renderFileList,
    resetToStart,
    setInputMode,
    showSettings,
    syncLocalPlaceholderState,
  };
})(window.JXLApp);
