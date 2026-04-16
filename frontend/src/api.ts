/**
 * API client for the JXL Tools FastAPI backend.
 *
 * All functions throw on HTTP errors. The Vite dev server proxies
 * `/api/*` to `http://127.0.0.1:8787`, so we use relative URLs.
 */

import type {
  BrowseResponse,
  CapabilitiesResponse,
  ConversionSettings,
  InspectSelectionResponse,
  JobStatusResponse,
  PickerResponse,
  StartJobResponse,
} from './types';

// ── Helpers ─────────────────────────────────────────────────────────────

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

function postJSON<T>(url: string, body: unknown): Promise<T> {
  return fetchJSON<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Translate frontend ConversionSettings to the backend Pydantic model field names.
 */
export function mapSettingsToBackend(s: ConversionSettings): Record<string, unknown> {
  return {
    direction: s.direction,
    output_format: s.targetFormat,
    lossless: s.lossless,
    quality: s.quality,
    effort: s.effort,
    preserve_metadata: s.preserveMetadata,
    jpeg_lossless: s.byteExact,
    workers: s.workers,
    jxl_threads: s.threads,
    recursive: s.recursive,
    mirror_structure: s.mirrorStructure,
  };
}


// ── Capabilities ────────────────────────────────────────────────────────

export function fetchCapabilities(): Promise<CapabilitiesResponse> {
  return fetchJSON('/api/capabilities');
}


// ── Local filesystem browsing ───────────────────────────────────────────

export function browseLocal(path?: string): Promise<BrowseResponse> {
  const params = path ? `?path=${encodeURIComponent(path)}` : '';
  return fetchJSON(`/api/local/browse${params}`);
}

export function inspectSelection(
  paths: string[],
  recursive = true,
): Promise<InspectSelectionResponse> {
  return postJSON('/api/local/inspect-selection', { paths, recursive });
}


// ── Native OS pickers ───────────────────────────────────────────────────

export function pickSourceFiles(recursive = true): Promise<PickerResponse> {
  return postJSON('/api/local/pick-source-files', { recursive });
}

export function pickSourceFolder(recursive = true): Promise<PickerResponse> {
  return postJSON('/api/local/pick-source-folder', { recursive });
}

export function pickTargetFolder(): Promise<PickerResponse> {
  return postJSON('/api/local/pick-target-folder', {});
}


// ── Conversion jobs ─────────────────────────────────────────────────────

export function startLocalBatch(
  paths: string[],
  outputDir: string,
  settings: ConversionSettings,
): Promise<StartJobResponse> {
  return postJSON('/api/convert-local-batch', {
    paths,
    output_dir: outputDir,
    settings: mapSettingsToBackend(settings),
  });
}

export async function startUploadBatch(
  files: File[],
  settings: ConversionSettings,
): Promise<StartJobResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file, file.name);
  }
  formData.append('settings_json', JSON.stringify(mapSettingsToBackend(settings)));

  return fetchJSON('/api/convert-batch', {
    method: 'POST',
    body: formData,
  });
}

export function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  return fetchJSON(`/api/jobs/${encodeURIComponent(jobId)}`);
}

export function pauseJob(jobId: string): Promise<JobStatusResponse> {
  return postJSON(`/api/jobs/${encodeURIComponent(jobId)}/pause`, {});
}

export function resumeJob(jobId: string): Promise<JobStatusResponse> {
  return postJSON(`/api/jobs/${encodeURIComponent(jobId)}/resume`, {});
}

export function cancelJob(jobId: string): Promise<JobStatusResponse> {
  return postJSON(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {});
}


// ── File downloads ──────────────────────────────────────────────────────

export async function downloadBatchZip(jobId: string): Promise<void> {
  const res = await fetch(`/api/download-batch/${encodeURIComponent(jobId)}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jxl-converted-${jobId}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadFile(jobId: string, filename: string): Promise<void> {
  const res = await fetch(
    `/api/download/${encodeURIComponent(jobId)}/${encodeURIComponent(filename)}`,
  );
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
