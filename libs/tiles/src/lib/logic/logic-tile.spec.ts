import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Realtime, Rule } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { TileSize } from '@homey-dash/layout';
import { RealtimeTileData } from '../realtime-tile-data';
import { TileData, TileSettings } from '../tile-data';
import { provideTileModules, TileModule } from '../tile-kind';
import { TileKindRegistry } from '../tile-kind-registry';
import {
  canHold,
  HeldTile,
  LOGIC_TILE_BADGE,
  LOGIC_TILES,
  LogicTile,
  LogicTileSettings,
  logicSizes,
  RealtimeRuleAnswers,
  RuleAnswers,
} from './logic-tile';

@Component({
  selector: 'hd-named-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-tile named', '[attr.data-size]': 'size()' },
  template: `{{ settings().label }}`,
})
class NamedTile {
  readonly settings = input.required<TileSettings>();
  readonly size = input.required<TileSize>();
}

const TEST_TILES: TileModule = {
  name: 'Test',
  kinds: [
    { id: 'named', label: 'Named tile', target: 'device', sizes: ['small', 'wide'], defaultSettings: { target: null }, component: NamedTile },
    { id: 'big', label: 'Big tile', target: 'device', sizes: ['large'], defaultSettings: { target: null }, component: NamedTile },
  ],
};

// A rule on one made-up yes/no signal, so a test says which hold by that signal.
const when = (signal: string, not = false): Rule => ({ match: 'all', conditions: [{ signal, operator: 'isTrue', not }] });
const named = (label: string): HeldTile => ({ kind: 'named', settings: { target: null, label } });

