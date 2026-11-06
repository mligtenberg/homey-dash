import { signal } from '@angular/core';
import {
  ScreenDetails,
  CapabilityValue,
  DisplayInfo,
  HomeySnapshot,
  PhotoSet,
  PlexCommand,
  PlexSnapshot,
  Realtime,
  RealtimeMessages,
  Rule,
  RuleAnswer,
  ScreenView,
  SpeakerMusic,
  SpeakerMusicKind,
} from './index';

/**
 * Stands in for the realtime connection in tests: answers joins with `screen` and `displays`, records what a
 * screen reports and the commands tiles send, and lets a test push messages or simulate a reconnect. Provide it
 * as `Realtime`.
 */
export class FakeRealtime implements Partial<Realtime> {
  readonly connected = signal(true);
  screen: ScreenView | null = null;
  displays: DisplayInfo[] = [];
  readonly joined: string[] = [];
  /** What a screen reported it shows, each time: published version by dashboard id. */
  readonly shown: Record<string, number>[] = [];
  /** Commands sent, such as `['setCapability', undefined, 'd1', 'onoff', true]` (the second item is the account). */
  readonly commands: unknown[][] = [];
  /** Makes commands fail, as when Homey does not respond. */
  failCommands = false;
  /** Called as a screen reports the versions it shows. */
  onShowing: (versions: Record<string, number>) => void = () => undefined;

  private readonly joins = new Set<() => void>();
  private readonly handlers = new Map<string, ((message: unknown) => void)[]>();

  whenConnected(join: () => void) {
    this.joins.add(join);
    if (this.connected()) join();
    return () => this.joins.delete(join);
  }

  on<K extends keyof RealtimeMessages>(name: K, handler: (message: RealtimeMessages[K]) => void) {
    const listener = handler as (message: unknown) => void;
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), listener]);
    return () => this.handlers.set(name, (this.handlers.get(name) ?? []).filter((h) => h !== listener));
  }

  push<K extends keyof RealtimeMessages>(name: K, message: RealtimeMessages[K]) {
    this.handlers.get(name)?.forEach((handler) => handler(message));
  }

  reconnect() {
    this.connected.set(true);
    this.joins.forEach((join) => join());
  }

  homeySnapshot: HomeySnapshot[] = [
    {
      accountId: 1,
      accountName: 'Homey',
      status: { accountId: 1, connection: 'connected', lastError: null, since: '', fake: true },
      devices: [],
      flows: [],
      moods: [],
      zones: [],
      flowFolders: [],
      loaded: true,
      weather: null,
    },
  ];

  async homey() {
    return this.homeySnapshot;
  }

  photoSetList: PhotoSet[] = [];

  async photoSets() {
    return this.photoSetList;
  }

  plexSnapshot: PlexSnapshot = {
    accounts: [{ accountId: 1, accountName: 'Plex', status: 'connected', error: null, loaded: true, libraries: [], players: [] }],
    sessions: [],
  };

  async plex() {
    return this.plexSnapshot;
  }

  controlPlex(accountId: number, playerId: string, command: PlexCommand) {
    return this.command('controlPlex', accountId, playerId, command);
  }

  async joinScreen(screenId: string) {
    this.joined.push(screenId);
    return this.screen;
  }

  async showing(versions: Record<string, number>) {
    this.shown.push(versions);
    this.onShowing(versions);
  }

  async joinManagement() {
    return this.displays;
  }

  /** Rules subscribed to now, by id, with the display they are seen as on. */
  readonly rules = new Map<string, { rule: Rule; asDisplay: string | null }>();
  /** How subscribing answers; a rule it returns undefined for is refused, as HomeyDash refuses an invalid one. */
  answerRule: (rule: Rule, asDisplay: string | null) => boolean | undefined = () => false;
  /** How many times the screen reported a touch. */
  touches = 0;
  /** Each brightness the screen reported, in order. */
  brightnesses: number[] = [];
  private seq = 0;

  async subscribeRule(id: string, rule: Rule, asDisplay: string | null = null): Promise<RuleAnswer> {
    const holds = this.answerRule(rule, asDisplay);
    if (holds === undefined) throw new Error('Invalid rule');
    this.rules.set(id, { rule, asDisplay });
    return { holds, seq: ++this.seq };
  }

  async unsubscribeRule(id: string) {
    this.rules.delete(id);
  }

  /** Pushes new answers for subscribed rules, picked by a test, as one message. */
  answer(holds: (rule: Rule) => boolean | undefined) {
    const answers: Record<string, boolean> = {};
    for (const [id, { rule }] of this.rules) {
      const answer = holds(rule);
      if (answer !== undefined) answers[id] = answer;
    }
    this.push('RuleAnswers', { seq: ++this.seq, answers });
  }

  /** Drops every subscription, as HomeyDash does when the connection closes. */
  disconnect() {
    this.connected.set(false);
    this.rules.clear();
  }

  async touched() {
    this.touches++;
  }

  /** Each report of what the screen is, in order. */
  detailsReported: ScreenDetails[] = [];

  async details(details: ScreenDetails) {
    this.detailsReported.push(details);
  }

  async brightness(level: number) {
    this.brightnesses.push(level);
  }

  setCapability(account: number | undefined, deviceId: string, capabilityId: string, value: CapabilityValue) {
    return this.command('setCapability', account, deviceId, capabilityId, value);
  }

  triggerFlow(account: number | undefined, flowId: string) {
    return this.command('triggerFlow', account, flowId);
  }

  activateMood(account: number | undefined, moodId: string) {
    return this.command('activateMood', account, moodId);
  }

  joinSpeakerGroup(account: number | undefined, deviceId: string, withDeviceId: string) {
    return this.command('joinSpeakerGroup', account, deviceId, withDeviceId);
  }

  leaveSpeakerGroup(account: number | undefined, deviceId: string) {
    return this.command('leaveSpeakerGroup', account, deviceId);
  }

  setGroupVolume(account: number | undefined, deviceId: string, volume: number) {
    return this.command('setGroupVolume', account, deviceId, Math.round(volume));
  }

  /** What `speakerMusic` answers, by kind. */
  music: Partial<Record<SpeakerMusicKind, SpeakerMusic[]>> = {};

  async speakerMusic(account: number | undefined, deviceId: string, kind: SpeakerMusicKind) {
    await this.command('speakerMusic', account, deviceId, kind);
    return this.music[kind] ?? [];
  }

  playSpeakerMusic(account: number | undefined, deviceId: string, kind: SpeakerMusicKind, music: SpeakerMusic) {
    return this.command('playSpeakerMusic', account, deviceId, kind, music.name);
  }

  private async command(...command: unknown[]) {
    this.commands.push(command);
    if (this.failCommands) throw new Error('Homey did not respond');
  }
}
