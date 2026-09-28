/*
 * The Store: coins earned on the Album Suggester buy username, navbar and
 * vinyl player styles (bought once, then equipped or taken off), mystery
 * vinyls - a random
 * record, drawn by vinyl.js like the Discogs page's, unboxed with an
 * animation (unbox.js) and never one the collection already holds - and
 * extra spins on the Daily Spin (daily-wheel.js).
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

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

  var NAVBAR_ITEMS = [
    {
      id: 'gold',
      name: 'Gold Navbar',
      price: 4000,
      text: 'The whole navbar in polished gold.',
    },
  ];

  // The Collection's record player (turntable.js).
  var PLAYER_ITEMS = [
    {
      id: 'gold',
      name: 'Gold Player',
      price: 4000,
      text: 'The Collection\u2019s record player in polished gold: a gold plinth with a shine sweeping across, a gold headshell and gold-lit buttons.',
    },
  ];

  // One more Daily Spin. Must match the first-paint check in store.ejs.
  var SPIN_PRICE = 3000;
  // The wheel's turns when a spin is bought.
  var SPIN_BOUGHT_MS = 1400;
  // The bought spin's flight up to the navbar's Daily Spin button: how
  // long, how much of it is the first burst up out of the card, and how
  // many points along the way it's drawn through.
  var SPIN_FLY_MS = 1150;
  var SPIN_BURST_SHARE = 0.25;
  var SPIN_FLY_STEPS = 36;
  // The navbar wheel's icon size (style.css, .navbar__actions .navbar__wheel svg).
  var NAVBAR_WHEEL_PX = 20;
  // The card's wheel ticks like the Daily Spin's each time one of its eight
  // spokes passes the top - at most one tick this often, as there.
  var SPOKE_DEGREES = 45;
  var TICK_GAP_MS = 28;

  // When the jiggling box settles: 58% of mailer-jiggle's 0.8s in style.css.
  var JIGGLE_SETTLE_S = 0.46;

  // The unlock, stage by stage (ms from the purchase).
  var UNLOCK_SHAKE_MS = 700;
  var UNLOCK_OPEN_MS = 600;
  var UNLOCK_AWAY_MS = 550;
  var UNLOCK_REVEAL_MS = 700;

  var wallet = MusicHub.wallet;
  var els = {};
  // "slot:id"s mid-unlock: left alone by re-renders until they're done.
  var unlocking = {};

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

  var sfx = MusicHub.sfx;

  /*
   * The lock springing open, synthesised through the wallet's audio
   * context like the coins.
   */
  var SOUNDS = {
    // The key turning: a small click, a tense rattle, then the shackle
    // springing open with a clack.
    unlockShake: function (ctx, at) {
      for (var i = 0; i < 5; i += 1) {
        sfx.noise(ctx, at + i * 0.13, 0.03, 'bandpass', 3200, 6, 0.18, 0.002);
      }
    },
    unlockOpen: function (ctx, at) {
      sfx.noise(ctx, at, 0.05, 'highpass', 2500, 0.8, 0.5, 0.001);
      sfx.noise(ctx, at, 0.12, 'bandpass', 3800, 12, 0.5, 0.001);
      sfx.tone(ctx, at, 240, 120, 0.3, 0.12);
      sfx.chime(ctx, at + 0.3, [1047, 1319, 1568, 2093], 0.05);
    },
    // A bought spin: a whoosh rising as the wheel flies off to the navbar...
    spinLaunch: function (ctx, at) {
      sfx.noise(ctx, at, 0.7, 'bandpass', 700, 1.4, 0.16, 0.25, 3000);
    },
    // ...and a click and a bright little chime as it lands on the button.
    spinLand: function (ctx, at) {
      sfx.noise(ctx, at, 0.04, 'highpass', 3000, 0.8, 0.35, 0.001);
      sfx.chime(ctx, at + 0.02, [1568, 2093], 0.06);
    },
  };

  function sound(name, delay, level) {
    sfx.play(SOUNDS, name, delay, level);
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

  /* -------------------------------------------------------------- navbar */

  /**
   * A small stand-in for the navbar, wearing `style`: the logo and name,
   * the active tab and the settings circle. It uses the navbar's
   * own classes, so it looks - and hovers - like the real one.
   */
  function navbarPreview(style) {
    var bar = el('div', 'navbar-preview');
    bar.dataset.navbarStyle = style;

    var brand = el('span', 'navbar__brand');
    var logo = el('img');
    logo.src = '/favicon.png';
    logo.alt = '';
    brand.appendChild(logo);
    brand.appendChild(el('span', 'navbar__label', 'Music Hub'));
    bar.appendChild(brand);

    var tab = el('span', 'navbar__tab navbar__tab--active');
    tab.appendChild(el('span', 'navbar__label', 'Albums'));
    bar.appendChild(tab);

    var settings = el('span', 'icon-button navbar-preview__settings');
    settings.appendChild(document.querySelector('.navbar__settings svg').cloneNode(true));
    bar.appendChild(settings);
    return bar;
  }

  /* -------------------------------------------------------------- player */

  /**
   * A small stand-in for the Collection's record player, wearing `style`:
   * turntable.js's own turntable, switched on, its needle on a record - so
   * it looks just like the real one.
   */
  function playerPreview(style) {
    var box = el('div', 'player-preview');
    box.dataset.playerStyle = style;
    var record = MusicHub.vinyl.render(MusicHub.vinyl.describe('Vinyl, LP, Black'), { seed: 'store-player' });
    record.classList.add('vinyl--house');
    MusicHub.vinyl.setPlaying(record, false);
    var parts = MusicHub.turntable.build(record, { trackButtons: true, glow: 'var(--rarity-gold)' });
    // Only a picture: its track buttons are no stops for the keyboard.
    parts.prev.tabIndex = -1;
    parts.next.tabIndex = -1;
    // Switched on, as it's shown.
    parts.power.classList.add('turntable__power--on');
    box.appendChild(parts.root);
    return box;
  }

  /* ---------------------------------------------------------- style items */

  // Each slot's items, the preview they're shown off in and their grid.
  var SLOTS = {
    username: { items: USERNAME_ITEMS, preview: namePill, grid: 'usernames' },
    navbar: { items: NAVBAR_ITEMS, preview: navbarPreview, grid: 'navbars' },
    player: { items: PLAYER_ITEMS, preview: playerPreview, grid: 'players' },
  };

  function styleCard(slot, item) {
    var id = slot + ':' + item.id;
    var owned = wallet.owns(id);
    var worn = wallet.equipped(slot) === item.id;
    var affordable = wallet.balance() >= item.price;

    var card = el('article', 'store-item');
    card.dataset.item = item.id;
    card.classList.toggle('store-item--locked', !owned);
    card.classList.toggle('store-item--short', !owned && !affordable);
    card.classList.toggle('store-item--equipped', worn);

    var preview = el('div', 'store-item__preview');
    preview.appendChild(SLOTS[slot].preview(item.id));
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
        buyStyle(slot, item, card);
      });
    } else {
      button = el('button', 'button ' + (worn ? 'button--ghost' : 'button--primary') + ' store-item__action', worn ? 'Unequip' : 'Equip');
      button.addEventListener('click', function () {
        wallet.equip(slot, worn ? null : item.id);
        renderStyles(slot, item.id);
      });
    }
    button.type = 'button';
    button.setAttribute('aria-label', button.textContent + ' ' + item.name);
    footer.appendChild(button);
    body.appendChild(footer);
    card.appendChild(body);
    return card;
  }

  /** Redraws `slot`'s cards; `focusId`'s button keeps the focus. */
  function renderStyles(slot, focusId) {
    var grid = els[SLOTS[slot].grid];
    SLOTS[slot].items.forEach(function (item) {
      if (unlocking[slot + ':' + item.id]) {
        return;
      }
      var fresh = styleCard(slot, item);
      var old = grid.querySelector('[data-item="' + item.id + '"]');
      if (old) {
        grid.replaceChild(fresh, old);
      } else {
        grid.appendChild(fresh);
      }
      if (focusId === item.id) {
        fresh.querySelector('.store-item__action').focus();
      }
    });
  }

  function buyStyle(slot, item, card) {
    var id = slot + ':' + item.id;
    if (unlocking[id]) {
      return;
    }
    // Marked first: the purchase's walletchange would otherwise redraw this
    // card, and the unlock would play on one no longer on the page.
    unlocking[id] = true;
    if (!wallet.buy(id, item.price)) {
      delete unlocking[id];
      renderStyles(slot);
      return;
    }
    card.querySelector('.store-item__action').disabled = true;
    unlockAnimation(card).then(function () {
      delete unlocking[id];
      renderStyles(slot, item.id);
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

  /**
   * The Mystery Vinyl offer: its price - or "Free" while one won on the
   * Daily Spin waits to be unboxed, with how many on a badge - and whether
   * it can be unboxed now.
   */
  function renderVinylOffer() {
    var unbox = MusicHub.unbox;
    var free = unbox.free();
    var affordable = unbox.affordable();
    els.vinylPrice.textContent = '';
    if (free) {
      els.vinylPrice.appendChild(el('span', 'price price--free', 'Free'));
    } else {
      els.vinylPrice.appendChild(price(unbox.PRICE));
    }

    var waiting = wallet.wheel().freeVinyls;
    els.vinylFree.hidden = waiting < 1;
    els.vinylFree.textContent = waiting + ' free to unbox';

    var soldOut = !MusicHub.vinylCatalog.pick(wallet.vinyls(), { cover: true });
    els.vinylOffer.classList.toggle('store-item--short', !soldOut && !affordable);
    els.vinylLock.hidden = soldOut || affordable;
    els.unboxButton.disabled = unbox.busy() || soldOut || !affordable;
    els.unboxLabel.textContent = soldOut ? 'Collection complete' : free ? 'Unbox free' : 'Unbox';
  }

  /* ---------------------------------------------------------------- spin */

  /** The spin offer: how many are left, and whether the coins reach. */
  function renderSpinOffer() {
    var left = wallet.wheel().respins;
    els.spinSaved.hidden = left < 1;
    els.spinSaved.textContent = left + (left === 1 ? ' spin left' : ' spins left');

    var affordable = wallet.balance() >= SPIN_PRICE;
    els.spinOffer.classList.toggle('store-item--short', !affordable);
    els.spinLock.hidden = affordable;
    els.spinBuy.disabled = !affordable;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * A copy of the card's wheel flies up to the navbar's Daily Spin button,
   * the way coins fly to the balance (wallet.js flyCoin): a burst up out of
   * the card, then a curve bowing off to one side, pulled in faster as it
   * goes - spinning, and shrinking to the navbar icon's size. The button
   * pops when it lands.
   */
  function flySpin() {
    var button = document.getElementById('wheel-open');
    var source = els.spinOffer.querySelector('.store-spin__wheel');
    var goalRect = button && button.getBoundingClientRect();
    if (!goalRect || !goalRect.width || !source.animate) {
      return;
    }
    var rect = source.getBoundingClientRect();
    var size = rect.width;
    var from = { x: rect.left + size / 2, y: rect.top + rect.height / 2 };
    var to = { x: goalRect.left + goalRect.width / 2, y: goalRect.top + goalRect.height / 2 };
    var burst = { x: from.x + (Math.random() - 0.5) * 80, y: from.y - 70 - Math.random() * 40 };
    var side = to.x < burst.x ? 1 : -1;
    var control = {
      x: lerp(burst.x, to.x, 0.5) + side * (80 + Math.random() * 60),
      y: Math.min(burst.y, to.y) + (lerp(burst.y, to.y, 0.5) - Math.min(burst.y, to.y)) * 0.3,
    };
    var endScale = NAVBAR_WHEEL_PX / size;

    var frames = [];
    for (var i = 0; i <= SPIN_FLY_STEPS; i += 1) {
      var t = i / SPIN_FLY_STEPS;
      var at;
      var scale;
      if (t <= SPIN_BURST_SHARE) {
        var u = 1 - Math.pow(1 - t / SPIN_BURST_SHARE, 2);
        at = { x: lerp(from.x, burst.x, u), y: lerp(from.y, burst.y, u) };
        scale = lerp(0.9, 1.05, u);
      } else {
        var v = Math.pow((t - SPIN_BURST_SHARE) / (1 - SPIN_BURST_SHARE), 1.7);
        var a = (1 - v) * (1 - v);
        var b = 2 * (1 - v) * v;
        var c = v * v;
        at = {
          x: a * burst.x + b * control.x + c * to.x,
          y: a * burst.y + b * control.y + c * to.y,
        };
        scale = lerp(1.05, endScale, v);
      }
      frames.push({
        transform: 'translate(' + (at.x - size / 2) + 'px, ' + (at.y - size / 2) + 'px) scale(' + scale + ')',
        opacity: t > 0.97 ? 0.5 : 1,
      });
    }

    var flyer = source.cloneNode(true);
    flyer.setAttribute('class', 'store-spin__flyer');
    // Only the wheel turns, under its pointer - as on the navbar.
    var face = flyer.querySelector('.store-spin__face');
    face.setAttribute('class', 'store-spin__flyer-face');
    flyer.style.width = size + 'px';
    flyer.style.height = rect.height + 'px';
    document.body.appendChild(flyer);
    sound('spinLaunch');
    face.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(900deg)' }], {
      duration: SPIN_FLY_MS, easing: 'cubic-bezier(0.3, 0, 0.6, 1)', fill: 'forwards',
    });
    play(flyer, frames, { duration: SPIN_FLY_MS, easing: 'linear', fill: 'forwards' }).then(function () {
      flyer.remove();
      sound('spinLand');
      button.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }],
        { duration: 380, easing: 'cubic-bezier(0.3, 1.6, 0.5, 1)' },
      );
    });
  }

  /** The card's wheel's angle as drawn, whichever animation is turning it. */
  function faceAngle() {
    var transform = getComputedStyle(els.spinFace).transform;
    if (!transform || transform === 'none') {
      return 0;
    }
    var matrix = new DOMMatrixReadOnly(transform);
    return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
  }

  /**
   * Whether the card's wheel is turning: Buy spin hovered or tabbed to
   * (style.css, store-spin-turn), or the turns after a purchase - not its
   * idle nudge.
   */
  function spinTurning() {
    var button = els.spinBuy;
    var hovered = !button.disabled && button.matches(':hover') && window.matchMedia('(hover: hover)').matches;
    var focused = !button.disabled && button.matches(':focus-visible');
    var bought = els.spinFace.getAnimations().some(function (animation) {
      return animation.playState === 'running' && !animation.animationName;
    });
    return hovered || focused || bought;
  }

  // The frame listening to the card's wheel, while it turns.
  var tickFrame = 0;

  /**
   * Ticks with the card's wheel for as long as it turns, following its
   * angle as drawn - so the ticks come as fast as the spokes go by, the
   * steady hover turn and a purchase's slowing turns alike.
   */
  function tickWithWheel() {
    if (tickFrame || reducedMotion() || !MusicHub.dailyWheel) {
      return;
    }
    var last = faceAngle();
    var turned = 0;
    var spoke = 0;
    var lastTick = 0;
    function frame(now) {
      if (!spinTurning()) {
        tickFrame = 0;
        return;
      }
      var angle = faceAngle();
      // The shortest way round from the last frame's angle.
      turned += ((angle - last + 540) % 360) - 180;
      last = angle;
      var current = Math.floor(turned / SPOKE_DEGREES);
      if (current !== spoke) {
        spoke = current;
        if (now - lastTick > TICK_GAP_MS) {
          lastTick = now;
          MusicHub.dailyWheel.tick();
        }
      }
      tickFrame = window.requestAnimationFrame(frame);
    }
    tickFrame = window.requestAnimationFrame(frame);
  }

  /** Buys a spin: the card's wheel gives a couple of turns, and a copy flies up to the navbar. */
  function buySpin() {
    if (!wallet.buySpin(SPIN_PRICE)) {
      renderSpinOffer();
      return;
    }
    if (!reducedMotion()) {
      play(els.spinFace, [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(720deg)' },
      ], { duration: SPIN_BOUGHT_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      tickWithWheel();
      flySpin();
    }
  }

  /* ---------------------------------------------------------------- init */

  function render() {
    renderStyles('username');
    renderStyles('navbar');
    renderStyles('player');
    renderVinylOffer();
    renderSpinOffer();
  }

  /*
   * Straight away rather than on DOMContentLoaded: this script sits at the
   * end of the page, so everything it needs is already there, and the
   * username cards appear with the rest of the page instead of after it.
   */
  (function init() {
    els.usernames = document.getElementById('username-items');
    els.navbars = document.getElementById('navbar-items');
    els.players = document.getElementById('player-items');
    els.vinylOffer = document.getElementById('vinyl-offer');
    els.vinylLock = document.getElementById('vinyl-lock');
    els.vinylPrice = document.getElementById('vinyl-price');
    els.vinylFree = document.getElementById('vinyl-free');
    els.unboxButton = document.getElementById('unbox-button');
    els.unboxLabel = document.getElementById('unbox-label');
    els.spinOffer = document.getElementById('spin-offer');
    els.spinFace = els.spinOffer.querySelector('.store-spin__face');
    els.spinLock = document.getElementById('spin-lock');
    els.spinSaved = document.getElementById('spin-saved');
    els.spinBuy = document.getElementById('spin-buy');

    els.unboxButton.addEventListener('click', function () {
      MusicHub.unbox.start().then(renderVinylOffer);
    });
    els.spinBuy.addEventListener('click', buySpin);
    // Hovered or tabbed to, Buy spin sets the card's wheel turning
    // (style.css, store-spin-turn): it ticks like the Daily Spin's.
    els.spinBuy.addEventListener('pointerenter', tickWithWheel);
    els.spinBuy.addEventListener('focus', tickWithWheel);
    // Hovered or tabbed to, Unbox makes the box jiggle (style.css,
    // mailer-jiggle): it rattles like the unboxing's hopping box, once a
    // shake, settling where the jiggle does.
    var mailer = els.vinylOffer.querySelector('.mailer');
    ['animationstart', 'animationiteration'].forEach(function (type) {
      mailer.addEventListener(type, function (event) {
        if (event.animationName === 'mailer-jiggle') {
          MusicHub.unbox.rattle(JIGGLE_SETTLE_S);
        }
      });
    });

    render();
  })();

  document.addEventListener('musichub:walletchange', render);
  document.addEventListener('musichub:unboxchange', renderVinylOffer);
  // The profile pill in the previews shows the Spotify name once it's in.
  document.addEventListener('musichub:authchange', function () {
    if (els.usernames) {
      renderStyles('username');
    }
  });

})(window.MusicHub);
