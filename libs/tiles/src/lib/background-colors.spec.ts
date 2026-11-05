import { hexToHsl, hslToHex, recolorSvg, schemeHues } from './background-colors';

describe('schemeHues', () => {
  it('is the picked hue, the one at the angle from it, and the two opposite those', () => {
    expect(schemeHues({ color: '#ff0000', angle: 30 })).toEqual([0, 30, 180, 210]);
    expect(schemeHues({ color: '#0000ff', angle: 200 })).toEqual([240, 80, 60, 260]);
  });
});

describe('hexToHsl and hslToHex', () => {
  it('go there and back', () => {
    for (const hex of ['#3366cc', '#d9a066', '#1a1c24', '#ffffff', '#000000']) {
      expect(hslToHex(...hexToHsl(hex))).toBe(hex);
    }
  });
});

describe('recolorSvg', () => {
  const svg = '<rect fill="#c6ccd5"/><rect fill="#e7e9ed"/><rect fill="#9bbead"/>';

  it('gives each colour its role’s hue and keeps how light it is', () => {
    const out = recolorSvg(svg, 'flat', 'day', { color: '#ff0000', angle: 90 });
    const [thing, ground, accent] = [...out.matchAll(/#[0-9a-f]{6}/g)].map(([hex]) => hexToHsl(hex));
    expect(Math.round(thing[0])).toBe(0);
    expect(Math.round(ground[0])).toBe(0);
    expect(Math.round(accent[0])).toBe(180);
    expect(thing[2]).toBeCloseTo(hexToHsl('#c6ccd5')[2], 2);
    // Ground stays quieter than things.
    expect(ground[1]).toBeLessThan(thing[1]);
  });

  it('leaves an unknown style alone', () => {
    expect(recolorSvg(svg, 'nope', 'day', { color: '#ff0000', angle: 90 })).toBe(svg);
  });
});
