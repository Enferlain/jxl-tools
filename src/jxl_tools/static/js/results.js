((app) => {
  "use strict";

  const { els, state, utils } = app;
  const {
    formatSize,
    getExt,
    getBaseName,
    escapeHtml,
    getExtClass,
    isFallbackResult,
  } = utils;

  function setResultsView(view) {
    state.currentResultsView = view;
    els.resultsViewBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === view);
    });
    els.resultsList.dataset.view = view;
  }

  function showResults() {
    els.settingsPanel.style.display = "none";
    els.inputStage.style.display = "none";
    els.resultsPanel.style.display = "";
  }

  function downloadFile(filename) {
    if (!state.currentJobId) return;
    const url = `/api/download/${state.currentJobId}/${encodeURIComponent(filename)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadAll() {
    if (!state.currentJobId) return;
    try {
      const res = await fetch(`/api/download-batch/${state.currentJobId}`, { method: "POST" });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jxl-converted-${state.currentJobId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
  }

  function renderResults(data) {
    const { results, total_input_size, total_output_size, total_savings_pct } = data;
    const successCount = data.success_count ?? results.filter((r) => !r.error).length;
    const errorCount = data.error_count ?? results.filter((r) => !!r.error).length;
    const fallbackCount = data.fallback_count ?? results.filter((r) => isFallbackResult(r, state.currentDirection)).length;
    const totalDurationMs = data.total_duration_ms ?? results.reduce((sum, r) => sum + r.duration_ms, 0);

    els.statFiles.textContent = results.length;
    els.statInputSize.textContent = formatSize(total_input_size);
    els.statOutputSize.textContent = formatSize(total_output_size);
    els.statSavings.textContent = `${total_savings_pct > 0 ? "+" : ""}${total_savings_pct.toFixed(1)}%`;

    if (total_savings_pct > 0) {
      els.statSavings.style.color = "var(--success)";
    } else {
      els.statSavings.style.color = "var(--danger)";
    }

    els.resultsSummaryStrip.innerHTML = `
      <span class="summary-pill">${successCount} successful</span>
      <span class="summary-pill">${fallbackCount} fallback${fallbackCount === 1 ? "" : "s"}</span>
      <span class="summary-pill">${errorCount} error${errorCount === 1 ? "" : "s"}</span>
      <span class="summary-pill">${Math.round(totalDurationMs)}ms total active work</span>
    `;

    els.resultsList.innerHTML = "";
    els.resultsList.dataset.view = state.currentResultsView;

    results.forEach((result) => {
      const li = document.createElement("li");
      const hasError = !!result.error;
      const inputName = getBaseName(result.input_path);
      const outputName = getBaseName(result.output_path);

      li.className = `result-item${hasError ? " result-item--error" : ""}`;

      if (hasError) {
        li.innerHTML = `
          <div class="file-item-icon file-item-icon--${getExtClass(inputName)}">${getExt(inputName).toUpperCase()}</div>
          <span class="result-name">${escapeHtml(inputName)}</span>
          <span class="result-error">Error: ${escapeHtml(result.error)}</span>
        `;
      } else {
        const savingsClass = result.savings_pct > 0 ? "result-savings--positive" : "result-savings--negative";
        const savingsLabel = `${result.savings_pct > 0 ? "-" : "+"}${Math.abs(result.savings_pct).toFixed(1)}%`;

        let badges = "";
        if (result.used_jpeg_lossless) {
          badges += `<span class="result-badge-jpeg">JPEG Lossless</span>`;
        }

        const outExt = getExt(outputName);
        if (isFallbackResult(result, state.currentDirection)) {
          badges += ` <span class="result-badge-jpeg" style="background: rgba(234, 179, 8, 0.15); color: #eab308; border-color: rgba(234, 179, 8, 0.3);">Fallback: ${outExt.toUpperCase()}</span>`;
        }

        const meta = result.metadata || {};
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
            ${formatSize(result.input_size)}
            <span class="result-arrow">→</span>
            ${formatSize(result.output_size)}
          </span>
          <span class="result-savings ${savingsClass}">${savingsLabel}</span>
          <span class="result-time">${result.duration_ms.toFixed(0)}ms</span>
          <button class="result-download" data-filename="${outputName}">Download</button>
          <div class="result-meta">
            <span class="result-meta-chip">Input: ${escapeHtml(inputName)}</span>
            <span class="result-meta-chip">Output: ${escapeHtml(outputName)}</span>
            ${metaDetails.map((item) => `<span class="result-meta-chip">${escapeHtml(item)}</span>`).join("")}
          </div>
        `;
      }

      els.resultsList.appendChild(li);
    });

    els.resultsList.querySelectorAll(".result-download").forEach((btn) => {
      btn.addEventListener("click", () => {
        downloadFile(btn.dataset.filename);
      });
    });

    showResults();
  }

  app.results = {
    downloadAll,
    downloadFile,
    renderResults,
    setResultsView,
    showResults,
  };
})(window.JXLApp);
