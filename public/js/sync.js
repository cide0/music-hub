/*
 * Google Drive sync: keeps the app data (storage.js's APP_DATA_KEYS) the same
 * in every browser that has it turned on. localStorage stays the working copy
 * every page reads and writes; Drive holds a mirror of it in the app's hidden
 * folder, one file per key (`<key>.json`), each carrying the time of the
 * change it holds (`changedAt`). Where both sides changed a key, the newer
 * change wins.
 *
 * - Every page load compares the Drive files with this browser's copy: newer
 *   files are downloaded and the page reloads once, so it shows them; this
 *   browser's changes that aren't on Drive yet are uploaded.
 * - Every change is uploaded shortly after it's made. A page change cuts that
 *   upload off, so a change stays marked until an upload succeeds - the next
 *   page load finishes it.
 * - Deleting a page's data leaves a "deleted" file on Drive, so another
 *   browser that still has it removes it too rather than uploading it again.
 * - "Clear all data" (clearAll) deletes every file on Drive instead, leaving
 *   just `cleared.json`: no data, only the time of the clear, so the other
 *   browsers clear what they hold from before it too.
 *
 * It's on by default: logging in to Google (with Drive access) turns it on,
 * and only "Turn off" in Settings turns it off for good. In local
 * development (the page's `musichub-drive-sync` meta says "off") it never
 * runs at all.
 *
 * Its own state (on, off or not decided yet, and per key the time of the
 * last change and whether it's uploaded yet) lives under `syncState`: it
 * describes this browser, so like the logins it isn't app data and isn't
 * exported. Must load right after storage.js and google.js, before anything
 * that writes.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var STATE_KEY = 'syncState';
  var CHANGE_EVENT = 'musichub:syncchange';
  var LOCK_NAME = 'musichub-sync';
  // After a change, wait this long for more before uploading.
  var UPLOAD_DELAY_MS = 1500;
  // Coming back to a tab checks Drive again, at most this often.
  var RECHECK_AFTER_MS = 30 * 1000;
  // Tells the reloaded page why it reloaded.
  var RELOADED_FLAG = 'musichub:syncReloaded';
  var UPDATED_MESSAGE = 'Updated with changes from another device.';
  var UPDATED_MESSAGE_MS = 4000;
  // Closing the "which data wins" question on the automatic turn-on means
  // "not now": it isn't asked again until the next visit.
  var ASKED_FLAG = 'musichub:syncAsked';
  // The one Drive file that isn't a key: when "Clear all data" last ran.
  var CLEARED_FILE = 'cleared.json';

  // False in local development, where sync must never touch the real data.
  var AVAILABLE = (function () {
    var meta = document.querySelector('meta[name="musichub-drive-sync"]');
    return !meta || meta.getAttribute('content') !== 'off';
  })();

  var storage = MusicHub.storage;
  var KEYS = storage.APP_DATA_KEYS;

  var uploadTimer = null;
  var lastCheckAt = 0;
  // True while a download is being written, so it isn't taken for a change.
  var applying = false;
  // Only one sync at a time within this tab (the lock covers other tabs).
  var running = null;
  // The turn-on underway (turnOn), so a second one joins it.
  var turningOn = null;

  /* ------------------------------------------------------------- state */

  function loadState() {
    var stored = storage.read(STATE_KEY, null) || {};
    return {
      // null until turned on or off: then it turns on with the Google login.
      enabled: typeof stored.enabled === 'boolean' ? stored.enabled : null,
      keys: stored.keys && typeof stored.keys === 'object' ? stored.keys : {},
      lastSyncAt: typeof stored.lastSyncAt === 'number' ? stored.lastSyncAt : null,
      lastError: typeof stored.lastError === 'string' ? stored.lastError : null,
      // The latest "Clear all data" this browser has made or taken over.
      clearedAt: typeof stored.clearedAt === 'number' ? stored.clearedAt : 0,
      // A "Clear all data" here whose Drive side hasn't happened yet.
      pendingClearAt: typeof stored.pendingClearAt === 'number' ? stored.pendingClearAt : null,
    };
  }

  function keyState(state, key) {
    var entry = state.keys[key] || {};
    return {
      changedAt: typeof entry.changedAt === 'number' ? entry.changedAt : 0,
      dirty: entry.dirty === true,
      fileId: typeof entry.fileId === 'string' ? entry.fileId : null,
    };
  }

  /**
   * Re-reads the stored state, lets `change` edit it, and saves it - never a
   * copy held across an await, since other tabs change it too.
   */
  function updateState(change) {
    var state = loadState();
    change(state);
    storage.write(STATE_KEY, state);
    return state;
  }

  function setKey(key, changes) {
    updateState(function (state) {
      state.keys[key] = Object.assign(keyState(state, key), changes);
    });
  }

  function announce() {
    document.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: status() }));
  }

  // This page's starting point: what each key was when it loaded, before any
  // page script had a chance to write. See runPageLoad.
  var loadedWith = (function () {
    var state = loadState();
    var snapshot = {};
    KEYS.forEach(function (key) {
      snapshot[key] = keyState(state, key).changedAt;
    });
    return snapshot;
  })();

  /* ------------------------------------------------------ change tracking */

  storage.onChange(function (key) {
    if (applying || !loadState().enabled) {
      return;
    }
    setKey(key, { changedAt: Date.now(), dirty: true });
    scheduleUpload();
  });

  function scheduleUpload() {
    window.clearTimeout(uploadTimer);
    uploadTimer = window.setTimeout(function () {
      sync({ download: false });
    }, UPLOAD_DELAY_MS);
  }

  /* ---------------------------------------------------------------- drive */

  function fileName(key) {
    return key + '.json';
  }

  function remoteChangedAt(file) {
    var props = file.appProperties || {};
    return Number(props.changedAt) || 0;
  }

  function isDeletedFile(file) {
    return !!(file.appProperties && file.appProperties.deleted === 'true');
  }

  /**
   * The Drive file for each key. Two browsers creating a key's file at the
   * same moment leaves two: the newer is kept, the other removed.
   */
  function filesByKey(files) {
    var byKey = {};
    files.forEach(function (file) {
      var key = String(file.name || '').replace(/\.json$/, '');
      if (KEYS.indexOf(key) === -1) {
        return;
      }
      var current = byKey[key];
      if (!current) {
        byKey[key] = file;
        return;
      }
      var keep = remoteChangedAt(file) > remoteChangedAt(current) ? file : current;
      var drop = keep === file ? current : file;
      byKey[key] = keep;
      MusicHub.google.deleteDriveFile(drop.id).catch(function (err) {
        console.warn('Could not remove a duplicate sync file', err);
      });
    });
    return byKey;
  }

  /** Writes a downloaded key without it counting as a change here. */
  function applyDownload(key, text) {
    var ok = true;
    applying = true;
    try {
      if (text === null) {
        storage.remove(key);
      } else {
        ok = storage.write(key, JSON.parse(text));
      }
    } catch (err) {
      console.warn('Could not apply the synced "' + key + '"', err);
      ok = false;
    }
    applying = false;
    return ok;
  }

  /**
   * Takes over the Drive file's version of `key`. Resolves with whether this
   * browser's data changed - a "deleted" file for data it doesn't have
   * doesn't change anything - or null when it couldn't be written.
   */
  function download(key, file) {
    var at = remoteChangedAt(file);
    var content = isDeletedFile(file)
      ? Promise.resolve(null)
      : MusicHub.google.readDriveFile(file.id);
    return content.then(function (text) {
      var changed = text !== null || localStorage.getItem(key) !== null;
      if (changed && !applyDownload(key, text)) {
        return null;
      }
      setKey(key, { changedAt: at, dirty: false, fileId: file.id });
      return changed;
    });
  }

  function upload(key, file) {
    var entry = keyState(loadState(), key);
    var raw = localStorage.getItem(key);
    var props = { changedAt: String(entry.changedAt), deleted: String(raw === null) };
    return MusicHub.google.writeDriveFile(fileName(key), raw === null ? 'null' : raw, file ? file.id : null, props)
      .then(function (saved) {
        // Changed again while uploading: still marked, for the next round.
        var stillSame = keyState(loadState(), key).changedAt === entry.changedAt;
        setKey(key, { dirty: !stillSame, fileId: saved.id });
      });
  }

  /** When "Clear all data" last ran anywhere, from the Drive files (0: never). */
  function lastClearedAt(files) {
    return files.reduce(function (latest, file) {
      if (file.name !== CLEARED_FILE) {
        return latest;
      }
      var at = Number(file.appProperties && file.appProperties.clearedAt) || 0;
      return Math.max(latest, at);
    }, 0);
  }

  /**
   * This browser's "Clear all data" on Drive: every file there deleted, then
   * `cleared.json` left saying when. Changes made here since are uploaded
   * after it, in the same round.
   */
  function clearDrive(at) {
    return MusicHub.google.listDriveFiles().then(function (files) {
      return Promise.all(files.map(function (file) {
        return MusicHub.google.deleteDriveFile(file.id).catch(function (err) {
          // Already gone is fine; anything else fails the round, to retry.
          if (err.status !== 404) {
            throw err;
          }
        });
      }));
    }).then(function () {
      return MusicHub.google.writeDriveFile(CLEARED_FILE, 'null', null, { clearedAt: String(at) });
    }).then(function () {
      updateState(function (state) {
        state.pendingClearAt = null;
        state.clearedAt = Math.max(state.clearedAt, at);
        KEYS.forEach(function (key) {
          if (state.keys[key]) {
            delete state.keys[key].fileId;
          }
        });
      });
    });
  }

  /**
   * Another browser's "Clear all data": every key here from before it is
   * removed - changes made here after it stay. `newerThan` as in syncRound.
   * Returns the keys removed.
   */
  function takeOverClear(at, newerThan) {
    var removed = [];
    KEYS.forEach(function (key) {
      var entry = keyState(loadState(), key);
      var changedAt = newerThan ? newerThan[key] : entry.changedAt;
      if (changedAt > at) {
        return;
      }
      if (localStorage.getItem(key) !== null && applyDownload(key, null)) {
        removed.push(key);
      }
      setKey(key, { changedAt: at, dirty: false, fileId: null });
    });
    updateState(function (state) {
      state.clearedAt = at;
    });
    return removed;
  }

  /**
   * One round: every key is compared with its Drive file. A newer file is
   * downloaded (or, with `download: false`, only counted); this browser's
   * unsent changes are uploaded. `newerThan` gives, per key, the change time
   * to compare the Drive file with (default: the stored one). Resolves with
   * { downloaded, newer } - the keys written here, and the keys with a newer
   * file left alone.
   */
  function syncRound(options) {
    var pending = loadState().pendingClearAt;
    var ready = pending ? clearDrive(pending) : Promise.resolve();

    return ready.then(function () {
      return MusicHub.google.listDriveFiles();
    }).then(function (files) {
      var byKey = filesByKey(files);
      var result = { downloaded: [], newer: [] };

      // Another browser cleared all data since this one last looked.
      var clearedAt = lastClearedAt(files);
      var newClear = clearedAt > loadState().clearedAt ? clearedAt : 0;
      // Taken over now: no file from before it counts as newer any more.
      var takenOver = 0;
      if (newClear) {
        if (options.download === false) {
          result.newer.push(CLEARED_FILE);
        } else {
          result.downloaded = takeOverClear(newClear, options.newerThan);
          takenOver = newClear;
          newClear = 0;
        }
      }

      return KEYS.reduce(function (previous, key) {
        return previous.then(function () {
          var file = byKey[key];
          var entry = keyState(loadState(), key);
          var compareWith = Math.max(options.newerThan ? options.newerThan[key] : entry.changedAt, takenOver);

          if (file && remoteChangedAt(file) > compareWith) {
            if (options.download === false) {
              result.newer.push(key);
              return null;
            }
            return download(key, file).then(function (changed) {
              if (changed) {
                result.downloaded.push(key);
              }
            });
          }
          // Unless it's from before a clear not taken over yet (the reload
          // that's offered does that), it goes up.
          if (entry.dirty && entry.changedAt > newClear) {
            return upload(key, file);
          }
          if (file && entry.fileId !== file.id) {
            setKey(key, { fileId: file.id });
          }
          return null;
        });
      }, Promise.resolve()).then(function () {
        return result;
      });
    });
  }

  function withLock(task) {
    if (navigator.locks && navigator.locks.request) {
      return navigator.locks.request(LOCK_NAME, task);
    }
    return task();
  }

  /**
   * A sync round, if sync is on and Google allows it. Resolves with the
   * round's result, or null when nothing ran; failures are kept in the
   * state (Settings shows them) rather than thrown.
   */
  function sync(options) {
    options = options || {};
    if (!AVAILABLE || !loadState().enabled || !MusicHub.google.hasDriveAccess()) {
      announce();
      return Promise.resolve(null);
    }
    if (running) {
      return running.then(function () {
        return sync(options);
      });
    }

    lastCheckAt = Date.now();
    running = withLock(function () {
      return syncRound(options);
    }).then(function (result) {
      updateState(function (state) {
        state.lastSyncAt = Date.now();
        state.lastError = null;
      });
      return result;
    }, function (err) {
      console.warn('Google Drive sync failed', err);
      updateState(function (state) {
        state.lastError = err && err.message ? err.message : 'Unknown error';
      });
      return null;
    }).then(function (result) {
      running = null;
      announce();
      return result;
    });
    announce();
    return running;
  }

  /* -------------------------------------------------------------- notices */

  function showNotice(text, action) {
    var notice = document.getElementById('sync-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'notice notice--floating';
      notice.id = 'sync-notice';
      notice.setAttribute('role', 'status');
      document.body.appendChild(notice);
    }
    notice.textContent = '';

    var message = document.createElement('span');
    message.className = 'notice__text';
    message.textContent = text;
    notice.appendChild(message);

    if (action) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button--ghost notice__action';
      button.textContent = action.label;
      button.addEventListener('click', action.run);
      notice.appendChild(button);
    }

    var dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'notice__dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" />'
      + '<line x1="6" y1="6" x2="18" y2="18" /></svg>';
    dismiss.addEventListener('click', function () {
      notice.hidden = true;
    });
    notice.appendChild(dismiss);

    notice.hidden = false;
    return notice;
  }

  function showUpdatedNotice() {
    var notice = showNotice(UPDATED_MESSAGE);
    window.setTimeout(function () {
      notice.hidden = true;
    }, UPDATED_MESSAGE_MS);
  }

  /* ---------------------------------------------------------- page flow */

  function reloadFlag(value) {
    try {
      if (value) {
        sessionStorage.setItem(RELOADED_FLAG, '1');
        return true;
      }
      var was = sessionStorage.getItem(RELOADED_FLAG) === '1';
      sessionStorage.removeItem(RELOADED_FLAG);
      return was;
    } catch (err) {
      return false;
    }
  }

  function askedThisVisit(value) {
    try {
      if (value) {
        sessionStorage.setItem(ASKED_FLAG, '1');
      }
      return sessionStorage.getItem(ASKED_FLAG) === '1';
    } catch (err) {
      return !!value;
    }
  }

  function reloadWith(downloaded) {
    if (downloaded && downloaded.length) {
      reloadFlag(true);
      window.location.reload();
    }
  }

  /**
   * The page-load round. It compares Drive with what this page loaded with
   * (`loadedWith`), not with the stored times: whatever a page script wrote
   * while the round was underway was based on the old data, so a newer
   * Drive file still wins. Anything downloaded means the page shows old
   * data - it reloads once to show the new.
   */
  function runPageLoad() {
    if (!AVAILABLE) {
      return;
    }
    if (loadState().enabled === null && MusicHub.google.hasDriveAccess() && !askedThisVisit()) {
      turnOn().then(function (on) {
        if (!on) {
          askedThisVisit(true);
        }
      }, function (err) {
        console.warn('Could not turn on Google Drive sync', err);
      });
      return;
    }
    sync({ newerThan: loadedWith }).then(function (result) {
      reloadWith(result && result.downloaded);
    });
  }

  /**
   * Back to a tab left open: upload what's pending, and if another device
   * changed something meanwhile, offer a reload. Downloading straight into
   * a page that's already showing (and may be mid-run) would have its next
   * save write the old data back.
   */
  function recheck() {
    if (document.visibilityState !== 'visible' || Date.now() - lastCheckAt < RECHECK_AFTER_MS) {
      return;
    }
    sync({ download: false }).then(function (result) {
      if (result && result.newer.length) {
        showNotice('There are newer changes from another device.', {
          label: 'Reload',
          run: function () {
            window.location.reload();
          },
        });
      }
    });
  }

  /* ------------------------------------------------------------ settings */

  function status() {
    var state = loadState();
    var pending = KEYS.filter(function (key) {
      return keyState(state, key).dirty;
    }).length;
    return {
      available: AVAILABLE,
      enabled: state.enabled === true,
      // Turned off in Settings, rather than just not on yet.
      turnedOff: state.enabled === false,
      hasDriveAccess: !!(MusicHub.google && MusicHub.google.hasDriveAccess()),
      running: !!running || !!turningOn,
      lastSyncAt: state.lastSyncAt,
      lastError: state.lastError,
      pending: pending,
    };
  }

  /**
   * What turning sync on would meet: whether Drive already holds Music Hub
   * data, and whether this browser does. Both means the user picks which
   * wins (see enable).
   */
  function inspect() {
    return MusicHub.google.listDriveFiles().then(function (files) {
      var byKey = filesByKey(files);
      return {
        driveHasData: KEYS.some(function (key) {
          return byKey[key] && !isDeletedFile(byKey[key]);
        }),
        browserHasData: KEYS.some(function (key) {
          return localStorage.getItem(key) !== null;
        }),
      };
    });
  }

  /**
   * Turns sync on. `prefer` decides the keys both Drive and this browser
   * hold: 'drive' takes Drive's, 'browser' uploads this browser's. Keys only
   * one side has are kept either way - nothing is lost to the choice but
   * the other side's version of a shared key. Resolves with the keys
   * downloaded (the caller reloads when there are any).
   */
  function enable(prefer) {
    if (!AVAILABLE) {
      return Promise.reject(new Error('Sync isn\u2019t available in local development.'));
    }
    var now = Date.now();
    updateState(function (state) {
      state.enabled = true;
      state.lastError = null;
      state.keys = {};
      KEYS.forEach(function (key) {
        var here = localStorage.getItem(key) !== null;
        // Drive's wins where it has the key: an older time than any file's.
        // This browser's wins everywhere else, and is uploaded.
        state.keys[key] = here && prefer !== 'drive'
          ? { changedAt: now, dirty: true }
          : { changedAt: 0, dirty: false };
      });
    });

    // Where Drive turns out not to have a key this browser has, upload it.
    return MusicHub.google.listDriveFiles().then(function (files) {
      var byKey = filesByKey(files);
      updateState(function (state) {
        // An earlier clear is no reason to clear what this browser brings.
        state.clearedAt = lastClearedAt(files);
        state.pendingClearAt = null;
        KEYS.forEach(function (key) {
          var file = byKey[key];
          if (localStorage.getItem(key) !== null && (!file || isDeletedFile(file))) {
            state.keys[key] = { changedAt: now, dirty: true };
          }
        });
      });
      return sync();
    }).then(function (result) {
      return result ? result.downloaded : [];
    });
  }

  /**
   * Where Drive and this browser both hold data, the user picks whose wins
   * for the data both have. Resolves with 'drive', 'browser' or null
   * (the dialog closed without a choice).
   */
  function chooseSide(info) {
    if (!info.driveHasData) {
      return Promise.resolve('browser');
    }
    if (!info.browserHasData) {
      return Promise.resolve('drive');
    }
    return MusicHub.confirmDialog.open({
      title: 'Google Drive already has Music Hub data',
      text: 'Both your Google Drive and this browser hold Music Hub data, probably from another '
        + 'device. Where both have the same data - the concert list, say, or your coins and '
        + 'vinyls - which should be kept? The other one\u2019s version is replaced. Data only '
        + 'one of them has is kept either way.',
      action: 'Keep Google Drive\u2019s',
      secondary: 'Keep this browser\u2019s',
      cancel: false,
      danger: false,
    }).then(function (choice) {
      if (choice === true) {
        return 'drive';
      }
      return choice === 'secondary' ? 'browser' : null;
    });
  }

  /**
   * Turns sync on: asks which data wins where both sides have some, then
   * enables it, reloading the page if anything was downloaded. Resolves
   * with whether it's on now (false: the question was closed unanswered).
   */
  function turnOn() {
    if (!AVAILABLE) {
      return Promise.reject(new Error('Sync isn’t available in local development.'));
    }
    if (turningOn) {
      return turningOn;
    }
    turningOn = inspect().then(chooseSide).then(function (prefer) {
      if (!prefer) {
        return false;
      }
      return enable(prefer).then(function (downloaded) {
        reloadWith(downloaded);
        return true;
      });
    });
    announce();
    turningOn.then(function () {
      turningOn = null;
      announce();
    }, function () {
      turningOn = null;
      announce();
    });
    return turningOn;
  }

  /** Turns sync off for good. Drive keeps its copy; turning it on again starts afresh. */
  function disable() {
    window.clearTimeout(uploadTimer);
    updateState(function (state) {
      state.enabled = false;
      state.keys = {};
      state.lastError = null;
      state.pendingClearAt = null;
    });
    announce();
  }

  /**
   * "Clear all data": removes every app-data key here and, with sync on,
   * everything on Drive too - the other synced browsers then clear theirs.
   * Resolves once Drive is done (or has failed: the next sync retries it).
   * With sync off (or in local development) Drive isn't touched.
   */
  function clearAll() {
    if (!AVAILABLE || !loadState().enabled) {
      storage.clearAppData();
      return Promise.resolve();
    }

    var now = Date.now();
    applying = true;
    storage.clearAppData();
    applying = false;
    window.clearTimeout(uploadTimer);
    updateState(function (state) {
      state.pendingClearAt = now;
      KEYS.forEach(function (key) {
        state.keys[key] = { changedAt: now, dirty: false };
      });
    });
    return sync({ download: false });
  }

  MusicHub.sync = {
    CHANGE_EVENT: CHANGE_EVENT,
    status: status,
    turnOn: turnOn,
    disable: disable,
    clearAll: clearAll,
    syncNow: function () {
      return sync();
    },
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (reloadFlag(false)) {
      showUpdatedNotice();
    }
    runPageLoad();
  });
  document.addEventListener('visibilitychange', recheck);
})(window.MusicHub);
