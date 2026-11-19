/* Polyphonic piano note detection from microphone audio.
   Log-frequency spectrum (1/3 semitone) -> noise-floor removal -> sparse non-negative
   decomposition onto inharmonic piano note templates -> per-note activations.
   Works in the browser (window.PianoDetect) and in Node (module.exports). */
(function (root) {
  'use strict';

  function FFT(n) {
    this.n = n;
    this.levels = Math.round(Math.log2(n));
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0, x = i;
      for (let b = 0; b < this.levels; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      this.rev[i] = r;
    }
  }
  FFT.prototype.transform = function (re, im) {
    const n = this.n, rev = this.rev, C = this.cos, S = this.sin;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * C[k] + im[l] * S[k];
          const tim = -re[l] * S[k] + im[l] * C[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  };

  const sinc = x => (Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  // Blackman window spectral magnitude, normalised to 1 at the peak
  const blackmanKernel = d =>
    Math.abs(0.42 * sinc(d) + 0.25 * (sinc(d - 1) + sinc(d + 1)) + 0.04 * (sinc(d - 2) + sinc(d + 2))) / 0.42;

  const DEFAULTS = {
    fftSize: 8192,
    a4: 440,
    bps: 3,             // log bins per semitone
    specLo: 20,         // lowest spectrum bin (midi)
    specHi: 118,        // highest spectrum bin (midi)
    noteLo: 21,         // A0
    noteHi: 108,        // C8
    gamma: 0.6,         // amplitude compression
    floorWin: 18,       // half-width of the noise-floor window in log bins
    floorPct: 0.3,      // percentile used as noise floor
    floorMult: 1.0,
    lambda: 0.06,       // sparsity penalty (relative to max of T'y)
    iters: 80,
    hpHz: 90,           // assumed mic high-pass corner
    maxPartials: 24,
    partialMaxHz: 7000,
    lowBias: 3,         // extra sparsity for very low notes ...
    lowBiasBelow: 38    // ... below this midi note (D2)
  };

  // Measured partial amplitudes (dB re strongest partial, partials 1..16) for A0..C8,
  // from acoustic grand piano recordings, smoothed across neighbouring notes.
  const PROFILE = [[-43,-6,0,-6,-6,-6,-10,-30,-18,-17,-14,-11,-11,-16,-20,-16],[-43,-6,0,-6,-6,-6,-10,-30,-18,-17,-14,-11,-11,-16,-20,-16],[-43,-6,0,-6,-6,-6,-10,-30,-18,-17,-14,-11,-11,-16,-20,-16],[-43,-6,0,-6,-6,-6,-10,-30,-18,-17,-14,-11,-11,-16,-20,-16],[-43,-4,0,-6,-6,-6,-10,-28,-18,-15,-14,-11,-10,-14,-19,-16],[-42,-2,0,-6,-5,-6,-11,-27,-17,-14,-14,-11,-10,-13,-18,-16],[-41,0,-1,-5,-5,-6,-11,-26,-16,-13,-13,-11,-9,-11,-16,-16],[-40,0,-3,-6,-5,-8,-12,-25,-16,-13,-14,-13,-10,-11,-17,-18],[-38,0,-6,-7,-7,-11,-13,-25,-17,-14,-15,-14,-12,-12,-17,-21],[-34,0,-7,-8,-8,-13,-12,-24,-18,-15,-14,-15,-13,-13,-17,-22],[-31,0,-9,-9,-9,-15,-12,-24,-20,-16,-15,-16,-15,-14,-19,-25],[-27,0,-9,-9,-10,-15,-10,-25,-21,-17,-16,-16,-15,-15,-21,-27],[-22,0,-8,-8,-10,-12,-9,-25,-22,-17,-16,-16,-16,-16,-21,-28],[-18,0,-8,-8,-10,-10,-10,-26,-24,-17,-17,-17,-17,-17,-23,-29],[-14,0,-8,-8,-10,-7,-11,-28,-24,-17,-18,-18,-18,-18,-25,-30],[-9,0,-6,-7,-9,-5,-12,-28,-23,-16,-18,-19,-18,-19,-25,-29],[-6,0,-6,-7,-8,-6,-14,-29,-24,-18,-20,-22,-21,-21,-26,-30],[-4,0,-4,-7,-8,-6,-16,-30,-24,-18,-21,-23,-22,-22,-26,-30],[-2,0,-3,-7,-8,-8,-16,-29,-24,-19,-22,-24,-23,-23,-25,-31],[-2,0,-2,-7,-9,-9,-15,-28,-25,-20,-23,-25,-24,-23,-25,-31],[-1,0,-1,-7,-11,-10,-15,-27,-26,-20,-23,-25,-23,-23,-25,-31],[0,0,0,-7,-12,-10,-14,-26,-26,-19,-23,-24,-22,-22,-25,-30],[-1,0,-1,-8,-14,-11,-13,-26,-25,-20,-23,-25,-22,-22,-26,-30],[-1,0,-1,-7,-15,-12,-13,-24,-23,-19,-22,-24,-21,-21,-25,-29],[-2,0,-3,-8,-15,-15,-13,-25,-22,-19,-22,-25,-22,-21,-26,-29],[-3,0,-4,-8,-14,-16,-14,-25,-21,-20,-22,-26,-23,-22,-26,-29],[-6,0,-5,-9,-15,-19,-15,-26,-21,-21,-23,-28,-26,-24,-27,-30],[-7,0,-6,-10,-16,-20,-17,-27,-22,-23,-24,-29,-28,-26,-28,-32],[-6,0,-5,-10,-16,-20,-17,-28,-22,-23,-24,-30,-28,-27,-29,-33],[-5,0,-4,-11,-17,-19,-18,-27,-23,-23,-25,-29,-29,-29,-30,-35],[-5,0,-5,-12,-19,-21,-19,-29,-25,-25,-27,-30,-31,-32,-33,-39],[-4,0,-5,-12,-19,-21,-20,-29,-26,-25,-28,-30,-32,-34,-35,-42],[-4,0,-6,-13,-19,-21,-21,-28,-27,-26,-30,-30,-34,-36,-37,-43],[-3,0,-6,-13,-18,-21,-21,-27,-29,-27,-31,-31,-35,-38,-39,-46],[-3,0,-9,-13,-18,-21,-21,-26,-30,-28,-34,-33,-37,-41,-42,-48],[-2,0,-10,-15,-18,-21,-21,-25,-31,-29,-35,-35,-38,-42,-43,-49],[0,0,-11,-14,-17,-20,-20,-23,-31,-29,-35,-35,-38,-42,-43,-48],[0,0,-12,-15,-17,-20,-19,-22,-32,-30,-36,-36,-39,-43,-44,-48],[0,-2,-15,-16,-18,-21,-20,-22,-32,-30,-37,-37,-41,-45,-45,-49],[0,-5,-17,-17,-19,-23,-22,-23,-33,-32,-38,-39,-44,-47,-47,-50],[0,-6,-17,-18,-20,-24,-23,-23,-34,-34,-39,-41,-46,-49,-49,-52],[0,-7,-19,-19,-21,-25,-25,-25,-36,-36,-41,-43,-49,-51,-52,-53],[0,-9,-19,-20,-23,-27,-29,-27,-39,-39,-44,-46,-52,-53,-54,-55],[0,-10,-19,-21,-24,-27,-31,-29,-43,-42,-46,-49,-55,-55,-56,-57],[0,-10,-19,-23,-24,-27,-32,-31,-46,-45,-49,-52,-56,-57,-58,-58],[0,-11,-19,-23,-24,-28,-34,-33,-49,-48,-51,-54,-58,-58,-59,-59],[0,-11,-18,-22,-24,-28,-35,-34,-50,-51,-53,-55,-59,-59,-60,-60],[0,-11,-17,-21,-24,-27,-35,-35,-52,-53,-55,-57,-59,-60,-60,-60],[0,-12,-18,-21,-24,-29,-36,-37,-53,-55,-56,-58,-60,-60,-60,-61],[0,-14,-18,-21,-25,-31,-38,-39,-55,-57,-57,-58,-60,-60,-61,-62],[0,-15,-18,-21,-27,-34,-40,-41,-56,-58,-58,-59,-60,-61,-62,-65],[0,-18,-19,-24,-30,-38,-43,-44,-58,-59,-59,-59,-60,-62,-65,-68],[0,-20,-20,-27,-34,-43,-46,-48,-59,-60,-59,-59,-62,-65,-68,-72],[0,-21,-20,-30,-39,-46,-49,-51,-60,-60,-60,-61,-65,-68,-72,-75],[0,-21,-21,-33,-42,-48,-52,-54,-60,-60,-61,-62,-68,-72,-75,-78],[0,-20,-22,-35,-45,-48,-55,-56,-60,-60,-62,-65,-72,-75,-78,-79],[0,-19,-22,-36,-47,-48,-57,-57,-60,-61,-65,-68,-75,-78,-79,-80],[0,-18,-23,-36,-47,-48,-58,-57,-60,-62,-68,-72,-78,-79,-80,-80],[0,-16,-24,-35,-46,-48,-59,-57,-61,-65,-72,-75,-79,-80,-80,-80],[0,-14,-25,-35,-46,-49,-60,-57,-62,-68,-75,-78,-80,-80,-80,-80],[0,-12,-25,-36,-45,-51,-60,-59,-65,-72,-78,-79,-80,-80,-80,-80],[0,-11,-25,-37,-45,-53,-60,-61,-68,-75,-79,-80,-80,-80,-80,-80],[0,-9,-24,-37,-45,-54,-60,-63,-71,-77,-79,-79,-79,-79,-79,-79],[0,-9,-26,-39,-47,-56,-61,-67,-74,-78,-79,-79,-79,-79,-79,-79],[0,-11,-27,-41,-49,-57,-64,-71,-77,-79,-79,-79,-79,-79,-79,-79],[0,-14,-31,-44,-52,-59,-67,-74,-78,-79,-79,-79,-79,-79,-79,-79],[0,-18,-35,-47,-54,-61,-71,-77,-79,-79,-79,-79,-79,-79,-79,-79],[0,-24,-42,-51,-58,-65,-75,-79,-80,-80,-80,-80,-80,-80,-80,-80],[0,-27,-45,-54,-60,-68,-78,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-30,-48,-56,-62,-72,-79,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-30,-48,-57,-65,-75,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-30,-49,-58,-68,-78,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-29,-49,-59,-72,-79,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-29,-50,-61,-75,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-30,-52,-64,-78,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-31,-55,-67,-79,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-32,-57,-72,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-34,-60,-75,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-35,-62,-78,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-35,-65,-79,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-37,-68,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-38,-72,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-39,-75,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-41,-78,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-42,-79,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-43,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-44,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80],[0,-45,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80,-80]];
  function partialModel(midi, k) {
    const row = PROFILE[Math.max(0, Math.min(PROFILE.length - 1, midi - 21))];
    const db = k <= 16 ? row[k - 1] : row[15] - 2.5 * (k - 16);
    return Math.pow(10, db / 20);
  }
  function inharm(midi) {
    // piano inharmonicity coefficient B (fit to measured partial stretching)
    return Math.pow(10, Math.max(-4.2, -4.1 + 0.0425 * (midi - 48)));
  }

  function NoteDetector(sampleRate, opts) {
    this.P = Object.assign({}, DEFAULTS, opts || {});
    this.sr = sampleRate;
    this.N = this.P.fftSize;
    this.df = this.sr / this.N;
    this.fft = new FFT(this.N);
    this.re = new Float64Array(this.N);
    this.im = new Float64Array(this.N);
    this.mag = new Float64Array(this.N / 2);
    this.win = new Float64Array(this.N);
    let ws = 0;
    for (let i = 0; i < this.N; i++) {
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (this.N - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (this.N - 1));
      this.win[i] = w; ws += w;
    }
    this.wsum = ws;
    this.K = (this.P.specHi - this.P.specLo) * this.P.bps + 1;
    this.M = this.P.noteHi - this.P.noteLo + 1;
    this.spec = new Float64Array(this.K);
    this.y = new Float64Array(this.K);
    this.x = new Float64Array(this.M);
    this.Ty = new Float64Array(this.M);
    this.Gx = new Float64Array(this.M);
    this.tuningCents = 0;
    this._tunAccR = 0; this._tunAccI = 0;
    this.build();
  }

  NoteDetector.prototype.freqOfMidi = function (m) {
    return this.P.a4 * Math.pow(2, (m - 69 + this.tuningCents / 100) / 12);
  };

  NoteDetector.prototype.build = function () {
    const P = this.P, K = this.K, df = this.df, nyq = this.N / 2;
    // log map
    this.map = [];
    for (let k = 0; k < K; k++) {
      const c = P.specLo + k / P.bps;
      const f = this.freqOfMidi(c);
      const jlo = this.freqOfMidi(c - 0.5 / P.bps) / df;
      const jhi = this.freqOfMidi(c + 0.5 / P.bps) / df;
      const jc = f / df;
      if (jhi - jlo < 2) {
        const j0 = Math.floor(jc), fr = jc - j0;
        this.map.push({ type: 0, j0: Math.min(j0, nyq - 2), fr });
      } else {
        this.map.push({ type: 1, a: Math.max(1, Math.ceil(jlo)), b: Math.min(nyq - 1, Math.floor(jhi)) });
      }
    }
    // templates
    const M = this.M;
    this.T = new Float64Array(M * K);
    this.tnorm = new Float64Array(M);
    const lin = new Float64Array(nyq);
    const tmp = new Float64Array(K);
    for (let n = 0; n < M; n++) {
      const midi = P.noteLo + n;
      const f0 = this.freqOfMidi(midi);
      const B = inharm(midi);
      lin.fill(0);
      const ob = [];
      for (const k of [1, 3, 5]) {
        const fk = k * f0 * Math.sqrt(1 + B * k * k);
        const bin = Math.round((12 * Math.log2(fk / this.freqOfMidi(P.specLo))) * P.bps);
        if (bin >= 1 && bin < K - 1) ob.push(bin);
      }
      (this.oddBins || (this.oddBins = []))[n] = ob;
      const pb = [];
      for (let k = 1; k <= 16; k++) {
        const fk = k * f0 * Math.sqrt(1 + B * k * k);
        const bin = Math.round((12 * Math.log2(fk / this.freqOfMidi(P.specLo))) * P.bps);
        if (bin >= 1 && bin < K - 1) pb.push(bin);
      }
      (this.partBins || (this.partBins = []))[n] = pb;
      for (let k = 1; k <= P.maxPartials; k++) {
        const fk = k * f0 * Math.sqrt(1 + B * k * k);
        if (fk > P.partialMaxHz || fk > this.sr / 2 - 100) break;
        let a = partialModel(midi, k);
        const hp = fk * fk / (fk * fk + P.hpHz * P.hpHz);
        a *= hp;
        const b = fk / df;
        for (let j = Math.max(1, Math.ceil(b - 4)); j <= Math.min(nyq - 1, Math.floor(b + 4)); j++) {
          lin[j] += a * blackmanKernel(j - b);
        }
      }
      this.logmap(lin, tmp);
      let nn = 0;
      for (let k = 0; k < K; k++) { const v = Math.pow(tmp[k], P.gamma); this.T[n * K + k] = v; nn += v * v; }
      nn = Math.sqrt(nn) || 1;
      for (let k = 0; k < K; k++) this.T[n * K + k] /= nn;
      this.tnorm[n] = 1;
    }
    // Gram matrix
    this.G = new Float64Array(M * M);
    for (let a = 0; a < M; a++) {
      for (let b = a; b < M; b++) {
        let s = 0;
        const oa = a * K, ob = b * K;
        for (let k = 0; k < K; k++) s += this.T[oa + k] * this.T[ob + k];
        this.G[a * M + b] = s; this.G[b * M + a] = s;
      }
    }
  };

  NoteDetector.prototype.logmap = function (lin, out) {
    const map = this.map;
    for (let k = 0; k < this.K; k++) {
      const m = map[k];
      if (m.type === 0) out[k] = lin[m.j0] * (1 - m.fr) + lin[m.j0 + 1] * m.fr;
      else {
        let mx = 0;
        for (let j = m.a; j <= m.b; j++) if (lin[j] > mx) mx = lin[j];
        out[k] = mx;
      }
    }
  };

  // timeData: Float32Array of at least fftSize samples (most recent last)
  NoteDetector.prototype.process = function (timeData) {
    const P = this.P, N = this.N, K = this.K, M = this.M;
    const off = timeData.length - N;
    let rms = 0;
    for (let i = 0; i < N; i++) {
      const v = timeData[off + i];
      rms += v * v;
      this.re[i] = v * this.win[i];
      this.im[i] = 0;
    }
    rms = Math.sqrt(rms / N);
    this.fft.transform(this.re, this.im);
    const sc = 2 / this.wsum;
    for (let j = 0; j < N / 2; j++) this.mag[j] = Math.hypot(this.re[j], this.im[j]) * sc;

    this.logmap(this.mag, this.spec);
    const s = this.spec;
    for (let k = 0; k < K; k++) s[k] = Math.pow(s[k], P.gamma);

    // noise floor: running percentile
    const W = P.floorWin, y = this.y;
    const buf = [];
    for (let k = 0; k < K; k++) {
      buf.length = 0;
      for (let j = Math.max(0, k - W); j <= Math.min(K - 1, k + W); j++) buf.push(s[j]);
      buf.sort((a, b) => a - b);
      const fl = buf[Math.floor(P.floorPct * (buf.length - 1))];
      y[k] = Math.max(0, s[k] - P.floorMult * fl);
    }

    let yy = 0;
    for (let k = 0; k < K; k++) yy += y[k] * y[k];
    this.yy = yy;
    // T'y
    const T = this.T, Ty = this.Ty, x = this.x, G = this.G, Gx = this.Gx;
    let tymax = 0;
    for (let n = 0; n < M; n++) {
      let acc = 0;
      const o = n * K;
      for (let k = 0; k < K; k++) acc += T[o + k] * y[k];
      Ty[n] = acc;
      if (acc > tymax) tymax = acc;
    }
    if (tymax <= 1e-12) { x.fill(0); return { x, rms, tymax }; }
    // sparsity penalty, stronger for the lowest notes: their weak fundamentals (and phone
    // mics' bass roll-off) make them easy to confuse with the octave above
    if (!this.lamW) {
      this.lamW = new Float64Array(M);
      for (let n = 0; n < M; n++) this.lamW[n] = 1 + P.lowBias * Math.max(0, (P.lowBiasBelow - (P.noteLo + n)) / 12);
    }
    const lam = P.lambda * tymax, lw = this.lamW;
    for (let n = 0; n < M; n++) x[n] = x[n] * 0.5 + 0.1 * Ty[n];
    for (let it = 0; it < P.iters; it++) {
      for (let a = 0; a < M; a++) {
        let acc = 0;
        const o = a * M;
        for (let b = 0; b < M; b++) acc += G[o + b] * x[b];
        Gx[a] = acc;
      }
      for (let n = 0; n < M; n++) x[n] = x[n] * Math.max(0, Ty[n] - lam * lw[n]) / (Gx[n] + 1e-12);
    }
    return { x, rms, tymax };
  };

  // Rough tuning estimate (cents) from strong spectral peaks between 150 Hz and 1.5 kHz
  NoteDetector.prototype.updateTuning = function () {
    const mag = this.mag, df = this.df;
    const jlo = Math.ceil(150 / df), jhi = Math.floor(1500 / df);
    let mx = 0;
    for (let j = jlo; j <= jhi; j++) if (mag[j] > mx) mx = mag[j];
    if (mx <= 0) return;
    let R = 0, I = 0;
    for (let j = jlo + 1; j < jhi; j++) {
      const a = mag[j];
      if (a < 0.25 * mx || a < mag[j - 1] || a < mag[j + 1]) continue;
      const l = Math.log(mag[j - 1] + 1e-20), c = Math.log(a), r = Math.log(mag[j + 1] + 1e-20);
      const d = 0.5 * (l - r) / (l - 2 * c + r);
      const f = (j + d) * df;
      const semis = 12 * Math.log2(f / this.P.a4);
      const ph = 2 * Math.PI * semis;
      R += a * Math.cos(ph); I += a * Math.sin(ph);
    }
    this._tunAccR = this._tunAccR * 0.97 + R;
    this._tunAccI = this._tunAccI * 0.97 + I;
    const strength = Math.hypot(this._tunAccR, this._tunAccI);
    return { cents: (Math.atan2(this._tunAccI, this._tunAccR) / (2 * Math.PI)) * 100, strength };
  };

  NoteDetector.prototype.setTuning = function (cents) {
    this.tuningCents = cents;
    this.build();
  };

  // Evidence that note index n is really sounding: observed energy at its odd partials
  // (1st, 3rd, 5th — which an octave-higher note cannot explain) vs. what its template predicts.
  NoteDetector.prototype.oddEvidence = function (n) {
    const ob = this.oddBins[n], y = this.y, T = this.T, K = this.K, x = this.x;
    let got = 0, exp = 0;
    for (const b of ob) {
      const obs = Math.max(y[b - 1], y[b], y[b + 1]);
      const pred = x[n] * Math.max(T[n * K + b - 1], T[n * K + b], T[n * K + b + 1]);
      got += Math.min(obs, pred * 1.5);
      exp += pred;
    }
    return exp > 0 ? got / exp : 1;
  };

  // Least-squares refit restricted to a small set of notes (no sparsity penalty).
  // Returns the residual energy ||y - T_S x||^2.
  NoteDetector.prototype.refit = function (S, iters) {
    const M = this.M, G = this.G, Ty = this.Ty;
    const m = S.length;
    if (!m) return this.yy;
    const x = S.map(n => Math.max(this.x[n], 1e-6));
    for (let it = 0; it < (iters || 60); it++) {
      for (let i = 0; i < m; i++) {
        let g = 0;
        const o = S[i] * M;
        for (let j = 0; j < m; j++) g += G[o + S[j]] * x[j];
        x[i] = x[i] * Ty[S[i]] / (g + 1e-12);
      }
    }
    let e = this.yy;
    for (let i = 0; i < m; i++) {
      e -= 2 * x[i] * Ty[S[i]];
      const o = S[i] * M;
      for (let j = 0; j < m; j++) e += x[i] * x[j] * G[o + S[j]];
    }
    return Math.max(0, e);
  };

  // Unpenalised least-squares levels for a set of notes (midi numbers) -> Map midi -> level
  NoteDetector.prototype.levels = function (midis, iters) {
    const M = this.M, G = this.G, Ty = this.Ty, lo = this.P.noteLo;
    const S = midis.map(m => m - lo).filter(n => n >= 0 && n < M);
    const x = S.map(n => Math.max(this.x[n], 0.05 * Ty[n]) + 1e-6);
    for (let it = 0; it < (iters || 40); it++) {
      for (let i = 0; i < S.length; i++) {
        let g = 0;
        const o = S[i] * M;
        for (let j = 0; j < S.length; j++) g += G[o + S[j]] * x[j];
        x[i] = x[i] * Ty[S[i]] / (g + 1e-12);
      }
    }
    const out = new Map();
    S.forEach((n, i) => out.set(n + lo, x[i]));
    return out;
  };

  // Drop candidates the other notes already explain: removing a real note should make the
  // best fit noticeably worse; removing a ghost (octave / harmonic artefact) barely matters.
  NoteDetector.prototype.prune = function (cands, tau) {
    let S = Array.from(cands).sort((a, b) => this.x[a] - this.x[b]);
    const gain = {};
    let base = this.refit(S);
    for (const n of S.slice()) {
      const rest = S.filter(v => v !== n);
      const e = this.refit(rest);
      const d = (e - base) / (this.yy || 1);
      gain[n] = d;
      if (d < tau) { S = rest; base = e; }
    }
    this.lastGain = gain;
    return new Set(S);
  };

  // Evidence from the low partials (1st-6th) of note n that no other candidate shares:
  // energy left there after the other candidates are fitted, vs. what note n predicts.
  // Returns a ratio (~1 = clearly present, ~0 = absent) or null if nothing is unique.
  NoteDetector.prototype.uniqueEvidence = function (n, cands) {
    const pb = this.partBins[n], y = this.y, T = this.T, K = this.K, a = this.x[n], lo = this.P.noteLo;
    const others = Array.from(cands).filter(m => m !== n);
    const shared = new Set();
    for (const m of others) for (const b of this.partBins[m]) { shared.add(b - 1); shared.add(b); shared.add(b + 1); }
    const lv = this.levels(others.map(m => m + lo));
    let pu = 0, ou = 0, pt = 0;
    for (let i = 0; i < Math.min(6, pb.length); i++) {
      const b = pb[i];
      const pred = a * Math.max(T[n * K + b - 1], T[n * K + b], T[n * K + b + 1]);
      pt += pred;
      if (shared.has(b)) continue;
      let best = 0;
      for (const bb of [b - 1, b, b + 1]) {
        let rec = 0;
        for (const m of others) rec += (lv.get(m + lo) || 0) * T[m * K + bb];
        best = Math.max(best, y[bb] - rec);
      }
      pu += pred; ou += Math.min(Math.max(0, best), 1.5 * pred);
    }
    if (pt <= 0 || pu < 0.1 * pt) return null;
    return ou / pu;
  };

  // Pick notes from one frame of activations
  function pickNotes(det, res, o) {
    o = Object.assign({ rel: 0.1, abs: 0.002, prune: 0.012, unique: 0.4, oct: 0.5, sub: 0.85 }, o || {});
    const x = res.x, M = det.M;
    let mx = 0;
    for (let n = 0; n < M; n++) if (x[n] > mx) mx = x[n];
    const out = [];
    if (mx <= 0) return out;
    let cand = new Set();
    for (let n = 0; n < M; n++) if (x[n] >= o.rel * mx && x[n] >= o.abs) cand.add(n);
    if (o.unique > 0) {
      for (const n of Array.from(cand).sort((a, b) => x[a] - x[b])) {
        const e = det.uniqueEvidence(n, cand);
        if (e !== null && e < o.unique) cand.delete(n);
      }
    }
    if (o.prune > 0) cand = det.prune(cand, o.prune);
    // octave artefacts: a weak note an octave above a strong one is usually that note's 2nd
    // partial; a weak note an octave below with no partials of its own is a sub-octave ghost.
    if (o.oct > 0) {
      for (const n of Array.from(cand).sort((a, b) => b - a)) {
        if (cand.has(n - 12) && x[n] < o.oct * x[n - 12]) cand.delete(n);
      }
      for (const n of Array.from(cand).sort((a, b) => a - b)) {
        if (cand.has(n + 12) || cand.has(n + 24)) {
          const ue = det.uniqueEvidence(n, cand);
          const up = Math.max(cand.has(n + 12) ? x[n + 12] : 0, cand.has(n + 24) ? x[n + 24] : 0);
          if (x[n] < o.sub * up ? (ue === null || ue < 0.7) : (ue !== null && ue < 0.45)) cand.delete(n);
        }
      }
    }
    for (const n of Array.from(cand).sort((a, b) => a - b)) out.push({ midi: det.P.noteLo + n, v: x[n] / mx, raw: x[n] });
    return out;
  }

  // Temporal tracker: a note turns on after being picked in `minFrames` consecutive frames.
  // It then stays on while it keeps being picked, or while its activation stays above
  // `keepFrac` of its own peak (a held, decaying piano note). Damped notes fall off quickly.
  function NoteTracker(o) {
    this.o = Object.assign({ minFrames: 2, keepFrac: 0.3, offRel: 0.03, hold: 2 }, o || {});
    this.cnt = new Map();
    this.fail = new Map();
    this.peak = new Map();
    this.active = new Set();
  }
  NoteTracker.prototype.update = function (det, res, picked) {
    const o = this.o, x = res.x, lo = det.P.noteLo;
    let mx = 0;
    for (let n = 0; n < det.M; n++) if (x[n] > mx) mx = x[n];
    const set = new Set(picked.map(p => p.midi));
    for (const m of set) {
      if (this.active.has(m)) continue;
      const c = (this.cnt.get(m) || 0) + 1;
      this.cnt.set(m, c);
      if (c >= o.minFrames) { this.active.add(m); this.peak.set(m, x[m - lo]); this.fail.set(m, 0); }
    }
    for (const [m] of this.cnt) if (!set.has(m)) this.cnt.set(m, 0);
    for (const m of Array.from(this.active)) {
      const v = x[m - lo];
      if (v > (this.peak.get(m) || 0)) this.peak.set(m, v);
      const ok = set.has(m) || (v >= o.keepFrac * this.peak.get(m) && (mx > 0 && v / mx >= o.offRel));
      if (ok) { this.fail.set(m, 0); continue; }
      const f = (this.fail.get(m) || 0) + 1;
      this.fail.set(m, f);
      if (f >= o.hold) this.active.delete(m);
    }
    return Array.from(this.active).sort((a, b) => a - b);
  };
  NoteTracker.prototype.reset = function () { this.cnt.clear(); this.fail.clear(); this.peak.clear(); this.active.clear(); };

  // Chord-level tracker. A piano chord is read from the frames just after its attack
  // (majority vote) and then held steady until the next attack. Notes from the previous
  // chord that are still ringing (held keys / pedal) are carried over; notes that die away
  // (key released, damper down) are dropped; notes that sound steadily without a fresh attack
  // are added.
  function ChordTracker(o) {
    this.o = Object.assign({
      gate: 0.002, onsetRatio: 1.7, startAt: 3, len: 3, minVotes: 2,
      carry: 0.35, dead: 0.03, addFrames: 6, addVotes: 6, addRel: 0.35, silence: 8
    }, o || {});
    this.frame = 0; this.rmsHist = []; this.notes = []; this.collect = null;
    this.recent = []; this.lastOnset = -99; this.quiet = 0; this.peak = new Map();
  }
  ChordTracker.prototype.update = function (chunkRms, picked, det) {
    const o = this.o, f = this.frame++;
    const h = this.rmsHist;
    const prev = h.length ? Math.max(h[h.length - 1], h.length > 1 ? h[h.length - 2] : 0) : 0;
    h.push(chunkRms); if (h.length > 8) h.shift();
    const set0 = picked.map(p => p.midi);
    const lv = det ? det.levels(Array.from(new Set(this.notes.concat(set0)))) : new Map();
    let mx = 0;
    for (const v of lv.values()) if (v > mx) mx = v;
    const x = det ? true : null;
    const act = m => lv.get(m) || 0;
    let onset = false;
    if (chunkRms > o.gate && chunkRms > o.onsetRatio * prev && f - this.lastOnset > 2) {
      onset = true; this.lastOnset = f;
      this.collect = { start: f, votes: new Map() };
    }
    const set = new Set(picked.map(p => p.midi));
    this.recent.push(set); if (this.recent.length > o.addFrames) this.recent.shift();
    this.quiet = chunkRms < o.gate * 0.6 ? this.quiet + 1 : 0;
    if (this.quiet >= o.silence) { this.notes = []; this.collect = null; this.peak.clear(); }

    // notes of the current chord: track their peak level, drop the ones that died away
    for (const m of this.notes) if (act(m) > (this.peak.get(m) || 0)) this.peak.set(m, act(m));

    if (this.collect) {
      const d = f - this.collect.start;
      if (d >= o.startAt && d < o.startAt + o.len) {
        for (const m of set) this.collect.votes.set(m, (this.collect.votes.get(m) || 0) + 1);
      }
      if (d === o.startAt + o.len - 1) {
        const next = new Set();
        for (const [m, v] of this.collect.votes) if (v >= o.minVotes) next.add(m);
        if (next.size) {
          // carry over still-ringing notes of the previous chord
          const pcs = new Set(Array.from(next).map(m => m % 12));
          for (const m of this.notes) {
            if (next.has(m) || pcs.has(m % 12)) continue;
            const pk = this.peak.get(m) || 0;
            if (pk > 0 && act(m) >= o.carry * pk && act(m) >= 0.06 * mx) next.add(m);
          }
          this.notes = Array.from(next).sort((a, b) => a - b);
          const np = new Map();
          for (const m of this.notes) np.set(m, Math.max(act(m), set.has(m) ? act(m) : 0));
          this.peak = np;
        }
        this.collect = null;
        return { notes: this.notes, onset, fresh: true };
      }
      return { notes: this.notes, onset, fresh: false, pending: true };
    }
    // between attacks
    const cur = new Set(this.notes);
    for (const m of Array.from(cur)) {
      const pk = this.peak.get(m) || 0;
      if (x && pk > 0 && act(m) < o.dead * pk && !set.has(m)) { cur.delete(m); this.peak.delete(m); }
    }
    if (this.recent.length >= o.addFrames) {
      const cnt = new Map();
      for (const s2 of this.recent) for (const m of s2) cnt.set(m, (cnt.get(m) || 0) + 1);
      for (const [m, c] of cnt) {
        if (c >= o.addVotes && !cur.has(m) && act(m) >= o.addRel * mx && !Array.from(cur).some(q => q % 12 === m % 12)) { cur.add(m); this.peak.set(m, act(m)); }
      }
    }
    this.notes = Array.from(cur).sort((a, b) => a - b);
    return { notes: this.notes, onset, fresh: false };
  };
  ChordTracker.prototype.reset = function () { this.notes = []; this.collect = null; this.recent = []; this.rmsHist = []; this.peak.clear(); };

  const api = { NoteDetector, NoteTracker, ChordTracker, pickNotes, FFT, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PianoDetect = api;
})(typeof self !== 'undefined' ? self : this);
