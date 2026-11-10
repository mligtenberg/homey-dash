import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { AirPlayInfo, AirPlayPlayback } from './airplay';
import { DashboardSummary } from './dashboards';
import { DisplayInfo, ScreenDetails, ScreenView } from './displays';
import { PhotoSet } from './photos';
import { PlexCommand, PlexItem, PlexOverview, PlexPage, PlexProfileList, PlexSession, PlexSnapshot, PlexTracks } from './plex';
import { Rule, RuleAnswer, RuleAnswers } from './rules';
import { NewsFeed } from './news';
import { RouteTraffic } from './traffic';
import { Forecast } from './weather';
import { CapabilityValue, DeviceApp, HomeyDevice, HomeyEnergy, HomeyFlow, HomeyFlowFolder, HomeyMood, HomeyStatus, HomeyUser, HomeyWeather, HomeyZone, SpeakerMusic, SpeakerMusicKind } from './homey';

// Mirrors apps/api/Realtime/RealtimeHub.cs.

/** The Homey of one account as it is now. */
export interface HomeySnapshot {
  accountId: number;
  /** The account's name, telling a home's Homeys apart. */
  accountName: string;
  status: HomeyStatus;
  devices: HomeyDevice[];
  flows: HomeyFlow[];
  moods: HomeyMood[];
  zones: HomeyZone[];
  flowFolders: HomeyFlowFolder[];
  /** The people of this Homey, with whether each is home or away and asleep or awake. */
  users: HomeyUser[];
  /** False until the Homey's data first arrived; nothing is missing then. */
  loaded: boolean;
  /** Null until Homey first told it, or when Homey won't. */
  weather: HomeyWeather | null;
  /** Null until HomeyDash first asked Homey for its energy report. */
  energy: HomeyEnergy | null;
}

export interface HomeyCatalog {
  accountId: number;
  flows: HomeyFlow[];
  moods: HomeyMood[];
  zones: HomeyZone[];
  flowFolders: HomeyFlowFolder[];
}

/** The messages HomeyDash pushes, by name. */
export interface RealtimeMessages {
  /** Every Homey again, oldest account first, when a Homey account is added, removed or renamed. */
  Homeys: HomeySnapshot[];
  DeviceChanged: { accountId: number; device: HomeyDevice };
  DeviceRemoved: { accountId: number; deviceId: string };
  Catalog: HomeyCatalog;
  HomeyStatus: HomeyStatus;
  /** Every person of a Homey as they are now, whenever one is added, changed or removed. */
  Users: { accountId: number; users: HomeyUser[] };
  Weather: { accountId: number; weather: HomeyWeather };
  Energy: { accountId: number; energy: HomeyEnergy };
  /** What a joined screen now is and shows; null sends it to setup. */
  Screen: ScreenView | null;
  /** Asks a joined screen to take a screenshot and post it under this request id. */
  Screenshot: string;
  /** Every display with its status, for Management. */
  Displays: DisplayInfo[];
  /** Every dashboard, for Management's sidebar. */
  Dashboards: DashboardSummary[];
  /** Every photo set, whenever one changes. */
  PhotoSets: PhotoSet[];
  /** Every Plex account's status, libraries and players, whenever one changes. */
  Plex: PlexOverview[];
  /** What plays on Plex, whenever more than its progress changed. */
  PlexSessions: PlexSession[];
  /** The weather where each Homey is, oldest account first, whenever one changes. */
  Forecasts: Forecast[];
  /** The traffic of every route in use, whenever one changes. */
  Traffic: RouteTraffic[];
  /** The latest stories of every news source in use, whenever one changes. */
  News: NewsFeed[];
  /** What plays on AirPlay receivers, whenever it changes: started, paused, changed or ended. */
  AirPlayNow: AirPlayPlayback[];
  /** The answers to this connection's rule subscriptions that one change altered. */
  RuleAnswers: RuleAnswers;
}

