/*
 * Shared "time left" estimate for the pages that walk a list of artists behind
 * a progress bar. Every run is a sequence of same-sized steps paced by a fixed
 * delay, so elapsed time per percent is a decent predictor of what is left.
 *
 * The estimate is smoothed and then counted down once a second, so the number
 * moves steadily instead of jumping with every step that completes.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  // Below these an estimate is still mostly noise, so it stays unlabelled.
  var MIN_ELAPSED_MS = 1500;
  var MIN_PERCENT = 2;
  // Weight of the newest reading; the rest carries over from the last one.
  var SMOOTHING = 0.35;
  // A percentage dropping by more than this means a new phase started.
  var RESTART_DROP = 5;

  /** "~45 s left" / "~3 min left" - short enough to sit beside the cancel X. */
  function formatEta(ms) {
    var seconds = Math.max(0, Math.round(ms / 1000));

    if (seconds < 3) {
      return 'finishing\u2026';
    }
    if (seconds < 58) {
      // Rounded to 5s: the estimate isn't accurate enough to imply otherwise.
      return '~' + Math.max(5, Math.round(seconds / 5) * 5) + ' s left';
    }
    if (seconds < 3600) {
      return '~' + Math.round(seconds / 60) + ' min left';
    }
    var hours = Math.round(seconds / 360) / 10;
    return '~' + hours + ' h left';
  }

  /**
   * Binds an estimate to one element. `update(percent)` on every progress
   * change, `stop()` when the bar goes away; the first update after a stop
   * starts a fresh run on its own.
   */
  function create(element) {
    var startedAt = null;
    var lastPercent = 0;
    // Milliseconds still to go, as of `anchoredAt`.
    var remaining = null;
    var anchoredAt = null;
    var timer = null;

    function paint() {
      if (!element) {
        return;
      }
      if (remaining === null) {
        element.textContent = startedAt === null ? '' : 'estimating…';
        return;
      }
      element.textContent = formatEta(remaining - (Date.now() - anchoredAt));
    }

    function tick() {
      if (!timer) {
        timer = window.setInterval(paint, 1000);
      }
    }

    function reset() {
      startedAt = null;
      lastPercent = 0;
      remaining = null;
      anchoredAt = null;
    }

    return {
      update: function (percent) {
        var value = typeof percent === 'number' && isFinite(percent)
          ? Math.max(0, Math.min(100, percent))
          : 0;

        if (startedAt === null || value < lastPercent - RESTART_DROP) {
          reset();
          startedAt = Date.now();
        }
        lastPercent = value;

        var elapsed = Date.now() - startedAt;
        if (elapsed >= MIN_ELAPSED_MS && value >= MIN_PERCENT) {
          var projected = (elapsed / value) * (100 - value);
          // Blend with what the previous reading still predicts for now, so a
          // single slow lookup doesn't throw the number around.
          var carried = remaining === null
            ? projected
            : Math.max(0, remaining - (Date.now() - anchoredAt));
          remaining = (SMOOTHING * projected) + ((1 - SMOOTHING) * carried);
          anchoredAt = Date.now();
        }

        paint();
        tick();
      },

      stop: function () {
        window.clearInterval(timer);
        timer = null;
        reset();
        if (element) {
          element.textContent = '';
        }
      },
    };
  }

  MusicHub.progressEta = { create: create, formatEta: formatEta };
})(window.MusicHub);
