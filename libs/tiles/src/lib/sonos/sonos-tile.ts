import { Segmented } from '../core/segmented';
import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { HomeyDevice, Realtime, SpeakerMusic, SpeakerMusicKind } from '@homey-dash/api-client';
import {
  LucideAudioLines,
  LucideDynamicIcon,
  LucideLink,
  LucideLock,
  LucideMusic,
  LucideSearch,
  LucideSpeaker,
  LucideUnlink,
} from '@lucide/angular';
import { albumArtUrl, isPlaying, nowPlaying } from '../core/device-look';
import { brokenImages, loadableArt } from '../core/loadable-art';
import { SliderDrag } from '../core/slider-drag';
import { Transport } from '../core/transport';
import { TileDetails } from '../core/tile-details';
import { TILE_FACE_HOST, TileFace, TileView } from '../core/tile-view';
import { TileData, TileSettings } from '../tile-data';

export interface SonosTileSettings extends TileSettings {
  /** The id of the room the tile is locked to; absent leaves the tile free to switch rooms. */
  lock?: string;
}

/** What a result of the music picker plays as, with where it came from. */
interface MusicItem {
  kind: SpeakerMusicKind;
  music: SpeakerMusic;
}

/**
 * What a speaker can play, picked in the detail view: its Sonos favorites and playlists from Homey, with their
 * covers. Plays in the speaker's group. It renders only while its tab is open, so it asks
 * Homey only then.
 */
@Component({
  selector: 'hd-sonos-music',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-sonos__music' },
  template: `
    <label class="hd-sonos__search">
      <svg [lucideIcon]="searchIcon" />
      <input
        type="search"
        autocomplete="off"
        [placeholder]="kind() === 'favorite' ? 'Search favorites' : 'Search playlists'"
        [attr.aria-label]="kind() === 'favorite' ? 'Search favorites' : 'Search playlists'"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
      />
    </label>
    @if (error()) {
      <div class="hd-sonos__note">{{ error() }}</div>
    } @else if (items() === null) {
      <div class="hd-sonos__note">Loading…</div>
    } @else {
      <div class="hd-sonos__list">
        @for (item of shown(); track item.kind + item.music.name) {
          <button
            type="button"
            class="hd-sonos__item"
            [class.is-playing]="playing() === key(item)"
            [attr.aria-pressed]="playing() === key(item)"
            (click)="play(item)"
          >
            <span class="hd-sonos__cover">
              @if (item.music.image && !images.has(item.music.image)) {
                <img
                  [src]="item.music.image"
                  alt=""
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  (error)="images.mark(item.music.image)"
                />
              } @else {
                <svg [lucideIcon]="noteIcon" />
              }
              @if (playing() === key(item)) {
                <span class="hd-sonos__cover-state"
                  ><svg [lucideIcon]="playingIcon"
                /></span>
              }
            </span>
            <span class="hd-sonos__item-text">
              <span class="hd-sonos__item-name">{{ item.music.name }}</span>
              @if (item.music.description) {
                <span class="hd-sonos__item-sub">{{
                  item.music.description
                }}</span>
              }
            </span>
          </button>
        } @empty {
          <div class="hd-sonos__note">
            {{ query().trim() ? 'No matches' : 'Nothing here yet' }}
          </div>
        }
      </div>
    }
  `,
})
export class SonosMusic {
  private readonly realtime = inject(Realtime);

  protected readonly noteIcon = LucideMusic;
  protected readonly searchIcon = LucideSearch;
  protected readonly playingIcon = LucideAudioLines;

  readonly account = input<number>();
  readonly deviceId = input.required<string>();
  readonly kind = input.required<SpeakerMusicKind>();

