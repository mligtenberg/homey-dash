// Generates HomeyDash's built-in dashboard backgrounds: every style (a way of drawing) × every subject (a scene), by
// day and by night, as <style>/<subject>-day.svg and -night.svg next to this script, plus manifest.json, an overview
// page (index.html) and the list Management picks from (libs/tiles/src/lib/background-presets.ts). Run it again after
// changing a style or a scene:
//
//   node libs/design-system/backgrounds/generate.mjs
//
// A scene is drawn once from plain shapes on a 1600 × 1000 canvas (landscape, cropped to cover any display) in tones
// rather than colours; each style decides how a shape and a tone look. Displays show the day image in the light theme and
// the night one in the dark theme, so tiles turned to glass over them stay readable: day images are light and soft, night
// ones dark and muted.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1600;
const H = 1000;
const FLOOR = 780;
const here = dirname(fileURLToPath(import.meta.url));

// A scene is drawn by day or by night (night true); most only change colour, which is up to the style.

// ---- Shapes, in tones: g ground, a and b the main things, c accent, d light detail, e dark detail ----

const R = (x, y, w, h, t, r = 0, o) => ({ s: 'rect', x, y, w, h, t, r, o });
const C = (cx, cy, r, t, o) => ({ s: 'circle', cx, cy, r, t, o });
const E = (cx, cy, rx, ry, t, o) => ({ s: 'ellipse', cx, cy, rx, ry, t, o });
const P = (pts, t, o) => ({ s: 'poly', pts, t, o });
const L = (x1, y1, x2, y2, t, w = 8, o) => ({ s: 'polyline', pts: [[x1, y1], [x2, y2]], t, w, o });
const PL = (pts, t, w = 8, o) => ({ s: 'polyline', pts, t, w, o });
// Angles in degrees, clockwise from the right (SVG's y points down).
const A = (cx, cy, r, a0, a1, t, w = 8, o) => ({ s: 'arc', cx, cy, r, a0, a1, t, w, o });

const floor = () => R(0, FLOOR, W, H - FLOOR, 'g');
const star = (cx, cy, r, t) =>
  P(Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const d = i % 2 ? r * 0.45 : r;
    return [cx + d * Math.cos(a), cy + d * Math.sin(a)];
  }), t);
const cloud = (cx, cy, s, t) => [
  C(cx - 70 * s, cy + 10 * s, 50 * s, t), C(cx, cy - 20 * s, 70 * s, t), C(cx + 75 * s, cy + 5 * s, 55 * s, t),
  R(cx - 120 * s, cy + 10 * s, 250 * s, 50 * s, t, 25 * s),
];
const note = (x, y, t) => [E(x, y, 28, 20, t), L(x + 25, y, x + 25, y - 110, t, 8), L(x + 25, y - 110, x + 70, y - 80, t, 8)];
const wave = (x, y, len, amp, t, w = 6) =>
  PL(Array.from({ length: 13 }, (_, i) => [x + amp * Math.sin((i / 12) * Math.PI * 2), y - (i / 12) * len]), t, w);
const picket = (x) => P([[x, 840], [x, 660], [x + 20, 630], [x + 40, 660], [x + 40, 840]], 'd');
const stars = (list) => list.map(([x, y], i) => C(x, y, i % 3 ? 4 : 6, 'd', 0.7));
// The sun by day; by night a moon a little smaller, with stars around it.
const sky = (night, x, y, r) => night
  ? [C(x, y, r * 0.75, 'd', 0.9), ...stars([[x - 260, y - 60], [x + 200, y + 120], [x - 420, y + 90], [x + 330, y - 80], [x - 120, y + 200], [x + 60, y - 150]])]
  : [C(x, y, r, 'c')];

