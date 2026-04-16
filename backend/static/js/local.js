((app) => {
  "use strict";

  const { els, state, utils } = app;
  const { escapeHtml, formatSize, getExtClass } = utils;
  const extensionColors = {
    arw: "#5E6AD2",
    png: "#8B95EB",
    jpeg: "#00E676",
    jpg: "#00E676",
    jxl: "#7c8cff",
    webp: "#55c7f7",
    tiff: "#f0b34d",
    tif: "#f0b34d",
    bmp: "#ff7a7a",
  };
  const paneMins = {
    explorer: 280,
    breakdown: 260,
    settings: 320,
    resizers: 2,
  };

  function getWorkbenchWidth() {
    return els.localWorkbench?.getBoundingClientRect().width || 0;
  }

  function getAvailablePaneWidth() {
    return Math.max(0, getWorkbenchWidth() - paneMins.settings - paneMins.resizers);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  function setDisabled(elements, disabled) {
    elements.filter(Boolean).forEach((element) => {
      element.disabled = disabled;
    });
  }

  function applyPaneWidths() {
    if (els.localPaneExplorer) {
      els.localPaneExplorer.style.width = `${state.localExplorerWidth}px`;
    }
    if (els.localPaneBreakdown) {
      els.localPaneBreakdown.style.width = `${state.localBreakdownWidth}px`;
    }
  }

  function normalizePaneWidths() {
    const available = getAvailablePaneWidth();
    if (!available) return;

    const maxExplorer = Math.max(paneMins.explorer, available - paneMins.breakdown);
    state.localExplorerWidth = clamp(state.localExplorerWidth, paneMins.explorer, maxExplorer);

    const maxBreakdown = Math.max(paneMins.breakdown, available - state.localExplorerWidth);
    state.localBreakdownWidth = clamp(state.localBreakdownWidth, paneMins.breakdown, maxBreakdown);

    const overflow = state.localExplorerWidth + state.localBreakdownWidth - available;
    if (overflow > 0) {
      const reducedBreakdown = Math.max(paneMins.breakdown, state.localBreakdownWidth - overflow);
      const remainingOverflow = overflow - (state.localBreakdownWidth - reducedBreakdown);
      state.localBreakdownWidth = reducedBreakdown;
      if (remainingOverflow > 0) {
        state.localExplorerWidth = Math.max(paneMins.explorer, state.localExplorerWidth - remainingOverflow);
      }
    }

    applyPaneWidths();
  }

  function startResizer(which, event) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = which === "left" ? state.localExplorerWidth : state.localBreakdownWidth;
    const available = getAvailablePaneWidth();
    const anchoredCombinedWidth = state.localExplorerWidth + state.localBreakdownWidth;

    const onMouseMove = (moveEvent) => {
      const newWidth = startWidth + (moveEvent.clientX - startX);
      if (which === "left") {
        const maxExplorer = Math.max(
          paneMins.explorer,
          Math.min(anchoredCombinedWidth - paneMins.breakdown, available - paneMins.breakdown)
        );
        state.localExplorerWidth = clamp(newWidth, paneMins.explorer, maxExplorer);
        state.localBreakdownWidth = clamp(
          anchoredCombinedWidth - state.localExplorerWidth,
          paneMins.breakdown,
          Math.max(paneMins.breakdown, available - state.localExplorerWidth)
        );
      } else {
        const maxBreakdown = Math.max(paneMins.breakdown, available - state.localExplorerWidth);
        state.localBreakdownWidth = clamp(newWidth, paneMins.breakdown, maxBreakdown);
      }
      applyPaneWidths();
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function syncLocalSettingsFromShared() {
    const isToJxl = state.currentDirection === "to_jxl";
    els.localDirectionBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === state.currentDirection);
    });

    els.localLosslessToggle.checked = els.losslessToggle.checked;
    els.localQualitySlider.value = els.qualitySlider.value;
    els.localQualityValue.textContent = els.qualitySlider.value;
    els.localEffortSlider.value = els.effortSlider.value;
    els.localEffortValue.textContent = els.effortSlider.value;
    els.localPreserveMetadata.checked = els.preserveMeta.checked;
    els.localJpegLossless.checked = els.jpegLossless.checked;
    els.localJpegLossless.disabled = els.jpegLossless.disabled;
    els.localWorkersSlider.value = els.workersSlider.value;
    els.localWorkersValue.textContent = els.workersSlider.value;
    els.localWorkersSlider.max = els.workersSlider.max;
    els.localThreadsSlider.value = els.threadsSlider.value;
    els.localThreadsValue.textContent = els.threadsSlider.value;
    els.localThreadsSlider.max = els.threadsSlider.max;

    els.localLosslessToggle.disabled = !isToJxl;
    els.localEffortSlider.disabled = !isToJxl;
  }

  function bindLocalSettingsMirrors() {
    els.localDirectionBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        app.settings.setDirection(btn.dataset.value);
        syncLocalSettingsFromShared();
      });
    });

    els.localLosslessToggle.addEventListener("change", () => {
      els.losslessToggle.checked = els.localLosslessToggle.checked;
      els.losslessToggle.dispatchEvent(new Event("change", { bubbles: true }));
      syncLocalSettingsFromShared();
    });

    els.localQualitySlider.addEventListener("input", () => {
      els.qualitySlider.value = els.localQualitySlider.value;
      els.qualitySlider.dispatchEvent(new Event("input", { bubbles: true }));
      syncLocalSettingsFromShared();
    });

    els.localEffortSlider.addEventListener("input", () => {
      els.effortSlider.value = els.localEffortSlider.value;
      els.effortSlider.dispatchEvent(new Event("input", { bubbles: true }));
      syncLocalSettingsFromShared();
    });

    els.localPreserveMetadata.addEventListener("change", () => {
      els.preserveMeta.checked = els.localPreserveMetadata.checked;
    });

    els.localJpegLossless.addEventListener("change", () => {
      if (els.localJpegLossless.disabled) return;
      els.jpegLossless.checked = els.localJpegLossless.checked;
    });

    els.localWorkersSlider.addEventListener("input", () => {
      els.workersSlider.value = els.localWorkersSlider.value;
      els.workersSlider.dispatchEvent(new Event("input", { bubbles: true }));
      syncLocalSettingsFromShared();
    });

    els.localThreadsSlider.addEventListener("input", () => {
      els.threadsSlider.value = els.localThreadsSlider.value;
      els.threadsSlider.dispatchEvent(new Event("input", { bubbles: true }));
      syncLocalSettingsFromShared();
    });
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "Request failed");
    }
    return res.json();
  }

  function renderEmptyLocalSelection() {
    els.localSelectionTree.innerHTML = `
      <div class="local-empty-state">
        <strong class="local-empty-title">No local source selected yet</strong>
        <p class="local-empty-text">Pick files or folders to start building a local export dataset.</p>
      </div>
    `;

    els.localBreakdown.innerHTML = `
      <div class="local-empty-state">
        <strong class="local-empty-title">No breakdown yet</strong>
        <p class="local-empty-text">Extension mix, percentages, and dataset insights will appear here once a local selection exists.</p>
      </div>
    `;

    els.localTotalSize.textContent = "0 B";
    els.localTotalFiles.textContent = "0";
  }

  function buildFolderTree(files) {
    const root = { folders: new Map(), files: [] };

    files.forEach((file) => {
      const relativePath = file.relative_path.split(/[\\/]+/).filter(Boolean);
      if (relativePath.length <= 1) {
        root.files.push(file);
        return;
      }

      let cursor = root;
      relativePath.slice(0, -1).forEach((segment) => {
        if (!cursor.folders.has(segment)) {
          cursor.folders.set(segment, { name: segment, folders: new Map(), files: [] });
        }
        cursor = cursor.folders.get(segment);
      });
      cursor.files.push(file);
    });

    return root;
  }

  function summarizeFolderNode(node) {
    const childFolders = Array.from(node.folders.values());
    const nested = childFolders.map((folder) => summarizeFolderNode(folder));
    return {
      ...node,
      folders: nested,
      totalSize: node.files.reduce((sum, file) => sum + file.size, 0) + nested.reduce((sum, folder) => sum + folder.totalSize, 0),
      fileCount: node.files.length + nested.reduce((sum, folder) => sum + folder.fileCount, 0),
      folderCount: childFolders.length + nested.reduce((sum, folder) => sum + folder.folderCount, 0),
    };
  }

  function renderFileRow(file, depth) {
    const indent = 28 + depth * 20;
    return `
      <div class="local-tree-row local-tree-row--file">
        <div class="local-tree-name local-tree-name--child" style="padding-left:${indent}px;">
          <span class="file-item-icon file-item-icon--${getExtClass(file.name)}">${escapeHtml(file.extension.toUpperCase())}</span>
          <span class="local-tree-name-text" title="${escapeHtml(file.relative_path)}">${escapeHtml(file.name)}</span>
        </div>
        <div class="local-tree-size">${formatSize(file.size)}</div>
        <div class="local-tree-count">-</div>
        <div class="local-tree-count">-</div>
      </div>
    `;
  }

  function renderFolderNode(node, depth) {
    const indent = depth * 20;
    const children = [
      ...node.folders.map((folder) => renderFolderNode(folder, depth + 1)),
      ...node.files.map((file) => renderFileRow(file, depth + 1)),
    ].join("");

    return `
      <details class="local-tree-group" open>
        <summary class="local-tree-row local-tree-row--folder">
          <div class="local-tree-name" style="padding-left:${indent}px;">
            <span class="local-tree-disclosure">⌄</span>
            <span class="local-tree-folder-icon"></span>
            <span class="local-tree-name-text">${escapeHtml(node.name)}</span>
          </div>
          <div class="local-tree-size">${formatSize(node.totalSize)}</div>
          <div class="local-tree-count">${node.fileCount}</div>
          <div class="local-tree-count">${node.folderCount}</div>
        </summary>
        <div class="local-tree-children">${children}</div>
      </details>
    `;
  }

  function renderSelectionRows(selection) {
    els.localSelectionTree.innerHTML = "";
    selection.groups.forEach((group) => {
      const nestedTree = summarizeFolderNode(buildFolderTree(group.files));
      const details = document.createElement("details");
      details.className = "local-tree-group";
      details.open = true;
      details.innerHTML = `
        <summary class="local-tree-row local-tree-row--folder">
          <div class="local-tree-name">
            <span class="local-tree-disclosure">⌄</span>
            <span class="local-tree-folder-icon"></span>
            <span class="local-tree-name-text" title="${escapeHtml(group.folder_path)}">${escapeHtml(group.folder_path)}</span>
          </div>
          <div class="local-tree-size">${formatSize(group.total_size)}</div>
          <div class="local-tree-count">${group.file_count}</div>
          <div class="local-tree-count">${group.folder_count ?? 0}</div>
        </summary>
        <div class="local-tree-children">
          ${nestedTree.folders.map((folder) => renderFolderNode(folder, 1)).join("")}
          ${nestedTree.files.map((file) => renderFileRow(file, 1)).join("")}
        </div>
      `;
      els.localSelectionTree.appendChild(details);
    });
  }

  function renderBreakdownRows(selection) {
    els.localBreakdown.innerHTML = `
      <div class="local-breakdown-rows">
        ${selection.extensions.map((item) => `
          ${(() => {
            const color = extensionColors[item.extension] || "#818cf8";
            return `
          <div class="local-breakdown-row">
            <div class="local-breakdown-ext">
              <span class="local-breakdown-dot" style="background:${color}; box-shadow:0 0 8px ${color};"></span>
              <span>.${escapeHtml(item.extension)}</span>
            </div>
            <div class="local-breakdown-percent-wrap">
              <div class="local-breakdown-bar"><span style="width:${Math.min(100, item.percent || 0)}%; background:${color};"></span></div>
              <span class="local-breakdown-percent">${(item.percent || 0).toFixed((item.percent || 0) >= 10 ? 0 : 1)}%</span>
            </div>
            <div class="local-breakdown-size">${formatSize(item.size)}</div>
            <div class="local-breakdown-count">${item.count}</div>
          </div>
        `;
          })()}
        `).join("")}
      </div>
    `;
    els.localTotalSize.textContent = formatSize(selection.totals.total_size);
    els.localTotalFiles.textContent = selection.totals.file_count.toLocaleString();
  }

  function renderLocalSelection() {
    const selection = state.localSelection;
    if (!selection || !selection.groups?.length) {
      renderEmptyLocalSelection();
      return;
    }

    renderSelectionRows(selection);
    renderBreakdownRows(selection);
  }

  function updateTargetSummary() {
    els.localTargetPath.textContent = state.localTargetPath || "No output folder selected yet";
  }

  async function pickSourceFolder() {
    setDisabled([els.btnLocalPickSource], true);
    try {
      const payload = await fetchJson("/api/local/pick-source-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recursive: els.localRecursive.checked }),
      });
      if (!payload.cancelled) {
        state.localSelection = payload;
        state.localSelectionPaths = payload.picked_paths || [];
        renderLocalSelection();
        app.files.syncLocalPlaceholderState();
      }
    } finally {
      setDisabled([els.btnLocalPickSource], false);
    }
  }

  async function pickSourceFiles() {
    setDisabled([els.btnLocalPickFiles], true);
    try {
      const payload = await fetchJson("/api/local/pick-source-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recursive: els.localRecursive.checked }),
      });
      if (!payload.cancelled) {
        state.localSelection = payload;
        state.localSelectionPaths = payload.picked_paths || [];
        renderLocalSelection();
        app.files.syncLocalPlaceholderState();
      }
    } finally {
      setDisabled([els.btnLocalPickFiles], false);
    }
  }

  async function pickTargetFolder() {
    els.btnLocalPickTarget.disabled = true;
    try {
      const payload = await fetchJson("/api/local/pick-target-folder", { method: "POST" });
      if (!payload.cancelled) {
        state.localTargetPath = payload.path;
        updateTargetSummary();
      }
    } finally {
      els.btnLocalPickTarget.disabled = false;
    }
  }

  async function refreshSelectionForRecursiveToggle() {
    if (!state.localSelectionPaths.length) return;

    els.localRecursive.disabled = true;
    setDisabled([els.btnLocalPickFiles, els.btnLocalPickSource], true);
    try {
      const payload = await fetchJson("/api/local/inspect-selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paths: state.localSelectionPaths,
          recursive: els.localRecursive.checked,
        }),
      });
      state.localSelection = {
        ...payload,
        picked_paths: [...state.localSelectionPaths],
      };
      renderLocalSelection();
    } finally {
      els.localRecursive.disabled = false;
      setDisabled([els.btnLocalPickFiles, els.btnLocalPickSource], false);
    }
  }

  function bindLocalActions() {
    els.btnLocalPickSource.addEventListener("click", pickSourceFolder);
    els.btnLocalPickFiles.addEventListener("click", pickSourceFiles);
    els.btnLocalPickTarget.addEventListener("click", pickTargetFolder);
    els.localRecursive.addEventListener("change", refreshSelectionForRecursiveToggle);
    els.btnLocalRun.addEventListener("click", () => {
      els.btnLocalRun.blur();
    });
    if (els.localResizerLeft) {
      els.localResizerLeft.addEventListener("mousedown", (event) => startResizer("left", event));
    }
    if (els.localResizerMiddle) {
      els.localResizerMiddle.addEventListener("mousedown", (event) => startResizer("middle", event));
    }
  }

  function initLocalPicker() {
    normalizePaneWidths();
    renderEmptyLocalSelection();
    updateTargetSummary();
    bindLocalActions();
    bindLocalSettingsMirrors();
    syncLocalSettingsFromShared();
    window.addEventListener("resize", normalizePaneWidths);
  }

  app.local = {
    initLocalPicker,
    renderLocalSelection,
    syncLocalSettingsFromShared,
    updateTargetSummary,
  };
})(window.JXLApp);