/**
 * Calls each of these stop functions, such as those `Realtime.on` and `Realtime.whenConnected` return, when the
 * current injection context is destroyed.
 */
export function stopOnDestroy(...stops: (() => void)[]) {
  inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
}

// Displays run unattended, so reconnecting never gives up; it just slows down.
const RETRY_MS = [0, 1_000, 2_000, 5_000, 10_000, 30_000];

function retryDelay(attempt: number) {
  return RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
}

/**
 * The realtime connection to HomeyDash that both apps keep open. Messages sent while it is down are lost, so
 * whatever depends on them loads its state again in `whenConnected`.
 */
@Injectable({ providedIn: 'root' })
export class Realtime {
  private readonly hub = new HubConnectionBuilder()
    .withUrl('/api/realtime')
    .withAutomaticReconnect({ nextRetryDelayInMilliseconds: ({ previousRetryCount }) => retryDelay(previousRetryCount) })
    .configureLogging(LogLevel.Warning)
    .build();
  private readonly joins = new Set<() => void>();

  readonly connected = signal(false);

  constructor() {
    this.hub.onreconnecting(() => this.connected.set(false));
    this.hub.onreconnected(() => this.ready());
    // Automatic reconnect only covers a connection that was up; a failed start or a server close needs a new start.
    this.hub.onclose(() => {
      this.connected.set(false);
      this.start(1);
    });
    this.start(0);
  }

  /** Runs `join` now when connected and again after every reconnect. Returns a function that stops it. */
  whenConnected(join: () => void): () => void {
    this.joins.add(join);
    if (this.connected()) join();
    return () => this.joins.delete(join);
  }

  /** Returns a function that stops listening. */
  on<K extends keyof RealtimeMessages>(name: K, handler: (message: RealtimeMessages[K]) => void): () => void {
    this.hub.on(name, handler);
    return () => this.hub.off(name, handler);
  }

  /** Every Homey, oldest account first; changes that follow arrive as messages naming the account. */
  homey() {
    return this.hub.invoke<HomeySnapshot[]>('Homey');
  }

  /** Every photo set with its photos; changes that follow arrive as `PhotoSets`. */
  photoSets() {
    return this.hub.invoke<PhotoSet[]>('PhotoSets');
  }

  /** Plex's libraries and what plays now; changes that follow arrive as `Plex` and `PlexSessions`. */
  plex() {
    return this.hub.invoke<PlexSnapshot>('Plex');
  }

  /** The weather where each Homey is, oldest account first; changes that follow arrive as `Forecasts`. */
  forecasts() {
    return this.hub.invoke<Forecast[]>('Forecasts');
  }

  /** The traffic of every route in use; changes that follow arrive as `Traffic`. */
  traffic() {
    return this.hub.invoke<RouteTraffic[]>('Traffic');
  }

  /** The latest stories of every news source in use; changes that follow arrive as `News`. */
  news() {
    return this.hub.invoke<NewsFeed[]>('News');
  }

  /** Plays, pauses or skips on a player of a Plex account; fails when the player takes no remote control. */
  controlPlex(accountId: number, playerId: string, command: PlexCommand) {
    return this.hub.invoke<void>('ControlPlex', accountId, playerId, command);
  }

  /** The AirPlay receivers on the network (it takes a few seconds), or that AirPlay isn't set up. */
  airPlayDevices() {
    return this.hub.invoke<AirPlayInfo>('AirPlayDevices');
  }

  /** Items of a Plex account's libraries (one, or all when `libraryId` is null) whose title matches, not only the newest. */
  searchPlex(accountId: number, query: string, libraryId: string | null) {
    return this.hub.invoke<PlexItem[]>('SearchPlex', accountId, query, libraryId);
  }

  /** A page of what a Plex library holds, alphabetically: films, series or albums, never what is under them. */
  plexLibraryItems(accountId: number, libraryId: string, start: number, size: number) {
    return this.hub.invoke<PlexPage>('PlexLibraryItems', accountId, libraryId, start, size);
  }