const SUBJECTS = {
  'living-room': ['Living room', (night) => [
    floor(),
    R(1060, 170, 320, 370, 'd', 6, 0.5), L(1220, 170, 1220, 540, 'b', 10), L(1060, 355, 1380, 355, 'b', 10),
    R(330, 230, 220, 150, 'b', 4), R(348, 248, 184, 114, 'c', 2, 0.7),
    E(700, 870, 440, 52, 'b', 0.6),
    R(420, 540, 560, 170, 'a', 30), R(400, 640, 600, 110, 'a', 20),
    R(480, 570, 180, 90, 'b', 20), R(740, 570, 180, 90, 'b', 20),
    R(365, 600, 80, 160, 'b', 30), R(955, 600, 80, 160, 'b', 30),
    R(420, 750, 20, 30, 'e'), R(960, 750, 20, 30, 'e'),
    L(1180, 780, 1180, 520, 'e', 10), E(1180, 780, 60, 12, 'e'), P([[1110, 520], [1250, 520], [1220, 430], [1140, 430]], 'c'),
    E(210, 610, 40, 95, 'b'), E(290, 600, 40, 105, 'b'), E(250, 570, 35, 115, 'a'),
    P([[190, 780], [310, 780], [325, 670], [175, 670]], 'c'),
  ]],
  bathroom: ['Bathroom', (night) => [
    ...Array.from({ length: 7 }, (_, i) => L(0, 110 * (i + 1), W, 110 * (i + 1), 'd', 3, 0.3)),
    ...Array.from({ length: 14 }, (_, i) => L(110 * (i + 1), 0, 110 * (i + 1), FLOOR, 'd', 3, 0.3)),
    floor(),
    L(420, 560, 420, 220, 'e', 10), L(420, 220, 520, 220, 'e', 10), P([[490, 220], [550, 220], [580, 270], [460, 270]], 'c'),
    ...[470, 505, 540].flatMap((x, i) => [L(x, 310 + i * 20, x - 4, 345 + i * 20, 'd', 6), L(x + 10, 400 - i * 15, x + 6, 435 - i * 15, 'd', 6)]),
    R(360, 580, 660, 170, 'a', 80), R(340, 560, 700, 40, 'b', 20),
    R(420, 740, 40, 50, 'e', 10), R(920, 740, 40, 50, 'e', 10),
    L(980, 560, 980, 470, 'e', 14), L(980, 470, 920, 470, 'e', 14),
    C(480, 545, 30, 'd'), C(540, 528, 22, 'd'), C(600, 546, 26, 'd'), C(860, 540, 24, 'd'), C(810, 522, 16, 'd'),
    E(1300, 330, 135, 175, 'b'), E(1300, 330, 118, 158, 'd', 0.6),
    R(1270, 580, 60, 200, 'a', 10), R(1190, 520, 220, 60, 'a', 20), L(1300, 520, 1300, 490, 'e', 10),
  ]],
  media: ['Media', (night) => [
    floor(),
    R(380, 640, 840, 140, 'a', 12), L(660, 655, 660, 765, 'e', 4), L(940, 655, 940, 765, 'e', 4),
    R(770, 600, 60, 40, 'e'),
    R(440, 220, 720, 400, 'e', 14), R(462, 242, 676, 356, 'b', 6),
    P([[760, 360], [760, 480], [860, 420]], 'd'),
    ...[290, 1310].flatMap((x) => [R(x - 60, 420, 120, 360, 'a', 14), C(x, 500, 34, 'e'), C(x, 650, 50, 'e'), C(x, 650, 20, 'b')]),
    E(800, 860, 300, 40, 'b', 0.5),
  ]],
  music: ['Music', (night) => [
    floor(),
    C(1150, 380, 200, 'e'),
    ...[175, 150, 125, 100].map((r) => A(1150, 380, r, 0, 360, 'b', 3)),
    C(1150, 380, 55, 'c'), C(1150, 380, 8, 'e'),
    ...note(660, 400, 'd'), ...note(800, 300, 'd'), ...note(1460, 700, 'd'),
    R(400, 170, 40, 320, 'a'), R(388, 110, 64, 80, 'a', 10),
    C(420, 520, 95, 'c'), C(420, 650, 125, 'c'), C(420, 580, 34, 'e'), R(375, 690, 90, 18, 'e'),
    ...[408, 420, 432].map((x) => L(x, 130, x, 700, 'd', 2)),
    A(820, 660, 100, 180, 360, 'a', 22), R(695, 640, 55, 100, 'b', 22), R(890, 640, 55, 100, 'b', 22),
  ]],
  kitchen: ['Kitchen', (night) => [
    floor(),
    R(250, 190, 520, 180, 'a', 10), L(380, 200, 380, 360, 'e', 4), L(510, 200, 510, 360, 'e', 4), L(640, 200, 640, 360, 'e', 4),
    R(830, 240, 240, 200, 'd', 6, 0.5), L(950, 240, 950, 440, 'b', 8), L(830, 340, 1070, 340, 'b', 8),
    L(780, 0, 780, 130, 'e', 4), P([[720, 190], [840, 190], [810, 130], [750, 130]], 'c'),
    L(1110, 0, 1110, 130, 'e', 4), P([[1050, 190], [1170, 190], [1140, 130], [1080, 130]], 'c'),
    R(200, 580, 900, 200, 'a', 8), R(180, 560, 940, 30, 'b', 6),
    L(500, 600, 500, 760, 'e', 4), L(800, 600, 800, 760, 'e', 4), L(320, 640, 380, 640, 'e', 6), L(620, 640, 680, 640, 'e', 6),
    R(560, 470, 160, 90, 'c', 14), E(640, 470, 90, 14, 'b'), L(540, 490, 560, 490, 'e', 10), L(720, 490, 740, 490, 'e', 10),
    wave(610, 440, 110, 10, 'd', 5), wave(660, 430, 130, 10, 'd', 5),
    R(290, 480, 110, 80, 'b', 30), L(400, 500, 430, 480, 'b', 10), L(320, 480, 370, 480, 'e', 10),
    R(1200, 240, 260, 540, 'b', 20), L(1200, 460, 1460, 460, 'e', 6), L(1230, 300, 1230, 420, 'e', 10), L(1230, 500, 1230, 620, 'e', 10),
  ]],
  bedroom: ['Bedroom', (night) => [
    floor(),
    ...(night
      ? [R(1140, 160, 300, 320, 'e', 6), R(1140, 160, 300, 320, 'b', 6, 0.25), C(1340, 250, 45, 'd'), C(1360, 235, 40, 'e'),
        ...stars([[1190, 230], [1250, 330], [1400, 400], [1200, 420]])]
      : [R(1140, 160, 300, 320, 'd', 6, 0.5), C(1350, 250, 45, 'c', 0.8)]),
    L(1290, 160, 1290, 480, 'b', 10), L(1140, 320, 1440, 320, 'b', 10),
    R(420, 390, 600, 240, 'a', 60),
    R(380, 580, 680, 150, 'b', 24), R(380, 630, 680, 120, 'c', 24),
    R(400, 740, 30, 40, 'e'), R(1010, 740, 30, 40, 'e'),
    R(460, 530, 220, 80, 'd', 40), R(760, 530, 220, 80, 'd', 40),
    R(1110, 620, 150, 160, 'a', 10), L(1130, 700, 1240, 700, 'e', 4),
    R(1165, 580, 40, 40, 'e'), P([[1130, 580], [1240, 580], [1215, 500], [1155, 500]], 'c'),
  ]],
  garden: ['Garden', (night) => [
    ...sky(night, 1250, 220, 90),
    E(400, 900, 700, 260, 'b'), E(1300, 920, 700, 240, 'a'), R(0, 820, W, H - 820, 'g'),
    R(60, 690, 540, 20, 'd'), R(60, 780, 540, 20, 'd'), ...[80, 150, 220, 290, 360, 430, 500].map(picket),
    R(1050, 560, 40, 280, 'e'), C(1070, 470, 130, 'a'), C(990, 540, 90, 'a'), C(1150, 540, 90, 'a'),
    R(1395, 650, 26, 190, 'e'), C(1408, 600, 80, 'b'),
    ...[[700, 700], [760, 730], [820, 690], [880, 720]].flatMap(([x, y], i) => [L(x, 840, x, y, 'a', 6), C(x, y, 22, i % 2 ? 'c' : 'd')]),
  ]],
  'kids-room': ['Kids’ room', (night) => [
    floor(),
    L(150, 150, 800, 220, 'e', 4), L(800, 220, 1450, 150, 'e', 4),
    ...Array.from({ length: 12 }, (_, i) => {
      const x = 190 + i * 105;
      const y = x < 800 ? 150 + ((x - 150) / 650) * 70 : 220 - ((x - 800) / 650) * 70;
      return P([[x - 30, y], [x + 30, y], [x, y + 70]], ['c', 'b', 'd'][i % 3]);
    }),
    star(560, 360, 40, 'd'), star(1300, 340, 34, 'd'), star(1430, 470, 24, 'd'), star(200, 420, 26, 'd'),
    R(300, 640, 140, 140, 'c', 10), R(440, 640, 140, 140, 'b', 10), R(370, 500, 140, 140, 'a', 10),
    C(720, 710, 70, 'c'), A(720, 710, 70, 200, 340, 'd', 8), A(720, 710, 40, 20, 160, 'd', 8),
    C(1000, 505, 28, 'b'), C(1100, 505, 28, 'b'), E(1050, 700, 95, 90, 'b'), C(1050, 560, 70, 'b'),
    E(1050, 585, 30, 22, 'd'), C(1025, 545, 7, 'e'), C(1075, 545, 7, 'e'), E(1050, 712, 50, 45, 'd', 0.6),
  ]],
  office: ['Office', (night) => [
    floor(),
    R(180, 220, 320, 560, 'a', 8), ...[360, 500, 640].map((y) => L(180, y, 500, y, 'e', 6)),
    ...[[220, 260, 'c'], [265, 280, 'b'], [305, 250, 'd'], [350, 290, 'c'], [395, 270, 'b'],
      [220, 410, 'b'], [262, 395, 'd'], [305, 420, 'c'], [420, 400, 'b'],
      [215, 545, 'd'], [258, 560, 'c'], [300, 540, 'b'], [345, 555, 'd']].map(([x, y, t]) =>
      R(x, y, 34, (y < 360 ? 360 : y < 500 ? 500 : 640) - y, t, 3)),
    C(1340, 230, 70, 'd', 0.7), L(1340, 230, 1340, 185, 'e', 8), L(1340, 230, 1375, 245, 'e', 8),
    R(620, 560, 760, 30, 'b', 6), R(650, 590, 24, 190, 'e'), R(1326, 590, 24, 190, 'e'), R(1160, 590, 170, 150, 'a', 6),
    L(1180, 660, 1310, 660, 'e', 4),
    R(800, 320, 360, 220, 'e', 12), R(816, 336, 328, 172, 'b', 6), R(965, 540, 30, 20, 'e'), R(930, 552, 100, 8, 'e'),
    L(700, 560, 680, 440, 'e', 10), L(680, 440, 740, 380, 'e', 10), P([[720, 370], [790, 360], [790, 420], [750, 415]], 'c'),
    R(1240, 500, 50, 60, 'c', 8), E(1265, 480, 30, 40, 'a'),
  ]],
  energy: ['Energy', (night) => [
    ...sky(night, 300, 210, 90),
    R(0, 800, W, H - 800, 'g'),
    R(250, 560, 420, 240, 'a'), P([[220, 570], [460, 400], [700, 570]], 'b'),
    R(430, 680, 70, 120, 'e', 6), R(300, 620, 80, 70, 'd', 4, 0.6), R(560, 620, 80, 70, 'd', 4, 0.6),
    ...[780, 970].flatMap((x) => [
      L(x + 50, 700, x + 50, 800, 'e', 8), L(x + 130, 700, x + 130, 800, 'e', 8),
      P([[x, 720], [x + 180, 720], [x + 155, 600], [x + 25, 600]], 'b'),
      L(x + 12, 660, x + 168, 660, 'd', 3), L(x + 60, 600, x + 55, 720, 'd', 3), L(x + 120, 600, x + 125, 720, 'd', 3),
    ]),
    P([[1340, 800], [1362, 800], [1356, 330], [1346, 330]], 'd'),
    ...[90, 210, 330].map((a) => {
      const r = (a * Math.PI) / 180;
      const n = r + Math.PI / 2;
      const [x, y] = [1351 + 220 * Math.cos(r), 320 + 220 * Math.sin(r)];
      return P([[1351 + 10 * Math.cos(n), 320 + 10 * Math.sin(n)], [x, y], [1351 - 10 * Math.cos(n), 320 - 10 * Math.sin(n)]], 'd');
    }),
    C(1351, 320, 16, 'd'),
    P([[1170, 260], [1110, 400], [1160, 400], [1120, 520], [1220, 360], [1165, 360], [1210, 260]], 'c', 0.8),
  ]],
  climate: ['Climate', (night) => [
    floor(),
    R(300, 560, 500, 200, 'a', 16), ...Array.from({ length: 8 }, (_, i) => R(325 + i * 60, 575, 35, 170, 'b', 18)),
    R(330, 760, 20, 20, 'e'), R(750, 760, 20, 20, 'e'),
    wave(400, 520, 160, 14, 'c'), wave(550, 520, 190, 14, 'c'), wave(700, 520, 160, 14, 'c'),
    C(1100, 360, 120, 'b'), C(1100, 360, 96, 'e'), A(1100, 360, 96, 135, 405, 'a', 14), A(1100, 360, 96, 135, 300, 'c', 14),
    C(1100, 360, 34, 'd', 0.8),
    R(1380, 230, 50, 340, 'd', 25), C(1405, 600, 50, 'd'), R(1395, 360, 30, 240, 'c', 10), C(1405, 600, 36, 'c'),
    ...[280, 340, 400, 460].map((y) => L(1440, y, 1465, y, 'd', 5)),
    ...[0, 60, 120].map((a) => {
      const r = (a * Math.PI) / 180;
      return L(760 - 60 * Math.cos(r), 250 - 60 * Math.sin(r), 760 + 60 * Math.cos(r), 250 + 60 * Math.sin(r), 'd', 8);
    }),
  ]],
  security: ['Security', (night) => [
    R(0, 800, W, H - 800, 'g'), E(320, 810, 120, 60, 'a'), E(1500, 810, 140, 70, 'a'),
    R(450, 480, 560, 320, 'a'), P([[400, 490], [730, 260], [1060, 490]], 'b'),
    R(680, 640, 100, 160, 'e', 8), R(520, 560, 110, 90, night ? 'c' : 'd', 4, 0.7), R(830, 560, 110, 90, night ? 'c' : 'd', 4, 0.7), C(730, 610, 12, 'c'),
    L(450, 380, 520, 410, 'e', 10), P([[330, 330], [470, 350], [460, 400], [320, 385]], 'b'), C(330, 357, 18, 'e'),
    P([[1300, 220], [1420, 270], [1410, 420], [1300, 510], [1190, 420], [1180, 270]], 'c'),
    PL([[1245, 370], [1290, 415], [1360, 320]], 'd', 18),
    A(200, 600, 50, 180, 360, 'd', 16), R(140, 600, 120, 110, 'b', 14), C(200, 645, 12, 'e'), R(195, 650, 10, 30, 'e'),
  ]],
  garage: ['Garage', (night) => [
    floor(),
    ...[110, 150, 190].map((y) => L(0, y, W, y, 'd', 3, 0.3)),
    L(800, 0, 800, 80, 'e', 4), P([[750, 120], [850, 120], [830, 80], [770, 80]], 'c'),
    R(1180, 230, 320, 260, 'b', 8),
    L(1240, 280, 1240, 440, 'd', 14), C(1240, 275, 24, 'd'),
    L(1320, 280, 1320, 450, 'd', 12), R(1290, 260, 60, 30, 'd', 4),
    L(1410, 270, 1410, 380, 'c', 12), L(1410, 380, 1410, 450, 'd', 6),
    R(170, 320, 100, 160, 'b', 14), C(220, 375, 18, 'c'), PL([[220, 480], [220, 560], [280, 610], [330, 660]], 'e', 8),
    P([[300, 720], [300, 640], [420, 625], [520, 555], [800, 550], [920, 625], [1100, 645], [1110, 720]], 'a'),
    P([[540, 572], [650, 572], [650, 626], [470, 628]], 'd', 0.6), P([[670, 572], [790, 570], [880, 626], [670, 626]], 'd', 0.6),
    E(1098, 668, 14, 10, 'c'),
    C(450, 730, 70, 'e'), C(450, 730, 32, 'b'), C(950, 730, 70, 'e'), C(950, 730, 32, 'b'),
  ]],
  outdoors: ['Outdoors', (night) => [
    ...sky(night, 1100, 260, 110),
    ...cloud(990, 340, 1, 'd'),
    ...cloud(400, 230, 1.1, 'b'),
    ...[300, 360, 420, 480].map((x, i) => L(x, 320 + (i % 2) * 20, x - 20, 400 + (i % 2) * 20, 'd', 6)),
    ...(night ? [] : [PL([[640, 170], [665, 190], [690, 170]], 'e', 6), PL([[720, 140], [740, 155], [760, 140]], 'e', 6)]),
    P([[0, 800], [300, 470], [520, 700], [800, 420], [1150, 800]], 'a'),
    P([[700, 800], [1100, 520], [1350, 680], [1600, 560], [1600, 800]], 'b'),
    R(0, 800, W, H - 800, 'g'),
  ]],
};

