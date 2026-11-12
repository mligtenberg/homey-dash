import type { LucideIconData } from '@lucide/angular';
import {
  Activity,
  AirVent,
  Airplay,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AudioLines,
  Bell,
  Blinds,
  Box,
  Camera,
  Car,
  ChartLine,
  Check,
  Maximize2,
  Minimize2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Clapperboard,
  Clock,
  Timer,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudMoonRain,
  CloudRain,
  CloudSnow,
  CloudSun,
  CloudSunRain,
  Coffee,
  DoorOpen,
  Equal,
  Eye,
  EyeOff,
  Fan,
  Flame,
  Gamepad2,
  Heart,
  House,
  Image,
  ImageOff,
  Images,
  KeyRound,
  Layers,
  Library,
  Lightbulb,
  Link,
  Lock,
  LockOpen,
  MapPin,
  MapPinOff,
  Mic,
  Monitor,
  MonitorCog,
  Moon,
  Music,
  Newspaper,
  Minus,
  Pause,
  Play,
  Plug,
  Plus,
  Podcast,
  Power,
  Radar,
  RotateCcw,
  RotateCw,
  ScanEye,
  Search,
  Settings,
  Shield,
  SkipBack,
  SkipForward,
  Snowflake,
  Sparkles,
  Speaker,
  Square,
  Star,
  Store,
  Sun,
  Thermometer,
  Trash,
  Tv,
  Unlink,
  User,
  Users,
  Variable,
  Video,
  Volume1,
  Volume2,
  VolumeX,
  WashingMachine,
  Workflow,
  X,
  Zap,
  LayoutDashboard,
  Calendar,
  CornerDownLeft,
  ArrowRight,
  TriangleAlert,
  CloudUpload,
  Gauge,
} from 'lucide';

// Icons as plain data, not as @lucide/angular's icon components: those each carry their own copy of the template,
// which made the icons a third of the app's initial bundle. [lucideIcon] takes this data just the same.
function icon(name: string, node: unknown): LucideIconData {
  return { name, node } as LucideIconData;
}