  /** What is under a Plex item, in order: a show's seasons, a season's episodes, an album's tracks. */
  plexChildren(accountId: number, itemId: string) {
    return this.hub.invoke<PlexItem[]>('PlexChildren', accountId, itemId);
  }

  /** The profiles of the Plex Home an account belongs to; none when it has no home. */
  plexProfiles(accountId: number) {
    return this.hub.invoke<PlexProfileList>('PlexProfiles', accountId);
  }

  /** Uses the account as one of its profiles, on every screen; a profile with a PIN needs it. Fails with what Plex says. */
  plexSelectProfile(accountId: number, profileId: string, pin: string | null) {
    return this.hub.invoke<void>('PlexSelectProfile', accountId, profileId, pin);
  }

  /** The audio and subtitle tracks of a movie or episode. */
  plexTracks(accountId: number, itemId: string) {
    return this.hub.invoke<PlexTracks>('PlexTracks', accountId, itemId);
  }

  /** Where this screen's own player is in a film, episode or track, so Plex keeps what was watched and where to resume. */
  plexProgress(accountId: number, itemId: string, state: 'playing' | 'paused' | 'stopped', timeMs: number, durationMs: number) {
    return this.hub.invoke<void>('PlexProgress', accountId, itemId, state, timeMs, durationMs);
  }

  /** What plays on AirPlay now; changes that follow arrive as `AirPlayNow`. */
  airPlayNowPlaying() {
    return this.hub.invoke<AirPlayPlayback[]>('AirPlayNowPlaying');
  }

  /** Changes the audio or subtitle track of what plays on a receiver (no subtitle id: none); the stream starts over from where it is. */
  changeAirPlayTracks(deviceId: string, audioStreamId: string | null, subtitleStreamId: string | null) {
    return this.hub.invoke<void>('ChangeAirPlayTracks', deviceId, audioStreamId, subtitleStreamId);
  }

  /** Plays a movie, episode, track or album (track after track) of a Plex account on an AirPlay receiver; fails with the reason. */
  playOnAirPlay(accountId: number, itemId: string, deviceId: string) {
    return this.hub.invoke<void>('PlayOnAirPlay', accountId, itemId, deviceId);
  }

  /** Plays an album from one of its tracks (its first when `trackId` is null); the tracks after it follow. */
  playAlbumOnAirPlay(accountId: number, albumId: string, trackId: string | null, deviceId: string) {
    return this.hub.invoke<void>('PlayAlbumOnAirPlay', accountId, albumId, trackId, deviceId);
  }

  /** Pauses or resumes what plays on an AirPlay receiver; fails with the reason. */
  setAirPlayPaused(deviceId: string, paused: boolean) {
    return this.hub.invoke<void>('SetAirPlayPaused', deviceId, paused);
  }

  stopAirPlay(deviceId: string) {
    return this.hub.invoke<void>('StopAirPlay', deviceId);
  }

  /** Identifies the running build of the backend; it differs after an update was installed. */
  build() {
    return this.hub.invoke<string>('Build');
  }

  /** Joins as the screen with this id: which display it is, or null when it belongs in setup. */
  joinScreen(screenId: string) {
    return this.hub.invoke<ScreenView | null>('JoinScreen', screenId);
  }

  /** Reports the published version of each dashboard this screen offers, by dashboard id; none while it waits. */
  showing(versions: Record<string, number>) {
    return this.hub.invoke<void>('Showing', versions);
  }

  /** Joins as Management, to receive `Displays` and `Dashboards`; answers with the current display list. */
  joinManagement() {
    return this.hub.invoke<DisplayInfo[]>('JoinManagement');
  }

  // Each acts on the Homey of a tile's account (`settings.account`); without one, on the oldest.

  setCapability(account: number | undefined, deviceId: string, capabilityId: string, value: CapabilityValue) {
    return this.hub.invoke<void>('SetCapability', account ?? null, deviceId, capabilityId, value);
  }

