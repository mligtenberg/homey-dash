import { describe, expect, it } from 'vitest';
import { contrast, inkOver, MIN_CONTRAST_SMALL, Rgb } from './lock-ink';

describe('inkOver', () => {
  it.each<[string, Rgb]>([
    ['white', [255, 255, 255]],
    ['black', [0, 0, 0]],
    ['mid grey, which inverts to itself', [128, 128, 128]],
    ['a vivid pink', [220, 80, 190]],
    ['a pale sand', [190, 180, 160]],
    ['a deep blue', [30, 60, 160]],
  ])('reads on %s', (_, background) => {
    expect(contrast(inkOver(background), background)).toBeGreaterThanOrEqual(3);
  });

  it('reads better for small type when asked', () => {
    const sand: Rgb = [146, 136, 117];
    expect(contrast(inkOver(sand, MIN_CONTRAST_SMALL), sand)).toBeGreaterThanOrEqual(MIN_CONTRAST_SMALL);
  });

  it('is dark on a light background and light on a dark one', () => {
    expect(inkOver([240, 240, 245])[0]).toBeLessThan(100);
    expect(inkOver([20, 20, 30])[0]).toBeGreaterThan(155);
  });
});
