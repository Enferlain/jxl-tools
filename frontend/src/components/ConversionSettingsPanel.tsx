import React from 'react';
import { SettingToggle, SettingSlider } from './UI';
import { useAppStore } from '../store/useAppStore';

interface Props {
  layout?: 'grid' | 'stack';
}

export function ConversionSettingsPanel({ layout = 'stack' }: Props) {
  const { settings, updateSettings } = useAppStore();
  const containerClass = layout === 'grid' 
    ? "grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-10 gap-y-8" 
    : "flex flex-col gap-8";

  return (
    <div className={containerClass}>
      {/* Direction */}
      <div className="flex flex-col gap-3">
        <div className="text-[10px] font-bold tracking-widest text-[#8A8F98] uppercase border-b border-white/[0.06] pb-2 mb-1">Direction</div>
        <div className="flex bg-[#0a0a0c] rounded-md p-1 border border-white/[0.04]">
          <button 
            onClick={() => updateSettings({ direction: 'to_jxl' })}
            className={`flex-1 py-1.5 rounded text-xs font-medium transition-all cursor-pointer ${settings.direction === 'to_jxl' ? 'bg-[#5E6AD2] text-white shadow-sm' : 'text-[#8A8F98] hover:text-[#EDEDEF]'}`}>
            → JXL
          </button>
          <button 
            onClick={() => updateSettings({ direction: 'from_jxl' })}
            className={`flex-1 py-1.5 rounded text-xs font-medium transition-all cursor-pointer ${settings.direction === 'from_jxl' ? 'bg-[#5E6AD2] text-white shadow-sm' : 'text-[#8A8F98] hover:text-[#EDEDEF]'}`}>
            JXL →
          </button>
        </div>
        {layout === 'grid' && (
          <span className="text-[10px] text-[#8A8F98] leading-relaxed">
            {settings.direction === 'to_jxl' ? 'Automatically falls back to WebP or Original if JXL results in a larger file.' : 'Decodes JXL back to standard image formats.'}
          </span>
        )}
      </div>

      {/* Output Format (Only when converting from JXL) */}
      {settings.direction === 'from_jxl' && (
        <div className="flex flex-col gap-3">
          <div className="text-[10px] font-bold tracking-widest text-[#8A8F98] uppercase border-b border-white/[0.06] pb-2 mb-1">Output Format</div>
          <div className="flex bg-[#0a0a0c] rounded-md p-1 border border-white/[0.04]">
            {(['png', 'jpeg', 'webp'] as const).map(fmt => (
              <button 
                key={fmt}
                onClick={() => updateSettings({ targetFormat: fmt })}
                className={`flex-1 py-1.5 rounded text-xs font-medium uppercase transition-all cursor-pointer ${settings.targetFormat === fmt ? 'bg-[#5E6AD2] text-white shadow-sm' : 'text-[#8A8F98] hover:text-[#EDEDEF]'}`}>
                {fmt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quality */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 mb-1">
          <div className="text-[10px] font-bold tracking-widest text-[#8A8F98] uppercase">Quality</div>
          {layout === 'stack' && <div className="text-[10px] text-[#5E6AD2] font-medium cursor-pointer hover:text-[#6872D9]">Presets</div>}
        </div>
        <SettingToggle label="Lossless Encoding" checked={settings.lossless} onChange={(v) => updateSettings({ lossless: v })} />
        <SettingSlider label="Visual Quality" value={settings.quality} min={0} max={100} onChange={(v) => updateSettings({ quality: v })} />
        <SettingSlider label="Compression Effort" value={settings.effort} min={1} max={9} onChange={(v) => updateSettings({ effort: v })} helperText="Higher effort takes longer but yields smaller files." />
      </div>

      {/* Metadata */}
      <div className="flex flex-col gap-4">
        <div className="text-[10px] font-bold tracking-widest text-[#8A8F98] uppercase border-b border-white/[0.06] pb-2 mb-1">Metadata & Extras</div>
        <SettingToggle label="Preserve EXIF/XMP" checked={settings.preserveMetadata} onChange={(v) => updateSettings({ preserveMetadata: v })} />
        <SettingToggle label="Byte-exact JPEG" checked={settings.byteExact} onChange={(v) => updateSettings({ byteExact: v })} helperText="Allows exact reconstruction of original JPEGs." />
      </div>

      {/* Performance */}
      <div className="flex flex-col gap-4">
        <div className="text-[10px] font-bold tracking-widest text-[#8A8F98] uppercase border-b border-white/[0.06] pb-2 mb-1">Performance</div>
        <SettingSlider label="Concurrent Workers" value={settings.workers} min={1} max={32} onChange={(v) => updateSettings({ workers: v })} helperText={layout === 'grid' ? "Files to convert simultaneously. Best set to your physical core count." : undefined} />
        <SettingSlider label="Threads per Image" value={settings.threads} min={1} max={16} onChange={(v) => updateSettings({ threads: v })} helperText={layout === 'grid' ? "Compute threads per image. Recommend 1 for large batches to avoid CPU starvation." : undefined} />
      </div>
    </div>
  );
}
