// microWakeWord in ~150 lines: the TFLite-Micro audio frontend (40 mel-ish features per 10 ms) feeding a streaming int8
// conv net (okay_nabu), with TFLite's reference int8 arithmetic so scores match the interpreter. Throwaway POC.
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>
#include "tensorflow/lite/experimental/microfrontend/lib/frontend.h"
#include "tensorflow/lite/experimental/microfrontend/lib/frontend_util.h"

#define EXPORT __attribute__((visibility("default")))

#define MAXOPS 24
#define MAXSTAGES 8
#define MAXROWS 24
#define MAXCOLS 64
// kinds: 0 stem conv, 1 depthwise, 2 pointwise conv, 3 dense. k = kernel rows, aux = input channels (a depthwise: the first channel it reads, aux2: where its output goes),
// r = rows of ring-buffer state of the streaming stage this op starts (-1: it continues the stage before it).
typedef struct { int32_t kind, zin, zout, amin, amax, cout, nw, k, aux, r, aux2; const int8_t *w; const int32_t *bias, *mult, *shift; } Op;
static Op ops[MAXOPS];
static int nops;
static const int8_t *lut;
static int8_t states[MAXSTAGES][MAXROWS * MAXCOLS];
static int8_t frames[3 * 40];
static int nframes;
static double in_scale = 0.10196078568696976;
static int in_zp = -128;
static struct FrontendConfig cfg;
static struct FrontendState st;
static uint8_t outs[256];
static int fe_ready;

// --- TFLite reference int8 arithmetic ---
static int32_t srdhm(int32_t a, int32_t b) {
  if (a == INT32_MIN && b == INT32_MIN) return INT32_MAX;
  int64_t ab = (int64_t)a * b, nudge = ab >= 0 ? (1 << 30) : (1 - (1 << 30));
  return (int32_t)((ab + nudge) / (1LL << 31));
}
static int32_t rdpot(int32_t x, int e) {
  int32_t mask = (int32_t)((1LL << e) - 1), rem = x & mask, thr = (mask >> 1) + (x < 0 ? 1 : 0);
  return (x >> e) + (rem > thr ? 1 : 0);
}
static int8_t requant(const Op *o, int c, int32_t acc) {
  int32_t s = o->shift[c], ls = s > 0 ? s : 0, rs = s > 0 ? 0 : -s;
  int32_t v = rdpot(srdhm((int32_t)((uint32_t)acc << ls), o->mult[c]), rs) + o->zout;
  return (int8_t)(v < o->amin ? o->amin : v > o->amax ? o->amax : v);
}
// out[co] = sum over kh rows x cin of w[co][k][ci] * (x[k][ci] - zin)
static void conv(const Op *o, const int8_t *x, int kh, int cin, int8_t *out) {
  for (int co = 0; co < o->cout; co++) {
    int32_t acc = o->bias[co]; const int8_t *w = o->w + co * kh * cin;
    for (int i = 0; i < kh * cin; i++) acc += w[i] * (x[i] - o->zin);
    out[co] = requant(o, co, acc);
  }
}
// depthwise over k rows (row stride rs, starting at channel c0): out[c] = sum_k w[k][c] * (x[k][c0+c] - zin)
static void dw(const Op *o, const int8_t *x, int k, int rs, int c0, int8_t *out) {
  for (int c = 0; c < o->cout; c++) {
    int32_t acc = o->bias[c];
    for (int r = 0; r < k; r++) acc += o->w[r * o->cout + c] * (x[r * rs + c0 + c] - o->zin);
    out[c] = requant(o, c, acc);
  }
}

static int8_t cat[(MAXROWS + 1) * MAXCOLS], a[MAXCOLS], d[MAXCOLS];
static void stream(int8_t *state, int rows, int cols, const int8_t *row) {   // cat = state | row, state = last rows of cat
  memcpy(cat, state, rows * cols); memcpy(cat + rows * cols, row, cols);
  memcpy(state, cat + cols, rows * cols);
}

