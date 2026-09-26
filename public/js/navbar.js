/*
 * Navbar behavior: the mobile hamburger menu, the External Tools dropdown and
 * the warning before leaving a page while an update is running.
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

  /*
   * Every update in progress shows as a turning refresh button - the page's
   * own or the navbar's - so that is what counts as "running" here.
   */
  function isUpdating() {
    return !!document.querySelector('.refresh-button[aria-busy="true"]');
  }

  /*
   * Leaving the page ends a running update and loses its progress, so a link
   * that would do that asks first, in the app's own confirm modal. Anything
   * that bypasses the links (reload, back, closing the tab) gets the
   * browser's own prompt instead - the only one it allows there.
   */
  function initLeaveGuard() {
    // Set once the user agreed, so the browser doesn't ask a second time.
    var leaving = false;

    // Bubble phase, so links that page scripts handle themselves are skipped.
    document.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      var link = event.target.closest && event.target.closest('a[href]');
      if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) {
        return;
      }
      var url = new URL(link.href, window.location.href);
      // A jump within this page doesn't leave it.
      if (url.hash && url.origin + url.pathname + url.search
        === window.location.origin + window.location.pathname + window.location.search) {
        return;
      }
      if (!isUpdating() || !MusicHub.confirmDialog) {
        return;
      }

      event.preventDefault();
      MusicHub.confirmDialog.open({
        title: 'Cancel the update?',
        text: 'An update is still running. Leaving this page cancels it, '
          + 'and the progress made so far will be lost.',
        action: 'Leave page',
        cancel: 'Stay'
      }).then(function (confirmed) {
        if (confirmed) {
          leaving = true;
          window.location.href = url.href;
        }
      });
    });

    window.addEventListener('beforeunload', function (event) {
      if (!leaving && isUpdating()) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initMenu();
    initDropdown();
    initLeaveGuard();
  });
})(window.MusicHub);