// ---- Helpers ----

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, f) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * f));
const shade = (c, f) => mix(c, f < 0 ? '#000000' : '#ffffff', Math.abs(f));
const n = (v) => +v.toFixed(1);
const pts = (list) => list.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');

function rng(seed) {
  let s = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 2166136261);
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function arcPoints({ cx, cy, r, a0, a1 }, steps = 24) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

const opacity = (shape, extra = 1) => (shape.o ?? 1) * extra;
// As fill and stroke opacity rather than opacity, which is the same for one shape and which the API's renderer (Svg.Skia)
// leaves out inside a filtered group.
const op = (o) => (o < 1 ? ` fill-opacity="${n(o)}" stroke-opacity="${n(o)}"` : '');

// An outline-free shape in plain SVG; lines and arcs are strokes.
function plain(shape, fill, extra = 1, round = true) {
  const o = op(opacity(shape, extra));
  switch (shape.s) {
    case 'rect':
      return `<rect x="${n(shape.x)}" y="${n(shape.y)}" width="${n(shape.w)}" height="${n(shape.h)}"${round && shape.r ? ` rx="${shape.r}"` : ''} fill="${fill}"${o}/>`;
    case 'circle':
      return `<circle cx="${n(shape.cx)}" cy="${n(shape.cy)}" r="${n(shape.r)}" fill="${fill}"${o}/>`;
    case 'ellipse':
      return `<ellipse cx="${n(shape.cx)}" cy="${n(shape.cy)}" rx="${n(shape.rx)}" ry="${n(shape.ry)}" fill="${fill}"${o}/>`;
    case 'poly':
      return `<polygon points="${pts(shape.pts)}" fill="${fill}"${o}/>`;
    case 'polyline':
      return `<polyline points="${pts(shape.pts)}" fill="none" stroke="${fill}" stroke-width="${shape.w}" stroke-linecap="round" stroke-linejoin="round"${o}/>`;
    case 'arc':
      return `<polyline points="${pts(arcPoints(shape))}" fill="none" stroke="${fill}" stroke-width="${shape.w}" stroke-linecap="round"${o}/>`;
  }
}

