/**
 * SITS — Système d'Information Territorial du Sénégal
 * v4 — Recherche, mode démo, mode sombre, statistiques, mesure,
 *      partage de vue, favoris, export GeoJSON/CSV
 */

// ============================================================
// CONFIGURATION
// ============================================================

const API_BASE = "http://localhost:5000/api";

const REGION_COLORS = [
  "#D9A441", "#B5533C", "#4C6B8A", "#7A8B4F",
  "#8C6D46", "#5E7A6D", "#A85C7A", "#C08A2E",
];

const INFRA_TYPES = [
  { key: "centresante",    label: "Centres de santé",          color: "#B5533C", icon: "centresante.svg" },
  { key: "forage",          label: "Forages",                   color: "#3E7CB1", icon: "forage.svg" },
  { key: "hoteleriepoint",  label: "Hôtellerie",                color: "#D9A441", icon: "hoteleriepoint.svg" },
  { key: "loisir",          label: "Équipements de loisir",     color: "#7A8B4F", icon: "loisir.svg" },
  { key: "lyceepublic",     label: "Établissements scolaires",  color: "#4C6B8A", icon: "lyceepublic.svg" },
  { key: "marche",          label: "Marchés",                   color: "#8C6D46", icon: "marche.svg" },
  { key: "parking",         label: "Parkings",                  color: "#6B6255", icon: "parking.svg" },
];

const HIDDEN_PROPS = new Set(["geom", "geometry", "gid"]);
const FAVORITES_KEY = "sits-favoris";
const THEME_KEY = "sits-theme";

// ============================================================
// ÉTAT
// ============================================================

const state = {
  map: null,
  regionsLayer: null,
  departementsLayer: null,
  infraLayers: {},
  infraRawFeatures: {},
  regionsData: null,
  departementsData: null,
  allDepartementsData: null,   // préchargé silencieusement pour la recherche globale
  currentRegionCode: "",
  currentDepartementNom: "",
  activeTableSource: null,
  demoMode: false,
  favorites: [],
  lastShownInfo: null,
  measure: null,

  // --- v5 : analyse spatiale, filtres croisés, rapport, administration ---
  nationalInfra: {},        // typeKey -> features[] (nationwide, non filtré — pour analyses spatiales)
  infraFilterText: "",
  infraRangeFilter: null,   // { column, min, max } ou null
  choropleth: { active: false, layer: null, counts: null },
  heatmap: { active: false, layer: null, typeKey: null },
  proximity: { userLatLng: null, circle: null, marker: null, highlightLayer: null },
  admin: { picking: false, previewMarker: null },
};

// ============================================================
// DÉMARRAGE
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  state.favorites = loadFavorites();

  initMap();
  initDarkMode();
  initSidebarToggle();
  initMainTabs();
  initPageNav();
  initMapTabControls();
  buildInfraLayerList();
  buildLegend();
  wireFilters();
  initSearch();
  initMeasureTool();
  initShareLink();
  initExportButtons();
  renderFavoritesList();

  initInfraCrossFilters();
  initChoropleth();
  initHeatmap();
  initProximitySearch();
  initComparator();
  initPrintReport();
  initAdmin();
  initDataTableSelector();

  loadRegions();
});

// ============================================================
// CARTE
// ============================================================

function initMap() {
  state.map = L.map("map", { zoomControl: true }).setView([14.5, -14.5], 6);

  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(state.map);

  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics", maxZoom: 19 }
  );

  L.control.layers(
    { "Plan (OpenStreetMap)": osm, "Satellite (Esri)": satellite },
    {},
    { position: "topright", collapsed: true }
  ).addTo(state.map);

  L.control.scale({ imperial: false, position: "bottomleft" }).addTo(state.map);
  addLocateControl();
}

function addLocateControl() {
  const LocateControl = L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      const btn = L.DomUtil.create("a", "locate-btn", container);
      btn.href = "#";
      btn.title = "Me géolocaliser";
      btn.style.cssText = `
        background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='18' height='18'%3E%3Ccircle cx='12' cy='12' r='3' fill='%23223357'/%3E%3Cpath d='M12 2v3M12 19v3M2 12h3M19 12h3' stroke='%23223357' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat center / 18px;
        width: 36px !important;
        height: 36px !important;
        border-radius: 8px !important;
        transition: transform 0.15s ease;
        display: block;
      `;
      L.DomEvent.on(btn, "mouseenter", () => { btn.style.transform = "scale(1.06)"; });
      L.DomEvent.on(btn, "mouseleave", () => { btn.style.transform = "scale(1)"; });
      L.DomEvent.on(btn, "click", (e) => {
        L.DomEvent.preventDefault(e);
        state.map.locate({ setView: true, maxZoom: 12 });
      });
      return container;
    },
  });
  state.map.addControl(new LocateControl());

  let locMarker = null;
  let locCircle = null;
  state.map.on("locationfound", (e) => {
    if (locMarker) state.map.removeLayer(locMarker);
    if (locCircle) state.map.removeLayer(locCircle);
    locMarker = L.marker(e.latlng).addTo(state.map)
      .bindPopup("Vous êtes ici (± " + Math.round(e.accuracy) + " m)")
      .openPopup();
    locCircle = L.circle(e.latlng, {
      radius: e.accuracy,
      color: "#4C6B8A",
      fillColor: "#4C6B8A",
      fillOpacity: 0.1
    }).addTo(state.map);
  });
  state.map.on("locationerror", () => {
    setApiStatus("error", "Géolocalisation refusée");
    setTimeout(refreshApiStatusIdle, 3000);
  });
}

// ============================================================
// API (+ repli automatique sur les données de démonstration)
// ============================================================

async function apiGet(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch (_) {}
    throw new Error(`Requête ${path} en échec (HTTP ${res.status}). ${detail}`);
  }
  return res.json();
}

/**
 * Essaie l'API réelle ; si elle est injoignable (ex. Flask non lancé, ou
 * environnement comme Bolt qui ne peut pas héberger Flask+PostGIS), bascule
 * silencieusement sur les données fictives de js/mock-data.js et affiche un
 * bandeau "Mode démonstration".
 */
async function apiGetWithFallback(path, mockFn) {
  try {
    const data = await apiGet(path);
    exitDemoMode();
    return data;
  } catch (err) {
    console.warn(`API indisponible pour ${path}, bascule sur les données de démonstration.`, err);
    enterDemoMode();
    return mockFn();
  }
}

function enterDemoMode() {
  if (state.demoMode) return;
  state.demoMode = true;
  const banner = document.getElementById("demo-banner");
  if (banner) banner.classList.remove("hidden");
  setApiStatus("error", "Mode démonstration (API injoignable)");
  showToast("info", "L'API Flask ne répond pas : des données fictives sont utilisées pour la démonstration.", 7000);
}

function exitDemoMode() {
  if (!state.demoMode) { setApiStatus("ok", "API connectée"); return; }
  state.demoMode = false;
  const banner = document.getElementById("demo-banner");
  if (banner) banner.classList.add("hidden");
  setApiStatus("ok", "API connectée");
}

function setApiStatus(kind, label) {
  const el = document.getElementById("api-status");
  el.classList.remove("ok", "error");
  if (kind) el.classList.add(kind);
  el.querySelector(".label").textContent = label;
}

function refreshApiStatusIdle() {
  setApiStatus(state.demoMode ? "error" : "ok", state.demoMode ? "Mode démonstration (API injoignable)" : "API connectée");
}

// ============================================================
// TOASTS + LOADING
// ============================================================

