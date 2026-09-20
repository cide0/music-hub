/*
 * Navbar behavior: the mobile hamburger menu and the Export / Import data
 * controls. Export/Import work regardless of Spotify login state - they only
 * touch localStorage.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  function initMenu() {
    var toggle = document.getElementById('navbar-toggle');
    var tabs = document.getElementById('navbar-tabs');
    if (!toggle || !tabs) {
      return;
    }

    toggle.addEventListener('click', function () {
      var open = tabs.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  function initDataControls() {
    var exportButton = document.getElementById('export-data');
    var importButton = document.getElementById('import-data');
    var fileInput = document.getElementById('import-file');

    if (exportButton) {
      exportButton.addEventListener('click', function () {
        MusicHub.storage.exportData();
      });
    }

    if (importButton && fileInput) {
      importButton.addEventListener('click', function () {
        fileInput.click();
      });

      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) {
          return;
        }
        MusicHub.storage
          .importDataFromFile(file)
          .then(function (imported) {
            if (imported) {
              window.location.reload();
            }
          })
          .catch(function (err) {
            window.alert('Import failed: ' + err.message);
          })
          .then(function () {
            // Allow picking the same file again.
            fileInput.value = '';
          });
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initMenu();
    initDataControls();
  });
})(window.MusicHub);
