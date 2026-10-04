/*
 * The playlist dropdown: a custom listbox, since a native <select> can't show
 * cover images. Used by Setlists and by the Settings page's default
 * playlist. Markup it expects inside `root`:
 *
 *   .playlist-picker__toggle > .playlist-picker__current
 *   ul.playlist-picker__list[role=listbox]
 *
 * And the playlist checklist (createChecklist): the same rows, each with a
 * checkbox, for picking any number of playlists - Settings' Collection
 * playlists and the record player's playlist modal.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = text;
    }
    return node;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgIcon(className, paths) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', className);
    paths.forEach(function (d) {
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    return svg;
  }

  var HEART_PATH = 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 '
    + '7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z';

  /** Cover, name and song count - used by the options and the closed toggle. */
  function playlistSummary(playlist) {
    var summary = el('span', 'playlist-option__summary');
    if (playlist.liked) {
      // Liked Songs: Spotify's own look for it, a heart on a purple square.
      var liked = el('span', 'playlist-option__cover playlist-option__cover--liked');
      var heart = svgIcon('', [HEART_PATH]);
      heart.setAttribute('fill', 'currentColor');
      liked.appendChild(heart);
      summary.appendChild(liked);
    } else if (playlist.imageUrl) {
      var image = el('img', 'playlist-option__cover');
      image.src = playlist.imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      summary.appendChild(image);
    } else {
      summary.appendChild(el('span', 'playlist-option__cover playlist-option__cover--empty', '♪'));
    }
    var text = el('span', 'playlist-option__text');
    text.appendChild(el('span', 'playlist-option__name', playlist.name));
    if (playlist.trackCount !== null) {
      text.appendChild(el('span', 'playlist-option__meta',
        playlist.trackCount + (playlist.trackCount === 1 ? ' song' : ' songs')));
    }
    summary.appendChild(text);
    return summary;
  }

  /**
   * Wires up one dropdown. `onChange(playlist)` runs whenever the user picks
   * a playlist (not when one is selected from code).
   */
  function create(root, options) {
    var onChange = (options && options.onChange) || function () {};
    var toggle = root.querySelector('.playlist-picker__toggle');
    var current = root.querySelector('.playlist-picker__current');
    var list = root.querySelector('.playlist-picker__list');
    var placeholder = current.textContent;
    var optionPrefix = (root.id || 'playlist-picker') + '-option-';

    var playlists = [];
    var selectedId = null;
    // Index of the keyboard-highlighted option while the dropdown is open.
    var activeOption = -1;

    function setPlaylists(next) {
      playlists = next || [];
      list.textContent = '';
      playlists.forEach(function (playlist, index) {
        var option = el('li', 'playlist-option');
        option.id = optionPrefix + index;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', playlist.id === selectedId ? 'true' : 'false');
        option.appendChild(playlistSummary(playlist));
        option.addEventListener('click', function () {
          choose(playlist, true);
        });
        option.addEventListener('mousemove', function () {
          // Hover only highlights - the list scrolls when the user scrolls it.
          highlightOption(index, false);
        });
        list.appendChild(option);
      });
      if (selectedId && !selected()) {
        clear();
      }
    }

    function selected() {
      return playlists.filter(function (playlist) {
        return playlist.id === selectedId;
      })[0] || null;
    }

    function choose(playlist, byUser) {
      selectedId = playlist.id;
      current.textContent = '';
      current.appendChild(playlistSummary(playlist));
      Array.prototype.forEach.call(list.children, function (option, index) {
        option.setAttribute('aria-selected', playlists[index].id === playlist.id ? 'true' : 'false');
      });
      if (byUser) {
        close(true);
        onChange(playlist);
      }
    }

    /** Selects a playlist by id; false when it isn't in the list. */
    function select(id) {
      var match = playlists.filter(function (playlist) {
        return playlist.id === id;
      })[0];
      if (!match) {
        return false;
      }
      choose(match, false);
      return true;
    }

    function clear() {
      selectedId = null;
      current.textContent = placeholder;
      Array.prototype.forEach.call(list.children, function (option) {
        option.setAttribute('aria-selected', 'false');
      });
    }

    function open() {
      // The list is positioned absolutely, so opening it downwards near the
      // end of the page would stretch the page. Measure the page first, then
      // open upwards whenever the list wouldn't fit below the field.
      var pageHeight = document.documentElement.scrollHeight;
      root.classList.remove('playlist-picker--up');
      list.hidden = false;
      var toggleRect = toggle.getBoundingClientRect();
      var listBottom = toggleRect.bottom + window.scrollY + list.offsetHeight + 8;
      var roomAbove = toggleRect.top + window.scrollY;
      if (listBottom > pageHeight && roomAbove > list.offsetHeight) {
        root.classList.add('playlist-picker--up');
      }
      toggle.setAttribute('aria-expanded', 'true');
      var index = playlists.map(function (playlist) {
        return playlist.id;
      }).indexOf(selectedId);
      highlightOption(index === -1 ? 0 : index);
      list.focus();
    }

    function close(refocus) {
      if (list.hidden) {
        return;
      }
      list.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      list.removeAttribute('aria-activedescendant');
      if (refocus) {
        toggle.focus();
      }
    }

    /**
     * Marks an option as the active one. With `reveal`, the list scrolls just
     * far enough to show it - for the keyboard, never for the mouse.
     */
    function highlightOption(index, reveal) {
      var items = list.children;
      if (!items.length) {
        return;
      }
      activeOption = Math.max(0, Math.min(index, items.length - 1));
      Array.prototype.forEach.call(items, function (option, i) {
        option.classList.toggle('playlist-option--active', i === activeOption);
      });
      var active = items[activeOption];
      list.setAttribute('aria-activedescendant', active.id);
      if (reveal !== false) {
        revealOption(active);
      }
    }

    /** Scrolls the list itself (never the page) so the option is fully visible. */
    function revealOption(option) {
      // The list is positioned, so offsetTop is measured from its padding edge.
      var top = option.offsetTop;
      var bottom = top + option.offsetHeight;
      var padding = parseFloat(window.getComputedStyle(list).paddingTop) || 0;
      if (top - padding < list.scrollTop) {
        list.scrollTop = top - padding;
      } else if (bottom + padding > list.scrollTop + list.clientHeight) {
        list.scrollTop = bottom + padding - list.clientHeight;
      }
    }

    function onListKeydown(event) {
      var page = 5;
      switch (event.key) {
        case 'ArrowDown':
          highlightOption(activeOption + 1);
          break;
        case 'ArrowUp':
          highlightOption(activeOption - 1);
          break;
        case 'PageDown':
          highlightOption(activeOption + page);
          break;
        case 'PageUp':
          highlightOption(activeOption - page);
          break;
        case 'Home':
          highlightOption(0);
          break;
        case 'End':
          highlightOption(list.children.length - 1);
          break;
        case 'Enter':
        case ' ':
          if (playlists[activeOption]) {
            choose(playlists[activeOption], true);
          }
          break;
        case 'Escape':
          close(true);
          break;
        case 'Tab':
          close(false);
          return;
        default:
          return;
      }
      event.preventDefault();
    }

    toggle.addEventListener('click', function () {
      if (list.hidden) {
        open();
      } else {
        close(true);
      }
    });
    toggle.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        open();
      }
    });
    list.addEventListener('keydown', onListKeydown);
    document.addEventListener('click', function (event) {
      if (!root.contains(event.target)) {
        close(false);
      }
    });

    return {
      setPlaylists: setPlaylists,
      select: select,
      clear: clear,
      selected: selected,
      close: close,
    };
  }

  /**
   * A list of playlists to tick any number of, inside `list` (a <ul>).
   * `onToggle(playlist, checked)` runs when the user ticks or unticks one.
   * The ticks survive setPlaylists and filter, so a search never loses them.
   */
  function createChecklist(list, options) {
    var onToggle = (options && options.onToggle) || function () {};
    var idPrefix = (list.id || 'playlist-checklist') + '-';
    var playlists = [];
    var checkedIds = {};
    var rows = [];

    function setPlaylists(next, checked) {
      if (checked) {
        checkedIds = {};
        checked.forEach(function (id) {
          checkedIds[id] = true;
        });
      }
      // The ticked ones on top, each group in its own order. Only when the
      // list is built - a row never jumps away from under the pointer.
      var all = next || [];
      playlists = all.filter(function (playlist) {
        return checkedIds[playlist.id];
      }).concat(all.filter(function (playlist) {
        return !checkedIds[playlist.id];
      }));
      list.textContent = '';
      rows = playlists.map(function (playlist, index) {
        var row = el('li', 'playlist-check');
        var label = el('label', 'playlist-check__label');
        var input = el('input', 'playlist-check__input');
        input.type = 'checkbox';
        input.id = idPrefix + index;
        input.checked = !!checkedIds[playlist.id];
        input.addEventListener('change', function () {
          checkedIds[playlist.id] = input.checked;
          row.classList.toggle('playlist-check--on', input.checked);
          onToggle(playlist, input.checked);
        });
        label.appendChild(input);
        label.appendChild(playlistSummary(playlist));
        var box = el('span', 'playlist-check__box');
        box.appendChild(svgIcon('playlist-check__tick', ['M20 6 9 17l-5-5']));
        label.appendChild(box);
        row.classList.toggle('playlist-check--on', input.checked);
        row.appendChild(label);
        list.appendChild(row);
        return { playlist: playlist, row: row };
      });
    }

    /** The ticked ids, in list order. */
    function checked() {
      return playlists.filter(function (playlist) {
        return checkedIds[playlist.id];
      }).map(function (playlist) {
        return playlist.id;
      });
    }

    /** Shows only the playlists whose name holds `query`; returns how many are left. */
    function filter(query) {
      var needle = String(query || '').trim().toLowerCase();
      var shown = 0;
      rows.forEach(function (entry) {
        var match = !needle || entry.playlist.name.toLowerCase().indexOf(needle) !== -1;
        entry.row.hidden = !match;
        shown += match ? 1 : 0;
      });
      return shown;
    }

    return {
      setPlaylists: setPlaylists,
      checked: checked,
      filter: filter,
    };
  }

  MusicHub.playlistPicker = {
    create: create,
    createChecklist: createChecklist,
  };
})(window.MusicHub);
