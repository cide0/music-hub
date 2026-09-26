/*
 * Small synthesised sounds, through the wallet's audio context and limiter
 * like the coins: a tone that sweeps and dies away, a burst of filtered
 * noise, a chord of little bells. Shared by the Store, the unboxing and the
 * Daily Spin.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var wallet = MusicHub.wallet;

  /** A tone from `from` to `to` Hz, striking at `peak` and dying away over `decay` s. */
  function tone(ctx, at, from, to, peak, decay, type) {
    var osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + decay);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(gain).connect(wallet.audioOutput());
    osc.start(at);
    osc.stop(at + decay + 0.02);
  }

  /** `length` s of noise through a `type` filter, optionally sweeping to `sweepTo` Hz. */
  function noise(ctx, at, length, type, frequency, q, peak, attack, sweepTo) {
    var buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * length)), ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    var source = ctx.createBufferSource();
    source.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, at);
    if (sweepTo) {
      filter.frequency.exponentialRampToValueAtTime(sweepTo, at + length);
    }
    filter.Q.value = q;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + (attack || 0.003));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(filter).connect(gain).connect(wallet.audioOutput());
    source.start(at);
    source.stop(at + length + 0.01);
  }

  /** A bright chord of little bells, rising. */
  function chime(ctx, at, notes, peak) {
    notes.forEach(function (frequency, index) {
      var start = at + index * 0.07;
      tone(ctx, start, frequency, frequency, peak, 1.1);
      tone(ctx, start, frequency * 2.76, frequency * 2.76, peak * 0.3, 0.5);
    });
  }

  /**
   * Plays `sounds[name]` (a function of ctx, start time and level) `delay`
   * seconds from now - nothing without Web Audio.
   */
  function play(sounds, name, delay, level) {
    var ctx = wallet.audioContext();
    if (!ctx) {
      return;
    }
    sounds[name](ctx, ctx.currentTime + (delay || 0), level === undefined ? 1 : level);
  }

  MusicHub.sfx = {
    tone: tone,
    noise: noise,
    chime: chime,
    play: play,
  };
})(window.MusicHub);
