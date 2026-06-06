// Shared date utilities used by both pipelines

export type ZoomLevel = 'year' | 'quarter' | 'month' | 'week';

export const ZOOM_SPAN_DAYS: Record<ZoomLevel, number> = {
  year: 365, quarter: 91, month: 31, week: 14,
};
export const ZOOM_LABELS: Record<ZoomLevel, string> = {
  year: 'Year', quarter: 'Quarter', month: 'Month', week: '2 Weeks',
};
export const ZOOM_ORDER: ZoomLevel[] = ['year', 'quarter', 'month', 'week'];
export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
export function startOfWeek(d: Date): Date {
  const r = new Date(d); r.setDate(r.getDate() - r.getDay()); return r;
}
export function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

export function datePct(iso: string, viewStart: Date, viewEnd: Date): number {
  const ms = new Date(iso).getTime();
  const lo = viewStart.getTime();
  const hi = viewEnd.getTime();
  return Math.max(0, Math.min(100, ((ms - lo) / (hi - lo)) * 100));
}

export interface GanttTick {
  label: string;
  pct: number;
  major: boolean;
  iso: string;
  year: number;
  month: number;
}

export function buildTicks(zoom: ZoomLevel, viewStart: Date, viewEnd: Date): GanttTick[] {
  const ticks: GanttTick[] = [];

  if (zoom === 'year') {
    let d = startOfMonth(viewStart);
    while (d <= viewEnd) {
      const p = datePct(isoDate(d), viewStart, viewEnd);
      ticks.push({ label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, pct: p,
                   major: d.getMonth() === 0, iso: isoDate(d),
                   year: d.getFullYear(), month: d.getMonth() });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
  } else if (zoom === 'quarter' || zoom === 'month') {
    let d = startOfWeek(viewStart);
    while (d <= viewEnd) {
      const p = datePct(isoDate(d), viewStart, viewEnd);
      const isMajor = d.getDate() <= 7;
      const label   = isMajor
        ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
        : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
      ticks.push({ label, pct: p, major: isMajor, iso: isoDate(d),
                   year: d.getFullYear(), month: d.getMonth() });
      d = addDays(d, 7);
    }
  } else {
    let d = new Date(viewStart);
    while (d <= viewEnd) {
      const p = datePct(isoDate(d), viewStart, viewEnd);
      ticks.push({ label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, pct: p,
                   major: d.getDay() === 1, iso: isoDate(d),
                   year: d.getFullYear(), month: d.getMonth() });
      d = addDays(d, 1);
    }
  }
  return ticks;
}
