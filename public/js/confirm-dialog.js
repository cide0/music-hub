/*
 * Shared yes / no confirm modal - the app's own dialog instead of the
 * browser's window.confirm, built with the same markup and classes as
 * Concert History's delete dialog so both look alike. Created on first use
 * and reused after that.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var els = null;
  // Settles the promise of the dialog that is open right now.
  var settle = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function build() {
    var dialog = el('dialog', 'modal modal--confirm');
    dialog.id = 'app-confirm-dialog';
    dialog.setAttribute('aria-labelledby', 'app-confirm-dialog-title');
    dialog.setAttribute('aria-describedby', 'app-confirm-dialog-text');

    var form = el('form', 'modal__form');
    var title = el('h2', 'modal__title');
    title.id = 'app-confirm-dialog-title';
    var text = el('p', 'modal__hint');
    text.id = 'app-confirm-dialog-text';

    var actions = el('div', 'modal__actions');
    var cancel = el('button', 'button button--ghost', 'Cancel');
    cancel.type = 'button';
    // A second way to go ahead, for the dialogs that offer one.
    var secondary = el('button', 'button button--ghost');
    secondary.type = 'button';
    secondary.hidden = true;
    var submit = el('button', 'button button--danger');
    submit.type = 'submit';
    actions.appendChild(cancel);
    actions.appendChild(secondary);
    actions.appendChild(submit);

    // The round X in the top-right corner, like every modal's (navbar.js
    // closes it, as with Escape).
    var close = el('button', 'icon-button modal__close');
    close.type = 'button';
    close.setAttribute('data-modal-close', '');
    close.setAttribute('aria-label', 'Close');
    close.title = 'Close';
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">'
      + '<line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>';

    form.appendChild(title);
    form.appendChild(text);
    form.appendChild(actions);
    dialog.appendChild(close);
    dialog.appendChild(form);
    document.body.appendChild(dialog);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      finish(true);
    });
    cancel.addEventListener('click', function () {
      dialog.close();
    });
    secondary.addEventListener('click', function () {
      finish('secondary');
    });
    // However it closes - Cancel, Escape, the X, a click outside it
    // (navbar.js) - it counts as a no.
    dialog.addEventListener('close', function () {
      finish(false);
    });

    return {
      dialog: dialog,
      title: title,
      text: text,
      actions: actions,
      submit: submit,
      secondary: secondary,
      cancel: cancel,
      close: close,
    };
  }

  function finish(confirmed) {
    var done = settle;
    settle = null;
    if (els.dialog.open) {
      els.dialog.close();
    }
    if (done) {
      done(confirmed);
    }
  }

  /**
   * Opens the modal with `options.title`, `options.text` and the confirm
   * button's label `options.action` (default "Delete") and the cancel
   * button's `options.cancel` (default "Cancel"). Resolves to true only when
   * the user confirms. With `options.secondary` (a label), a second button
   * beside the confirm one resolves to 'secondary' instead. `options.cancel:
   * false` leaves out the Cancel button (the X and Escape still say no), and
   * `options.danger: false` styles the confirm button like the others, for
   * a choice that isn't destructive.
   */
  function open(options) {
    els = els || build();
    if (settle) {
      finish(false);
    }
    els.title.textContent = options.title;
    els.text.textContent = options.text || '';
    els.submit.textContent = options.action || 'Delete';
    els.cancel.textContent = options.cancel || 'Cancel';
    els.cancel.hidden = options.cancel === false;
    els.submit.classList.toggle('button--danger', options.danger !== false);
    els.submit.classList.toggle('button--ghost', options.danger === false);
    els.secondary.textContent = options.secondary || '';
    els.secondary.hidden = !options.secondary;
    // Just the two choices: side by side, sharing the row.
    els.actions.classList.toggle('modal__actions--choice', !!options.secondary && options.cancel === false);

    return new Promise(function (resolve) {
      settle = resolve;
      els.dialog.showModal();
      // Saying no is the safe default for Enter: Cancel, or the X without it.
      (els.cancel.hidden ? els.close : els.cancel).focus();
    });
  }

  MusicHub.confirmDialog = { open: open };
})(window.MusicHub);
