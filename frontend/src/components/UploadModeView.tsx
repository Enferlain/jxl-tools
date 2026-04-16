import React, { useMemo, useRef, useState } from 'react';
import { Upload, X, Settings } from 'lucide-react';
import { ConversionSettingsPanel } from './ConversionSettingsPanel';
import { useAppStore } from '../store/useAppStore';
import { formatBytes } from '../utils/formatBytes';

interface Props {
  startConversion: () => void;
}

export function UploadModeView({ startConversion }: Props) {
  const { uploadFiles, addUploadFiles, removeUploadFile, clearUploadFiles } = useAppStore();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const totalSize = useMemo(
    () => uploadFiles.reduce((sum, file) => sum + file.size, 0),
    [uploadFiles],
  );

  const queueFiles = (files: FileList | null) => {
    if (!files) return;
    addUploadFiles(Array.from(files));
  };

  return (
    <main className="flex-1 overflow-y-auto custom-scrollbar relative z-0 bg-[#050506]">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-[#5E6AD2]/5 blur-[120px] pointer-events-none rounded-full" />
      
      <div className="max-w-7xl mx-auto w-full p-6 md:p-10 flex flex-col lg:flex-row gap-8 relative z-10 items-start">
        
        {/* Left Column: Files & Dropzone */}
        <div className="flex-1 flex flex-col gap-6 min-w-0 w-full">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-[#EDEDEF] mb-2">Upload & Convert</h2>
            <p className="text-[#8A8F98] text-sm">Drop your files here to process them. Results will be packaged for download.</p>
          </div>

          {/* Pro Dropzone */}
          <div 
            className="relative group cursor-pointer"
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              queueFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                queueFiles(e.target.files);
                e.currentTarget.value = '';
              }}
            />
            <div className={`absolute inset-0 bg-gradient-to-b from-[#5E6AD2]/10 to-transparent transition-opacity duration-500 rounded-2xl pointer-events-none ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
            <div className={`border border-dashed rounded-2xl p-12 flex flex-col items-center justify-center text-center transition-all duration-300 backdrop-blur-sm ${isDragging ? 'border-[#5E6AD2] bg-[#5E6AD2]/5 scale-[0.99]' : 'border-white/10 group-hover:border-[#5E6AD2]/50 bg-white/[0.02] group-hover:bg-white/[0.04]'}`}>
              <div className={`w-12 h-12 rounded-full border flex items-center justify-center mb-4 transition-all duration-300 shadow-sm ${isDragging ? 'bg-[#5E6AD2]/20 border-[#5E6AD2] text-[#5E6AD2] scale-110' : 'bg-white/[0.04] border-white/10 group-hover:scale-110 group-hover:border-[#5E6AD2]/30 group-hover:text-[#5E6AD2]'}`}>
                <Upload size={20} className={`transition-colors ${isDragging ? 'text-[#5E6AD2]' : 'text-[#8A8F98] group-hover:text-[#5E6AD2]'}`} />
              </div>
              <div className={`font-medium mb-1 transition-colors ${isDragging ? 'text-[#5E6AD2]' : 'text-[#EDEDEF]'}`}>
                {isDragging ? 'Drop files to add to queue' : 'Click to browse or drag files here'}
              </div>
              <div className="text-[#8A8F98] text-xs">Supports RAW, PNG, JPEG, WebP, and folders</div>
            </div>
          </div>

          {/* File List */}
          <div className="flex flex-col gap-3 mt-4">
            <div className="flex items-center justify-between px-2">
              <div className="text-xs font-bold text-[#8A8F98] tracking-widest uppercase">Queued Files ({uploadFiles.length})</div>
              <button
                onClick={clearUploadFiles}
                disabled={uploadFiles.length === 0}
                className="text-xs text-[#5E6AD2] hover:text-[#6872D9] font-medium transition-colors cursor-pointer disabled:text-[#5d6270] disabled:cursor-not-allowed"
              >
                Clear All
              </button>
            </div>
            
            <div className="flex flex-col gap-2 max-h-[500px] overflow-y-auto custom-scrollbar pr-2 pb-4">
              {uploadFiles.map((file, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-white/[0.02] hover:bg-white/[0.04] rounded-xl border border-white/[0.04] hover:border-white/[0.08] group transition-all duration-200">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#00E676]/10 border border-[#00E676]/20 flex items-center justify-center flex-none">
                      <span className="text-[9px] font-bold text-[#00E676]">
                        {(file.name.split('.').at(-1) ?? 'FILE').slice(0, 4).toUpperCase()}
                      </span>
                    </div>
                    <span className="text-sm text-[#EDEDEF] truncate">{file.name}</span>
                  </div>
                  <div className="flex items-center gap-4 flex-none pl-4">
                    <span className="text-xs text-[#8A8F98] tabular-nums">{formatBytes(file.size)}</span>
                    <button
                      onClick={() => removeUploadFile(i)}
                      className="w-6 h-6 rounded flex items-center justify-center text-[#8A8F98] hover:bg-[#FF4D4D]/10 hover:text-[#FF4D4D] transition-colors cursor-pointer"
                    >
                      <X size={14}/>
                    </button>
                  </div>
                </div>
              ))}
              {uploadFiles.length === 0 && (
                <div className="text-center py-8 text-xs text-[#8A8F98] border border-dashed border-white/[0.05] rounded-xl bg-white/[0.01]">
                  No files queued yet. Drop files here or click to browse.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Settings Inspector */}
        <div className="w-full lg:w-[380px] flex-none flex flex-col bg-[#0a0a0c]/80 backdrop-blur-xl border border-white/[0.06] rounded-2xl overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.4)] lg:sticky lg:top-10">
          <div className="p-5 border-b border-white/[0.06] bg-white/[0.02]">
            <div className="text-xs font-bold tracking-widest text-[#EDEDEF] uppercase flex items-center gap-2">
              <Settings size={14} className="text-[#5E6AD2]" />
              Conversion Settings
            </div>
          </div>

          <div className="flex flex-col p-6 gap-8 overflow-y-auto custom-scrollbar max-h-[calc(100vh-250px)]">
            <ConversionSettingsPanel layout="stack" />
          </div>

          {/* Sticky Footer / Convert Action */}
          <div className="p-5 bg-[#050506] border-t border-white/[0.06] mt-auto">
            <div className="flex justify-between items-center mb-4 text-xs">
              <span className="text-[#8A8F98]">Total Size</span>
              <span className="text-[#EDEDEF] font-mono">{formatBytes(totalSize)}</span>
            </div>
            <button 
              onClick={startConversion}
              disabled={uploadFiles.length === 0}
              className="w-full py-3 rounded-xl bg-[#5E6AD2] text-white font-semibold hover:bg-[#6872D9] transition-all shadow-[0_0_0_1px_rgba(94,106,210,0.5),0_4px_12px_rgba(94,106,210,0.3),inset_0_1px_0_0_rgba(255,255,255,0.2)] active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer disabled:bg-white/[0.05] disabled:text-[#8A8F98] disabled:shadow-none disabled:cursor-not-allowed">
              <Upload size={16} />
              Upload & Convert
            </button>
          </div>
        </div>

      </div>
    </main>
  );
}
