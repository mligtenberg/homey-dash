import { installRipple, rippleSurface } from './ripple';

function render(html: string) {
  document.body.innerHTML = html;
  return (selector: string) => document.querySelector(selector) as HTMLElement;
}

function press(target: Element, init: PointerEventInit = {}) {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, ...init }));
}

describe('rippleSurface', () => {
  it('ripples the pressed control, not the tile around it', () => {
    const $ = render(`
      <div class="hd-tile" data-tap><div class="hd-segmented"><button id="seg"><span id="label">Open</span></button></div></div>
    `);
    expect(rippleSurface($('#label'))).toBe($('#seg'));
  });

  it('ripples a tile that opens its detail view from anywhere but its controls', () => {
    const $ = render(`
      <div class="hd-tile" data-tap>
        <div id="name">Lamp</div>
        <div class="hd-slider" role="slider"><div id="fill"></div></div>
        <dialog open><p id="detail">Details</p></dialog>
      </div>
    `);
    expect(rippleSurface($('#name'))).toBe($('.hd-tile'));
    expect(rippleSurface($('#fill'))).toBeNull();
    expect(rippleSurface($('#detail'))).toBeNull();
  });

  it('leaves tiles without a tap action, disabled buttons and other elements alone', () => {
    const $ = render(`
      <div class="hd-tile" id="plain"></div>
      <button class="hd-btn" id="off" disabled>Publish</button>
      <button class="hd-mood-list__btn" id="aria-off" aria-disabled="true">Dinner</button>
      <button id="other">Other</button>
    `);
    expect(rippleSurface($('#plain'))).toBeNull();
    expect(rippleSurface($('#off'))).toBeNull();
    expect(rippleSurface($('#aria-off'))).toBeNull();
    expect(rippleSurface($('#other'))).toBeNull();
  });
});

describe('installRipple', () => {
  let uninstall: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    uninstall = installRipple(document);
  });
  afterEach(() => {
    uninstall();
    vi.useRealTimers();
  });

  it('spreads from the press point in fractions of the surface, then fades once the pointer lifts', () => {
    const $ = render(`<button class="hd-btn">Publish</button>`);
    const button = $('.hd-btn');
    button.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 40 }) as DOMRect;

    press(button, { clientX: 150, clientY: 60 });
    const wave = button.querySelector<HTMLElement>('.hd-ripple .hd-ripple__wave');
    expect(wave?.style.left).toBe('25%');
    expect(wave?.style.top).toBe('25%');
    // Reaches the far corner (150, 30) away: a diameter of 2 × 152.97 of the 200 wide surface.
    expect(parseFloat(wave?.style.width ?? '')).toBeCloseTo(152.97, 1);

    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
    vi.advanceTimersByTime(450);
    expect(button.querySelector('.hd-ripple')?.classList).toContain('is-fading');
    vi.advanceTimersByTime(300);
    expect(button.querySelector('.hd-ripple')).toBeNull();
  });

  it('ignores secondary buttons and presses that ripple nothing', () => {
    const $ = render(`<button class="hd-btn">Publish</button><div id="other"></div>`);
    press($('.hd-btn'), { button: 2 });
    press($('#other'));
    expect(document.querySelector('.hd-ripple')).toBeNull();
  });
});