// The same shape drawn as an outline only.
function outline(shape, stroke, width, extra = 1) {
  const o = op(opacity(shape, extra));
  const s = `fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${o}`;
  switch (shape.s) {
    case 'rect':
      return `<rect x="${n(shape.x)}" y="${n(shape.y)}" width="${n(shape.w)}" height="${n(shape.h)}"${shape.r ? ` rx="${shape.r}"` : ''} ${s}/>`;
    case 'circle':
      return `<circle cx="${n(shape.cx)}" cy="${n(shape.cy)}" r="${n(shape.r)}" ${s}/>`;
    case 'ellipse':
      return `<ellipse cx="${n(shape.cx)}" cy="${n(shape.cy)}" rx="${n(shape.rx)}" ry="${n(shape.ry)}" ${s}/>`;
    case 'poly':
      return `<polygon points="${pts(shape.pts)}" ${s}/>`;
    case 'polyline':
      return `<polyline points="${pts(shape.pts)}" ${s}/>`;
    case 'arc':
      return `<polyline points="${pts(arcPoints(shape))}" ${s}/>`;
  }
}

// A shape as polygons, for the faceted low-poly look: lines become thin quads.
function polygons(shape) {
  const ring = (cx, cy, rx, ry, k) =>
    Array.from({ length: k }, (_, i) => [cx + rx * Math.cos((i / k) * 2 * Math.PI), cy + ry * Math.sin((i / k) * 2 * Math.PI)]);
  const quads = (list, w) =>
    list.slice(1).map(([x2, y2], i) => {
      const [x1, y1] = list[i];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const [nx, ny] = [((y1 - y2) / len) * (w / 2), ((x2 - x1) / len) * (w / 2)];
      return [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]];
    });
  switch (shape.s) {
    case 'rect':
      return [[[shape.x, shape.y], [shape.x + shape.w, shape.y], [shape.x + shape.w, shape.y + shape.h], [shape.x, shape.y + shape.h]]];
    case 'circle':
      return [ring(shape.cx, shape.cy, shape.r, shape.r, shape.r > 60 ? 9 : 6)];
    case 'ellipse':
      return [ring(shape.cx, shape.cy, shape.rx, shape.ry, 10)];
    case 'poly':
      return [shape.pts];
    case 'polyline':
      return quads(shape.pts, shape.w);
    case 'arc':
      return quads(arcPoints(shape, 12), shape.w);
  }
}

