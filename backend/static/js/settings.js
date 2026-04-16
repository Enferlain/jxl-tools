((app) => {
  "use strict";

  const { els, state } = app;

  const presets = {
    fast: { lossless: false, quality: 70, effort: 1 },
    web: { lossless: false, quality: 80, effort: 4 },
    archive: { lossless: true, quality: 100, effort: 7 },
    custom: null,
  };

  function updateSettingsForDirection() {
    const isFromJxl = state.currentDirection === "from_jxl";
    const outFmt = els.outputFmtSelect.value;

    els.presetBtns.forEach((btn) => { btn.disabled = isFromJxl; });
    els.losslessToggle.disabled = isFromJxl;
    els.effortSlider.disabled = isFromJxl;
    els.effortGroup.style.opacity = isFromJxl ? "0.35" : "";

    const qualityDisabled = isFromJxl && !["jpeg", "webp"].includes(outFmt);
    els.qualitySlider.disabled = qualityDisabled;
    els.qualityGroup.style.opacity = qualityDisabled ? "0.35" : "";

    const jpegLosslessDisabled = isFromJxl && outFmt !== "jpeg";
    if (jpegLosslessDisabled) {
      els.jpegLossless.disabled = true;
    } else if (state.capabilities.jpeg_lossless) {
      els.jpegLossless.disabled = false;
    }

    els.qualityCard.style.opacity = isFromJxl && qualityDisabled ? "0.5" : "";
    if (app.local?.syncLocalSettingsFromShared) {
      app.local.syncLocalSettingsFromShared();
    }
  }

  function setDirection(dir) {
    state.currentDirection = dir;
    els.directionBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === dir);
    });
    els.outputFmtGroup.style.display = dir === "from_jxl" ? "" : "none";
    if (els.fallbackHint) {
      els.fallbackHint.style.display = dir === "to_jxl" ? "" : "none";
    }
    updateSettingsForDirection();
    if (app.local?.syncLocalSettingsFromShared) {
      app.local.syncLocalSettingsFromShared();
    }
  }

  function updateQualityVisibility() {
    els.qualityGroup.style.display = els.losslessToggle.checked ? "none" : "";
    if (app.local?.syncLocalSettingsFromShared) {
      app.local.syncLocalSettingsFromShared();
    }
  }

  function applyPreset(name) {
    state.currentPreset = name;
    els.presetBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.preset === name);
    });

    const preset = presets[name];
    if (!preset) return;

    els.losslessToggle.checked = preset.lossless;
    els.qualitySlider.value = preset.quality;
    els.qualityValue.textContent = preset.quality;
    els.effortSlider.value = preset.effort;
    els.effortValue.textContent = preset.effort;
    updateQualityVisibility();
  }

  function switchToCustom() {
    if (state.currentPreset !== "custom") {
      state.currentPreset = "custom";
      els.presetBtns.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.preset === "custom");
      });
    }
  }

  function buildSettings() {
    return {
      lossless: els.losslessToggle.checked,
      quality: parseInt(els.qualitySlider.value, 10),
      effort: parseInt(els.effortSlider.value, 10),
      preserve_metadata: els.preserveMeta.checked,
      jpeg_lossless: els.jpegLossless.checked && state.capabilities.jpeg_lossless,
      output_format: els.outputFmtSelect.value,
      direction: state.currentDirection,
      workers: parseInt(els.workersSlider.value, 10),
      jxl_threads: parseInt(els.threadsSlider.value, 10),
    };
  }

  async function checkCapabilities() {
    try {
      const res = await fetch("/api/capabilities");
      if (res.ok) {
        state.capabilities = await res.json();
      }
    } catch {
      // ignore
    }

    if (state.capabilities.jpeg_lossless) {
      els.badgeCjxl.classList.remove("badge--inactive");
      els.badgeCjxl.classList.add("badge--active");
      els.jpegLossless.disabled = false;
      els.jpegHint.textContent = "Reconstructs the original JPEG stream byte-for-byte.";
    } else {
      els.jpegLossless.disabled = true;
      els.jpegLossless.checked = false;
    }

    const defaultWorkers = state.capabilities.default_workers || Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
    const maxWorkers = Math.min(navigator.hardwareConcurrency || 4, 16);
    els.workersSlider.max = maxWorkers;
    els.workersSlider.value = Math.min(defaultWorkers, maxWorkers);
    els.workersValue.textContent = els.workersSlider.value;

    const defaultThreads = Math.min(state.capabilities.default_jxl_threads || 1, 16);
    els.threadsSlider.max = maxWorkers;
    els.threadsSlider.value = defaultThreads;
    els.threadsValue.textContent = els.threadsSlider.value;
    if (app.local?.syncLocalSettingsFromShared) {
      app.local.syncLocalSettingsFromShared();
    }
  }

  function initSettingsControls() {
    els.directionBtns.forEach((btn) => {
      btn.addEventListener("click", () => setDirection(btn.dataset.value));
    });

    els.outputFmtSelect.addEventListener("change", updateSettingsForDirection);

    els.presetBtns.forEach((btn) => {
      btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
    });

    els.losslessToggle.addEventListener("change", () => {
      updateQualityVisibility();
      switchToCustom();
    });

    els.qualitySlider.addEventListener("input", () => {
      els.qualityValue.textContent = els.qualitySlider.value;
      switchToCustom();
      if (app.local?.syncLocalSettingsFromShared) {
        app.local.syncLocalSettingsFromShared();
      }
    });

    els.effortSlider.addEventListener("input", () => {
      els.effortValue.textContent = els.effortSlider.value;
      switchToCustom();
      if (app.local?.syncLocalSettingsFromShared) {
        app.local.syncLocalSettingsFromShared();
      }
    });

    els.workersSlider.addEventListener("input", () => {
      els.workersValue.textContent = els.workersSlider.value;
      if (app.local?.syncLocalSettingsFromShared) {
        app.local.syncLocalSettingsFromShared();
      }
    });

    els.threadsSlider.addEventListener("input", () => {
      els.threadsValue.textContent = els.threadsSlider.value;
      if (app.local?.syncLocalSettingsFromShared) {
        app.local.syncLocalSettingsFromShared();
      }
    });
  }

  app.settings = {
    applyPreset,
    buildSettings,
    checkCapabilities,
    initSettingsControls,
    setDirection,
    updateQualityVisibility,
  };
})(window.JXLApp);
