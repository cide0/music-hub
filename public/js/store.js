/*
 * The Store: coins earned on the Album Suggester buy username styles
 * (bought once, then equipped or taken off) and mystery vinyls - a random
 * record, drawn by vinyl.js like the Discogs page's, unboxed with an
 * animation and never one the collection already holds.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var VINYL_PRICE = 1000;
  // The Album Suggester's album history (album-suggester.js), which the
  // album picker lists - read here, never written.
  var HISTORY_KEY = 'albumSuggesterHistory';

  var USERNAME_ITEMS = [
    {
      id: 'rainbow',
      name: 'Rainbow',
      price: 1000,
      text: 'Your name and its border run through the whole spectrum, colours flowing across both.',
    },
    {
      id: 'gold',
      name: 'Gold Shine',
      price: 2000,
      text: 'Polished gold with a shine sweeping across, a turning gold frame and a warm glow.',
    },
  ];

  // The unlock, stage by stage (ms from the purchase).
  var UNLOCK_SHAKE_MS = 700;
  var UNLOCK_OPEN_MS = 600;
  var UNLOCK_AWAY_MS = 550;
  var UNLOCK_REVEAL_MS = 700;

  var wallet = MusicHub.wallet;
  var els = {};
  // Item ids mid-unlock: left alone by re-renders until they're done.
  var unlocking = {};
  var unboxing = false;

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

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  /** Runs a Web Animation and resolves when it's done (straight away without WAAPI). */
  function play(node, frames, options) {
    if (!node.animate) {
      return Promise.resolve();
    }
    var animation = node.animate(frames, options);
    return new Promise(function (resolve) {
      animation.onfinish = resolve;
      animation.oncancel = resolve;
    });
  }

  /** "1,000" with the coin in front. */
  function price(coins) {
    var node = el('span', 'price');
    node.appendChild(wallet.coinSvg('coin'));
    node.appendChild(el('span', 'price__value', wallet.format(coins)));
    node.appendChild(el('span', 'visually-hidden', ' coins'));
    return node;
  }

  /** A copy of the lock drawn in the page (store.ejs, on the vinyl offer). */
  function lock() {
    var node = el('span', 'store-lock');
    node.appendChild(document.querySelector('#vinyl-lock svg').cloneNode(true));
    return node;
  }

  /* --------------------------------------------------------------- sound */

  /*
   * The Store's sounds, synthesised through the wallet's audio context
   * like the coins: a lock springing open, and the mystery box's thuds,
   * rattles, pop and chime.
   */
  function tone(ctx, at, from, to, peak, decay, type) {
    var osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + decay);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(gain).connect(wallet.audioOutput());
    osc.start(at);
    osc.stop(at + decay + 0.02);
  }

  function noise(ctx, at, length, type, frequency, q, peak, attack, sweepTo) {
    var buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * length)), ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    var source = ctx.createBufferSource();
    source.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, at);
    if (sweepTo) {
      filter.frequency.exponentialRampToValueAtTime(sweepTo, at + length);
    }
    filter.Q.value = q;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + (attack || 0.003));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(filter).connect(gain).connect(wallet.audioOutput());
    source.start(at);
    source.stop(at + length + 0.01);
  }

  /** A bright chord of little bells, rising. */
  function chime(ctx, at, notes, peak) {
    notes.forEach(function (frequency, index) {
      var start = at + index * 0.07;
      tone(ctx, start, frequency, frequency, peak, 1.1);
      tone(ctx, start, frequency * 2.76, frequency * 2.76, peak * 0.3, 0.5);
    });
  }

  var SOUNDS = {
    // The key turning: a small click, a tense rattle, then the shackle
    // springing open with a clack.
    unlockShake: function (ctx, at) {
      for (var i = 0; i < 5; i += 1) {
        noise(ctx, at + i * 0.13, 0.03, 'bandpass', 3200, 6, 0.18, 0.002);
      }
    },
    unlockOpen: function (ctx, at) {
      noise(ctx, at, 0.05, 'highpass', 2500, 0.8, 0.5, 0.001);
      noise(ctx, at, 0.12, 'bandpass', 3800, 12, 0.5, 0.001);
      tone(ctx, at, 240, 120, 0.3, 0.12);
      chime(ctx, at + 0.3, [1047, 1319, 1568, 2093], 0.05);
    },
    // The box landing, and every shake after it.
    thud: function (ctx, at, level) {
      tone(ctx, at, 140, 60, 0.5 * level, 0.2);
      noise(ctx, at, 0.09, 'lowpass', 900, 0.7, 0.35 * level, 0.002);
    },
    // Something loose inside, rattling against the cardboard.
    rattle: function (ctx, at, level) {
      for (var i = 0; i < 4; i += 1) {
        noise(ctx, at + i * 0.045 + Math.random() * 0.02, 0.04, 'bandpass', 1400 + Math.random() * 800, 3, 0.25 * level, 0.002);
      }
    },
    // The lid sliding off: cardboard dragged over cardboard.
    slide: function (ctx, at) {
      noise(ctx, at, 0.4, 'bandpass', 900, 0.9, 0.3, 0.12, 2400);
      noise(ctx, at + 0.3, 0.05, 'lowpass', 700, 0.7, 0.2, 0.003);
    },
    // The record peeking out, and slipping back in.
    peek: function (ctx, at) {
      noise(ctx, at, 0.25, 'bandpass', 1500, 1.4, 0.12, 0.08, 3200);
      tone(ctx, at, 520, 780, 0.08, 0.16, 'triangle');
    },
    sink: function (ctx, at) {
      noise(ctx, at, 0.2, 'bandpass', 2600, 1.4, 0.1, 0.05, 1100);
      tone(ctx, at + 0.16, 130, 70, 0.3, 0.14);
    },
    // The record pulled all the way out, with a whoosh.
    pop: function (ctx, at) {
      noise(ctx, at, 0.08, 'bandpass', 1800, 1.5, 0.6, 0.002);
      tone(ctx, at, 300, 900, 0.25, 0.12, 'triangle');
      noise(ctx, at + 0.05, 0.7, 'bandpass', 500, 1.2, 0.18, 0.25, 4000);
    },
    reveal: function (ctx, at) {
      tone(ctx, at, 90, 45, 0.45, 0.6);
      chime(ctx, at + 0.05, [784, 988, 1175, 1568, 1976], 0.05);
      for (var i = 0; i < 8; i += 1) {
        var sparkle = [3136, 3951, 4699, 5274][Math.floor(Math.random() * 4)];
        tone(ctx, at + 0.5 + i * 0.09 + Math.random() * 0.04, sparkle, sparkle, 0.02, 0.25);
      }
    },
  };

  function sound(name, delay, level) {
    var ctx = wallet.audioContext();
    if (!ctx) {
      return;
    }
    SOUNDS[name](ctx, ctx.currentTime + (delay || 0), level === undefined ? 1 : level);
  }

  /* ------------------------------------------------------------ username */

  function profile() {
    var cached = MusicHub.storage.read('spotifyProfile', null);
    return cached && cached.displayName ? cached : { displayName: 'Your name', imageUrl: null };
  }

  /** A stand-in for the navbar's profile pill, wearing `style`. */
  function namePill(style) {
    var me = profile();
    var pill = el('span', 'name-pill');
    pill.dataset.nameStyle = style;
    if (me.imageUrl) {
      var avatar = el('img', 'name-pill__avatar');
      avatar.src = me.imageUrl;
      avatar.alt = '';
      pill.appendChild(avatar);
    } else {
      pill.appendChild(el('span', 'name-pill__avatar name-pill__avatar--blank'));
    }
    pill.appendChild(el('span', 'name-pill__name', me.displayName));
    return pill;
  }

  function usernameCard(item) {
    var id = 'username:' + item.id;
    var owned = wallet.owns(id);
    var worn = wallet.equipped('username') === item.id;
    var affordable = wallet.balance() >= item.price;

    var card = el('article', 'store-item');
    card.dataset.item = item.id;
    card.classList.toggle('store-item--locked', !owned);
    card.classList.toggle('store-item--short', !owned && !affordable);
    card.classList.toggle('store-item--equipped', worn);

    var preview = el('div', 'store-item__preview');
    preview.appendChild(namePill(item.id));
    if (!owned) {
      preview.appendChild(lock());
    }
    if (worn) {
      preview.appendChild(el('span', 'store-item__badge', 'Equipped'));
    }
    card.appendChild(preview);

    var body = el('div', 'store-item__body');
    body.appendChild(el('h3', 'store-item__title', item.name));
    body.appendChild(el('p', 'store-item__text', item.text));

    var footer = el('div', 'store-item__footer');
    var button;
    if (!owned) {
      footer.appendChild(price(item.price));
      button = el('button', 'button button--primary store-item__action', 'Buy');
      button.disabled = !affordable;
      button.addEventListener('click', function () {
        buyUsername(item, card);
      });
    } else {
      button = el('button', 'button ' + (worn ? 'button--ghost' : 'button--primary') + ' store-item__action', worn ? 'Unequip' : 'Equip');
      button.addEventListener('click', function () {
        wallet.equip('username', worn ? null : item.id);
        renderUsernames(item.id);
      });
    }
    button.type = 'button';
    button.setAttribute('aria-label', button.textContent + ' ' + item.name);
    footer.appendChild(button);
    body.appendChild(footer);
    card.appendChild(body);
    return card;
  }

  /** Redraws the username cards; `focusId`'s button keeps the focus. */
  function renderUsernames(focusId) {
    USERNAME_ITEMS.forEach(function (item) {
      if (unlocking[item.id]) {
        return;
      }
      var fresh = usernameCard(item);
      var old = els.usernames.querySelector('[data-item="' + item.id + '"]');
      if (old) {
        els.usernames.replaceChild(fresh, old);
      } else {
        els.usernames.appendChild(fresh);
      }
      if (focusId === item.id) {
        fresh.querySelector('.store-item__action').focus();
      }
    });
  }

  function buyUsername(item, card) {
    if (unlocking[item.id]) {
      return;
    }
    // Marked first: the purchase's walletchange would otherwise redraw this
    // card, and the unlock would play on one no longer on the page.
    unlocking[item.id] = true;
    if (!wallet.buy('username:' + item.id, item.price)) {
      delete unlocking[item.id];
      renderUsernames();
      return;
    }
    card.querySelector('.store-item__action').disabled = true;
    unlockAnimation(card).then(function () {
      delete unlocking[item.id];
      renderUsernames(item.id);
    });
  }

  /**
   * The lock on a bought item: it strains and rattles, the shackle springs
   * up and swings open, the lock lifts away and fades, and the item behind
   * it lights up with a shine sweeping across.
   */
  function unlockAnimation(card) {
    var lockNode = card.querySelector('.store-lock');
    var preview = card.querySelector('.store-item__preview');
    card.classList.add('store-item--unlocking');
    if (reducedMotion() || !lockNode || !lockNode.animate) {
      sound('unlockOpen');
      return wait(400);
    }
    var shackle = lockNode.querySelector('.store-lock__shackle');

    sound('unlockShake');
    return play(lockNode, [
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(-7deg)', offset: 0.15 },
      { transform: 'rotate(6deg)', offset: 0.3 },
      { transform: 'rotate(-9deg) scale(1.05)', offset: 0.5 },
      { transform: 'rotate(8deg) scale(1.05)', offset: 0.7 },
      { transform: 'rotate(-4deg) scale(1.08)', offset: 0.85 },
      { transform: 'rotate(0deg) scale(1.1)' },
    ], { duration: UNLOCK_SHAKE_MS, easing: 'ease-in-out', fill: 'forwards' }).then(function () {
      sound('unlockOpen');
      lockNode.classList.add('store-lock--open');
      return Promise.all([
        // Up out of the body, then swung open about its right leg.
        play(shackle, [
          { transform: 'translateY(0) rotate(0deg)' },
          { transform: 'translateY(-3.5px) rotate(0deg)', offset: 0.35 },
          { transform: 'translateY(-3.5px) rotate(-35deg)' },
        ], { duration: UNLOCK_OPEN_MS, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'forwards' }),
        play(lockNode, [
          { transform: 'rotate(0deg) scale(1.1)', filter: 'brightness(1)' },
          { transform: 'rotate(0deg) scale(1.2)', filter: 'brightness(1.8)' },
        ], { duration: UNLOCK_OPEN_MS, easing: 'ease-out', fill: 'forwards' }),
      ]);
    }).then(function () {
      return play(lockNode, [
        { transform: 'scale(1.2) translateY(0)', opacity: 1 },
        { transform: 'scale(1.6) translateY(-18px)', opacity: 0 },
      ], { duration: UNLOCK_AWAY_MS, easing: 'ease-in', fill: 'forwards' });
    }).then(function () {
      card.classList.add('store-item--revealed');
      return play(preview, [
        { filter: 'brightness(0.45) saturate(0.4)', transform: 'scale(0.96)' },
        { filter: 'brightness(1.5) saturate(1.3)', transform: 'scale(1.03)', offset: 0.45 },
        { filter: 'brightness(1) saturate(1)', transform: 'scale(1)' },
      ], { duration: UNLOCK_REVEAL_MS, easing: 'ease-out' });
    });
  }

  /* --------------------------------------------------------------- vinyl */

  function renderVinylOffer() {
    var owned = wallet.vinyls().length;
    var left = MusicHub.vinylCatalog.size - owned;
    var affordable = wallet.balance() >= VINYL_PRICE;
    els.vinylPrice.textContent = '';
    els.vinylPrice.appendChild(price(VINYL_PRICE));

    var soldOut = left <= 0;
    els.vinylOffer.classList.toggle('store-item--short', !soldOut && !affordable);
    els.vinylLock.hidden = soldOut || affordable;
    els.unboxButton.disabled = unboxing || soldOut || !affordable;
    els.unboxLabel.textContent = soldOut ? 'Collection complete' : 'Unbox';
  }

  /* -------------------------------------------------------- album picker */

  // What the picker's search box holds, as typed.
  var pickerQuery = '';

  /** The album history, newest first, as the vinyl's album: { id, name, artist, imageUrl, spotifyUrl }. */
  function historyAlbums() {
    var stored = MusicHub.storage.read(HISTORY_KEY, null);
    var listened = stored && Array.isArray(stored.listened) ? stored.listened : [];
    return listened.slice().sort(function (a, b) {
      return String(b.listenedAt || '').localeCompare(String(a.listenedAt || ''));
    }).map(function (entry) {
      return {
        id: entry.spotifyAlbumId,
        name: entry.albumName,
        artist: entry.artistName,
        imageUrl: entry.imageUrl || null,
        spotifyUrl: entry.spotifyUrl || null,
      };
    }).filter(function (album) {
      return album.id && album.name;
    });
  }

  function searchable(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  /** Album or artist, ignoring case and accents; every word has to match. */
  function matchesPicker(album) {
    var haystack = searchable(album.name + ' ' + album.artist);
    return searchable(pickerQuery).split(/\s+/).filter(Boolean).every(function (word) {
      return haystack.indexOf(word) !== -1;
    });
  }

  function renderPicker() {
    var albums = historyAlbums();
    var shown = albums.filter(matchesPicker);
    els.pickerList.textContent = '';
    els.pickerSearchWrap.hidden = !albums.length;
    els.pickerSearchClear.hidden = !pickerQuery;
    els.pickerEmpty.textContent = '';
    els.pickerEmpty.hidden = shown.length > 0;
    if (!albums.length) {
      els.pickerEmpty.appendChild(document.createTextNode('Your album history is empty. Mark an album as listened on '));
      var link = el('a', null, 'Albums');
      link.href = '/album-suggester';
      els.pickerEmpty.appendChild(link);
      els.pickerEmpty.appendChild(document.createTextNode(' first - then it can be pressed on a vinyl.'));
    } else if (!shown.length) {
      els.pickerEmpty.textContent = 'No albums match \u201c' + pickerQuery.trim() + '\u201d.';
    }

    shown.forEach(function (album) {
      var item = el('li');
      var button = el('button', 'album-picker__item');
      button.type = 'button';
      if (album.imageUrl) {
        var image = el('img', 'album-picker__cover');
        image.src = album.imageUrl;
        image.alt = '';
        image.loading = 'lazy';
        button.appendChild(image);
      } else {
        button.appendChild(el('span', 'album-picker__cover'));
      }
      var text = el('span', 'album-picker__text');
      text.appendChild(el('span', 'album-picker__name', album.name));
      text.appendChild(el('span', 'album-picker__artist', album.artist));
      button.appendChild(text);
      button.addEventListener('click', function () {
        els.picker.close();
        unbox(album);
      });
      item.appendChild(button);
      els.pickerList.appendChild(item);
    });
  }

  /** Unbox clicked: first, which album the vinyl is for. */
  function openPicker() {
    if (unboxing || wallet.balance() < VINYL_PRICE) {
      renderVinylOffer();
      return;
    }
    pickerQuery = '';
    els.pickerSearch.value = '';
    renderPicker();
    els.picker.showModal();
    var first = els.pickerList.querySelector('button');
    if (first && !els.pickerSearchWrap.hidden) {
      els.pickerSearch.focus();
    } else {
      els.pickerCancel.focus();
    }
  }

  function setPickerQuery(value) {
    pickerQuery = value;
    els.pickerSearch.value = value;
    renderPicker();
  }

  var BOX_TIMINGS = {
    drop: 520,
    // One hop while it waits to be opened, and the pause before the next.
    jump: 480,
    rest: 700,
    // The opening: the lid sliding off, a pause, the record peeking out,
    // holding there and ducking back in - then it's the user who pulls it
    // out.
    lid: 600,
    beforePeek: 180,
    peek: 380,
    peekHold: 520,
    sink: 300,
    // Let go short of PULL_ENOUGH: back to peeking. Past it (or a key):
    // the rest of the way out, quicker the further it already is.
    snapBack: 260,
    finishMin: 220,
    finishMax: 600,
  };

  // How far up (a share of the record's height) the pointer drags the
  // record all the way out, and how much of that is enough to let go.
  var PULL_DISTANCE = 0.6;
  var PULL_ENOUGH = 0.5;

  var HINTS = {
    open: 'Click to open',
    drag: 'Drag the vinyl out',
  };

  // Settles the wait for the box to be clicked (see waitForOpen).
  var openRequest = null;

  function resetStage() {
    els.stage.className = 'unbox__stage';
    els.record.textContent = '';
    els.result.hidden = true;
    els.hint.hidden = true;
    els.box.disabled = true;
    openRequest = null;
    // What the last drag left behind.
    [els.record, els.box, els.rays].forEach(function (node) {
      node.style.transform = '';
      node.style.opacity = '';
    });
    [els.box, els.lid, els.rays, els.record, els.stage].forEach(function (node) {
      if (node.getAnimations) {
        // Only the last unboxing's scripted animations - cancelling a CSS
        // one (the rays' spin) would stop it for good.
        node.getAnimations().forEach(function (animation) {
          if (Object.getPrototypeOf(animation) === Animation.prototype) {
            animation.cancel();
          }
        });
      }
    });
  }

  // Bumped when an unboxing is cancelled, so its remaining steps stop.
  var unboxRun = 0;
  var stopJumping = function () {};
  // Whether this unboxing has been paid for - only once the box is opened.
  var paid = false;

  /**
   * An album picked for the new vinyl: the box comes out and waits to be
   * opened. Nothing is paid or picked yet - that happens when it's opened
   * (payForVinyl), so closing the dialog before then costs nothing.
   */
  function unbox(album) {
    if (unboxing) {
      return;
    }
    if (!MusicHub.vinylCatalog.pick(wallet.vinyls(), { cover: !!album.imageUrl }) || wallet.balance() < VINYL_PRICE) {
      renderVinylOffer();
      return;
    }
    unboxing = true;
    paid = false;
    var run = ++unboxRun;
    renderVinylOffer();

    resetStage();
    // The app's purple until the record is known; then its own colours.
    els.dialog.style.removeProperty('--record-glow');
    els.dialog.style.removeProperty('--record-accent');
    els.dialog.showModal();

    // With reduced motion, the box just sits there until it's clicked,
    // then the record is shown.
    var motion = !reducedMotion() && !!els.box.animate;
    (motion ? dropBox() : Promise.resolve()).then(function () {
      if (run !== unboxRun) {
        return;
      }
      stopJumping = motion ? keepJumping() : function () {};
      waitForOpen().then(function () {
        stopJumping();
        var record = payForVinyl(album);
        if (!record) {
          // The coins ran short meanwhile (spent in another tab).
          cancelUnbox();
          return;
        }
        (motion ? openBox() : Promise.resolve()).then(function () {
          sound('reveal');
          els.stage.classList.add('unbox__stage--revealed');
          MusicHub.vinyl.setPlaying(record, true);
          els.result.hidden = false;
          unboxing = false;
          renderVinylOffer();
          els.resultClose.focus();
        });
      });
    });
  }

  /**
   * The box has been opened: picks the record, pays for it and puts it in
   * the collection - pressed for `album`, whose cover is its label - and
   * places it inside the box ready to rise out. Returns the record's
   * element, or null when it can't be paid for.
   */
  function payForVinyl(album) {
    var vinyl = MusicHub.vinylCatalog.pick(wallet.vinyls(), { cover: !!album.imageUrl });
    if (!vinyl) {
      return null;
    }
    vinyl.album = album;
    if (!wallet.unboxVinyl(vinyl, VINYL_PRICE)) {
      return null;
    }
    paid = true;
    var spec = MusicHub.vinyl.describe(vinyl.format);
    var record = MusicHub.vinyl.render(spec, { seed: vinyl.seed, imageUrl: album.imageUrl });
    els.record.appendChild(record);
    var glow = MusicHub.vinyl.glowColors(spec);
    els.dialog.style.setProperty('--record-glow', glow.glow);
    els.dialog.style.setProperty('--record-accent', glow.accent);
    els.resultName.textContent = vinyl.format;
    els.resultAlbum.textContent = album.name + ' \u2014 ' + album.artist;
    els.resultFamily.textContent = vinyl.family;
    return record;
  }

  /** Closes an unboxing that hasn't been opened - and so hasn't cost anything. */
  function cancelUnbox() {
    unboxRun += 1;
    stopJumping();
    stopJumping = function () {};
    openRequest = null;
    unboxing = false;
    if (els.dialog.open) {
      els.dialog.close();
    }
    renderVinylOffer();
    els.unboxButton.focus();
  }

  /** The mystery box dropping in and landing with a thud. */
  function dropBox() {
    sound('thud', BOX_TIMINGS.drop / 1000 * 0.8, 0.8);
    return play(els.box, [
      { transform: 'translateY(-120%) scale(0.9)', opacity: 0 },
      { transform: 'translateY(4%) scale(1.02, 0.96)', opacity: 1, offset: 0.75 },
      { transform: 'translateY(0) scale(1)', opacity: 1 },
    ], { duration: BOX_TIMINGS.drop, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' });
  }

  /** Resolves once the box is clicked (or Enter / Space on it - it's a button). */
  function waitForOpen() {
    els.box.disabled = false;
    els.hint.textContent = HINTS.open;
    els.hint.hidden = false;
    els.box.focus({ preventScroll: true });
    return new Promise(function (resolve) {
      openRequest = resolve;
    });
  }

  function onBoxClick() {
    if (!openRequest) {
      return;
    }
    var open = openRequest;
    openRequest = null;
    els.box.disabled = true;
    els.hint.hidden = true;
    open();
  }

  /**
   * While it waits to be opened, the box hops again and again - crouching,
   * jumping with a wobble and landing squashed - while something rattles
   * inside. Returns a function that stops it.
   */
  function keepJumping() {
    var jumping = true;
    var current = null;
    var timer = null;

    function jump() {
      if (!jumping) {
        return;
      }
      sound('rattle', 0.08, 0.7);
      sound('thud', BOX_TIMINGS.jump / 1000 * 0.82, 0.45);
      current = els.box.animate([
        { transform: 'translateY(0) rotate(0deg) scale(1)' },
        { transform: 'translateY(2%) rotate(0deg) scale(1.05, 0.93)', offset: 0.14 },
        { transform: 'translateY(-18%) rotate(-5deg) scale(0.97, 1.04)', offset: 0.42 },
        { transform: 'translateY(-12%) rotate(4deg) scale(1)', offset: 0.62 },
        { transform: 'translateY(1%) rotate(0deg) scale(1.05, 0.94)', offset: 0.84 },
        { transform: 'translateY(0) rotate(0deg) scale(1)' },
      ], { duration: BOX_TIMINGS.jump, easing: 'ease-in-out' });
      current.onfinish = function () {
        current = null;
        timer = window.setTimeout(jump, BOX_TIMINGS.rest);
      };
    }

    timer = window.setTimeout(jump, 250);
    return function stop() {
      jumping = false;
      window.clearTimeout(timer);
      if (current) {
        current.cancel();
      }
    };
  }

  /*
   * Where the record sits, as a move from its full-size spot: hidden right
   * inside the box, peeking out over the rim, and out (0, full size).
   */
  var RECORD_INSIDE = { y: 41, scale: 0.66 };
  var RECORD_PEEK = { y: 19, scale: 0.66 };

  function recordPose(pose) {
    return 'translateY(' + pose.y.toFixed(2) + '%) scale(' + pose.scale.toFixed(3) + ')';
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Opening the box: the lid slides off, the record peeks out over the rim
   * and ducks back in - then waits for the user to drag it out (dragOut).
   */
  function openBox() {
    var t = BOX_TIMINGS;
    sound('slide');
    return play(els.lid, [
      { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
      { transform: 'translate(-6%, 0) rotate(-1deg)', opacity: 1, offset: 0.2 },
      { transform: 'translate(90%, -8%) rotate(8deg)', opacity: 1, offset: 0.75 },
      { transform: 'translate(135%, 10%) rotate(18deg)', opacity: 0 },
    ], { duration: t.lid, easing: 'ease-in', fill: 'forwards' }).then(function () {
      return wait(t.beforePeek);
    }).then(function () {
      sound('peek');
      MusicHub.vinyl.setPlaying(els.record.firstChild, true);
      // Shown only now, in the same frame its first move puts it inside the
      // box - any earlier and it would flash up at its final spot.
      els.stage.classList.add('unbox__stage--open', 'unbox__stage--spinning');
      return play(els.record, [
        { transform: recordPose(RECORD_INSIDE) },
        { transform: recordPose(RECORD_PEEK) },
      ], { duration: t.peek, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1.2)', fill: 'forwards' });
    }).then(function () {
      return wait(t.peekHold);
    }).then(function () {
      sound('sink');
      // The box gives a little bounce as the record drops back in.
      play(els.box, [
        { transform: 'translateY(0) scale(1)' },
        { transform: 'translateY(2%) scale(1.04, 0.95)', offset: 0.5 },
        { transform: 'translateY(0) scale(1)' },
      ], { duration: 260, delay: t.sink * 0.7, easing: 'ease-out' });
      return play(els.record, [
        { transform: recordPose(RECORD_PEEK) },
        { transform: recordPose(RECORD_INSIDE) },
      ], { duration: t.sink, easing: 'ease-in', fill: 'forwards' });
    }).then(function () {
      // Let the bounce finish before the drag takes over the box.
      return wait(200);
    }).then(dragOut);
  }

  /**
   * Hands a node over from its scripted animations to a plain inline
   * style, which the drag can then move frame by frame.
   */
  function settle(node, transform) {
    node.getAnimations().forEach(function (animation) {
      if (Object.getPrototypeOf(animation) === Animation.prototype) {
        animation.cancel();
      }
    });
    node.style.transform = transform;
  }

  /**
   * The record `pull` of the way out (0 inside the box, 1 all the way): it grows
   * to full size as it rises, the box falls away faster and faster and the
   * light comes up behind it.
   */
  function applyPull(pull) {
    els.record.style.transform = recordPose({
      y: lerp(RECORD_INSIDE.y, 0, pull),
      scale: lerp(RECORD_INSIDE.scale, 1, pull),
    });
    var fall = pull * pull;
    els.box.style.transform = 'translateY(' + (fall * 90).toFixed(1) + '%) rotate(' + (fall * 8).toFixed(2) + 'deg)';
    els.box.style.opacity = String(1 - fall * pull);
    els.rays.style.opacity = String(pull);
    els.rays.style.transform = 'scale(' + (0.4 + 0.6 * pull).toFixed(3) + ')';
  }

  /** Runs `apply` from `from` to `to` over `ms`, easing out; resolves at the end. */
  function tween(from, to, ms, apply) {
    return new Promise(function (resolve) {
      var start = null;
      function frame(now) {
        start = start === null ? now : start;
        var t = Math.min(1, (now - start) / ms);
        apply(lerp(from, to, 1 - Math.pow(1 - t, 3)));
        if (t < 1) {
          window.requestAnimationFrame(frame);
        } else {
          resolve();
        }
      }
      window.requestAnimationFrame(frame);
    });
  }

  /**
   * The record, back inside the box, waits to be dragged out, and follows
   * the pointer up while the box falls away. Let go past PULL_ENOUGH (or press Enter, Space or
   * Arrow Up on it) and it comes the rest of the way; short of that it
   * slides back in. Resolves once it's out.
   */
  function dragOut() {
    settle(els.record, recordPose(RECORD_INSIDE));
    settle(els.box, 'none');
    els.stage.classList.add('unbox__stage--grab');
    els.hint.textContent = HINTS.drag;
    els.hint.hidden = false;
    els.record.tabIndex = 0;
    els.record.setAttribute('role', 'button');
    els.record.setAttribute('aria-label', 'Pull the vinyl out of the box');
    els.record.focus({ preventScroll: true });

    return new Promise(function (resolve) {
      var pull = 0;
      var pointer = null;
      var startY = 0;
      var done = false;
      // Tweening back after a short pull; a new grab takes over from it.
      var snapping = 0;

      function onDown(event) {
        if (pointer !== null || done) {
          return;
        }
        event.preventDefault();
        pointer = event.pointerId;
        snapping += 1;
        // From wherever it is now, so a grab mid-snap-back doesn't jump.
        startY = event.clientY + pull * els.record.offsetHeight * PULL_DISTANCE;
        els.record.setPointerCapture(pointer);
        els.stage.classList.add('unbox__stage--dragging');
      }

      function pullAt(clientY) {
        return Math.max(0, Math.min(1, (startY - clientY) / (els.record.offsetHeight * PULL_DISTANCE)));
      }

      function onMove(event) {
        if (event.pointerId !== pointer) {
          return;
        }
        pull = pullAt(event.clientY);
        applyPull(pull);
        if (pull >= 1) {
          finish();
        }
      }

      function onUp(event) {
        if (event.pointerId !== pointer) {
          return;
        }
        pointer = null;
        // Where it was let go counts too, should no move have come in between.
        if (event.type === 'pointerup') {
          pull = Math.max(pull, pullAt(event.clientY));
        }
        els.stage.classList.remove('unbox__stage--dragging');
        if (pull >= PULL_ENOUGH) {
          finish();
          return;
        }
        if (pull > 0.02) {
          sound('sink');
        }
        var run = ++snapping;
        tween(pull, 0, BOX_TIMINGS.snapBack, function (value) {
          if (run === snapping) {
            pull = value;
            applyPull(value);
          }
        });
      }

      function onKey(event) {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowUp') {
          event.preventDefault();
          finish();
        }
      }

      function finish() {
        if (done) {
          return;
        }
        done = true;
        snapping += 1;
        els.record.removeEventListener('pointerdown', onDown);
        els.record.removeEventListener('pointermove', onMove);
        els.record.removeEventListener('pointerup', onUp);
        els.record.removeEventListener('pointercancel', onUp);
        els.record.removeEventListener('keydown', onKey);
        els.stage.classList.remove('unbox__stage--grab', 'unbox__stage--dragging');
        els.hint.hidden = true;
        els.record.removeAttribute('tabindex');
        els.record.removeAttribute('role');
        els.record.removeAttribute('aria-label');
        sound('pop');
        var t = BOX_TIMINGS;
        tween(pull, 1, lerp(t.finishMax, t.finishMin, pull), applyPull).then(function () {
          // A little pop as it comes free.
          return play(els.record, [
            { transform: recordPose({ y: 0, scale: 1 }) },
            { transform: recordPose({ y: -6, scale: 1.07 }), offset: 0.45 },
            { transform: recordPose({ y: 0, scale: 1 }) },
          ], { duration: 380, easing: 'ease-out' });
        }).then(resolve);
      }

      els.record.addEventListener('pointerdown', onDown);
      els.record.addEventListener('pointermove', onMove);
      els.record.addEventListener('pointerup', onUp);
      els.record.addEventListener('pointercancel', onUp);
      els.record.addEventListener('keydown', onKey);
    });
  }

  function closeUnbox() {
    if (unboxing) {
      return;
    }
    MusicHub.vinyl.setPlaying(els.record, false);
    els.dialog.close();
    els.unboxButton.focus();
  }

  /* ---------------------------------------------------------------- init */

  function render() {
    renderUsernames();
    renderVinylOffer();
  }

  /*
   * Straight away rather than on DOMContentLoaded: this script sits at the
   * end of the page, so everything it needs is already there, and the
   * username cards appear with the rest of the page instead of after it.
   */
  (function init() {
    els.usernames = document.getElementById('username-items');
    els.vinylOffer = document.getElementById('vinyl-offer');
    els.vinylLock = document.getElementById('vinyl-lock');
    els.vinylPrice = document.getElementById('vinyl-price');
    els.unboxButton = document.getElementById('unbox-button');
    els.unboxLabel = document.getElementById('unbox-label');
    els.dialog = document.getElementById('unbox-dialog');
    els.stage = document.getElementById('unbox-stage');
    els.box = document.getElementById('unbox-box');
    els.lid = document.getElementById('unbox-lid');
    els.rays = document.getElementById('unbox-rays');
    els.record = document.getElementById('unbox-record');
    els.result = document.getElementById('unbox-result');
    els.resultName = document.getElementById('unbox-name');
    els.resultFamily = document.getElementById('unbox-family');
    els.resultClose = document.getElementById('unbox-close');
    els.resultAlbum = document.getElementById('unbox-album');
    els.picker = document.getElementById('album-picker');
    els.pickerSearchWrap = document.getElementById('album-picker-search-wrap');
    els.pickerSearch = document.getElementById('album-picker-search');
    els.pickerSearchClear = document.getElementById('album-picker-search-clear');
    els.pickerList = document.getElementById('album-picker-list');
    els.pickerEmpty = document.getElementById('album-picker-empty');
    els.pickerCancel = document.getElementById('album-picker-cancel');
    els.hint = document.getElementById('unbox-hint');

    els.unboxButton.addEventListener('click', openPicker);
    els.pickerSearch.addEventListener('input', function () {
      setPickerQuery(els.pickerSearch.value);
    });
    els.pickerSearchClear.addEventListener('click', function () {
      setPickerQuery('');
      els.pickerSearch.focus();
    });
    els.pickerCancel.addEventListener('click', function () {
      els.picker.close();
      els.unboxButton.focus();
    });
    els.resultClose.addEventListener('click', closeUnbox);
    els.box.addEventListener('click', onBoxClick);
    // A click on the backdrop - it lands on the dialog itself, outside its
    // box - closes it too, but only once the record is fully out.
    els.dialog.addEventListener('click', function (event) {
      if (event.target !== els.dialog || unboxing || els.result.hidden) {
        return;
      }
      var rect = els.dialog.getBoundingClientRect();
      var inside = event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) {
        closeUnbox();
      }
    });
    // Escape: before the box is opened it cancels, free of charge; while
    // it's opening, nothing; afterwards, the same as Close.
    els.dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      if (unboxing && !paid) {
        cancelUnbox();
      } else {
        closeUnbox();
      }
    });

    render();
  })();

  document.addEventListener('musichub:walletchange', render);
  // The profile pill in the previews shows the Spotify name once it's in.
  document.addEventListener('musichub:authchange', function () {
    if (els.usernames) {
      renderUsernames();
    }
  });

})(window.MusicHub);