export const LucideActivity = /* @__PURE__ */ icon('activity', Activity);
export const LucideAirVent = /* @__PURE__ */ icon('air-vent', AirVent);
export const LucideAirplay = /* @__PURE__ */ icon('airplay', Airplay);
export const LucideArrowDown = /* @__PURE__ */ icon('arrow-down', ArrowDown);
export const LucideArrowLeft = /* @__PURE__ */ icon('arrow-left', ArrowLeft);
export const LucideArrowUp = /* @__PURE__ */ icon('arrow-up', ArrowUp);
export const LucideAudioLines = /* @__PURE__ */ icon('audio-lines', AudioLines);
export const LucideBell = /* @__PURE__ */ icon('bell', Bell);
export const LucideBlinds = /* @__PURE__ */ icon('blinds', Blinds);
export const LucideBox = /* @__PURE__ */ icon('box', Box);
export const LucideCamera = /* @__PURE__ */ icon('camera', Camera);
export const LucideCar = /* @__PURE__ */ icon('car', Car);
export const LucideNewspaper = /* @__PURE__ */ icon('newspaper', Newspaper);
export const LucideChartLine = /* @__PURE__ */ icon('chart-line', ChartLine);
export const LucideMaximize2 = /* @__PURE__ */ icon('maximize-2', Maximize2);
export const LucideMinimize2 = /* @__PURE__ */ icon('minimize-2', Minimize2);
export const LucideCheck = /* @__PURE__ */ icon('check', Check);
export const LucideChevronDown = /* @__PURE__ */ icon(
  'chevron-down',
  ChevronDown,
);
export const LucideChevronLeft = /* @__PURE__ */ icon(
  'chevron-left',
  ChevronLeft,
);
export const LucideChevronRight = /* @__PURE__ */ icon(
  'chevron-right',
  ChevronRight,
);
export const LucideChevronUp = /* @__PURE__ */ icon('chevron-up', ChevronUp);
export const LucideChevronsDown = /* @__PURE__ */ icon(
  'chevrons-down',
  ChevronsDown,
);
export const LucideChevronsUp = /* @__PURE__ */ icon('chevrons-up', ChevronsUp);
export const LucideClapperboard = /* @__PURE__ */ icon(
  'clapperboard',
  Clapperboard,
);
export const LucideClock = /* @__PURE__ */ icon('clock', Clock);
export const LucideTimer = /* @__PURE__ */ icon('timer', Timer);
export const LucideCloud = /* @__PURE__ */ icon('cloud', Cloud);
export const LucideCloudDrizzle = /* @__PURE__ */ icon(
  'cloud-drizzle',
  CloudDrizzle,
);
export const LucideCloudFog = /* @__PURE__ */ icon('cloud-fog', CloudFog);
export const LucideCloudLightning = /* @__PURE__ */ icon(
  'cloud-lightning',
  CloudLightning,
);
export const LucideCloudMoon = /* @__PURE__ */ icon('cloud-moon', CloudMoon);
export const LucideCloudMoonRain = /* @__PURE__ */ icon(
  'cloud-moon-rain',
  CloudMoonRain,
);
export const LucideCloudRain = /* @__PURE__ */ icon('cloud-rain', CloudRain);
export const LucideCloudSnow = /* @__PURE__ */ icon('cloud-snow', CloudSnow);
export const LucideCloudSun = /* @__PURE__ */ icon('cloud-sun', CloudSun);
export const LucideCloudSunRain = /* @__PURE__ */ icon(
  'cloud-sun-rain',
  CloudSunRain,
);
export const LucideCoffee = /* @__PURE__ */ icon('coffee', Coffee);
export const LucideDoorOpen = /* @__PURE__ */ icon('door-open', DoorOpen);
export const LucideEqual = /* @__PURE__ */ icon('equal', Equal);
export const LucideEye = /* @__PURE__ */ icon('eye', Eye);
export const LucideEyeOff = /* @__PURE__ */ icon('eye-off', EyeOff);
export const LucideFan = /* @__PURE__ */ icon('fan', Fan);
export const LucideFlame = /* @__PURE__ */ icon('flame', Flame);
export const LucideGamepad2 = /* @__PURE__ */ icon('gamepad-2', Gamepad2);
export const LucideHouse = /* @__PURE__ */ icon('house', House);
export const LucideImage = /* @__PURE__ */ icon('image', Image);
export const LucideHeart = /* @__PURE__ */ icon('heart', Heart);
export const LucideImageOff = /* @__PURE__ */ icon('image-off', ImageOff);
export const LucideImages = /* @__PURE__ */ icon('images', Images);
export const LucideKeyRound = /* @__PURE__ */ icon('key-round', KeyRound);
export const LucideLayers = /* @__PURE__ */ icon('layers', Layers);
export const LucideLibrary = /* @__PURE__ */ icon('library', Library);
export const LucideLightbulb = /* @__PURE__ */ icon('lightbulb', Lightbulb);
export const LucideLink = /* @__PURE__ */ icon('link', Link);
export const LucideLock = /* @__PURE__ */ icon('lock', Lock);
export const LucideLockOpen = /* @__PURE__ */ icon('lock-open', LockOpen);
export const LucideMapPin = /* @__PURE__ */ icon('map-pin', MapPin);
export const LucideMapPinOff = /* @__PURE__ */ icon('map-pin-off', MapPinOff);
export const LucideMic = /* @__PURE__ */ icon('mic', Mic);
export const LucideMonitor = /* @__PURE__ */ icon('monitor', Monitor);
export const LucideMonitorCog = /* @__PURE__ */ icon('monitor-cog', MonitorCog);
export const LucideMoon = /* @__PURE__ */ icon('moon', Moon);
export const LucideMusic = /* @__PURE__ */ icon('music', Music);
export const LucideMinus = /* @__PURE__ */ icon('minus', Minus);
export const LucidePause = /* @__PURE__ */ icon('pause', Pause);
export const LucidePlay = /* @__PURE__ */ icon('play', Play);
export const LucidePlug = /* @__PURE__ */ icon('plug', Plug);
export const LucidePlus = /* @__PURE__ */ icon('plus', Plus);
export const LucidePodcast = /* @__PURE__ */ icon('podcast', Podcast);
export const LucidePower = /* @__PURE__ */ icon('power', Power);
export const LucideRadar = /* @__PURE__ */ icon('radar', Radar);
export const LucideRotateCcw = /* @__PURE__ */ icon('rotate-ccw', RotateCcw);
export const LucideRotateCw = /* @__PURE__ */ icon('rotate-cw', RotateCw);
export const LucideScanEye = /* @__PURE__ */ icon('scan-eye', ScanEye);
export const LucideSearch = /* @__PURE__ */ icon('search', Search);
export const LucideSettings = /* @__PURE__ */ icon('settings', Settings);
export const LucideShield = /* @__PURE__ */ icon('shield', Shield);
export const LucideSkipBack = /* @__PURE__ */ icon('skip-back', SkipBack);
export const LucideSkipForward = /* @__PURE__ */ icon(
  'skip-forward',
  SkipForward,
);
export const LucideSnowflake = /* @__PURE__ */ icon('snowflake', Snowflake);
export const LucideSparkles = /* @__PURE__ */ icon('sparkles', Sparkles);
export const LucideSpeaker = /* @__PURE__ */ icon('speaker', Speaker);
export const LucideSquare = /* @__PURE__ */ icon('square', Square);
export const LucideStar = /* @__PURE__ */ icon('star', Star);
export const LucideStore = /* @__PURE__ */ icon('store', Store);
export const LucideSun = /* @__PURE__ */ icon('sun', Sun);
export const LucideThermometer = /* @__PURE__ */ icon(
  'thermometer',
  Thermometer,
);
export const LucideTrash = /* @__PURE__ */ icon('trash', Trash);
export const LucideTv = /* @__PURE__ */ icon('tv', Tv);
export const LucideUnlink = /* @__PURE__ */ icon('unlink', Unlink);
export const LucideUser = /* @__PURE__ */ icon('user', User);
export const LucideUsers = /* @__PURE__ */ icon('users', Users);
export const LucideVariable = /* @__PURE__ */ icon('variable', Variable);
export const LucideVideo = /* @__PURE__ */ icon('video', Video);
export const LucideVolume1 = /* @__PURE__ */ icon('volume-1', Volume1);
export const LucideVolume2 = /* @__PURE__ */ icon('volume-2', Volume2);
export const LucideVolumeX = /* @__PURE__ */ icon('volume-x', VolumeX);
export const LucideWashingMachine = /* @__PURE__ */ icon(
  'washing-machine',
  WashingMachine,
);
export const LucideWorkflow = /* @__PURE__ */ icon('workflow', Workflow);
export const LucideX = /* @__PURE__ */ icon('x', X);
export const LucideZap = /* @__PURE__ */ icon('zap', Zap);
export const LucideLayoutDashboard = /* @__PURE__ */ icon('layout-dashboard', LayoutDashboard);
export const LucideCalendar = /* @__PURE__ */ icon('calendar', Calendar);
export const LucideCornerDownLeft = /* @__PURE__ */ icon('corner-down-left', CornerDownLeft);
export const LucideArrowRight = /* @__PURE__ */ icon('arrow-right', ArrowRight);
export const LucideTriangleAlert = /* @__PURE__ */ icon('triangle-alert', TriangleAlert);
export const LucideCloudUpload = /* @__PURE__ */ icon('cloud-upload', CloudUpload);
export const LucideGauge = /* @__PURE__ */ icon('gauge', Gauge);
