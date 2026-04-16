import React from 'react';
import { useAppStore } from '../store/useAppStore';

interface HeaderProps {
  hasRunBatch: boolean;
}

export function Header({ hasRunBatch }: HeaderProps) {
  const { currentView, setCurrentView, appMode, setAppMode, capabilities } = useAppStore();

  const capabilityLabel = capabilities
    ? `${capabilities.cjxl_available ? 'cjxl' : 'no-cjxl'} / ${capabilities.djxl_available ? 'djxl' : 'no-djxl'}`
    : 'checking tools';
  const capabilityClasses = capabilities
    ? capabilities.cjxl_available && capabilities.djxl_available
      ? 'border-[#00E676]/30 bg-[#00E676]/10 text-[#00E676]'
      : capabilities.cjxl_available || capabilities.djxl_available
        ? 'border-[#FFB020]/30 bg-[#FFB020]/10 text-[#FFB020]'
        : 'border-[#FF4D4D]/30 bg-[#FF4D4D]/10 text-[#FF4D4D]'
    : 'border-white/10 bg-white/[0.04] text-[#8A8F98]';

  return (
    <header className="flex-none h-14 border-b border-white/[0.06] bg-[#050506] flex items-center justify-between px-6 z-20 relative">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-gradient-to-br from-[#5E6AD2] to-[#434eb0] flex items-center justify-center text-[11px] font-bold text-white shadow-[0_0_10px_rgba(94,106,210,0.3)]">
          JXL
        </div>
        <div>
          <div className="font-semibold text-[#EDEDEF] leading-tight text-sm">JXL Tools</div>
          <div className="text-[10px] text-[#8A8F98]">JPEG XL Conversion Suite</div>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="flex bg-white/[0.04] rounded-lg p-1 border border-white/[0.02]">
          <button 
            onClick={() => { setAppMode('local'); setCurrentView('setup'); }} 
            className={`px-4 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${currentView === 'setup' && appMode === 'local' ? 'bg-[#5E6AD2] text-white shadow-sm' : 'text-[#8A8F98] hover:text-[#EDEDEF]'}`}>
            Local
          </button>
          <button 
            onClick={() => { setAppMode('upload'); setCurrentView('setup'); }} 
            className={`px-4 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${currentView === 'setup' && appMode === 'upload' ? 'bg-[#5E6AD2] text-white shadow-sm' : 'text-[#8A8F98] hover:text-[#EDEDEF]'}`}>
            Upload
          </button>
          {hasRunBatch && (
            <button 
              onClick={() => setCurrentView('results')} 
              className={`px-4 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${currentView === 'results' ? 'bg-[#5E6AD2] text-white shadow-sm' : 'text-[#8A8F98] hover:text-[#EDEDEF]'}`}>
              Results
            </button>
          )}
        </div>
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-medium ${capabilityClasses}`}>
          <div className="w-1.5 h-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
          {capabilityLabel}
        </div>
      </div>
    </header>
  );
}
