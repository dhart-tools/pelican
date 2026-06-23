import { Text } from 'ink';
import React, { useState, useEffect, useMemo } from 'react';

import { palette } from '@/cli/theme';

interface ShimmerProps {
  /** Text to animate. */
  text: string;
  /** Wave travel speed in ms per tick. Default 60. */
  speed?: number;
  /** Width of the glow region in characters. Default 14. */
  width?: number;
}

/**
 * Interpolate between two hex colors by ratio (0 = a, 1 = b).
 */
function lerpColor(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const r = clamp(r1 + (r2 - r1) * t);
  const g = clamp(g1 + (g2 - g1) * t);
  const bl = clamp(b1 + (b2 - b1) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

/**
 * Terminal shimmer — a smooth white/silver highlight that sweeps across
 * dimmed text, like light reflecting off metal. Uses cosine interpolation
 * for natural glow falloff. No blue/cyan — clean silver-to-white.
 */
export function Shimmer({ text, speed = 50, width = 20 }: ShimmerProps) {
  const [tick, setTick] = useState(0);
  const len = text.length;
  const totalCycle = len + width * 2;

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => (t + 1) % totalCycle);
    }, speed);
    return () => clearInterval(timer);
  }, [totalCycle, speed]);

  const waveCenter = tick - width;

  // Uses brand cyan for glow — consistent with pelican identity.
  // Dark: muted gray → cyan-400 → light. Light: muted → cyan-600 → dark.
  const stops = useMemo(
    () => ({
      base: palette.muted, // resting state
      mid: palette.dim, // transition
      bright: palette.brand, // main glow — cyan
      peak: palette.sub, // text-level brightness at tip
    }),
    [],
  );

  return (
    <Text>
      {text.split('').map((char, i) => {
        const dist = Math.abs(i - waveCenter);

        let color: string;
        if (dist >= width) {
          color = stops.base;
        } else {
          // Cosine falloff: smooth bell curve, 1.0 at center → 0.0 at edge
          const ratio = 0.5 * (1 + Math.cos((Math.PI * dist) / width));

          if (ratio > 0.7) {
            // Peak: bright silver → white
            color = lerpColor(stops.bright, stops.peak, (ratio - 0.7) / 0.3);
          } else if (ratio > 0.25) {
            // Mid: dim → bright silver
            color = lerpColor(stops.mid, stops.bright, (ratio - 0.25) / 0.45);
          } else {
            // Outer: base → dim
            color = lerpColor(stops.base, stops.mid, ratio / 0.25);
          }
        }

        return (
          <Text key={i} color={color}>
            {char}
          </Text>
        );
      })}
    </Text>
  );
}
