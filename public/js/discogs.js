/*
 * Discogs: a random "Pick of the Day" from the collection of the Discogs
 * username saved on the Settings page, on every load, and a check of every followed Spotify artist for vinyl releases on
 * Discogs that haven't been shown before. Each check's finds are added to
 * the releases already listed, the whole list sorted by release date.
 *
 * "New" means "not shown before", not "released since the last check":
 * Discogs often lists a record days or weeks after its release date, and a
 * moving date cutoff would rule such a late entry out for good. So every
 * check looks back over a fixed window and leaves out the release ids it
 * has already shown.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var STORAGE_KEY = 'discogsVinylReleases';
  // How far back each check looks. A record Discogs lists later than this
  // after its release date is the one case still missed.
  var WINDOW_MONTHS = 6;
  // Releases Discogs only dates by year are skipped for this long, then
  // looked at again in case a full date has been added.
  var UNDATED_RECHECK_DAYS = 30;
  var TIMEZONE = 'Europe/Berlin';
  // Saved on the Settings page; the pick and the collection link need it.
  var USERNAME_SETTING = 'discogsUsername';

  var els = {};
  var state = null;
  // The check currently in flight, if any - so it can be cancelled.
  var activeRun = null;
  // Estimated time left, shown in the progress bar.
  var eta = null;
  var pickLoaded = false;
  // The self-dismissing note shown after a check.
  var toastTimer = null;
  // What's typed into the release search - only for this visit, not stored.
  var query = '';
  // Every card built so far, by release id: { release, card, text }. Cards
  // are built once and kept, so searching only shows and hides them instead
  // of rebuilding the list - and redrawing every record - on each keystroke.
  var cards = {};
  // How many cards the current search leaves showing.
  var visibleCount = 0;
  // The search waiting for the next frame, so fast typing filters once per frame.
  var searchFrame = 0;

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

  /* ------------------------------------------------------------ storage */

  /**
   * `releases` is every new release the checks have found, most recent
   * release date first, `checkedAt` when the last check ran and `since` the
   * window start it used. `seen` maps every release id shown so
   * far to its release date, so it can be pruned once that date leaves the
   * window. `known` lists, per artist, every release already looked at in
   * detail - see recordLookup - so later checks don't pay for it again.
   */
  function loadState() {
    var stored = MusicHub.storage.read(STORAGE_KEY, null);
    if (!stored || !Array.isArray(stored.releases)) {
      return { checkedAt: null, since: null, releases: [], seen: {}, known: {} };
    }

    var seen = stored.seen && typeof stored.seen === 'object' ? stored.seen : null;
    if (!seen) {
      // Saved before `seen` existed: what's on screen has been shown.
      seen = {};
      stored.releases.forEach(function (release) {
        seen[release.id] = release.releasedDate;
      });
    }

    return {
      checkedAt: stored.checkedAt || stored.lastCheckedAt || null,
      since: stored.since || null,
      releases: stored.releases,
      seen: seen,
      known: stored.known && typeof stored.known === 'object' ? stored.known : {},
    };
  }

  function saveState() {
    MusicHub.storage.write(STORAGE_KEY, state);
  }

  /* ----------------------------------------------------------- formatting */

  function formatTimestamp(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) {
      return '';
    }
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: TIMEZONE, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date);
  }

  /** '2026-08-15' as a full date; '2026-08' (Discogs knows no day) as the month. */
  function formatReleaseDate(value) {
    var parts = String(value || '').split('-').map(Number);
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return value || '';
    }
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] || 1));
    var options = parts[2]
      ? { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }
      : { timeZone: 'UTC', month: 'long', year: 'numeric' };
    return new Intl.DateTimeFormat('de-DE', options).format(date);
  }

  /* ----------------------------------------------------------- the result */

  /**
   * One card per Discogs release, even if several followed artists turned it
   * up, most recent release date first.
   */
  function dedupeAndSort(releases) {
    var byId = {};
    var unique = [];
    releases.forEach(function (release) {
      if (!byId[release.id]) {
        byId[release.id] = true;
        unique.push(release);
      }
    });
    return unique.sort(function (a, b) {
      return a.releasedDate < b.releasedDate ? 1 : a.releasedDate > b.releasedDate ? -1 : 0;
    });
  }

  /**
   * The list after a check: the releases already listed stay, and the new
   * finds join them - the whole list most recent release date first.
   */
  function appendReleases(listed, fresh) {
    return dedupeAndSort(listed.concat(fresh));
  }

  /** The first day of the look-back window, as 'YYYY-MM-DD'. */
  function windowStart(now) {
    var date = new Date(now || Date.now());
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - WINDOW_MONTHS);
    return date.toISOString().slice(0, 10);
  }

  /**
   * Compared at the release date's own precision, like the backend does:
   * '2026-03' is in a window starting '2026-03-01'.
   */
  function inWindow(releasedDate, since) {
    var date = String(releasedDate || '');
    return !!date && date >= since.slice(0, date.length);
  }

  /**
   * Splits a check's finds into the ones never shown before, and the updated
   * `seen` map: every find added, and anything whose release date has left
   * the window dropped - the backend won't return those again anyway.
   */
  function applySeen(found, seen, since) {
    var releases = dedupeAndSort(found);
    var fresh = releases.filter(function (release) {
      return !Object.prototype.hasOwnProperty.call(seen, release.id);
    });

    var nextSeen = {};
    Object.keys(seen).forEach(function (id) {
      if (inWindow(seen[id], since)) {
        nextSeen[id] = seen[id];
      }
    });
    releases.forEach(function (release) {
      nextSeen[release.id] = release.releasedDate;
    });

    return { fresh: fresh, seen: nextSeen };
  }

  function isoDay(date) {
    return date.toISOString().slice(0, 10);
  }

  /**
   * One artist's `known` entries, minus the ones that should be looked at
   * again: dated entries whose year has left the window (the search stops
   * returning those anyway), and undated ones last looked at more than
   * UNDATED_RECHECK_DAYS ago. Whatever is left is sent as the skip list.
   */
  function pruneKnown(entries, since, now) {
    var recheckBefore = new Date(now || Date.now());
    recheckBefore.setUTCDate(recheckBefore.getUTCDate() - UNDATED_RECHECK_DAYS);
    var recheckDay = isoDay(recheckBefore);
    var sinceYear = since.slice(0, 4);

    var kept = {};
    Object.keys(entries || {}).forEach(function (id) {
      var value = String(entries[id] || '');
      var keep = value.charAt(0) === '?'
        ? value.slice(1) >= recheckDay
        : value.slice(0, 4) >= sinceYear;
      if (keep) {
        kept[id] = value;
      }
    });
    return kept;
  }

  /**
   * Adds one artist lookup's outcome to that artist's `known` entries:
   * id -> release date (or year) for everything shown or ruled out, and
   * '?' + today for releases Discogs only dates by year.
   */
  function recordLookup(entries, data, now) {
    var next = {};
    Object.keys(entries).forEach(function (id) {
      next[id] = entries[id];
    });
    (data.releases || []).forEach(function (release) {
      next[release.id] = release.releasedDate;
    });
    var rejected = data.rejected || {};
    Object.keys(rejected).forEach(function (id) {
      next[id] = String(rejected[id]);
    });
    var today = isoDay(new Date(now || Date.now()));
    (data.undated || []).forEach(function (id) {
      next[id] = '?' + today;
    });
    return next;
  }

  /** Lowercased and without accents, so "bjork" finds "Björk". */
  function fold(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  /**
   * The text lines under a card's cover, in order. The search reads the same
   * lines, so whatever a card shows can be searched for.
   */
  function cardLines(release) {
    return [release.title, release.artist, formatReleaseDate(release.releasedDate), release.format];
  }

  /**
   * The releases whose card text contains every word of the search, in any
   * order ("swift ophelia" finds "Taylor Swift - The Fate Of Ophelia", "splatter
   * 2026" every splatter vinyl out this year).
   */
  function filterReleases(releases, search) {
    var words = searchWords(search);
    if (!words.length) {
      return releases;
    }
    return releases.filter(function (release) {
      return matches(searchText(release), words);
    });
  }

  function searchWords(search) {
    return fold(search).split(/\s+/).filter(Boolean);
  }

  /** Everything a card shows, folded once - the raw date too, so "2026-08" works. */
  function searchText(release) {
    return fold(cardLines(release).concat(release.releasedDate).filter(Boolean).join(' '));
  }

  function matches(text, words) {
    return words.every(function (word) {
      return text.indexOf(word) !== -1;
    });
  }

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : many);
  }

  /** The header count for the list on screen, e.g. "12 new releases across 8 artists". */
  function summaryText(releases, visibleCount, search) {
    if (!releases.length) {
      return '';
    }
    if (search && search.trim()) {
      return visibleCount + ' of ' + plural(releases.length, 'new release', 'new releases');
    }
    var artists = {};
    releases.forEach(function (release) {
      artists[release.artist] = true;
    });
    return plural(releases.length, 'new release', 'new releases')
      + ' across ' + plural(Object.keys(artists).length, 'artist', 'artists');
  }

  /* ------------------------------------------------------------ rendering */

  function setMessage(text) {
    if (text) {
      els.message.textContent = text;
      els.message.hidden = false;
    } else {
      els.message.hidden = true;
    }
  }

  function setStatus(text, progress) {
    if (!text) {
      els.status.hidden = true;
      if (eta) {
        eta.stop();
      }
      return;
    }
    els.statusText.textContent = text;
    els.status.hidden = false;

    var percent = typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : 0;
    els.progress.style.width = percent + '%';
    els.status.setAttribute('aria-valuenow', String(Math.round(percent)));

    if (eta) {
      eta.update(percent);
    }
  }

  function showFailedArtists(names) {
    if (!names.length) {
      els.failedNotice.hidden = true;
      return;
    }
    els.failedText.textContent = "Couldn't check Discogs for: " + names.join(', ');
    els.failedNotice.hidden = false;
  }

  /** A note about the check just finished, fading out on its own. */
  function showToast(text) {
    if (!els.toast || !text) {
      return;
    }
    window.clearTimeout(toastTimer);
    els.toast.textContent = text;
    els.toast.classList.remove('page-toast--fading');
    els.toast.hidden = false;

    toastTimer = window.setTimeout(function () {
      els.toast.classList.add('page-toast--fading');
      toastTimer = window.setTimeout(function () {
        els.toast.hidden = true;
        els.toast.classList.remove('page-toast--fading');
      }, 600);
    }, 6000);
  }

  function hideToast() {
    if (!els.toast) {
      return;
    }
    window.clearTimeout(toastTimer);
    els.toast.hidden = true;
    els.toast.classList.remove('page-toast--fading');
  }

  /**
   * What the toast says after a check, worded like Concert Date Fetcher's:
   * what it found, and whether it was cancelled part-way.
   */
  function checkSummaryMessage(fresh, cancelled) {
    var artists = {};
    fresh.forEach(function (release) {
      artists[release.artist] = true;
    });
    var artistCount = Object.keys(artists).length;

    var core = fresh.length
      ? 'found ' + plural(fresh.length, 'new release', 'new releases')
        + ' for ' + plural(artistCount, 'artist', 'artists') + '.'
      : 'no new releases found.';

    return cancelled
      ? 'Check cancelled \u2014 ' + core
      : core.charAt(0).toUpperCase() + core.slice(1);
  }

  // Touch screens never hover, so there every card shows a sliver of its
  // record - drawn once the card comes near the screen, not all at once.
  var NO_HOVER = window.matchMedia && window.matchMedia('(hover: none)').matches;
  var recordObserver = null;

  function drawRecordWhenVisible(card, cover, release) {
    if (!('IntersectionObserver' in window)) {
      addRecord(card, cover, release);
      return;
    }
    if (!recordObserver) {
      recordObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            recordObserver.unobserve(entry.target);
            entry.target.drawRecord();
          }
        });
      }, { rootMargin: '300px 0px' });
    }
    card.drawRecord = function () {
      addRecord(card, cover, release);
    };
    recordObserver.observe(card);
  }

  /**
   * Adds the release's record - drawn from its format by vinyl.js - behind
   * the sleeve, and gives the card the record's colours to glow in. Done on
   * first hover rather than up front, so a long list stays light.
   */
  function addRecord(card, cover, release) {
    if (card.record) {
      return card.record;
    }
    var spec = MusicHub.vinyl.describe(release.format);
    var options = { imageUrl: release.imageUrl, seed: release.id };
    card.record = MusicHub.vinyl.render(spec, options);
    cover.insertBefore(card.record, cover.firstChild);
    // Still until the record is out.
    MusicHub.vinyl.setPlaying(card.record, false);

    // The text below the cover takes on the record's pattern too.
    var body = card.querySelector('.release-card__body');
    if (body) {
      body.insertBefore(MusicHub.vinyl.backdrop(spec, options), body.firstChild);
    }

    var colors = MusicHub.vinyl.glowColors(spec);
    card.style.setProperty('--record-glow', colors.glow);
    card.style.setProperty('--record-accent', colors.accent);
    return card.record;
  }

  /**
   * Hover or keyboard focus pulls the record out and spins it. The class
   * goes on a frame after a freshly built record is in place, so it
   * slides out rather than appearing already out.
   */
  function bindRecord(card, cover, release) {
    var pending = 0;

    function play() {
      var fresh = !card.record;
      addRecord(card, cover, release);
      window.cancelAnimationFrame(pending);
      if (!fresh) {
        start();
        return;
      }
      pending = window.requestAnimationFrame(function () {
        pending = window.requestAnimationFrame(start);
      });
    }

    function start() {
      card.classList.add('release-card--playing');
      MusicHub.vinyl.setPlaying(card.record, true);
    }

    function stop() {
      window.cancelAnimationFrame(pending);
      card.classList.remove('release-card--playing');
      if (card.record) {
        MusicHub.vinyl.setPlaying(card.record, false);
      }
    }

    card.addEventListener('pointerenter', function (event) {
      if (event.pointerType !== 'touch') {
        play();
      }
    });
    card.addEventListener('pointerleave', stop);
    card.addEventListener('focus', play);
    card.addEventListener('blur', stop);

    // The highlight on the record follows the cursor.
    card.addEventListener('pointermove', function (event) {
      if (!card.record) {
        return;
      }
      var rect = card.record.getBoundingClientRect();
      card.record.style.setProperty('--light-x', ((event.clientX - rect.left) / rect.width * 100) + '%');
      card.record.style.setProperty('--light-y', ((event.clientY - rect.top) / rect.height * 100) + '%');
    });
  }

  function renderCard(release) {
    var card = el('a', 'release-card');
    card.href = release.releaseUrl;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';

    var cover = el('div', 'release-card__cover');
    // The sleeve hides the record until it slides aside, cover art or not.
    var sleeve = el('div', 'release-card__sleeve');
    if (release.imageUrl) {
      var image = el('img', 'release-card__image');
      image.src = release.imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      sleeve.appendChild(image);
    }
    cover.appendChild(sleeve);
    card.appendChild(cover);

    if (NO_HOVER) {
      drawRecordWhenVisible(card, cover, release);
    } else {
      bindRecord(card, cover, release);
    }

    var body = el('div', 'release-card__body');
    var lines = cardLines(release);
    body.appendChild(el('h3', 'release-card__title', release.title));
    body.appendChild(el('p', 'release-card__artist', release.artist));
    // Date and format: whatever cardLines() adds after the first two.
    lines.slice(2).filter(Boolean).forEach(function (line) {
      body.appendChild(el('p', 'release-card__meta', line));
    });
    card.appendChild(body);

    return card;
  }

  function setSummary(text) {
    els.summary.textContent = text;
    els.summary.hidden = !text;
  }

  function renderSummary() {
    setSummary(summaryText(state.releases, visibleCount, query));
  }

  function hasSavedData() {
    return !!state.checkedAt || state.releases.length > 0
      || Object.keys(state.seen).length > 0 || Object.keys(state.known).length > 0;
  }

  function updateClearButton() {
    els.clearButton.disabled = !!activeRun || !hasSavedData();
  }

  /** Sweep this page's stored data out of localStorage and reset the view. */
  function clearStoredData() {
    return MusicHub.confirmDialog.open({
      title: 'Clear saved releases?',
      text: 'The release list, the \u201cLast checked\u201d time and the record of which releases '
        + 'you\u2019ve already seen are removed from this browser. The next check starts from '
        + 'scratch: it shows everything from the last ' + WINDOW_MONTHS + ' months again and takes as long as a '
        + 'first check. Your Discogs username in Settings stays. This cannot be undone.',
      action: 'Clear data',
    }).then(function (confirmed) {
      // A check can't start while the modal is open, but check anyway.
      if (!confirmed || activeRun) {
        return;
      }

      MusicHub.storage.remove(STORAGE_KEY);
      state = loadState();
      els.search.value = '';
      query = '';
      els.searchClear.hidden = true;
      els.failedNotice.hidden = true;
      hideToast();
      render();
    });
  }

  /**
   * The card for a release: the one already built, unless the release has
   * been replaced since (a new check brings fresh objects).
   */
  function cardFor(release) {
    var entry = cards[release.id];
    if (!entry || entry.release !== release) {
      entry = { release: release, card: renderCard(release), text: searchText(release) };
      cards[release.id] = entry;
    }
    return entry;
  }

  /** Drops the cards of releases no longer in the list. */
  function pruneCards() {
    var current = {};
    state.releases.forEach(function (release) {
      current[release.id] = release;
    });
    Object.keys(cards).forEach(function (id) {
      if (current[id] !== cards[id].release) {
        if (recordObserver) {
          recordObserver.unobserve(cards[id].card);
        }
        delete cards[id];
      }
    });
  }

  /**
   * Shows the cards matching the search and hides the rest - no cards are
   * built or removed, so the records already drawn stay drawn.
   */
  function applySearch() {
    window.cancelAnimationFrame(searchFrame);
    var words = searchWords(query);
    visibleCount = 0;
    state.releases.forEach(function (release) {
      var entry = cards[release.id];
      if (!entry) {
        return;
      }
      var show = !words.length || matches(entry.text, words);
      if (entry.card.hidden === show) {
        entry.card.hidden = !show;
      }
      if (show) {
        visibleCount++;
      }
    });
    renderSummary();

    if (state.checkedAt && state.releases.length) {
      setMessage(visibleCount ? '' : 'No releases match \u201c' + query.trim() + '\u201d.');
    }
  }

  /** Filters on the next frame, once, however many keys came in before it. */
  function scheduleSearch() {
    window.cancelAnimationFrame(searchFrame);
    searchFrame = window.requestAnimationFrame(applySearch);
  }

  function render() {
    pruneCards();
    els.list.textContent = '';
    updateClearButton();
    els.searchWrap.hidden = !state.releases.length;
    visibleCount = state.releases.length;
    renderSummary();

    if (state.checkedAt) {
      els.lastChecked.textContent = 'Last checked: ' + formatTimestamp(state.checkedAt);
      els.lastChecked.hidden = false;
    } else {
      els.lastChecked.hidden = true;
    }

    // Never checked: just the button, nothing below it.
    if (!state.checkedAt) {
      setMessage('');
      return;
    }
    if (!state.releases.length) {
      setMessage('No new releases found since your last check.');
      return;
    }

    // Every card goes in, in order, in one go; the search then hides the
    // ones it rules out.
    var fragment = document.createDocumentFragment();
    state.releases.forEach(function (release) {
      fragment.appendChild(cardFor(release).card);
    });
    els.list.appendChild(fragment);
    applySearch();
  }

  /* ------------------------------------------------------ pick of the day */

  function renderPick(item) {
    els.pick.textContent = '';

    var link = el('a', 'pick-card__link');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    var cover = el('div', 'pick-card__cover');
    if (item.imageUrl) {
      var image = el('img', 'pick-card__image');
      image.src = item.imageUrl;
      image.alt = '';
      cover.appendChild(image);
    }
    link.appendChild(cover);

    var body = el('div', 'pick-card__body');
    body.appendChild(el('p', 'pick-card__eyebrow', 'Listen to today'));
    body.appendChild(el('h3', 'pick-card__title', item.title));
    body.appendChild(el('p', 'pick-card__artist', item.artist));
    if (item.year) {
      body.appendChild(el('p', 'pick-card__meta', String(item.year)));
    }
    link.appendChild(body);

    els.pick.appendChild(link);
  }

  function showPickMessage(text) {
    els.pick.textContent = '';
    els.pick.appendChild(el('p', 'pick-card__message', text));
  }

  function getUsername() {
    var username = MusicHub.storage.getSetting(USERNAME_SETTING, null);
    return typeof username === 'string' && username.trim() ? username.trim() : null;
  }

  function renderCollectionLink(username) {
    els.collectionLinkWrap.hidden = !username;
    if (username) {
      els.collectionLink.href = 'https://www.discogs.com/user/' + encodeURIComponent(username) + '/collection';
    }
  }

  /** No username saved yet: say where to add one instead of picking. */
  function showUsernamePrompt() {
    els.pick.textContent = '';
    var message = el('p', 'pick-card__message', 'Add your Discogs username in ');
    var link = el('a', null, 'Settings');
    link.href = '/settings';
    message.appendChild(link);
    message.appendChild(document.createTextNode(' to get a pick from your collection.'));
    els.pick.appendChild(message);
  }

  /** A fresh random pick on every page load - never stored. */
  function loadPick() {
    if (pickLoaded) {
      return;
    }
    pickLoaded = true;

    var username = getUsername();
    if (!username) {
      showUsernamePrompt();
      return;
    }

    // Errors carrying a `userMessage` are shown as they are; anything else
    // (network down, rate limit) gets the generic line.
    function fail(text) {
      var error = new Error(text);
      error.userMessage = text;
      return error;
    }

    fetch('/api/discogs/random-collection-item?username=' + encodeURIComponent(username)).then(function (response) {
      if (response.status === 404) {
        throw fail('There\u2019s no Discogs user \u201c' + username + '\u201d \u2014 check the username in Settings');
      }
      if (response.status === 403) {
        throw fail('The Discogs collection of \u201c' + username + '\u201d isn\u2019t public');
      }
      if (!response.ok) {
        throw new Error('request failed with ' + response.status);
      }
      return response.json();
    }).then(function (data) {
      if (!data.item) {
        showPickMessage('Your Discogs collection is empty');
        return;
      }
      renderPick(data.item);
    }).catch(function (err) {
      console.warn('Could not load a pick of the day', err);
      showPickMessage(err.userMessage || "Couldn't load a pick for today");
    });
  }

  /* -------------------------------------------------------------- checking */

  function fetchReleasesFor(artistName, since, skip, signal) {
    var url = '/api/discogs/releases?artist=' + encodeURIComponent(artistName)
      + '&since=' + encodeURIComponent(since)
      + (skip.length ? '&skip=' + skip.join(',') : '');
    return fetch(url, { signal: signal }).then(function (response) {
      if (!response.ok) {
        throw new Error('request failed with ' + response.status);
      }
      return response.json();
    });
  }

  function cancelCheck() {
    if (!activeRun) {
      return;
    }
    activeRun.cancelled = true;
    activeRun.controller.abort();
  }

  /** While a check runs, the header counts what it has turned up so far. */
  function showRunningCount(found, since) {
    var count = applySeen(found, state.seen, since).fresh.length;
    setSummary(plural(count, 'new release', 'new releases') + ' found so far');
  }

  /**
   * One artist at a time, back to back - the backend paces the Discogs
   * requests themselves. A single failed lookup is collected rather than
   * fatal. Each finished lookup updates `known`, so a cancelled check still
   * keeps what it learned.
   */
  function checkArtists(names, since, run, found, failed, known) {
    var chain = Promise.resolve();

    names.forEach(function (name, index) {
      chain = chain.then(function () {
        if (run.cancelled) {
          return null;
        }
        var label = 'Checking Discogs for ' + name + ' (' + (index + 1) + '/' + names.length + ')…';
        setStatus(label, (index / names.length) * 100);

        var entries = pruneKnown(known[name], since);
        return fetchReleasesFor(name, since, Object.keys(entries), run.controller.signal).then(function (data) {
          (data.releases || []).forEach(function (release) {
            found.push(release);
          });
          known[name] = recordLookup(entries, data);
          if (!run.cancelled) {
            showRunningCount(found, since);
          }
        }).catch(function (err) {
          // Cancelling aborts the lookup in flight: that artist wasn't checked.
          if (run.cancelled) {
            return;
          }
          console.warn('Discogs lookup failed for ' + name, err);
          failed.push(name);
        }).then(function () {
          if (run.cancelled) {
            return null;
          }
          setStatus(label, ((index + 1) / names.length) * 100);
          return null;
        });
      });
    });

    return chain;
  }

  /** The round refresh button: its icon turning while busy, its name saying so. */
  function setRefreshBusy(button, isBusy, label) {
    button.setAttribute('aria-busy', String(isBusy));
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  function runCheck() {
    if (activeRun) {
      return Promise.resolve();
    }
    // Fetched by the navbar's refresh button only - never from here.
    var followed = MusicHub.followedArtists.list();
    if (!followed) {
      setMessage(MusicHub.followedArtists.MISSING_MESSAGE);
      return Promise.resolve();
    }

    // Re-read storage first: it may have been cleared or replaced from
    // outside this page (Settings' Import, another tab) since it loaded.
    state = loadState();
    var run = { cancelled: false, controller: new AbortController() };
    activeRun = run;

    var checkStartedAt = new Date().toISOString();
    var since = windowStart();
    var found = [];
    var failed = [];

    els.checkButton.disabled = true;
    setRefreshBusy(els.checkButton, true, 'Checking for new releases…');
    updateClearButton();
    els.failedNotice.hidden = true;
    hideToast();
    showRunningCount([], since);

    return Promise.resolve(followed).then(function (artists) {
      if (run.cancelled) {
        return;
      }
      if (!artists.length) {
        els.list.textContent = '';
        setMessage("You don't follow any artists on Spotify yet.");
        return;
      }

      var names = artists.map(function (artist) {
        return artist.name;
      });
      var known = {};
      Object.keys(state.known).forEach(function (name) {
        known[name] = state.known[name];
      });

      return checkArtists(names, since, run, found, failed, known).then(function () {
        // A finished check has been through every followed artist, so
        // anyone missing from the list has been unfollowed since.
        if (!run.cancelled) {
          Object.keys(known).forEach(function (name) {
            if (names.indexOf(name) === -1) {
              delete known[name];
            }
          });
        }

        // A failed artist's releases simply aren't marked as seen, so the
        // next check that gets through to them still shows them. The same
        // goes for the artists a cancelled check never got to, which is why
        // what it did find can be shown and stored like a full result.
        var result = applySeen(found, state.seen, since);

        state.seen = result.seen;
        state.known = known;
        // What it found new joins the releases already listed - a finished
        // check and a cancelled one alike. Cancelled without finding
        // anything new, it doesn't count as a check - but what it learned is
        // still kept.
        var counts = !(run.cancelled && !result.fresh.length);
        if (counts) {
          state.checkedAt = checkStartedAt;
          state.since = since;
          state.releases = appendReleases(state.releases, result.fresh);
        }
        saveState();
        if (counts) {
          render();
        }
        showFailedArtists(failed);
        showToast(checkSummaryMessage(result.fresh, run.cancelled));
      });
    }).catch(function (err) {
      if (!run.cancelled) {
        setMessage('Something went wrong: ' + err.message);
      }
    }).then(function () {
      setStatus('');
      // Back from the running count to what the list on screen holds.
      renderSummary();
      els.checkButton.disabled = false;
      setRefreshBusy(els.checkButton, false, 'Check for new releases');
      activeRun = null;
      updateClearButton();
    });
  }

  /* ------------------------------------------------------------------ init */

  document.addEventListener('DOMContentLoaded', function () {
    els.checkButton = document.getElementById('check-releases');
    if (!els.checkButton) {
      return;
    }
    els.pick = document.getElementById('pick-of-the-day');
    els.collectionLinkWrap = document.getElementById('collection-link-wrap');
    els.collectionLink = document.getElementById('collection-link');
    els.lastChecked = document.getElementById('last-checked');
    els.status = document.getElementById('check-status');
    els.statusText = document.getElementById('check-status-text');
    els.progress = document.getElementById('check-progress');
    els.message = document.getElementById('releases-message');
    els.list = document.getElementById('releases-list');
    els.failedNotice = document.getElementById('failed-notice');
    els.failedText = document.getElementById('failed-text');
    els.summary = document.getElementById('releases-summary');
    els.toast = document.getElementById('check-toast');
    els.searchWrap = document.getElementById('releases-search-wrap');
    els.search = document.getElementById('releases-search');
    els.searchClear = document.getElementById('releases-search-clear');
    eta = MusicHub.progressEta.create(document.getElementById('check-eta'));

    els.clearButton = document.getElementById('clear-releases');
    els.checkButton.addEventListener('click', runCheck);
    els.clearButton.addEventListener('click', clearStoredData);
    document.getElementById('check-cancel').addEventListener('click', cancelCheck);
    document.getElementById('failed-dismiss').addEventListener('click', function () {
      els.failedNotice.hidden = true;
    });

    els.search.addEventListener('input', function () {
      query = els.search.value;
      els.searchClear.hidden = !query;
      scheduleSearch();
    });
    els.searchClear.addEventListener('click', function () {
      els.search.value = '';
      query = '';
      els.searchClear.hidden = true;
      applySearch();
      els.search.focus();
    });

    state = loadState();
    render();
    renderCollectionLink(getUsername());

    // The pick sits behind the Spotify login like the rest of the page, so
    // it's only requested once someone is logged in.
    if (MusicHub.auth.isLoggedIn()) {
      loadPick();
    }
  });

  document.addEventListener('musichub:authchange', function (event) {
    if (event.detail && event.detail.loggedIn && els.pick) {
      loadPick();
    }
  });

  // Exposed for tests.
  MusicHub.discogs = {
    runCheck: runCheck,
    cancelCheck: cancelCheck,
    dedupeAndSort: dedupeAndSort,
    filterReleases: filterReleases,
    summaryText: summaryText,
    checkSummaryMessage: checkSummaryMessage,
    applySeen: applySeen,
    appendReleases: appendReleases,
    clearStoredData: clearStoredData,
    pruneKnown: pruneKnown,
    recordLookup: recordLookup,
    windowStart: windowStart,
    inWindow: inWindow,
    formatReleaseDate: formatReleaseDate,
  };
})(window.MusicHub);
