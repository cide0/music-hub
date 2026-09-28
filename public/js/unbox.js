/*
 * The Mystery Vinyl's unboxing: which album from the album history the
 * record is pressed for (the album picker), then a mailer box that drops
 * in, hops until it's clicked, and gives up a random record the collection
 * doesn't have yet - drawn by vinyl.js - which the user drags out. Started
 * by the Store - for coins, or free for a mystery vinyl won on the Daily
 * Spin. On every page, because the Daily Spin also uses the album picker
 * to press a wheel exclusive; markup in views/partials/unbox.ejs.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var VINYL_PRICE = 1000;
  // The Album Suggester's album history (album-suggester.js), which the
  // album picker lists - read here, never written.
  var HISTORY_KEY = 'albumSuggesterHistory';

  var wallet = MusicHub.wallet;
  var els = {};
  var unboxing = false;
  // Where the focus goes back to once the unboxing is closed.
  var returnFocus = null;

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

  /** Whether the next unboxing is one won on the Daily Spin, rather than bought. */
  function free() {
    return wallet.wheel().freeVinyls > 0;
  }

  /** Whether an unboxing can start now: a free one waiting, or the coins for one. */
  function affordable() {
    return free() || wallet.balance() >= VINYL_PRICE;
  }

  function changed() {
    document.dispatchEvent(new CustomEvent('musichub:unboxchange', { detail: { unboxing: unboxing } }));
  }

  function restoreFocus() {
    if (returnFocus && document.contains(returnFocus) && typeof returnFocus.focus === 'function') {
      returnFocus.focus();
    }
    returnFocus = null;
  }

  /* --------------------------------------------------------------- sound */

  var sfx = MusicHub.sfx;

  /*
   * The mystery box's thuds, rattles, pop and chime, synthesised through
   * the wallet's audio context like the coins.
   */
  var SOUNDS = {
    // The box landing, and every shake after it.
    thud: function (ctx, at, level) {
      sfx.tone(ctx, at, 140, 60, 0.5 * level, 0.2);
      sfx.noise(ctx, at, 0.09, 'lowpass', 900, 0.7, 0.35 * level, 0.002);
    },
    // Something loose inside, rattling against the cardboard.
    rattle: function (ctx, at, level) {
      for (var i = 0; i < 4; i += 1) {
        sfx.noise(ctx, at + i * 0.045 + Math.random() * 0.02, 0.04, 'bandpass', 1400 + Math.random() * 800, 3, 0.25 * level, 0.002);
      }
    },
    // The lid sliding off: cardboard dragged over cardboard.
    slide: function (ctx, at) {
      sfx.noise(ctx, at, 0.4, 'bandpass', 900, 0.9, 0.3, 0.12, 2400);
      sfx.noise(ctx, at + 0.3, 0.05, 'lowpass', 700, 0.7, 0.2, 0.003);
    },
    // The record peeking out, and slipping back in.
    peek: function (ctx, at) {
      sfx.noise(ctx, at, 0.25, 'bandpass', 1500, 1.4, 0.12, 0.08, 3200);
      sfx.tone(ctx, at, 520, 780, 0.08, 0.16, 'triangle');
    },
    sink: function (ctx, at) {
      sfx.noise(ctx, at, 0.2, 'bandpass', 2600, 1.4, 0.1, 0.05, 1100);
      sfx.tone(ctx, at + 0.16, 130, 70, 0.3, 0.14);
    },
    // The record pulled all the way out, with a whoosh.
    pop: function (ctx, at) {
      sfx.noise(ctx, at, 0.08, 'bandpass', 1800, 1.5, 0.6, 0.002);
      sfx.tone(ctx, at, 300, 900, 0.25, 0.12, 'triangle');
      sfx.noise(ctx, at + 0.05, 0.7, 'bandpass', 500, 1.2, 0.18, 0.25, 4000);
    },
    reveal: function (ctx, at) {
      sfx.tone(ctx, at, 90, 45, 0.45, 0.6);
      sfx.chime(ctx, at + 0.05, [784, 988, 1175, 1568, 1976], 0.05);
      for (var i = 0; i < 8; i += 1) {
        var sparkle = [3136, 3951, 4699, 5274][Math.floor(Math.random() * 4)];
        sfx.tone(ctx, at + 0.5 + i * 0.09 + Math.random() * 0.04, sparkle, sparkle, 0.02, 0.25);
      }
    },
  };

  function sound(name, delay, level) {
    sfx.play(SOUNDS, name, delay, level);
  }

  /**
   * The waiting box's hop, for a box shaken elsewhere - the Store's offer,
   * jiggling while Unbox is hovered: something rattling inside, then the
   * landing `landAt` s later. Only once the page has had a click or a key:
   * before that the browser holds the sound back, and would play every
   * rattle held back at once when it's finally let go.
   */
  function rattle(landAt) {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) {
      return;
    }
    sound('rattle', 0.08, 0.7);
    sound('thud', landAt, 0.45);
  }

  /* -------------------------------------------------------- album picker */

  // What the picker's search box holds, as typed.
  var pickerQuery = '';
  // Settles the open picker's promise (see pickAlbum).
  var pickerDone = null;

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
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
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
      var link = el('a', 'page-link', 'Albums');
      link.href = '/album-suggester';
      els.pickerEmpty.appendChild(link);
      els.pickerEmpty.appendChild(document.createTextNode(' first - then it can be pressed on a vinyl.'));
    } else if (!shown.length) {
      els.pickerEmpty.textContent = 'No albums match “' + pickerQuery.trim() + '”.';
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
        settlePicker(album);
      });
      item.appendChild(button);
      els.pickerList.appendChild(item);
    });
  }

  function setPickerQuery(value) {
    pickerQuery = value;
    els.pickerSearch.value = value;
    renderPicker();
  }

  var PICKER_HINT = 'Your new vinyl is pressed for one of the albums in your album history - its cover goes on the sleeve and the record’s label.';

  /**
   * Asks which album from the album history a record is pressed for.
   * Resolves with the album, or null when the picker is closed without one.
   * `options.hint` replaces the explanation under the title.
   */
  function pickAlbum(options) {
    if (pickerDone) {
      return Promise.resolve(null);
    }
    pickerQuery = '';
    els.pickerSearch.value = '';
    els.pickerHint.textContent = (options && options.hint) || PICKER_HINT;
    renderPicker();
    els.picker.showModal();
    var first = els.pickerList.querySelector('button');
    if (first && !els.pickerSearchWrap.hidden) {
      els.pickerSearch.focus();
    } else {
      els.pickerCancel.focus();
    }
    return new Promise(function (resolve) {
      pickerDone = resolve;
    });
  }

  function settlePicker(album) {
    var done = pickerDone;
    pickerDone = null;
    if (els.picker.open) {
      els.picker.close();
    }
    if (done) {
      done(album || null);
    }
  }

  /* --------------------------------------------------------------- unbox */

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
    els.resultClose.hidden = true;
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
    if (!MusicHub.vinylCatalog.pick(wallet.vinyls(), { cover: !!album.imageUrl }) || !affordable()) {
      restoreFocus();
      return;
    }
    unboxing = true;
    paid = false;
    var run = ++unboxRun;
    changed();

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
          els.resultClose.hidden = false;
          unboxing = false;
          changed();
          els.resultCollection.focus();
        });
      });
    });
  }

  /**
   * The box has been opened: picks the record, pays for it - with a mystery
   * vinyl won on the Daily Spin when there is one, coins otherwise - and
   * puts it in the collection, pressed for `album`, whose cover is its
   * label; then places it inside the box ready to rise out. Returns the
   * record's element, or null when it can't be paid for.
   */
  function payForVinyl(album) {
    var vinyl = MusicHub.vinylCatalog.pick(wallet.vinyls(), { cover: !!album.imageUrl });
    if (!vinyl) {
      return null;
    }
    vinyl.album = album;
    if (!wallet.unboxVinyl(vinyl, VINYL_PRICE, { free: free() })) {
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
    els.resultAlbum.textContent = album.name + ' — ' + album.artist;
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
    changed();
    restoreFocus();
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
    restoreFocus();
  }

  /**
   * Starts a Mystery Vinyl: the album picker, then the unboxing - free when
   * a mystery vinyl from the Daily Spin is waiting, VINYL_PRICE coins
   * otherwise. Nothing is spent until the box is opened. Resolves false when
   * it couldn't start (already running, nothing to pay with, or the
   * collection holds every record).
   */
  function start() {
    if (unboxing || pickerDone || !affordable()) {
      return Promise.resolve(false);
    }
    returnFocus = document.activeElement;
    return pickAlbum().then(function (album) {
      if (!album) {
        restoreFocus();
        return false;
      }
      unbox(album);
      return unboxing;
    });
  }

  /* ---------------------------------------------------------------- init */

  (function init() {
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
    els.resultCollection = document.getElementById('unbox-collection');
    els.resultAlbum = document.getElementById('unbox-album');
    els.picker = document.getElementById('album-picker');
    els.pickerHint = document.getElementById('album-picker-hint');
    els.pickerSearchWrap = document.getElementById('album-picker-search-wrap');
    els.pickerSearch = document.getElementById('album-picker-search');
    els.pickerSearchClear = document.getElementById('album-picker-search-clear');
    els.pickerList = document.getElementById('album-picker-list');
    els.pickerEmpty = document.getElementById('album-picker-empty');
    els.pickerCancel = document.getElementById('album-picker-cancel');
    els.hint = document.getElementById('unbox-hint');
    if (!els.dialog || !els.picker) {
      return;
    }

    els.pickerSearch.addEventListener('input', function () {
      setPickerQuery(els.pickerSearch.value);
    });
    els.pickerSearchClear.addEventListener('click', function () {
      setPickerQuery('');
      els.pickerSearch.focus();
    });
    els.pickerCancel.addEventListener('click', function () {
      settlePicker(null);
    });
    // Escape, or closed any other way: no album.
    els.picker.addEventListener('close', function () {
      settlePicker(null);
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
  })();

  MusicHub.unbox = {
    PRICE: VINYL_PRICE,
    start: start,
    pickAlbum: pickAlbum,
    rattle: rattle,
    free: free,
    affordable: affordable,
    busy: function () {
      return unboxing;
    },
  };
})(window.MusicHub);