function showToast(kind, message, timeout = 5000) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  const icon = kind === "error" ? "⚠️" : kind === "ok" ? "✓" : "ℹ️";
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-body"></span>
    <button type="button" class="toast-close" aria-label="Fermer">✕</button>
  `;
  toast.querySelector(".toast-body").textContent = message;

  const remove = () => {
    toast.classList.add("closing");
    setTimeout(() => toast.remove(), 200);
  };
  toast.querySelector(".toast-close").addEventListener("click", remove);
  if (timeout) setTimeout(remove, timeout);

  container.appendChild(toast);
}

let mapLoadingCount = 0;
function showMapLoading() {
  mapLoadingCount += 1;
  const el = document.getElementById("map-loading");
  if (el) el.classList.remove("hidden");
}
function hideMapLoading() {
  mapLoadingCount = Math.max(0, mapLoadingCount - 1);
  if (mapLoadingCount === 0) {
    const el = document.getElementById("map-loading");
    if (el) el.classList.add("hidden");
  }
}

// ============================================================
// RÉGIONS
// ============================================================

async function loadRegions() {
  showMapLoading();
  try {
    setApiStatus(null, "Connexion à l'API…");
    const data = await apiGetWithFallback("/regions", () => window.SITS_MOCK.getRegions());
    state.regionsData = data;

    state.regionsLayer = L.geoJSON(data, {
      style: (feature) => regionStyle(feature),
      onEachFeature: (feature, layer) => {
        layer.bindPopup(buildPopupHtml(feature.properties, "Région"));
        layer.on("click", () => {
          layer.openPopup();
          highlightLayer(layer);
        });
      },
    }).addTo(state.map);

    populateSelect(
      document.getElementById("select-region"),
      data.features,
      (f) => f.properties.code_region,
      (f) => f.properties.nom,
      "Toutes les régions"
    );

    setTableSource("Régions du Sénégal", data.features);

    if (data.features.length && state.regionsLayer.getBounds().isValid()) {
      state.map.fitBounds(state.regionsLayer.getBounds(), { padding: [20, 20] });
    }

    await loadDepartementsForSearch();
    await applyStateFromUrl();
  } catch (err) {
    console.error(err);
    setApiStatus("error", "Erreur inattendue");
    showApiError(err);
  } finally {
    hideMapLoading();
  }
}

function regionStyle(feature) {
  const idx = state.regionsData ? state.regionsData.features.indexOf(feature) : 0;
  const color = REGION_COLORS[idx % REGION_COLORS.length];
  return { color, weight: 2.5, fillColor: color, fillOpacity: 0.12 };
}

function highlightRegionStyle() {
  return { weight: 4, fillOpacity: 0.25 };
}

// ============================================================
// DÉPARTEMENTS
// ============================================================

async function loadDepartements(regionCode) {
  const query = regionCode ? `?region=${encodeURIComponent(regionCode)}` : "";
  showMapLoading();
  try {
    const data = await apiGetWithFallback("/departements" + query, () => window.SITS_MOCK.getDepartements(regionCode));
    state.departementsData = data;

    if (state.departementsLayer) state.map.removeLayer(state.departementsLayer);

    state.departementsLayer = L.geoJSON(data, {
      style: { color: "#223357", weight: 1.5, dashArray: "4 3", fillOpacity: 0.03 },
      onEachFeature: (feature, layer) => {
        layer.bindPopup(buildPopupHtml(feature.properties, "Département"));
        layer.on("click", () => {
          layer.openPopup();
          highlightLayer(layer);
        });
      },
    }).addTo(state.map);

    populateSelect(
      document.getElementById("select-departement"),
      data.features,
      (f) => f.properties.gid,
      (f) => f.properties.nom,
      regionCode ? "Tous les départements de la région" : "Tous les départements"
    );
    document.getElementById("select-departement").disabled = false;

    setTableSource(
      regionCode ? "Départements de la région sélectionnée" : "Tous les départements",
      data.features
    );
  } catch (err) {
    console.error(err);
    showApiError(err);
  } finally {
    hideMapLoading();
  }
}

/** Précharge tous les départements en arrière-plan (sans toucher au select
 *  en cascade) afin que la recherche globale puisse les retrouver même avant
 *  qu'une région ne soit choisie. */
async function loadDepartementsForSearch() {
  try {
    state.allDepartementsData = await apiGetWithFallback("/departements", () => window.SITS_MOCK.getDepartements(""));
    populateCompareDeptSelect();
  } catch (err) {
    console.warn("Préchargement des départements pour la recherche impossible.", err);
  }
}

// ============================================================
// INFRASTRUCTURES
// ============================================================

function buildInfraLayerList() {
  const ul = document.getElementById("infra-layer-list");
  ul.innerHTML = "";

  INFRA_TYPES.forEach((type) => {
    const li = document.createElement("li");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `infra-${type.key}`;
    checkbox.addEventListener("change", () => toggleInfraLayer(type, checkbox.checked));

    const swatch = document.createElement("img");
    swatch.className = "layer-swatch";
    swatch.src = `assets/icons/${type.icon}`;
    swatch.alt = "";

    const label = document.createElement("label");
    label.htmlFor = checkbox.id;
    label.textContent = type.label;

    const count = document.createElement("span");
    count.className = "layer-count";
    count.id = `count-${type.key}`;

    li.append(checkbox, swatch, label, count);
    ul.appendChild(li);
  });
}

async function toggleInfraLayer(type, isChecked) {
  const countEl = document.getElementById(`count-${type.key}`);
  const checkboxEl = document.getElementById(`infra-${type.key}`);
  countEl.classList.remove("loading", "error");

  if (!isChecked) {
    if (state.infraLayers[type.key]) {
      state.map.removeLayer(state.infraLayers[type.key]);
      delete state.infraLayers[type.key];
    }
    delete state.infraRawFeatures[type.key];
    countEl.textContent = "";
    updateInfraTotalBadge();
    renderStatsChart();
    renderRegionChart();
    renderDensityChart();
    renderTemporalChart();
    renderMapSummary();
    renderStatCards();
    refreshInfraFilterUi();
    return;
  }

  countEl.textContent = "…";
  countEl.classList.add("loading");
  checkboxEl.disabled = true;
  try {
    const featureCollection = await fetchInfraFeatures(type.key);
    state.infraRawFeatures[type.key] = featureCollection.features;

    const filtered = applyInfraFilters(type.key, featureCollection.features);
    renderInfraLayer(type, filtered);
    countEl.textContent = filtered.length === featureCollection.features.length
      ? String(filtered.length)
      : `${filtered.length}/${featureCollection.features.length}`;
    countEl.classList.remove("loading");

    setTableSource(type.label, filtered);
    updateInfraTotalBadge();
    renderStatsChart();
    renderRegionChart();
    renderDensityChart();
    renderTemporalChart();
    renderMapSummary();
    renderStatCards();
    refreshInfraFilterUi();
  } catch (err) {
    console.error(err);
    countEl.textContent = "!";
    countEl.classList.remove("loading");
    countEl.classList.add("error");
    checkboxEl.checked = false;
    showApiError(err);
  } finally {
    checkboxEl.disabled = false;
  }
}

/**
 * (Re)construit le calque cluster d'un type d'infrastructure à partir d'un
 * jeu de features déjà chargé (sans nouvel appel API) — utilisé au chargement
 * initial ET par les filtres croisés (texte / plage numérique).
 */
function renderInfraLayer(type, features) {
  if (state.infraLayers[type.key]) {
    state.map.removeLayer(state.infraLayers[type.key]);
    delete state.infraLayers[type.key];
  }
  const cluster = L.markerClusterGroup({ maxClusterRadius: 45 });
  const icon = buildDivIcon(type);

  L.geoJSON({ type: "FeatureCollection", features }, {
    pointToLayer: (feature, latlng) => L.marker(latlng, { icon }),
    onEachFeature: (feature, layer) => {
      layer.bindPopup(buildPopupHtml(feature.properties, type.label));
      layer.on("click", () => {
        layer.openPopup();
      });
    },
  }).eachLayer((marker) => cluster.addLayer(marker));

  cluster.addTo(state.map);
  state.infraLayers[type.key] = cluster;
  return cluster;
}

function fetchInfraFeatures(typeKey) {
  const departement = state.currentDepartementNom;
  let path = `/infrastructures?type=${encodeURIComponent(typeKey)}`;
  if (departement) path += `&departement=${encodeURIComponent(departement)}`;
  return apiGetWithFallback(path, () => window.SITS_MOCK.getInfrastructures(typeKey, departement));
}

/**
 * Précharge (une seule fois par type, puis mise en cache) les infrastructures
 * d'un type sur tout le territoire, sans tenir compte du filtre région/département
 * en cours — nécessaire pour les analyses spatiales nationales (choroplèthe,
 * comparateur, proximité) qui ne doivent pas dépendre de la navigation en cours.
 */
async function loadNationalInfra(typeKey) {
  if (state.nationalInfra[typeKey]) return state.nationalInfra[typeKey];
  const fc = await apiGetWithFallback(
    `/infrastructures?type=${encodeURIComponent(typeKey)}`,
    () => window.SITS_MOCK.getInfrastructures(typeKey, "")
  );
  state.nationalInfra[typeKey] = fc.features;
  return fc.features;
}

async function loadAllNationalInfra(typeKeys) {
  const lists = await Promise.all(typeKeys.map(loadNationalInfra));
  return Object.fromEntries(typeKeys.map((key, i) => [key, lists[i]]));
}

function refreshActiveInfraLayers() {
  INFRA_TYPES.forEach((type) => {
    const checkbox = document.getElementById(`infra-${type.key}`);
    if (checkbox && checkbox.checked) toggleInfraLayer(type, true);
  });
}

function buildDivIcon(type) {
  return L.icon({
    iconUrl: `assets/icons/${type.icon}`,
    iconSize: [28, 34],
    iconAnchor: [14, 34],
    popupAnchor: [0, -30],
  });
}

function updateInfraTotalBadge() {
  const badge = document.getElementById("infra-total-badge");
  if (!badge) return;
  const total = INFRA_TYPES.reduce((sum, t) => {
    const layer = state.infraLayers[t.key];
    return sum + (layer && layer.getLayers ? layer.getLayers().length : 0);
  }, 0);
  if (total > 0) {
    badge.textContent = `${total} affichée${total > 1 ? "s" : ""}`;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

// ============================================================
// FILTRES CROISÉS INTRA-COUCHE (recherche texte + plage numérique)
// ============================================================

const EXCLUDED_RANGE_COLUMNS = new Set(["gid", "id", "code_region", "code_departement", "geometry", "geom"]);

/** Applique les filtres croisés en cours à un jeu de features d'un type donné. */
function applyInfraFilters(typeKey, features) {
  let result = features;

  const needle = normalizeText(state.infraFilterText).trim();
  if (needle) {
    result = result.filter((f) =>
      Object.values(f.properties).some((v) => normalizeText(v).includes(needle))
    );
  }

  const range = state.infraRangeFilter;
  if (range && range.column && typeHasColumn(typeKey, range.column)) {
    result = result.filter((f) => {
      const raw = f.properties[range.column];
      if (raw === null || raw === undefined || raw === "") return false;
      const num = Number(raw);
      if (Number.isNaN(num)) return false;
      if (range.min !== null && num < range.min) return false;
      if (range.max !== null && num > range.max) return false;
      return true;
    });
  }

  return result;
}

function typeHasColumn(typeKey, column) {
  return (state.infraRawFeatures[typeKey] || []).some((f) =>
    Object.prototype.hasOwnProperty.call(f.properties, column)
  );
}

/** Détecte les colonnes à valeurs numériques parmi les couches actuellement actives. */
function detectNumericColumns() {
  const cols = new Set();
  Object.values(state.infraRawFeatures).forEach((feats) => {
    (feats || []).forEach((f) => {
      Object.entries(f.properties).forEach(([k, v]) => {
        if (EXCLUDED_RANGE_COLUMNS.has(k.toLowerCase())) return;
        if (v === null || v === undefined || v === "" || typeof v === "boolean") return;
        if (!Number.isNaN(Number(v))) cols.add(k);
      });
    });
  });
  return [...cols].sort((a, b) => a.localeCompare(b, "fr"));
}

function reapplyAllInfraFilters() {
  INFRA_TYPES.forEach((type) => {
    if (!state.infraLayers[type.key]) return;
    const raw = state.infraRawFeatures[type.key] || [];
    const filtered = applyInfraFilters(type.key, raw);
    renderInfraLayer(type, filtered);
    const countEl = document.getElementById(`count-${type.key}`);
    if (countEl) {
      countEl.textContent = filtered.length === raw.length ? String(filtered.length) : `${filtered.length}/${raw.length}`;
    }
    if (state.activeTableSource && state.activeTableSource.label === type.label) {
      setTableSource(type.label, filtered);
    }
  });
  updateInfraTotalBadge();
  renderStatsChart();
  renderMapSummary();
  renderStatCards();
  refreshInfraFilterUi();
}

function refreshInfraFilterUi() {
  const textInput = document.getElementById("infra-text-filter");
  const columnSelect = document.getElementById("infra-range-column");
  const rangeInputs = document.getElementById("infra-range-inputs");
  const hint = document.getElementById("infra-filter-hint");
  if (!textInput || !columnSelect) return;

  const activeTypes = INFRA_TYPES.filter((t) => state.infraLayers[t.key]);
  const hasActive = activeTypes.length > 0;

  textInput.disabled = !hasActive;
  textInput.placeholder = hasActive ? "Nom, description…" : "Activez une couche pour rechercher…";

  const cols = hasActive ? detectNumericColumns() : [];
  const previousValue = columnSelect.value;
  columnSelect.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = !hasActive
    ? "Activez une couche pour détecter les attributs numériques"
    : cols.length
      ? "Aucun filtre de plage"
      : "Aucun attribut numérique détecté sur les couches actives";
  columnSelect.appendChild(opt0);
  columnSelect.disabled = !cols.length;
  cols.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = prettifyKey(c);
    columnSelect.appendChild(opt);
  });
  if (cols.includes(previousValue)) columnSelect.value = previousValue;
  else if (rangeInputs) rangeInputs.classList.add("hidden");

  if (hint) {
    const total = activeTypes.reduce((sum, t) => sum + (state.infraLayers[t.key]?.getLayers().length || 0), 0);
    hint.textContent = hasActive ? `${total} entrée(s) affichée(s) après filtre.` : "";
  }
}

function initInfraCrossFilters() {
  const textInput = document.getElementById("infra-text-filter");
  const columnSelect = document.getElementById("infra-range-column");
  const rangeInputs = document.getElementById("infra-range-inputs");
  const minInput = document.getElementById("infra-range-min");
  const maxInput = document.getElementById("infra-range-max");
  const applyBtn = document.getElementById("btn-infra-range-apply");
  const clearBtn = document.getElementById("btn-infra-range-clear");
  if (!textInput) return;

  let debounceTimer = null;
  textInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.infraFilterText = textInput.value;
      reapplyAllInfraFilters();
    }, 200);
  });

  columnSelect.addEventListener("change", () => {
    rangeInputs.classList.toggle("hidden", !columnSelect.value);
    minInput.value = "";
    maxInput.value = "";
  });

  applyBtn.addEventListener("click", () => {
    const column = columnSelect.value;
    if (!column) { showToast("error", "Choisissez d'abord un attribut numérique."); return; }
    const min = minInput.value !== "" ? Number(minInput.value) : null;
    const max = maxInput.value !== "" ? Number(maxInput.value) : null;
    state.infraRangeFilter = { column, min, max };
    reapplyAllInfraFilters();
    showToast("ok", `Filtre de plage appliqué sur « ${prettifyKey(column)} ».`);
  });

  clearBtn.addEventListener("click", () => {
    state.infraRangeFilter = null;
    minInput.value = "";
    maxInput.value = "";
    columnSelect.value = "";
    rangeInputs.classList.add("hidden");
    reapplyAllInfraFilters();
  });

  refreshInfraFilterUi();
}

// ============================================================
// LÉGENDE
// ============================================================

function buildLegend() {
  const ul = document.getElementById("legend-list");
  ul.innerHTML = "";

  const regionItem = document.createElement("li");
  regionItem.innerHTML = `<span class="legend-swatch" style="background:${REGION_COLORS[0]}"></span> Limites de région (couleur par région)`;
  ul.appendChild(regionItem);

  const deptItem = document.createElement("li");
  deptItem.innerHTML = `<span class="legend-swatch line" style="background:#223357"></span> Limites de département`;
  ul.appendChild(deptItem);

  INFRA_TYPES.forEach((type) => {
    const li = document.createElement("li");
    li.innerHTML = `<img class="legend-swatch" src="assets/icons/${type.icon}" alt=""> ${type.label}`;
    ul.appendChild(li);
  });
}

// ============================================================
// STATISTIQUES (graphiques canvas, sans dépendance)
// ============================================================

function renderStatsChart() {
  const canvas = document.getElementById("stats-chart");
  if (!canvas) return;

  const active = INFRA_TYPES.filter((t) => state.infraLayers[t.key]);
  const styles = getComputedStyle(document.documentElement);
  const inkStrong = styles.getPropertyValue("--ink-900").trim() || "#1A1A18";
  const inkSoft = styles.getPropertyValue("--ink-700").trim() || "#44413C";
  const trackColor = styles.getPropertyValue("--sand-200").trim() || "rgba(0,0,0,0.08)";

  const dpr = window.devicePixelRatio || 1;
  const widthCss = canvas.parentElement.clientWidth || 400;
  const rowH = 28;
  const heightCss = Math.max(40, active.length * rowH + 8);

  canvas.width = widthCss * dpr;
  canvas.height = heightCss * dpr;
  canvas.style.width = "100%";
  canvas.style.height = `${heightCss}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, widthCss, heightCss);

  if (!active.length) {
    ctx.fillStyle = inkSoft;
    ctx.font = "12px 'Work Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Activez des couches pour voir les statistiques", widthCss / 2, heightCss / 2);
    return;
  }

  const counts = active.map((t) => {
    const layer = state.infraLayers[t.key];
    return layer && layer.getLayers ? layer.getLayers().length : 0;
  });
  const max = Math.max(1, ...counts);
  const labelW = 140;
  const countW = 40;
  const barMaxW = Math.max(20, widthCss - labelW - countW);

  ctx.font = "600 11px 'Work Sans', sans-serif";
  ctx.textBaseline = "middle";

  active.forEach((t, i) => {
    const y = i * rowH + rowH / 2;
    const barW = Math.max(3, (counts[i] / max) * barMaxW);

    ctx.fillStyle = inkSoft;
    ctx.textAlign = "left";
    ctx.fillText(truncateLabel(ctx, t.label, labelW - 8), 0, y);

    ctx.fillStyle = trackColor;
    roundRect(ctx, labelW, y - 6, barMaxW, 12, 6);
    ctx.fill();

    ctx.fillStyle = t.color;
    roundRect(ctx, labelW, y - 6, barW, 12, 6);
    ctx.fill();

    ctx.fillStyle = inkStrong;
    ctx.textAlign = "left";
    ctx.fillText(String(counts[i]), labelW + barMaxW + 6, y);
  });
}

