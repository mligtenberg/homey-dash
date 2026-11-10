import { describe, expect, it } from 'vitest';
import { Backdrop, contrast, inkOver, MIN_CONTRAST_SMALL, Rgb } from './lock-ink';

const even = (colour: Rgb): Backdrop => ({ average: colour, lightest: colour, darkest: colour });
const reads = (ink: Rgb, { lightest, darkest }: Backdrop) => Math.min(contrast(ink, lightest), contrast(ink, darkest));

describe('inkOver', () => {
  it.each<[string, Rgb]>([
    ['white', [255, 255, 255]],
    ['black', [0, 0, 0]],
    ['mid grey, which inverts to itself', [128, 128, 128]],
    ['a vivid pink', [220, 80, 190]],
    ['a pale sand', [190, 180, 160]],
    ['a deep blue', [30, 60, 160]],
  ])('reads on an even %s', (_, colour) => {
    expect(reads(inkOver(even(colour)), even(colour))).toBeGreaterThanOrEqual(3);
  });

  it('is the plain inverse of the average when that reads against the lightest and darkest', () => {
    const backdrop: Backdrop = { average: [240, 230, 220], lightest: [250, 245, 240], darkest: [225, 215, 205] };
    expect(inkOver(backdrop)).toEqual([15, 25, 35]);
  });

  it('is worked out again against the lightest colour when that is what fails', () => {
    // Dark on average, so its inverse is light, but with a white patch in it that a light ink would vanish on.
    const backdrop: Backdrop = { average: [40, 40, 50], lightest: [255, 255, 255], darkest: [10, 10, 15] };
    expect(contrast(inkOver(backdrop), backdrop.lightest)).toBeGreaterThanOrEqual(3);
    expect(contrast(inkOver(backdrop), backdrop.darkest)).toBeGreaterThanOrEqual(3);
  });

  it('still reads when the area runs from white to black', () => {
    const backdrop: Backdrop = { average: [128, 128, 128], lightest: [255, 255, 255], darkest: [0, 0, 0] };
    expect(reads(inkOver(backdrop), backdrop)).toBeGreaterThanOrEqual(3);
  });

  it('asks more of small type', () => {
    const backdrop: Backdrop = { average: [146, 136, 117], lightest: [165, 155, 135], darkest: [125, 115, 100] };
    expect(reads(inkOver(backdrop, MIN_CONTRAST_SMALL), backdrop)).toBeGreaterThanOrEqual(MIN_CONTRAST_SMALL);
  });

  it('is dark on a light background and light on a dark one', () => {
    expect(inkOver(even([240, 240, 245]))[0]).toBeLessThan(100);
    expect(inkOver(even([20, 20, 30]))[0]).toBeGreaterThan(155);
  });
});
