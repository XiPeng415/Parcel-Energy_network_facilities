(function() {
  'use strict';

  const statusEl = document.getElementById('load-status');
  const loadingEl = document.getElementById('loading');

  function updateStatus(message) {
    if (statusEl) statusEl.textContent = message;
    console.log('Loading:', message);
  }

  async function loadJSON(url, description) {
    updateStatus(`Loading ${description}...`);
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Failed to load ${url}: ${response.statusText}`);
      }
      const data = await response.json();
      updateStatus(`${description} loaded`);
      return data;
    } catch (err) {
      console.error(err);
      updateStatus(`Error loading ${description}`);
      return null;
    }
  }

  async function loadAll() {
    const params = new URLSearchParams(window.location.search);
    const useSample = params.get('sample') === '500';
    const useFull = params.get('full') === '1';

    let file = 'network_data_parcel_transit_top3.json';

    if (useFull) {
      file = 'network_data.json';
    } else if (useSample) {
      file = 'network_data_500.json';
    }

    updateStatus('Loading dataset...');
    window.NETWORK_DATA = await loadJSON(file, 'dataset');

    if (window.NETWORK_DATA && typeof init === 'function') {
      init();
    }

    if (loadingEl) loadingEl.style.display = 'none';
  }

  window.addEventListener('load', loadAll);
})();