function renderRegionChart() {
  const canvas = document.getElementById("region-chart");
  if (!canvas || !state.regionsData) return;

  const styles = getComputedStyle(document.documentElement);
  const inkStrong = styles.getPropertyValue("--ink-900").trim() || "#1A1A18";
  const inkSoft = styles.getPropertyValue("--ink-700").trim() || "#44413C";
  const trackColor = styles.getPropertyValue("--sand-200").trim() || "rgba(0,0,0,0.08)";

  const dpr = window.devicePixelRatio || 1;
  const widthCss = canvas.parentElement.clientWidth || 400;
  const rowH = 24;
  const heightCss = Math.max(40, state.regionsData.features.length * rowH + 8);

  canvas.width = widthCss * dpr;
  canvas.height = heightCss * dpr;
  canvas.style.width = "100%";
  canvas.style.height = `${heightCss}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, widthCss, heightCss);

  // Compter les infrastructures par région
  const regionCounts = {};
  state.regionsData.features.forEach(region => {
    regionCounts[region.properties.nom] = 0;
  });

  Object.keys(state.infraLayers).forEach(key => {
    const layer = state.infraLayers[key];
    if (layer && layer.getLayers) {
      layer.getLayers().forEach(marker => {
        const latlng = marker.getLatLng();
        // Trouver la région contenant ce point
        state.regionsData.features.forEach(region => {
          if (isPointInPolygon(latlng, region.geometry)) {
            regionCounts[region.properties.nom]++;
          }
        });
      });
    }
  });

  const regions = Object.keys(regionCounts);
  const counts = Object.values(regionCounts);
  const max = Math.max(1, ...counts);

  const labelW = 120;
  const countW = 35;
  const barMaxW = Math.max(20, widthCss - labelW - countW);

  ctx.font = "600 10px 'Work Sans', sans-serif";
  ctx.textBaseline = "middle";

  regions.forEach((region, i) => {
    const y = i * rowH + rowH / 2;
    const barW = Math.max(3, (counts[i] / max) * barMaxW);

    ctx.fillStyle = inkSoft;
    ctx.textAlign = "left";
    ctx.fillText(truncateLabel(ctx, region, labelW - 8), 0, y);

    ctx.fillStyle = trackColor;
    roundRect(ctx, labelW, y - 5, barMaxW, 10, 5);
    ctx.fill();

    const regionIdx = state.regionsData.features.findIndex(r => r.properties.nom === region);
    const color = REGION_COLORS[regionIdx % REGION_COLORS.length];
    ctx.fillStyle = color;
    roundRect(ctx, labelW, y - 5, barW, 10, 5);
    ctx.fill();

    ctx.fillStyle = inkStrong;
    ctx.textAlign = "left";
    ctx.fillText(String(counts[i]), labelW + barMaxW + 6, y);
  });
}

function renderDensityChart() {
  const canvas = document.getElementById("density-chart");
  if (!canvas || !state.departementsData) return;

  const styles = getComputedStyle(document.documentElement);
  const inkStrong = styles.getPropertyValue("--ink-900").trim() || "#1A1A18";
  const inkSoft = styles.getPropertyValue("--ink-700").trim() || "#44413C";
  const trackColor = styles.getPropertyValue("--sand-200").trim() || "rgba(0,0,0,0.08)";

  const dpr = window.devicePixelRatio || 1;
  const widthCss = canvas.parentElement.clientWidth || 400;
  const rowH = 20;
  const heightCss = Math.max(40, Math.min(state.departementsData.features.length, 15) * rowH + 8);

  canvas.width = widthCss * dpr;
  canvas.height = heightCss * dpr;
  canvas.style.width = "100%";
  canvas.style.height = `${heightCss}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, widthCss, heightCss);

  // Compter les infrastructures par département
  const deptCounts = {};
  state.departementsData.features.forEach(dept => {
    deptCounts[dept.properties.nom] = 0;
  });

  Object.keys(state.infraLayers).forEach(key => {
    const layer = state.infraLayers[key];
    if (layer && layer.getLayers) {
      layer.getLayers().forEach(marker => {
        const latlng = marker.getLatLng();
        // Trouver le département contenant ce point
        state.departementsData.features.forEach(dept => {
          if (isPointInPolygon(latlng, dept.geometry)) {
            deptCounts[dept.properties.nom]++;
          }
        });
      });
    }
  });

  // Trier par densité décroissante et prendre les 15 premiers
  const sortedDepts = Object.entries(deptCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const max = Math.max(1, ...sortedDepts.map(d => d[1]));

  const labelW = 130;
  const countW = 35;
  const barMaxW = Math.max(20, widthCss - labelW - countW);

  ctx.font = "600 9px 'Work Sans', sans-serif";
  ctx.textBaseline = "middle";

  sortedDepts.forEach(([dept, count], i) => {
    const y = i * rowH + rowH / 2;
    const barW = Math.max(3, (count / max) * barMaxW);

    ctx.fillStyle = inkSoft;
    ctx.textAlign = "left";
    ctx.fillText(truncateLabel(ctx, dept, labelW - 8), 0, y);

    ctx.fillStyle = trackColor;
    roundRect(ctx, labelW, y - 4, barMaxW, 8, 4);
    ctx.fill();

    ctx.fillStyle = "#D9A441";
    roundRect(ctx, labelW, y - 4, barW, 8, 4);
    ctx.fill();

    ctx.fillStyle = inkStrong;
    ctx.textAlign = "left";
    ctx.fillText(String(count), labelW + barMaxW + 6, y);
  });
}

