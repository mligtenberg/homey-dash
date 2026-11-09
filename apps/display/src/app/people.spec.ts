import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Realtime } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { RealtimeTileData, TileData } from '@homey-dash/tiles';
import { People } from './people';

describe('People', () => {
  let realtime: FakeRealtime;

  beforeEach(() => {
    realtime = new FakeRealtime();
    realtime.homeySnapshot[0].users = [
      { id: 'u1', name: 'Lisa', present: true, asleep: false, hasAvatar: false },
      { id: 'u2', name: 'Noah', present: true, asleep: true, hasAvatar: true },
      { id: 'u3', name: 'Oma', present: false, asleep: false, hasAvatar: false },
    ];
    TestBed.configureTestingModule({
      imports: [People],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Realtime, useValue: realtime },
        { provide: TileData, useExisting: RealtimeTileData },
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(People);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('marks only a person who is away or asleep', async () => {
    const root = await render();
    const marks = [...root.querySelectorAll('.person')].map((p) => [...p.querySelectorAll('.person__mark')].map((m) => m.className));
    expect(marks[0]).toEqual([]);
    expect(marks[1]).toEqual(['person__mark person__mark--asleep']);
    expect(marks[2]).toEqual(['person__mark person__mark--away']);
  });

  it('shows a picture instead of the initial, and the initial when it will not load', async () => {
    const root = await render();
    const noah = () => root.querySelectorAll('.person')[1];
    const photo = noah().querySelector('img');
    expect(photo?.getAttribute('src')).toBe('/api/homey/users/u2/avatar?account=1');
    photo?.dispatchEvent(new Event('error'));
    TestBed.tick();
    expect(noah().querySelector('img')).toBeNull();
    expect(noah().querySelector('.person__face')?.textContent).toContain('N');
  });

  it('opens a sheet that sets a person away or asleep, and closes on a second press', async () => {
    const root = await render();
    const face = root.querySelectorAll<HTMLButtonElement>('.person__face')[0];
    face.click();
    TestBed.tick();
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.person__sheet .choice button')];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Home', 'Away', 'Awake', 'Sleeping']);
    buttons[1].click();
    buttons[3].click();
    expect(realtime.commands).toEqual([
      ['setUser', 1, 'u1', { present: false }],
      ['setUser', 1, 'u1', { asleep: true }],
    ]);
    face.click();
    TestBed.tick();
    expect(root.querySelector('.person__sheet')).toBeNull();
  });
});
