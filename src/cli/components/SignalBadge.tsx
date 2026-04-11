import React from 'react';
import { Text } from 'ink';
import { confidenceBadgeBg, palette } from '../theme';
import { EConfidenceLevel } from '@/utils/enums';

interface SignalBadgeProps {
  confidence: EConfidenceLevel;
  score: number;
}

/**
 * Solid-color pill badge for confidence level + score.
 * Uses background color so it reads on both light and dark terminals.
 *
 * @example
 *   <SignalBadge confidence={EConfidenceLevel.HIGH} score={0.95} />
 *   // ▌HIGH▐  0.95   (green bg pill, then score in matching fg color)
 */
export function SignalBadge({ confidence, score }: SignalBadgeProps) {
  const bg = confidenceBadgeBg(confidence);
  const label =
    confidence === EConfidenceLevel.MEDIUM
      ? 'MED '
      : confidence.toUpperCase().slice(0, 4).padEnd(4);

  return (
    <Text>
      <Text backgroundColor={bg} color={palette.badgeText} bold> {label} </Text>
      <Text>{'  '}</Text>
      <Text color={bg} bold>{score.toFixed(2)}</Text>
    </Text>
  );
}