function renderTemporalChart() {
  const canvas = document.getElementById("temporal-chart");
  if (!canvas) return;

  const styles = getComputedStyle(document.documentElement);
  const inkStrong = styles.getPropertyValue("--ink-900").trim() || "#1A1A18";
  const inkSoft = styles.getPropertyValue("--ink-700").trim() || "#44413C";
  const trackColor = styles.getPropertyValue("--sand-200").trim() || "rgba(0,0,0,0.08)";

  const dpr = window.devicePixelRatio || 1;
  const widthCss = canvas.parentElement.clientWidth || 400;
  const heightCss = 300;

  canvas.width = widthCss * dpr;
  canvas.height = heightCss * dpr;
  canvas.style.width = "100%";
  canvas.style.height = `${heightCss}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, widthCss, heightCss);

  // Données simulées d'évolution temporelle (2018-2024)
  const years = [2018, 2019, 2020, 2021, 2022, 2023, 2024];
  const activeTypes = INFRA_TYPES.filter((t) => state.infraLayers[t.key]);
  
  if (!activeTypes.length) {
    ctx.fillStyle = inkSoft;
    ctx.font = "12px 'Work Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Activez des couches pour voir l'évolution temporelle", widthCss / 2, heightCss / 2);
    return;
  }

  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartWidth = widthCss - padding.left - padding.right;
  const chartHeight = heightCss - padding.top - padding.bottom;

  // Simuler des données temporelles basées sur les comptes actuels
  const typeData = activeTypes.map(type => {
    const currentCount = state.infraLayers[type.key] ? state.infraLayers[type.key].getLayers().length : 0;
    const baseCount = Math.max(1, Math.floor(currentCount * 0.7));
    return {
      type,
      data: years.map((year, i) => {
        const growth = (i / (years.length - 1)) * (currentCount - baseCount);
        const variation = Math.floor(Math.random() * currentCount * 0.1);
        return Math.max(0, baseCount + growth + variation - currentCount * 0.05);
      })
    };
  });

  const maxCount = Math.max(...typeData.flatMap(d => d.data));
  const minCount = 0;

  // Dessiner les axes
  ctx.strokeStyle = trackColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, heightCss - padding.bottom);
  ctx.lineTo(widthCss - padding.right, heightCss - padding.bottom);
  ctx.stroke();

  // Dessiner les lignes de données
  typeData.forEach(({ type, data }) => {
    ctx.strokeStyle = type.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    data.forEach((value, i) => {
      const x = padding.left + (i / (years.length - 1)) * chartWidth;
      const y = heightCss - padding.bottom - ((value - minCount) / (maxCount - minCount)) * chartHeight;
      
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    
    ctx.stroke();
  });

  // Dessiner les labels d'années
  ctx.fillStyle = inkSoft;
  ctx.font = "10px 'Work Sans', sans-serif";
  ctx.textAlign = "center";
  years.forEach((year, i) => {
    const x = padding.left + (i / (years.length - 1)) * chartWidth;
    ctx.fillText(String(year), x, heightCss - padding.bottom + 15);
  });

  // Dessiner la légende
  const legendX = padding.left;
  const legendY = padding.top - 10;
  activeTypes.forEach((type, i) => {
    const legendItemX = legendX + (i % 4) * 90;
    const legendItemY = legendY + Math.floor(i / 4) * 15;
    
    ctx.fillStyle = type.color;
    ctx.fillRect(legendItemX, legendItemY, 12, 12);
    
    ctx.fillStyle = inkSoft;
    ctx.font = "9px 'Work Sans', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(truncateLabel(ctx, type.label, 70), legendItemX + 16, legendItemY + 9);
  });
}

// Fonction utilitaire pour vérifier si un point est dans un polygone
function isPointInPolygon(latlng, polygon) {
  if (!polygon || !polygon.coordinates) return false;
  
  const coords = polygon.coordinates[0]; // premier ring du polygone
  const x = latlng.lng, y = latlng.lat;
  
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i][0], yi = coords[i][1];
    const xj = coords[j][0], yj = coords[j][1];
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function truncateLabel(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// ============================================================
// ANALYSE SPATIALE — UTILITAIRES GÉOMÉTRIQUES (jointure point-dans-polygone)
// ============================================================
// Plutôt que de deviner le nom de la colonne "département" propre à chaque
// table d'infrastructure (elle varie selon les tables), on fait une véritable
// jointure spatiale : pour chaque point d'infrastructure, on teste dans quel
// polygone de département il tombe. C'est plus robuste et plus proche de
// l'esprit d'un SITS.

function isPointInPolygonGeometry(lng, lat, geometry) {
  if (!geometry) return false;
  const rayCast = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const intersects = (yi > lat) !== (yj > lat) &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  };

  const polygons = geometry.type === "Polygon" ? [geometry.coordinates]
    : geometry.type === "MultiPolygon" ? geometry.coordinates
    : [];

  return polygons.some(([outerRing, ...holes]) => {
    if (!outerRing || !rayCast(outerRing)) return false;
    return !holes.some((hole) => rayCast(hole));
  });
}

function findDepartementForPoint(lng, lat, departements) {
  return departements.find((d) => isPointInPolygonGeometry(lng, lat, d.geometry)) || null;
}

/**
 * Calcule, pour une liste de types d'infrastructure déjà chargés à l'échelle
 * nationale (state.nationalInfra), le nombre de points par département (et
 * par type) via jointure spatiale point-dans-polygone.
 * Renvoie une Map<gid, { dept, total, byType: {typeKey: n} }>.
 */
function computeInfraCountsByDepartement(typeKeys) {
  const departements = (state.allDepartementsData && state.allDepartementsData.features) || [];
  const counts = new Map();
  departements.forEach((d) => counts.set(d.properties.gid, { dept: d, total: 0, byType: {} }));

  typeKeys.forEach((typeKey) => {
    const feats = state.nationalInfra[typeKey] || [];
    feats.forEach((f) => {
      if (!f.geometry || f.geometry.type !== "Point") return;
      const [lng, lat] = f.geometry.coordinates;
      const dep = findDepartementForPoint(lng, lat, departements);
      if (!dep) return;
      const entry = counts.get(dep.properties.gid);
      if (!entry) return;
      entry.total += 1;
      entry.byType[typeKey] = (entry.byType[typeKey] || 0) + 1;
    });
  });

  return counts;
}

// ============================================================
// CARTE CHOROPLÈTHE — DENSITÉ D'INFRASTRUCTURES PAR DÉPARTEMENT
// ============================================================

const CHOROPLETH_RAMP = ["#F8EDC0", "#E8CC7A", "#D9A441", "#C47A5A", "#8C3F2E"];

function choroplethColorFor(count, max) {
  if (max <= 0 || count <= 0) return CHOROPLETH_RAMP[0];
  const ratio = count / max;
  const idx = Math.min(CHOROPLETH_RAMP.length - 1, Math.floor(ratio * CHOROPLETH_RAMP.length));
  return CHOROPLETH_RAMP[Math.max(0, idx)];
}

function buildChoroplethTypeList() {
  const fieldset = document.getElementById("choropleth-type-list");
  if (!fieldset) return;
  fieldset.innerHTML = INFRA_TYPES.map((t) => `
    <label><input type="checkbox" value="${t.key}" checked> ${t.label}</label>
  `).join("");
}

function getCheckedTypeKeys(fieldsetId) {
  const fieldset = document.getElementById(fieldsetId);
  if (!fieldset) return [];
  return [...fieldset.querySelectorAll("input[type=checkbox]:checked")].map((el) => el.value);
}

function initChoropleth() {
  buildChoroplethTypeList();
  const toggleBtn = document.getElementById("btn-choropleth-toggle");
  if (!toggleBtn) return;

  toggleBtn.addEventListener("click", async () => {
    if (state.choropleth.active) {
      deactivateChoropleth();
      return;
    }
    const typeKeys = getCheckedTypeKeys("choropleth-type-list");
    if (!typeKeys.length) {
      showToast("error", "Sélectionnez au moins un type d'infrastructure à cartographier.");
      return;
    }
    if (!state.allDepartementsData || !state.allDepartementsData.features.length) {
      showToast("error", "Les départements ne sont pas encore chargés, réessayez dans un instant.");
      return;
    }
    toggleBtn.disabled = true;
    toggleBtn.innerHTML = '<span class="btn-tool-icon" aria-hidden="true">⏳</span> Calcul…';
    showMapLoading();
    try {
      await loadAllNationalInfra(typeKeys);
      activateChoropleth(typeKeys);
    } catch (err) {
      console.error(err);
      showApiError(err);
    } finally {
      hideMapLoading();
      toggleBtn.disabled = false;
    }
  });
}

function activateChoropleth(typeKeys) {
  const counts = computeInfraCountsByDepartement(typeKeys);
  const max = Math.max(0, ...[...counts.values()].map((v) => v.total));

  if (state.choropleth.layer) state.map.removeLayer(state.choropleth.layer);

  state.choropleth.layer = L.geoJSON(state.allDepartementsData, {
    style: (feature) => {
      const entry = counts.get(feature.properties.gid);
      const total = entry ? entry.total : 0;
      return { color: "#223357", weight: 1, fillColor: choroplethColorFor(total, max), fillOpacity: 0.72 };
    },
    onEachFeature: (feature, layer) => {
      const entry = counts.get(feature.properties.gid);
      const total = entry ? entry.total : 0;
      const breakdown = entry
        ? Object.entries(entry.byType)
            .map(([k, n]) => `<dt>${escapeHtml((INFRA_TYPES.find((t) => t.key === k) || {}).label || k)}</dt><dd>${n}</dd>`)
            .join("")
        : "";
      layer.bindPopup(
        `<div class="popup-content"><h4>${escapeHtml(feature.properties.nom)}</h4>` +
        `<p style="margin:0.2rem 0 0.5rem;"><strong>${total}</strong> infrastructure(s) au total</p>` +
        `<dl>${breakdown}</dl></div>`
      );
      layer.on("click", () => zoomToFeature(feature));
    },
  }).addTo(state.map);

  state.choropleth.active = true;
  state.choropleth.counts = counts;

  const toggleBtn = document.getElementById("btn-choropleth-toggle");
  toggleBtn.innerHTML = '<span class="btn-tool-icon" aria-hidden="true">✕</span> Désactiver';
  toggleBtn.classList.add("active");

  renderChoroplethLegend(max);
  showToast("ok", "Carte choroplèthe générée à partir d'une jointure spatiale nationale.");
}

function deactivateChoropleth() {
  if (state.choropleth.layer) { state.map.removeLayer(state.choropleth.layer); state.choropleth.layer = null; }
  state.choropleth.active = false;
  state.choropleth.counts = null;

  const toggleBtn = document.getElementById("btn-choropleth-toggle");
  if (toggleBtn) {
    toggleBtn.innerHTML = '<span class="btn-tool-icon" aria-hidden="true">🎨</span> Activer';
    toggleBtn.classList.remove("active");
  }
  const legend = document.getElementById("choropleth-legend");
  if (legend) { legend.innerHTML = ""; legend.classList.add("hidden"); }
}

function renderChoroplethLegend(max) {
  const legend = document.getElementById("choropleth-legend");
  if (!legend) return;
  const steps = CHOROPLETH_RAMP.length;
  const blocks = CHOROPLETH_RAMP.map((color, i) => {
    const lo = Math.round((i / steps) * max);
    const hi = i === steps - 1 ? max : Math.round(((i + 1) / steps) * max) - 1;
    const label = max <= 0 ? "0" : (lo === hi ? `${lo}` : `${lo}–${hi}`);
    return `<span class="legend-swatch-block"><span class="legend-color" style="background:${color}"></span> ${label}</span>`;
  }).join("");
  legend.innerHTML = `${blocks}<span style="color:var(--ink-500);">infrastructure(s) / département</span>`;
  legend.classList.remove("hidden");
}

// ============================================================
// CARTE DE CHALEUR — DENSITÉ D'UN TYPE D'INFRASTRUCTURE CHOISI
// ============================================================

function initHeatmap() {
  const select = document.getElementById("heatmap-type-select");
  const toggleBtn = document.getElementById("btn-heatmap-toggle");
  const radius = document.getElementById("heatmap-radius");
  const radiusValue = document.getElementById("heatmap-radius-value");
  if (!select || !toggleBtn) return;

  select.innerHTML = INFRA_TYPES.map((t) => `<option value="${t.key}">${t.label}</option>`).join("");

  // Changer de type ou de rayon pendant que la carte de chaleur est active la recalcule à la volée.
  select.addEventListener("change", () => { if (state.heatmap.active) activateHeatmap(select.value); });
  radius.addEventListener("input", () => {
    radiusValue.textContent = radius.value;
    if (state.heatmap.layer) state.heatmap.layer.setOptions({ radius: Number(radius.value) });
  });

  toggleBtn.addEventListener("click", async () => {
    if (state.heatmap.active) { deactivateHeatmap(); return; }
    if (typeof L.heatLayer !== "function") {
      showToast("error", "La librairie de carte de chaleur (leaflet.heat) n'a pas pu être chargée.");
      return;
    }
    toggleBtn.disabled = true;
    toggleBtn.innerHTML = '<span class="btn-tool-icon" aria-hidden="true">⏳</span> Chargement…';
    showMapLoading();
    try {
      await activateHeatmap(select.value);
    } catch (err) {
      console.error(err);
      showApiError(err);
    } finally {
      hideMapLoading();
      toggleBtn.disabled = false;
    }
  });
}

async function activateHeatmap(typeKey) {
  const type = INFRA_TYPES.find((t) => t.key === typeKey);
  const features = await loadNationalInfra(typeKey);
  const points = features
    .filter((f) => f.geometry && f.geometry.type === "Point")
    .map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0], 0.6]);

  if (state.heatmap.layer) { state.map.removeLayer(state.heatmap.layer); state.heatmap.layer = null; }

  const radius = Number(document.getElementById("heatmap-radius").value);
  state.heatmap.layer = L.heatLayer(points, {
    radius,
    blur: Math.round(radius * 0.8),
    maxZoom: 13,
    gradient: { 0.2: "#1a9850", 0.45: "#91cf60", 0.65: "#fee08b", 0.85: "#fc8d59", 1.0: "#d73027" },
  }).addTo(state.map);
  state.heatmap.active = true;
  state.heatmap.typeKey = typeKey;

  const toggleBtn = document.getElementById("btn-heatmap-toggle");
  toggleBtn.innerHTML = '<span class="btn-tool-icon" aria-hidden="true">✕</span> Désactiver';
  toggleBtn.classList.add("active");
  document.getElementById("heatmap-legend").classList.remove("hidden");

  const status = document.getElementById("heatmap-status");
  status.textContent = points.length
    ? `Carte de chaleur générée à partir de ${points.length} point(s) « ${type.label} » sur tout le territoire.`
    : `Aucun point « ${type.label} » trouvé pour générer une carte de chaleur.`;

  activateTab("map");
}

function deactivateHeatmap() {
  if (state.heatmap.layer) { state.map.removeLayer(state.heatmap.layer); state.heatmap.layer = null; }
  state.heatmap.active = false;
  state.heatmap.typeKey = null;

  const toggleBtn = document.getElementById("btn-heatmap-toggle");
  if (toggleBtn) {
    toggleBtn.innerHTML = '<span class="btn-tool-icon" aria-hidden="true">🔥</span> Activer';
    toggleBtn.classList.remove("active");
  }
  document.getElementById("heatmap-legend")?.classList.add("hidden");
  const status = document.getElementById("heatmap-status");
  if (status) status.textContent = "";
}

// ============================================================
// RECHERCHE DE PROXIMITÉ GÉOLOCALISÉE
// ============================================================

function initProximitySearch() {
  const fieldset = document.getElementById("proximity-type-list");
  if (fieldset) {
    fieldset.innerHTML = INFRA_TYPES.map((t) => `
      <label><input type="checkbox" value="${t.key}" checked> ${t.label}</label>
    `).join("");
  }

  const btn = document.getElementById("btn-proximity-locate");
  const radius = document.getElementById("proximity-radius");
  const radiusValue = document.getElementById("proximity-radius-value");
  if (!btn) return;

  radius.addEventListener("input", () => {
    radiusValue.textContent = radius.value;
    if (state.proximity.userLatLng) runProximitySearch();
  });

  fieldset && fieldset.addEventListener("change", () => {
    if (state.proximity.userLatLng) runProximitySearch();
  });

  btn.addEventListener("click", () => {
    const status = document.getElementById("proximity-status");
    if (!navigator.geolocation) {
      status.textContent = "La géolocalisation n'est pas disponible sur cet appareil.";
      return;
    }
    btn.disabled = true;
    status.textContent = "Localisation en cours…";
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        state.proximity.userLatLng = L.latLng(pos.coords.latitude, pos.coords.longitude);
        status.textContent = "";
        btn.disabled = false;
        await runProximitySearch();
      },
      () => {
        status.textContent = "Géolocalisation refusée ou indisponible. Vous pouvez aussi cliquer sur « Me géolocaliser » sur la carte.";
        btn.disabled = false;
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

async function runProximitySearch() {
  const status = document.getElementById("proximity-status");
  const resultsEl = document.getElementById("proximity-results");
  const userLatLng = state.proximity.userLatLng;
  if (!userLatLng) return;

  const typeKeys = getCheckedTypeKeys("proximity-type-list");
  if (!typeKeys.length) {
    resultsEl.innerHTML = "";
    status.textContent = "Sélectionnez au moins un type d'infrastructure.";
    return;
  }

  const radiusKm = Number(document.getElementById("proximity-radius").value);
  status.textContent = "Recherche en cours…";
  showMapLoading();
  try {
    await loadAllNationalInfra(typeKeys);
  } catch (err) {
    hideMapLoading();
    status.textContent = "";
    showApiError(err);
    return;
  }
  hideMapLoading();

  const radiusMeters = radiusKm * 1000;
  const matches = [];
  typeKeys.forEach((typeKey) => {
    const type = INFRA_TYPES.find((t) => t.key === typeKey);
    (state.nationalInfra[typeKey] || []).forEach((f) => {
      if (!f.geometry || f.geometry.type !== "Point") return;
      const [lng, lat] = f.geometry.coordinates;
      const latlng = L.latLng(lat, lng);
      const distance = userLatLng.distanceTo(latlng);
      if (distance <= radiusMeters) matches.push({ feature: f, type, distance, latlng });
    });
  });
  matches.sort((a, b) => a.distance - b.distance);

  renderProximityOnMap(userLatLng, radiusMeters, matches);
  renderProximityResults(matches);

  status.textContent = matches.length
    ? `${matches.length} infrastructure(s) trouvée(s) dans un rayon de ${radiusKm} km.`
    : `Aucune infrastructure trouvée dans un rayon de ${radiusKm} km — essayez d'élargir le rayon.`;
}

