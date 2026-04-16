/**
 * Format a byte count into a human-readable string.
 *
 * Examples:
 *   formatBytes(0)          → "0 B"
 *   formatBytes(1024)       → "1.0 KB"
 *   formatBytes(1536000)    → "1.5 MB"
 *   formatBytes(45200000000)→ "42.1 GB"
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}