  triggerFlow(account: number | undefined, flowId: string) {
    return this.hub.invoke<void>('TriggerFlow', account ?? null, flowId);
  }

  /** Marks a person home or away and/or asleep or awake; what is left out stays as it is. */
  setUser(account: number | undefined, userId: string, change: { present?: boolean; asleep?: boolean }) {
    return this.hub.invoke<void>('SetUser', account ?? null, userId, change.present ?? null, change.asleep ?? null);
  }

  activateMood(account: number | undefined, moodId: string) {
    return this.hub.invoke<void>('ActivateMood', account ?? null, moodId);
  }

  /** Puts a Sonos speaker in the group of another (multiroom). */
  joinSpeakerGroup(account: number | undefined, deviceId: string, withDeviceId: string) {
    return this.hub.invoke<void>('JoinSpeakerGroup', account ?? null, deviceId, withDeviceId);
  }

  leaveSpeakerGroup(account: number | undefined, deviceId: string) {
    return this.hub.invoke<void>('LeaveSpeakerGroup', account ?? null, deviceId);
  }

  /** The favorites or playlists a Sonos speaker can play. */
  speakerMusic(account: number | undefined, deviceId: string, kind: SpeakerMusicKind) {
    return this.hub.invoke<SpeakerMusic[]>('SpeakerMusic', account ?? null, deviceId, kind);
  }

  /** Plays one of `speakerMusic` in the speaker's group. */
  playSpeakerMusic(account: number | undefined, deviceId: string, kind: SpeakerMusicKind, music: SpeakerMusic) {
    return this.hub.invoke<void>('PlaySpeakerMusic', account ?? null, deviceId, kind, music.item);
  }

  /** The apps a device can open, such as an Apple TV's; none when it cannot open any. */
  deviceApps(account: number | undefined, deviceId: string) {
    return this.hub.invoke<DeviceApp[]>('DeviceApps', account ?? null, deviceId);
  }

  /** Opens one of `deviceApps` on the device. */
  openDeviceApp(account: number | undefined, deviceId: string, app: DeviceApp) {
    return this.hub.invoke<void>('OpenDeviceApp', account ?? null, deviceId, app.item);
  }

  /** Sets the volume (1–100) of every speaker in the speaker's group. */
  setGroupVolume(account: number | undefined, deviceId: string, volume: number) {
    return this.hub.invoke<void>('SetGroupVolume', account ?? null, deviceId, Math.round(volume));
  }

  /**
   * Subscribes to a rule under an id of this connection's choosing, answering whether it holds now; changes follow as
   * `RuleAnswers`. A screen's rules are evaluated for its display; Management's as if on `asDisplay`, or on none.
   * Subscriptions end with the connection, so subscribe again in `whenConnected`. Fails for an invalid rule.
   */
  subscribeRule(id: string, rule: Rule, asDisplay: string | null = null) {
    return this.hub.invoke<RuleAnswer>('SubscribeRule', id, rule, asDisplay);
  }

  unsubscribeRule(id: string) {
    return this.hub.invoke<void>('UnsubscribeRule', id);
  }

  /** Tells HomeyDash this screen was touched, for rules on when it was last touched. */
  touched() {
    return this.hub.invoke<void>('Touched');
  }

  /** Tells HomeyDash how much light falls on this screen, in lux, for rules on its brightness. */
  brightness(lux: number) {
    return this.hub.invoke<void>('Brightness', lux);
  }

  /** Tells HomeyDash what this screen and its browser are, which Management shows. */
  details(details: ScreenDetails) {
    return this.hub.invoke<void>('Details', details);
  }

  private start(attempt: number) {
    setTimeout(() => {
      this.hub.start().then(
        () => this.ready(),
        () => this.start(attempt + 1),
      );
    }, retryDelay(attempt));
  }

  private ready() {
    this.connected.set(true);
    for (const join of this.joins) join();
  }
}