static int run(void) {   // one inference on frames[3][40]; returns the uint8 probability
  static int8_t c0[8 * 40];
  const Op *o = &ops[0];
  memcpy(c0, states[0], o->r * 40); memcpy(c0 + o->r * 40, frames, 120); memcpy(states[0], c0 + 120, o->r * 40);
  conv(o, c0, o->k, o->aux, a);
  int cols = o->cout, stage = 1, rows = 0;
  for (int i = 1; i < nops; i++) {
    o = &ops[i];
    if (o->kind == 1) {
      if (o->r >= 0) { stream(states[stage++], o->r, cols, a); rows = o->r + 1; }
      dw(o, cat + (rows - o->k) * cols, o->k, cols, o->aux, d + o->aux2);
    } else if (o->kind == 2) { conv(o, d, 1, o->aux, a); cols = o->cout; }
    else {
      stream(states[stage], o->r, cols, a);
      int32_t acc = o->bias[0];
      for (int j = 0; j < o->k * o->aux; j++) acc += o->w[j] * (cat[j] - o->zin);
      return lut[requant(o, 0, acc) + 128] + 128;   // sigmoid, then int8 -> uint8
    }
  }
  return 0;
}

EXPORT void *mww_alloc(int n) { return malloc(n); }

EXPORT void mww_reset(void) {
  memset(states, -128, sizeof states);
  nframes = 0;
  if (fe_ready) FrontendFreeStateContents(&st);
  fe_ready = FrontendPopulateState(&cfg, &st, 16000);
}

EXPORT int mww_init(const uint8_t *blob) {
  const uint8_t *p = blob; int32_t n, zp; double sc;
  memcpy(&n, p, 4); memcpy(&zp, p + 4, 4); memcpy(&sc, p + 8, 8); p += 16;
  if (n < 3 || n > MAXOPS) return -1;
  nops = n; in_zp = zp; in_scale = sc;
  for (int i = 0; i < n; i++) {
    int32_t h[11]; memcpy(h, p, 44); p += 44;
    Op *o = &ops[i]; o->kind = h[0]; o->zin = h[1]; o->zout = h[2]; o->amin = h[3]; o->amax = h[4]; o->cout = h[5]; o->nw = h[6]; o->k = h[7]; o->aux = h[8]; o->r = h[9]; o->aux2 = h[10];
    if (o->cout > MAXCOLS || o->r >= MAXROWS) return -2;
    o->w = (const int8_t *)p; p += (h[6] + 3) & ~3;
    o->bias = (const int32_t *)p; p += 4 * o->cout; o->mult = (const int32_t *)p; p += 4 * o->cout; o->shift = (const int32_t *)p; p += 4 * o->cout;
  }
  lut = (const int8_t *)p;
  cfg.window.size_ms = 30; cfg.window.step_size_ms = 10;
  cfg.filterbank.num_channels = 40; cfg.filterbank.lower_band_limit = 125.0f; cfg.filterbank.upper_band_limit = 7500.0f;
  cfg.noise_reduction.smoothing_bits = 10; cfg.noise_reduction.even_smoothing = 0.025f;
  cfg.noise_reduction.odd_smoothing = 0.06f; cfg.noise_reduction.min_signal_remaining = 0.05f;
  cfg.pcan_gain_control.enable_pcan = 1; cfg.pcan_gain_control.strength = 0.95f;
  cfg.pcan_gain_control.offset = 80.0f; cfg.pcan_gain_control.gain_bits = 21;
  cfg.log_scale.enable_log = 1; cfg.log_scale.scale_shift = 6;
  mww_reset();
  return 0;
}

// Feeds n samples (a multiple of 160 = 10 ms) of 16 kHz int16 audio; returns how many model outputs (0-255) were written to mww_outs().
EXPORT int mww_feed(const int16_t *pcm, int n) {
  int count = 0;
  for (int off = 0; off + 160 <= n; off += 160) {
    size_t read = 0;
    struct FrontendOutput fo = FrontendProcessSamples(&st, pcm + off, 160, &read);
    if (fo.size != 40) continue;
    for (int i = 0; i < 40; i++) {
      double f = (double)(fo.values[i] * 0.0390625f);                  // as pymicro-features hands it over
      double v = nearbyint(f / in_scale + in_zp);
      frames[nframes * 40 + i] = (int8_t)(v < -128 ? -128 : v > 127 ? 127 : v);
    }
    if (++nframes == 3) { nframes = 0; outs[count++] = (uint8_t)run(); }
  }
  return count;
}
EXPORT const uint8_t *mww_outs(void) { return outs; }