describe('logic tile', () => {
  let realtime: FakeRealtime;
  // Which made-up signals hold; a signal not in it makes HomeyDash refuse the rule.
  let holding: Record<string, boolean>;

  beforeEach(() => {
    realtime = new FakeRealtime();
    holding = {};
    realtime.answerRule = (rule) => holding[rule.conditions[0].signal];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTileModules(LOGIC_TILES, TEST_TILES),
        { provide: Realtime, useValue: realtime },
        { provide: TileData, useExisting: RealtimeTileData },
        { provide: RuleAnswers, useExisting: RealtimeRuleAnswers },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  const settle = () => TestBed.inject(ApplicationRef).whenStable();

  async function render(settings: Partial<LogicTileSettings>) {
    const fixture = TestBed.createComponent(LogicTile);
    fixture.componentRef.setInput('settings', { target: null, entries: [], fallback: null, ...settings });
    fixture.componentRef.setInput('size', 'wide');
    await settle();
    return { fixture, tile: fixture.nativeElement as HTMLElement };
  }

  const showing = (tile: HTMLElement) =>
    [...tile.querySelectorAll('.hd-logic__face:not(.is-leaving) .named')].map((t) => t.textContent?.trim());

  // Answers change as the made-up signals do, in one message.
  async function change(next: Record<string, boolean>) {
    holding = { ...holding, ...next };
    realtime.answer((rule) => holding[rule.conditions[0].signal]);
    await settle();
  }

  it('shows the first of its tiles whose rule holds, at the size of the logic tile', async () => {
    holding = { doorbell: false, tv: true, night: true };
    const { tile } = await render({
      entries: [
        { tile: named('Doorbell'), rule: when('doorbell') },
        { tile: named('Remote'), rule: when('tv') },
        { tile: named('Clock'), rule: when('night') },
      ],
    });

    expect(showing(tile)).toEqual(['Remote']);
    expect(tile.querySelector('.named')?.getAttribute('data-size')).toBe('wide');

    await change({ doorbell: true });

    expect(showing(tile)).toEqual(['Doorbell']);
  });

  it('shows its fallback when no rule holds, and nothing when it has none', async () => {
    holding = { tv: false };
    const entries = [{ tile: named('Remote'), rule: when('tv') }];

    const withFallback = await render({ entries, fallback: named('Photos') });
    const without = await render({ entries });

    expect(showing(withFallback.tile)).toEqual(['Photos']);
    expect(without.tile.querySelector('hd-tile-host')).toBeNull();
  });

  it('treats a rule HomeyDash refuses as not holding', async () => {
    holding = { tv: true };
    const { tile } = await render({
      entries: [
        { tile: named('Broken'), rule: when('unknown') },
        { tile: named('Remote'), rule: when('tv') },
      ],
    });

    expect(showing(tile)).toEqual(['Remote']);
  });

  it('keeps a tile for its minimum show time, then shows what the rules choose at that moment', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    holding = { doorbell: true, tv: false };
    const { tile } = await render({
      entries: [
        { tile: named('Doorbell'), rule: when('doorbell') },
        { tile: named('Remote'), rule: when('tv') },
      ],
      fallback: named('Photos'),
      minShowSeconds: 10,
    });
    expect(showing(tile)).toEqual(['Doorbell']);

    vi.advanceTimersByTime(3_000);
    await change({ doorbell: false, tv: true });
    expect(showing(tile)).toEqual(['Doorbell']);

    // The remote's turn is skipped: by the time the doorbell's show time ran out, the TV was off again.
    vi.advanceTimersByTime(3_000);
    await change({ tv: false });
    vi.advanceTimersByTime(4_000);
    await settle();
    expect(showing(tile)).toEqual(['Photos']);
  });

  it('keeps its last choice while the connection is lost, and catches up once it reconnects', async () => {
    holding = { tv: true };
    const { tile } = await render({ entries: [{ tile: named('Remote'), rule: when('tv') }], fallback: named('Photos') });

    realtime.disconnect();
    holding = { tv: false };
    await settle();
    expect(showing(tile)).toEqual(['Remote']);

    realtime.reconnect();
    // Subscribing again answers asynchronously.
    await Promise.resolve();
    await settle();
    expect(showing(tile)).toEqual(['Photos']);
    expect(realtime.rules.size).toBe(1);
  });

  it('stops listening to its rules once it is gone', async () => {
    holding = { tv: true };
    const { fixture } = await render({ entries: [{ tile: named('Remote'), rule: when('tv') }] });
    expect(realtime.rules.size).toBe(1);

    fixture.destroy();
    await settle();

    expect(realtime.rules.size).toBe(0);
  });

  describe('in the Editor', () => {
    beforeEach(() => TestBed.overrideProvider(LOGIC_TILE_BADGE, { useValue: true }));

    it('says which of its tiles it shows', async () => {
      holding = { doorbell: false, tv: true };
      const { tile } = await render({
        entries: [
          { tile: named('Doorbell'), rule: when('doorbell') },
          { tile: named('Remote'), rule: when('tv') },
        ],
        fallback: named('Photos'),
      });
      const badge = () => tile.querySelector('.hd-logic-badge')?.textContent?.trim();

      expect(badge()).toBe('2 of 2');
      await change({ tv: false });
      expect(badge()).toBe('Fallback');
    });

    it('says nothing shows when no rule holds and it has no fallback', async () => {
      holding = { tv: false };
      const { tile } = await render({ entries: [{ tile: named('Remote'), rule: when('tv') }] });

      expect(tile.querySelector('.hd-logic-badge')?.textContent?.trim()).toBe('Nothing');
    });

    it('hints at what to do while it holds no tiles', async () => {
      const { tile } = await render({});

      expect(tile.textContent).toContain('Add tiles with rules');
      expect(tile.querySelector('.hd-logic-badge')).toBeNull();
    });
  });

  it('holds only other kinds that have its size, and takes only sizes every tile it holds has', () => {
    const registry = TestBed.inject(TileKindRegistry);
    const [named, big] = TEST_TILES.kinds;

    expect(canHold(named, 'wide')).toBe(true);
    expect(canHold(big, 'wide')).toBe(false);
    expect(canHold(LOGIC_TILES.kinds[0], 'wide')).toBe(false);
    expect(logicSizes({ target: null, entries: [{ tile: { kind: 'named', settings: { target: null } }, rule: when('tv') }], fallback: null }, registry)).toEqual([
      'small',
      'wide',
    ]);
  });
});
