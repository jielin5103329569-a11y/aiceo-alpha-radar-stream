import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(val: number | null | undefined, decimals = 2): string {
  if (val === null || val === undefined) return '-';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(val);
}

export function formatTime(isoStr: string | null | undefined): string {
  if (!isoStr) return '-';
  
  // Format as HH:MM:SS.mmm
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '-';
  
  const pad = (n: number, z = 2) => ('00' + n).slice(-z);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function formatAge(isoStr: string | null | undefined): string {
  if (!isoStr) return 'No data yet';
  const timestamp = new Date(isoStr).getTime();
  if (Number.isNaN(timestamp)) return 'Unknown';

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 2) return 'just now';
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  return `${Math.floor(elapsedMinutes / 60)}h ago`;
}

export function formatPercent(val: number | null | undefined, decimals = 2): string {
  if (val === null || val === undefined) return '-';
  const prefix = val > 0 ? '+' : '';
  return `${prefix}${formatNumber(val, decimals)}%`;
}
