import React, { useEffect } from 'react';
import { Header } from './components/Header';
import { LocalModeView } from './components/LocalModeView';
import { UploadModeView } from './components/UploadModeView';
import { ResultsView } from './components/ResultsView';
import { ProgressModal } from './components/ProgressModal';
import { useConversionEngine } from './hooks/useConversionEngine';
import { useAppStore } from './store/useAppStore';
import { fetchCapabilities } from './api';

export default function App() {
  const { currentView, appMode, setCapabilities, updateSettings } = useAppStore();

  const engine = useConversionEngine();

  useEffect(() => {
    let isMounted = true;

    void fetchCapabilities()
      .then((capabilities) => {
        if (!isMounted) return;
        setCapabilities(capabilities);
        updateSettings({
          workers: capabilities.default_workers,
          threads: capabilities.default_jxl_threads,
          byteExact: capabilities.jpeg_lossless,
        });
      })
      .catch(() => {
        if (!isMounted) return;
        setCapabilities(null);
      });

    return () => {
      isMounted = false;
    };
  }, [setCapabilities, updateSettings]);

  return (
    <div className="h-screen w-full bg-[#050506] text-[#EDEDEF] flex flex-col font-sans overflow-hidden selection:bg-[#5E6AD2]/30">
      <Header 
        hasRunBatch={engine.hasRunBatch} 
      />

      {currentView === 'setup' ? (
        appMode === 'local' ? (
          <LocalModeView 
            startConversion={engine.startConversion} 
          />
        ) : (
          <UploadModeView 
            startConversion={engine.startConversion} 
          />
        )
      ) : (
        <ResultsView />
      )}

      <ProgressModal 
        isConverting={engine.isConverting}
        progress={engine.progress}
        isPaused={engine.isPaused}
        progressPhase={engine.progressPhase}
        progressDetail={engine.progressDetail}
        elapsedMs={engine.elapsedMs}
        activeCount={engine.activeCount}
        queuedCount={engine.queuedCount}
        stats={engine.stats}
        logs={engine.logs}
        showCancelConfirm={engine.showCancelConfirm}
        setShowCancelConfirm={engine.setShowCancelConfirm}
        cancelConversion={engine.cancelConversion}
        togglePause={engine.togglePause}
        setIsConverting={engine.setIsConverting}
        canPause={engine.canPause}
      />
    </div>
  );
}
