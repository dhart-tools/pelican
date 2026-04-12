import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';

/**
 * Scorer that matches Cypress text content to source translation keys.
 *
 * It distinguishes between exact matches (static keys) and partial matches (dynamic keys).
 * Fits the Cypress `contains()` behavior by checking for substrings.
 */
export class TranslationMatchScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.TRANSLATION_MATCH));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, changedFile: changedEntry, registry } = context;

    const translationIndex = registry.getTranslationIndex();
    if (!translationIndex) {
      return [this.createSignal(false, 'Translation index not available in registry')];
    }

    const containsText = testEntry.cypress?.containsText || [];
    const translationKeys = changedEntry.translationKeys || [];

    if (containsText.length === 0) {
      return [this.createSignal(false, 'Test does not contain any detected text assertions')];
    }

    if (translationKeys.length === 0) {
      return [this.createSignal(false, 'Source file does not use any translation keys')];
    }

    for (const text of containsText) {
      // textToKeys holds BOTH exact texts and stripped interpolated texts,
      // so this single lookup covers both static and dynamic keys.
      const keys = translationIndex.textToKeys.get(text) || [];

      for (const key of keys) {
        // Use includes() to mirror Cypress contains() substring behaviour.
        // cy.contains('Sign In') matches a button labelled 'Sign In Now' too.
        const sourceUsesKey = translationKeys.some((k) => k.includes(key) || key.includes(k));

        if (sourceUsesKey) {
          const isDynamic = translationIndex.dynamicKeys.has(key);

          return [
            this.createSignal(
              true,
              isDynamic
                ? `Test contains "${text}" which partially matches dynamic key "${key}" (interpolated value) used in source file`
                : `Test contains "${text}" which maps to key "${key}" used in source file`,
              { changedFile, testFile, text, key, isDynamic },
            ),
          ];
        }
      }
    }

    return [
      this.createSignal(false, 'No translation matches found between test text and source keys'),
    ];
  }
}
