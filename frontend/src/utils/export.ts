import type { BackendConversionResult } from '../types';
import { formatBytes } from './formatBytes';

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

export const exportCsv = (results: BackendConversionResult[]) => {
  const headers = ['File Name', 'Original Format', 'Converted Format', 'Original Size', 'Converted Size', 'Savings', 'Status', 'Path', 'Resolution', 'Color Profile', 'EXIF Data', 'Processing Time', 'Error Details'];
  const rows = results.map(res => [
    res.input_path.split(/[\\/]/).at(-1) ?? res.input_path,
    getInputExtension(res),
    res.skipped ? 'SKIP' : getOutputExtension(res),
    formatBytes(res.input_size),
    res.skipped ? '—' : formatBytes(res.output_size),
    res.skipped ? '—' : `${res.savings_pct.toFixed(1)}%`,
    getStatus(res),
    res.input_path,
    res.metadata ? `${res.metadata.dimensions[0]}x${res.metadata.dimensions[1]}` : 'Unknown',
    res.metadata?.icc_description || 'Unknown',
    res.metadata?.has_exif ? 'Retained' : 'None',
    `${Math.round(res.duration_ms)}ms`,
    res.error || res.skip_reason || ''
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
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
