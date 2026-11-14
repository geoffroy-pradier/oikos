import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../registry';
import { SELF_REVIEW_ENV, selfReviewFromEnv } from './admin-config';

describe('levée de la double validation par l’environnement de l’API', () => {
  it('est désactivée par défaut, et pour toute valeur autre que « true »', () => {
    expect(DEFAULT_SETTINGS).toEqual({ allowSelfReview: false });
    expect(SELF_REVIEW_ENV).toBe('OLYMPE_ALLOW_SELF_REVIEW');
    expect(selfReviewFromEnv({})).toBe(false);
    for (const value of ['', 'false', '0', '1', 'yes', 'TRUE', 'True', ' true', 'true ']) {
      expect([value, selfReviewFromEnv({ OLYMPE_ALLOW_SELF_REVIEW: value })]).toEqual([
        value,
        false,
      ]);
    }
  });

  it('n’est activée que par la valeur exacte « true »', () => {
    expect(selfReviewFromEnv({ OLYMPE_ALLOW_SELF_REVIEW: 'true' })).toBe(true);
    expect(selfReviewFromEnv({ ALLOW_SELF_REVIEW: 'true' })).toBe(false);
  });
});
