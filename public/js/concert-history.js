/*
 * Concert History: a client-side folder browser (artists > concerts > media)
 * over Google Drive embeds. Everything lives in localStorage and is the source
 * of truth - unlike Concert Date Fetcher's cache, nothing here can be
 * re-fetched, so deletes always confirm first.
 *
 * Besides pasted links, it fills itself from a folder in the user's Drive
 * (Settings' Gallery folder, else "Concerts" at the top of My Drive): one
 * folder per artist, named like a followed artist, one per concert inside,
 * the images and videos in those. Whatever came from there carries its Drive
 * id (`driveFolderId` / `driveFileId`) and follows Drive: renamed, added and
 * removed with it. Deleting such an item here only hides it (the
 * `hiddenDrive...` lists) - otherwise the next sync would bring it back.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var STORAGE_KEY = 'concertHistory';
  var DRIVE_PREVIEW_PREFIX = 'https://drive.google.com/file/d/';
  var DRIVE_PREVIEW_SUFFIX = '/preview';
  var GALLERY_FOLDER_SETTING = 'galleryDriveFolderId';
  var DEFAULT_GALLERY_FOLDER = 'Concerts';

  var els = {};
  var data = null;
  // { view: 'artists' | 'concerts' | 'media', artistId, concertId }
  var currentView = { view: 'artists', artistId: null, concertId: null };
  var followedArtists = null;
  // Media view preferences, per session.
  var mediaOrder = 'newest';
  var mediaFavoritesOnly = false;
  // The rendered media elements, kept so sorting and filtering can be applied
  // without rebuilding them (a recreated or moved <iframe> reloads).
  var mediaNodes = { images: [], videos: [] };

  /* ------------------------------------------------------- pure data layer */

  function uniqueId() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  function emptyData() {
    return { artists: [] };
  }

  /** A list of Drive ids, or nothing when it's empty (keeps the stored data small). */
  function idList(value) {
    return Array.isArray(value) ? value.filter(function (id) {
      return typeof id === 'string';
    }) : [];
  }

  /** Copies the Drive link fields that are set - none on hand-made entries. */
  function withDriveFields(target, source, fields) {
    fields.forEach(function (field) {
      var value = source[field];
      if (Array.isArray(value)) {
        value = idList(value);
        if (value.length) {
          target[field] = value;
        }
      } else if (value) {
        target[field] = value;
      }
    });
    return target;
  }

  function normalizeMedia(list) {
    return (Array.isArray(list) ? list : []).filter(Boolean).map(function (item) {
      return withDriveFields({
        id: item.id,
        embedSrc: item.embedSrc,
        addedAt: item.addedAt || 0,
        favorite: !!item.favorite,
      }, item, ['driveFileId']);
    });
  }

  /** Tolerates anything that isn't shaped like Concert History data. */
  function normalizeData(raw) {
    if (!raw || !Array.isArray(raw.artists)) {
      return emptyData();
    }
    return withDriveFields({
      artists: raw.artists.filter(Boolean).map(function (artist) {
        return withDriveFields({
          spotifyArtistId: artist.spotifyArtistId,
          artistName: artist.artistName || '',
          imageUrl: artist.imageUrl || null,
          concerts: (Array.isArray(artist.concerts) ? artist.concerts : []).map(function (concert) {
            return withDriveFields({
              id: concert.id,
              name: concert.name || '',
              createdAt: concert.createdAt || 0,
              images: normalizeMedia(concert.images),
              videos: normalizeMedia(concert.videos),
            }, concert, ['driveFolderId', 'fromDrive', 'hiddenDriveFiles']);
          }),
        }, artist, ['driveFolderId', 'fromDrive', 'hiddenDriveFolders']);
      }),
    }, raw, ['hiddenDriveFolders']);
  }

  function findArtist(current, artistId) {
    var found = current.artists.filter(function (artist) {
      return artist.spotifyArtistId === artistId;
    });
    return found.length ? found[0] : null;
  }

  function findConcert(artist, concertId) {
    if (!artist) {
      return null;
    }
    var found = artist.concerts.filter(function (concert) {
      return concert.id === concertId;
    });
    return found.length ? found[0] : null;
  }

  /**
   * Media in display order: by the date it was added, newest first by default.
   * Entries stored before timestamps existed fall back to their stored order.
   * `favoritesOnly` narrows the result to hearted items.
   */
  function orderedMedia(list, order, favoritesOnly) {
    var entries = (list || []).map(function (item, index) {
      return { item: item, index: index };
    });

    entries.sort(function (a, b) {
      return ((b.item.addedAt || 0) - (a.item.addedAt || 0)) || (b.index - a.index);
    });

    if (order === 'oldest') {
      entries.reverse();
    }

    return entries.map(function (entry) {
      return entry.item;
    }).filter(function (item) {
      return !favoritesOnly || item.favorite;
    });
  }

  function toggleFavorite(current, artistId, concertId, kind, mediaId) {
    var concert = findConcert(findArtist(current, artistId), concertId);
    if (!concert) {
      return null;
    }
    var found = concert[kind].filter(function (item) {
      return item.id === mediaId;
    });
    if (!found.length) {
      return null;
    }
    found[0].favorite = !found[0].favorite;
    return found[0].favorite;
  }

  /**
   * Every hearted item in the whole archive, grouped by the concert it came
   * from so each group can be labelled with its origin.
   */
  function collectFavorites(current) {
    var groups = [];

    sortedArtists(current).forEach(function (artist) {
      sortedConcerts(artist).forEach(function (concert) {
        var items = [];
        ['images', 'videos'].forEach(function (kind) {
          orderedMedia(concert[kind], 'newest', true).forEach(function (item) {
            items.push({ kind: kind, item: item });
          });
        });

        if (items.length) {
          groups.push({
            artistId: artist.spotifyArtistId,
            artistName: artist.artistName,
            concertId: concert.id,
            concertName: concert.name,
            items: items,
          });
        }
      });
    });

    return groups;
  }

  function countAllFavorites(current) {
    return collectFavorites(current).reduce(function (total, group) {
      return total + group.items.length;
    }, 0);
  }

  function countFavorites(concert) {
    if (!concert) {
      return 0;
    }
    return ['images', 'videos'].reduce(function (total, kind) {
      return total + concert[kind].filter(function (item) {
        return item.favorite;
      }).length;
    }, 0);
  }

  /**
   * Artist folders are listed alphabetically, ignoring case and accents.
   * (The Favorites folder is rendered separately and always comes first.)
   */
  function sortedArtists(current) {
    return (current.artists || []).slice().sort(function (a, b) {
      return String(a.artistName || '').localeCompare(String(b.artistName || ''), undefined, {
        sensitivity: 'base',
        numeric: true,
      });
    });
  }

  /** Concert subfolders are listed alphabetically, like the artist folders. */
  function sortedConcerts(artist) {
    return artist.concerts.slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        sensitivity: 'base',
        numeric: true,
      });
    });
  }

  function addArtist(current, artist) {
    if (findArtist(current, artist.id)) {
      return current;
    }
    current.artists.push({
      spotifyArtistId: artist.id,
      artistName: artist.name,
      imageUrl: artist.imageUrl || null,
      concerts: [],
    });
    return current;
  }

  function addConcert(current, artistId, name) {
    var artist = findArtist(current, artistId);
    var trimmed = String(name || '').trim();
    if (!artist || !trimmed) {
      return null;
    }
    var concert = {
      id: uniqueId(),
      name: trimmed,
      createdAt: Date.now(),
      images: [],
      videos: [],
    };
    artist.concerts.push(concert);
    return concert;
  }

  function renameConcert(current, artistId, concertId, name) {
    var concert = findConcert(findArtist(current, artistId), concertId);
    var trimmed = String(name || '').trim();
    if (!concert || !trimmed) {
      return false;
    }
    concert.name = trimmed;
    return true;
  }

  function deleteArtist(current, artistId) {
    var before = current.artists.length;
    current.artists = current.artists.filter(function (artist) {
      return artist.spotifyArtistId !== artistId;
    });
    return current.artists.length !== before;
  }

  function deleteConcert(current, artistId, concertId) {
    var artist = findArtist(current, artistId);
    if (!artist) {
      return false;
    }
    var before = artist.concerts.length;
    artist.concerts = artist.concerts.filter(function (concert) {
      return concert.id !== concertId;
    });
    return artist.concerts.length !== before;
  }

  /**
   * Pulls a Drive file id out of one pasted line - either the `src` of an
   * <iframe> embed snippet or a plain share link. The user's own HTML is never
   * inserted anywhere; only the id is kept.
   */
  function extractDriveId(line) {
    var text = String(line || '');
    var patterns = [
      /\/file\/d\/([A-Za-z0-9_-]{8,})/,
      /[?&]id=([A-Za-z0-9_-]{8,})/,
      /\/document\/d\/([A-Za-z0-9_-]{8,})/,
      /\/uc\?[^"']*id=([A-Za-z0-9_-]{8,})/,
    ];
    for (var i = 0; i < patterns.length; i++) {
      var match = text.match(patterns[i]);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  /** Splits pasted input by line; reports how many lines made no sense. */
  function parseDriveLines(text) {
    var ids = [];
    var failed = 0;

    String(text || '').split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) {
        return;
      }
      var id = extractDriveId(line);
      if (id) {
        if (ids.indexOf(id) === -1) {
          ids.push(id);
        }
      } else {
        failed += 1;
      }
    });

    return { ids: ids, failed: failed };
  }

  function embedSrcFor(fileId) {
    return DRIVE_PREVIEW_PREFIX + fileId + DRIVE_PREVIEW_SUFFIX;
  }

  function addMedia(current, artistId, concertId, kind, text) {
    var concert = findConcert(findArtist(current, artistId), concertId);
    var parsed = parseDriveLines(text);
    if (!concert) {
      return { added: 0, failed: parsed.failed, duplicates: 0 };
    }

    var list = concert[kind];
    var existing = list.map(function (item) {
      return item.embedSrc;
    });

    var added = 0;
    var duplicates = 0;
    parsed.ids.forEach(function (fileId) {
      var embedSrc = embedSrcFor(fileId);
      if (existing.indexOf(embedSrc) !== -1) {
        duplicates += 1;
        return;
      }
      list.push({ id: uniqueId(), embedSrc: embedSrc, addedAt: Date.now(), favorite: false });
      added += 1;
    });

    return { added: added, failed: parsed.failed, duplicates: duplicates };
  }

  /* ------------------------------------------------- google drive folder */

  /** Lowercased, without accents and extra spaces: "Björk " matches "bjork". */
  function foldName(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function driveTime(iso) {
    var time = Date.parse(iso);
    return isNaN(time) ? Date.now() : time;
  }

  function driveMediaKind(mimeType) {
    if (/^image\//.test(mimeType || '')) {
      return 'images';
    }
    return /^video\//.test(mimeType || '') ? 'videos' : null;
  }

  function addHidden(owner, field, id) {
    owner[field] = idList(owner[field]);
    if (owner[field].indexOf(id) === -1) {
      owner[field].push(id);
    }
  }

  function isHidden(owner, field, id) {
    return idList(owner[field]).indexOf(id) !== -1;
  }

  /** Keeps only the hidden ids Drive still has - the rest can't come back anyway. */
  function pruneHidden(owner, field, seen) {
    var kept = idList(owner[field]).filter(function (id) {
      return seen[id];
    });
    if (kept.length) {
      owner[field] = kept;
    } else {
      delete owner[field];
    }
  }

  /** A concert no longer tied to a Drive folder: only what was added by hand stays. */
  function unlinkConcert(concert) {
    ['images', 'videos'].forEach(function (kind) {
      concert[kind] = concert[kind].filter(function (item) {
        return !item.driveFileId;
      });
    });
    delete concert.driveFolderId;
    delete concert.hiddenDriveFiles;
  }

  function isEmptyConcert(concert) {
    return !concert.images.length && !concert.videos.length;
  }

  function mergeDriveFiles(concert, files) {
    var seen = {};
    var inConcert = {};
    concert.images.concat(concert.videos).forEach(function (item) {
      inConcert[item.embedSrc] = true;
    });

    files.forEach(function (file) {
      var kind = driveMediaKind(file.mimeType);
      if (!kind) {
        return;
      }
      seen[file.id] = true;
      var embedSrc = embedSrcFor(file.id);
      // Hidden here, or already in this concert (e.g. pasted by hand).
      if (isHidden(concert, 'hiddenDriveFiles', file.id) || inConcert[embedSrc]) {
        return;
      }
      concert[kind].push({
        id: uniqueId(),
        embedSrc: embedSrc,
        addedAt: driveTime(file.createdTime),
        favorite: false,
        driveFileId: file.id,
      });
      inConcert[embedSrc] = true;
    });

    // Gone from the folder: gone from here too. Hand-added items stay.
    ['images', 'videos'].forEach(function (kind) {
      concert[kind] = concert[kind].filter(function (item) {
        return !item.driveFileId || seen[item.driveFileId];
      });
    });
    pruneHidden(concert, 'hiddenDriveFiles', seen);
  }

  function mergeConcertFolders(artist, folders) {
    var seen = {};
    // A concert tied to a folder that's gone can take a new one of its name.
    var inDrive = {};
    folders.forEach(function (folder) {
      inDrive[folder.id] = true;
    });

    folders.forEach(function (folder) {
      seen[folder.id] = true;
      if (isHidden(artist, 'hiddenDriveFolders', folder.id)) {
        return;
      }

      var concert = artist.concerts.filter(function (existing) {
        return existing.driveFolderId === folder.id;
      })[0] || artist.concerts.filter(function (existing) {
        // A concert of the same name (made by hand, say) becomes this folder's.
        return !(existing.driveFolderId && inDrive[existing.driveFolderId])
          && foldName(existing.name) === foldName(folder.name);
      })[0];

      if (!concert) {
        concert = {
          id: uniqueId(),
          name: folder.name,
          createdAt: driveTime(folder.createdTime),
          images: [],
          videos: [],
          fromDrive: true,
        };
        artist.concerts.push(concert);
      }
      concert.driveFolderId = folder.id;
      concert.name = folder.name;
      mergeDriveFiles(concert, folder.files);
    });

    // Folder gone from Drive: its files go; a concert made from it goes once empty.
    artist.concerts = artist.concerts.filter(function (concert) {
      if (!concert.driveFolderId || seen[concert.driveFolderId]) {
        return true;
      }
      unlinkConcert(concert);
      return !(concert.fromDrive && isEmptyConcert(concert));
    });
    pruneHidden(artist, 'hiddenDriveFolders', seen);
  }

  /**
   * The Gallery artist an artist folder belongs to: the one already tied to
   * it, else one of the same name, else a followed artist of that name (added
   * then). Null when nothing matches - or when that artist already has
   * another folder.
   */
  function artistForFolder(current, folder, followed, inDrive) {
    var name = foldName(folder.name);
    var linked = current.artists.filter(function (artist) {
      return artist.driveFolderId === folder.id;
    })[0];
    if (linked) {
      return linked;
    }

    var byName = current.artists.filter(function (artist) {
      return foldName(artist.artistName) === name;
    })[0];
    if (byName) {
      return byName.driveFolderId && inDrive[byName.driveFolderId] ? null : byName;
    }

    var match = (followed || []).filter(function (artist) {
      return foldName(artist.name) === name;
    })[0];
    if (!match) {
      return null;
    }
    addArtist(current, match);
    var added = findArtist(current, match.id);
    added.fromDrive = true;
    return added;
  }

  /**
   * Brings `current` in line with the Drive folder `tree` ({ artists: [{ id,
   * name, concerts: [{ id, name, createdTime, files: [{ id, mimeType,
   * createdTime }] }] }] }). `followed` is the followed artists list. Returns
   * the names of the artist folders no artist was found for.
   */
  function mergeDriveTree(current, tree, followed) {
    var unmatched = [];
    var seen = {};
    var inDrive = {};
    tree.artists.forEach(function (folder) {
      inDrive[folder.id] = true;
    });

    tree.artists.forEach(function (folder) {
      seen[folder.id] = true;
      if (isHidden(current, 'hiddenDriveFolders', folder.id)) {
        return;
      }
      var artist = artistForFolder(current, folder, followed, inDrive);
      if (!artist) {
        unmatched.push(folder.name);
        return;
      }
      artist.driveFolderId = folder.id;
      mergeConcertFolders(artist, folder.concerts);
    });

    // Artist folder gone from Drive: what came from it goes; an artist added
    // for it goes once it has no concerts left.
    current.artists = current.artists.filter(function (artist) {
      if (!artist.driveFolderId || seen[artist.driveFolderId]) {
        return true;
      }
      artist.concerts = artist.concerts.filter(function (concert) {
        if (!concert.driveFolderId) {
          return true;
        }
        unlinkConcert(concert);
        return !(concert.fromDrive && isEmptyConcert(concert));
      });
      delete artist.driveFolderId;
      delete artist.hiddenDriveFolders;
      return !(artist.fromDrive && !artist.concerts.length);
    });
    pruneHidden(current, 'hiddenDriveFolders', seen);

    return unmatched;
  }

  /** Reads the Drive folder `root` ({ id }) into the tree mergeDriveTree takes. */
  function fetchDriveTree(root) {
    var google = MusicHub.google;
    var tree = { artists: [] };

    return google.listChildren([root.id], 'folders').then(function (artistFolders) {
      tree.artists = artistFolders.map(function (folder) {
        return { id: folder.id, name: folder.name, concerts: [] };
      });
      if (!tree.artists.length) {
        return [];
      }
      return google.listChildren(tree.artists.map(function (artist) {
        return artist.id;
      }), 'folders');
    }).then(function (concertFolders) {
      var concertsById = {};
      concertFolders.forEach(function (folder) {
        var concert = { id: folder.id, name: folder.name, createdTime: folder.createdTime, files: [] };
        concertsById[folder.id] = concert;
        tree.artists.forEach(function (artist) {
          if ((folder.parents || []).indexOf(artist.id) !== -1) {
            artist.concerts.push(concert);
          }
        });
      });
      var ids = Object.keys(concertsById);
      if (!ids.length) {
        return tree;
      }
      return google.listChildren(ids, 'media').then(function (files) {
        files.forEach(function (file) {
          (file.parents || []).forEach(function (parent) {
            if (concertsById[parent]) {
              concertsById[parent].files.push(file);
            }
          });
        });
        return tree;
      });
    });
  }

  /**
   * Removes a media item. One from the Drive folder is also remembered as
   * hidden, so the next sync doesn't bring it back.
   */
  function forgetMedia(current, artistId, concertId, kind, item) {
    var concert = findConcert(findArtist(current, artistId), concertId);
    if (concert && item.driveFileId) {
      addHidden(concert, 'hiddenDriveFiles', item.driveFileId);
    }
    return deleteMedia(current, artistId, concertId, kind, item.id);
  }

  function deleteMedia(current, artistId, concertId, kind, mediaId) {
    var concert = findConcert(findArtist(current, artistId), concertId);
    if (!concert) {
      return false;
    }
    var before = concert[kind].length;
    concert[kind] = concert[kind].filter(function (item) {
      return item.id !== mediaId;
    });
    return concert[kind].length !== before;
  }

  /* ---------------------------------------------------------- persistence */

  function load() {
    return normalizeData(MusicHub.storage.read(STORAGE_KEY, null));
  }

  function save() {
    MusicHub.storage.write(STORAGE_KEY, data);
  }

  /* ------------------------------------------------------------- rendering */

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

  function button(className, text, onClick) {
    var node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /** A plain folder glyph for concert tiles. */
  function folderIcon() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'folder-card__icon');

    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z');
    svg.appendChild(path);
    return svg;
  }

  /**
   * One heart path, drawn either outlined or filled - so the icon keeps the
   * exact same shape and size in both states (text glyphs don't).
   */
  function heartIcon(filled) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', filled ? 'currentColor' : 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'media-item__heart');

    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 '
      + '7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z');
    svg.appendChild(path);
    return svg;
  }

  // Small hearts floating up in the burst, and how long it lasts overall
  // (the slowest heart's delay + duration, see .heart-burst in style.css).
  var BURST_HEARTS = 12;
  var BURST_MS = 1600;

  /**
   * Plays a burst of hearts over a media item that was just favorited: one
   * big heart pops in the middle while small ones float up and fade.
   * Decorative only - it never takes clicks off the embed underneath.
   */
  function playHeartBurst(wrapper) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    var previous = wrapper.querySelector('.heart-burst');
    if (previous) {
      previous.parentNode.removeChild(previous);
    }

    var burst = el('div', 'heart-burst');
    burst.setAttribute('aria-hidden', 'true');

    var big = heartIcon(true);
    big.setAttribute('class', 'heart-burst__big');
    burst.appendChild(big);

    for (var i = 0; i < BURST_HEARTS; i++) {
      var small = heartIcon(true);
      small.setAttribute('class', 'heart-burst__small');
      // Spread across the item, each a little different in size, drift,
      // tilt and timing so they don't move as one block.
      small.style.left = (8 + Math.random() * 84) + '%';
      small.style.setProperty('--size', (14 + Math.random() * 18) + 'px');
      small.style.setProperty('--drift', ((Math.random() - 0.5) * 60) + 'px');
      small.style.setProperty('--tilt', ((Math.random() - 0.5) * 50) + 'deg');
      small.style.animationDelay = (Math.random() * 350) + 'ms';
      small.style.animationDuration = (900 + Math.random() * 350) + 'ms';
      burst.appendChild(small);
    }

    wrapper.appendChild(burst);
    window.setTimeout(function () {
      if (burst.parentNode) {
        burst.parentNode.removeChild(burst);
      }
    }, BURST_MS);
  }

  /** Sets a heart button to its on/off appearance, in place. */
  function paintHeart(heart, favorite) {
    heart.textContent = '';
    heart.appendChild(heartIcon(favorite));
    heart.classList.toggle('media-item__favorite--on', favorite);
    heart.title = favorite ? 'Remove from favorites' : 'Mark as favorite';
    heart.setAttribute('aria-pressed', favorite ? 'true' : 'false');
    heart.setAttribute('aria-label', heart.title);
  }

  function artistInitial(artist) {
    return (artist.artistName || '?').trim().charAt(0).toUpperCase();
  }

  function renderBreadcrumb() {
    els.breadcrumb.textContent = '';

    var artist = findArtist(data, currentView.artistId);
    var concert = findConcert(artist, currentView.concertId);

    // At the top level there is nowhere to go back to, so no breadcrumb.
    els.breadcrumb.hidden = !artist && currentView.view !== 'favorites';
    if (els.breadcrumb.hidden) {
      return;
    }

    if (currentView.view === 'favorites') {
      els.breadcrumb.appendChild(button('breadcrumb__link', 'Artists', function () {
        go({ view: 'artists' });
      }));
      els.breadcrumb.appendChild(el('span', 'breadcrumb__separator', '›'));
      els.breadcrumb.appendChild(el('span', 'breadcrumb__current', 'Favorites'));
      return;
    }

    var crumbs = [{ label: 'Artists', view: 'artists' }];
    if (artist) {
      crumbs.push({ label: artist.artistName, view: 'concerts' });
    }
    if (concert) {
      crumbs.push({ label: concert.name, view: 'media' });
    }

    crumbs.forEach(function (crumb, index) {
      if (index > 0) {
        els.breadcrumb.appendChild(el('span', 'breadcrumb__separator', '›'));
      }
      if (index === crumbs.length - 1) {
        els.breadcrumb.appendChild(el('span', 'breadcrumb__current', crumb.label));
        return;
      }
      els.breadcrumb.appendChild(button('breadcrumb__link', crumb.label, function () {
        go(crumb.view === 'artists'
          ? { view: 'artists' }
          : { view: 'concerts', artistId: currentView.artistId });
      }));
    });
  }

  function renderFavoritesFolder() {
    var total = countAllFavorites(data);
    var card = el('div', 'folder-card folder-card--favorites');

    var open = button('folder-card__open', '', function () {
      go({ view: 'favorites' });
    });
    open.setAttribute('aria-label', 'Open favorites');

    var icon = heartIcon(true);
    icon.setAttribute('class', 'folder-card__icon folder-card__icon--heart');
    open.appendChild(icon);
    open.appendChild(el('span', 'folder-card__name', 'Favorites'));
    open.appendChild(el('span', 'folder-card__meta',
      total + (total === 1 ? ' item' : ' items')));

    card.appendChild(open);
    els.artistsGrid.appendChild(card);
  }

  /**
   * Empties a folder grid except for its "add" card, which stays first. It is
   * never taken out of the page, so an open artist picker in it stays as is.
   */
  function clearGrid(grid, addCard) {
    while (addCard.nextSibling) {
      grid.removeChild(addCard.nextSibling);
    }
  }

  function renderArtists() {
    clearGrid(els.artistsGrid, els.addArtistCard);
    renderFavoritesFolder();

    // No artists yet: just the Add artist card.
    sortedArtists(data).forEach(function (artist) {
      var card = el('div', 'folder-card');

      var open = button('folder-card__open', '', function () {
        go({ view: 'concerts', artistId: artist.spotifyArtistId });
      });
      open.setAttribute('aria-label', 'Open ' + artist.artistName);

      if (artist.imageUrl) {
        var image = el('img', 'folder-card__avatar');
        image.src = artist.imageUrl;
        image.alt = '';
        image.loading = 'lazy';
        open.appendChild(image);
      } else {
        // Same fallback as the graph page: a plain accent circle.
        open.appendChild(el('span', 'folder-card__avatar folder-card__avatar--fallback',
          artistInitial(artist)));
      }

      open.appendChild(el('span', 'folder-card__name', artist.artistName));
      var count = artist.concerts.length;
      open.appendChild(el('span', 'folder-card__meta',
        count + (count === 1 ? ' concert' : ' concerts')));

      card.appendChild(open);
      card.appendChild(button('icon-button folder-card__delete', '✕', function () {
        confirmRemoval({
          title: 'Delete “' + artist.artistName + '”?',
          text: artist.driveFolderId
            ? 'This removes the artist and every concert inside it from Music Hub. Its folder '
              + 'stays in Google Drive and isn\u2019t synced back - until you choose \u201cShow '
              + 'hidden\u201d under the artists.'
            : 'This deletes the artist and every concert inside it. It only removes them from '
              + 'Music Hub - nothing in Google Drive is touched.',
          action: 'Delete',
        }, function () {
          if (artist.driveFolderId) {
            addHidden(data, 'hiddenDriveFolders', artist.driveFolderId);
          }
          deleteArtist(data, artist.spotifyArtistId);
          save();
          render();
        });
      }));

      els.artistsGrid.appendChild(card);
    });
  }

  function renderConcerts() {
    var artist = findArtist(data, currentView.artistId);
    clearGrid(els.concertsList, els.addConcertTile);
    if (!artist) {
      go({ view: 'artists' }, 'replace');
      return;
    }

    // No concerts yet: just the Add concert tile.
    sortedConcerts(artist).forEach(function (concert) {
      var tile = el('li', 'folder-card folder-card--concert');

      var open = button('folder-card__open', '', function () {
        go({ view: 'media', artistId: artist.spotifyArtistId, concertId: concert.id });
      });
      open.setAttribute('aria-label', 'Open ' + concert.name);
      open.appendChild(folderIcon());
      open.appendChild(el('span', 'folder-card__name', concert.name));

      var mediaCount = concert.images.length + concert.videos.length;
      open.appendChild(el('span', 'folder-card__meta',
        mediaCount + (mediaCount === 1 ? ' item' : ' items')));
      tile.appendChild(open);

      // One from a Drive folder is named after it - renamed in Drive.
      if (!concert.driveFolderId) {
        var rename = button('icon-button folder-card__rename', '✎', function () {
          openConcertDialog('rename', artist.spotifyArtistId, concert);
        });
        rename.title = 'Rename';
        rename.setAttribute('aria-label', 'Rename ' + concert.name);
        tile.appendChild(rename);
      }

      var remove = button('icon-button folder-card__delete', '✕', function () {
        confirmRemoval({
          title: 'Delete “' + concert.name + '”?',
          text: concert.driveFolderId
            ? 'This removes the concert and all of its images and videos from Music Hub. Its '
              + 'folder stays in Google Drive and isn\u2019t synced back - until you choose '
              + '\u201cShow hidden\u201d under the concerts.'
            : 'This deletes the concert and all of its images and videos. It only removes them '
              + 'from Music Hub - nothing in Google Drive is touched.',
          action: 'Delete',
        }, function () {
          if (concert.driveFolderId) {
            addHidden(artist, 'hiddenDriveFolders', concert.driveFolderId);
          }
          deleteConcert(data, artist.spotifyArtistId, concert.id);
          save();
          render();
        });
      });
      remove.title = 'Delete';
      remove.setAttribute('aria-label', 'Delete ' + concert.name);
      tile.appendChild(remove);

      els.concertsList.appendChild(tile);
    });
  }

  function buildMediaItem(kind, item) {
    var wrapper = el('div', 'media-item');

    // Built here from the file id - the pasted markup is never inserted.
    var frame = document.createElement('iframe');
    frame.src = item.embedSrc;
    frame.loading = 'lazy';
    frame.allow = 'autoplay';
    frame.setAttribute('allowfullscreen', '');
    frame.title = kind === 'images' ? 'Image from Google Drive' : 'Video from Google Drive';
    wrapper.appendChild(frame);

    var heart = button('icon-button media-item__favorite', '', function () {
      var favorite = toggleFavorite(data, currentView.artistId, currentView.concertId, kind, item.id);
      save();
      paintHeart(heart, favorite);
      if (favorite) {
        playHeartBurst(wrapper);
      }
      applyMediaView();
    });
    paintHeart(heart, item.favorite);
    wrapper.appendChild(heart);

    wrapper.appendChild(button('icon-button media-item__delete', '✕', function () {
      var what = kind === 'images' ? 'image' : 'video';
      confirmRemoval({
        title: 'Remove this ' + what + '?',
        text: item.driveFileId
          ? 'It only disappears from this concert in Music Hub - the file stays in its Google '
            + 'Drive folder and isn\u2019t synced back, until you choose \u201cShow hidden\u201d below.'
          : 'It only disappears from this concert in Music Hub - the file itself stays in Google Drive.',
        action: 'Remove',
      }, function () {
        forgetMedia(data, currentView.artistId, currentView.concertId, kind, item);
        save();
        // Drop just this element; the rest keep their loaded embeds.
        wrapper.parentNode.removeChild(wrapper);
        mediaNodes[kind] = mediaNodes[kind].filter(function (node) {
          return node.item.id !== item.id;
        });
        applyMediaView();
        // A hidden Drive file can be shown again from here.
        renderUnhideButton();
      });
    }));

    return wrapper;
  }

  /** Renders every item of a section once, in stored order. */
  function renderMediaSection(kind, container) {
    var concert = findConcert(findArtist(data, currentView.artistId), currentView.concertId);
    container.textContent = '';
    mediaNodes[kind] = [];

    if (!concert) {
      return;
    }

    concert[kind].forEach(function (item) {
      var wrapper = buildMediaItem(kind, item);
      mediaNodes[kind].push({ item: item, wrapper: wrapper });
      container.appendChild(wrapper);
    });
  }

  /**
   * Applies the current sort order and favorites filter to what is already on
   * screen: CSS `order` reorders grid items without touching the DOM, and
   * hiding an element keeps its <iframe> loaded. Neither reloads an embed.
   */
  function applyMediaView() {
    ['images', 'videos'].forEach(function (kind) {
      var nodes = mediaNodes[kind];
      var ordered = orderedMedia(nodes.map(function (node) {
        return node.item;
      }), mediaOrder, false);

      nodes.forEach(function (node) {
        node.wrapper.style.order = String(ordered.indexOf(node.item));
        node.wrapper.hidden = mediaFavoritesOnly && !node.item.favorite;
      });
    });

    updateMediaChrome();
  }

  function renderMedia() {
    var artist = findArtist(data, currentView.artistId);
    var concert = findConcert(artist, currentView.concertId);
    if (!concert) {
      go(artist ? { view: 'concerts', artistId: artist.spotifyArtistId } : { view: 'artists' }, 'replace');
      return;
    }
    renderMediaSection('images', els.imagesGrid);
    renderMediaSection('videos', els.videosList);
    applyMediaView();
  }

  /** Section visibility, the empty note and the control states. */
  function updateMediaChrome() {
    var concert = findConcert(findArtist(data, currentView.artistId), currentView.concertId);
    if (!concert) {
      return;
    }

    els.imagesSection.hidden = !orderedMedia(concert.images, mediaOrder, mediaFavoritesOnly).length;
    els.videosSection.hidden = !orderedMedia(concert.videos, mediaOrder, mediaFavoritesOnly).length;

    // Explain an empty screen that only the favorites filter caused.
    var hasMedia = concert.images.length + concert.videos.length > 0;
    var showingNothing = els.imagesSection.hidden && els.videosSection.hidden;
    if (mediaFavoritesOnly && hasMedia && showingNothing) {
      els.mediaNote.textContent = 'No favorites in this concert yet — tap the heart on an item to add one.';
      els.mediaNote.hidden = false;
    } else {
      els.mediaNote.hidden = true;
    }

    // Always the active sort; the arrow and labels say which way it runs,
    // and the title what a click would switch to.
    var newest = mediaOrder === 'newest';
    els.mediaOrder.textContent = 'Date ' + (newest ? '↓' : '↑');
    els.mediaOrder.title = 'Sort by date, ' + (newest ? 'oldest first' : 'newest first');
    els.mediaOrder.setAttribute('aria-label', 'Sorted by date, ' + (newest ? 'newest first' : 'oldest first'));
    Array.prototype.forEach.call(els.mediaFilters.querySelectorAll('.filter-button'), function (btn) {
      var active = (btn.getAttribute('data-media-filter') === 'favorites') === mediaFavoritesOnly;
      btn.classList.toggle('filter-button--active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function renderFavorites() {
    els.favoritesList.textContent = '';
    mediaNodes = { images: [], videos: [] };

    var groups = collectFavorites(data);
    if (!groups.length) {
      els.favoritesEmpty.textContent =
        'No favorites yet — tap the heart on an image or video to add one.';
      els.favoritesEmpty.hidden = false;
      return;
    }
    els.favoritesEmpty.hidden = true;

    groups.forEach(function (group) {
      var section = el('section', 'favorites-group');

      // The header says where these came from, and opens that concert.
      var heading = el('h2', 'favorites-group__title');
      var link = button('favorites-group__link', group.artistName, function () {
        go({ view: 'media', artistId: group.artistId, concertId: group.concertId });
      });
      link.appendChild(el('span', 'favorites-group__separator', '›'));
      link.appendChild(el('span', 'favorites-group__concert', group.concertName));
      heading.appendChild(link);
      section.appendChild(heading);

      var grid = el('div', 'media-grid');
      group.items.forEach(function (entry) {
        var wrapper = buildFavoriteItem(group, entry);
        grid.appendChild(wrapper);
      });
      section.appendChild(grid);

      els.favoritesList.appendChild(section);
    });
  }

  /** Like a media item, but un-hearting here just removes it from this view. */
  function buildFavoriteItem(group, entry) {
    var wrapper = el('div', 'media-item');

    var frame = document.createElement('iframe');
    frame.src = entry.item.embedSrc;
    frame.loading = 'lazy';
    frame.allow = 'autoplay';
    frame.setAttribute('allowfullscreen', '');
    frame.title = entry.kind === 'images' ? 'Image from Google Drive' : 'Video from Google Drive';
    wrapper.appendChild(frame);

    var heart = button('icon-button media-item__favorite', '', function () {
      toggleFavorite(data, group.artistId, group.concertId, entry.kind, entry.item.id);
      save();
      // Only this element goes; the other embeds stay loaded.
      wrapper.hidden = true;
      refreshFavoritesChrome();
    });
    paintHeart(heart, true);
    wrapper.appendChild(heart);

    wrapper.appendChild(button('icon-button media-item__delete', '✕', function () {
      var what = entry.kind === 'images' ? 'image' : 'video';
      confirmRemoval({
        title: 'Remove this ' + what + '?',
        text: 'It is removed from “' + group.concertName + '” in Music Hub - the file itself stays '
          + 'in Google Drive.',
        action: 'Remove',
      }, function () {
        forgetMedia(data, group.artistId, group.concertId, entry.kind, entry.item);
        save();
        wrapper.hidden = true;
        refreshFavoritesChrome();
      });
    }));

    return wrapper;
  }

  /** Hides groups that just lost their last favorite, without a rebuild. */
  function refreshFavoritesChrome() {
    var remaining = 0;

    Array.prototype.forEach.call(els.favoritesList.children, function (section) {
      var grid = section.children[1];
      var visible = Array.prototype.filter.call(grid.children, function (item) {
        return !item.hidden;
      }).length;
      section.hidden = !visible;
      remaining += visible;
    });

    if (!remaining) {
      els.favoritesEmpty.textContent =
        'No favorites yet — tap the heart on an image or video to add one.';
      els.favoritesEmpty.hidden = false;
    }
  }

  /**
   * "Show 2 hidden Drive folders" for a level that has hidden ones.
   * `ownerOf` finds the data holding the list - at click time too, since the
   * Drive sync may have swapped `data` for a fresh copy since.
   */
  function renderUnhide(buttonEl, ownerOf, field, what) {
    var owner = ownerOf();
    var count = owner ? idList(owner[field]).length : 0;
    buttonEl.hidden = !count;
    if (count) {
      buttonEl.textContent = 'Show ' + count + ' hidden Drive ' + what + (count === 1 ? '' : 's');
      buttonEl.onclick = function () {
        var current = ownerOf();
        if (current) {
          delete current[field];
          save();
        }
        render();
        syncDrive();
      };
    }
  }

  /** The one "Show hidden" button, in the Drive box, for the level on screen. */
  function renderUnhideButton() {
    function currentArtist() {
      return findArtist(data, currentView.artistId);
    }
    if (currentView.view === 'media') {
      renderUnhide(els.unhide, function () {
        return findConcert(currentArtist(), currentView.concertId);
      }, 'hiddenDriveFiles', 'file');
    } else if (currentView.view === 'concerts') {
      renderUnhide(els.unhide, currentArtist, 'hiddenDriveFolders', 'folder');
    } else if (currentView.view === 'artists') {
      renderUnhide(els.unhide, function () {
        return data;
      }, 'hiddenDriveFolders', 'folder');
    } else {
      renderUnhide(els.unhide, function () {
        return null;
      });
    }
    // A "Show hidden" button keeps the box up, even after its message faded.
    if (!els.unhide.hidden && els.driveStatus.textContent) {
      showDriveBox();
    }
  }

  function render() {
    renderBreadcrumb();
    renderUnhideButton();

    els.viewArtists.hidden = currentView.view !== 'artists';
    els.viewFavorites.hidden = currentView.view !== 'favorites';
    els.viewConcerts.hidden = currentView.view !== 'concerts';
    els.viewMedia.hidden = currentView.view !== 'media';

    if (currentView.view === 'artists') {
      renderArtists();
    } else if (currentView.view === 'favorites') {
      renderFavorites();
    } else if (currentView.view === 'concerts') {
      renderConcerts();
    } else {
      renderMedia();
    }
  }

  /* ----------------------------------------------------- drive folder sync */

  var driveRunning = false;

  function settingsLink() {
    var link = el('a', 'page-link', 'Settings');
    link.href = '/settings';
    return link;
  }

  /** The status line: text parts (strings, or a node like a Settings link). */
  function showDriveStatus(parts, options) {
    options = options || {};
    els.driveStatus.textContent = '';
    parts.forEach(function (part) {
      els.driveStatus.appendChild(typeof part === 'string' ? document.createTextNode(part) : part);
    });
    els.driveSync.hidden = !options.canSync;
    els.driveSync.disabled = driveRunning;
    // Its arrows turn while a sync runs, like every page's refresh button.
    els.driveSync.setAttribute('aria-busy', String(driveRunning));

    var unmatched = options.unmatched || [];
    els.driveUnmatched.textContent = unmatched.length
      ? 'No followed artist found for ' + (unmatched.length === 1 ? 'this folder: ' : 'these folders: ')
        + unmatched.join(', ') + '. Name a folder like the artist on Spotify.'
      : '';
    els.driveUnmatched.hidden = !unmatched.length;

    els.driveShare.textContent = options.shareTip || '';
    els.driveShare.hidden = !options.shareTip;
    showDriveBox();
  }

  /**
   * The Drive box stays up while it has a button (the sync button, or
   * "Show hidden"); a message on its own fades out like every note
   * (notice.js).
   */
  function showDriveBox() {
    var withButton = !els.driveSync.hidden || !els.unhide.hidden;
    MusicHub.notice[withButton ? 'hold' : 'flash'](els.drive);
  }

  function hasDriveMedia(current) {
    return current.artists.some(function (artist) {
      return artist.concerts.some(function (concert) {
        return concert.images.concat(concert.videos).some(function (item) {
          return !!item.driveFileId;
        });
      });
    });
  }

  /**
   * Reads the Gallery folder from Drive and merges it in - on every visit and
   * on its refresh button. Needs the Google login with folder access and the followed
   * artists (for the names); says so on the status line when one is missing.
   */
  function syncDrive() {
    var google = MusicHub.google;
    if (!google || !google.isConnected()) {
      showDriveStatus(['Log in to Google in ', settingsLink(),
        ' to fill the Gallery from a folder in your Google Drive.']);
      return;
    }
    if (!google.hasFolderAccess()) {
      showDriveStatus(['Log out of Google and in again in ', settingsLink(),
        ' to let the Gallery read its folder in your Google Drive.']);
      return;
    }
    var followed = MusicHub.followedArtists.list();
    if (!followed) {
      showDriveStatus([MusicHub.followedArtists.MISSING_MESSAGE]);
      return;
    }
    if (driveRunning) {
      return;
    }

    driveRunning = true;
    showDriveStatus(['Syncing with your Google Drive\u2026'], { canSync: true });
    var folderId = MusicHub.storage.getSetting(GALLERY_FOLDER_SETTING, null);

    google.findFolder(folderId, DEFAULT_GALLERY_FOLDER).then(function (root) {
      if (!root) {
        return { root: null };
      }
      return fetchDriveTree(root).then(function (tree) {
        return { root: root, tree: tree };
      });
    }).then(function (result) {
      driveRunning = false;
      if (!result.root) {
        showDriveStatus(folderId
          ? ['The Gallery folder set in ', settingsLink(), ' wasn\u2019t found in your Google Drive.']
          : ['No folder called \u201c' + DEFAULT_GALLERY_FOLDER + '\u201d at the top of your My Drive '
            + 'yet - create one, with a folder per artist inside and a folder per concert in those, '
            + 'or pick another folder in ', settingsLink(), '.'], { canSync: true });
        return;
      }

      // Merged into what's stored now - another tab may have changed it -
      // and back in stored form, so an unchanged folder compares equal.
      var stored = JSON.stringify(load());
      var fresh = load();
      var unmatched = mergeDriveTree(fresh, result.tree, followed);
      fresh = normalizeData(fresh);
      if (JSON.stringify(fresh) !== stored) {
        MusicHub.storage.write(STORAGE_KEY, fresh);
      }
      // Only swapped in (and re-rendered) when it differs from what's shown:
      // the buttons on screen hold on to the objects they were drawn from.
      if (JSON.stringify(fresh) !== JSON.stringify(data)) {
        data = fresh;
        go(resolveView(currentView, data), 'replace');
      }

      showDriveStatus(['Synced with \u201c' + result.root.name + '\u201d in your Google Drive.'], {
        canSync: true,
        unmatched: unmatched,
        shareTip: !result.root.shared && hasDriveMedia(data)
          ? 'Tip: share \u201c' + result.root.name + '\u201d in Google Drive as \u201cAnyone with the '
            + 'link can view\u201d, so its images and videos also show where you aren\u2019t logged in '
            + 'to Google (Safari on an iPhone, say).'
          : '',
      });
    }, function (err) {
      driveRunning = false;
      console.warn('Could not read the Gallery folder', err);
      showDriveStatus(['Couldn\u2019t read your Google Drive: ' + (err && err.message ? err.message : 'unknown error')],
        { canSync: true });
    });
  }

  /* ------------------------------------------------------- history & URLs */

  /** Each level has its own URL, so browser back/forward walks the folders. */
  function viewToUrl(view) {
    var params = new URLSearchParams();
    if (view.view === 'favorites') {
      return window.location.pathname + '?view=favorites';
    }
    if (view.artistId) {
      params.set('artist', view.artistId);
    }
    if (view.concertId) {
      params.set('concert', view.concertId);
    }
    var query = params.toString();
    return window.location.pathname + (query ? '?' + query : '');
  }

  function viewFromUrl() {
    var params = new URLSearchParams(window.location.search);
    return {
      view: params.get('view'),
      artistId: params.get('artist'),
      concertId: params.get('concert'),
    };
  }

  /**
   * Turns a requested artist/concert into a view that actually exists - a
   * folder may have been deleted since that history entry was created.
   */
  function resolveView(target, current) {
    var source = current || data;
    if (target && target.view === 'favorites') {
      return { view: 'favorites', artistId: null, concertId: null };
    }

    var artist = target && target.artistId ? findArtist(source, target.artistId) : null;
    if (!artist) {
      return { view: 'artists', artistId: null, concertId: null };
    }

    var concert = target.concertId ? findConcert(artist, target.concertId) : null;
    if (!concert) {
      return { view: 'concerts', artistId: artist.spotifyArtistId, concertId: null };
    }

    return { view: 'media', artistId: artist.spotifyArtistId, concertId: concert.id };
  }

  /** mode: 'push' (default), 'replace', or 'none' for back/forward. */
  function go(next, mode) {
    currentView = {
      view: next.view,
      artistId: next.artistId || null,
      concertId: next.concertId || null,
    };
    closeArtistPicker();

    if (mode !== 'none') {
      var entry = { musicHubView: currentView };
      if (mode === 'replace') {
        window.history.replaceState(entry, '', viewToUrl(currentView));
      } else {
        window.history.pushState(entry, '', viewToUrl(currentView));
      }
    }

    render();
  }

  /* --------------------------------------------------------- artist picker */

  function closeArtistPicker() {
    if (els.artistPanel) {
      els.artistPanel.hidden = true;
      els.addArtistToggle.setAttribute('aria-expanded', 'false');
    }
  }

  function renderArtistPicker() {
    els.artistList.textContent = '';

    if (!followedArtists) {
      MusicHub.notice.flash(els.pickerMessage, MusicHub.followedArtists.MISSING_MESSAGE);
      return;
    }

    var query = els.artistSearch.value.trim().toLowerCase();
    var available = followedArtists.filter(function (artist) {
      return !findArtist(data, artist.id);
    });

    if (!available.length) {
      MusicHub.notice.hold(els.pickerMessage, 'No more artists to add');
      return;
    }

    var matching = available.filter(function (artist) {
      return !query || artist.name.toLowerCase().indexOf(query) !== -1;
    });

    if (!matching.length) {
      MusicHub.notice.hold(els.pickerMessage, 'No followed artist matches "' + els.artistSearch.value.trim() + '"');
      return;
    }
    MusicHub.notice.hide(els.pickerMessage);

    matching.slice(0, 50).forEach(function (artist) {
      var item = el('li', 'picker__item');
      var choose = button('picker__button', '', function () {
        addArtist(data, artist);
        save();
        // Stay on the artists view - the picker stays open so several
        // artists can be added in a row, and the new folder appears behind it.
        render();
        renderArtistPicker();
      });

      if (artist.imageUrl) {
        var image = el('img', 'picker__avatar');
        image.src = artist.imageUrl;
        image.alt = '';
        image.loading = 'lazy';
        choose.appendChild(image);
      } else {
        choose.appendChild(el('span', 'picker__avatar picker__avatar--fallback',
          (artist.name || '?').charAt(0).toUpperCase()));
      }
      choose.appendChild(el('span', null, artist.name));

      item.appendChild(choose);
      els.artistList.appendChild(item);
    });
  }

  function openArtistPicker() {
    els.artistPanel.hidden = false;
    els.addArtistToggle.setAttribute('aria-expanded', 'true');
    els.artistSearch.value = '';
    els.artistSearch.focus();
    // Fetched by the navbar's refresh button only - never from here.
    followedArtists = MusicHub.followedArtists.list();
    renderArtistPicker();
  }


  /* ------------------------------------------------------ confirm modal */

  // What the confirm dialog's button does - set each time it opens.
  var pendingRemoval = null;

  /**
   * Asks before something is removed, in the page's own dialog rather than
   * the browser's. `onConfirm` runs only when the user confirms.
   */
  function confirmRemoval(options, onConfirm) {
    pendingRemoval = onConfirm;
    els.confirmTitle.textContent = options.title;
    els.confirmText.textContent = options.text;
    els.confirmSubmit.textContent = options.action || 'Delete';
    els.confirmDialog.showModal();
    // Cancel is the safe default for Enter.
    els.confirmCancel.focus();
  }

  function submitConfirmDialog(event) {
    event.preventDefault();
    var action = pendingRemoval;
    pendingRemoval = null;
    els.confirmDialog.close();
    if (action) {
      action();
    }
  }

  /* ------------------------------------------------------------------ init */

  /* --------------------------------------------------- concert name modal */

  // Same dialog for naming a new concert and renaming an existing one.
  var concertDialogMode = 'add';
  var renameTarget = null;

  function openConcertDialog(mode, artistId, concert) {
    concertDialogMode = mode;
    renameTarget = mode === 'rename' ? { artistId: artistId, concertId: concert.id } : null;

    els.concertTitle.textContent = mode === 'rename' ? 'Rename concert' : 'Add concert';
    els.concertSubmit.textContent = mode === 'rename' ? 'Save' : 'Add';
    els.concertInput.value = mode === 'rename' ? concert.name : '';
    els.concertError.hidden = true;

    els.concertDialog.showModal();
    els.concertInput.focus();
    els.concertInput.select();
  }

  function submitConcertDialog(event) {
    event.preventDefault();

    var ok;
    if (concertDialogMode === 'rename') {
      ok = renameTarget
        && renameConcert(data, renameTarget.artistId, renameTarget.concertId, els.concertInput.value);
    } else {
      ok = !!addConcert(data, currentView.artistId, els.concertInput.value);
    }

    if (!ok) {
      MusicHub.notice.flash(els.concertError, 'Enter a name for this concert');
      return;
    }

    save();
    render();
    renameTarget = null;
    els.concertDialog.close();
  }

  /* ----------------------------------------------------------- media modal */

  function openMediaDialog() {
    els.mediaInput.value = '';
    els.mediaError.hidden = true;
    els.mediaDialog.showModal();
    els.mediaInput.focus();
  }

  function submitMediaDialog(event) {
    event.preventDefault();

    // One dialog for both; the switch decides which section they land in.
    var mediaKind = els.mediaIsVideo.checked ? 'videos' : 'images';
    var result = addMedia(data, currentView.artistId, currentView.concertId, mediaKind, els.mediaInput.value);
    if (result.added) {
      save();
      els.mediaInput.value = '';
      render();
    }

    // Anything that didn't go in is reported, and the dialog stays open so it
    // can be corrected - silently doing nothing would look broken.
    var notes = [];
    if (result.failed) {
      notes.push(result.failed === 1
        ? "Couldn't recognize 1 of the pasted lines"
        : "Couldn't recognize " + result.failed + ' of the pasted lines');
    }
    if (result.duplicates) {
      var what = mediaKind === 'images' ? 'image' : 'video';
      notes.push(result.duplicates === 1
        ? 'That ' + what + ' is already in this concert'
        : result.duplicates + ' of them are already in this concert');
    }

    if (notes.length) {
      els.mediaError.textContent = notes.join(' · ');
      // Duplicates alone are a note, not an error.
      els.mediaError.className = result.failed ? 'form-error' : 'form-message';
      MusicHub.notice.flash(els.mediaError);
      return;
    }

    els.mediaError.hidden = true;
    els.mediaDialog.close();
  }

  document.addEventListener('DOMContentLoaded', function () {
    els.breadcrumb = document.getElementById('breadcrumb');
    if (!els.breadcrumb) {
      return;
    }

    els.viewArtists = document.getElementById('view-artists');
    els.viewFavorites = document.getElementById('view-favorites');
    els.favoritesList = document.getElementById('favorites-list');
    els.favoritesEmpty = document.getElementById('favorites-empty');
    els.viewConcerts = document.getElementById('view-concerts');
    els.viewMedia = document.getElementById('view-media');
    els.artistsGrid = document.getElementById('artists-grid');
    els.addArtistCard = document.getElementById('add-artist');
    els.addArtistToggle = document.getElementById('add-artist-toggle');
    els.concertsList = document.getElementById('concerts-list');
    els.addConcertTile = document.getElementById('add-concert-tile');
    els.imagesGrid = document.getElementById('images-grid');
    els.videosList = document.getElementById('videos-list');
    els.imagesSection = document.getElementById('images-section');
    els.videosSection = document.getElementById('videos-section');
    els.mediaNote = document.getElementById('media-note');
    els.mediaOrder = document.getElementById('media-order');
    els.mediaFilters = document.getElementById('media-filters');
    els.artistPanel = document.getElementById('add-artist-panel');
    els.concertDialog = document.getElementById('concert-dialog');
    els.concertTitle = document.getElementById('concert-dialog-title');
    els.concertInput = document.getElementById('concert-name-input');
    els.concertError = document.getElementById('concert-name-error');
    els.concertSubmit = document.getElementById('concert-submit');
    els.mediaDialog = document.getElementById('media-dialog');
    els.confirmDialog = document.getElementById('confirm-dialog');
    els.confirmTitle = document.getElementById('confirm-dialog-title');
    els.confirmText = document.getElementById('confirm-dialog-text');
    els.confirmSubmit = document.getElementById('confirm-submit');
    els.confirmCancel = document.getElementById('confirm-cancel');
    els.mediaTitle = document.getElementById('media-dialog-title');
    els.mediaInput = document.getElementById('media-input');
    els.mediaError = document.getElementById('media-error');
    els.mediaIsVideo = document.getElementById('media-is-video');
    els.artistSearch = document.getElementById('artist-search');
    els.artistList = document.getElementById('artist-picker');
    els.pickerMessage = document.getElementById('artist-picker-message');
    els.drive = document.getElementById('gallery-drive');
    els.driveStatus = document.getElementById('gallery-drive-status');
    els.driveSync = document.getElementById('gallery-drive-sync');
    els.driveUnmatched = document.getElementById('gallery-drive-unmatched');
    els.driveShare = document.getElementById('gallery-drive-share');
    els.unhide = document.getElementById('gallery-unhide');

    data = load();

    els.addArtistToggle.addEventListener('click', function () {
      if (els.artistPanel.hidden) {
        openArtistPicker();
      } else {
        closeArtistPicker();
      }
    });
    els.artistSearch.addEventListener('input', renderArtistPicker);
    // The navbar fetched a new list while the picker is open - and the
    // Drive folder's names can be matched now, if they couldn't before.
    document.addEventListener(MusicHub.followedArtists.CHANGE_EVENT, function () {
      if (!els.artistPanel.hidden) {
        followedArtists = MusicHub.followedArtists.list();
        renderArtistPicker();
      }
      syncDrive();
    });
    els.driveSync.addEventListener('click', syncDrive);

    document.addEventListener('click', function (event) {
      var container = document.getElementById('add-artist');
      if (!els.artistPanel.hidden && container && !container.contains(event.target)) {
        closeArtistPicker();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !els.artistPanel.hidden) {
        closeArtistPicker();
      }
    });

    document.getElementById('add-concert').addEventListener('click', function () {
      openConcertDialog('add', currentView.artistId, null);
    });
    // The X and a click outside close these modals too (navbar.js).
    document.getElementById('confirm-form').addEventListener('submit', submitConfirmDialog);
    els.confirmCancel.addEventListener('click', function () {
      els.confirmDialog.close();
    });
    // However it closes - Cancel, Escape, the X, a click outside it - nothing is removed.
    els.confirmDialog.addEventListener('close', function () {
      pendingRemoval = null;
    });

    document.getElementById('concert-form').addEventListener('submit', submitConcertDialog);
    document.getElementById('concert-cancel').addEventListener('click', function () {
      els.concertDialog.close();
    });

    document.getElementById('add-media').addEventListener('click', function () {
      openMediaDialog();
    });

    els.mediaOrder.addEventListener('click', function () {
      mediaOrder = mediaOrder === 'newest' ? 'oldest' : 'newest';
      applyMediaView();
    });

    els.mediaFilters.addEventListener('click', function (event) {
      var target = event.target.closest('.filter-button');
      if (!target) {
        return;
      }
      mediaFavoritesOnly = target.getAttribute('data-media-filter') === 'favorites';
      applyMediaView();
    });
    document.getElementById('media-form').addEventListener('submit', submitMediaDialog);
    document.getElementById('media-cancel').addEventListener('click', function () {
      els.mediaDialog.close();
    });

    window.addEventListener('popstate', function (event) {
      var target = event.state && event.state.musicHubView
        ? event.state.musicHubView
        : viewFromUrl();
      go(resolveView(target), 'none');
    });

    // The URL decides the starting level - including the graph page's
    // ?artist=<spotifyArtistId> deep link.
    go(resolveView(viewFromUrl()), 'replace');
    syncDrive();
  });

  // Exposed for tests.
  MusicHub.concertHistory = {
    normalizeData: normalizeData,
    resolveView: resolveView,
    viewToUrl: viewToUrl,
    addArtist: addArtist,
    addConcert: addConcert,
    renameConcert: renameConcert,
    deleteArtist: deleteArtist,
    deleteConcert: deleteConcert,
    addMedia: addMedia,
    deleteMedia: deleteMedia,
    forgetMedia: forgetMedia,
    mergeDriveTree: mergeDriveTree,
    foldName: foldName,
    extractDriveId: extractDriveId,
    parseDriveLines: parseDriveLines,
    sortedArtists: sortedArtists,
    sortedConcerts: sortedConcerts,
    orderedMedia: orderedMedia,
    toggleFavorite: toggleFavorite,
    countFavorites: countFavorites,
    collectFavorites: collectFavorites,
    countAllFavorites: countAllFavorites,
    findArtist: findArtist,
    findConcert: findConcert,
  };
})(window.MusicHub);
