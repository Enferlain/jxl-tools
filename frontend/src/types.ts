// ── UI-facing types (used by components and store) ──────────────────────

export interface FileNode {
  name: string;
  label?: string;
  type: 'folder' | 'file';
  path: string;
  size?: number;
  extension?: string;
  files?: number;
  folders?: number;
  expanded?: boolean;
  children?: FileNode[];
}

export interface ExtensionStat {
  extension: string;
  count: number;
  size: number;
  percent: number;
}

export interface ConversionSettings {
  direction: 'to_jxl' | 'from_jxl';
  targetFormat: 'png' | 'jpeg' | 'webp';
  lossless: boolean;
  quality: number;
  effort: number;
  preserveMetadata: boolean;
  byteExact: boolean;
  workers: number;
  threads: number;
  recursive: boolean;
  mirrorStructure: boolean;
}


// ── Backend API response types ──────────────────────────────────────────

export interface CapabilitiesResponse {
  cjxl_available: boolean;
  djxl_available: boolean;
  jpeg_lossless: boolean;
  default_workers: number;
  default_jxl_threads: number;
}

export interface BrowseDirectoryEntry {
  name: string;
  path: string;
}

export interface BrowseFileEntry {
  name: string;
  path: string;
  size: number;
  extension: string;
}

export interface BrowseResponse {
  current_path: string;
  parent_path: string | null;
  roots: { name: string; path: string }[];
  directories: BrowseDirectoryEntry[];
  files: BrowseFileEntry[];
  hidden_unsupported_count: number;
}

export interface InspectGroupFile {
  name: string;
  path: string;
  relative_path: string;
  size: number;
  extension: string;
}

export interface InspectGroup {
  folder_name: string;
  folder_path: string;
  selection_kind: 'folder' | 'files';
  recursive: boolean;
  files: InspectGroupFile[];
  file_count: number;
  total_size: number;
  folder_count: number;
}

export interface InspectSelectionResponse {
  groups: InspectGroup[];
  totals: {
    file_count: number;
    total_size: number;
  };
  extensions: ExtensionStat[];
  recursive: boolean;
}

export interface PickerResponse {
  cancelled: boolean;
  paths?: string[];
  picked_paths?: string[];
  path?: string | null;
  // When not cancelled, inspect-selection fields may be inlined:
  groups?: InspectGroup[];
  totals?: { file_count: number; total_size: number };
  extensions?: ExtensionStat[];
}

export interface BackendConversionResult {
  input_path: string;
  output_path: string;
  input_size: number;
  output_size: number;
  savings_pct: number;
  duration_ms: number;
  metadata: {
    dimensions: [number, number];
    mode: string;
    format: string;
    has_exif: boolean;
    has_icc: boolean;
    exif_fields: Record<string, string>;
    icc_description: string;
  } | null;
  error: string | null;
  used_jpeg_lossless: boolean;
  skipped: boolean;
  skip_reason: string | null;
}

export interface JobEvent {
  type: string;
  file?: string;
  completed?: number;
  total?: number;
  active?: number;
  queued?: number;
  current_file?: string;
  result?: BackendConversionResult;
  message?: string;
  job_id?: string;
  workers?: number;
}

export interface JobStatusResponse {
  job_id: string;
  job_kind?: 'upload' | 'local';
  output_dir?: string;
  total: number;
  workers: number;
  completed: number;
  active: number;
  queued: number;
  done: boolean;
  paused: boolean;
  cancel_requested: boolean;
  cancelled: boolean;
  events: JobEvent[];
  results: BackendConversionResult[];
  total_input_size: number;
  total_output_size: number;
  success_count: number;
  error_count: number;
  fallback_count: number;
  skipped_count: number;
  total_duration_ms: number;
  total_savings_pct: number;
}

export interface StartJobResponse {
  job_id: string;
  job_kind?: string;
  output_dir?: string;
  total: number;
  workers: number;
}

export interface ConversionLogEntry {
  time: number;
  message: string;
  kind: 'info' | 'success' | 'error' | 'fallback' | 'start' | 'skipped';
}
