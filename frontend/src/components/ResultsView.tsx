import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileImage, HardDrive, Info, RotateCcw, Timer } from 'lucide-react';
import { downloadBatchZip } from '../api';
import { useAppStore } from '../store/useAppStore';
import { exportCsv } from '../utils/export';
import { formatBytes } from '../utils/formatBytes';
import { formatDuration, formatProcessingDuration } from '../utils/formatDuration';

function getFileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function getExt(path: string): string {
  return path.split('.').at(-1)?.toUpperCase() ?? '-';
}

function getStatus(result: { output_path: string; error: string | null; skipped: boolean }): 'success' | 'fallback' | 'error' | 'skipped' {
  if (result.error) return 'error';
  if (result.skipped) return 'skipped';
  return result.output_path.toLowerCase().endsWith('.jxl') ? 'success' : 'fallback';
}

export function ResultsView() {
  const { setCurrentView, setAppMode, conversionResults, jobId, jobStatus } = useAppStore();
  const [resultsViewMode, setResultsViewMode] = useState<'list' | 'detailed'>('list');
  const elapsedWallMs = jobStatus?.started_at_ms && jobStatus?.finished_at_ms
    ? Math.max(0, jobStatus.finished_at_ms - jobStatus.started_at_ms)
    : (jobStatus?.total_duration_ms ?? 0);

  const summary = useMemo(() => {
    const successCount = conversionResults.filter((result) => getStatus(result) === 'success').length;
    const fallbackCount = conversionResults.filter((result) => getStatus(result) === 'fallback').length;
    const errorCount = conversionResults.filter((result) => getStatus(result) === 'error').length;
    const skippedCount = conversionResults.filter((result) => getStatus(result) === 'skipped').length;
    const totalInputSize = jobStatus?.total_input_size ?? conversionResults.reduce((sum, result) => sum + result.input_size, 0);
    const totalOutputSize = jobStatus?.total_output_size ?? conversionResults.reduce((sum, result) => sum + result.output_size, 0);
    const totalSaved = Math.max(0, totalInputSize - totalOutputSize);
    const reduction = totalInputSize > 0 ? (totalSaved / totalInputSize) * 100 : 0;
    return {
      successCount,
      fallbackCount,
      errorCount,
      skippedCount,
      totalInputSize,
      totalOutputSize,
      totalSaved,
      reduction,
    };
  }, [conversionResults, jobStatus]);

  return (
    <main className="flex-1 overflow-y-auto custom-scrollbar relative z-0 bg-[#050506]">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-[#5E6AD2]/5 blur-[120px] pointer-events-none rounded-full" />

      <div className="max-w-6xl mx-auto w-full p-6 md:p-10 flex flex-col gap-8 relative z-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#00E676]/10 border border-[#00E676]/20 text-[#00E676] text-xs font-bold uppercase tracking-wider mb-4">
              <CheckCircle2 size={14} />
              Conversion Complete
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-[#EDEDEF] mb-2">Batch Results</h2>
            <p className="text-[#8A8F98] text-sm">
              Processed {conversionResults.length} files with {summary.successCount} converted, {summary.fallbackCount} fallback{summary.fallbackCount === 1 ? '' : 's'}, {summary.skippedCount} skipped, and {summary.errorCount} error{summary.errorCount === 1 ? '' : 's'}.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setCurrentView('setup'); setAppMode('upload'); }}
              className="px-4 py-2 rounded-lg text-sm font-medium text-[#EDEDEF] bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.06] transition-colors flex items-center gap-2 cursor-pointer"
            >
              <RotateCcw size={16} />
              New Batch
            </button>
            <button
              onClick={() => { if (jobId) void downloadBatchZip(jobId); }}
              disabled={!jobId}
              className="px-4 py-2 rounded-lg text-sm font-bold bg-[#5E6AD2] text-white hover:bg-[#6872D9] shadow-[0_0_0_1px_rgba(94,106,210,0.5),0_4px_12px_rgba(94,106,210,0.3),inset_0_1px_0_0_rgba(255,255,255,0.2)] transition-all active:scale-[0.98] flex items-center gap-2 cursor-pointer disabled:bg-white/[0.05] disabled:text-[#8A8F98] disabled:shadow-none disabled:cursor-not-allowed"
            >
              <Download size={16} />
              Download Archive
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-[#0a0a0c] to-[#050506] border border-white/[0.06] rounded-2xl p-6 shadow-[0_8px_30px_rgba(0,0,0,0.2)] relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#00E676]/5 blur-2xl rounded-full -mr-10 -mt-10 pointer-events-none" />
            <div className="flex items-center gap-3 text-[#8A8F98] mb-4">
              <HardDrive size={18} className="text-[#00E676]" />
              <span className="text-xs font-bold tracking-widest uppercase">Space Saved</span>
            </div>
            <div className="text-4xl font-semibold tracking-tight text-[#EDEDEF] mb-1">{formatBytes(summary.totalSaved)}</div>
            <div className="text-sm text-[#00E676] font-medium">{summary.reduction.toFixed(1)}% reduction</div>
          </div>

          <div className="bg-gradient-to-br from-[#0a0a0c] to-[#050506] border border-white/[0.06] rounded-2xl p-6 shadow-[0_8px_30px_rgba(0,0,0,0.2)]">
            <div className="flex items-center gap-3 text-[#8A8F98] mb-4">
              <FileImage size={18} className="text-[#5E6AD2]" />
              <span className="text-xs font-bold tracking-widest uppercase">Files Processed</span>
            </div>
            <div className="text-4xl font-semibold tracking-tight text-[#EDEDEF] mb-1">{conversionResults.length.toLocaleString()}</div>
            <div className="flex gap-3 text-xs">
              <span className="text-[#00E676]">{summary.successCount} OK</span>
              <span className="text-[#FFB020]">{summary.fallbackCount} Fallback</span>
              <span className="text-[#8A8F98]">{summary.skippedCount} Skipped</span>
              <span className="text-[#8A8F98]">{summary.errorCount} Errors</span>
            </div>
          </div>

          <div className="bg-gradient-to-br from-[#0a0a0c] to-[#050506] border border-white/[0.06] rounded-2xl p-6 shadow-[0_8px_30px_rgba(0,0,0,0.2)]">
            <div className="flex items-center gap-3 text-[#8A8F98] mb-4">
              <Timer size={18} className="text-[#5E6AD2]" />
              <span className="text-xs font-bold tracking-widest uppercase">Time Elapsed</span>
            </div>
            <div className="text-4xl font-semibold tracking-tight text-[#EDEDEF] mb-1">
              {formatDuration(elapsedWallMs)}
            </div>
            <div className="text-sm text-[#8A8F98]">
              {conversionResults.length > 0
                ? `~${formatProcessingDuration((jobStatus?.total_duration_ms ?? 0) / conversionResults.length)} per file`
                : 'No file timings yet'}
            </div>
          </div>
        </div>

        <div className="bg-[#0a0a0c]/80 backdrop-blur-xl border border-white/[0.06] rounded-2xl overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.4)] flex flex-col">
          <div className="p-5 border-b border-white/[0.06] bg-white/[0.02] flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-sm font-semibold text-[#EDEDEF]">Conversion Log</div>
              <div className="flex bg-[#050506] rounded-lg p-1 border border-white/[0.06] shadow-inner">
                <button onClick={() => setResultsViewMode('list')} className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${resultsViewMode === 'list' ? 'bg-[#5E6AD2] text-white shadow-[0_2px_8px_rgba(94,106,210,0.25)]' : 'text-[#8A8F98] hover:text-[#EDEDEF]'}`}>List</button>
                <button onClick={() => setResultsViewMode('detailed')} className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${resultsViewMode === 'detailed' ? 'bg-[#5E6AD2] text-white shadow-[0_2px_8px_rgba(94,106,210,0.25)]' : 'text-[#8A8F98] hover:text-[#EDEDEF]'}`}>Detailed</button>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {jobStatus?.session_log_path && (
                <div className="text-xs text-[#8A8F98]" title={jobStatus.session_log_path}>
                  Session log saved to output folder
                </div>
              )}
              <button onClick={() => exportCsv(conversionResults)} className="text-xs text-[#5E6AD2] hover:text-[#6872D9] font-medium transition-colors cursor-pointer">Export CSV</button>
            </div>
          </div>

          {resultsViewMode === 'list' ? (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-[#050506] text-[#8A8F98] font-mono tracking-wider uppercase text-[10px]">
                    <th className="px-6 py-3 font-medium">File Name</th>
                    <th className="px-6 py-3 font-medium">Format</th>
                    <th className="px-6 py-3 font-medium">Original Size</th>
                    <th className="px-6 py-3 font-medium">Converted Size</th>
                    <th className="px-6 py-3 font-medium">Savings</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {conversionResults.map((res, i) => {
                    const status = getStatus(res);
                    return (
                      <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                        <td className="px-6 py-3 font-mono text-[#EDEDEF]">{getFileName(res.input_path)}</td>
                        <td className="px-6 py-3 font-mono text-[#8A8F98]"><span className="text-[#EDEDEF]">{getExt(res.input_path)}</span> <span className="text-[#5E6AD2] opacity-0 group-hover:opacity-100 transition-opacity">→</span> <span className="text-[#EDEDEF]">{status === 'skipped' ? 'SKIP' : getExt(res.output_path)}</span></td>
                        <td className="px-6 py-3 text-[#8A8F98]">{formatBytes(res.input_size)}</td>
                        <td className="px-6 py-3 text-[#EDEDEF]">{status === 'skipped' ? '—' : formatBytes(res.output_size)}</td>
                        <td className={`px-6 py-3 ${status === 'skipped' ? 'text-[#8A8F98]' : res.savings_pct >= 0 ? 'text-[#00E676]' : 'text-[#FFB020]'}`}>{status === 'skipped' ? '—' : `${res.savings_pct.toFixed(1)}%`}</td>
                        <td className="px-6 py-3">
                          {status === 'success' && <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#00E676]/10 text-[#00E676] text-[10px] font-bold uppercase tracking-wider"><CheckCircle2 size={12}/> Success</span>}
                          {status === 'fallback' && <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#FFB020]/10 text-[#FFB020] text-[10px] font-bold uppercase tracking-wider"><Info size={12}/> Fallback</span>}
                          {status === 'skipped' && <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.05] text-[#8A8F98] text-[10px] font-bold uppercase tracking-wider"><Info size={12}/> Skipped</span>}
                          {status === 'error' && <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#FF4D4D]/10 text-[#FF4D4D] text-[10px] font-bold uppercase tracking-wider"><AlertTriangle size={12}/> Error</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-white/[0.06]">
              {conversionResults.map((res, i) => {
                const status = getStatus(res);
                return (
                  <div key={i} className="p-6 hover:bg-white/[0.02] transition-colors flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="font-mono text-sm text-[#EDEDEF]">{getFileName(res.input_path)}</div>
                        <div className="text-xs font-mono text-[#8A8F98] bg-white/[0.03] px-2 py-1 rounded border border-white/[0.04]">
                          {getExt(res.input_path)} <span className="text-[#5E6AD2]">→</span> {status === 'skipped' ? 'SKIP' : getExt(res.output_path)}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className={`text-sm font-medium ${status === 'skipped' ? 'text-[#8A8F98]' : res.savings_pct >= 0 ? 'text-[#00E676]' : 'text-[#FFB020]'}`}>{status === 'skipped' ? 'Skipped' : `${res.savings_pct.toFixed(1)}%`}</div>
                        <div>
                          {status === 'success' && <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#00E676]/10 text-[#00E676] text-[10px] font-bold uppercase tracking-wider"><CheckCircle2 size={12}/> Success</span>}
                          {status === 'fallback' && <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#FFB020]/10 text-[#FFB020] text-[10px] font-bold uppercase tracking-wider"><Info size={12}/> Fallback</span>}
                          {status === 'skipped' && <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.05] text-[#8A8F98] text-[10px] font-bold uppercase tracking-wider"><Info size={12}/> Skipped</span>}
                          {status === 'error' && <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#FF4D4D]/10 text-[#FF4D4D] text-[10px] font-bold uppercase tracking-wider"><AlertTriangle size={12}/> Error</span>}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-5 gap-6 text-xs bg-white/[0.01] p-4 rounded-xl border border-white/[0.04]">
                      <div className="md:col-span-2">
                        <div className="text-[#8A8F98] mb-1 font-medium">File Path</div>
                        <div className="font-mono text-[#EDEDEF] truncate" title={res.input_path}>{res.input_path}</div>
                      </div>
                      <div>
                        <div className="text-[#8A8F98] mb-1 font-medium">Resolution</div>
                        <div className="text-[#EDEDEF]">{res.metadata ? `${res.metadata.dimensions[0]}x${res.metadata.dimensions[1]}` : 'Unknown'}</div>
                      </div>
                      <div>
                        <div className="text-[#8A8F98] mb-1 font-medium">Color Profile</div>
                        <div className="text-[#EDEDEF]">{res.metadata?.icc_description || 'Unknown'}</div>
                      </div>
                      <div>
                        <div className="text-[#8A8F98] mb-1 font-medium">Processing Time</div>
                        <div className="text-[#EDEDEF]">{formatProcessingDuration(res.duration_ms)}</div>
                      </div>
                    </div>

                    {res.error && (
                      <div className="p-3 bg-[#FF4D4D]/10 text-[#FF4D4D] rounded-lg border border-[#FF4D4D]/20 flex items-center gap-2 text-xs">
                        <AlertTriangle size={14} />
                        <span className="font-medium">Error Details:</span> {res.error}
                      </div>
                    )}
                    {res.skipped && res.skip_reason && (
                      <div className="p-3 bg-white/[0.03] text-[#8A8F98] rounded-lg border border-white/[0.06] flex items-center gap-2 text-xs">
                        <Info size={14} />
                        <span className="font-medium">Skipped:</span> {res.skip_reason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