function facets(poly, color, random, o) {
  const [cx, cy] = poly.reduce(([x, y], [px, py]) => [x + px / poly.length, y + py / poly.length], [0, 0]);
  if (poly.length === 4 && Math.abs(poly[0][1] - poly[1][1]) < 1e-6 && Math.abs(poly[1][0] - poly[2][0]) < 1e-6) {
    // An upright rectangle splits along a diagonal into two faces.
    return [[poly[0], poly[1], poly[2]], [poly[0], poly[2], poly[3]]]
      .map((t, i) => `<polygon points="${pts(t)}" fill="${shade(color, i ? -0.08 : 0.04)}"${op(o)}/>`).join('');
  }
  return poly
    .map((p, i) => `<polygon points="${pts([p, poly[(i + 1) % poly.length], [cx, cy]])}" fill="${shade(color, (random() - 0.5) * 0.18)}"${op(o)}/>`)
    .join('');
}

// Whether the point lies in the shape, for pixel art; lines are at least thick lines wide.
function hits(shape, x, y, thick) {
  const near = (list, w) =>
    list.slice(1).some(([x2, y2], i) => {
      const [x1, y1] = list[i];
      const dx = x2 - x1, dy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(x - x1 - t * dx, y - y1 - t * dy) <= Math.max(w / 2, thick / 2);
    });
  switch (shape.s) {
    case 'rect': {
      if (x < shape.x || x >= shape.x + shape.w || y < shape.y || y >= shape.y + shape.h) return false;
      const r = Math.min(shape.r, shape.w / 2, shape.h / 2);
      const qx = Math.max(shape.x + r - x, 0, x - (shape.x + shape.w - r));
      const qy = Math.max(shape.y + r - y, 0, y - (shape.y + shape.h - r));
      return Math.hypot(qx, qy) <= r;
    }
    case 'circle':
      return Math.hypot(x - shape.cx, y - shape.cy) <= shape.r;
    case 'ellipse':
      return ((x - shape.cx) / shape.rx) ** 2 + ((y - shape.cy) / shape.ry) ** 2 <= 1;
    case 'poly': {
      let inside = false;
      for (let i = 0, j = shape.pts.length - 1; i < shape.pts.length; j = i++) {
        const [xi, yi] = shape.pts[i], [xj, yj] = shape.pts[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    case 'polyline':
      return near(shape.pts, shape.w);
    case 'arc':
      return near(arcPoints(shape), shape.w);
  }
}

const svg = (body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">` +
  (defs ? `<defs>${defs}</defs>` : '') + body + '</svg>\n';
const gradient = (id, top, bottom) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;

// ---- Styles ----

// Every style has a palette for day and one for night: the day one light and soft, for the light theme's pale glass
// tiles, the night one dark and muted, for the dark theme's.
const STYLES = {
  geometric: ['Geometric', {
    day: { top: '#ece7dd', bottom: '#e4dfd4', g: '#d7d0c3', a: '#b7c1cb', b: '#9eafbe', c: '#d9a066', d: '#f7f4ee', e: '#6e7c8b',
      deco: ['#e2b39f', '#a7c8c3', '#ebc78f', '#b7c6d5'], dots: '#8d9aa8' },
    night: { top: '#1d2433', bottom: '#242c3e', g: '#2a3347', a: '#3a4961', b: '#4d6176', c: '#b5804f', d: '#89a2a5', e: '#171d2b',
      deco: ['#8a5a4a', '#3c6e71', '#b5804f', '#4d6176'], dots: '#89a2a5' },
  }, (shapes, seed, p) => {
    const random = rng(seed);
    const big = [
      `<circle cx="${n(150 + random() * 300)}" cy="${n(100 + random() * 200)}" r="${n(220 + random() * 120)}" fill="${p.deco[0]}" opacity=".22"/>`,
      `<polygon points="${pts([[W, 0], [W - 520 - random() * 200, 0], [W, 480 + random() * 200]])}" fill="${p.deco[1]}" opacity=".25"/>`,
      `<path d="M ${n(600 + random() * 400)} ${H} a 260 260 0 0 1 520 0 z" fill="${p.deco[2]}" opacity=".14"/>`,
      `<rect x="${n(560 + random() * 300)}" y="${n(60 + random() * 120)}" width="180" height="180" fill="${p.deco[3]}" opacity=".2" transform="rotate(${n(random() * 40 - 20)} 800 200)"/>`,
    ];
    const dots = Array.from({ length: 6 }, (_, row) => Array.from({ length: 8 }, (_, col) =>
      `<circle cx="${60 + col * 28}" cy="${640 + row * 28}" r="4" fill="${p.dots}" opacity=".25"/>`).join('')).join('');
    return svg(`<rect width="${W}" height="${H}" fill="url(#bg)"/>${big.join('')}${dots}` +
      shapes.map((s) => plain(s, p[s.t], 0.9, false)).join(''), gradient('bg', p.top, p.bottom));
  }],
  'pixel-art': ['Pixel art', {
    day: { g: '#cbc0a6', a: '#93a3c6', b: '#aabfe0', c: '#eeae5e', d: '#f5f7fc', e: '#5b6589',
      bands: ['#9fcbec', '#a9d1ef', '#b4d7f1', '#bfddf3', '#cae3f5', '#d5e9f7'] },
    night: { g: '#2b2540', a: '#4a3f6b', b: '#5b6ba0', c: '#d39a55', d: '#97aed0', e: '#16142a',
      bands: ['#191c36', '#1d2140', '#21264a', '#252b53', '#29305b', '#2d3562'] },
  }, (shapes, seed, p) => {
    const size = 5, cols = W / size, rows = H / size;
    const random = rng(seed);
    const solid = shapes.map((s) => (s.s === 'arc' ? { ...s, s: 'polyline', pts: arcPoints(s) } : s));
    // Which solid shape (by its index) is in front at each block, -1 for sky, and the colour so far.
    const top = Array.from({ length: rows }, () => new Int16Array(cols).fill(-1));
    const cells = Array.from({ length: rows }, () => new Array(cols));
    for (let row = 0; row < rows; row++) {
      const y = row * size + size / 2;
      for (let col = 0; col < cols; col++) {
        const x = col * size + size / 2;
        // The sky in bands, dithered for a few rows where they meet.
        const f = (row / rows) * p.bands.length;
        let color = p.bands[Math.min(p.bands.length - 1, Math.floor(f + ((row + col) % 2 ? 0.06 : -0.06)))] ?? p.bands[0];
        solid.forEach((s, i) => {
          if (!hits(s, x, y, size * 1.5)) return;
          if ((s.o ?? 1) < 0.5) color = mix(color, p[s.t], s.o);
          else [color, top[row][col]] = [p[s.t], i];
        });
        cells[row][col] = color;
      }
    }
    // Like hand-drawn sprites: things get a dark outline where they stand in front of something else, a light top edge
    // and a shaded bottom one, and the ground is speckled. Lines stay flat.
    const owner = (row, col) => (row < 0 || row >= rows || col < 0 || col >= cols ? -1 : top[row][col]);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = top[row][col];
        if (i < 0) continue;
        const s = solid[i];
        if (s.t === 'g') {
          const r = random();
          if (r < 0.05) cells[row][col] = shade(cells[row][col], r < 0.025 ? -0.08 : 0.08);
          continue;
        }
        if (s.s === 'polyline') continue;
        const around = [owner(row - 1, col), owner(row + 1, col), owner(row, col - 1), owner(row, col + 1)];
        if (around.some((j) => j !== i && j < i)) cells[row][col] = shade(cells[row][col], -0.35);
        else if (owner(row - 2, col) !== i) cells[row][col] = shade(cells[row][col], 0.18);
        else if (owner(row + 2, col) !== i) cells[row][col] = shade(cells[row][col], -0.12);
      }
    }
    // Each colour once, as one-block-high strokes along runs of it.
    const runs = new Map();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols;) {
        let end = col;
        while (end + 1 < cols && cells[row][end + 1] === cells[row][col]) end++;
        runs.set(cells[row][col], (runs.get(cells[row][col]) ?? '') + `M${col} ${row}.5h${end - col + 1}`);
        col = end + 1;
      }
    }
    const body = [...runs].map(([color, d]) => `<path stroke="${color}" d="${d}"/>`).join('');
    return svg(`<g transform="scale(${size})" fill="none" stroke-width="1" shape-rendering="crispEdges">${body}</g>`);
  }],
  'line-art': ['Line art', {
    day: { top: '#eff1f4', bottom: '#e7eaee', g: '#7d8898', a: '#56637a', b: '#6c788c', c: '#c08436', d: '#56637a', e: '#7d8898' },
    night: { top: '#1a1e26', bottom: '#20252e', g: '#8d9aab', a: '#c3cedb', b: '#a9b6c6', c: '#dcae6c', d: '#c3cedb', e: '#8d9aab' },
  }, (shapes, seed, p) => {
    const body = shapes.map((s) => {
      // The ground is a horizon, not a box.
      if (s.t === 'g' && s.s === 'rect') return `<line x1="0" y1="${s.y}" x2="${W}" y2="${s.y}" stroke="${p.g}" stroke-width="4" opacity=".35"/>`;
      const extra = s.t === 'c' ? 0.6 : 0.42;
      if (s.s === 'polyline' || s.s === 'arc') return plain({ ...s, w: Math.min(s.w, 5) }, p[s.t], extra);
      return outline(s, p[s.t], 4, extra) + (s.t === 'c' ? plain(s, p.c, 0.08) : '');
    });
    return svg(`<rect width="${W}" height="${H}" fill="url(#bg)"/>${body.join('')}`, gradient('bg', p.top, p.bottom));
  }],
  watercolor: ['Watercolour', {
    day: { top: '#f0ebe1', bottom: '#e9e3d7', g: '#c6d4bd', a: '#8eafc3', b: '#a7c5b2', c: '#e8a882', d: '#fbfaf6', e: '#6c808f', paper: '#7a6a50' },
    night: { top: '#243037', bottom: '#2d3a3f', g: '#3e4f50', a: '#6c8794', b: '#8aa49c', c: '#cf9a76', d: '#c3d0d4', e: '#334047', paper: '#ffffff' },
  }, (shapes, seed, p) => {
    const random = rng(seed);
    const grain = rgb(p.paper).map((v) => n(v / 255)).join(' ');
    const defs = gradient('bg', p.top, p.bottom) +
      `<filter id="wash" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".018" numOctaves="3" seed="${Math.floor(random() * 100)}"/><feDisplacementMap in="SourceGraphic" scale="22"/></filter>` +
      `<filter id="bleed" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="2" seed="${Math.floor(random() * 100)}"/><feDisplacementMap in="SourceGraphic" scale="40"/><feGaussianBlur stdDeviation="6"/></filter>` +
      `<filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2"/><feColorMatrix values="0 0 0 0 ${grain.split(' ')[0]} 0 0 0 0 ${grain.split(' ')[1]} 0 0 0 0 ${grain.split(' ')[2]} 0 0 0 .5 0"/></filter>`;
    const blooms = Array.from({ length: 5 }, () =>
      `<circle cx="${n(random() * W)}" cy="${n(random() * H * 0.7)}" r="${n(160 + random() * 200)}" fill="${[p.a, p.b, p.c][Math.floor(random() * 3)]}" fill-opacity=".12"/>`).join('');
    const body = shapes.map((s) => plain(s, p[s.t], 0.55)).join('');
    return svg(`<rect width="${W}" height="${H}" fill="url(#bg)"/><g filter="url(#bleed)">${blooms}</g>` +
      `<g filter="url(#bleed)" opacity=".5">${body}</g><g filter="url(#wash)">${body}</g>` +
      `<rect width="${W}" height="${H}" filter="url(#paper)" opacity=".05"/>`, defs);
  }],
  'low-poly': ['Low poly', {
    day: { top: '#c6d7e7', bottom: '#e2eaf1', g: '#c0cbb3', a: '#9daec6', b: '#b4c4d6', c: '#e2a672', d: '#f3f6f9', e: '#6b788e' },
    night: { top: '#1f2538', bottom: '#2c3652', g: '#2c3843', a: '#44526b', b: '#566b82', c: '#c4885c', d: '#9bb0c0', e: '#1b212e' },
  }, (shapes, seed, p) => {
    const random = rng(seed);
    const [cols, rows] = [12, 8];
    const grid = Array.from({ length: rows + 1 }, (_, r) => Array.from({ length: cols + 1 }, (_, c) => [
      (c / cols) * W + (c % cols ? (random() - 0.5) * 90 : 0),
      (r / rows) * H + (r % rows ? (random() - 0.5) * 90 : 0),
    ]));
    const sky = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const [a, b, d, e] = [grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]];
      for (const tri of (r + c) % 2 ? [[a, b, d], [a, d, e]] : [[a, b, e], [b, d, e]]) {
        const y = tri.reduce((sum, [, ty]) => sum + ty, 0) / 3;
        sky.push(`<polygon points="${pts(tri)}" fill="${shade(mix(p.top, p.bottom, y / H), (random() - 0.5) * 0.12)}" stroke-width="1" stroke="${mix(p.top, p.bottom, y / H)}" stroke-opacity=".3"/>`);
      }
    }
    const body = shapes.flatMap((s) => polygons(s).map((poly) => facets(poly, p[s.t], random, opacity(s, 0.95)))).join('');
    return svg(sky.join('') + body);
  }],
  flat: ['Flat', {
    day: { top: '#e7e9ed', bottom: '#e2e5ea', g: '#d7dbe1', a: '#c6ccd5', b: '#bac1cb', c: '#9bbead', d: '#ced3da', e: '#8e97a4' },
    night: { top: '#21242a', bottom: '#25282f', g: '#2a2e35', a: '#3a4049', b: '#474f5a', c: '#7c9a8d', d: '#5c6672', e: '#1c1f24' },
  }, (shapes, seed, p) =>
    svg(`<rect width="${W}" height="${H}" fill="url(#bg)"/>` + shapes.map((s) => plain(s, p[s.t])).join(''), gradient('bg', p.top, p.bottom))],
  synthwave: ['Synthwave', {
    day: { top: '#b9cdfa', bottom: '#f8cfe4', floor: '#f2dcef', grid: '#d2589e', sun: ['#ffd36e', '#ff8fbf'], sunOpacity: 0.55,
      a: '#d8417f', b: '#7d52cf', c: '#d9811f', d: '#1f98a8', e: '#5f4392', glow: 3 },
    night: { top: '#120a24', bottom: '#2a1043', floor: '#160a28', grid: '#ff5fa2', sun: ['#ffb45a', '#ff5fa2'], sunOpacity: 0.35,
      a: '#ff5fa2', b: '#a86bff', c: '#ffb45a', d: '#4fd8e4', e: '#7a4bb0', glow: 5 },
  }, (shapes, seed, p) => {
    const defs = gradient('bg', p.top, p.bottom) + gradient('sun', ...p.sun) +
      `<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${p.glow}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
      `<clipPath id="stripes">${Array.from({ length: 9 }, (_, i) => `<rect x="0" y="${520 + i * 30}" width="${W}" height="${30 - Math.min(i * 2.5, 18)}"/>`).join('')}</clipPath>`;
    const grid = [
      ...Array.from({ length: 9 }, (_, i) => FLOOR + (H - FLOOR) * ((i + 1) / 9) ** 1.8)
        .map((y) => `<line x1="0" y1="${n(y)}" x2="${W}" y2="${n(y)}"/>`),
      ...Array.from({ length: 21 }, (_, i) => i - 10).map((k) => `<line x1="${800 + k * 50}" y1="${FLOOR}" x2="${800 + k * 400}" y2="${H}"/>`),
    ];
    const body = shapes.filter((s) => s.t !== 'g').map((s) =>
      s.s === 'polyline' || s.s === 'arc'
        ? plain({ ...s, w: Math.min(s.w, 6) }, p[s.t], 0.7)
        : outline(s, p[s.t], 4, 0.7) + plain(s, p[s.t], 0.07));
    return svg(`<rect width="${W}" height="${H}" fill="url(#bg)"/>` +
      `<circle cx="800" cy="${FLOOR}" r="280" fill="url(#sun)" opacity="${p.sunOpacity}" clip-path="url(#stripes)"/>` +
      `<rect y="${FLOOR}" width="${W}" height="${H - FLOOR}" fill="${p.floor}"/>` +
      `<g stroke="${p.grid}" stroke-width="2" opacity=".35">${grid.join('')}</g>` +
      `<g filter="url(#glow)">${body.join('')}</g>`, defs);
  }],
};

// ---- Colour schemes ----

// Which of a colour scheme's four hues (0 the picked colour's, 1 the one at an angle from it, 2 and 3 opposite those)
// each palette entry takes, and whether it is ground (sky, floor) rather than a thing, which keeps it quieter. Entries
// left out, such as watercolour's paper grain, keep their colour.
const ROLES = {
  top: [0, 1], bottom: [0, 1], bands: [0, 1], floor: [0, 1], g: [1, 1],
  a: [0, 0], b: [1, 0], c: [2, 0], d: [3, 0], e: [1, 0], dots: [1, 0], grid: [0, 0],
  deco: (i) => [i % 4, 0], sun: (i) => [2 + i, 0],
};
// How vivid ground and things become at least, as a share of the picked colour's chroma.
const STRENGTH = ['.65', '.3'];

// A palette as [colour, hue, ground] entries, each colour once (the first role wins).
function roles(palette) {
  const seen = new Map();
  for (const [key, value] of Object.entries(palette)) {
    const role = ROLES[key];
    if (!role) continue;
    (Array.isArray(value) ? value : [value]).forEach((c, i) => {
      const [hue, ground] = typeof role === 'function' ? role(i) : role;
      if (typeof c === 'string' && !seen.has(c)) seen.set(c, [c, hue, ground]);
    });
  }
  return [...seen.values()];
}

const distance = (a, b) => rgb(a).reduce((sum, v, i) => sum + (v - rgb(b)[i]) ** 2, 0);

// Makes an image recolourable by a colour scheme in CSS: every colour gets a class whose rule keeps the colour's own
// lightness and takes the hue of its nearest palette entry's role, at least as vivid as that role allows. The scheme
// comes from --scheme-hue, --scheme-angle (degrees, oklch) and --scheme-chroma, set on the inlined SVG or written into
// it; without them, or in a browser without relative colours, the image keeps its own colours. Ids and classes get the
// variant in front, so a day and a night image can be inlined side by side.
function schemed(image, palette, variant) {
  const entries = roles(palette);
  const rules = new Map();
  const body = image
    .replace(/id="([\w-]+)"/g, `id="${variant}-$1"`)
    .replace(/url\(#([\w-]+)\)/g, `url(#${variant}-$1)`)
    .replace(/<(\w+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g, (tag, name, attrs, close) => {
      const classes = [...attrs.matchAll(/\s(fill|stroke|stop-color)="(#[0-9a-f]{6})"/g)].map(([, prop, color]) => {
        const key = `${prop}${color}`;
        if (!rules.has(key)) {
          const [, hue, ground] = entries.reduce((best, e) => (distance(color, e[0]) < distance(color, best[0]) ? e : best));
          rules.set(key, `.${variant}-k${rules.size}{${prop}:oklch(from ${color} l max(c,calc(var(--scheme-chroma,0)*${STRENGTH[ground]})) var(--scheme-h${hue},h))}`);
        }
        return `${variant}-k${[...rules.keys()].indexOf(key)}`;
      });
      return classes.length ? `<${name}${attrs} class="${classes.join(' ')}"${close ? '/' : ''}>` : tag;
    });
  const hues = '--scheme-h0:var(--scheme-hue);--scheme-h1:calc(var(--scheme-hue) + var(--scheme-angle));' +
    '--scheme-h2:calc(var(--scheme-hue) + 180);--scheme-h3:calc(var(--scheme-hue) + var(--scheme-angle) + 180)';
  const style = `<style>@supports (color: oklch(from red l c h)){svg{${hues}}${[...rules.values()].join('')}}</style>`;
  return body.replace(/^(<svg[^>]*>)/, `$1${style}`);
}

// ---- Output ----

const styles = Object.entries(STYLES).map(([id, [label]]) => ({ id, label }));
const subjects = Object.entries(SUBJECTS).map(([id, [label]]) => ({ id, label }));
const variants = ['day', 'night'];

for (const { id: style } of styles) {
  rmSync(join(here, style), { recursive: true, force: true });
  mkdirSync(join(here, style));
  const [, palettes, draw] = STYLES[style];
  for (const { id: subject } of subjects) {
    for (const variant of variants) {
      const scene = SUBJECTS[subject][1](variant === 'night');
      writeFileSync(join(here, style, `${subject}-${variant}.svg`),
        schemed(draw(scene, `${style}/${subject}`, palettes[variant]), palettes[variant], variant));
    }
  }
}

writeFileSync(join(here, 'manifest.json'), JSON.stringify({ styles, subjects, variants }, null, 2) + '\n');

const list = (items) => `[\n${items.map(({ id, label }) => `  { id: '${id}', label: '${label}' },`).join('\n')}\n]`;
writeFileSync(join(here, '../../tiles/src/lib/background-presets.ts'), `// Generated by libs/design-system/backgrounds/generate.mjs: change it there.

/** The drawing styles of HomeyDash's built-in backgrounds. */
export const BACKGROUND_STYLES = ${list(styles)} as const;

/** What HomeyDash's built-in backgrounds show, one of each per style, by day and by night. */
export const BACKGROUND_SUBJECTS = ${list(subjects)} as const;

`);

const figures = (variant) => styles.map((t) => `<h2>${t.label}</h2><div class="grid">${subjects.map((s) =>
  `<figure><img src="${t.id}/${s.id}-${variant}.svg" alt="${t.label}: ${s.label}, by ${variant}" loading="lazy"><figcaption>${s.label} · ${t.id}/${s.id}-${variant}.svg</figcaption></figure>`).join('')}</div>`).join('\n');
writeFileSync(join(here, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Built-in backgrounds</title>
<style>
  body { margin: 0; padding: 24px; background: #121318; color: #d7dbe4; font: 14px/1.4 system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 10px; } p { margin: 0; color: #8b92a3; }
  nav { margin-top: 12px; display: flex; gap: 8px; } nav a { color: #d7dbe4; padding: 4px 12px; border: 1px solid #3a3f4d; border-radius: 6px; text-decoration: none; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  figure { margin: 0; } img { display: block; width: 100%; aspect-ratio: 16 / 10; border-radius: 8px; }
  figcaption { margin-top: 4px; color: #8b92a3; font-size: 12px; }
  .night, body:has(#night:target) .day { display: none; } body:has(#night:target) .night { display: block; }
</style></head><body>
<h1>Built-in backgrounds</h1>
<p>${styles.length} styles × ${subjects.length} subjects, by day and by night, generated by generate.mjs. Displays show
the day one in the light theme and the night one in the dark theme.</p>
<nav><a href="#day">Day</a><a href="#night">Night</a></nav>
<section id="day" class="day">${figures('day')}</section>
<section id="night" class="night">${figures('night')}</section>
</body></html>
`);

console.log(`${styles.length} styles × ${subjects.length} subjects × ${variants.length} variants written to ${here}`);
