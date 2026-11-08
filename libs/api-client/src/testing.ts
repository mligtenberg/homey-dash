import { signal } from '@angular/core';
import {
  AirPlayInfo,
  AirPlayPlayback,
  ScreenDetails,
  CapabilityValue,
  DeviceApp,
  DisplayInfo,
  Forecast,
  RouteTraffic,
  HomeySnapshot,
  PhotoSet,
  PlexCommand,
  PlexItem,
  PlexSnapshot,
  PlexProfileList,
  PlexTracks,
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
  /** What the backend's build id answers; change it to simulate an update. */
  buildId = 'build-1';
  /** Called as a screen reports the versions it shows. */
  onShowing: (versions: Record<string, number>) => void = () => undefined;

  private readonly joins = new Set<() => void>();
  private readonly handlers = new Map<string, ((message: unknown) => void)[]>();

  build() {
    return Promise.resolve(this.buildId);
  }

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

  /** What `forecasts()` answers: the weather where each Homey is. */
  forecastList: Forecast[] = [];

  async forecasts() {
    return this.forecastList;
  }

  /** What `traffic()` answers: the traffic of every route in use. */
  trafficList: RouteTraffic[] = [];

  async traffic() {
    return this.trafficList;
  }

  controlPlex(accountId: number, playerId: string, command: PlexCommand) {
    return this.command('controlPlex', accountId, playerId, command);
  }

  /** What a search finds, whatever is asked. */
  plexSearchResults: PlexItem[] = [];

  async searchPlex(accountId: number, query: string, libraryId: string | null) {
    this.commands.push(['searchPlex', accountId, query, libraryId]);
    return this.plexSearchResults;
  }

  /** What a library holds, whatever library is asked: pages are cut from it. */
  plexLibraryList: PlexItem[] = [];

  async plexLibraryItems(accountId: number, libraryId: string, start: number, size: number) {
    this.commands.push(['plexLibraryItems', accountId, libraryId, start, size]);
    return { items: this.plexLibraryList.slice(start, start + size), total: this.plexLibraryList.length };
  }

  /** What is under any item, whatever is asked. */
  plexChildrenList: PlexItem[] = [];

  async plexChildren(accountId: number, itemId: string) {
    this.commands.push(['plexChildren', accountId, itemId]);
    return this.plexChildrenList;
  }

  /** The profiles of the Plex Home, as an account first asks for them. */
  plexProfileList: PlexProfileList = { profiles: [], currentId: null };
  /** What choosing a profile fails with, when it should. */
  plexProfileError: Error | null = null;

  async plexProfiles(accountId: number) {
    this.commands.push(['plexProfiles', accountId]);
    return this.plexProfileList;
  }

  async plexSelectProfile(accountId: number, profileId: string, pin: string | null) {
    this.commands.push(['plexSelectProfile', accountId, profileId, pin]);
    if (this.plexProfileError) throw this.plexProfileError;
    this.plexProfileList = { ...this.plexProfileList, currentId: profileId };
  }

  async plexProgress(accountId: number, itemId: string, state: string, timeMs: number, durationMs: number) {
    this.commands.push(['plexProgress', accountId, itemId, state, timeMs, durationMs]);
  }

  plexTrackList: PlexTracks = {
    audio: [
      { id: '1', label: 'English (AC3 5.1)', selected: true },
      { id: '2', label: 'Nederlands (AAC Stereo)', selected: false },
    ],
    subtitles: [{ id: '11', label: 'English (SRT)', selected: false }],
  };

  async plexTracks() {
    return this.plexTrackList;
  }

  /** What plays on AirPlay now, as a screen first loads it. */
  airPlayNow: AirPlayPlayback[] = [];

  async airPlayNowPlaying() {
    return this.airPlayNow;
  }

  changeAirPlayTracks(deviceId: string, audioStreamId: string | null, subtitleStreamId: string | null) {
    return this.command('changeAirPlayTracks', deviceId, audioStreamId, subtitleStreamId);
  }

  airPlay: AirPlayInfo = { available: true, devices: [{ id: 'tv', name: 'Living room TV', kind: 'tv', paired: true }] };

  async airPlayDevices() {
    return this.airPlay;
  }

  playOnAirPlay(accountId: number, itemId: string, deviceId: string) {
    return this.command('playOnAirPlay', accountId, itemId, deviceId);
  }

  playAlbumOnAirPlay(accountId: number, albumId: string, trackId: string | null, deviceId: string) {
    return this.command('playAlbumOnAirPlay', accountId, albumId, trackId, deviceId);
  }

  setAirPlayPaused(deviceId: string, paused: boolean) {
    return this.command('setAirPlayPaused', deviceId, paused);
  }

  stopAirPlay(deviceId: string) {
    return this.command('stopAirPlay', deviceId);
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

  /** What `deviceApps` answers, whatever device is asked. */
  apps: DeviceApp[] = [];

  async deviceApps() {
    return this.apps;
  }

  openDeviceApp(account: number | undefined, deviceId: string, app: DeviceApp) {
    return this.command('openDeviceApp', account, deviceId, app.name);
  }

  private async command(...command: unknown[]) {
    this.commands.push(command);
    if (this.failCommands) throw new Error('Homey did not respond');
  }
}
