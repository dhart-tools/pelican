// SCENARIO 4: high-fanout util — probes UsageSiteScorer suppression.
// Imported by 6+ files. Cone shouldn't dominate; usage-site should back off.

export type ClassValue = string | number | boolean | undefined | null | Record<string, boolean>;

export function classnames(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'object') {
      for (const [k, on] of Object.entries(v)) if (on) out.push(k);
    }
  }
  return out.join(' ');
}
