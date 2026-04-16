import { IScorerConfig } from '@/types';
import { EScorerType } from '@/utils/enums';

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
  [EScorerType.REDUX_CHAIN]: {
    name: EScorerType.REDUX_CHAIN,
    version: '1.0.0',
    description: 'Scores based on Redux chain relationships',
    type: 'redux-chain',
    weight: 0.75,
  },
  [EScorerType.TRANSITIVE_IMPORT]: {
    name: EScorerType.TRANSITIVE_IMPORT,
    version: '1.0.0',
    description: 'Scores based on transitive imports (depth 1)',
    type: 'transitive-import',
    weight: 0.7,
  },
  [EScorerType.REDUX_CONSUMER]: {
    name: EScorerType.REDUX_CONSUMER,
    version: '1.0.0',
    description: 'Scores based on Redux selector/action usage',
    type: 'redux-consumer',
    weight: 0.65,
  },
  [EScorerType.SELECTOR_ID_MATCH]: {
    name: EScorerType.SELECTOR_ID_MATCH,
    version: '1.0.0',
    description: 'Scores based on ID selector matches',
    type: 'selector-id-match',
    weight: 0.65,
  },
  [EScorerType.FILENAME_MATCH]: {
    name: EScorerType.FILENAME_MATCH,
    version: '1.0.0',
    description: 'Scores based on filename naming conventions',
    type: 'filename-match',
    weight: 0.6,
  },
  [EScorerType.API_INTERCEPT]: {
    name: EScorerType.API_INTERCEPT,
    version: '1.0.0',
    description: 'Scores based on API intercept matches',
    type: 'api-intercept',
    weight: 0.55,
  },
  [EScorerType.COLOCATION]: {
    name: EScorerType.COLOCATION,
    version: '1.0.0',
    description: 'Scores based on test files colocated with source (same dir, __tests__ sibling, etc.)',
    type: 'colocation',
    weight: 0.75,
  },
  [EScorerType.DESCRIBE_BLOCK]: {
    name: EScorerType.DESCRIBE_BLOCK,
    version: '1.0.0',
    description: 'Scores based on describe()/it() block text matching source filename tokens',
    type: 'describe-block',
    weight: 0.7,
  },
  [EScorerType.DEPENDENT_SELECTOR]: {
    name: EScorerType.DEPENDENT_SELECTOR,
    version: '1.0.0',
    description: 'Scores based on selectors in files that import the changed file (reverse dependency)',
    type: 'dependent-selector',
    weight: 0.65,
  },
};

export function getScorerConfig(type: EScorerType): IScorerConfig {
  return SCORER_CONFIGS[type];
}
