import { IScorerConfig } from '@v2/types';
import { EScorerType } from '@v2/utils/enums';

const SCORER_CONFIGS: Record<EScorerType, IScorerConfig> = {
  [EScorerType.DIRECT_IMPORT]: {
    name: EScorerType.DIRECT_IMPORT,
    version: '1.0.0',
    description: 'Scores based on direct imports between test and source',
    type: 'direct-import',
    weight: 0.95,
  },
  [EScorerType.ROUTE_MATCH]: {
    name: EScorerType.ROUTE_MATCH,
    version: '1.0.0',
    description: 'Scores based on visited routes matching component paths',
    type: 'route-match',
    weight: 0.85,
  },
  [EScorerType.SELECTOR_MATCH]: {
    name: EScorerType.SELECTOR_MATCH,
    version: '1.0.0',
    description: 'Scores based on selector (testid, data-cy) matches between test and source',
    type: 'selector-match',
    weight: 0.8,
  },
  [EScorerType.TRANSLATION_MATCH]: {
    name: EScorerType.TRANSLATION_MATCH,
    version: '1.0.0',
    description: 'Scores based on translation markers and text matches between test and source',
    type: 'translation-match',
    weight: 0.85,
  },
};

export function getScorerConfig(type: EScorerType): IScorerConfig {
  return SCORER_CONFIGS[type];
}
