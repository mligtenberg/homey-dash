import { describe, expect, it } from 'vitest';
import { Backdrop, contrast, inkOver, luminance, MIN_CONTRAST_SMALL, Rgb } from './lock-ink';

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

  it('takes the opposite hue: warm in, cool out', () => {
    const [r, , b] = inkOver(even([200, 140, 80]));
    expect(b).toBeGreaterThan(r);
  });

  it('is the plain inverse, light on dark, when that reads against the lightest and darkest', () => {
    const backdrop: Backdrop = { average: [30, 35, 45], lightest: [45, 50, 60], darkest: [15, 20, 30] };
    expect(luminance(inkOver(backdrop))).toBeGreaterThan(0.3);
  });

  it('is worked out again against the lightest colour when that is what fails', () => {
    // Dark on average, so its inverse is light, but with a white patch in it that a light ink would vanish on.
    const backdrop: Backdrop = { average: [40, 40, 50], lightest: [255, 255, 255], darkest: [10, 10, 15] };
    const colour = inkOver(backdrop);
    expect(contrast(colour, backdrop.lightest)).toBeGreaterThanOrEqual(3);
    expect(contrast(colour, backdrop.darkest)).toBeGreaterThanOrEqual(3);
  });

  it('finds mid grey when the area runs from white to black, which reads on both', () => {
    const backdrop: Backdrop = { average: [128, 128, 128], lightest: [255, 255, 255], darkest: [0, 0, 0] };
    expect(reads(inkOver(backdrop), backdrop)).toBeGreaterThanOrEqual(3);
  });

  it('reads against the average when no colour reads on both ends', () => {
    // No room above the lightest or below the darkest, and no grey in between is far enough from both.
    const dark: Backdrop = { average: [100, 100, 100], lightest: [170, 170, 170], darkest: [80, 80, 80] };
    expect(contrast(inkOver(dark), dark.average)).toBeGreaterThanOrEqual(3);
    expect(luminance(inkOver(dark))).toBeGreaterThan(0.3);
    const light: Backdrop = { average: [150, 150, 150], lightest: [200, 200, 200], darkest: [70, 70, 70] };
    expect(contrast(inkOver(light), light.average)).toBeGreaterThanOrEqual(3);
    expect(luminance(inkOver(light))).toBeLessThan(0.1);
  });

  it('asks more of small type', () => {
    const backdrop: Backdrop = { average: [146, 136, 117], lightest: [165, 155, 135], darkest: [125, 115, 100] };
    expect(reads(inkOver(backdrop, MIN_CONTRAST_SMALL), backdrop)).toBeGreaterThanOrEqual(MIN_CONTRAST_SMALL);
  });

  it('is dark on a light background and light on a dark one', () => {
    expect(luminance(inkOver(even([240, 240, 245])))).toBeLessThan(0.2);
    expect(luminance(inkOver(even([20, 20, 30])))).toBeGreaterThan(0.5);
  });
});
