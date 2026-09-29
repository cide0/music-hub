/*
 * Messages that fade away on their own - every page's notes, warnings and
 * errors, like the Artist Graph's. Each stays up for a while that grows
 * with its text (FADE_AFTER_MS at least), then fades out and is hidden.
 * Pointing at one or focusing it holds it until the pointer or focus
 * leaves. A message with a button to act on (Retry, Log in again, ...) is
 * shown with hold() instead and stays until it's used or dismissed.
 * Loaded first on every page, before storage.js, whose "couldn't save"
 * notice uses it.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var FADE_AFTER_MS = 4000;
  var MAX_SHOWN_MS = 12000;
  // Reading time: a long message stays up for longer.
  var MS_PER_CHAR = 60;
  // As long as .fade-message's transition in style.css.
  var FADE_MS = 600;

  function stop(el) {
    window.clearTimeout(el.noticeTimer);
    el.noticeTimer = 0;
    el.classList.remove('fade-message--fading');
  }

  function shownMs(el) {
    return Math.min(MAX_SHOWN_MS, Math.max(FADE_AFTER_MS, el.textContent.trim().length * MS_PER_CHAR));
  }

  function held(el) {
    return el.matches(':hover') || el.contains(document.activeElement);
  }

  function schedule(el) {
    stop(el);
    el.noticeTimer = window.setTimeout(function () {
      if (held(el)) {
        // Picked up again when the pointer or focus leaves.
        el.noticeTimer = 0;
        return;
      }
      el.classList.add('fade-message--fading');
      el.noticeTimer = window.setTimeout(function () {
        hide(el);
      }, FADE_MS);
    }, shownMs(el));
  }

  /** Pointing at it or focusing it keeps a fading message up, and brings it back. */
  function bindHold(el) {
    if (el.noticeBound) {
      return;
    }
    el.noticeBound = true;
    function pause() {
      if (el.noticeFades && !el.hidden) {
        stop(el);
      }
    }
    function resume() {
      if (el.noticeFades && !el.hidden && !held(el)) {
        schedule(el);
      }
    }
    el.addEventListener('mouseenter', pause);
    el.addEventListener('focusin', pause);
    el.addEventListener('mouseleave', resume);
    el.addEventListener('focusout', function () {
      // Focus may be moving to another element inside it.
      window.setTimeout(resume, 0);
    });
  }

  /**
   * Sets `el`'s text (into its .notice__text, when it has one) - unless
   * `text` is left out, for a message filled in already - and marks it as
   * an error or not when `options.error` is given.
   */
  function fill(el, text, options) {
    if (text !== undefined && text !== null) {
      (el.querySelector('.notice__text') || el).textContent = text;
    }
    if (options && 'error' in options) {
      el.classList.toggle('notice--error', !!options.error);
    }
  }

  /** Shows `el` and fades it out after a while. */
  function flash(el, text, options) {
    if (!el) {
      return;
    }
    fill(el, text, options);
    el.classList.add('fade-message');
    el.noticeFades = true;
    bindHold(el);
    el.hidden = false;
    schedule(el);
  }

  /** Shows `el` until it's hidden again: for a message with a button to act on. */
  function hold(el, text, options) {
    if (!el) {
      return;
    }
    fill(el, text, options);
    el.noticeFades = false;
    stop(el);
    el.hidden = false;
  }

  function hide(el) {
    if (!el) {
      return;
    }
    el.noticeFades = false;
    stop(el);
    el.hidden = true;
  }

  MusicHub.notice = {
    flash: flash,
    hold: hold,
    hide: hide,
  };
})(window.MusicHub);
