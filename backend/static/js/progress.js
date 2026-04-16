((app) => {
  "use strict";

  const { els, state, utils } = app;
  const {
    formatSize,
    getExt,
    getBaseName,
    ellipsizeMiddle,
    isFallbackResult,
  } = utils;

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
    state.sessionLogs.push({ kind, message });
    if (state.sessionLogs.length > 200) state.sessionLogs.shift();
    renderLogList(els.resultsLog, state.sessionLogs);
  }

  function resetSessionLogViews() {
    state.sessionLogs = [];
    renderLogList(els.resultsLog, state.sessionLogs);
  }

  function updateProgressSummary(completed, total) {
    els.progressFilesPill.textContent = `${completed} / ${total} files`;
    els.progressFallbacksPill.textContent = `${state.progressFallbackCount} fallback${state.progressFallbackCount === 1 ? "" : "s"}`;
    els.progressErrorsPill.textContent = `${state.progressErrorCount} error${state.progressErrorCount === 1 ? "" : "s"}`;
  }

  function resetProgressSummary(total) {
    state.progressFallbackCount = 0;
    state.progressErrorCount = 0;
    updateProgressSummary(0, total);
  }

  function syncProgressDisplay(value, { indeterminate = false } = {}) {
    state.displayedProgress = Math.max(0, Math.min(100, value));
    els.progressPercent.textContent = `${Math.round(state.displayedProgress)}%`;
    els.progressFill.classList.toggle("is-indeterminate", indeterminate);
    els.progressFill.style.width = `${state.displayedProgress}%`;
  }

  function stopProgressLoop() {
    if (state.progressTimer !== null) {
      clearInterval(state.progressTimer);
      state.progressTimer = null;
    }
  }

  function startProgressLoop({ initial = 4, cap = 92 } = {}) {
    stopProgressLoop();
    state.desiredProgress = initial;
    state.progressSoftCap = cap;
    syncProgressDisplay(initial);

    state.progressTimer = window.setInterval(() => {
      if (state.displayedProgress >= state.desiredProgress) {
        return;
      }

      const next = Math.min(
        state.desiredProgress,
        state.displayedProgress + Math.max(0.8, (state.desiredProgress - state.displayedProgress) * 0.18)
      );

      syncProgressDisplay(Math.min(next, state.progressSoftCap));
    }, 140);
  }

  function setProgressTarget(percent, { cap = state.progressSoftCap } = {}) {
    state.desiredProgress = Math.max(state.desiredProgress, Math.max(0, Math.min(100, percent)));
    state.progressSoftCap = Math.max(state.desiredProgress, Math.max(0, Math.min(99, cap)));
  }

  function finishProgress() {
    stopProgressLoop();
    state.desiredProgress = 100;
    state.progressSoftCap = 100;
    syncProgressDisplay(100);
  }

  function setProgressPhase(phase, detail = "") {
    els.progressEyebrow.textContent = phase;
    els.progressStatus.textContent = detail || phase;
  }

  function computeLivePercent(completed, total, active) {
    if (!total) return 0;
    const inFlightWeight = Math.min(active, total - completed) * 0.08;
    return Math.min(99, ((completed + inFlightWeight) / total) * 100);
  }

  async function pollBatchJob(jobId) {
    let lastEventIndex = 0;

    while (true) {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Could not read batch progress");
      }

      const jobState = await res.json();
      const events = jobState.events || [];

      for (const event of events.slice(lastEventIndex)) {
        if (event.type === "job_started") {
          els.progressEyebrow.textContent = "Preparing batch";
          setProgressTarget(12, { cap: 20 });
          updateProgressSummary(0, event.total);
          els.progressStatus.textContent = `Ready to convert ${event.total} file${event.total === 1 ? "" : "s"}.`;
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
            state.progressErrorCount += 1;
          } else if (event.result && isFallbackResult(event.result, state.currentDirection)) {
            state.progressFallbackCount += 1;
          }

          updateProgressSummary(event.completed, event.total);
          let msg = `Processed ${event.completed}/${event.total} — ${ellipsizeMiddle(justFinished)}`;

          if (event.result && isFallbackResult(event.result, state.currentDirection)) {
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

          els.progressEyebrow.textContent = `Converting ${event.completed}/${event.total}`;
          els.progressStatus.textContent = msg;
        } else if (event.type === "job_error") {
          addSessionLog("error", event.message || "Unexpected batch failure.");
        }
      }

      lastEventIndex = events.length;

      const livePct = computeLivePercent(jobState.completed, jobState.total, jobState.active);
      setProgressTarget(livePct, { cap: jobState.done ? 100 : 98 });
      updateProgressSummary(jobState.completed, jobState.total);

      if (jobState.done) {
        setProgressPhase("Finalizing results", "Preparing results…");
        finishProgress();
        setProgressPhase("Batch complete", "Done!");
        return jobState;
      }

      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }

  app.progress = {
    renderLogList,
    addSessionLog,
    resetSessionLogViews,
    resetProgressSummary,
    updateProgressSummary,
    stopProgressLoop,
    startProgressLoop,
    setProgressTarget,
    finishProgress,
    setProgressPhase,
    pollBatchJob,
  };
})(window.JXLApp);