function renderProximityOnMap(userLatLng, radiusMeters, matches) {
  const p = state.proximity;
  if (p.marker) state.map.removeLayer(p.marker);
  if (p.circle) state.map.removeLayer(p.circle);
  if (p.highlightLayer) state.map.removeLayer(p.highlightLayer);

  p.marker = L.marker(userLatLng).addTo(state.map).bindPopup("Votre position");
  p.circle = L.circle(userLatLng, {
    radius: radiusMeters, color: "#C9A84C", fillColor: "#C9A84C", fillOpacity: 0.06, weight: 2, dashArray: "5 4",
  }).addTo(state.map);

  const group = L.layerGroup(
    matches.slice(0, 60).map((m) =>
      L.circleMarker(m.latlng, { radius: 6, color: m.type.color, weight: 2, fillColor: m.type.color, fillOpacity: 0.85 })
        .bindPopup(buildPopupHtml(m.feature.properties, m.type.label))
    )
  );
  p.highlightLayer = group.addTo(state.map);

  const bounds = L.latLngBounds([userLatLng]);
  bounds.extend(L.circle(userLatLng, { radius: radiusMeters }).getBounds());
  state.map.fitBounds(bounds, { padding: [30, 30] });
  activateTab("map");
}

function renderProximityResults(matches) {
  const resultsEl = document.getElementById("proximity-results");
  if (!matches.length) { resultsEl.innerHTML = ""; return; }

  resultsEl.innerHTML = matches.map((m, i) => `
    <li class="proximity-result-item" data-index="${i}">
      <span class="pr-rank">${i + 1}</span>
      <span class="pr-info">
        <strong>${escapeHtml(m.feature.properties.nom || m.type.label)}</strong>
        <span>${escapeHtml(m.type.label)}</span>
      </span>
      <span class="pr-distance">${formatDistance(m.distance)}</span>
    </li>
  `).join("");

  resultsEl.querySelectorAll(".proximity-result-item").forEach((li) => {
    li.addEventListener("click", () => {
      const m = matches[Number(li.dataset.index)];
      activateTab("map");
      state.map.setView(m.latlng, 14);
      // Popup will be handled by the marker click
    });
  });
}

// ============================================================
// COMPARATEUR DE DÉPARTEMENTS
// ============================================================

const COMPARE_DEPT_COLORS = ["#4C6B8A", "#B5533C", "#7A8B4F"];

function initComparator() {
  const fieldset = document.getElementById("compare-type-list");
  if (fieldset) {
    fieldset.innerHTML = INFRA_TYPES.map((t) => `
      <label><input type="checkbox" value="${t.key}" checked> ${t.label}</label>
    `).join("");
  }
  const runBtn = document.getElementById("btn-compare-run");
  if (!runBtn) return;
  runBtn.addEventListener("click", runComparator);
}

/** Remplit le <select multiple> des départements dès que la liste nationale est disponible. */
function populateCompareDeptSelect() {
  const select = document.getElementById("compare-dept-select");
  if (!select || !state.allDepartementsData) return;
  populateSelect(
    select,
    state.allDepartementsData.features,
    (f) => f.properties.gid,
    (f) => f.properties.nom,
    ""
  );
  select.querySelector("option[value='']")?.remove();
}

async function runComparator() {
  const status = document.getElementById("compare-status");
  const select = document.getElementById("compare-dept-select");
  const selectedGids = [...select.selectedOptions].map((o) => o.value);

  if (selectedGids.length < 2) { status.textContent = "Sélectionnez au moins 2 départements (3 maximum)."; return; }
  if (selectedGids.length > 3) { status.textContent = "3 départements maximum pour garder la comparaison lisible."; return; }

  const typeKeys = getCheckedTypeKeys("compare-type-list");
  if (!typeKeys.length) { status.textContent = "Sélectionnez au moins un type d'infrastructure."; return; }

  const depts = selectedGids
    .map((gid) => state.allDepartementsData.features.find((f) => String(f.properties.gid) === String(gid)))
    .filter(Boolean);

  status.textContent = "Calcul en cours (jointure spatiale nationale)…";
  showMapLoading();
  try {
    await loadAllNationalInfra(typeKeys);
    const counts = computeInfraCountsByDepartement(typeKeys);
    renderComparator(depts, typeKeys, counts);
    status.textContent = "";
  } catch (err) {
    console.error(err);
    showApiError(err);
  } finally {
    hideMapLoading();
  }
}

function renderComparator(depts, typeKeys, counts) {
  renderCompareChart(depts, typeKeys, counts);
  renderCompareTable(depts, typeKeys, counts);
}

function renderCompareChart(depts, typeKeys, counts) {
  const canvas = document.getElementById("compare-chart");
  if (!canvas) return;
  canvas.classList.remove("hidden");

  const styles = getComputedStyle(document.documentElement);
  const inkStrong = styles.getPropertyValue("--ink-900").trim() || "#1A1A18";
  const inkSoft = styles.getPropertyValue("--ink-700").trim() || "#44413C";

  const dpr = window.devicePixelRatio || 1;
  const widthCss = canvas.parentElement.clientWidth || 700;
  const groupW = Math.max(70, widthCss / typeKeys.length);
  const heightCss = 280;

  canvas.width = widthCss * dpr;
  canvas.height = heightCss * dpr;
  canvas.style.width = "100%";
  canvas.style.height = `${heightCss}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, widthCss, heightCss);

  const chartTop = 30, chartBottom = heightCss - 34;
  const chartH = chartBottom - chartTop;

  let max = 1;
  typeKeys.forEach((typeKey) => {
    depts.forEach((d) => {
      const entry = counts.get(d.properties.gid);
      max = Math.max(max, entry ? entry.byType[typeKey] || 0 : 0);
    });
  });

  ctx.font = "600 10.5px 'Work Sans', sans-serif";
  ctx.textAlign = "center";

  typeKeys.forEach((typeKey, gi) => {
    const type = INFRA_TYPES.find((t) => t.key === typeKey);
    const groupX = gi * groupW;
    const barW = Math.min(34, (groupW - 16) / depts.length);
    const totalBarsW = barW * depts.length;
    const startX = groupX + (groupW - totalBarsW) / 2;

    depts.forEach((d, di) => {
      const entry = counts.get(d.properties.gid);
      const val = entry ? entry.byType[typeKey] || 0 : 0;
      const barH = (val / max) * chartH;
      const x = startX + di * barW;
      const y = chartBottom - barH;

      ctx.fillStyle = COMPARE_DEPT_COLORS[di % COMPARE_DEPT_COLORS.length];
      roundRect(ctx, x + 1, y, barW - 2, Math.max(1, barH), 3);
      ctx.fill();

      if (val > 0) {
        ctx.fillStyle = inkStrong;
        ctx.fillText(String(val), x + barW / 2, y - 4);
      }
    });

    ctx.fillStyle = inkSoft;
    ctx.fillText(truncateLabel(ctx, type.label, groupW - 6), groupX + groupW / 2, chartBottom + 16);
  });

  ctx.strokeStyle = inkSoft;
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.moveTo(0, chartBottom);
  ctx.lineTo(widthCss, chartBottom);
  ctx.stroke();
  ctx.globalAlpha = 1;

  renderCompareLegend(depts);
}

function renderCompareLegend(depts) {
  let legend = document.getElementById("compare-legend");
  if (!legend) {
    legend = document.createElement("div");
    legend.id = "compare-legend";
    legend.className = "compare-legend";
    document.getElementById("compare-chart").insertAdjacentElement("beforebegin", legend);
  }
  legend.innerHTML = depts.map((d, i) => `
    <span><span class="legend-color" style="background:${COMPARE_DEPT_COLORS[i % COMPARE_DEPT_COLORS.length]}"></span>${escapeHtml(d.properties.nom)}</span>
  `).join("");
}

function renderCompareTable(depts, typeKeys, counts) {
  const wrap = document.getElementById("compare-table-wrap");
  if (!wrap) return;
  const header = `<tr><th>Type d'infrastructure</th>${depts.map((d) => `<th>${escapeHtml(d.properties.nom)}</th>`).join("")}</tr>`;
  const rows = typeKeys.map((typeKey) => {
    const type = INFRA_TYPES.find((t) => t.key === typeKey);
    const cells = depts.map((d) => {
      const entry = counts.get(d.properties.gid);
      return `<td>${entry ? entry.byType[typeKey] || 0 : 0}</td>`;
    }).join("");
    return `<tr><td>${escapeHtml(type.label)}</td>${cells}</tr>`;
  }).join("");
  const totalRow = `<tr style="font-weight:700;"><td>Total</td>${depts.map((d) => {
    const entry = counts.get(d.properties.gid);
    return `<td>${entry ? entry.total : 0}</td>`;
  }).join("")}</tr>`;

  wrap.innerHTML = `<table><thead>${header}</thead><tbody>${rows}${totalRow}</tbody></table>`;
}

// ============================================================
// OUTIL DE MESURE DE DISTANCE
// ============================================================

function initMeasureTool() {
  const btn = document.getElementById("btn-measure");
  const clearBtn = document.getElementById("btn-measure-clear");
  const badge = document.getElementById("measure-badge");
  if (!btn) return;

  state.measure = { active: false, points: [], polyline: null, markers: [] };

  function updateBadge() {
    if (!state.measure.active) { badge.classList.remove("visible"); return; }
    badge.classList.add("visible");
    const pts = state.measure.points;
    if (pts.length < 2) {
      badge.textContent = "Cliquez sur la carte pour placer des points de mesure (Échap pour arrêter)";
      return;
    }
    let dist = 0;
    for (let i = 1; i < pts.length; i += 1) dist += pts[i - 1].distanceTo(pts[i]);
    badge.textContent = `Distance totale : ${formatDistance(dist)} (${pts.length} points — Échap pour arrêter)`;
  }

  function resetMeasure() {
    state.measure.points = [];
    if (state.measure.polyline) { state.map.removeLayer(state.measure.polyline); state.measure.polyline = null; }
    state.measure.markers.forEach((m) => state.map.removeLayer(m));
    state.measure.markers = [];
    updateBadge();
  }

  function setActive(isActive) {
    state.measure.active = isActive;
    btn.classList.toggle("active", isActive);
    btn.innerHTML = isActive
      ? '<span class="btn-tool-icon" aria-hidden="true">✕</span> Arrêter la mesure'
      : '<span class="btn-tool-icon" aria-hidden="true">📏</span> Mesurer une distance';
    state.map.getContainer().style.cursor = isActive ? "crosshair" : "";
    if (!isActive) resetMeasure(); else updateBadge();
  }

  state.map.on("click", (e) => {
    if (!state.measure.active) return;
    state.measure.points.push(e.latlng);
    const marker = L.circleMarker(e.latlng, { radius: 5, color: "#C9A84C", weight: 2, fillColor: "#C9A84C", fillOpacity: 1 }).addTo(state.map);
    state.measure.markers.push(marker);
    if (state.measure.polyline) state.map.removeLayer(state.measure.polyline);
    if (state.measure.points.length > 1) {
      state.measure.polyline = L.polyline(state.measure.points, { color: "#C9A84C", weight: 3, dashArray: "6 5" }).addTo(state.map);
    }
    updateBadge();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.measure.active) setActive(false);
  });

  btn.addEventListener("click", () => setActive(!state.measure.active));
  clearBtn.addEventListener("click", resetMeasure);
}

