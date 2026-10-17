/*
 * The Edit rating modal (views/partials/rating-dialog.ejs) for an album in
 * the Album Suggester's history: opened by the Albums page's pen and the
 * Collection's rating pill. The caller stores the rating it hands back.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var els = null;
  // Gets the rating saved in the modal that is open right now.
  var onSave = null;

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

  function bind() {
    var bound = {
      dialog: document.getElementById('rating-dialog'),
      text: document.getElementById('rating-dialog-text'),
      input: document.getElementById('rating-dialog-input'),
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
    onSave(rating);
  }

  /**
   * Opens the modal on a history `entry` (its albumName, artistName and
   * rating). Saving calls `save(rating)` with the new rating - a whole
   * number 1-100, or null when the field was emptied to take it away.
   */
  function open(entry, save) {
    els = els || bind();
    onSave = save;
    els.text.textContent = entry.albumName + ' by ' + entry.artistName
      + '. Leave it empty to take the rating away.';
    els.input.value = typeof entry.rating === 'number' ? String(entry.rating) : '';
    MusicHub.notice.hide(els.error);
    els.dialog.showModal();
    els.input.focus();
    els.input.select();
  }

  MusicHub.ratingDialog = { open: open, parse: parse };
})(window.MusicHub);
