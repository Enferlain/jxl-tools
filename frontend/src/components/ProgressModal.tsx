import React from 'react';
import { Pause, Loader2, CheckCircle2, FileImage, Info, AlertTriangle, Play, Clock3, Layers3, ListOrdered } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { formatDuration } from '../utils/formatDuration';

interface ProgressModalProps {
  isConverting: boolean;
  progress: number;
  isPaused: boolean;
  canPause: boolean;
  progressPhase: string;
  progressDetail: string;
  elapsedMs: number;
  activeCount: number;
  queuedCount: number;
  stats: { completed: number; total: number; fallbacks: number; errors: number };
  logs: { time: number; message: string; kind: 'info' | 'success' | 'error' | 'fallback' | 'start' | 'skipped' }[];
  showCancelConfirm: boolean;
  setShowCancelConfirm: (show: boolean) => void;
  cancelConversion: () => void;
  togglePause: () => void;
  setIsConverting: (converting: boolean) => void;
}

export function ProgressModal({
  isConverting,
  progress,
  isPaused,
  canPause,
  progressPhase,
  progressDetail,
  elapsedMs,
  activeCount,
  queuedCount,
  stats,
  logs,
  showCancelConfirm,
  setShowCancelConfirm,
  cancelConversion,
  togglePause,
  setIsConverting
}: ProgressModalProps) {
  const { setCurrentView } = useAppStore();

  if (!isConverting) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#020203]/80 backdrop-blur-md transition-all duration-300">
      <div className="w-full max-w-2xl bg-[#0a0a0c] border border-white/[0.08] rounded-2xl shadow-[0_16px_64px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.02)] overflow-hidden flex flex-col">
        
        {/* Header & Progress Bar */}
        <div className="p-6 md:p-8 border-b border-white/[0.06] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-[#5E6AD2]/10 to-transparent opacity-50 pointer-events-none" />
          
          <div className="relative z-10 flex items-end justify-between mb-6">
            <div>
              <div className="text-[#5E6AD2] font-mono text-[10px] tracking-widest uppercase font-bold mb-2 flex items-center gap-2">
                {progress < 100 ? (isPaused ? <Pause size={12} /> : <Loader2 size={12} className="animate-spin" />) : <CheckCircle2 size={12} />}
                {isPaused ? "Paused" : progressPhase}
              </div>
              <div className="text-[#EDEDEF] text-lg font-medium tracking-tight">
                {progressDetail}
              </div>
            </div>
            <div className="text-4xl font-light tracking-tighter text-[#EDEDEF] tabular-nums">
              {Math.round(progress)}<span className="text-xl text-[#8A8F98]">%</span>
            </div>
          </div>

          {/* Progress Track */}
          <div className="relative z-10 h-2 bg-white/[0.04] rounded-full overflow-hidden shadow-inner">
            <div 
              className={`h-full bg-[#5E6AD2] rounded-full transition-all duration-300 ease-out relative ${isPaused ? 'opacity-50' : ''}`}
              style={{ width: `${progress}%` }}
            >
              {!isPaused && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent w-full -translate-x-full animate-[shimmer_1.5s_infinite]" />}
            </div>
          </div>
        </div>

        {/* Stats Pills */}
        <div className="px-6 py-4 bg-[#050506] border-b border-white/[0.06] flex gap-3 overflow-x-auto custom-scrollbar">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04] text-xs text-[#EDEDEF] whitespace-nowrap">
            <FileImage size={14} className="text-[#8A8F98]" />
            {stats.completed} / {stats.total} files
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04] text-xs text-[#EDEDEF] whitespace-nowrap">
            <Layers3 size={14} className="text-[#5E6AD2]" />
            {activeCount} active
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04] text-xs text-[#EDEDEF] whitespace-nowrap">
            <ListOrdered size={14} className="text-[#8A8F98]" />
            {queuedCount} queued
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04] text-xs text-[#EDEDEF] whitespace-nowrap">
            <Clock3 size={14} className="text-[#8A8F98]" />
            {formatDuration(elapsedMs)}
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs whitespace-nowrap transition-colors ${stats.fallbacks > 0 ? 'bg-[#FFB020]/10 border-[#FFB020]/20 text-[#FFB020]' : 'bg-white/[0.03] border-white/[0.04] text-[#8A8F98]'}`}>
            <Info size={14} />
            {stats.fallbacks} fallback{stats.fallbacks !== 1 ? 's' : ''}
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs whitespace-nowrap transition-colors ${stats.errors > 0 ? 'bg-[#FF4D4D]/10 border-[#FF4D4D]/20 text-[#FF4D4D]' : 'bg-white/[0.03] border-white/[0.04] text-[#8A8F98]'}`}>
            <AlertTriangle size={14} />
            {stats.errors} error{stats.errors !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Terminal Log */}
        <div className="h-64 bg-[#020203] p-4 overflow-y-auto custom-scrollbar font-mono text-[11px] leading-relaxed flex flex-col-reverse">
          {logs.map((log, i) => (
            <div key={i} className={`py-0.5 flex gap-3 ${
              log.kind === 'error' ? 'text-[#FF4D4D]' :
              log.kind === 'fallback' ? 'text-[#FFB020]' :
              log.kind === 'skipped' ? 'text-[#8A8F98]' :
              log.kind === 'success' ? 'text-[#00E676]' :
              log.kind === 'start' ? 'text-[#EDEDEF]' :
              'text-[#8A8F98]'
            }`}>
              <span className="opacity-50 select-none flex-none">[{new Date(log.time).toLocaleTimeString([], {hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit'})}]</span>
              <span className="break-all">{log.message}</span>
            </div>
          ))}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-white/[0.06] bg-[#0a0a0c] flex justify-between items-center gap-3">
          {showCancelConfirm ? (
            <>
              <span className="text-sm text-[#EDEDEF] font-medium pl-2">Are you sure you want to cancel?</span>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowCancelConfirm(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-[#8A8F98] hover:text-[#EDEDEF] hover:bg-white/[0.04] transition-colors cursor-pointer">
                  No, continue
                </button>
                <button 
                  onClick={cancelConversion}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-[#FF4D4D]/10 text-[#FF4D4D] hover:bg-[#FF4D4D]/20 transition-colors cursor-pointer">
                  Yes, cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex gap-3">
                {progress < 100 ? (
                  <button 
                    onClick={() => setShowCancelConfirm(true)}
                    className="px-4 py-2 rounded-lg text-xs font-medium text-[#8A8F98] hover:text-[#EDEDEF] hover:bg-white/[0.04] transition-colors cursor-pointer">
                    Cancel
                  </button>
                ) : (
                  <button 
                    onClick={cancelConversion}
                    className="px-4 py-2 rounded-lg text-xs font-medium text-[#8A8F98] hover:text-[#EDEDEF] hover:bg-white/[0.04] transition-colors cursor-pointer">
                    Close
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                {progress < 100 && canPause && (
                  <button 
                    onClick={togglePause}
                    className="px-4 py-2 rounded-lg text-xs font-medium text-[#EDEDEF] bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.06] transition-colors flex items-center gap-2 cursor-pointer">
                    {isPaused ? <Play size={14} /> : <Pause size={14} />}
                    {isPaused ? "Resume" : "Pause"}
                  </button>
                )}
                <button 
                  disabled={progress < 100}
                  onClick={() => { setIsConverting(false); setCurrentView('results'); }}
                  className={`px-6 py-2 rounded-lg text-xs font-bold transition-all ${
                    progress >= 100 
                      ? 'bg-[#5E6AD2] text-white hover:bg-[#6872D9] shadow-[0_0_0_1px_rgba(94,106,210,0.5),0_4px_12px_rgba(94,106,210,0.3),inset_0_1px_0_0_rgba(255,255,255,0.2)] cursor-pointer' 
                      : 'bg-white/[0.02] text-[#8A8F98] border border-white/[0.04] cursor-not-allowed'
                  }`}>
                  View Results
                </button>
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
}