function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
}

// ============================================================
// PARTAGE DE VUE VIA URL
// ============================================================

function initShareLink() {
  const btn = document.getElementById("btn-share-link");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const params = new URLSearchParams();
    if (state.currentRegionCode) params.set("region", state.currentRegionCode);
    const deptSelect = document.getElementById("select-departement");
    if (deptSelect.value) params.set("dept", deptSelect.value);
    const activeLayers = INFRA_TYPES.filter((t) => state.infraLayers[t.key]).map((t) => t.key);
    if (activeLayers.length) params.set("layers", activeLayers.join(","));

    const url = `${location.origin}${location.pathname}#${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("ok", "Lien de la vue copié dans le presse-papiers.");
    } catch (_) {
      window.prompt("Copiez ce lien :", url);
    }
  });
}

async function applyStateFromUrl() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash) return;
  const params = new URLSearchParams(hash);
  const region = params.get("region");
  const dept = params.get("dept");
  const layers = params.get("layers");

  if (region) {
    document.getElementById("select-region").value = region;
    await handleRegionChange(region);
  }
  if (dept) {
    document.getElementById("select-departement").value = dept;
    handleDepartementChange(dept);
  }
  if (layers) {
    layers.split(",").filter(Boolean).forEach((key) => {
      const type = INFRA_TYPES.find((t) => t.key === key);
      const checkbox = document.getElementById(`infra-${key}`);
      if (type && checkbox) {
        checkbox.checked = true;
        toggleInfraLayer(type, true);
      }
    });
  }
}

// ============================================================
// EXPORT GEOJSON / CSV
// ============================================================

function initExportButtons() {
  const geojsonBtn = document.getElementById("btn-export-geojson");
  const csvBtn = document.getElementById("btn-export-csv");
  if (geojsonBtn) geojsonBtn.addEventListener("click", () => exportActiveTable("geojson"));
  if (csvBtn) csvBtn.addEventListener("click", () => exportActiveTable("csv"));
}

function initDataTableSelector() {
  const tableSelect = document.getElementById("table-select");
  const loadBtn = document.getElementById("btn-load-table");
  const dataPanel = document.getElementById("data-panel");

  if (!tableSelect || !loadBtn) return;

  loadBtn.addEventListener("click", async () => {
    const selectedTable = tableSelect.value;
    if (!selectedTable) {
      showToast("error", "Veuillez sélectionner une table");
      return;
    }

    loadBtn.disabled = true;
    loadBtn.textContent = "Chargement...";

    try {
      let data;
      let label;

      switch (selectedTable) {
        case "regions":
          data = state.regionsData || await apiGetWithFallback("/regions", () => window.SITS_MOCK.getRegions());
          label = "Régions du Sénégal";
          break;
        case "departements":
          data = state.departementsData || await apiGetWithFallback("/departements", () => window.SITS_MOCK.getDepartements(""));
          label = "Départements du Sénégal";
          break;
        case "centresante":
          data = await fetchInfraFeatures("centresante");
          label = "Centres de santé";
          break;
        case "forage":
          data = await fetchInfraFeatures("forage");
          label = "Forages";
          break;
        case "hoteleriepoint":
          data = await fetchInfraFeatures("hoteleriepoint");
          label = "Hôtellerie";
          break;
        case "loisir":
          data = await fetchInfraFeatures("loisir");
          label = "Équipements de loisir";
          break;
        case "lyceepublic":
          data = await fetchInfraFeatures("lyceepublic");
          label = "Établissements scolaires";
          break;
        case "marche":
          data = await fetchInfraFeatures("marche");
          label = "Marchés";
          break;
        case "parking":
          data = await fetchInfraFeatures("parking");
          label = "Parkings";
          break;
        default:
          throw new Error("Table non reconnue");
      }

      if (data && data.features) {
        setTableSource(label, data.features);
        dataPanel.classList.remove("hidden");
        document.getElementById("table-caption").textContent = label;
        document.getElementById("table-count").textContent = `${data.features.length} enregistrements`;
        showToast("ok", `Table ${label} chargée avec succès`);
      }
    } catch (err) {
      console.error(err);
      showToast("error", "Erreur lors du chargement de la table");
    } finally {
      loadBtn.disabled = false;
      loadBtn.textContent = "Charger les données";
    }
  });
}

function exportActiveTable(format) {
  const source = state.activeTableSource;
  if (!source || !source.features.length) {
    showToast("error", "Aucune donnée à exporter pour le moment.");
    return;
  }
  const filename = slugify(source.label);
  if (format === "geojson") {
    const fc = { type: "FeatureCollection", features: source.features };
    downloadFile(`${filename}.geojson`, JSON.stringify(fc, null, 2), "application/geo+json");
  } else {
    downloadFile(`${filename}.csv`, toCsv(source.features, source.columns), "text/csv");
  }
  showToast("ok", `Export ${format.toUpperCase()} téléchargé (${source.features.length} entrée(s)).`);
}

function toCsv(features, columns) {
  const escapeCsv = (value) => {
    const str = value === null || value === undefined ? "" : String(value);
    return /[",;\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const header = columns.map(escapeCsv).join(";");
  const rows = features.map((f) => columns.map((c) => escapeCsv(f.properties[c])).join(";"));
  return [header, ...rows].join("\n");
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slugify(str) {
  const clean = String(str)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return clean || "export";
}

// ============================================================
// RAPPORT IMPRIMABLE D'UN DÉPARTEMENT
// ============================================================

function initPrintReport() {
  const btn = document.getElementById("btn-print-report");
  if (!btn) return;
  btn.addEventListener("click", generateDepartementReport);
}

/** Active/désactive le bouton de rapport selon qu'un département est sélectionné. */
function refreshPrintReportButton() {
  const btn = document.getElementById("btn-print-report");
  if (!btn) return;
  btn.disabled = !state.currentDepartementNom;
  btn.title = state.currentDepartementNom
    ? `Générer le rapport de ${state.currentDepartementNom}`
    : "Sélectionnez un département pour générer son rapport";
}

async function generateDepartementReport() {
  const deptNom = state.currentDepartementNom;
  if (!deptNom) { showToast("error", "Sélectionnez d'abord un département."); return; }

  const deptFeature = (state.departementsData?.features || state.allDepartementsData?.features || [])
    .find((f) => f.properties.nom === deptNom);
  if (!deptFeature) { showToast("error", "Département introuvable."); return; }

  showMapLoading();
  try {
    const perType = await Promise.all(INFRA_TYPES.map(async (type) => {
      const fc = await apiGetWithFallback(
        `/infrastructures?type=${type.key}&departement=${encodeURIComponent(deptNom)}`,
        () => window.SITS_MOCK.getInfrastructures(type.key, deptNom)
      );
      return { type, features: fc.features };
    }));
    renderPrintReport(deptFeature, perType);
    setTimeout(() => window.print(), 80);
  } catch (err) {
    console.error(err);
    showApiError(err);
  } finally {
    hideMapLoading();
  }
}

function renderPrintReport(deptFeature, perType) {
  const container = document.getElementById("print-report");
  if (!container) return;

  const total = perType.reduce((sum, p) => sum + p.features.length, 0);
  const regionCode = deptFeature.properties.code_region || "";
  const region = state.regionsData?.features.find((f) => String(f.properties.code_region) === String(regionCode));
  const dateStr = new Date().toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });

  const statsRows = perType
    .filter((p) => p.features.length > 0)
    .map((p) => `<tr><td>${escapeHtml(p.type.label)}</td><td>${p.features.length}</td></tr>`)
    .join("");

  const listTables = perType
    .filter((p) => p.features.length > 0)
    .map((p) => {
      const rows = p.features.slice(0, 300).map((f) =>
        `<tr><td>${escapeHtml(f.properties.nom || "—")}</td><td>${escapeHtml(f.properties.descriptif || "—")}</td></tr>`
      ).join("");
      return `
        <h2>${escapeHtml(p.type.label)} (${p.features.length})</h2>
        <table class="pr-list-table">
          <thead><tr><th>Nom</th><th>Description</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    })
    .join("");

  const svgMap = buildPrintMapSvg(deptFeature, perType);

  container.innerHTML = `
    <h1>Rapport territorial — ${escapeHtml(deptFeature.properties.nom)}</h1>
    <p class="pr-meta">Région : ${escapeHtml(region ? region.properties.nom : "—")} · Généré le ${dateStr} · SITS — Système d'Information Territorial du Sénégal</p>

    <h2>Carte du département</h2>
    ${svgMap}

    <h2>Statistiques</h2>
    <table class="pr-stats-table">
      <thead><tr><th>Type d'infrastructure</th><th>Nombre</th></tr></thead>
      <tbody>${statsRows || '<tr><td colspan="2">Aucune infrastructure recensée.</td></tr>'}</tbody>
    </table>
    <p><strong>${total}</strong> infrastructure(s) au total dans ce département.</p>

    ${listTables}
  `;
}

/** Construit une mini-carte SVG autonome (contour du département + points), sans dépendance externe ni capture d'écran. */
function buildPrintMapSvg(deptFeature, perType) {
  const width = 640, height = 360, pad = 16;
  const polygons = deptFeature.geometry.type === "Polygon" ? [deptFeature.geometry.coordinates]
    : deptFeature.geometry.type === "MultiPolygon" ? deptFeature.geometry.coordinates
    : [];

  const allPoints = [];
  polygons.forEach((poly) => poly.forEach((ring) => ring.forEach(([lng, lat]) => allPoints.push([lng, lat]))));
  perType.forEach((p) => p.features.forEach((f) => {
    if (f.geometry && f.geometry.type === "Point") allPoints.push(f.geometry.coordinates);
  }));

  if (!allPoints.length) return '<p class="hint">Géométrie indisponible pour ce département.</p>';

  const lngs = allPoints.map((p) => p[0]);
  const lats = allPoints.map((p) => p[1]);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const spanLng = Math.max(maxLng - minLng, 1e-5);
  const spanLat = Math.max(maxLat - minLat, 1e-5);

  const project = ([lng, lat]) => {
    const x = pad + ((lng - minLng) / spanLng) * (width - 2 * pad);
    const y = pad + (1 - (lat - minLat) / spanLat) * (height - 2 * pad);
    return [x, y];
  };

  const polygonPaths = polygons.map((poly) =>
    poly.map((ring) => ring.map((pt, i) => `${i === 0 ? "M" : "L"}${project(pt).join(",")}`).join(" ") + " Z").join(" ")
  ).join(" ");

  const dots = perType.flatMap((p) =>
    p.features
      .filter((f) => f.geometry && f.geometry.type === "Point")
      .map((f) => {
        const [x, y] = project(f.geometry.coordinates);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${p.type.color}" stroke="#fff" stroke-width="0.8"/>`;
      })
  ).join("");

  const legend = perType
    .filter((p) => p.features.length > 0)
    .map((p) => `<span><i style="background:${p.type.color}"></i>${escapeHtml(p.type.label)}</span>`)
    .join("");

  return `
    <svg class="pr-svg-map" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <path d="${polygonPaths}" fill="#DCF5E8" stroke="#223357" stroke-width="1.5"/>
      ${dots}
    </svg>
    <div class="pr-legend">${legend}</div>
  `;
}

