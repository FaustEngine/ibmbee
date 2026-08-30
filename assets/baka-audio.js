/* BAKA retro audio engine — WebAudio chiptune, no assets. window.BakaAudio */
(function () {
  if (window.BakaAudio) return;
  var ctx = null, master = null, musicGain = null, sfxGain = null;
  var armed = false, musicOn = false, muted = false, loopTimer = null, resumeTries = 0;
  muted = true;
  try { muted = localStorage.getItem('baka_muted_v2') !== '0'; } catch (e) {}

  function ensureCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.055; musicGain.connect(master);
      sfxGain = ctx.createGain(); sfxGain.gain.value = 0.3; sfxGain.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function tone(type, f0, f1, dur, peak, out, when, a) {
    var t = (when || ctx.currentTime);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, a || 0.004, peak, dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, peak, when, hp) {
    var t = when || ctx.currentTime;
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 5000;
    var g = ctx.createGain(); env(g, t, 0.002, peak, dur);
    src.connect(f); f.connect(g); g.connect(sfxGain); src.start(t);
  }

  var progN = 0, progT = 0;

  var SFX = {
    click:   function () { tone('square', 880, 1320, 0.06, 0.5, sfxGain); },
    hover:   function () { tone('square', 660, 660, 0.03, 0.12, sfxGain); },
    tab:     function () { tone('square', 523, 784, 0.07, 0.4, sfxGain); tone('square', 1046, 1046, 0.05, 0.3, sfxGain, ctx.currentTime + 0.06); },
    boot:    function () { tone('sawtooth', 110, 880, 0.5, 0.28, sfxGain, ctx.currentTime, 0.05); noise(0.25, 0.06); },
    connect: function () { [523, 659, 784, 1046].forEach(function (f, i) { tone('square', f, f, 0.09, 0.35, sfxGain, ctx.currentTime + i * 0.07); }); },
    coin:    function () { tone('square', 988, 988, 0.07, 0.4, sfxGain); tone('square', 1319, 1319, 0.24, 0.4, sfxGain, ctx.currentTime + 0.08); },
    plant:   function () { [392, 523, 659, 784, 1046, 1319].forEach(function (f, i) { tone('triangle', f, f, 0.12, 0.45, sfxGain, ctx.currentTime + i * 0.08); }); },
    error:   function () { tone('square', 220, 110, 0.18, 0.4, sfxGain); },
    type:    function () { tone('square', 1400 + Math.random() * 600, 900, 0.018, 0.07, sfxGain); },
    tick:    function () { tone('square', 520, 520, 0.025, 0.09, sfxGain); },
    glide:   function () { var t = ctx.currentTime, d = 0.38; var o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(560, t + d); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.055, t + d * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + d + 0.05); noise(d * 0.8, 0.02, t, 2400); },
    blip:    function () { var now = ctx.currentTime; progN = (now - progT < 0.7) ? progN + 1 : 0; progT = now; var f = 560 + progN * 55; tone('square', f, f, 0.05, 0.26, sfxGain); },
    send:    function () { tone('square', 784, 1568, 0.12, 0.4, sfxGain); noise(0.08, 0.05, ctx.currentTime + 0.02); }
  };

  /* ---- constant room tone: CRT hum + air ---- */
  var humOn = false;
  function startHum() {
    if (humOn) return;
    humOn = true;
    var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 55;
    var g = ctx.createGain(); g.gain.value = 0.013;
    o.connect(g); g.connect(master); o.start();
    var len = Math.floor(ctx.sampleRate * 2), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
    var g2 = ctx.createGain(); g2.gain.value = 0.007;
    s.connect(f); f.connect(g2); g2.connect(master); s.start();
  }

  /* ---- chiptune loop: A minor, 112bpm, 8 bars ---- */
  var BPM = 112, SPB = 60 / BPM, STEP = SPB / 2; // 8th notes
  // bass (Hz per half-beat, 0 = rest) — Am F C G progression
  var A2 = 110, F2 = 87.31, C2 = 65.41, G2 = 98, C3 = 130.81, E2 = 82.41;
  var bass = [A2,0,A2,A2, 0,A2,0,E2,  F2,0,F2,F2, 0,F2,0,C3,  C2,0,C3,C3, 0,C3,0,G2,  G2,0,G2,G2, 0,G2,0,G2];
  // lead melody (Hz, 0 = rest)
  var N = { A4:440, B4:493.88, C5:523.25, D5:587.33, E5:659.25, G4:392, F4:349.23, G5:783.99, E4:329.63, A5:880 };
  var lead = [
    N.A4,0,N.C5,0, N.E5,0,N.D5,N.C5, N.A4,0,0,0, N.G4,N.A4,0,0,
    N.F4,0,N.A4,0, N.C5,0,N.B4,N.A4, N.G4,0,0,0, 0,0,N.E4,N.G4,
    N.C5,0,N.E5,0, N.G5,0,N.E5,N.D5, N.C5,0,0,0, N.B4,N.C5,0,0,
    N.B4,0,N.D5,0, N.G4,0,N.B4,N.D5, N.E5,N.D5,N.B4,N.G4, N.A4,0,0,0
  ];
  var loopLen = lead.length * STEP;

  function scheduleLoop(t0) {
    for (var i = 0; i < lead.length; i++) {
      var t = t0 + i * STEP;
      var b = bass[i % bass.length];
      if (b) { var o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = b; env(g, t, 0.008, 0.9, STEP * 0.9); o.connect(g); g.connect(musicGain); o.start(t); o.stop(t + STEP); }
      var m = lead[i];
      if (m) { var o2 = ctx.createOscillator(), g2 = ctx.createGain(); o2.type = 'square'; o2.frequency.value = m; env(g2, t, 0.01, 0.42, STEP * 0.85); o2.connect(g2); g2.connect(musicGain); o2.start(t); o2.stop(t + STEP); }
      if (i % 4 === 2) { // hat
        var len = Math.floor(ctx.sampleRate * 0.03), buf = ctx.createBuffer(1, len, ctx.sampleRate), dd = buf.getChannelData(0);
        for (var j = 0; j < len; j++) dd[j] = Math.random() * 2 - 1;
        var s = ctx.createBufferSource(); s.buffer = buf;
        var hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 8000;
        var hg = ctx.createGain(); env(hg, t, 0.002, 0.25, 0.03);
        s.connect(hf); hf.connect(hg); hg.connect(musicGain); s.start(t);
      }
    }
  }
  var bgmEl = null;
  function startMusic() {
    if (musicOn || !ensureCtx()) return;
    musicOn = true;
    musicGain.gain.value = 0.32;
    bgmEl = new Audio('assets/bgm.mp3');
    bgmEl.loop = true;
    bgmEl.addEventListener('ended', function () { try { bgmEl.currentTime = 0; bgmEl.play(); } catch (e) {} });
    try {
      var src = ctx.createMediaElementSource(bgmEl);
      src.connect(musicGain);
    } catch (e) {
      bgmEl.volume = 0.3;
      bgmEl.muted = muted;
    }
    var p = bgmEl.play();
    if (p && p.catch) p.catch(function () { musicOn = false; });
  }

  function arm() {
    if (armed) return;
    if (!ensureCtx()) return;
    armed = true;
    var kick = function () {
      try {
        var buf = ctx.createBuffer(1, 1, 22050);
        var src = ctx.createBufferSource(); src.buffer = buf; src.connect(master); src.start(0);
      } catch (e) {}
      SFX.boot(); startHum(); startMusic();
    };
    if (ctx.state !== 'running' && ctx.resume) {
      var p = ctx.resume();
      if (p && p.then) p.then(kick).catch(kick); else kick();
    } else kick();
  }

  /* attempt to start without a fresh gesture (works when the browser already granted audio) */
  function tryArm() {
    if (armed) {
      if (ctx && ctx.state !== 'running' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
      if (!musicOn) startMusic();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) return;
    var check = function () { if (!armed && ctx.state === 'running') { armed = true; SFX.boot(); startHum(); startMusic(); } };
    var p = ctx.resume ? ctx.resume() : null;
    if (p && p.then) p.then(check).catch(function () {}); else check();
  }
  setTimeout(tryArm, 250);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tryArm(); });

  document.addEventListener('touchstart', function () { arm(); }, { capture: true, passive: true });
  /* global click delegation for retro blips */
  document.addEventListener('pointerdown', function (e) {
    var tgl = e.target && e.target.closest && e.target.closest('[data-sound-toggle]');
    if (!tgl) {
      arm();
      if (!musicOn) startMusic();
    }
    if (muted || !ctx) return;
    var el = e.target && e.target.closest && e.target.closest('button, a, [data-sfx], textarea, input');
    var play = function () {
      if (!el) { SFX.tick(); return; }
      var kind = el.getAttribute && el.getAttribute('data-sfx');
      if (kind && SFX[kind]) SFX[kind]();
      else if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') SFX.type();
      else SFX.click();
    };
    if (ctx.state !== 'running' && ctx.resume) {
      resumeTries++;
      if (resumeTries > 2) {
        try { ctx.close(); } catch (err) {}
        ctx = null; armed = false; humOn = false;
        arm();
        play();
        return;
      }
      var p = ctx.resume();
      if (p && p.then) { p.then(function () { resumeTries = 0; play(); }).catch(function () {}); return; }
    }
    resumeTries = 0;
    play();
  }, true);
  document.addEventListener('pointerover', function (e) {
    if (muted || !armed || !ctx) return;
    var el = e.target && e.target.closest && e.target.closest('button, a, [data-sfx]');
    if (!el) return;
    var now = Date.now();
    if (el.__bkHov && now - el.__bkHov < 350) return;
    el.__bkHov = now;
    SFX.hover();
  }, true);
  document.addEventListener('keydown', function (e) {
    arm();
    if (muted || !ctx) return;
    var t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) {
      if (e.key.length === 1) SFX.type();
      else if (e.key === 'Enter') SFX.send();
    }
  }, true);

  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem('baka_muted_v2', muted ? '1' : '0'); } catch (err) {}
    if (master) master.gain.value = muted ? 0 : 1;
    if (bgmEl) bgmEl.muted = muted;
    if (!muted) {
      if (!ctx) ensureCtx();
      if (ctx && ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (err) {} }
      if (!armed && ctx) { armed = true; SFX.boot(); startHum(); }
      if (!musicOn) startMusic();
    }
    return muted;
  }

  window.BakaAudio = {
    sfx: function (name) { if (!muted && armed && ctx && SFX[name]) SFX[name](); },
    arm: arm,
    tryArm: tryArm,
    toggleMute: toggleMute,
    isMuted: function () { return muted; },
    isLive: function () { return armed && !!ctx && ctx.state === 'running'; }
  };
})();
