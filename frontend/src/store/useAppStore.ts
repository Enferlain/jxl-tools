import { create } from 'zustand';
import type {
  BackendConversionResult,
  CapabilitiesResponse,
  ConversionSettings,
  InspectSelectionResponse,
  JobStatusResponse,
} from '../types';

interface AppState {
  currentView: 'setup' | 'results';
  setCurrentView: (view: 'setup' | 'results') => void;
  appMode: 'local' | 'upload';
  setAppMode: (mode: 'local' | 'upload') => void;
  settings: ConversionSettings;
  updateSettings: (updates: Partial<ConversionSettings>) => void;
  capabilities: CapabilitiesResponse | null;
  setCapabilities: (capabilities: CapabilitiesResponse | null) => void;
  localSelectedPaths: string[];
  localInspection: InspectSelectionResponse | null;
  setLocalSelection: (paths: string[], inspection: InspectSelectionResponse | null) => void;
  outputDir: string;
  setOutputDir: (outputDir: string) => void;
  uploadFiles: File[];
  addUploadFiles: (files: File[]) => void;
  removeUploadFile: (index: number) => void;
  clearUploadFiles: () => void;
  jobId: string | null;
  setJobId: (jobId: string | null) => void;
  jobStatus: JobStatusResponse | null;
  setJobStatus: (jobStatus: JobStatusResponse | null) => void;
  conversionResults: BackendConversionResult[];
  setConversionResults: (results: BackendConversionResult[]) => void;
  resetJobState: () => void;
}

const initialSettings: ConversionSettings = {
  direction: 'to_jxl',
  targetFormat: 'png',
  lossless: false,
  quality: 80,
  effort: 4,
  preserveMetadata: true,
  byteExact: false,
  workers: 16,
  threads: 1,
  recursive: true,
  mirrorStructure: true,
};

export const useAppStore = create<AppState>((set) => ({
  currentView: 'setup',
  setCurrentView: (view) => set({ currentView: view }),
  appMode: 'upload',
  setAppMode: (mode) => set({ appMode: mode }),
  settings: initialSettings,
  updateSettings: (updates) => set((state) => ({
    settings: { ...state.settings, ...updates },
  })),
  capabilities: null,
  setCapabilities: (capabilities) => set({ capabilities }),
  localSelectedPaths: [],
  localInspection: null,
  setLocalSelection: (paths, inspection) => set({
    localSelectedPaths: paths,
    localInspection: inspection,
  }),
  outputDir: '',
  setOutputDir: (outputDir) => set({ outputDir }),
  uploadFiles: [],
  addUploadFiles: (files) => set((state) => {
    const deduped = new Map<string, File>();
    for (const file of [...state.uploadFiles, ...files]) {
      deduped.set(`${file.name}:${file.size}:${file.lastModified}`, file);
    }
    return { uploadFiles: Array.from(deduped.values()) };
  }),
  removeUploadFile: (index) => set((state) => ({
    uploadFiles: state.uploadFiles.filter((_, fileIndex) => fileIndex !== index),
  })),
  clearUploadFiles: () => set({ uploadFiles: [] }),
  jobId: null,
  setJobId: (jobId) => set({ jobId }),
  jobStatus: null,
  setJobStatus: (jobStatus) => set({ jobStatus }),
  conversionResults: [],
  setConversionResults: (conversionResults) => set({ conversionResults }),
  resetJobState: () => set({
    jobId: null,
    jobStatus: null,
    conversionResults: [],
  }),
}));