// ============================================================
// MODE ADMINISTRATEUR — AJOUT D'UNE INFRASTRUCTURE DEPUIS L'UI
// ============================================================

// NB : ce code est un simple identifiant de démonstration côté client, pas une
// authentification réelle. Il ne fait que masquer/afficher le formulaire ; la
// véritable protection (jeton, session, rôle) doit être assurée côté serveur.
const ADMIN_DEMO_CODE = "sits-admin";

function initAdmin() {
  const toggleBtn = document.getElementById("btn-admin-mode");
  const panel = document.getElementById("admin-panel");
  const typeSelect = document.getElementById("admin-type");
  const pickBtn = document.getElementById("btn-admin-pick");
  const submitBtn = document.getElementById("btn-admin-submit");
  const latInput = document.getElementById("admin-lat");
  const lngInput = document.getElementById("admin-lng");
  if (!toggleBtn || !panel) return;

  typeSelect.innerHTML = INFRA_TYPES.map((t) => `<option value="${t.key}">${t.label}</option>`).join("");

  toggleBtn.addEventListener("click", () => {
    if (panel.hidden) {
      const code = window.prompt("Code administrateur (démonstration) :");
      if (code === null) return;
      if (code !== ADMIN_DEMO_CODE) { showToast("error", "Code incorrect."); return; }
      panel.hidden = false;
      toggleBtn.classList.add("active");
      showToast("ok", "Mode administrateur activé.");
    } else {
      panel.hidden = true;
      toggleBtn.classList.remove("active");
      setAdminPicking(false);
    }
  });

  pickBtn.addEventListener("click", () => setAdminPicking(!state.admin.picking));

  state.map.on("click", (e) => {
    if (!state.admin.picking) return;
    latInput.value = e.latlng.lat.toFixed(6);
    lngInput.value = e.latlng.lng.toFixed(6);
    if (state.admin.previewMarker) state.map.removeLayer(state.admin.previewMarker);
    state.admin.previewMarker = L.marker(e.latlng, { opacity: 0.85 })
      .addTo(state.map)
      .bindPopup("Nouvel emplacement (aperçu, non enregistré)")
      .openPopup();
    setAdminPicking(false);
  });

  submitBtn.addEventListener("click", () => submitAdminInfrastructure());

  function setAdminPicking(active) {
    state.admin.picking = active;
    pickBtn.classList.toggle("active", active);
    state.map.getContainer().style.cursor = active ? "crosshair" : "";
    if (active) showToast("info", "Cliquez sur la carte pour placer le point.");
  }
}

