/*
 * Concert Date Fetcher: walks the user's followed Spotify artists, asks the
 * backend's Ticketmaster proxy about each one, deduplicates the results into
 * one item per real-world concert and keeps everything in localStorage.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var STORAGE_KEY = 'concertDateFetcher';
  // ~4.5 requests/second, safely under Ticketmaster's limit of 5.
  var REQUEST_DELAY_MS = 220;
  var TIMEZONE = 'Europe/Berlin';
  var DEFAULT_DURATION_HOURS = 3;

  var els = {};
  var state = null;
  // 'all' | 'attending' | 'new'. The "new" set only exists for the current
  // session, matching the accent borders: it is what the most recent fetch
  // turned up, and it isn't persisted.
  var activeFilter = 'all';
  var lastNewIds = [];
  // The fetch currently in flight, if any - so it can be cancelled.
  var activeRun = null;
  // Ticking countdown to the next concert the user is attending.
  var countdownTimer = null;
  var countdownTarget = null;
  // The self-dismissing note shown after a fetch.
  var toastTimer = null;
  // Estimated time left, shown in the progress bar.
  var eta = null;
  // Artists whose lookup failed in the last run, for the notice's Retry.
  var lastFailed = [];

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

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

  function loadState() {
    var stored = MusicHub.storage.read(STORAGE_KEY, null);
    if (!stored || !Array.isArray(stored.concerts)) {
      return { lastFetchedAt: null, concerts: [] };
    }
    return { lastFetchedAt: stored.lastFetchedAt || null, concerts: stored.concerts };
  }

  function saveState() {
    MusicHub.storage.write(STORAGE_KEY, state);
  }

  function updateConcert(id, changes) {
    state.concerts.forEach(function (concert) {
      if (concert.id === id) {
        Object.keys(changes).forEach(function (key) {
          concert[key] = changes[key];
        });
      }
    });
    saveState();
  }

  /* ----------------------------------------------------------- formatting */

  function todayInBerlin() {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: TIMEZONE }).format(new Date());
  }

  function isUpcoming(concert) {
    return !concert.localDate || concert.localDate >= todayInBerlin();
  }

  function normalizeTime(localTime) {
    var parts = String(localTime).split(':');
    while (parts.length < 3) {
      parts.push('00');
    }
    return parts.slice(0, 3).join(':');
  }

  function formatConcertDate(concert) {
    var options = { timeZone: TIMEZONE, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };
    if (concert.localTime) {
      options.hour = '2-digit';
      options.minute = '2-digit';
    }
    var value = concert.dateTime
      || (concert.localTime ? concert.localDate + 'T' + normalizeTime(concert.localTime) : concert.localDate);
    var date = new Date(value);
    if (isNaN(date.getTime())) {
      return concert.localDate || '';
    }
    return new Intl.DateTimeFormat('de-DE', options).format(date);
  }

  function formatTimestamp(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) {
      return '';
    }
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: TIMEZONE, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date);
  }

  function sortValue(concert) {
    return (concert.localDate || '') + 'T' + normalizeTime(concert.localTime || '00:00:00');
  }

  /* ----------------------------------------------------------- deduping */

  function concertId(venueName, city, localDate) {
    return [
      String(venueName || '').trim().toLowerCase(),
      String(city || '').trim().toLowerCase(),
      localDate,
    ].join('|');
  }

  function addArtist(list, name) {
    if (list.indexOf(name) === -1) {
      list.push(name);
    }
  }

  // Wording that marks a listing as an add-on rather than a normal ticket.
  var SPECIAL_TICKET_PATTERNS = [
    'vip', 'v.i.p', 'premium', 'package', 'packages', 'paket', 'hotel', 'travel',
    'meet & greet', 'meet and greet', 'early entry', 'lounge', 'hospitality',
    'upgrade', 'backstage', 'soundcheck', 'platinum', 'add-on', 'add on',
    'suite', 'box seat', 'logen', 'loge ', 'skybox', 'sky box', 'club seat',
    'business seat', 'dinner', 'parking', 'shuttle',
  ];

  function normalizeName(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[\u2019'`´.]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function isSpecialTicket(event) {
    var name = String(event.eventName || '').toLowerCase();
    return SPECIAL_TICKET_PATTERNS.some(function (pattern) {
      return name.indexOf(pattern) !== -1;
    });
  }

  /**
   * How far a listing is from being the plain ticket for the show. Ticketmaster
   * names add-on listings after the base one ("Tour | Premium Packages",
   * "Tour | Box seat in the Ticketmaster Suite") and often credits an extra
   * act for them (the suite operator), so three signals are used rather than
   * wording alone.
   */
  function variantScore(event, normalizedArtists) {
    var name = String(event.eventName || '');
    var score = 0;

    if (isSpecialTicket(event)) {
      score += 100;
    }
    // A variant suffix after a separator - the base listing has none.
    if (name.indexOf('|') !== -1 || /\s[–—]\s/.test(name)) {
      score += 50;
    }
    // Anyone credited who isn't one of this show's artists.
    var extras = (event.attractionNames || []).filter(function (attraction) {
      return normalizedArtists.indexOf(normalizeName(attraction)) === -1;
    });
    if (extras.length) {
      score += 25;
    }

    return score;
  }

  /**
   * Which of a group's Ticketmaster entries the card links to: the plain
   * ticket, not a VIP, package or suite listing. Ties break towards the
   * shorter name (the base listing) and then the first one seen.
   */
  function pickRepresentative(events, artists) {
    var normalizedArtists = (artists || []).map(normalizeName);

    var ranked = events.map(function (event, index) {
      return {
        event: event,
        index: index,
        score: variantScore(event, normalizedArtists),
        length: String(event.eventName || '').length,
      };
    });

    ranked.sort(function (a, b) {
      return (a.score - b.score) || (a.length - b.length) || (a.index - b.index);
    });

    return ranked[0].event;
  }

  function firstWith(events, key) {
    for (var i = 0; i < events.length; i++) {
      if (events[i][key]) {
        return events[i];
      }
    }
    return null;
  }

  /**
   * Ticketmaster lists the same concert several times (standard ticket, VIP,
   * packages), and the same concert also turns up under several followed
   * artists. Collapse both: first per Ticketmaster event, then per
   * venue + city + day.
   */
  function buildConcerts(matches) {
    var byEvent = {};
    matches.forEach(function (match) {
      var existing = byEvent[match.event.ticketmasterId];
      if (existing) {
        addArtist(existing.artists, match.artistName);
        return;
      }
      byEvent[match.event.ticketmasterId] = { event: match.event, artists: [match.artistName] };
    });

    var groups = {};
    var order = [];
    Object.keys(byEvent).forEach(function (eventId) {
      var entry = byEvent[eventId];
      var event = entry.event;
      var id = concertId(event.venueName, event.city, event.localDate);

      if (!groups[id]) {
        groups[id] = { id: id, artists: [], events: [] };
        order.push(id);
      }
      groups[id].events.push(event);
      entry.artists.forEach(function (name) {
        addArtist(groups[id].artists, name);
      });
    });

    return order.map(function (id) {
      var group = groups[id];
      var main = pickRepresentative(group.events, group.artists);

      // Ticketmaster bills the acts in order, so the first attraction of a
      // listing is the headliner. A followed artist who shows up in the
      // line-up but never first is playing support. Artists we can't place
      // (no attraction data at all) get no label rather than a wrong one.
      var headliners = {};
      var billed = {};
      group.events.forEach(function (event) {
        (event.attractionNames || []).forEach(function (name, index) {
          var key = normalizeName(name);
          billed[key] = true;
          if (index === 0) {
            headliners[key] = true;
          }
        });
      });
      var supportArtists = group.artists.filter(function (name) {
        var key = normalizeName(name);
        return billed[key] && !headliners[key];
      });
      var withImage = main.imageUrl ? main : firstWith(group.events, 'imageUrl');
      var withTime = main.localTime ? main : firstWith(group.events, 'localTime');

      return {
        id: group.id,
        artists: group.artists,
        eventName: main.eventName,
        imageUrl: withImage ? withImage.imageUrl : null,
        date: (withTime && withTime.dateTime) || main.localDate,
        localDate: main.localDate,
        localTime: withTime ? withTime.localTime : null,
        dateTime: withTime ? withTime.dateTime : null,
        supportArtists: supportArtists,
        venueName: main.venueName,
        city: main.city,
        ticketUrl: main.ticketUrl,
        // More than one Ticketmaster entry for the same show means extra
        // ticket options (VIP, packages, ...).
        hasMultipleTicketOptions: group.events.length > 1,
        addedToCalendar: false,
        attending: false,
      };
    }).sort(function (a, b) {
      return sortValue(a) < sortValue(b) ? -1 : sortValue(a) > sortValue(b) ? 1 : 0;
    });
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

  /** A note about the run just finished, fading out on its own. */
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

  /** Pure filter, kept separate from the DOM so it can be tested directly. */
  function filterConcerts(concerts, filter, newIds) {
    return concerts.filter(function (concert) {
      if (filter === 'attending') {
        return !!concert.attending;
      }
      if (filter === 'new') {
        return (newIds || []).indexOf(concert.id) !== -1;
      }
      return true;
    });
  }

  /* ------------------------------------------------------------- countdown */

  // A show still counts as "happening now" for a few hours after doors.
  var HAPPENING_WINDOW_MS = 4 * 60 * 60 * 1000;

  /** When a concert starts, as a Date (local time), or null if unknown. */
  function concertStartDate(concert) {
    if (concert.dateTime) {
      var exact = new Date(concert.dateTime);
      return isNaN(exact.getTime()) ? null : exact;
    }
    if (!concert.localDate) {
      return null;
    }
    var fallback = new Date(concert.localDate + 'T' + normalizeTime(concert.localTime || '00:00:00'));
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  /** The soonest attending concert that hasn't finished yet. */
  function findNextAttending(concerts, now) {
    var reference = typeof now === 'number' ? now : Date.now();

    var candidates = [];
    concerts.forEach(function (concert) {
      if (!concert.attending) {
        return;
      }
      var start = concertStartDate(concert);
      if (start && start.getTime() + HAPPENING_WINDOW_MS >= reference) {
        candidates.push({ concert: concert, start: start });
      }
    });

    candidates.sort(function (a, b) {
      return a.start.getTime() - b.start.getTime();
    });

    return candidates.length ? candidates[0] : null;
  }

  function pad(value) {
    return value < 10 ? '0' + value : String(value);
  }

  /** "12d 04:33:21" / "04:33:21" */
  function formatCountdown(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var days = Math.floor(total / 86400);
    var hours = Math.floor((total % 86400) / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    return (days ? days + 'd ' : '') + pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
  }

  function tickCountdown() {
    if (!countdownTarget || !els.countdown) {
      return;
    }
    var label = countdownTarget.concert.artists.join(', ');
    var remaining = countdownTarget.start.getTime() - Date.now();
    els.countdown.textContent = remaining > 0
      ? 'Next: ' + label + ' in ' + formatCountdown(remaining)
      : 'Happening now: ' + label;
  }

  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    countdownTarget = null;
  }

  function updateCountdown() {
    if (!els.countdown) {
      return;
    }

    var next = findNextAttending(state.concerts);
    if (!next) {
      // Nothing marked as attending - the countdown simply isn't shown.
      stopCountdown();
      els.countdown.hidden = true;
      return;
    }

    countdownTarget = next;
    els.countdown.hidden = false;
    tickCountdown();
    if (!countdownTimer) {
      countdownTimer = setInterval(tickCountdown, 1000);
    }
  }

  /** Totals for the header: how many shows, across how many distinct artists. */
  function summarize(concerts) {
    var artists = {};
    concerts.forEach(function (concert) {
      (concert.artists || []).forEach(function (name) {
        artists[name] = true;
      });
    });
    return { shows: concerts.length, artists: Object.keys(artists).length };
  }

  /**
   * What the toast says after a run: how much this fetch actually added.
   * A cancelled run says so, since it only covered part of the artists.
   */
  function fetchSummaryMessage(concerts, newIds, cancelled) {
    var added = concerts.filter(function (concert) {
      return newIds.indexOf(concert.id) !== -1;
    });
    var totals = summarize(added);

    var core = totals.shows
      ? 'added ' + totals.shows + (totals.shows === 1 ? ' concert' : ' concerts')
        + ' for ' + totals.artists + (totals.artists === 1 ? ' artist' : ' artists') + '.'
      : 'no new concerts found.';

    return cancelled
      ? 'Fetch cancelled \u2014 ' + core
      : core.charAt(0).toUpperCase() + core.slice(1);
  }

  function updateSummary(concerts) {
    if (!els.summary) {
      return;
    }
    if (!concerts.length) {
      els.summary.hidden = true;
      return;
    }

    var totals = summarize(concerts);
    els.summary.textContent = totals.shows + (totals.shows === 1 ? ' show' : ' shows')
      + ' across ' + totals.artists + (totals.artists === 1 ? ' artist' : ' artists');
    els.summary.hidden = false;
  }

  function emptyFilterMessage() {
    if (activeFilter === 'attending') {
      return "You haven't marked any upcoming concerts as attending yet.";
    }
    if (activeFilter === 'new') {
      return 'The last fetch didn\u2019t turn up anything new.';
    }
    return '';
  }

  function updateFilterControls(upcomingCount) {
    if (!els.filters) {
      return;
    }

    // Filters are pointless with nothing to filter.
    els.filters.hidden = !upcomingCount;

    var newButton = els.filters.querySelector('[data-filter="new"]');
    newButton.disabled = !lastNewIds.length;
    if (newButton.disabled && activeFilter === 'new') {
      activeFilter = 'all';
    }

    Array.prototype.forEach.call(els.filters.querySelectorAll('.filter-button'), function (button) {
      var active = button.getAttribute('data-filter') === activeFilter;
      button.classList.toggle('filter-button--active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  /** The clear button is pointless with nothing stored, and unsafe mid-fetch. */
  function updateClearButton() {
    if (!els.clearButton) {
      return;
    }
    els.clearButton.disabled = !!activeRun || (!state.lastFetchedAt && !state.concerts.length);
  }

  /** Sweep this page's stored data out of localStorage and reset the view. */
  function clearStoredData() {
    return MusicHub.confirmDialog.open({
      title: 'Clear saved concerts?',
      text: 'The list, the \u201cLast fetched\u201d time and every \u201cAdded to calendar\u201d / '
        + '\u201cI\u2019m attending\u201d flag are removed from this browser. Calendar entries '
        + 'already created in Google Calendar stay untouched. This cannot be undone.',
      action: 'Clear data',
    }).then(function (confirmed) {
      // A fetch can't start while the modal is open, but check anyway.
      if (!confirmed || activeRun) {
        return;
      }

      MusicHub.storage.remove(STORAGE_KEY);
      state = { lastFetchedAt: null, concerts: [] };
      activeFilter = 'all';
      els.failedNotice.hidden = true;
      hideToast();
      render([]);
    });
  }

  function renderLastFetched() {
    if (state.lastFetchedAt) {
      els.lastFetched.textContent = 'Last fetched: ' + formatTimestamp(state.lastFetchedAt);
      els.lastFetched.hidden = false;
    } else {
      els.lastFetched.hidden = true;
    }
  }

  function showFailedArtists(names) {
    lastFailed = names.slice();

    if (!names.length) {
      els.failedNotice.hidden = true;
      return;
    }
    els.failedText.textContent = "Couldn't check concerts for: " + names.join(', ');
    els.failedRetry.textContent = names.length === 1 ? 'Retry artist' : 'Retry ' + names.length + ' artists';
    els.failedNotice.hidden = false;
  }

  function markAdded(button) {
    button.textContent = 'Added';
    button.disabled = true;
  }

  function markNotAdded(button) {
    button.textContent = 'Add to calendar';
    button.disabled = false;
  }

  function markAttending(button, attending) {
    button.textContent = attending ? "I'm attending ✓" : "I'm attending";
    button.classList.toggle('toggle-button--on', attending);
    button.setAttribute('aria-pressed', attending ? 'true' : 'false');
  }

  function buildCalendarEvent(concert) {
    var event = {
      // Artist name(s) plus the city - no venue name, per the plan.
      summary: concert.artists.join(', ') + ' – ' + concert.city,
    };

    if (concert.venueName) {
      event.location = concert.venueName + ', ' + concert.city;
    }
    var description = [concert.eventName, concert.ticketUrl].filter(Boolean).join('\n');
    if (description) {
      event.description = description;
    }

    if (concert.localTime) {
      var start = concert.localDate + 'T' + normalizeTime(concert.localTime);
      var parts = start.split(/[-T:]/).map(Number);
      var end = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3] + DEFAULT_DURATION_HOURS, parts[4], parts[5]));
      event.start = { dateTime: start, timeZone: TIMEZONE };
      event.end = { dateTime: end.toISOString().slice(0, 19), timeZone: TIMEZONE };
    } else {
      // Only a date, no time: an all-day event.
      var day = new Date(concert.localDate + 'T00:00:00Z');
      day.setUTCDate(day.getUTCDate() + 1);
      event.start = { date: concert.localDate };
      event.end = { date: day.toISOString().slice(0, 10) };
    }

    return event;
  }

  function renderCard(concert, isNew) {
    var card = el('article', 'concert-card'
      + (isNew ? ' concert-card--new' : '')
      + (concert.attending ? ' concert-card--attending' : ''));

    // Corner flag over the artist image, so a newly-found concert is obvious
    // without having to compare border colours.
    if (isNew) {
      card.appendChild(el('span', 'concert-card__tag', 'New'));
    }

    if (concert.imageUrl) {
      var image = el('img', 'concert-card__image');
      image.src = concert.imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      card.appendChild(image);
    }

    var body = el('div', 'concert-card__body');

    var support = concert.supportArtists || [];
    var heading = el('h2', 'concert-card__artists');
    concert.artists.forEach(function (name, index) {
      if (index > 0) {
        heading.appendChild(document.createTextNode(', '));
      }
      heading.appendChild(document.createTextNode(name));
      if (support.indexOf(name) !== -1) {
        heading.appendChild(el('span', 'concert-card__role', 'Support'));
      }
    });
    body.appendChild(heading);

    if (concert.eventName && concert.eventName !== concert.artists.join(', ')) {
      body.appendChild(el('p', 'concert-card__event', concert.eventName));
    }

    body.appendChild(el('p', 'concert-card__meta', formatConcertDate(concert)));
    body.appendChild(el('p', 'concert-card__meta', [concert.venueName, concert.city].filter(Boolean).join(' · ')));

    if (concert.hasMultipleTicketOptions) {
      body.appendChild(el(
        'p',
        'concert-card__note',
        'Multiple ticket options available (VIP, packages, etc.) — check Ticketmaster for details',
      ));
    }

    var actions = el('div', 'concert-card__actions');

    var error = el('p', 'concert-card__error');
    error.hidden = true;

    var calendarButton = el('button', 'button button--primary', 'Add to calendar');
    calendarButton.type = 'button';

    var attendingButton = el('button', 'button toggle-button');
    attendingButton.type = 'button';
    markAttending(attendingButton, !!concert.attending);

    if (concert.addedToCalendar) {
      markAdded(calendarButton);
    }

    calendarButton.addEventListener('click', function () {
      // Not connected yet? Start the Google flow first.
      if (!MusicHub.google.isConnected()) {
        MusicHub.google.connect();
        return;
      }

      error.hidden = true;
      calendarButton.disabled = true;
      calendarButton.textContent = 'Adding…';

      MusicHub.google.createCalendarEvent(buildCalendarEvent(concert)).then(function () {
        // Adding it to the calendar means the user is going.
        concert.addedToCalendar = true;
        concert.attending = true;
        updateConcert(concert.id, { addedToCalendar: true, attending: true });
        markAdded(calendarButton);
        markAttending(attendingButton, true);
        card.classList.add('concert-card--attending');
        updateCountdown();
      }).catch(function (err) {
        error.textContent = "Couldn't add to calendar: " + err.message;
        error.hidden = false;
        calendarButton.disabled = false;
        calendarButton.textContent = 'Add to calendar';
      });
    });

    attendingButton.addEventListener('click', function () {
      // Purely a local flag - no Google Calendar call at all.
      var attending = !concert.attending;
      concert.attending = attending;

      var changes = { attending: attending };
      if (!attending && concert.addedToCalendar) {
        // No longer going: offer "Add to calendar" again. Music Hub only
        // forgets that it was added - the event itself stays in Google
        // Calendar until the user deletes it there.
        concert.addedToCalendar = false;
        changes.addedToCalendar = false;
        markNotAdded(calendarButton);
        error.hidden = true;
      }

      updateConcert(concert.id, changes);
      markAttending(attendingButton, attending);
      card.classList.toggle('concert-card--attending', attending);
      updateCountdown();

      // Un-marking a concert while filtering by "attending" should drop it
      // out of the list right away.
      if (activeFilter === 'attending') {
        render(lastNewIds);
      }
    });

    actions.appendChild(calendarButton);
    actions.appendChild(attendingButton);
    body.appendChild(actions);
    body.appendChild(error);
    card.appendChild(body);

    // Three sparkle layers, only visible while the card is one the user is
    // attending (see .concert-card--attending in the stylesheet).
    var glitter = el('span', 'concert-card__glitter');
    glitter.setAttribute('aria-hidden', 'true');
    card.appendChild(glitter);

    // Feeds the foil sheen the pointer position, as percentages of the card.
    card.addEventListener('pointermove', function (event) {
      var rect = card.getBoundingClientRect();
      card.style.setProperty('--foil-x', ((event.clientX - rect.left) / rect.width * 100) + '%');
      card.style.setProperty('--foil-y', ((event.clientY - rect.top) / rect.height * 100) + '%');
    });

    if (concert.ticketUrl) {
      var cardLink = el('a', 'concert-card__link');
      cardLink.href = concert.ticketUrl;
      cardLink.target = '_blank';
      cardLink.rel = 'noopener noreferrer';
      // The overlay has no text of its own, so spell the target out.
      cardLink.setAttribute('aria-label', 'Tickets for ' + concert.artists.join(', ')
        + ' at ' + [concert.venueName, concert.city].filter(Boolean).join(', '));
      card.appendChild(cardLink);
      card.classList.add('concert-card--linked');
    }

    return card;
  }

  function render(newIds) {
    lastNewIds = newIds || [];
    els.list.textContent = '';

    // Shows that have already happened are never rendered, however long the
    // stored list has been sitting there.
    var upcoming = state.concerts.filter(isUpcoming);
    updateFilterControls(upcoming.length);

    if (!upcoming.length) {
      setMessage(state.lastFetchedAt
        ? 'No upcoming concerts found in the selected cities.'
        : 'No concerts fetched yet — hit "Fetch concert dates" to start.');
      updateSummary([]);
      updateCountdown();
      renderLastFetched();
      updateClearButton();
      return;
    }

    var visible = filterConcerts(upcoming, activeFilter, lastNewIds);
    updateSummary(visible);

    if (!visible.length) {
      setMessage(emptyFilterMessage());
    } else {
      setMessage('');
      visible.forEach(function (concert) {
        els.list.appendChild(renderCard(concert, lastNewIds.indexOf(concert.id) !== -1));
      });
    }

    updateCountdown();
    renderLastFetched();
    updateClearButton();
  }

  /**
   * Carries the user's flags over from the previous list and reports which
   * concerts weren't in it. On the very first fetch there is no previous list,
   * so everything counts as new.
   */
  function applyPreviousState(concerts, previous) {
    var previousById = {};
    (previous || []).forEach(function (concert) {
      previousById[concert.id] = concert;
    });

    var newIds = [];
    concerts.forEach(function (concert) {
      var before = previousById[concert.id];
      if (before) {
        // Keep the flags the user set on this concert before.
        concert.addedToCalendar = !!before.addedToCalendar;
        concert.attending = !!before.attending;
      } else {
        newIds.push(concert.id);
      }
    });

    return newIds;
  }

  /**
   * A run covering only some of the artists builds each concert from just
   * those it checked, so its line-up can be shorter than the one already
   * stored - and an act the stored entry knows is support can look like the
   * headliner to a retry of that act alone. The stored line-up is therefore
   * the one kept, with any name the run newly turned up appended to it.
   */
  function mergeArtists(concert, before) {
    if (!before) {
      return concert;
    }

    var artists = (before.artists || []).slice();
    concert.artists.forEach(function (name) {
      if (artists.indexOf(name) === -1) {
        artists.push(name);
      }
    });

    var support = (before.supportArtists || []).slice();
    (concert.supportArtists || []).forEach(function (name) {
      if (support.indexOf(name) === -1 && (before.artists || []).indexOf(name) === -1) {
        support.push(name);
      }
    });

    concert.artists = artists;
    concert.supportArtists = support;
    return concert;
  }

  /**
   * Folds a cancelled run's partial results into the stored list. The artists
   * the run never got to still have their concerts in `previous`, so those are
   * kept; where both lists hold the same concert, the fresh one wins.
   */
  function mergeConcerts(partial, previous) {
    var previousById = {};
    (previous || []).forEach(function (concert) {
      previousById[concert.id] = concert;
    });

    var seen = {};
    var combined = partial.map(function (concert) {
      seen[concert.id] = true;
      return mergeArtists(concert, previousById[concert.id]);
    });
    (previous || []).forEach(function (concert) {
      if (!seen[concert.id]) {
        combined.push(concert);
      }
    });
    return combined.sort(function (a, b) {
      return sortValue(a) < sortValue(b) ? -1 : sortValue(a) > sortValue(b) ? 1 : 0;
    });
  }

  /* -------------------------------------------------------------- fetching */

  function fetchConcertsFor(artistName, signal) {
    return fetch('/api/concerts?artist=' + encodeURIComponent(artistName), { signal: signal }).then(function (response) {
      if (!response.ok) {
        throw new Error('request failed with ' + response.status);
      }
      return response.json();
    });
  }

  function cancelFetch() {
    if (!activeRun) {
      return;
    }
    activeRun.cancelled = true;
    activeRun.controller.abort();
  }

  /**
   * Walks a list of artist names, one Ticketmaster lookup at a time with a
   * small delay in between so the rate limit is never hit. A single failed
   * lookup is collected rather than fatal.
   */
  function checkArtists(names, run, matches, failed) {
    var chain = Promise.resolve();

    names.forEach(function (name, index) {
      chain = chain.then(function () {
        if (run.cancelled) {
          return null;
        }
        var label = 'Checking concerts for ' + name + ' (' + (index + 1) + '/' + names.length + ')…';
        setStatus(label, (index / names.length) * 100);

        return fetchConcertsFor(name, run.controller.signal).then(function (data) {
          (data.events || []).forEach(function (event) {
            matches.push({ artistName: name, event: event });
          });
        }).catch(function (err) {
          if (run.cancelled) {
            return;
          }
          console.warn('Ticketmaster lookup failed for ' + name, err);
          failed.push(name);
        }).then(function () {
          if (run.cancelled) {
            return null;
          }
          setStatus(label, ((index + 1) / names.length) * 100);
          return delay(REQUEST_DELAY_MS);
        });
      });
    });

    return chain;
  }

  /**
   * Stores what a run turned up and reports it. `replace` is for a run that
   * covered every followed artist: its result is the whole truth, so concerts
   * that have disappeared from Ticketmaster drop out. A partial run - one that
   * was cancelled, or a retry of a few artists - is merged into the stored
   * list instead, and leaves "Last fetched" alone.
   */
  function storeRunResult(previous, matches, failed, run, replace) {
    var concerts = buildConcerts(matches);
    var newIds = applyPreviousState(concerts, previous);

    if (replace && !run.cancelled) {
      state = { lastFetchedAt: new Date().toISOString(), concerts: concerts };
    } else {
      state = { lastFetchedAt: state.lastFetchedAt, concerts: mergeConcerts(concerts, previous) };
    }

    saveState();
    render(newIds);
    showFailedArtists(failed);
    showToast(fetchSummaryMessage(concerts, newIds, run.cancelled));
  }

  /** Shared setup for both kinds of run: nothing else may be in flight. */
  function startRun() {
    // Re-read storage first: it may have been cleared or replaced from outside
    // this page (browser devtools, another tab, the navbar's Import) since the
    // page loaded, and comparing against a stale in-memory copy would hide
    // concerts that are genuinely new.
    state = loadState();
    activeRun = { cancelled: false, controller: new AbortController() };

    els.fetchButton.disabled = true;
    els.fetchButton.textContent = 'Fetching…';
    els.failedNotice.hidden = true;
    hideToast();
    updateClearButton();

    return activeRun;
  }

  function endRun(run) {
    setStatus('');
    els.fetchButton.disabled = false;
    els.fetchButton.textContent = 'Fetch concert dates';
    if (activeRun === run) {
      activeRun = null;
    }
    updateClearButton();
  }

  function runFetch() {
    var run = startRun();
    var previous = state.concerts;
    var failed = [];
    var matches = [];

    setStatus('Loading your followed artists…', 0);

    return MusicHub.spotify.getFollowedArtists().then(function (artists) {
      if (run.cancelled) {
        return null;
      }
      if (!artists.length) {
        setMessage("You don't follow any artists on Spotify yet.");
        els.list.textContent = '';
        return null;
      }

      var names = artists.map(function (artist) {
        return artist.name;
      });
      return checkArtists(names, run, matches, failed).then(function () {
        return names;
      });
    }).then(function (names) {
      // No artists at all - nothing was ever fetched, so there is nothing to
      // keep or report.
      if (!names) {
        return;
      }
      storeRunResult(previous, matches, failed, run, true);
    }).catch(function (err) {
      if (!run.cancelled) {
        setMessage('Something went wrong: ' + err.message);
      }
    }).then(function () {
      endRun(run);
    });
  }

  /**
   * Second go at the artists whose lookup failed, from the notice. Only those
   * are checked, so the result is merged into the stored list rather than
   * replacing it.
   */
  function retryFailedArtists() {
    if (activeRun || !lastFailed.length) {
      return Promise.resolve();
    }

    var names = lastFailed.slice();
    var run = startRun();
    var previous = state.concerts;
    var failed = [];
    var matches = [];

    return checkArtists(names, run, matches, failed).then(function () {
      storeRunResult(previous, matches, failed, run, false);
    }).catch(function (err) {
      if (!run.cancelled) {
        setMessage('Something went wrong: ' + err.message);
      }
    }).then(function () {
      endRun(run);
    });
  }

  /* ------------------------------------------------------------------ init */

  document.addEventListener('DOMContentLoaded', function () {
    els.fetchButton = document.getElementById('fetch-concerts');
    if (!els.fetchButton) {
      return;
    }
    els.status = document.getElementById('fetch-status');
    els.statusText = document.getElementById('fetch-status-text');
    els.progress = document.getElementById('fetch-progress');
    els.message = document.getElementById('concerts-message');
    els.list = document.getElementById('concerts-list');
    els.lastFetched = document.getElementById('last-fetched');
    els.clearButton = document.getElementById('clear-concerts');
    els.filters = document.getElementById('concert-filters');
    els.summary = document.getElementById('concerts-summary');
    els.countdown = document.getElementById('next-attending');
    eta = MusicHub.progressEta.create(document.getElementById('fetch-eta'));
    els.toast = document.getElementById('fetch-toast');
    els.failedNotice = document.getElementById('failed-notice');
    els.failedText = document.getElementById('failed-text');
    els.failedRetry = document.getElementById('failed-retry');

    els.fetchButton.addEventListener('click', runFetch);
    document.getElementById('fetch-cancel').addEventListener('click', cancelFetch);
    els.clearButton.addEventListener('click', clearStoredData);

    els.filters.addEventListener('click', function (event) {
      var button = event.target.closest('.filter-button');
      if (!button || button.disabled) {
        return;
      }
      activeFilter = button.getAttribute('data-filter');
      render(lastNewIds);
    });
    document.getElementById('failed-dismiss').addEventListener('click', function () {
      els.failedNotice.hidden = true;
      lastFailed = [];
    });
    els.failedRetry.addEventListener('click', retryFailedArtists);

    state = loadState();
    // Nothing is "new" on a plain page load - that flag only applies to the
    // render right after a fetch.
    render([]);
  });

  // Exposed for tests.
  MusicHub.concertDateFetcher = {
    cancelFetch: cancelFetch,
    retryFailedArtists: retryFailedArtists,
    findNextAttending: findNextAttending,
    formatCountdown: formatCountdown,
    summarize: summarize,
    fetchSummaryMessage: fetchSummaryMessage,
    mergeConcerts: mergeConcerts,
    applyPreviousState: applyPreviousState,
    filterConcerts: filterConcerts,
    clearStoredData: clearStoredData,
    pickRepresentative: pickRepresentative,
    buildConcerts: buildConcerts,
    buildCalendarEvent: buildCalendarEvent,
    concertId: concertId,
    isUpcoming: isUpcoming,
  };
})(window.MusicHub);
