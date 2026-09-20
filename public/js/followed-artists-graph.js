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
  // The genre outline kept on screen while a single artist is focused.
  var outlinedGenre = null;
  // Which nodes the current filters leave on screen, by id.
  var visibleIds = null;
  var toastTimer = null;
  // The node whose connections are being shown on their own, if any.
  var focusedId = null;
  var selection = null;
  // The run currently in flight, if any - so it can be cancelled.
  var activeRun = null;

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
          // Whether the tag lookup has run for this artist - some artists
          // simply have no tags, and those must not be retried forever.
          genresChecked: !!artist.genresChecked,
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

  /**
   * Artists bucketed by their primary genre (Spotify lists them roughly by
   * relevance). Genres are very granular, so groups below `minSize` are left
   * out rather than drawing a blob around every two-artist niche.
   */
  function genreGroups(nodes, minSize) {
    var threshold = minSize || 3;
    var byGenre = {};

    (nodes || []).forEach(function (node) {
      if (!node.followed) {
        return;
      }
      var genre = node.genres && node.genres.length ? node.genres[0] : null;
      if (!genre) {
        return;
      }
      if (!byGenre[genre]) {
        byGenre[genre] = [];
      }
      byGenre[genre].push(node);
    });

    return Object.keys(byGenre)
      .filter(function (genre) {
        return byGenre[genre].length >= threshold;
      })
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
      return;
    }
    els.statusText.textContent = text;
    els.status.hidden = false;

    var percent = typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : 0;
    els.progress.style.width = percent + '%';
    els.status.setAttribute('aria-valuenow', String(Math.round(percent)));
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
        }).format(new Date(graph.lastGeneratedAt));
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
        var tagsKnown = previous
          && (previous.genresChecked || (previous.genres && previous.genres.length));
        return {
          artist: artist,
          needSimilar: mode === 'update' ? !previous : true,
          needTags: !tagsKnown,
        };
      }).filter(function (job) {
        return job.needSimilar || job.needTags;
      });

      var toFetch = jobs;

      if (mode === 'update' && !toFetch.length) {
        // Nothing changed, so leave the drawn graph (and its layout) alone -
        // but concert folders may well have been added in the meantime.
        refreshConcertBadges();
        setMessage('No newly followed artists — the graph is already up to date.');
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
          genresChecked: Object.prototype.hasOwnProperty.call(outcome.fetched.tags, artist.id)
            || !!(previous && previous.genresChecked),
          similarArtistNames: similar || (previous ? previous.similarArtistNames : []),
        };
      });

      if (outcome.mode === 'update') {
        // Purely additive: artists already in the graph stay, even if they
        // were unfollowed in the meantime.
        var seen = {};
        artists.forEach(function (artist) {
          seen[artist.spotifyArtistId] = true;
        });
        graph.artists.forEach(function (artist) {
          if (!seen[artist.spotifyArtistId]) {
            artists.push(artist);
          }
        });
      }

      graph = {
        lastGeneratedAt: new Date().toISOString(),
        // Genres are fetched as part of this run.
        genresLoadedAt: new Date().toISOString(),
        artists: artists,
        edges: computeEdges(artists),
      };
      save();
      renderControls();
      render();
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
    if (!window.confirm('Delete the saved graph from this browser?\n\n'
      + 'The cached Last.fm similarity data and the generated connections are '
      + 'removed, so the next graph is built from scratch. Nothing on Spotify '
      + 'or Last.fm is affected. This cannot be undone.')) {
      return;
    }

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
    view.nodes.forEach(function (node) {
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

    recommended.links.forEach(function (link) {
      if (known[link.source] && known[link.target]) {
        view.links.push({ source: link.source, target: link.target, dashed: true });
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

    recommendIndex = -1;
    setFocus(null);
    syncGraph();
    updateStepper();
  }

  /* -------------------------------------------------------- genre outlines */

  var HULL_PADDING = 90;

  // Colours for the genres currently outlined, by genre name.
  var genreColors = {};

  /**
   * Spreads the hues evenly over however many genres are on screen, so no two
   * clusters share a colour. Generated rather than taken from the palette:
   * the palette is a single hue, and here the point is telling them apart.
   */
  function buildGenreColors(groups) {
    genreColors = {};
    groups.forEach(function (group, index) {
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

      // Either the genre picked in the legend, or the focused artist's own.
      var onlyGenre = focusedGenre || outlinedGenre;
      if (onlyGenre && group.genre !== onlyGenre) {
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
      element.attr('display', null);
      element.select('path').attr('d', line(hull.map(function (point) {
        return expandPoint(point, centre, HULL_PADDING);
      })));
    });
  }

  /** Pans and zooms so one genre's cluster fills the canvas. */
  function focusGenreArea(group) {
    var placed = group.nodes.filter(function (node) {
      return typeof node.x === 'number';
    });
    if (!view || !placed.length) {
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

    groups.forEach(function (group) {
      var colors = genreColor(group.genre);

      var item = document.createElement('li');
      item.className = 'legend__item';

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'legend__button';
      button.title = 'Show ' + group.genre + ' (' + group.nodes.length + ' artists)';

      var swatch = document.createElement('span');
      swatch.className = 'legend__swatch';
      // Solid, in the genre's own colour.
      swatch.style.backgroundColor = colors.label;
      button.appendChild(swatch);

      var label = document.createElement('span');
      label.textContent = group.genre;
      button.appendChild(label);

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
    outlinedGenre = null;
    setFocus(null);
    applyVisibility();
    updateHulls();

    Array.prototype.forEach.call(
      els.genreLegend.querySelectorAll('.legend__button'),
      function (button) {
        button.classList.toggle('legend__button--active',
          !!genre && button.textContent === genre);
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
          return (d.followed ? 28 : 22) + 160;
        }).iterations(2));
      view.simulation.force('link').strength(0.12).distance(dense ? 380 : 560);
      view.simulation.alpha(0.5).restart();
      return;
    }

    var width = els.canvas.clientWidth || 1200;
    var height = els.canvas.clientHeight || 700;
    var groups = genreGroups(view.nodes, 3);

    // Enough circumference that neighbouring clusters stay apart, without
    // flinging them to the edges of the canvas.
    var spacing = 520;
    var radius = Math.max(
      Math.min(width, height) * 0.6,
      (groups.length * spacing) / (2 * Math.PI),
    );

    var anchors = {};
    groups.forEach(function (group, index) {
      var angle = (index / Math.max(1, groups.length)) * Math.PI * 2;
      anchors[group.genre] = {
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
      };
    });

    function anchorFor(node) {
      var genre = node.genres && node.genres.length ? node.genres[0] : null;
      return genre ? anchors[genre] : null;
    }

    view.simulation
      // Eased off, so the genre anchors decide where things sit.
      .force('charge', window.d3.forceManyBody().strength(-260).distanceMax(900))
      .force('collide', window.d3.forceCollide(function (d) {
        return (d.followed ? 28 : 22) + 34;
      }).iterations(2))
      .force('genreX', window.d3.forceX(function (node) {
        var anchor = anchorFor(node);
        return anchor ? anchor.x : width / 2;
      }).strength(function (node) {
        return anchorFor(node) ? 0.2 : 0.02;
      }))
      .force('genreY', window.d3.forceY(function (node) {
        var anchor = anchorFor(node);
        return anchor ? anchor.y : height / 2;
      }).strength(function (node) {
        return anchorFor(node) ? 0.2 : 0.02;
      }));

    view.simulation.force('link').strength(0.05).distance(200);
    view.simulation.alpha(0.9).restart();
  }

  function setShowGenres(enabled) {
    showGenres = enabled;
    updateModeToggles();
    if (!enabled) {
      focusedGenre = null;
      outlinedGenre = null;
      applyVisibility();
    }
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

    setFocus(node.id);

    // With genres on, keep just this artist's genre outlined.
    outlinedGenre = showGenres && node.genres && node.genres.length ? node.genres[0] : null;
    updateHulls();

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
    if (!graph.artists.length) {
      setGraphVisible(false);
      drawGraph([], []);
      return;
    }
    setGraphVisible(true);

    var counts = concertCounts(MusicHub.storage.read(HISTORY_KEY, null));

    var nodes = graph.artists.map(function (artist) {
      return {
        id: artist.spotifyArtistId,
        name: artist.name,
        imageUrl: artist.imageUrl,
        genres: artist.genres || [],
        followed: true,
        concerts: counts[artist.spotifyArtistId] || 0,
      };
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

  /** Builds the canvas, the simulation and everything in it, from scratch. */
  function drawGraph(nodes, links) {
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

    var simulation = window.d3.forceSimulation(nodes)
      .force('link', window.d3.forceLink(links).id(function (d) {
        return d.id;
      }).distance(linkDistance).strength(0.12))
      .force('charge', window.d3.forceManyBody().strength(charge).distanceMax(5000))
      .force('center', window.d3.forceCenter(width / 2, height / 2))
      .force('x', window.d3.forceX(width / 2).strength(0.004))
      .force('y', window.d3.forceY(height / 2).strength(0.008))
      .force('collide', window.d3.forceCollide(function (d) {
        return (d.followed ? 28 : 22) + 160;
      }).iterations(2))
      .on('tick', function () {
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
      });

    view = {
      svg: svg,
      zoom: zoom,
      defs: defs,
      hullGroup: root.append('g'),
      linkGroup: root.append('g'),
      nodeGroup: root.append('g'),
      simulation: simulation,
      nodes: nodes,
      links: links,
    };

    syncGraph();
  }

  function nodeRadius(d) {
    return d.followed ? 28 : 22;
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
      .attr('transform', 'translate(20, -20)')
      .on('click', function (event, d) {
        event.stopPropagation();
        window.location.href = '/concert-history?artist=' + encodeURIComponent(d.id);
      });

    // An inner group so the badge can scale on hover without losing the
    // translate that positions it on the node.
    var badgeInner = badge.append('g').attr('class', 'graph-badge__inner');
    badgeInner.append('circle').attr('r', 11);
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
        // Show this artist and whoever it is connected to, on their own.
        event.stopPropagation();
        setFocus(focusedId === d.id ? null : d.id);
        updateHulls();
      });

    group.append('text')
      .attr('class', 'graph-node__label')
      .attr('text-anchor', 'middle')
      .attr('y', function (d) {
        return nodeRadius(d) + 16;
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

    view.simulation.nodes(view.nodes);
    view.simulation.force('link').links(view.links);
    view.simulation.alpha(0.5).restart();

    applyVisibility();
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

    view.nodes.forEach(function (node) {
      var ok = true;
      if (concertsOnly && node.followed && !(node.concerts > 0)) {
        ok = false;
      }
      if (focusedGenre) {
        var primary = node.genres && node.genres.length ? node.genres[0] : null;
        if (primary !== focusedGenre) {
          ok = false;
        }
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
    selection.link.classed('graph-hidden', function (link) {
      var ends = linkEnds(link);
      return !(visible[ends[0]] && visible[ends[1]]);
    });

    return shown;
  }

  function setFocus(id) {
    focusedId = id;
    if (!id) {
      outlinedGenre = null;
    }
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
      setMessage('No artists with concerts in Concert History yet.');
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

    els.searchInput.addEventListener('input', renderSearchResults);
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
    computeEdges: computeEdges,
    buildRecommendationPool: buildRecommendationPool,
    pickWeighted: pickWeighted,
    candidateWeight: candidateWeight,
    isolatedArtistIds: isolatedArtistIds,
    concertCounts: concertCounts,
    genreGroups: genreGroups,
  };
})(window.MusicHub);