async function submitAdminInfrastructure() {
  const submitBtn = document.getElementById("btn-admin-submit");
  const type = document.getElementById("admin-type").value;
  const nom = document.getElementById("admin-nom").value.trim();
  const descriptif = document.getElementById("admin-descriptif").value.trim();
  const lat = parseFloat(document.getElementById("admin-lat").value);
  const lng = parseFloat(document.getElementById("admin-lng").value);

  if (!nom) { showToast("error", "Le nom de l'infrastructure est requis."); return; }
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    showToast("error", "Placez un point sur la carte ou saisissez des coordonnées valides.");
    return;
  }

  submitBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/infrastructures`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, lat, lng, properties: { nom, descriptif } }),
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).error || ""; } catch (_) {}
      throw new Error(detail || `HTTP ${res.status}`);
    }

    showToast("ok", "Infrastructure enregistrée avec succès.");
    document.getElementById("admin-nom").value = "";
    document.getElementById("admin-descriptif").value = "";
    document.getElementById("admin-lat").value = "";
    document.getElementById("admin-lng").value = "";
    if (state.admin.previewMarker) { state.map.removeLayer(state.admin.previewMarker); state.admin.previewMarker = null; }

    delete state.nationalInfra[type]; // le cache national de ce type est désormais périmé
    const typeObj = INFRA_TYPES.find((t) => t.key === type);
    const checkbox = document.getElementById(`infra-${type}`);
    if (typeObj && checkbox && checkbox.checked) toggleInfraLayer(typeObj, true);
  } catch (err) {
    console.error(err);
    const msg = state.demoMode
      ? "Ajout indisponible en mode démonstration (l'API Flask n'est pas joignable)."
      : (err.message || "Échec de l'enregistrement.");
    showToast("error", msg);
  } finally {
    submitBtn.disabled = false;
  }
}

// ============================================================
// MODE SOMBRE
// ============================================================

function initDarkMode() {
  const btn = document.getElementById("btn-dark-toggle");
  if (!btn) return;
  const stored = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(stored || (prefersDark ? "dark" : "light"));

  btn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    applyTheme(current === "dark" ? "light" : "dark");
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
  const btn = document.getElementById("btn-dark-toggle");
  if (!btn) return;
  btn.setAttribute("aria-pressed", String(theme === "dark"));
  btn.setAttribute("aria-label", theme === "dark" ? "Activer le mode clair" : "Activer le mode sombre");
}

// ============================================================
// RECHERCHE GLOBALE
// ============================================================

function normalizeText(str) {
  return String(str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function buildSearchIndex() {
  const index = [];
  (state.regionsData?.features || []).forEach((f) => {
    index.push({ kind: "region", label: f.properties.nom, sub: "Région", feature: f });
  });
  (state.allDepartementsData?.features || []).forEach((f) => {
    index.push({ kind: "departement", label: f.properties.nom, sub: "Département", feature: f });
  });
  INFRA_TYPES.forEach((type) => {
    const feats = state.infraRawFeatures[type.key];
    if (!feats) return;
    feats.forEach((f) => {
      index.push({ kind: "infra", infraType: type, label: f.properties.nom || type.label, sub: type.label, feature: f });
    });
  });
  return index;
}

function searchMatches(query) {
  const needle = normalizeText(query).trim();
  if (!needle) return [];
  return buildSearchIndex()
    .filter((item) => normalizeText(item.label).includes(needle))
    .slice(0, 8);
}

function initSearch() {
  const input = document.getElementById("global-search");
  const resultsEl = document.getElementById("search-results");
  const clearBtn = document.getElementById("btn-clear-search");
  if (!input) return;

  let debounceTimer = null;
  let activeIndex = -1;
  let currentItems = [];

  function closeResults() {
    resultsEl.classList.add("hidden");
    resultsEl.innerHTML = "";
    activeIndex = -1;
  }

  function highlightActive() {
    resultsEl.querySelectorAll(".search-result-item").forEach((li, i) => {
      li.classList.toggle("active", i === activeIndex);
    });
    const activeLi = resultsEl.querySelector(".search-result-item.active");
    if (activeLi) activeLi.scrollIntoView({ block: "nearest" });
  }

  function renderResults(items) {
    currentItems = items;
    activeIndex = -1;
    if (!items.length) {
      resultsEl.innerHTML = `<li class="search-empty">Aucun résultat. Astuce : activez une couche d'infrastructure pour qu'elle soit indexée ici.</li>`;
      resultsEl.classList.remove("hidden");
      return;
    }
    resultsEl.innerHTML = items.map((item, i) => `
      <li role="option" data-index="${i}" class="search-result-item">
        <span class="search-result-label">${escapeHtml(item.label)}</span>
        <span class="search-result-sub">${escapeHtml(item.sub)}</span>
      </li>`).join("");
    resultsEl.classList.remove("hidden");
    resultsEl.querySelectorAll(".search-result-item").forEach((li) => {
      li.addEventListener("click", () => selectResult(currentItems[Number(li.dataset.index)]));
    });
  }

  async function selectResult(item) {
    if (!item) return;
    input.value = item.label;
    closeResults();

    if (item.kind === "region") {
      document.getElementById("select-region").value = item.feature.properties.code_region;
      await handleRegionChange(item.feature.properties.code_region);
    } else if (item.kind === "departement") {
      const codeRegion = item.feature.properties.code_region;
      document.getElementById("select-region").value = codeRegion;
      await handleRegionChange(codeRegion);
      const gid = String(item.feature.properties.gid);
      document.getElementById("select-departement").value = gid;
      handleDepartementChange(gid);
    } else {
      zoomToFeature(item.feature);
      // Popup will be handled by the marker click
    }
    if (window.closeSidebarOnMobile) window.closeSidebarOnMobile();
  }

  input.addEventListener("input", () => {
    clearBtn.classList.toggle("hidden", !input.value);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => renderResults(searchMatches(input.value)), 150);
  });

  input.addEventListener("keydown", (e) => {
    if (resultsEl.classList.contains("hidden")) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, currentItems.length - 1);
      highlightActive();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      highlightActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectResult(currentItems[activeIndex] ?? currentItems[0]);
    } else if (e.key === "Escape") {
      closeResults();
      input.blur();
    }
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.classList.add("hidden");
    closeResults();
    input.focus();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".header-search")) closeResults();
  });
}

// ============================================================
// FILTRES (région / département en cascade + fil d'ariane)
// ============================================================

function wireFilters() {
  const selectRegion = document.getElementById("select-region");
  const selectDept = document.getElementById("select-departement");

  selectRegion.addEventListener("change", (e) => handleRegionChange(e.target.value));
  selectDept.addEventListener("change", (e) => handleDepartementChange(e.target.value));

  document.getElementById("btn-reset").addEventListener("click", () => {
    selectRegion.value = "";
    selectDept.value = "";
    selectDept.innerHTML = '<option value="">Sélectionnez d\'abord une région</option>';
    selectDept.disabled = true;
    state.currentRegionCode = "";
    state.currentDepartementNom = "";
    if (state.departementsLayer) { state.map.removeLayer(state.departementsLayer); state.departementsLayer = null; }
    if (state.regionsLayer) state.map.fitBounds(state.regionsLayer.getBounds(), { padding: [20, 20] });
    setTableSource("Régions du Sénégal", state.regionsData ? state.regionsData.features : []);
    refreshActiveInfraLayers();
    renderBreadcrumb();
    refreshPrintReportButton();
  });

  document.getElementById("table-filter").addEventListener("input", (e) => renderTable(e.target.value));
}

async function handleRegionChange(code) {
  state.currentRegionCode = code;
  state.currentDepartementNom = "";

  if (code) {
    const feature = state.regionsData?.features.find((f) => String(f.properties.code_region) === String(code));
    if (feature) zoomToFeature(feature);
  } else if (state.regionsLayer) {
    state.map.fitBounds(state.regionsLayer.getBounds(), { padding: [20, 20] });
  }

  await loadDepartements(code);
  refreshActiveInfraLayers();
  renderBreadcrumb();
  refreshPrintReportButton();
}

function handleDepartementChange(gid) {
  const selectDept = document.getElementById("select-departement");
  selectDept.value = gid;

  if (!gid) {
    state.currentDepartementNom = "";
    if (state.departementsLayer) state.map.fitBounds(state.departementsLayer.getBounds(), { padding: [20, 20] });
    refreshActiveInfraLayers();
    renderBreadcrumb();
    refreshPrintReportButton();
    return;
  }
  const feature = state.departementsData?.features.find((f) => String(f.properties.gid) === String(gid));
  if (feature) {
    zoomToFeature(feature);
    // Popup will be handled by the layer click
    state.currentDepartementNom = feature.properties.nom || "";
  }
  refreshActiveInfraLayers();
  renderBreadcrumb();
  refreshPrintReportButton();
  if (window.closeSidebarOnMobile) window.closeSidebarOnMobile();
}

function renderBreadcrumb() {
  const nav = document.getElementById("breadcrumb");
  if (!nav) return;

  const parts = [{ label: "Sénégal", level: "senegal" }];
  if (state.currentRegionCode) {
    const region = state.regionsData?.features.find((f) => String(f.properties.code_region) === String(state.currentRegionCode));
    parts.push({ label: region ? region.properties.nom : state.currentRegionCode, level: "region" });
  }
  if (state.currentDepartementNom) {
    parts.push({ label: state.currentDepartementNom, level: "departement" });
  }

  nav.innerHTML = parts.map((p, i) => {
    const isLast = i === parts.length - 1;
    const sep = isLast ? "" : '<span class="breadcrumb-sep">›</span>';
    return `<button type="button" class="breadcrumb-item ${isLast ? "active" : ""}" data-level="${p.level}">${escapeHtml(p.label)}</button>${sep}`;
  }).join("");

  nav.querySelectorAll(".breadcrumb-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const level = btn.dataset.level;
      if (level === "senegal") document.getElementById("btn-reset").click();
      else if (level === "region") handleDepartementChange("");
      // "departement" est déjà le niveau le plus profond : rien à faire.
    });
  });
}

function populateSelect(selectEl, features, valueFn, labelFn, placeholder) {
  selectEl.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder;
  selectEl.appendChild(opt0);

  features
    .slice()
    .sort((a, b) => String(labelFn(a)).localeCompare(String(labelFn(b)), "fr"))
    .forEach((f) => {
      const opt = document.createElement("option");
      opt.value = valueFn(f);
      opt.textContent = labelFn(f);
      selectEl.appendChild(opt);
    });
}

function zoomToFeature(feature) {
  const layer = L.geoJSON(feature);
  if (layer.getBounds().isValid()) {
    state.map.fitBounds(layer.getBounds(), { padding: [30, 30] });
  }
}

function getFeatureCenter(feature) {
  try {
    const bounds = L.geoJSON(feature).getBounds();
    return bounds.isValid() ? bounds.getCenter() : null;
  } catch (_) {
    return null;
  }
}

let highlighted = null;
function highlightLayer(layer) {
  if (highlighted && highlighted.setStyle) highlighted.setStyle(regionStyle(highlighted.feature));
  if (layer.setStyle) {
    layer.setStyle(highlightRegionStyle());
    highlighted = layer;
  }
}

// ============================================================
// INFORMATIONS + FAVORIS
// ============================================================

function showInfo(properties, kindLabel, latlng) {
  const container = document.getElementById("tab-info-content");
  const entries = Object.entries(properties).filter(([k]) => !HIDDEN_PROPS.has(k));

  const title = properties.nom || properties.name || kindLabel;
  const rows = entries
    .map(([k, v]) => `<dt>${escapeHtml(prettifyKey(k))}</dt><dd>${escapeHtml(formatValue(v))}</dd>`)
    .join("");

  const favId = buildFavoriteId(kindLabel, properties);
  state.lastShownInfo = { favId, kindLabel, title, latlng, properties };
  const isFav = state.favorites.some((f) => f.id === favId);

  container.innerHTML = `
    <div class="info-head">
      <h3>${escapeHtml(title)} <small style="font-weight:400;color:var(--ink-500);font-family:var(--font-body);font-size:0.75rem;">— ${escapeHtml(kindLabel)}</small></h3>
      <button type="button" id="btn-toggle-favorite" class="btn-fav ${isFav ? "active" : ""}">${isFav ? "★ Retirer des favoris" : "☆ Ajouter aux favoris"}</button>
    </div>
    <dl>${rows}</dl>`;

  const favBtn = document.getElementById("btn-toggle-favorite");
  if (favBtn) favBtn.addEventListener("click", toggleFavorite);

  activateTab("info");
}

function buildFavoriteId(kindLabel, properties) {
  const key = properties.gid ?? properties.code_region ?? properties.nom ?? Math.random().toString(36).slice(2);
  return `${kindLabel}:${key}`;
}

function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function persistFavorites() {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites)); } catch (_) {}
}

function toggleFavorite() {
  const info = state.lastShownInfo;
  if (!info) return;
  const idx = state.favorites.findIndex((f) => f.id === info.favId);
  if (idx >= 0) {
    state.favorites.splice(idx, 1);
    showToast("ok", "Retiré des favoris.");
  } else {
    state.favorites.push({
      id: info.favId,
      kindLabel: info.kindLabel,
      title: info.title,
      lat: info.latlng ? info.latlng.lat : null,
      lng: info.latlng ? info.latlng.lng : null,
      properties: info.properties,
    });
    showToast("ok", "Ajouté aux favoris.");
  }
  persistFavorites();
  renderFavoritesList();
  // showInfo(info.properties, info.kindLabel, info.latlng);
}

function renderFavoritesList() {
  const ul = document.getElementById("favorites-list");
  const empty = document.getElementById("favorites-empty");
  if (!ul) return;
  ul.innerHTML = "";

  if (!state.favorites.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  state.favorites.forEach((fav) => {
    const li = document.createElement("li");
    li.className = "favorite-item";
    li.innerHTML = `
      <div class="favorite-info">
        <strong>${escapeHtml(fav.title)}</strong>
        <span>${escapeHtml(fav.kindLabel)}</span>
      </div>
      <div class="favorite-actions">
        <button type="button" class="btn-icon-small btn-fav-goto" title="Voir sur la carte" aria-label="Voir sur la carte">↗</button>
        <button type="button" class="btn-icon-small btn-fav-remove" title="Retirer des favoris" aria-label="Retirer des favoris">✕</button>
      </div>`;

    li.querySelector(".btn-fav-goto").addEventListener("click", () => {
      if (fav.lat != null && fav.lng != null) state.map.setView([fav.lat, fav.lng], 12);
      // showInfo(fav.properties, fav.kindLabel, fav.lat != null ? L.latLng(fav.lat, fav.lng) : null);
      if (window.closeSidebarOnMobile) window.closeSidebarOnMobile();
    });
    li.querySelector(".btn-fav-remove").addEventListener("click", () => {
      state.favorites = state.favorites.filter((f) => f.id !== fav.id);
      persistFavorites();
      renderFavoritesList();
      showToast("ok", "Favori retiré.");
    });

    ul.appendChild(li);
  });
}

function buildPopupHtml(properties, kindLabel) {
  const entries = Object.entries(properties).filter(([k]) => !HIDDEN_PROPS.has(k)).slice(0, 8);
  const title = properties.nom || properties.name || kindLabel;
  const rows = entries.map(([k, v]) => `<dt>${escapeHtml(prettifyKey(k))}</dt><dd>${escapeHtml(formatValue(v))}</dd>`).join("");
  return `<div class="popup-content"><h4>${escapeHtml(title)}</h4><dl>${rows}</dl></div>`;
}

function prettifyKey(key) {
  const labels = {
    nom: "Nom", code_region: "Code région", code_departement: "Code département",
    dept: "Département", reg: "Région", descriptif: "Description",
  };
  return labels[key] || key.replace(/_/g, " ");
}

function formatValue(v) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function showApiError(err) {
  const container = document.getElementById("tab-info-content");
  container.innerHTML = `<p class="empty-state">⚠️ Impossible de contacter l'API (${escapeHtml(API_BASE)}).<br>
    Vérifiez que le serveur Flask tourne bien (<code>python app.py</code>) et que PostgreSQL est démarré.<br>
    Détail technique : ${escapeHtml(err.message)}</p>`;
  activateTab("info");
  showToast("error", err.message || "Une erreur est survenue lors de l'appel à l'API.");
}

// ============================================================
// TABLEAU
// ============================================================

function setTableSource(label, features) {
  const columns = features.length
    ? Object.keys(features[0].properties).filter((k) => !HIDDEN_PROPS.has(k))
    : [];
  state.activeTableSource = { label, features, columns };
  document.getElementById("table-filter").value = "";
  renderTable("");
}

function renderTable(filterText) {
  const source = state.activeTableSource;
  const caption = document.getElementById("table-caption");
  const thead = document.querySelector("#data-table thead tr");
  const tbody = document.querySelector("#data-table tbody");

  if (!source || !source.features.length) {
    caption.textContent = "Aucune donnée à afficher";
    thead.innerHTML = "";
    tbody.innerHTML = "";
    return;
  }

  const needle = filterText.trim().toLowerCase();
  const rows = source.features.filter((f) =>
    !needle || Object.values(f.properties).some((v) => String(v).toLowerCase().includes(needle))
  );

  caption.textContent = `${source.label} — ${rows.length} / ${source.features.length} entrée(s)`;

  thead.innerHTML = source.columns.map((c) => `<th>${escapeHtml(prettifyKey(c))}</th>`).join("");

  tbody.innerHTML = rows
    .map((f) => {
      const cells = source.columns.map((c) => `<td>${escapeHtml(formatValue(f.properties[c]))}</td>`).join("");
      return `<tr data-index="${source.features.indexOf(f)}">${cells}</tr>`;
    })
    .join("");

  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => {
      tbody.querySelectorAll("tr.selected").forEach((el) => el.classList.remove("selected"));
      tr.classList.add("selected");
      const feature = source.features[Number(tr.dataset.index)];
      if (feature && feature.geometry) {
        zoomToFeature(feature);
      }
      // showInfo(feature.properties, source.label, getFeatureCenter(feature));
    });
  });
}

// ============================================================
// UI
// ============================================================

function initSidebarToggle() {
  const btn = document.getElementById("btn-toggle-sidebar");
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");

  function close() {
    sidebar.classList.remove("open");
    backdrop.classList.remove("visible");
    btn.setAttribute("aria-expanded", "false");
  }
  function toggle() {
    const willOpen = !sidebar.classList.contains("open");
    sidebar.classList.toggle("open", willOpen);
    backdrop.classList.toggle("visible", willOpen);
    btn.setAttribute("aria-expanded", String(willOpen));
  }

  btn.addEventListener("click", toggle);
  backdrop.addEventListener("click", close);

  window.closeSidebarOnMobile = () => {
    if (window.innerWidth <= 900) close();
  };
}

function initMainTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });
}

function activateTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.toggle("active", c.id === `tab-${name}`));
  if (name === "map" && state.map) {
    setTimeout(() => state.map.invalidateSize(), 60);
  }
  if (name === "stats") {
    renderStatCards();
  }
}

// ============================================================
// NAVIGATION ENTRE PAGES (Accueil / Application)
// ============================================================

function initPageNav() {
  function goToPage(name) {
    document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${name}`));
    document.querySelectorAll(".site-nav-link").forEach((a) => a.classList.toggle("active", a.dataset.page === name));
    if (name === "app" && state.map) {
      setTimeout(() => state.map.invalidateSize(), 80);
    }
  }

  document.querySelectorAll("[data-page]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      goToPage(el.dataset.page);
    });
  });

  const aboutBtn = document.getElementById("btn-go-about");
  if (aboutBtn) {
    aboutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      goToPage("home");
      setTimeout(() => {
        document.getElementById("about-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    });
  }
}

// ============================================================
// RÉSUMÉ CARTE + CARTES STATISTIQUES (onglets Carte / Statistiques)
// ============================================================

function renderMapSummary() {
  const el = document.getElementById("map-summary");
  if (!el) return;
  const activeTypes = INFRA_TYPES.filter((t) => state.infraLayers[t.key]);
  if (!activeTypes.length) {
    el.textContent = "Activez une ou plusieurs couches pour voir un résumé ici.";
    return;
  }
  const rows = activeTypes.map((t) => {
    const count = state.infraLayers[t.key]?.getLayers().length || 0;
    return `<p style="margin:0.3rem 0;font-size:0.85rem;"><strong>${count}</strong> — ${t.label}</p>`;
  });
  el.innerHTML = rows.join("");
}

function renderStatCards() {
  const row = document.getElementById("stat-cards-row");
  if (!row) return;
  const activeTypes = INFRA_TYPES.filter((t) => state.infraLayers[t.key]);
  const total = activeTypes.reduce((sum, t) => sum + (state.infraLayers[t.key]?.getLayers().length || 0), 0);

  if (!activeTypes.length) {
    row.innerHTML = "";
    return;
  }

  const cards = activeTypes.map((t) => {
    const count = state.infraLayers[t.key]?.getLayers().length || 0;
    return `
      <div class="stat-card" style="border-left-color:${t.color}">
        <div class="stat-number" style="color:${t.color}">${count}</div>
        <div class="stat-label">${t.label}</div>
      </div>`;
  }).join("");

  row.innerHTML = `
    <div class="stat-card accent-primary">
      <div class="stat-number">${total}</div>
      <div class="stat-label">Total</div>
    </div>
    ${cards}`;
}

function initMapTabControls() {
  const recentrer = document.getElementById("btn-recentrer-map");
  if (recentrer) {
    recentrer.addEventListener("click", () => {
      if (state.regionsLayer) {
        state.map.fitBounds(state.regionsLayer.getBounds(), { padding: [20, 20] });
      } else {
        state.map.setView([14.5, -14.5], 7);
      }
      showToast("ok", "Carte recentrée.");
    });
  }
  const reset = document.getElementById("btn-reset-map");
  if (reset) {
    reset.addEventListener("click", () => document.getElementById("btn-reset").click());
  }
}
