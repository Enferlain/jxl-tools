(() => {
  "use strict";

  const app = window.JXLApp;
  const { els } = app;

  els.btnAddMore.addEventListener("click", () => els.fileInput.click());
  els.btnAddFolder.addEventListener("click", () => els.folderInput.click());
  els.btnClear.addEventListener("click", app.files.clearFiles);
  els.btnConvert.addEventListener("click", app.conversion.convertFiles);
  els.btnDownloadAll.addEventListener("click", app.results.downloadAll);
  els.btnNew.addEventListener("click", app.files.resetToStart);

  els.resultsViewBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      app.results.setResultsView(btn.dataset.view);
    });
  });

  app.files.initInputModeControls();
  app.files.initDropZone();
  app.local.initLocalPicker();
  app.settings.initSettingsControls();
  app.settings.checkCapabilities();
  app.settings.applyPreset("web");
  app.settings.updateQualityVisibility();
  app.results.setResultsView("list");
  app.files.syncLocalPlaceholderState();
  app.files.setInputMode("local");
})();
