/*
 * Followed Artists Graph: a force-directed graph of the artists the user
 * follows, connected by Last.fm's "fans also like" similarity data, with an
 * optional set of recommended (unfollowed) artists drawn around it.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var STORAGE_KEY = 'followedArtistsGraph';
  var HISTORY_KEY = 'concertHistory';
  // ~4.5 requests/second, safely under Last.fm's limit of 5.
  var REQUEST_DELAY_MS = 220;
  var RECOMMENDATION_COUNT = 20;

  var els = {};
  var graph = null;
  var recommended = { nodes: [], links: [] };
  var showRecommended = false;
  var busy = false;
  var graphVisible = false;
  // The live d3 selections and simulation, so recommendations can be added
  // and removed without rebuilding the whole graph.
  var view = null;
  // Position within the recommended artists while stepping through them.
  var recommendIndex = -1;
  // Show only artists that have concert folders in Concert History.
  var concertsOnly = false;
  // Draw genre outlines around the clusters.
  var showGenres = false;
  // When set, only this genre's artists are shown.
  var focusedGenre = null;
  // Which nodes the current filters leave on screen, by id.
  var visibleIds = null;
  var toastTimer = null;
  // Estimated time left, shown in the progress bar.
  var eta = null;
  // The node whose connections are being shown on their own, if any.
  var focusedId = null;
  var selection = null;
  // The run currently in flight, if any - so it can be cancelled.
  var activeRun = null;
  // Pending timeout of the node-by-node reveal after a (re)build.
  var revealTimer = null;
  // The running move into (or out of) the genre layout, if any.
  var layoutTween = null;
  // Maps an artist's raw Last.fm tags to merged genre names; rebuilt from the
  // whole library whenever the graph is (re)drawn. Stored tags stay raw.
  var mergeGenres = function (genres) {
    return genres || [];
  };

  function startRun(kind) {
    activeRun = { kind: kind, cancelled: false, controller: new AbortController() };
    return activeRun;
  }

  function finishRun(run) {
    if (activeRun === run) {
      activeRun = null;
    }
  }

  function cancelRun() {
    if (!activeRun) {
      return;
    }
    activeRun.cancelled = true;
    activeRun.controller.abort();
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /* ------------------------------------------------------- pure data layer */

  /** Last.fm matches by name, so names are compared loosely. */
  function normalizeArtistName(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/ä/g, 'a')
      .replace(/ö/g, 'o')
      .replace(/ü/g, 'u')
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/['’`´.]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function emptyGraph() {
    return { lastGeneratedAt: null, artists: [], edges: [] };
  }

  function normalizeGraph(raw) {
    if (!raw || !Array.isArray(raw.artists)) {
      return emptyGraph();
    }
    return {
      lastGeneratedAt: raw.lastGeneratedAt || null,
      genresLoadedAt: raw.genresLoadedAt || null,
      artists: raw.artists.filter(Boolean).map(function (artist) {
        return {
          spotifyArtistId: artist.spotifyArtistId,
          name: artist.name || '',
          imageUrl: artist.imageUrl || null,
          spotifyUrl: artist.spotifyUrl || null,
          genres: Array.isArray(artist.genres) ? artist.genres : [],
          similarArtistNames: Array.isArray(artist.similarArtistNames) ? artist.similarArtistNames : [],
        };
      }),
      edges: Array.isArray(raw.edges) ? raw.edges.filter(function (edge) {
        return Array.isArray(edge) && edge.length === 2;
      }) : [],
    };
  }

  /**
   * An edge whenever either artist's similar list names the other - Last.fm's
   * similarity isn't symmetric, so both directions are checked.
   */
  function computeEdges(artists) {
    var lists = artists.map(function (artist) {
      var names = {};
      (artist.similarArtistNames || []).forEach(function (name) {
        names[normalizeArtistName(name)] = true;
      });
      return { id: artist.spotifyArtistId, key: normalizeArtistName(artist.name), names: names };
    });

    var edges = [];
    for (var i = 0; i < lists.length; i++) {
      for (var j = i + 1; j < lists.length; j++) {
        if (lists[i].names[lists[j].key] || lists[j].names[lists[i].key]) {
          edges.push([lists[i].id, lists[j].id]);
        }
      }
    }
    return edges;
  }

  /**
   * Every similar-artist name that isn't already followed, deduped, each
   * remembering which followed artists suggested it (those become the dashed
   * edges).
   */
  function buildRecommendationPool(artists) {
    var followed = {};
    artists.forEach(function (artist) {
      followed[normalizeArtistName(artist.name)] = true;
    });

    var byKey = {};
    var pool = [];
    artists.forEach(function (artist) {
      (artist.similarArtistNames || []).forEach(function (name) {
        var key = normalizeArtistName(name);
        if (!key || followed[key]) {
          return;
        }
        if (!byKey[key]) {
          byKey[key] = { name: name, sourceIds: [] };
          pool.push(byKey[key]);
        }
        if (byKey[key].sourceIds.indexOf(artist.spotifyArtistId) === -1) {
          byKey[key].sourceIds.push(artist.spotifyArtistId);
        }
      });
    });

    return pool;
  }

  // Node sizes in graph units: followed artists a little bigger than the
  // recommendations around them.
  var FOLLOWED_RADIUS = 44;
  var RECOMMENDED_RADIUS = 34;

  /* -------------------------------------------------------- genre merging */

  /*
   * Last.fm tags are user-typed, so one genre turns up under several names:
   * "hip hop" / "hip-hop" / "hiphop", or "usa" / "united states" / "american".
   * Spelling variants collapse on their own once case, accents, spaces and
   * punctuation are squashed out (see genreKey); true synonyms need listing.
   * Each row: the label shown, then every squashed spelling that means it.
   */
  var GENRE_SYNONYMS = [
    ['USA', 'usa', 'us', 'unitedstates', 'unitedstatesofamerica', 'america', 'american'],
    ['UK', 'uk', 'unitedkingdom', 'greatbritain', 'britain', 'british', 'england', 'english'],
    ['Germany', 'germany', 'german', 'deutsch', 'deutschland'],
    ['Austria', 'austria', 'austrian', 'osterreich'],
    ['Switzerland', 'switzerland', 'swiss', 'schweiz'],
    ['France', 'france', 'french'],
    ['Italy', 'italy', 'italian'],
    ['Spain', 'spain', 'spanish'],
    ['Netherlands', 'netherlands', 'dutch', 'holland'],
    ['Belgium', 'belgium', 'belgian'],
    ['Ireland', 'ireland', 'irish'],
    ['Scotland', 'scotland', 'scottish'],
    ['Sweden', 'sweden', 'swedish'],
    ['Norway', 'norway', 'norwegian'],
    ['Denmark', 'denmark', 'danish'],
    ['Finland', 'finland', 'finnish'],
    ['Iceland', 'iceland', 'icelandic'],
    ['Poland', 'poland', 'polish'],
    ['Canada', 'canada', 'canadian'],
    ['Australia', 'australia', 'australian'],
    ['New Zealand', 'newzealand', 'nz'],
    ['Japan', 'japan', 'japanese'],
    ['South Korea', 'southkorea', 'korea', 'korean'],
    ['Brazil', 'brazil', 'brazilian'],
    ['Mexico', 'mexico', 'mexican'],
    ['german hip hop', 'germanhiphop', 'germanrap', 'deutschrap', 'deutscherrap',
      'deutschhiphop', 'deutscherhiphop'],
    ['R&B', 'randb', 'rnb', 'rhythmandblues'],
    ['drum and bass', 'drumandbass', 'dnb', 'dandb'],
    ['rock and roll', 'rockandroll', 'rocknroll'],
    ['EDM', 'edm', 'electronicdancemusic'],
    ['electronic', 'electronic', 'electronica'],
    ['alternative', 'alternative', 'alt'],
    ['alternative rock', 'alternativerock', 'altrock'],
    ['soundtrack', 'soundtrack', 'soundtracks', 'ost'],
    ['60s', '60s', '1960s', 'sixties'],
    ['70s', '70s', '1970s', 'seventies'],
    ['80s', '80s', '1980s', 'eighties'],
    ['90s', '90s', '1990s', 'nineties'],
    ['2000s', '2000s', '00s', 'noughties'],
    ['2010s', '2010s', '10s'],
  ];

  // Squashed spelling -> its synonym row's first spelling, and that -> label.
  var GENRE_ALIAS = {};
  var GENRE_LABEL = {};
  GENRE_SYNONYMS.forEach(function (row) {
    GENRE_LABEL[row[1]] = row[0];
    row.slice(1).forEach(function (key) {
      GENRE_ALIAS[key] = row[1];
    });
  });

  /**
   * A genre with everything that only varies in spelling squashed out:
   * lowercased, accents dropped, "&" and a lone "n" read as "and", then
   * every space, hyphen and other punctuation removed. So "Hip-Hop",
   * "hip hop" and "hiphop" all come out as "hiphop", and "Drum 'n' Bass"
   * as "drumandbass".
   */
  function genreKey(name) {
    var key = String(name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ')
      .replace(/(^|[^a-z0-9])n(?=[^a-z0-9]|$)/g, '$1and')
      .replace(/[^a-z0-9]/g, '');
    return GENRE_ALIAS[key] || key;
  }

  /**
   * Returns a function that turns an artist's genre list into merged,
   * de-duplicated labels, keeping the order (strongest tag first). A listed
   * synonym gets its fixed label; any other genre is shown in whichever
   * spelling the library uses most, so every artist agrees on one name.
   */
  function genreMerger(artists) {
    var spellings = {};
    (artists || []).forEach(function (artist) {
      (artist.genres || []).forEach(function (genre) {
        var key = genreKey(genre);
        if (!key) {
          return;
        }
        var name = String(genre).trim();
        spellings[key] = spellings[key] || {};
        spellings[key][name] = (spellings[key][name] || 0) + 1;
      });
    });

    var labels = {};
    Object.keys(spellings).forEach(function (key) {
      labels[key] = GENRE_LABEL[key] || Object.keys(spellings[key]).sort(function (a, b) {
        // Most used first; ties settled alphabetically so it's stable.
        return spellings[key][b] - spellings[key][a] || (a < b ? -1 : a > b ? 1 : 0);
      })[0];
    });

    return function (genres) {
      var seen = {};
      var merged = [];
      (genres || []).forEach(function (genre) {
        var key = genreKey(genre);
        if (!key || seen[key]) {
          return;
        }
        seen[key] = true;
        merged.push(labels[key] || GENRE_LABEL[key] || String(genre).trim());
      });
      return merged;
    };
  }

  /**
   * Artists bucketed by their primary genre (Spotify lists them roughly by
   * relevance). Genres are very granular, so groups below `minSize` are left
   * out rather than drawing a blob around every two-artist niche.
   */
  // How many of an artist's top genres it counts towards: enough that an
  // artist sits in every area it plausibly belongs to, few enough that the
  // broad tags ("rock", "indie") don't swallow the whole graph.
  var AREA_GENRES = 3;

  function areaGenres(node) {
    return (node.genres || []).slice(0, AREA_GENRES);
  }

  /**
   * The genre areas. An artist counts towards each of its top genres when
   * deciding which genres are big enough for an area, but is placed - and
   * outlined - only in one: its strongest genre that has an area. Otherwise
   * every multi-genre artist would drag two areas into each other.
   */
  function genreGroups(nodes, minSize) {
    var threshold = minSize || 3;
    var followed = (nodes || []).filter(function (node) {
      return node.followed;
    });

    var tally = {};
    followed.forEach(function (node) {
      areaGenres(node).forEach(function (genre) {
        tally[genre] = (tally[genre] || 0) + 1;
      });
    });

    var byGenre = {};
    followed.forEach(function (node) {
      var home = areaGenres(node).filter(function (genre) {
        return tally[genre] >= threshold;
      })[0];
      if (!home) {
        return;
      }
      if (!byGenre[home]) {
        byGenre[home] = [];
      }
      byGenre[home].push(node);
    });

    return Object.keys(byGenre)
      .sort(function (a, b) {
        return byGenre[b].length - byGenre[a].length;
      })
      .map(function (genre) {
        return { genre: genre, nodes: byGenre[genre] };
      });
  }

  /** Followed artists that ended up without a single connection. */
  function isolatedArtistIds(artists, edges) {
    var connected = {};
    (edges || []).forEach(function (edge) {
      connected[edge[0]] = true;
      connected[edge[1]] = true;
    });

    var isolated = {};
    (artists || []).forEach(function (artist) {
      if (!connected[artist.spotifyArtistId]) {
        isolated[artist.spotifyArtistId] = true;
      }
    });
    return isolated;
  }

  /**
   * How strongly a candidate is preferred. The number of followed artists it
   * connects to matters most; reaching one that currently has no connections
   * at all is a further bonus on top, deciding between candidates of similar
   * reach rather than overriding it.
   */
  function candidateWeight(candidate, isolated) {
    var reach = (candidate.sourceIds || []).length;
    var isolatedHits = 0;
    (candidate.sourceIds || []).forEach(function (id) {
      if (isolated && isolated[id]) {
        isolatedHits += 1;
      }
    });
    return 1 + 10 * reach + 3 * isolatedHits;
  }

  /**
   * Random selection without replacement, weighted by `weightFn` - so the set
   * still changes every time the toggle is switched on, while the artists that
   * connect the most (and the isolated ones especially) come up far more often.
   */
  function pickWeighted(pool, count, weightFn, random) {
    var rand = random || Math.random;
    var remaining = pool.slice();
    var picked = [];

    while (remaining.length && picked.length < count) {
      var weights = remaining.map(weightFn);
      var total = weights.reduce(function (sum, weight) {
        return sum + weight;
      }, 0);

      var threshold = rand() * total;
      var index = 0;
      while (index < remaining.length - 1 && threshold >= weights[index]) {
        threshold -= weights[index];
        index += 1;
      }

      picked.push(remaining.splice(index, 1)[0]);
    }

    return picked;
  }

  /** How many concert folders each artist has in Concert History. */
  function concertCounts(history) {
    var counts = {};
    ((history && history.artists) || []).forEach(function (artist) {
      counts[artist.spotifyArtistId] = (artist.concerts || []).length;
    });
    return counts;
  }

  /* ---------------------------------------------------------- persistence */

  function load() {
    return normalizeGraph(MusicHub.storage.read(STORAGE_KEY, null));
  }

  function save() {
    MusicHub.storage.write(STORAGE_KEY, graph);
  }

  /* --------------------------------------------------------------- status */

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

  /** A note that fades out on its own, shown over the graph. */
  function showToast(text) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = text;
    els.toast.classList.remove('graph-toast--fading');
    els.toast.hidden = false;

    toastTimer = window.setTimeout(function () {
      els.toast.classList.add('graph-toast--fading');
      toastTimer = window.setTimeout(function () {
        els.toast.hidden = true;
        els.toast.classList.remove('graph-toast--fading');
      }, 600);
    }, 4000);
  }

  function hideToast() {
    window.clearTimeout(toastTimer);
    els.toast.hidden = true;
    els.toast.classList.remove('graph-toast--fading');
  }

  function setMessage(text) {
    // With a graph on screen the page's own message area is hidden behind it,
    // so notes appear as a toast in the controls instead.
    if (graphVisible) {
      els.message.hidden = true;
      if (text) {
        showToast(text);
      } else {
        hideToast();
      }
      return;
    }

    hideToast();
    if (text) {
      els.message.textContent = text;
      els.message.hidden = false;
    } else {
      els.message.hidden = true;
    }
  }

  function showFailed(names) {
    if (!names.length) {
      els.failedNotice.hidden = true;
      return;
    }
    els.failedText.textContent = "Couldn't fetch similarity data for: " + names.join(', ');
    els.failedNotice.hidden = false;
  }

  function setBusy(state) {
    busy = state;
    updateOverlays();
    els.generate.disabled = state;
    els.update.disabled = state;
    els.clear.disabled = state;
    els.concertsToggle.disabled = state;
    updateModeToggles();
  }

  function updateModeToggles() {
    // While recommendations are being fetched the toggle stays live, so
    // pressing it again can cancel that run.
    var recommendBusy = busy && !(activeRun && activeRun.kind === 'recommend');
    els.recommendToggle.disabled = recommendBusy;
    els.genresToggle.disabled = busy;
  }

  /**
   * Genre outlines don't mix with either of the other two - a hull around a
   * filtered-down cluster says nothing. Recommendations and the concerts
   * filter work together, so neither switches the other off.
   */
  function switchOffOtherModes(keep) {
    if (keep !== 'genres' && showGenres) {
      els.genresToggle.checked = false;
      setShowGenres(false);
    }

    if (keep !== 'genres') {
      return;
    }

    if (showRecommended) {
      showRecommended = false;
      recommended = { nodes: [], links: [] };
      els.recommendToggle.checked = false;
      removeRecommendedFromGraph();
    }
    if (concertsOnly) {
      concertsOnly = false;
      els.concertsToggle.checked = false;
      applyVisibility();
    }
  }

  function renderControls() {
    var hasGraph = !!graph.lastGeneratedAt;
    els.generate.hidden = hasGraph;
    els.update.hidden = !hasGraph;
    els.clear.hidden = !hasGraph;

    if (graph.lastGeneratedAt) {
      els.lastGenerated.textContent = 'Last generated: '
        + new Intl.DateTimeFormat('de-DE', {
          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        }).format(new Date(graph.lastGeneratedAt))
        // Followed artists only - recommendations are kept out of graph.artists.
        + ' · ' + graph.artists.length + (graph.artists.length === 1 ? ' artist' : ' artists');
      els.lastGenerated.hidden = false;
    } else {
      els.lastGenerated.hidden = true;
    }
  }

  /* -------------------------------------------------------------- fetching */

  function fetchSimilar(name, signal) {
    return fetch('/api/similar-artists?artist=' + encodeURIComponent(name), { signal: signal })
      .then(function (response) {
      if (!response.ok) {
        throw new Error('request failed with ' + response.status);
      }
      return response.json();
    });
  }

  /**
   * Walks the artists sequentially, fetching each one's similar artists and/or
   * genre tags - whatever is missing - and updating the progress bar as it
   * goes. One request at a time, spaced out, to stay under Last.fm's limit.
   */
  function fetchArtistData(jobs, run) {
    var similar = {};
    var tags = {};
    var failed = [];
    var chain = Promise.resolve();

    function progress(index) {
      setStatus('Fetching artist data… ' + (index + 1) + '/' + jobs.length,
        ((index + 1) / jobs.length) * 100);
    }

    jobs.forEach(function (job, index) {
      chain = chain.then(function () {
        if (run.cancelled) {
          return null;
        }
        setStatus('Fetching artist data… ' + (index + 1) + '/' + jobs.length,
          (index / jobs.length) * 100);

        var step = Promise.resolve();

        if (job.needSimilar) {
          step = step.then(function () {
            return fetchSimilar(job.artist.name, run.controller.signal).then(function (data) {
              similar[job.artist.id] = data.similar || [];
            }).catch(function (err) {
              if (!run.cancelled) {
                console.warn('Last.fm lookup failed for ' + job.artist.name, err);
                failed.push(job.artist.name);
              }
            }).then(function () {
              return run.cancelled ? null : delay(REQUEST_DELAY_MS);
            });
          });
        }

        if (job.needTags) {
          step = step.then(function () {
            if (run.cancelled) {
              return null;
            }
            return fetchTags(job.artist.name, run.controller.signal).then(function (data) {
              tags[job.artist.id] = data.tags || [];
            }).catch(function (err) {
              // Genres are a nice-to-have; a miss here isn't worth reporting
              // as a failed artist.
              if (!run.cancelled) {
                console.warn('Tag lookup failed for ' + job.artist.name, err);
              }
            }).then(function () {
              return run.cancelled ? null : delay(REQUEST_DELAY_MS);
            });
          });
        }

        return step.then(function () {
          if (!run.cancelled) {
            progress(index);
          }
        });
      });
    });

    return chain.then(function () {
      return { similar: similar, tags: tags, failed: failed };
    });
  }

  function runGeneration(mode) {
    var run = startRun('graph');
    setBusy(true);
    setMessage('');
    els.failedNotice.hidden = true;
    setStatus('Loading your followed artists…', 0);

    // The recommendation set is built from the graph, so it goes stale here.
    if (showRecommended) {
      showRecommended = false;
      els.recommendToggle.checked = false;
      recommended = { nodes: [], links: [] };
    }

    return MusicHub.spotify.getFollowedArtists().then(function (followed) {
      if (run.cancelled) {
        return null;
      }
      if (!followed.length) {
        setMessage("You don't follow any artists on Spotify yet.");
        setGraphVisible(false);
        drawGraph([], []);
        return null;
      }

      var cached = {};
      graph.artists.forEach(function (artist) {
        cached[artist.spotifyArtistId] = artist;
      });

      // "Update" only fetches the newly-followed artists; a full generation
      // fetches everyone. Genres are fetched for anyone who hasn't got them
      // yet, whichever mode this is.
      var jobs = followed.map(function (artist) {
        var previous = cached[artist.id];
        // An empty answer is asked again next time - Last.fm's tags grow.
        var tagsKnown = previous && previous.genres && previous.genres.length;
        return {
          artist: artist,
          needSimilar: mode === 'update' ? !previous : true,
          needTags: !tagsKnown,
        };
      }).filter(function (job) {
        return job.needSimilar || job.needTags;
      });

      var stillFollowed = {};
      followed.forEach(function (artist) {
        stillFollowed[artist.id] = true;
      });
      var unfollowed = graph.artists.filter(function (artist) {
        return !stillFollowed[artist.spotifyArtistId];
      }).length;

      if (mode === 'update' && !jobs.length && !unfollowed) {
        // Nothing changed, so leave the drawn graph (and its layout) alone -
        // but concert folders may well have been added in the meantime.
        refreshConcertBadges();
        setMessage('No newly followed or unfollowed artists — the graph is already up to date.');
        return null;
      }

      return fetchArtistData(jobs, run).then(function (fetched) {
        return { followed: followed, fetched: fetched, cached: cached, mode: mode };
      });
    }).then(function (outcome) {
      // Cancelled: keep the graph exactly as it was and drop this run's work.
      if (!outcome || run.cancelled) {
        return;
      }

      var artists = outcome.followed.map(function (artist) {
        var previous = outcome.cached[artist.id];
        var similar = outcome.fetched.similar[artist.id];
        return {
          spotifyArtistId: artist.id,
          name: artist.name,
          imageUrl: artist.imageUrl,
          spotifyUrl: artist.spotifyUrl,
          genres: (outcome.fetched.tags[artist.id] && outcome.fetched.tags[artist.id].length)
            ? outcome.fetched.tags[artist.id]
            // An empty result is still an answer; keep whatever was cached.
            : ((previous && previous.genres) || []),
          similarArtistNames: similar || (previous ? previous.similarArtistNames : []),
        };
      });

      // Built from the current follow list alone, so anyone unfollowed since
      // the last run drops out of the graph (and their edges with them).
      var before = {};
      graph.artists.forEach(function (artist) {
        before[artist.spotifyArtistId] = true;
      });
      var after = {};
      artists.forEach(function (artist) {
        after[artist.spotifyArtistId] = true;
      });
      var added = artists.filter(function (artist) {
        return !before[artist.spotifyArtistId];
      }).length;
      var removed = graph.artists.filter(function (artist) {
        return !after[artist.spotifyArtistId];
      }).length;
      // Artists that were already here without a genre and got one this time.
      var tagged = artists.filter(function (artist) {
        var previous = outcome.cached[artist.id];
        return previous && !(previous.genres && previous.genres.length)
          && artist.genres.length;
      }).length;

      graph = {
        lastGeneratedAt: new Date().toISOString(),
        // Genres are fetched as part of this run.
        genresLoadedAt: new Date().toISOString(),
        artists: artists,
        edges: computeEdges(artists),
      };
      save();
      renderControls();
      if (outcome.mode === 'update') {
        // Only the changed artists come and go; the rest keep their places.
        updateDrawnGraph();
        setMessage(changeSummary(added, removed, tagged));
      } else {
        render();
      }
      showFailed(outcome.fetched.failed);
    }).catch(function (err) {
      if (!run.cancelled) {
        setMessage('Something went wrong: ' + err.message);
      }
    }).then(function () {
      setStatus('');
      setBusy(false);
      finishRun(run);
    });
  }

  /** Sweeps this page's stored graph out of localStorage and resets the view. */
  function clearStoredData() {
    return MusicHub.confirmDialog.open({
      title: 'Clear the saved graph?',
      text: 'The cached Last.fm similarity data and the generated connections are '
        + 'removed from this browser, so the next graph is built from scratch. '
        + 'Nothing on Spotify or Last.fm is affected. This cannot be undone.',
      action: 'Clear data',
    }).then(function (confirmed) {
      if (confirmed) {
        resetStoredGraph();
      }
    });
  }

  function resetStoredGraph() {
    MusicHub.storage.remove(STORAGE_KEY);
    graph = { lastGeneratedAt: null, artists: [], edges: [] };
    recommended = { nodes: [], links: [] };
    showRecommended = false;
    els.recommendToggle.checked = false;
    els.failedNotice.hidden = true;

    setGraphVisible(false);
    drawGraph([], []);
    renderControls();
    setMessage('No graph yet — generate one from the artists you follow.');
  }

  /* ------------------------------------------------------ recommendations */

  /** One Spotify lookup; resolves to the artist, or null if it didn't match. */
  function resolveCandidate(candidate, run) {
    return MusicHub.auth.spotifyFetch('/search?type=artist&limit=1&q='
      + encodeURIComponent(candidate.name), { signal: run.controller.signal })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('search failed');
        }
        return response.json();
      }).then(function (data) {
        var match = data.artists && data.artists.items ? data.artists.items[0] : null;
        // Only a confident (exact) name match counts; anything else is dropped.
        if (!match || normalizeArtistName(match.name) !== normalizeArtistName(candidate.name)) {
          return null;
        }
        return {
          spotifyArtistId: match.id,
          name: match.name,
          imageUrl: match.images && match.images.length ? match.images[0].url : null,
          spotifyUrl: match.external_urls ? match.external_urls.spotify : null,
          sourceIds: candidate.sourceIds,
        };
      }).catch(function (err) {
        if (!run.cancelled) {
          console.warn('Could not resolve ' + candidate.name, err);
        }
        return null;
      });
  }

  /**
   * Keeps drawing from the pool until `target` artists have actually resolved
   * on Spotify (or the pool runs out), so a few unresolvable names don't leave
   * the set short. Each draw is weighted afresh, so the preference for
   * well-connecting and isolation-bridging candidates still applies.
   */
  function fillRecommendations(pool, target, isolated, run) {
    var remaining = pool.slice();
    var resolved = [];

    function weightOf(candidate) {
      return candidateWeight(candidate, isolated);
    }

    function step() {
      if (run.cancelled || !remaining.length || resolved.length >= target) {
        return Promise.resolve(resolved);
      }

      var candidate = pickWeighted(remaining, 1, weightOf)[0];
      remaining = remaining.filter(function (entry) {
        return entry !== candidate;
      });

      setStatus('Finding recommended artists… ' + (resolved.length + 1) + '/' + target,
        (resolved.length / target) * 100);

      return resolveCandidate(candidate, run).then(function (artist) {
        if (artist) {
          resolved.push(artist);
        }
        return step();
      });
    }

    return step();
  }

  function loadRecommendations() {
    var pool = buildRecommendationPool(graph.artists);
    if (!pool.length) {
      setMessage('No recommended artists found.');
      return Promise.resolve(false);
    }

    var isolated = isolatedArtistIds(graph.artists, graph.edges);
    var run = startRun('recommend');
    setBusy(true);

    return fillRecommendations(pool, RECOMMENDATION_COUNT, isolated, run)
      .then(function (resolvedArtists) {
      if (run.cancelled) {
        return false;
      }
      if (!resolvedArtists.length) {
        setMessage('No recommended artists found.');
        return false;
      }

      var links = [];
      resolvedArtists.forEach(function (artist) {
        artist.sourceIds.forEach(function (sourceId) {
          links.push({ source: sourceId, target: artist.spotifyArtistId });
        });
      });

      recommended = { nodes: resolvedArtists, links: links };
      setMessage('');
      return true;
    }).then(function (ok) {
      setStatus('');
      setBusy(false);
      finishRun(run);
      return ok;
    });
  }

  /* ------------------------------------------------------------- rendering */

  /**
   * The canvas is pinned below the navbar and fills the rest of the viewport;
   * only the navbar's height has to be measured (it wraps on small screens).
   */
  function fitCanvas() {
    var navbar = document.querySelector('.navbar');
    var top = navbar ? Math.max(0, navbar.getBoundingClientRect().bottom) : 0;
    document.documentElement.style.setProperty('--graph-top', top + 'px');
  }

  /** With no graph there is nothing to frame, explain or control. */
  /**
   * Before there is a graph the progress bar belongs in the page flow, full
   * width; once the graph is up it moves into the left-hand controls.
   */
  function placeStatusBar() {
    if (graphVisible) {
      if (els.status.parentNode !== els.overlayLeft) {
        els.overlayLeft.insertBefore(els.status, els.toast);
      }
    } else if (els.status.parentNode !== els.statusSlot) {
      els.statusSlot.appendChild(els.status);
    }
  }

  function updateOverlays() {
    placeStatusBar();
    // Keeps the pre-paint class in step with what is actually on screen.
    document.documentElement.classList.toggle('has-graph', graphVisible);
    document.documentElement.classList.toggle('no-graph', !graphVisible);
    els.generateToolbar.hidden = graphVisible;
    els.canvas.hidden = !graphVisible;
    els.legend.hidden = !graphVisible;
    els.overlayRight.hidden = !graphVisible;
    // The left group also carries the progress bar, so it stays visible while
    // a first graph is still being built.
    els.overlayLeft.hidden = !(graphVisible || busy);
    // The corner controls take the header's place once a graph is up.
    els.header.hidden = graphVisible;
    if (graphVisible) {
      fitCanvas();
    }
  }

  function setGraphVisible(visible) {
    graphVisible = visible;
    updateOverlays();
  }

  /** Node data for one resolved recommendation. */
  function recommendedNode(artist) {
    return {
      id: artist.spotifyArtistId,
      name: artist.name,
      imageUrl: artist.imageUrl,
      followed: false,
      concerts: 0,
      entering: true,
    };
  }

  /** Adds the recommended nodes and their dashed links to the drawn graph. */
  function addRecommendedToGraph() {
    if (!view) {
      render();
      return recommended.nodes.length;
    }

    var known = {};
    view.nodes.concat(view.pending).forEach(function (node) {
      known[node.id] = true;
    });

    var added = 0;
    recommended.nodes.forEach(function (artist) {
      if (known[artist.spotifyArtistId]) {
        return;
      }
      known[artist.spotifyArtistId] = true;
      view.nodes.push(recommendedNode(artist));
      added += 1;
    });

    var drawn = {};
    view.nodes.forEach(function (node) {
      drawn[node.id] = true;
    });

    recommended.links.forEach(function (link) {
      if (known[link.source] && known[link.target]) {
        // Links to an artist still waiting to pop up are drawn once it does.
        var target = drawn[link.source] && drawn[link.target] ? view.links : view.pendingLinks;
        target.push({ source: link.source, target: link.target, dashed: true });
      }
    });

    recommendIndex = -1;
    syncGraph();
    updateStepper();
    return added;
  }

  /** Takes them back out again, leaving the followed graph untouched. */
  function removeRecommendedFromGraph() {
    if (!view) {
      render();
      return;
    }

    view.nodes = view.nodes.filter(function (node) {
      return node.followed;
    });
    view.links = view.links.filter(function (link) {
      return !link.dashed;
    });
    view.pending = view.pending.filter(function (node) {
      return node.followed;
    });
    view.pendingLinks = view.pendingLinks.filter(function (link) {
      return !link.dashed;
    });

    recommendIndex = -1;
    setFocus(null);
    syncGraph();
    updateStepper();
  }

  /* -------------------------------------------------------- genre outlines */

  var HULL_PADDING = 110;
  // Room one artist takes up inside a genre cluster, and the empty space
  // kept between neighbouring clusters.
  var GENRE_NODE_AREA = 115 * 115;
  var GENRE_GAP = 140;

  // Colours for the genres currently outlined, by genre name.
  var genreColors = {};

  /**
   * Spreads the hues evenly over however many genres are on screen, so no two
   * clusters share a colour. Generated rather than taken from the palette:
   * the palette is a single hue, and here the point is telling them apart.
   */
  function buildGenreColors(groups) {
    genreColors = {};
    // Handed out in the legend's alphabetical order, so the legend runs
    // smoothly round the colour wheel.
    groups.slice().sort(function (a, b) {
      return a.genre.localeCompare(b.genre);
    }).forEach(function (group, index) {
      var hue = Math.round((index * 360) / Math.max(1, groups.length));
      genreColors[group.genre] = {
        fill: 'hsl(' + hue + ' 80% 55% / 0.13)',
        stroke: 'hsl(' + hue + ' 85% 62% / 0.85)',
        label: 'hsl(' + hue + ' 90% 74%)',
      };
    });
    return genreColors;
  }

  function genreColor(genre) {
    return genreColors[genre] || {
      fill: 'hsl(280 80% 55% / 0.13)',
      stroke: 'hsl(280 85% 62% / 0.85)',
      label: 'hsl(280 90% 74%)',
    };
  }

  /** Pushes a hull point outwards from the centre, to pad the outline. */
  function expandPoint(point, centre, padding) {
    var dx = point[0] - centre[0];
    var dy = point[1] - centre[1];
    var length = Math.sqrt(dx * dx + dy * dy) || 1;
    return [point[0] + (dx / length) * padding, point[1] + (dy / length) * padding];
  }

  /** Redraws each genre outline around its members' current positions. */
  function updateHulls() {
    if (!view || !showGenres) {
      return;
    }

    var line = window.d3.line().curve(window.d3.curveCatmullRomClosed.alpha(0.5));

    view.hullGroup.selectAll('g.genre-hull').each(function (group) {
      var element = window.d3.select(this);

      // Only the genre picked in the legend, when there is one.
      if (focusedGenre && group.genre !== focusedGenre) {
        element.attr('display', 'none');
        return;
      }

      // Only the members still on screen count, so focusing a node leaves the
      // genres of that node and its connections outlined, and no others.
      var members = group.nodes.filter(function (node) {
        return typeof node.x === 'number' && (!visibleIds || visibleIds[node.id]);
      });

      if (!members.length) {
        element.attr('display', 'none');
        return;
      }

      var points = [];
      members.forEach(function (node) {
        if (members.length > 2) {
          points.push([node.x, node.y]);
          return;
        }
        // One or two members can't form a hull; box them instead.
        var r = 30;
        points.push([node.x - r, node.y - r], [node.x + r, node.y - r],
          [node.x + r, node.y + r], [node.x - r, node.y + r]);
      });

      var hull = window.d3.polygonHull(points);
      if (!hull) {
        element.attr('display', 'none');
        return;
      }

      var centre = window.d3.polygonCentroid(hull);
      var outline = hull.map(function (point) {
        return expandPoint(point, centre, HULL_PADDING);
      });
      element.attr('display', null);
      element.select('path').attr('d', line(outline));

      // The name sits just below the area, centred under it. The graph is
      // viewed well zoomed out, so the size is in graph units: readable at
      // that zoom, a little larger for the bigger areas.
      var xs = outline.map(function (point) { return point[0]; });
      var ys = outline.map(function (point) { return point[1]; });
      var minX = Math.min.apply(null, xs);
      var maxX = Math.max.apply(null, xs);
      element.select('text')
        .attr('x', (minX + maxX) / 2)
        .attr('y', Math.max.apply(null, ys) + 24)
        .attr('font-size', Math.max(40, Math.min(80, (maxX - minX) / 12)));
    });
  }

  /** Pans and zooms so one genre's cluster fills the canvas. */
  function focusGenreArea(group) {
    if (!view) {
      return;
    }
    var placed = group.nodes.filter(function (node) {
      return typeof node.x === 'number';
    });
    if (!placed.length) {
      return;
    }

    var xs = placed.map(function (node) { return node.x; });
    var ys = placed.map(function (node) { return node.y; });
    var minX = Math.min.apply(null, xs);
    var maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys);
    var maxY = Math.max.apply(null, ys);

    var width = els.canvas.clientWidth || 1200;
    var height = els.canvas.clientHeight || 700;
    var padding = HULL_PADDING * 2;
    var scale = Math.min(
      width / Math.max(1, maxX - minX + padding),
      height / Math.max(1, maxY - minY + padding),
      1.4,
    );

    setFocus(null);
    view.svg.transition().duration(600).call(view.zoom.transform, window.d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-(minX + maxX) / 2, -(minY + maxY) / 2));
  }

  /** Lists the outlined genres in the legend, each one clickable. */
  function renderGenreLegend(groups) {
    els.genreLegend.textContent = '';
    els.genreLegend.hidden = !groups.length;

    // Alphabetical, so a genre is easy to find in a long list.
    groups.slice().sort(function (a, b) {
      return a.genre.localeCompare(b.genre);
    }).forEach(function (group) {
      var colors = genreColor(group.genre);

      var item = document.createElement('li');
      item.className = 'legend__item';

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'legend__button';
      button.title = 'Show ' + group.genre + ' (' + group.nodes.length + ' artists)';
      button.dataset.genre = group.genre;

      var swatch = document.createElement('span');
      swatch.className = 'legend__swatch';
      // Solid, in the genre's own colour.
      swatch.style.backgroundColor = colors.label;
      button.appendChild(swatch);

      var label = document.createElement('span');
      label.textContent = group.genre;
      button.appendChild(label);

      // How many artists are in the area.
      var count = document.createElement('span');
      count.className = 'legend__count';
      count.textContent = group.nodes.length;
      button.appendChild(count);

      button.addEventListener('click', function () {
        setFocusedGenre(focusedGenre === group.genre ? null : group.genre, group);
      });

      if (focusedGenre === group.genre) {
        button.classList.add('legend__button--active');
      }

      item.appendChild(button);
      els.genreLegend.appendChild(item);
    });
  }

  /**
   * Shows only one genre's artists (and only its outline), or everything again
   * when cleared.
   */
  function setFocusedGenre(genre, group) {
    focusedGenre = genre;
    setFocus(null);
    applyVisibility();
    updateHulls();

    Array.prototype.forEach.call(
      els.genreLegend.querySelectorAll('.legend__button'),
      function (button) {
        button.classList.toggle('legend__button--active',
          !!genre && button.dataset.genre === genre);
      },
    );

    if (genre && group) {
      focusGenreArea(group);
    }
  }

  /** Creates or removes the outlines for the current genre grouping. */
  function renderHulls() {
    if (!view) {
      return;
    }

    var groups = showGenres ? genreGroups(view.nodes, 3) : [];
    buildGenreColors(groups);

    var hulls = view.hullGroup.selectAll('g.genre-hull')
      .data(groups, function (d) {
        return d.genre;
      })
      .join(function (enter) {
        var group = enter.append('g').attr('class', 'genre-hull');
        group.append('path')
          .style('fill', function (d) {
            return genreColor(d.genre).fill;
          })
          .style('stroke', function (d) {
            return genreColor(d.genre).stroke;
          });
        // The genre's name, under its area.
        group.append('text')
          .style('fill', function (d) {
            return genreColor(d.genre).label;
          })
          .text(function (d) {
            return d.genre;
          });
        return group;
      });

    // Keep the bound data fresh, so members added later are included.
    hulls.each(function (d) {
      var match = groups.filter(function (group) {
        return group.genre === d.genre;
      })[0];
      if (match) {
        d.nodes = match.nodes;
      }
    });

    renderGenreLegend(groups);
    updateHulls();
  }

  /**
   * Pulls each genre's members to their own anchor. With the graph's very
   * strong repulsion a gentle nudge just blurs everything together, so while
   * genres are shown the repulsion and link pull are eased off and the genre
   * force is made the dominant one.
   */
  function applyGenreForce() {
    if (!view) {
      return;
    }

    var dense = view.nodes.length > 120;

    if (!showGenres) {
      // Back to the similarity-driven layout.
      view.simulation
        .force('genreX', null)
        .force('genreY', null)
        .force('charge', window.d3.forceManyBody()
          .strength(dense ? -3600 : -7000).distanceMax(5000))
        .force('collide', window.d3.forceCollide(function (d) {
          return nodeRadius(d) + 160;
        }).iterations(2));
      view.simulation.force('link').strength(0.12).distance(dense ? 380 : 560);
      moveToLayout(0.5);
      return;
    }

    var width = els.canvas.clientWidth || 1200;
    var height = els.canvas.clientHeight || 700;
    var groups = genreGroups(view.nodes, 3);

    var home = {};
    groups.forEach(function (group) {
      group.nodes.forEach(function (node) {
        home[node.id] = group.genre;
      });
    });
    var loose = view.nodes.filter(function (node) {
      return !home[node.id];
    }).length;

    // One circle per genre, sized for its artists, packed so no two touch.
    // The artists without an area get a circle of their own in the pack, so
    // they sit alongside the rest instead of drifting off.
    function clusterRadius(count) {
      return Math.sqrt((count * GENRE_NODE_AREA) / Math.PI) + HULL_PADDING + GENRE_GAP;
    }
    var circles = groups.map(function (group) {
      return { key: group.genre, r: clusterRadius(group.nodes.length) };
    });
    if (loose) {
      circles.push({ key: null, r: clusterRadius(loose) });
    }
    if (!circles.length) {
      return;
    }
    window.d3.packSiblings(circles);
    var bounds = window.d3.packEnclose(circles);

    var anchors = {};
    circles.forEach(function (circle) {
      anchors[circle.key] = {
        x: width / 2 + circle.x - bounds.x,
        y: height / 2 + circle.y - bounds.y,
      };
    });

    // Anyone added after this was worked out waits in the middle until the
    // layout is redone.
    function anchorFor(node) {
      return anchors[home[node.id] || null] || { x: width / 2, y: height / 2 };
    }

    view.simulation
      // Only the genre pull and just enough repulsion to keep a cluster from
      // collapsing onto itself - similarity links don't move anything here.
      .force('charge', window.d3.forceManyBody().strength(-40).distanceMax(400))
      .force('collide', window.d3.forceCollide(function (d) {
        return nodeRadius(d) + 14;
      }).iterations(2))
      .force('genreX', window.d3.forceX(function (node) {
        return anchorFor(node).x;
      }).strength(0.15))
      .force('genreY', window.d3.forceY(function (node) {
        return anchorFor(node).y;
      }).strength(0.15));

    view.simulation.force('link').strength(0);
    moveToLayout(0.9);

    // Bring the whole pack into view.
    var scale = Math.max(0.02, Math.min(1, Math.min(width, height) / (2.2 * bounds.r)));
    view.svg.transition().duration(LAYOUT_TWEEN_MS).call(view.zoom.transform, window.d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-width / 2, -height / 2));
  }

  // How long the nodes take to glide into a new layout.
  var LAYOUT_TWEEN_MS = 800;

  function stopLayoutTween() {
    if (layoutTween) {
      layoutTween.stop();
      layoutTween = null;
    }
  }

  /**
   * Settles the simulation with its current forces off screen, then glides
   * every node from where it is to where it ended up. Letting the live
   * simulation do the move means seconds of hundreds of avatars shoving
   * through each other, redrawn every tick - the lag when switching genres
   * on or off. While the graph is still being revealed the live simulation
   * keeps going instead; the reveal redoes the layout once it's done.
   */
  function moveToLayout(alpha) {
    var simulation = view.simulation;
    stopLayoutTween();

    if (view.pending.length) {
      simulation.alpha(alpha).restart();
      return;
    }

    simulation.stop();
    var nodes = view.nodes;
    var from = nodes.map(function (node) {
      return { x: node.x, y: node.y };
    });

    simulation.alpha(alpha);
    var ticks = Math.ceil(Math.log(simulation.alphaMin() / alpha)
      / Math.log(1 - simulation.alphaDecay()));
    simulation.tick(ticks);

    var to = nodes.map(function (node) {
      node.vx = 0;
      node.vy = 0;
      return { x: node.x, y: node.y };
    });

    var reduceMotion = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      drawPositions();
      return;
    }

    function placeAt(t) {
      nodes.forEach(function (node, index) {
        node.x = from[index].x + (to[index].x - from[index].x) * t;
        node.y = from[index].y + (to[index].y - from[index].y) * t;
      });
      drawPositions();
    }

    placeAt(0);
    layoutTween = window.d3.timer(function (elapsed) {
      var t = Math.min(1, elapsed / LAYOUT_TWEEN_MS);
      placeAt(window.d3.easeCubicInOut(t));
      if (t === 1) {
        stopLayoutTween();
      }
    });
  }

  function setShowGenres(enabled) {
    showGenres = enabled;
    updateModeToggles();
    if (!enabled) {
      focusedGenre = null;
    }
    applyVisibility();
    renderHulls();
    applyGenreForce();
  }

  function fetchTags(name, signal) {
    return fetch('/api/artist-tags?artist=' + encodeURIComponent(name), { signal: signal })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('request failed with ' + response.status);
        }
        return response.json();
      });
  }

  /* ------------------------------------------------------- artist search */

  function closeSearchResults() {
    els.searchResults.textContent = '';
    els.searchResults.hidden = true;
  }

  /**
   * Focuses one node and brings the canvas to it. Any filter that could be
   * hiding it is dropped first, so picking an artist always shows that artist
   * and its connections, whatever mode the graph was in.
   */
  function focusNode(node) {
    if (focusedGenre) {
      setFocusedGenre(null);
    }
    if (concertsOnly) {
      concertsOnly = false;
      els.concertsToggle.checked = false;
    }

    // With genres on, the areas of the artist and its connections stay
    // outlined, same as a click on the node.
    setFocus(node.id);
    centerOn(node);
  }

  function renderSearchResults() {
    var query = normalizeArtistName(els.searchInput.value);
    if (!view || !query) {
      closeSearchResults();
      return;
    }

    var matches = view.nodes.filter(function (node) {
      return normalizeArtistName(node.name).indexOf(query) !== -1;
    }).slice(0, 12);

    els.searchResults.textContent = '';
    if (!matches.length) {
      // Same shape and height as a result row, so the list doesn't jump.
      var empty = document.createElement('li');
      empty.className = 'picker__item';
      var emptyText = document.createElement('span');
      emptyText.className = 'picker__empty';
      emptyText.textContent = 'No artist in the graph matches that';
      empty.appendChild(emptyText);
      els.searchResults.appendChild(empty);
      els.searchResults.hidden = false;
      return;
    }

    matches.forEach(function (node) {
      var item = document.createElement('li');
      item.className = 'picker__item';

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'picker__button';

      if (node.imageUrl) {
        var image = document.createElement('img');
        image.className = 'picker__avatar';
        image.src = node.imageUrl;
        image.alt = '';
        image.loading = 'lazy';
        button.appendChild(image);
      } else {
        var fallback = document.createElement('span');
        fallback.className = 'picker__avatar picker__avatar--fallback';
        fallback.textContent = (node.name || '?').charAt(0).toUpperCase();
        button.appendChild(fallback);
      }

      var name = document.createElement('span');
      name.textContent = node.name;
      button.appendChild(name);

      if (!node.followed) {
        var note = document.createElement('span');
        note.className = 'graph-search__note';
        note.textContent = 'recommended';
        button.appendChild(note);
      }

      button.addEventListener('click', function () {
        // The focused node is the feedback; leave the field ready for the
        // next search.
        els.searchInput.value = '';
        els.searchClear.hidden = true;
        closeSearchResults();
        focusNode(node);
      });

      item.appendChild(button);
      els.searchResults.appendChild(item);
    });

    els.searchResults.hidden = false;
  }

  /* ------------------------------------ stepping through recommendations */

  function recommendedNodes() {
    return view ? view.nodes.filter(function (node) {
      return !node.followed;
    }) : [];
  }

  function updateStepper() {
    var nodes = recommendedNodes();
    els.stepper.hidden = !(showRecommended && nodes.length);
    if (els.stepper.hidden) {
      return;
    }
    els.stepperLabel.textContent = recommendIndex < 0
      ? nodes.length + ' found'
      : (recommendIndex + 1) + ' / ' + nodes.length;
  }

  /** Pans and zooms the canvas onto one node. */
  function centerOn(node) {
    if (!view || typeof node.x !== 'number') {
      return;
    }
    var width = els.canvas.clientWidth || 1200;
    var height = els.canvas.clientHeight || 700;

    view.svg.transition().duration(500).call(view.zoom.transform, window.d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(1.4)
      .translate(-node.x, -node.y));
  }

  /** Focuses the next (or previous) recommended artist, wrapping around. */
  function stepRecommended(delta) {
    var nodes = recommendedNodes();
    if (!nodes.length) {
      return;
    }

    recommendIndex = ((recommendIndex + delta) % nodes.length + nodes.length) % nodes.length;
    focusNode(nodes[recommendIndex]);
    updateStepper();
  }

  function render() {
    mergeGenres = genreMerger(graph.artists);
    if (!graph.artists.length) {
      setGraphVisible(false);
      drawGraph([], []);
      return;
    }
    setGraphVisible(true);

    var counts = concertCounts(MusicHub.storage.read(HISTORY_KEY, null));

    var nodes = graph.artists.map(function (artist) {
      return followedNode(artist, counts);
    });

    var links = graph.edges.map(function (edge) {
      return { source: edge[0], target: edge[1], dashed: false };
    });

    if (showRecommended) {
      var known = {};
      nodes.forEach(function (node) {
        known[node.id] = true;
      });

      recommended.nodes.forEach(function (artist) {
        if (known[artist.spotifyArtistId]) {
          return;
        }
        known[artist.spotifyArtistId] = true;
        nodes.push({
          id: artist.spotifyArtistId,
          name: artist.name,
          imageUrl: artist.imageUrl,
          followed: false,
          concerts: 0,
          entering: true,
        });
      });

      recommended.links.forEach(function (link) {
        if (known[link.source] && known[link.target]) {
          links.push({ source: link.source, target: link.target, dashed: true });
        }
      });
    }

    drawGraph(nodes, links);
  }

  function followedNode(artist, counts) {
    return {
      id: artist.spotifyArtistId,
      name: artist.name,
      imageUrl: artist.imageUrl,
      genres: mergeGenres(artist.genres),
      followed: true,
      concerts: counts[artist.spotifyArtistId] || 0,
    };
  }

  /** "Added 3 artists, removed 1 artist" - the toast after an update. */
  function changeSummary(added, removed, tagged) {
    function artists(count) {
      return count + (count === 1 ? ' artist' : ' artists');
    }
    var parts = [];
    if (added) {
      parts.push('added ' + artists(added));
    }
    if (removed) {
      parts.push('removed ' + artists(removed));
    }
    if (tagged) {
      parts.push('found genres for ' + artists(tagged));
    }
    if (!parts.length) {
      return 'No newly followed or unfollowed artists — the graph is already up to date.';
    }
    var text = parts.join(', ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /**
   * Brings the drawn graph in line with `graph` without rebuilding it:
   * unfollowed artists (and any recommendations) drop out, newly followed
   * ones join the reveal queue, and the edges are swapped for the new set.
   */
  function updateDrawnGraph() {
    if (!view) {
      render();
      return;
    }

    mergeGenres = genreMerger(graph.artists);
    var counts = concertCounts(MusicHub.storage.read(HISTORY_KEY, null));
    var wanted = {};
    graph.artists.forEach(function (artist) {
      wanted[artist.spotifyArtistId] = artist;
    });

    function keep(node) {
      return node.followed && wanted[node.id];
    }
    view.nodes = view.nodes.filter(keep);
    view.pending = view.pending.filter(keep);

    var present = {};
    view.nodes.concat(view.pending).forEach(function (node) {
      present[node.id] = true;
      // Genres may have been fetched in this run.
      node.genres = mergeGenres(wanted[node.id].genres);
      node.name = wanted[node.id].name;
    });
    graph.artists.forEach(function (artist) {
      if (!present[artist.spotifyArtistId]) {
        view.pending.push(followedNode(artist, counts));
      }
    });

    view.links = [];
    view.pendingLinks = graph.edges.map(function (edge) {
      return { source: edge[0], target: edge[1], dashed: false };
    });
    var drawn = {};
    view.nodes.forEach(function (node) {
      drawn[node.id] = true;
    });
    moveCompletedLinks(drawn);

    if (focusedId && !drawn[focusedId]) {
      focusedId = null;
    }
    recommendIndex = -1;
    syncGraph();
    updateStepper();

    if (view.pending.length) {
      if (!revealTimer) {
        revealTimer = window.setTimeout(revealStep, view.revealDelay);
      }
    } else if (showGenres) {
      applyGenreForce();
    }
  }

  /** Builds the canvas, the simulation and everything in it, from scratch. */
  /** Moves the drawn nodes, links and outlines to the nodes' positions. */
  function drawPositions() {
    if (!selection) {
      return;
    }
    selection.link
      .attr('x1', function (d) { return d.source.x; })
      .attr('y1', function (d) { return d.source.y; })
      .attr('x2', function (d) { return d.target.x; })
      .attr('y2', function (d) { return d.target.y; });
    selection.node.attr('transform', function (d) {
      return 'translate(' + d.x + ',' + d.y + ')';
    });
    updateHulls();
  }

  function drawGraph(nodes, links) {
    stopReveal();
    stopLayoutTween();
    var svg = window.d3.select(els.svg);
    svg.selectAll('*').remove();
    selection = null;
    view = null;
    focusedId = null;

    if (!nodes.length) {
      return;
    }

    fitCanvas();
    var width = els.canvas.clientWidth || 1200;
    var height = els.canvas.clientHeight || 700;
    svg.attr('viewBox', '0 0 ' + width + ' ' + height);

    var defs = svg.append('defs');
    var root = svg.append('g');

    // Drag to pan, wheel or pinch to zoom - desktop and touch alike.
    var zoom = window.d3.zoom().scaleExtent([0.02, 4]).on('zoom', function (event) {
      root.attr('transform', event.transform);
    });
    svg.call(zoom);

    // Start well zoomed out, so the whole spread is in view at once.
    svg.call(zoom.transform, window.d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(0.18)
      .translate(-width / 2, -height / 2));

    // A click on the empty canvas brings the whole graph back.
    svg.on('click', function () {
      if (focusedGenre) {
        setFocusedGenre(null);
        return;
      }
      setFocus(null);
    });

    // Spread things out: with a few hundred artists a tight layout turns into
    // one unreadable clump, so repulsion and link length scale with the count.
    var dense = nodes.length > 120;
    var linkDistance = dense ? 380 : 560;
    var charge = dense ? -3600 : -7000;

    // Starts empty: revealStep() feeds the nodes in one at a time.
    var simulation = window.d3.forceSimulation([])
      .force('link', window.d3.forceLink([]).id(function (d) {
        return d.id;
      }).distance(linkDistance).strength(0.12))
      .force('charge', window.d3.forceManyBody().strength(charge).distanceMax(5000))
      .force('center', window.d3.forceCenter(width / 2, height / 2))
      .force('x', window.d3.forceX(width / 2).strength(0.004))
      .force('y', window.d3.forceY(height / 2).strength(0.008))
      .force('collide', window.d3.forceCollide(function (d) {
        return nodeRadius(d) + 160;
      }).iterations(2))
      .on('tick', drawPositions);

    view = {
      svg: svg,
      zoom: zoom,
      defs: defs,
      hullGroup: root.append('g'),
      linkGroup: root.append('g'),
      nodeGroup: root.append('g'),
      simulation: simulation,
      nodes: [],
      links: [],
      // Not on screen yet; revealStep() moves them over.
      pending: revealOrder(nodes, links),
      pendingLinks: links,
    };

    // Dropping a few hundred avatars and a fully loaded simulation in at once
    // stalls the page, so the nodes pop up a couple at a time instead -
    // quicker per step the bigger the graph, so the whole reveal stays short.
    view.revealDelay = Math.max(15, Math.min(60, 5000 / nodes.length));
    revealStep();
  }

  function stopReveal() {
    if (revealTimer) {
      window.clearTimeout(revealTimer);
      revealTimer = null;
    }
  }

  /**
   * Breadth-first from the best-connected artist, so each node that appears
   * joins something already on screen and the graph grows outward.
   */
  function revealOrder(nodes, links) {
    var byId = {};
    var neighbours = {};
    nodes.forEach(function (node) {
      byId[node.id] = node;
      neighbours[node.id] = [];
    });
    links.forEach(function (link) {
      var ends = linkEnds(link);
      if (neighbours[ends[0]] && neighbours[ends[1]]) {
        neighbours[ends[0]].push(ends[1]);
        neighbours[ends[1]].push(ends[0]);
      }
    });

    var starts = nodes.slice().sort(function (a, b) {
      return neighbours[b.id].length - neighbours[a.id].length;
    });
    var seen = {};
    var order = [];
    starts.forEach(function (start) {
      if (seen[start.id]) {
        return;
      }
      seen[start.id] = true;
      var queue = [start.id];
      while (queue.length) {
        var id = queue.shift();
        order.push(byId[id]);
        neighbours[id].forEach(function (next) {
          if (!seen[next]) {
            seen[next] = true;
            queue.push(next);
          }
        });
      }
    });
    return order;
  }

  // Nodes added per reveal step.
  var REVEAL_BATCH = 2;

  /** Moves the next pending nodes (and any links they complete) on screen. */
  function revealStep() {
    revealTimer = null;
    if (!view || !view.pending.length) {
      return;
    }

    var placed = {};
    view.nodes.forEach(function (existing) {
      placed[existing.id] = existing;
    });

    view.pending.splice(0, REVEAL_BATCH).forEach(function (node) {
      placeNode(node, placed);
    });
    moveCompletedLinks(placed);

    syncGraph();

    if (view.pending.length) {
      revealTimer = window.setTimeout(revealStep, view.revealDelay);
    } else if (showGenres) {
      // The genre anchors were worked out from a partial graph.
      applyGenreForce();
    }
  }

  /** Draws the pending links whose ends are both on screen now. */
  function moveCompletedLinks(placed) {
    view.pendingLinks = view.pendingLinks.filter(function (link) {
      var ends = linkEnds(link);
      if (placed[ends[0]] && placed[ends[1]]) {
        view.links.push(link);
        return false;
      }
      return true;
    });
  }

  /** Adds one node to the drawn set, next to a neighbour already on screen. */
  function placeNode(node, placed) {
    // Start it next to a neighbour that is already there, rather than
    // letting it fly in from the middle of the canvas.
    var anchor = null;
    view.pendingLinks.forEach(function (link) {
      var ends = linkEnds(link);
      if (!anchor && ends[0] === node.id && placed[ends[1]]) {
        anchor = placed[ends[1]];
      } else if (!anchor && ends[1] === node.id && placed[ends[0]]) {
        anchor = placed[ends[0]];
      }
    });
    if (anchor && anchor.x != null) {
      node.x = anchor.x + (Math.random() - 0.5) * 120;
      node.y = anchor.y + (Math.random() - 0.5) * 120;
    }

    node.entering = true;
    view.nodes.push(node);
    placed[node.id] = node;
  }

  function nodeRadius(d) {
    return d.followed ? FOLLOWED_RADIUS : RECOMMENDED_RADIUS;
  }

  function ensurePattern(node) {
    if (!node.imageUrl || !view.defs.select('#avatar-' + node.id).empty()) {
      return;
    }
    view.defs.append('pattern')
      .attr('id', 'avatar-' + node.id)
      .attr('width', 1)
      .attr('height', 1)
      .attr('patternContentUnits', 'objectBoundingBox')
      .append('image')
      .attr('href', node.imageUrl)
      // Older renderers only understand the xlink form.
      .attr('xlink:href', node.imageUrl)
      .attr('width', 1)
      .attr('height', 1)
      .attr('preserveAspectRatio', 'xMidYMid slice');
  }

  /** The concert-count badge on a node: a link into Concert History. */
  function appendBadge(nodes) {
    var badge = nodes.append('g')
      .attr('class', 'graph-badge')
      // On the circle's upper-right edge, whatever the node's size.
      .attr('transform', function (d) {
        var offset = Math.round(nodeRadius(d) * 0.72);
        return 'translate(' + offset + ', ' + -offset + ')';
      })
      .on('click', function (event, d) {
        event.stopPropagation();
        window.location.href = '/concert-history?artist=' + encodeURIComponent(d.id);
      });

    // An inner group so the badge can scale on hover without losing the
    // translate that positions it on the node.
    var badgeInner = badge.append('g').attr('class', 'graph-badge__inner');
    badgeInner.append('circle').attr('r', 14);
    badgeInner.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .text(function (d) {
        return d.concerts;
      });

    return badge;
  }

  /**
   * Re-reads Concert History and updates the badges in place, so folders added
   * over there show up here without rebuilding the graph.
   */
  function refreshConcertBadges() {
    if (!view || !selection) {
      return;
    }

    var counts = concertCounts(MusicHub.storage.read(HISTORY_KEY, null));
    view.nodes.forEach(function (node) {
      node.concerts = node.followed ? (counts[node.id] || 0) : 0;
    });

    selection.node.each(function (d) {
      var group = window.d3.select(this);
      group.selectAll('.graph-badge').remove();
      if (d.concerts > 0) {
        appendBadge(group);
      }
    });
  }

  function buildNode(enter) {
    var group = enter.append('g')
      .attr('class', function (d) {
        return 'graph-node'
          + (d.followed ? '' : ' graph-node--recommended')
          + (d.entering ? ' graph-node--entering' : '');
      });

    group.append('title').text(function (d) {
      return d.followed ? d.name : d.name + ' (not followed)';
    });

    group.append('circle')
      .attr('class', 'graph-node__circle')
      .attr('r', nodeRadius)
      // An inline style, not the fill attribute: the stylesheet's fill would
      // otherwise win and paint every node flat purple.
      .style('fill', function (d) {
        return d.imageUrl ? 'url(#avatar-' + d.id + ')' : null;
      })
      .on('click', function (event, d) {
        // Show this artist and whoever it is connected to, on their own -
        // across all genres, even when one was picked in the legend.
        event.stopPropagation();
        if (focusedGenre) {
          setFocusedGenre(null);
        }
        setFocus(focusedId === d.id ? null : d.id);
      });

    group.append('text')
      .attr('class', 'graph-node__label')
      .attr('text-anchor', 'middle')
      .attr('y', function (d) {
        return nodeRadius(d) + 20;
      })
      .text(function (d) {
        return d.name;
      })
      .on('click', function (event, d) {
        // The name opens the artist in the Spotify app.
        event.stopPropagation();
        window.location.href = 'spotify:artist:' + d.id;
      });

    // Concert-count badge, only for artists with folders in Concert History.
    appendBadge(group.filter(function (d) {
      return d.concerts > 0;
    }));

    // Nodes can be dragged around and stay where they are dropped; a
    // double-click hands one back to the simulation. clickDistance keeps a
    // real drag from also counting as a click on the dot.
    group.call(window.d3.drag()
      .clickDistance(4)
      .on('start', function (event, d) {
        stopLayoutTween();
        if (!event.active) {
          view.simulation.alphaTarget(0.25).restart();
        }
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', function (event, d) {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', function (event) {
        if (!event.active) {
          view.simulation.alphaTarget(0);
        }
      }));

    group.on('dblclick', function (event, d) {
      event.stopPropagation();
      d.fx = null;
      d.fy = null;
      stopLayoutTween();
      view.simulation.alphaTarget(0.25).restart();
      window.setTimeout(function () {
        view.simulation.alphaTarget(0);
      }, 600);
    });

    return group;
  }

  /**
   * Joins the current nodes and links onto what is already drawn, so adding or
   * removing recommendations touches only those elements - the rest of the
   * graph keeps its positions and its loaded images.
   */
  function syncGraph() {
    if (!view) {
      return;
    }

    view.nodes.forEach(ensurePattern);

    var link = view.linkGroup.selectAll('line')
      .data(view.links, function (d) {
        var ends = linkEnds(d);
        return ends[0] + '|' + ends[1] + '|' + (d.dashed ? 'd' : 's');
      })
      .join(
        function (enter) {
          return enter.append('line').attr('class', function (d) {
            return 'graph-link' + (d.dashed ? ' graph-link--dashed' : '');
          });
        },
      );

    var node = view.nodeGroup.selectAll('g.graph-node')
      .data(view.nodes, function (d) {
        return d.id;
      })
      .join(buildNode);

    selection = { node: node, link: link, links: view.links };
    renderHulls();
    updateRecommendedLegend();

    view.simulation.nodes(view.nodes);
    view.simulation.force('link').links(view.links);
    stopLayoutTween();
    view.simulation.alpha(0.5).restart();

    applyVisibility();
  }

  /** The recommended entries in the legend only while recommendations are on. */
  function updateRecommendedLegend() {
    var shown = !!view && view.nodes.concat(view.pending).some(function (node) {
      return !node.followed;
    });
    els.legend.querySelectorAll('[data-legend-recommended]').forEach(function (item) {
      item.hidden = !shown;
    });
  }

  function linkEnds(link) {
    return [
      link.source && link.source.id ? link.source.id : link.source,
      link.target && link.target.id ? link.target.id : link.target,
    ];
  }

  /** The focused node and its neighbours, or null when nothing is focused. */
  function focusSet() {
    if (!focusedId || !selection) {
      return null;
    }

    var set = {};
    set[focusedId] = true;
    selection.links.forEach(function (link) {
      var ends = linkEnds(link);
      if (ends[0] === focusedId) {
        set[ends[1]] = true;
      }
      if (ends[1] === focusedId) {
        set[ends[0]] = true;
      }
    });
    return set;
  }

  /**
   * Hides whatever the current focus and the "only artists with concerts"
   * filter exclude. Both are applied together; a link needs both its ends
   * visible to be drawn.
   */
  function applyVisibility() {
    if (!selection) {
      return 0;
    }
    visibleIds = null;

    var focused = focusSet();
    var visible = {};
    var shown = 0;

    // A genre picked in the legend shows just the artists inside its area.
    var genreMembers = null;
    if (focusedGenre) {
      genreMembers = {};
      genreGroups(view.nodes, 3).forEach(function (group) {
        if (group.genre === focusedGenre) {
          group.nodes.forEach(function (node) {
            genreMembers[node.id] = true;
          });
        }
      });
    }

    view.nodes.forEach(function (node) {
      var ok = true;
      if (concertsOnly && node.followed && !(node.concerts > 0)) {
        ok = false;
      }
      if (genreMembers && !genreMembers[node.id]) {
        ok = false;
      }
      if (focused && !focused[node.id]) {
        ok = false;
      }
      visible[node.id] = ok;
      if (ok) {
        shown += 1;
      }
    });

    // A recommended artist is only worth showing while one of the artists it
    // was recommended from is visible.
    if (concertsOnly) {
      view.nodes.forEach(function (node) {
        if (node.followed || !visible[node.id]) {
          return;
        }
        var connected = selection.links.some(function (link) {
          var ends = linkEnds(link);
          if (ends[0] === node.id) {
            return visible[ends[1]];
          }
          if (ends[1] === node.id) {
            return visible[ends[0]];
          }
          return false;
        });
        if (!connected) {
          visible[node.id] = false;
          shown -= 1;
        }
      });
    }

    visibleIds = visible;

    selection.node.classed('graph-hidden', function (d) {
      return !visible[d.id];
    });
    // ...and none of the connections, which would only clutter the one area.
    selection.link.classed('graph-hidden', function (link) {
      var ends = linkEnds(link);
      return !!focusedGenre || !(visible[ends[0]] && visible[ends[1]]);
    });

    return shown;
  }

  function setFocus(id) {
    focusedId = id;
    applyVisibility();
    updateHulls();
  }

  function setConcertsOnly(enabled) {
    if (enabled) {
      switchOffOtherModes('concerts');
    }
    concertsOnly = enabled;
    var shown = applyVisibility();
    if (enabled && !shown) {
      setMessage('No artists with concerts in Concert Gallery yet.');
    }
  }

  /* ------------------------------------------------------------------ init */

  document.addEventListener('DOMContentLoaded', function () {
    els.generate = document.getElementById('generate-graph');
    if (!els.generate) {
      return;
    }

    els.update = document.getElementById('update-graph');
    els.clear = document.getElementById('clear-graph');
    els.lastGenerated = document.getElementById('last-generated');
    els.status = document.getElementById('graph-status');
    els.statusText = document.getElementById('graph-status-text');
    els.progress = document.getElementById('graph-progress');
    els.message = document.getElementById('graph-message');
    eta = MusicHub.progressEta.create(document.getElementById('graph-eta'));
    els.toast = document.getElementById('graph-toast');
    els.statusSlot = document.getElementById('status-slot');
    els.failedNotice = document.getElementById('graph-failed-notice');
    els.failedText = document.getElementById('graph-failed-text');
    els.header = document.querySelector('.page__header');
    els.overlayLeft = document.getElementById('overlay-left');
    els.overlayRight = document.getElementById('overlay-right');
    els.canvas = document.getElementById('graph-canvas');
    els.legend = document.getElementById('graph-legend');
    els.svg = document.getElementById('graph-svg');
    els.recommendToggle = document.getElementById('recommend-toggle');
    els.concertsToggle = document.getElementById('concerts-toggle');
    els.genresToggle = document.getElementById('genres-toggle');
    els.genreLegend = document.getElementById('genre-legend');
    els.generateToolbar = document.getElementById('generate-toolbar');
    els.searchInput = document.getElementById('graph-search-input');
    els.searchClear = document.getElementById('graph-search-clear');
    els.searchResults = document.getElementById('graph-search-results');
    els.stepper = document.getElementById('recommend-stepper');
    els.stepperLabel = document.getElementById('recommend-position');

    graph = load();

    els.generate.addEventListener('click', function () {
      runGeneration('generate');
    });

    els.update.addEventListener('click', function () {
      runGeneration('update');
    });

    els.clear.addEventListener('click', clearStoredData);

    els.recommendToggle.addEventListener('change', function () {
      // Pressing it again mid-fetch stops the search.
      if (busy && activeRun && activeRun.kind === 'recommend') {
        cancelRun();
        showRecommended = false;
        els.recommendToggle.checked = false;
        setStatus('');
        setMessage('Stopped looking for recommended artists.');
        return;
      }

      if (busy) {
        // A graph run is going; leave the switch where it was.
        els.recommendToggle.checked = showRecommended;
        return;
      }

      if (!els.recommendToggle.checked) {
        showRecommended = false;
        recommended = { nodes: [], links: [] };
        removeRecommendedFromGraph();
        updateModeToggles();
        return;
      }

      switchOffOtherModes('recommend');

      // Always a fresh set - recommendations are never cached - but they are
      // added to the drawn graph rather than causing a full redraw.
      loadRecommendations().then(function (ok) {
        showRecommended = ok;
        els.recommendToggle.checked = ok;
        updateModeToggles();
        if (ok) {
          var added = addRecommendedToGraph();
          // Same short-lived note as "the graph is already up to date".
          setMessage(added === 1
            ? 'Added 1 recommended artist'
            : 'Added ' + added + ' recommended artists');
        }
      });
    });

    // Concert History may be edited in another tab, or before coming back
    // to this one.
    window.addEventListener('storage', function (event) {
      if (!event.key || event.key === 'concertHistory') {
        refreshConcertBadges();
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        refreshConcertBadges();
      }
    });

    window.addEventListener('resize', function () {
      if (graph.artists.length) {
        render();
      }
    });

    els.concertsToggle.addEventListener('change', function () {
      setConcertsOnly(els.concertsToggle.checked);
    });

    els.genresToggle.addEventListener('change', function () {
      if (!els.genresToggle.checked) {
        setShowGenres(false);
        return;
      }

      switchOffOtherModes('genres');

      // Genres are loaded with the graph, so this is instant.
      var nodes = view ? view.nodes : [];
      var hasGenres = nodes.some(function (node) {
        return node.genres && node.genres.length;
      });

      if (!hasGenres) {
        els.genresToggle.checked = false;
        setMessage('No genres stored yet — run "Update graph" to fetch them.');
        return;
      }

      if (!genreGroups(nodes, 3).length) {
        els.genresToggle.checked = false;
        setMessage('Not enough artists share a genre to outline any group.');
        return;
      }

      setShowGenres(true);
    });

    els.searchInput.addEventListener('input', function () {
      // The ✕ shows only while there's something to clear.
      els.searchClear.hidden = !els.searchInput.value;
      renderSearchResults();
    });
    els.searchClear.addEventListener('click', function () {
      els.searchInput.value = '';
      els.searchClear.hidden = true;
      closeSearchResults();
      els.searchInput.focus();
    });
    els.searchInput.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeSearchResults();
        return;
      }
      if (event.key !== 'Enter') {
        return;
      }
      // Enter takes the first match.
      event.preventDefault();
      var first = els.searchResults.querySelector('.picker__button');
      if (first) {
        first.click();
      }
    });

    document.addEventListener('click', function (event) {
      var container = document.querySelector('.graph-search');
      if (!els.searchResults.hidden && container && !container.contains(event.target)) {
        closeSearchResults();
      }
    });

    document.getElementById('recommend-prev').addEventListener('click', function () {
      stepRecommended(-1);
    });
    document.getElementById('recommend-next').addEventListener('click', function () {
      stepRecommended(1);
    });

    document.getElementById('graph-cancel').addEventListener('click', cancelRun);

    document.getElementById('graph-failed-dismiss').addEventListener('click', function () {
      els.failedNotice.hidden = true;
    });

    renderControls();
    if (!graph.artists.length) {
      setGraphVisible(false);
      setMessage('No graph yet — generate one from the artists you follow.');
    } else {
      render();
    }
  });

  // Exposed for tests.
  MusicHub.followedArtistsGraph = {
    cancelRun: cancelRun,
    normalizeArtistName: normalizeArtistName,
    normalizeGraph: normalizeGraph,
    genreKey: genreKey,
    genreMerger: genreMerger,
    computeEdges: computeEdges,
    buildRecommendationPool: buildRecommendationPool,
    pickWeighted: pickWeighted,
    candidateWeight: candidateWeight,
    isolatedArtistIds: isolatedArtistIds,
    concertCounts: concertCounts,
    genreGroups: genreGroups,
  };
})(window.MusicHub);
