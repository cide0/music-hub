/*
 * Navbar behavior: the mobile hamburger menu and the External Tools dropdown.
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

  /*
   * The tab strip scrolls sideways when it runs out of room, which would clip
   * a menu positioned inside it. So on desktop the menu is placed against the
   * navbar itself (see the CSS) and lined up under its button here. In the
   * hamburger menu it simply sits in the list, and the offset is ignored.
   */
  function initDropdown() {
    var toggle = document.getElementById('external-tools-toggle');
    var menu = document.getElementById('external-tools-menu');
    var navbar = document.querySelector('.navbar');
    if (!toggle || !menu || !navbar) {
      return;
    }

    function place() {
      var bar = navbar.getBoundingClientRect();
      var button = toggle.getBoundingClientRect();
      // Kept inside the viewport when the button sits near the right edge.
      var left = Math.min(button.left - bar.left, bar.width - menu.offsetWidth - 8);
      menu.style.left = Math.max(8, left) + 'px';
    }

    function open() {
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      place();
    }

    function close() {
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }

    // With a mouse on the full-width navbar the menu opens on hover. Touch
    // screens and the hamburger menu keep click-to-toggle.
    var hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 901px)');
    var dropdown = toggle.parentNode;
    var closeTimer = null;

    dropdown.addEventListener('mouseenter', function () {
      if (!hoverQuery.matches) {
        return;
      }
      window.clearTimeout(closeTimer);
      open();
    });

    // A short grace period, so crossing the gap between the button and the
    // menu doesn't close it.
    dropdown.addEventListener('mouseleave', function () {
      if (!hoverQuery.matches) {
        return;
      }
      closeTimer = window.setTimeout(close, 200);
    });

    toggle.addEventListener('click', function (event) {
      // A mouse click on a menu hover already opened would only shut it
      // again; keyboard "clicks" (detail 0) still toggle.
      if (hoverQuery.matches && event.detail > 0) {
        open();
        return;
      }
      if (menu.hidden) {
        open();
      } else {
        close();
      }
    });

    // Anything outside the dropdown closes it - including picking a link,
    // which opens in a new tab and leaves this page as it was.
    document.addEventListener('click', function (event) {
      if (!menu.hidden && !toggle.contains(event.target)) {
        close();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !menu.hidden) {
        close();
        toggle.focus();
      }
    });

    // The button moves when the window resizes or the tab strip scrolls.
    window.addEventListener('resize', function () {
      if (!menu.hidden) {
        place();
      }
    });
    document.getElementById('navbar-tabs').addEventListener('scroll', function () {
      if (!menu.hidden) {
        place();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initMenu();
    initDropdown();
  });
})(window.MusicHub);
