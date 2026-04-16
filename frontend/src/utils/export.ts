import type { BackendConversionResult } from '../types';
import { formatBytes } from './formatBytes';
import { formatProcessingDuration } from './formatDuration';

function getFileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function getOutputExtension(result: BackendConversionResult): string {
  const parts = result.output_path.split('.');
  return parts.length > 1 ? parts.at(-1)?.toUpperCase() ?? '-' : '-';
}

function getInputExtension(result: BackendConversionResult): string {
  const parts = result.input_path.split('.');
  return parts.length > 1 ? parts.at(-1)?.toUpperCase() ?? '-' : '-';
}

function getStatus(result: BackendConversionResult): string {
  if (result.error) return 'error';
  if (result.skipped) return 'skipped';
  return result.output_path.toLowerCase().endsWith('.jxl') ? 'success' : 'fallback';
}

function escapeCsvCell(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export const exportCsv = (results: BackendConversionResult[]) => {
  const headers = [
    'File Name',
    'Status',
    'Status Detail',
    'Original Format',
    'Converted Format',
    'Input Path',
    'Output Path',
    'Width',
    'Height',
    'Resolution',
    'Input Size (Bytes)',
    'Output Size (Bytes)',
    'Savings (%)',
    'Saved Bytes',
    'Input Size',
    'Output Size',
    'Saved Size',
    'Processing Time (ms)',
    'Processing Time',
    'Color Profile',
    'EXIF Retained',
    'Byte-exact JPEG',
    'Error',
    'Skip Reason',
  ];

  const rows = results.map(res => [
    getFileName(res.input_path),
    getStatus(res),
    res.error || res.skip_reason || (getStatus(res) === 'fallback' ? 'Used fallback output format.' : ''),
    getInputExtension(res),
    res.skipped ? 'SKIP' : getOutputExtension(res),
    res.input_path,
    res.output_path,
    res.metadata?.dimensions[0] ?? '',
    res.metadata?.dimensions[1] ?? '',
    res.metadata ? `${res.metadata.dimensions[0]}x${res.metadata.dimensions[1]}` : '',
    res.input_size,
    res.skipped ? '' : res.output_size,
    res.skipped ? '' : res.savings_pct.toFixed(1),
    res.skipped ? '' : res.input_size - res.output_size,
    formatBytes(res.input_size),
    res.skipped ? '' : formatBytes(res.output_size),
    res.skipped ? '' : formatBytes(Math.max(0, res.input_size - res.output_size)),
    Math.round(res.duration_ms),
    formatProcessingDuration(res.duration_ms),
    res.metadata?.icc_description || 'Unknown',
    res.metadata?.has_exif ? 'yes' : 'no',
    res.used_jpeg_lossless ? 'yes' : 'no',
    res.error || '',
    res.skip_reason || '',
  ]);

  const csvContent = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map(row => row.map(escapeCsvCell).join(',')),
  ].join('\n');

  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', 'jxl_conversion_log.csv');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
