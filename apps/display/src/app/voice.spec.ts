import { nextPhase, timerOf, understood, VoicePhase, VoiceResult } from './voice';

const off: VoicePhase = { kind: 'off' };
const result: VoiceResult = { ok: true, action: 'lights_on', value: null, zones: ['Woonkamer'], reason: null };

describe('nextPhase', () => {
  it('stays invisible for speech that is not for the screen', () => {
    let phase = nextPhase(off, { type: 'state', state: 'speech' });
    phase = nextPhase(phase, { type: 'state', state: 'thinking' });
    phase = nextPhase(phase, { type: 'heard', text: 'hoi', wake: false, armed: false });
    expect(nextPhase(phase, { type: 'state', state: 'idle' })).toEqual(off);
  });

  it('listens after the wake phrase, then works, then shows the result', () => {
    let phase = nextPhase(off, { type: 'state', state: 'awake' });
    expect(phase.kind).toBe('awake');
    phase = nextPhase(phase, { type: 'state', state: 'thinking' });
    expect(phase.kind).toBe('thinking');
    phase = nextPhase(phase, { type: 'result', ...result });
    expect(phase.kind).toBe('result');
  });

  it('keeps the result up when the service goes back to idle', () => {
    const phase = nextPhase(off, { type: 'result', ...result });
    expect(nextPhase(phase, { type: 'state', state: 'idle' })).toBe(phase);
  });

  it('shows working at once when wake phrase and command come in one breath', () => {
    expect(nextPhase(off, { type: 'heard', text: 'homey licht aan', wake: true, armed: false }).kind).toBe('thinking');
  });
});

describe('a timer result', () => {
  const timer: VoiceResult = { ok: true, action: 'timer', value: { seconds: 5400, name: 'Pasta' }, zones: [], reason: null };

  it('is a timer to set, with its length and name', () => {
    expect(timerOf(timer)).toEqual({ seconds: 5400, name: 'Pasta' });
    expect(understood(timer)).toBe('Timer for 1 h 30 min');
  });

  it('is none for any other result', () => {
    expect(timerOf(result)).toBeNull();
  });
});
