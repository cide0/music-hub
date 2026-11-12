/*
 * The Edit rating modal (views/partials/rating-dialog.ejs) for an album in
 * the Album Suggester's history: opened by the rating pills of the Albums
 * page's history and the Collection's cards. The caller stores the rating
 * it hands back. Opened with `{ owned: true }` (only the Albums page) it
 * also asks whether the album is owned on vinyl, on CD, or both - the
 * readOwned / setOwned helpers serve the same checkboxes in the Albums
 * page's "add to history" modals too.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  // What an album can be owned on - an entry's `owned` lists them.
  var OWNED = ['vinyl', 'cd'];

  var els = null;
  // Gets the rating saved in the modal that is open right now.
  var onSave = null;
  // Whether the modal open right now shows the owned checkboxes.
  var withOwned = false;

  /** '' -> null (unrated), a whole number 1-100, or undefined when invalid. */
  function parse(raw) {
    var value = String(raw || '').trim();
    if (!value) {
      return null;
    }
    if (!/^\d+$/.test(value)) {
      return undefined;
    }
    var rating = Number(value);
    return rating >= 1 && rating <= 100 ? rating : undefined;
  }

  /**
   * What an entry is owned on, in OWNED's order: [], ['vinyl'], ['cd'] or
   * both. An `owned` saved as a single string (before both could be picked)
   * reads as a list of one.
   */
  function ownedOf(entry) {
    var stored = entry ? entry.owned : null;
    var list = Array.isArray(stored) ? stored : [stored];
    return OWNED.filter(function (format) {
      return list.indexOf(format) !== -1;
    });
  }

  function ownedInputs(fieldset) {
    return fieldset.querySelectorAll('input[type="checkbox"]');
  }

  /**
   * What's ticked in an "I own it on" fieldset (views/partials/owned-field.ejs),
   * like ownedOf: [], ['vinyl'], ['cd'] or ['vinyl', 'cd'].
   */
  function readOwned(fieldset) {
    var inputs = ownedInputs(fieldset);
    return OWNED.filter(function (format) {
      return Array.prototype.some.call(inputs, function (input) {
        return input.checked && input.value === format;
      });
    });
  }

  /** Ticks an "I own it on" fieldset's boxes to match `owned` (a list like ownedOf's). */
  function setOwned(fieldset, owned) {
    Array.prototype.forEach.call(ownedInputs(fieldset), function (input) {
      input.checked = (owned || []).indexOf(input.value) !== -1;
    });
  }

  /** Sets (or, for an empty list, removes) a history entry's `owned`. */
  function applyOwned(entry, owned) {
    if (owned && owned.length) {
      entry.owned = owned;
    } else {
      delete entry.owned;
    }
  }

  function bind() {
    var bound = {
      dialog: document.getElementById('rating-dialog'),
      title: document.getElementById('rating-dialog-title'),
      text: document.getElementById('rating-dialog-text'),
      input: document.getElementById('rating-dialog-input'),
      owned: document.getElementById('rating-dialog-owned'),
      error: document.getElementById('rating-dialog-error'),
    };
    document.getElementById('rating-form').addEventListener('submit', function (event) {
      event.preventDefault();
      save();
    });
    document.getElementById('rating-cancel').addEventListener('click', function () {
      bound.dialog.close();
    });
    return bound;
  }

  function save() {
    var rating = parse(els.input.value);
    if (rating === undefined) {
      MusicHub.notice.flash(els.error, 'The rating has to be a whole number from 1 to 100.');
      return;
    }
    els.dialog.close();
    if (withOwned) {
      onSave(rating, readOwned(els.owned));
    } else {
      onSave(rating);
    }
  }

  /**
   * Opens the modal on a history `entry` (its albumName, artistName, rating
   * and owned). Saving calls `save(rating)` with the new rating - a whole
   * number 1-100, or null when the field was emptied to take it away. With
   * `options.owned` the modal also shows the vinyl / CD checkboxes, and
   * `save` gets what's ticked as a second argument, like ownedOf: [],
   * ['vinyl'], ['cd'] or ['vinyl', 'cd'].
   */
  function open(entry, save, options) {
    els = els || bind();
    onSave = save;
    withOwned = Boolean(options && options.owned);
    els.title.textContent = withOwned ? 'Edit album' : 'Edit rating';
    els.text.textContent = entry.albumName + ' by ' + entry.artistName
      + '. Leave the rating empty to take it away.';
    els.input.value = typeof entry.rating === 'number' ? String(entry.rating) : '';
    els.owned.hidden = !withOwned;
    setOwned(els.owned, ownedOf(entry));
    MusicHub.notice.hide(els.error);
    els.dialog.showModal();
    els.input.focus();
    els.input.select();
  }

  MusicHub.ratingDialog = {
    open: open,
    parse: parse,
    ownedOf: ownedOf,
    readOwned: readOwned,
    setOwned: setOwned,
    applyOwned: applyOwned,
  };
})(window.MusicHub);
