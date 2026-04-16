import React from 'react';
import { Check } from 'lucide-react';

export function Toggle({ checked, onChange, label }: { checked: boolean, onChange: (c: boolean) => void, label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer group" onClick={(e) => { e.preventDefault(); onChange(!checked); }}>
      <div className={`w-8 h-4 rounded-full transition-colors relative ${checked ? 'bg-[#5E6AD2]' : 'bg-white/10'}`}>
        <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </div>
      <span className="text-sm text-[#8A8F98] group-hover:text-[#EDEDEF] transition-colors select-none">{label}</span>
    </label>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean, onChange: (c: boolean) => void, label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer group" onClick={(e) => { e.preventDefault(); onChange(!checked); }}>
      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${checked ? 'bg-[#5E6AD2] border-[#5E6AD2]' : 'border-white/20 group-hover:border-white/40'}`}>
        {checked && <Check size={12} className="text-white" strokeWidth={3} />}
      </div>
      <span className="text-sm text-[#8A8F98] group-hover:text-[#EDEDEF] transition-colors select-none">{label}</span>
    </label>
  );
}

export function Button({ children, variant = 'primary', icon, onClick }: { children: React.ReactNode, variant?: 'primary' | 'secondary', icon?: React.ReactNode, onClick?: () => void }) {
  const base = "inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#5E6AD2]/50 focus:ring-offset-2 focus:ring-offset-[#050506] cursor-pointer";
  const variants = {
    primary: "bg-[#5E6AD2] text-white hover:bg-[#6872D9] shadow-[0_0_0_1px_rgba(94,106,210,0.5),0_4px_12px_rgba(94,106,210,0.3),inset_0_1px_0_0_rgba(255,255,255,0.2)] active:scale-[0.98]",
    secondary: "bg-white/[0.05] text-[#EDEDEF] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] hover:bg-white/[0.08] active:scale-[0.98] border border-white/[0.06]"
  };
  
  return (
    <button className={`${base} ${variants[variant]}`} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

export function SettingToggle({ checked, onChange, label, helperText }: { checked: boolean, onChange: (c: boolean) => void, label: string, helperText?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center cursor-pointer group" onClick={(e) => { e.preventDefault(); onChange(!checked); }}>
        <span className="text-xs text-[#EDEDEF]">{label}</span>
        <div className={`w-7 h-4 rounded-full transition-colors relative ${checked ? 'bg-[#5E6AD2]' : 'bg-white/10'}`}>
          <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-3' : ''}`} />
        </div>
      </div>
      {helperText && <span className="text-[10px] text-[#8A8F98] leading-relaxed pr-8">{helperText}</span>}
    </div>
  );
}

export function SettingSlider({ label, value, min, max, onChange, helperText, disabled = false }: { label: string, value: number, min: number, max: number, onChange: (v: number) => void, helperText?: string, disabled?: boolean }) {
  return (
    <div className={`flex flex-col gap-1.5 ${disabled ? 'opacity-45' : ''}`}>
      <div className="flex justify-between items-center">
        <span className={`text-xs ${disabled ? 'text-[#8A8F98]' : 'text-[#EDEDEF]'}`}>{label}</span>
        <span className={`text-[11px] font-mono ${disabled ? 'text-[#8A8F98]' : 'text-[#5E6AD2]'}`}>{value}</span>
      </div>
      <input 
        type="range" min={min} max={max} value={value} 
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className={`w-full h-1 bg-white/10 rounded-lg appearance-none accent-[#5E6AD2] ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      />
      {helperText && <span className="text-[10px] text-[#8A8F98] leading-relaxed mt-0.5">{helperText}</span>}
    </div>
  );
}