  protected readonly items = signal<MusicItem[] | null>(null);
  /** What is typed in the search bar; the music shown is what matches. */
  protected readonly query = signal('');
  protected readonly shown = computed(() => {
    const words = this.query().toLowerCase().split(/\s+/).filter(Boolean);
    return (this.items() ?? []).filter((i) => {
      const text = `${i.music.name} ${i.music.description ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  });
  protected readonly error = signal('');
  protected readonly playing = signal('');
  /** Covers that did not load, so the note shows instead of a broken picture. */
  protected readonly images = brokenImages();

  constructor() {
    effect((onCleanup) => {
      const [account, deviceId, kind] = [this.account(), this.deviceId(), this.kind()];
      this.error.set('');
      this.items.set(null);
      this.query.set('');
      let stale = false;
      onCleanup(() => (stale = true));
      this.realtime.speakerMusic(account, deviceId, kind).then(
        (found) =>
          !stale && this.items.set(found.map((music): MusicItem => ({ kind, music }))),
        () => !stale && this.error.set('Homey did not respond'),
      );
    });
  }

  protected key(item: MusicItem) {
    return `${item.kind}:${item.music.name}`;
  }

  protected play(item: MusicItem) {
    this.playing.set(this.key(item));
    this.error.set('');
    this.realtime
      .playSpeakerMusic(this.account(), this.deviceId(), item.kind, item.music)
      .catch(() => {
        this.playing.set('');
        this.error.set(`Could not play ${item.music.name}`);
      });
  }
}

/** One of the tile's speakers; `found` is false for a device Homey does not have (any more). */
interface Room {
  id: string;
  name: string;
  found: boolean;
  available: boolean;
  /** The room's own volume, 0–1. */
  volume: number;
  /** Speakers with the same group name play together. */
  group: string | null;
  device: HomeyDevice | undefined;
}

/**
 * Sonos multiroom on one tile (several speakers, picked in Management): what the lead room plays over its album art, with
 * buttons to skip back, play or pause, and skip on, and one volume for the whole group. A press opens the detail view
 * with every room, its own volume and a button that adds the room to the lead's group or takes it out again; a full
 * tall tile lists them on the tile too. The lead is the
 * first room that plays, else the first. Speakers are in a group when Homey's `sonos_group` is the same for them.
 */
@Component({
  selector: 'hd-sonos-tile',
  imports: [LucideDynamicIcon, NgTemplateOutlet, Segmented, Transport, SonosMusic, TileDetails],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    ...TILE_FACE_HOST,
    class: 'hd-tile hd-sonos',
    '[class.has-art]': '!!art()',
    '[style.--art]': "art() ? 'url(' + art() + ')' : null",
  },
  template: `
    <div class="hd-sonos__head">
      <svg class="hd-icon" [lucideIcon]="speakerIcon" />
      <div class="hd-sonos__titles">
        @if (canPick()) {
          <ng-container *ngTemplateOutlet="picker" />
        } @else {
          <div class="hd-tile__name">
            {{ face().name }}
            @if (locked()) {
              <svg class="hd-sonos__lock" aria-label="Locked" [lucideIcon]="lockIcon" />
            }
          </div>
        }
        <div class="hd-tile__detail">{{ face().detail }}</div>
      </div>
      <ng-container *ngTemplateOutlet="transport; context: { $implicit: false }" />
    </div>
    <ng-template #picker>
      <select
        class="hd-sonos__pick"
        aria-label="Room to control"
        (change)="picked.set($any($event.target).value)"
      >
        @for (room of foundRooms(); track room.id) {
          <option [value]="room.id" [selected]="room.id === lead()?.id">
            {{ room.name }}
          </option>
        }
      </select>
    </ng-template>
    <ng-template #transport let-all>
      @if (lead(); as lead) {
        <hd-transport
          class="hd-round-btns"
          [playing]="playing()"
          [previous]="canSkip() && (all || size() !== 'small')"
          [next]="canSkip() && (all || size() !== 'small')"
          (toggled)="toggle(lead)"
          (skippedBack)="press(lead, 'speaker_prev')"
          (skippedForward)="press(lead, 'speaker_next')"
        />
      }
    </ng-template>
    <ng-template #groupRow>
      @if (lead(); as lead) {
        <div class="hd-sonos__row">
          <span class="hd-sonos__label">{{
            grouped().length > 1 ? 'Group' : 'Volume'
          }}</span>
          <div
            class="hd-slider"
            role="slider"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-label]="
              'Volume of ' + (grouped().length > 1 ? 'the group' : lead.name)
            "
            [attr.aria-valuenow]="percent('group', lead.volume)"
            tabindex="0"
            (pointerdown)="drag.start($event, 'group')"
            (pointermove)="drag.move($event, 'group')"
            (pointerup)="slideEnd($event, 'group', lead)"
            (pointercancel)="drag.cancel()"
            (keydown.arrowleft)="nudge($event, lead, -0.05, true)"
            (keydown.arrowright)="nudge($event, lead, 0.05, true)"
          >
            <div
              class="hd-slider__fill"
              [style.width.%]="percent('group', lead.volume)"
            ></div>
          </div>
        </div>
      }
    </ng-template>
    <ng-template #roomList>
      <div class="hd-sonos__rooms">
        @for (room of rooms(); track room.id) {
          <div class="hd-sonos__row" [class.is-in-group]="inGroup(room)">
            @if (room.found) {
              <button
                type="button"
                class="hd-sonos__label hd-sonos__room"
                [class.is-lead]="room.id === lead()?.id"
                [attr.aria-pressed]="room.id === lead()?.id"
                [disabled]="!!locked()"
                (click)="picked.set(room.id)"
              >
                {{ room.name }}
              </button>
              <div
                class="hd-slider"
                role="slider"
                aria-valuemin="0"
                aria-valuemax="100"
                [attr.aria-label]="'Volume of ' + room.name"
                [attr.aria-valuenow]="percent(room.id, room.volume)"
                tabindex="0"
                (pointerdown)="drag.start($event, room.id)"
                (pointermove)="drag.move($event, room.id)"
                (pointerup)="slideEnd($event, room.id, room)"
                (pointercancel)="drag.cancel()"
                (keydown.arrowleft)="nudge($event, room, -0.05, false)"
                (keydown.arrowright)="nudge($event, room, 0.05, false)"
              >
                <div
                  class="hd-slider__fill"
                  [style.width.%]="percent(room.id, room.volume)"
                ></div>
              </div>
              <button
                type="button"
                class="hd-round-btn"
                [class.is-busy]="busy(room)"
                [disabled]="room.id === lead()?.id || !room.available || busy(room)"
                [attr.aria-busy]="busy(room)"
                [attr.aria-pressed]="inGroup(room)"
                [attr.aria-label]="
                  inGroup(room)
                    ? 'Take ' + room.name + ' out of the group'
                    : 'Play in ' + room.name
                "
                (click)="toggleGroup(room)"
              >
                @if (!busy(room)) {
                  <svg [lucideIcon]="inGroup(room) ? linkIcon : unlinkIcon" />
                }
              </button>
            } @else {
              <span class="hd-sonos__label">{{ room.name }}</span>
              <span class="hd-sonos__label">Not found in Homey</span>
            }
          </div>
        }
      </div>
    </ng-template>
    @if (size() !== 'small') {
      <ng-container *ngTemplateOutlet="groupRow" />
    }
    @if (size() === 'full-tall') {
      <ng-container *ngTemplateOutlet="roomList" />
    }
    <hd-tile-details
      #details
      [screen]="true"
      [name]="face().name"
      [icon]="speakerIcon"
      [subtitle]="face().detail"
    >
      <hd-segmented hdDetailsHead label="Show" [options]="tabs" [value]="tab()" (picked)="tab.set($event)" />
      <div class="hd-sonos__pane">
        @if (lead(); as lead) {
          <div class="hd-sonos__now">
            <span class="hd-sonos__now-name">
              {{ lead.name }}
              @if (locked()) {
                <svg class="hd-sonos__lock" aria-label="Locked" [lucideIcon]="lockIcon" />
              }
            </span>
            <ng-container *ngTemplateOutlet="transport; context: { $implicit: true }" />
          </div>
        }
        @let current = tab();
        @if (current === 'devices') {
          <ng-container *ngTemplateOutlet="groupRow" />
          <ng-container *ngTemplateOutlet="roomList" />
        } @else if (lead(); as lead) {
          <hd-sonos-music
            [account]="settings().account"
            [deviceId]="lead.id"
            [kind]="current"
          />
        }
      </div>
    </hd-tile-details>
  `,
})
export class SonosTile extends TileView<SonosTileSettings> {
  private readonly realtime = inject(Realtime);

  protected readonly speakerIcon = LucideSpeaker;
  protected readonly lockIcon = LucideLock;
  protected readonly linkIcon = LucideLink;
  protected readonly unlinkIcon = LucideUnlink;

  protected readonly tabs = [
    { id: 'devices', label: 'Devices' },
    { id: 'favorite', label: 'Favorites' },
    { id: 'playlist', label: 'Playlists' },
  ] as const;
  protected readonly tab = signal<'devices' | SpeakerMusicKind>('devices');

  /** The room chosen on an unlocked tile; until then the tile follows what plays. */
  protected readonly picked = signal<string | null>(null);

  /** A drag on one of the volume sliders: a room's own, or `group` for the whole group's. */
  protected readonly drag = new SliderDrag();
  /** Rooms whose group change Homey is still working on, by the membership they are waiting for. */
  protected readonly joining = signal<ReadonlyMap<string, boolean>>(new Map());

  constructor() {
    super();
    // Joining or leaving takes Homey a while: a room is busy until it reports the new membership.
    effect(() => {
      const waiting = this.joining();
      const done = [...waiting].filter(([id, inGroup]) => {
        const room = this.rooms().find((r) => r.id === id);
        return !room || this.inGroup(room) === inGroup;
      });
      if (done.length) this.settle(done.map(([id]) => id));
    });
  }

  protected busy(room: Room) {
    return this.joining().has(room.id);
  }

  private settle(ids: string[]) {
    this.joining.update((m) => new Map([...m].filter(([id]) => !ids.includes(id))));
  }

  protected readonly rooms = computed<Room[]>(() => {
    const known = this.homey()?.devices ?? new Map<string, HomeyDevice>();
    return (this.settings().targets ?? []).map((id) => {
      const device = known.get(id);
      const group = device?.capabilities['sonos_group']?.value;
      const volume = device?.capabilities['volume_set']?.value;
      return {
        id,
        name: device?.name ?? 'Not found',
        found: !!device,
        available: !!device?.available,
        volume: typeof volume === 'number' ? volume : 0,
        group: typeof group === 'string' ? group : null,
        device,
      };
    });
  });

  protected readonly foundRooms = computed(() => this.rooms().filter((r) => r.found));

  /** The room the tile is locked to, when its settings name one of the tile's rooms. */
  protected readonly locked = computed(() => {
    const lock = this.settings().lock;
    return lock ? this.rooms().find((r) => r.id === lock) : undefined;
  });

  /** Whether the tile offers a choice of room: not locked, and more than one to choose from. */
  protected readonly canPick = computed(
    () => !this.locked() && this.foundRooms().length > 1,
  );

  /**
   * The room whose music the tile shows: the locked room; else the one picked on the tile; else the first that
   * plays, else the first.
   */
  protected readonly lead = computed((): Room | undefined => {
    const locked = this.locked();
    if (locked) return locked.found ? locked : undefined;
    const rooms = this.foundRooms();
    return (
      rooms.find((r) => r.id === this.picked()) ??
      rooms.find((r) => isPlaying(r.device)) ??
      rooms[0]
    );
  });

  protected readonly playing = computed(() => isPlaying(this.lead()?.device));

  /** The rooms that play together with the lead, the lead included. */
  protected readonly grouped = computed(() => {
    const lead = this.lead();
    return lead
      ? this.rooms().filter(
          (r) => r.id === lead.id || (!!lead.group && r.group === lead.group),
        )
      : [];
  });

  protected readonly canSkip = computed(
    () => !!this.lead()?.device?.capabilities['speaker_next']?.setable,
  );

  protected readonly art = loadableArt(() =>
    this.playing() ? albumArtUrl(this.lead()?.device, this.homey()?.accountId) : null,
  );

  readonly face = computed<TileFace>(() => {
    const look = { icon: LucideSpeaker, hue: 'appliance' as const };
    const name =
      this.settings().label || this.locked()?.name || 'Speakers';
    if (!this.rooms().length)
      return { ...look, name, detail: 'Pick speakers', state: 'unset' };
    if (!this.homeyLoaded())
      return { ...look, name, detail: '…', state: 'loading' };
    const lead = this.lead();
    if (!lead)
      return { ...look, name, detail: 'Not found in Homey', state: 'missing' };
    const track = nowPlaying(lead.device);
    const together =
      this.grouped().length > 1 ? `${this.grouped().length} rooms · ` : '';
    const detail =
      this.flash() === 'error'
        ? 'Did not respond'
        : this.playing()
          ? together + (track || lead.name)
          : `${lead.name} · Not playing`;
    return {
      ...look,
      name,
      detail,
      active: this.playing(),
      details: true,
      state: lead.available ? 'ok' : 'unavailable',
    };
  });

  protected inGroup(room: Room) {
    return this.grouped().some((r) => r.id === room.id);
  }

  protected percent(key: string, volume: number) {
    return Math.round(this.drag.shown(key, volume) * 100);
  }

  protected toggle(room: Room) {
    this.set(room, 'speaker_playing', !this.playing());
  }

  protected press(room: Room, capability: string) {
    this.set(room, capability, true);
  }

  protected toggleGroup(room: Room) {
    const lead = this.lead();
    if (!lead || room.id === lead.id) return;
    if (this.busy(room)) return;
    const account = this.settings().account;
    const join = !this.inGroup(room);
    this.joining.update((m) => new Map(m).set(room.id, join));
    // Give up waiting after a while, so a change Homey never reports does not keep the room busy.
    setTimeout(() => this.settle([room.id]), 30000);
    this.send(
      () =>
        join
          ? this.realtime.joinSpeakerGroup(account, room.id, lead.id)
          : this.realtime.leaveSpeakerGroup(account, room.id),
      'quiet',
    ).then(() => undefined, () => this.settle([room.id]));
  }

  private set(room: Room, capability: string, value: boolean | number) {
    // The tile changes when Homey reports the new value, not before.
    return this.send(
      () =>
        this.realtime.setCapability(
          this.settings().account,
          room.id,
          capability,
          value,
        ),
      'quiet',
    );
  }

  private setVolume(room: Room, volume: number, wholeGroup: boolean) {
    const account = this.settings().account;
    if (!wholeGroup)
      return this.set(room, 'volume_set', Math.round(volume * 100) / 100);
    // A group of one is set like the room.
    if (this.grouped().length < 2)
      return this.set(room, 'volume_set', Math.round(volume * 100) / 100);
    return this.send(
      () =>
        this.realtime.setGroupVolume(
          account,
          room.id,
          Math.max(1, volume * 100),
        ),
      'quiet',
    );
  }

  protected slideEnd(event: PointerEvent, key: string, room: Room) {
    return this.drag.end(event, key, (value) => this.setVolume(room, value, key === 'group'));
  }

  protected nudge(event: Event, room: Room, by: number, wholeGroup: boolean) {
    event.preventDefault();
    this.setVolume(
      room,
      Math.min(1, Math.max(0, room.volume + by)),
      wholeGroup,
    );
  }
}

/** Management's choice of the room a Sonos tile is locked to. */
@Component({
  selector: 'hd-sonos-tile-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hd-field">
      <label class="hd-field__label" for="tile-lock">Locked to</label>
      <select
        id="tile-lock"
        class="hd-select"
        (change)="pick($any($event.target).value)"
      >
        <option value="" [selected]="!isRoom(settings().lock)">
          Not locked (pick a room on the tile)
        </option>
        @for (room of rooms(); track room.id) {
          <option [value]="room.id" [selected]="room.id === settings().lock">
            {{ room.name }}
          </option>
        }
      </select>
    </div>
  `,
})
export class SonosTileSettingsEditor {
  readonly settings = input.required<SonosTileSettings>();
  readonly changed = output<Partial<SonosTileSettings>>();

  private readonly data = inject(TileData);

  protected readonly rooms = computed(() => {
    const devices = this.data.homey(this.settings().account)?.devices;
    return (this.settings().targets ?? []).map((id) => ({
      id,
      name: devices?.get(id)?.name ?? 'Not found',
    }));
  });

  protected isRoom(id: string | undefined) {
    return !!id && (this.settings().targets ?? []).includes(id);
  }

  protected pick(id: string) {
    this.changed.emit({ lock: id || undefined });
  }
}
