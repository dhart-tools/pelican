export interface ISetupModel {
  name: string;
  /** Human-readable size string */
  size: string;
  /** Raw bytes — used to compute estimated download time */
  sizeBytes: number;
  /** Star rating out of 3 (0 = skip entry) */
  stars: number;
  /** Short precision label */
  precision: string;
  /** Short description shown after precision */
  desc: string;
  /** If true, this is the "skip" sentinel — no download */
  skip?: boolean;
}

/** Fallback speed when measurement fails: 50 Mbps in bytes/sec. */
export const DEFAULT_SPEED_BPS = (50 * 1e6) / 8;

/**
 * Estimated download time range given a measured speed in bytes/sec.
 * Lower bound uses 1.5× the measured speed (burst / CDN optimism).
 * Upper bound uses the measured speed as-is.
 * Falls back to 50 Mbps if speedBps is 0 / undefined.
 */
export function downloadMinutes(sizeBytes: number, speedBps: number = DEFAULT_SPEED_BPS): string {
  const effectiveSpeed = speedBps > 0 ? speedBps : DEFAULT_SPEED_BPS;
  const maxMins = Math.ceil(sizeBytes / (effectiveSpeed * 1.2) / 60);
  const minMins = Math.floor(sizeBytes / (effectiveSpeed * 1.4) / 60);

  if (maxMins <= 1) return '< 1 min';
  if (minMins <= 1) return `1-${maxMins} min`;
  return `${minMins}-${maxMins} min`;
}

export const SETUP_MODELS: ISetupModel[] = [
  {
    name: 'qwen2.5-coder:3b',
    size: '1.9 GB',
    sizeBytes: 1.9e9,
    stars: 2,
    precision: 'good',
    desc: 'lightweight · code-aware',
  },
  {
    name: 'qwen2.5-coder:7b',
    size: '4.7 GB',
    sizeBytes: 4.7e9,
    stars: 3,
    precision: 'high',
    desc: 'balanced · slower',
  },
  {
    name: 'qwen3.5:latest',
    size: '6.6 GB',
    sizeBytes: 6.6e9,
    stars: 3,
    precision: 'best',
    desc: 'most capable · recommended',
  },
  {
    name: 'skip',
    size: '—',
    sizeBytes: 0,
    stars: 0,
    precision: '',
    desc: 'configure later in .pelicanrc.json',
    skip: true,
  },
];
