((app) => {
  "use strict";

  const { els, state, utils } = app;
  const {
    getExt,
    getBaseName,
    getFileDisplayName,
    ellipsizeMiddle,
    isFallbackResult,
  } = utils;

  function showError(message) {
    const btnText = els.btnConvert.querySelector(".btn-text");
    btnText.textContent = `Error: ${message}`;
    btnText.style.color = "#f87171";
    setTimeout(() => {
      btnText.textContent = "Convert";
      btnText.style.color = "";
    }, 4000);
  }

  async function convertFiles() {
    if (state.selectedFiles.length === 0) return;

    const settings = app.settings.buildSettings();
    const isBatch = state.selectedFiles.length > 1;
    app.progress.resetSessionLogViews();
    app.progress.resetProgressSummary(state.selectedFiles.length);

    els.progressOverlay.style.display = "";
    app.progress.setProgressPhase(isBatch ? "Uploading files" : "Uploading file", "Uploading…");
    app.progress.startProgressLoop({ initial: 4, cap: 18 });
    els.btnConvert.querySelector(".btn-text").textContent = "Converting…";
    els.btnConvert.querySelector(".btn-spinner").style.display = "";
    els.btnConvert.disabled = true;
    app.progress.addSessionLog("note", `Queued ${state.selectedFiles.length} file${state.selectedFiles.length === 1 ? "" : "s"} for conversion.`);

    try {
      let data;

      if (isBatch) {
        const formData = new FormData();
        state.selectedFiles.forEach((file) => formData.append("files", file, getFileDisplayName(file)));
        formData.append("settings_json", JSON.stringify(settings));

        app.progress.setProgressPhase("Uploading files", `Uploading ${state.selectedFiles.length} files…`);
        app.progress.setProgressTarget(10, { cap: 18 });

        const res = await fetch("/api/convert-batch", { method: "POST", body: formData });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || "Conversion failed");
        }

        const started = await res.json();
        data = await app.progress.pollBatchJob(started.job_id);
      } else {
        const formData = new FormData();
        formData.append("file", state.selectedFiles[0], getFileDisplayName(state.selectedFiles[0]));
        formData.append("settings_json", JSON.stringify(settings));

        app.progress.setProgressPhase(
          "Converting 0/1",
          `Working on ${ellipsizeMiddle(getFileDisplayName(state.selectedFiles[0]))}…`
        );
        app.progress.setProgressTarget(55, { cap: 82 });
        app.progress.addSessionLog("start", `Started ${getFileDisplayName(state.selectedFiles[0])}.`);

        const res = await fetch("/api/convert", { method: "POST", body: formData });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || "Conversion failed");
        }

        data = await res.json();
        data = {
          job_id: data.job_id,
          results: [data.result],
          total_input_size: data.result.input_size,
          total_output_size: data.result.output_size,
          total_savings_pct: data.result.savings_pct,
          success_count: data.result.error ? 0 : 1,
          error_count: data.result.error ? 1 : 0,
          fallback_count: isFallbackResult(data.result, state.currentDirection) ? 1 : 0,
          total_duration_ms: data.result.duration_ms,
        };

        if (data.results[0].error) {
          state.progressErrorCount = 1;
          app.progress.addSessionLog("error", `${getBaseName(data.results[0].input_path)}: ${data.results[0].error}`);
        } else if (isFallbackResult(data.results[0], state.currentDirection)) {
          state.progressFallbackCount = 1;
          app.progress.addSessionLog("fallback", `${getBaseName(data.results[0].input_path)}: fallback to ${getExt(data.results[0].output_path).toUpperCase()} after size comparison.`);
        } else {
          app.progress.addSessionLog("success", `${getBaseName(data.results[0].input_path)} completed in ${data.results[0].duration_ms.toFixed(0)}ms.`);
        }

        app.progress.updateProgressSummary(1, 1);
        app.progress.setProgressPhase("Finalizing result", "Preparing result…");
        app.progress.finishProgress();
        app.progress.setProgressPhase("Single-file conversion complete", "Done!");
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
      els.progressOverlay.style.display = "none";

      state.currentJobId = data.job_id;
      app.results.renderResults(data);
    } catch (err) {
      app.progress.stopProgressLoop();
      els.progressOverlay.style.display = "none";
      app.progress.addSessionLog("error", err.message);
      showError(err.message);
    } finally {
      els.btnConvert.querySelector(".btn-text").textContent = "Convert";
      els.btnConvert.querySelector(".btn-spinner").style.display = "none";
      els.btnConvert.disabled = false;
    }
  }

  app.conversion = {
    convertFiles,
  };
})(window.JXLApp);
