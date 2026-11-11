import { describe, expect, it } from 'vitest';
import { Backdrop, contrast, inkOver, inverseOf, luminance, prominentColour, Rgb } from './lock-ink';

const even = (colour: Rgb): Backdrop => ({ average: colour, lightest: colour, darkest: colour });

describe('inkOver', () => {
  it('is black over light colours and white over dark ones', () => {
    expect(inkOver(even([240, 235, 220]))).toEqual([0, 0, 0]);
    expect(inkOver(even([20, 30, 50]))).toEqual([255, 255, 255]);
  });

  it.each<[Rgb]>([[[255, 255, 255]], [[0, 0, 0]], [[128, 128, 128]], [[220, 80, 190]], [[190, 180, 160]], [[30, 60, 160]]])(
    'takes whichever of the two reads better over %j',
    (colour) => {
      const ink = inkOver(even(colour));
      const other: Rgb = ink[0] ? [0, 0, 0] : [255, 255, 255];
      expect(contrast(ink, colour)).toBeGreaterThanOrEqual(contrast(other, colour));
    },
  );
});

describe('inverseOf', () => {
  it('inverts lightness: light for dark, dark for light', () => {
    expect(luminance(inverseOf([20, 20, 30]))).toBeGreaterThan(0.5);
    expect(luminance(inverseOf([240, 240, 235]))).toBeLessThan(0.05);
  });

  it('takes the opposite hue: warm in, cool out', () => {
    const [r, , b] = inverseOf([200, 140, 80]);
    expect(b).toBeGreaterThan(r);
  });

  it('keeps greys grey, and turns black to white and white to black', () => {
    const [r, g, b] = inverseOf([100, 100, 100]);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(2);
    expect(inverseOf([0, 0, 0])).toEqual([255, 255, 255]);
    expect(inverseOf([255, 255, 255])).toEqual([0, 0, 0]);
  });

  it('stays a colour a screen can show, however vivid the original', () => {
    for (const colour of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]] as Rgb[]) {
      expect(inverseOf(colour).every((c) => c >= 0 && c <= 255)).toBe(true);
    }
  });
});

describe('prominentColour', () => {
  // 4 x 1 pixels: three reddish, one blue.
  const data = new Uint8ClampedArray([200, 10, 10, 255, 204, 12, 8, 255, 198, 9, 11, 255, 10, 10, 220, 255]);

  it('is the colour most of the covered pixels are, averaged', () => {
    expect(prominentColour(data, 4, 1, [new DOMRect(0, 0, 4, 1)])).toEqual([201, 10, 10]);
  });

  it('only looks under the given rectangles, counting overlaps once', () => {
    expect(prominentColour(data, 4, 1, [new DOMRect(3, 0, 1, 1), new DOMRect(3, 0, 1, 1)])).toEqual([10, 10, 220]);
  });

  it('is null when the rectangles are off the image', () => {
    expect(prominentColour(data, 4, 1, [new DOMRect(10, 10, 2, 2)])).toBeNull();
  });
});
