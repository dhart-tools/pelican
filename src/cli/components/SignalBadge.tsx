import { Text } from 'ink';
import React from 'react';

import { palette } from '@/cli/theme';
import { EConfidenceLevel } from '@/utils/enums';

interface SignalBadgeProps {
  confidence: EConfidenceLevel;
}

const VERB_LABEL: Record<EConfidenceLevel, string> = {
  [EConfidenceLevel.HIGH]: 'Must Ensure',
  [EConfidenceLevel.MEDIUM]: 'Should Check',
  [EConfidenceLevel.LOW]: 'Good to Have',
};

const VERB_BG: Record<EConfidenceLevel, string> = {
  [EConfidenceLevel.HIGH]: '#059669',   // emerald
  [EConfidenceLevel.MEDIUM]: '#D97706', // amber
  [EConfidenceLevel.LOW]: '#4B5563',    // gray — de-emphasized
};

/**
 * Action-verb badge replacing HIGH/MED/LOW score display.
 * Tells the developer *what to do*, not just a confidence number.
 */
export function SignalBadge({ confidence }: SignalBadgeProps) {
  const label = VERB_LABEL[confidence] ?? confidence;
  const bg = VERB_BG[confidence] ?? palette.dim;

  return (
    <Text backgroundColor={bg} color={palette.badgeText} bold>
      {' '}{label}{' '}
    </Text>
  );
}
