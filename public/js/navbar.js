/*
 * Navbar behavior: the mobile hamburger menu.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  function initMenu() {
    var toggle = document.getElementById('navbar-toggle');
    var tabs = document.getElementById('navbar-tabs');
    if (!toggle || !tabs) {
      return;
    }

    toggle.addEventListener('click', function () {
      var open = tabs.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initMenu();
  });
})(window.MusicHub);
