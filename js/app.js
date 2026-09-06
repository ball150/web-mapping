/**
 * SITS — Système d'Information Territorial du Sénégal
 * v3 — Design amélioré
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

// ============================================================
// ÉTAT
// ============================================================

const state = {
  map: null,
  regionsLayer: null,
  departementsLayer: null,
  infraLayers: {},
  regionsData: null,
  departementsData: null,
  currentRegionCode: "",
  currentDepartementNom: "",
  activeTableSource: null,
};

// ============================================================
// DÉMARRAGE
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initSidebarToggle();
  initBottomPanel();
  buildInfraLayerList();
  buildLegend();
  wireFilters();
  loadRegions();
});

// ============================================================
// CARTE
// ============================================================

function initMap() {
  state.map = L.map("map", { zoomControl: true }).setView([14.5, -14.5], 7);

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
// API
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

function setApiStatus(kind, label) {
  const el = document.getElementById("api-status");
  el.classList.remove("ok", "error");
  if (kind) el.classList.add(kind);
  el.querySelector(".label").textContent = label;
}

function refreshApiStatusIdle() {
  setApiStatus("ok", "API connectée");
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
    const data = await apiGet("/regions");
    state.regionsData = data;
    setApiStatus("ok", "API connectée");

    state.regionsLayer = L.geoJSON(data, {
      style: (feature) => regionStyle(feature),
      onEachFeature: (feature, layer) => {
        layer.bindPopup(buildPopupHtml(feature.properties, "Région"));
        layer.on("click", () => {
          showInfo(feature.properties, "Région");
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
  } catch (err) {
    console.error(err);
    setApiStatus("error", "API injoignable (localhost:5000)");
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
    const data = await apiGet("/departements" + query);
    state.departementsData = data;

    if (state.departementsLayer) state.map.removeLayer(state.departementsLayer);

    state.departementsLayer = L.geoJSON(data, {
      style: { color: "#223357", weight: 1.5, dashArray: "4 3", fillOpacity: 0.03 },
      onEachFeature: (feature, layer) => {
        layer.bindPopup(buildPopupHtml(feature.properties, "Département"));
        layer.on("click", () => {
          showInfo(feature.properties, "Département");
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
    countEl.textContent = "";
    return;
  }

  countEl.textContent = "…";
  countEl.classList.add("loading");
  checkboxEl.disabled = true;
  try {
    const featureCollection = await fetchInfraFeatures(type.key);
    const cluster = L.markerClusterGroup({ maxClusterRadius: 45 });
    const icon = buildDivIcon(type);

    L.geoJSON(featureCollection, {
      pointToLayer: (feature, latlng) => L.marker(latlng, { icon }),
      onEachFeature: (feature, layer) => {
        layer.bindPopup(buildPopupHtml(feature.properties, type.label));
        layer.on("click", () => showInfo(feature.properties, type.label));
      },
    }).eachLayer((marker) => cluster.addLayer(marker));

    cluster.addTo(state.map);
    state.infraLayers[type.key] = cluster;
    countEl.textContent = featureCollection.features.length;
    countEl.classList.remove("loading");

    setTableSource(type.label, featureCollection.features);
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

function fetchInfraFeatures(typeKey) {
  let path = `/infrastructures?type=${encodeURIComponent(typeKey)}`;
  if (state.currentDepartementNom) {
    path += `&departement=${encodeURIComponent(state.currentDepartementNom)}`;
  }
  return apiGet(path);
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
// FILTRES
// ============================================================

function wireFilters() {
  const selectRegion = document.getElementById("select-region");
  const selectDept = document.getElementById("select-departement");

  selectRegion.addEventListener("change", async () => {
    const code = selectRegion.value;
    state.currentRegionCode = code;
    state.currentDepartementNom = "";

    if (code) {
      const feature = state.regionsData.features.find((f) => String(f.properties.code_region) === code);
      if (feature) zoomToFeature(feature);
    } else if (state.regionsLayer) {
      state.map.fitBounds(state.regionsLayer.getBounds(), { padding: [20, 20] });
    }

    await loadDepartements(code);
    refreshActiveInfraLayers();
  });

  selectDept.addEventListener("change", () => {
    const gid = selectDept.value;
    if (!gid) {
      state.currentDepartementNom = "";
      if (state.departementsLayer) state.map.fitBounds(state.departementsLayer.getBounds(), { padding: [20, 20] });
      refreshActiveInfraLayers();
      return;
    }
    const feature = state.departementsData.features.find((f) => String(f.properties.gid) === gid);
    if (feature) {
      zoomToFeature(feature);
      showInfo(feature.properties, "Département");
      state.currentDepartementNom = feature.properties.nom || "";
    }
    refreshActiveInfraLayers();
    if (window.closeSidebarOnMobile) window.closeSidebarOnMobile();
  });

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
  });

  document.getElementById("table-filter").addEventListener("input", (e) => renderTable(e.target.value));
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

let highlighted = null;
function highlightLayer(layer) {
  if (highlighted && highlighted.setStyle) highlighted.setStyle(regionStyle(highlighted.feature));
  if (layer.setStyle) {
    layer.setStyle(highlightRegionStyle());
    highlighted = layer;
  }
}

// ============================================================
// INFORMATIONS
// ============================================================

function showInfo(properties, kindLabel) {
  const container = document.getElementById("tab-info");
  const entries = Object.entries(properties).filter(([k]) => !HIDDEN_PROPS.has(k));

  const title = properties.nom || properties.name || kindLabel;
  const rows = entries
    .map(([k, v]) => `<dt>${escapeHtml(prettifyKey(k))}</dt><dd>${escapeHtml(formatValue(v))}</dd>`)
    .join("");

  container.innerHTML = `<h3>${escapeHtml(title)} <small style="font-weight:400;color:var(--ink-500);font-family:var(--font-body);font-size:0.75rem;">— ${escapeHtml(kindLabel)}</small></h3><dl>${rows}</dl>`;

  activateTab("info");
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
  const container = document.getElementById("tab-info");
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
    .map((f, i) => {
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
      showInfo(feature.properties, source.label);
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

function initBottomPanel() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  document.getElementById("btn-toggle-panel").addEventListener("click", () => {
    document.getElementById("bottom-panel").classList.toggle("collapsed");
    setTimeout(() => state.map.invalidateSize(), 210);
  });
}

function activateTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.toggle("active", c.id === `tab-${name}`));
  const panel = document.getElementById("bottom-panel");
  if (panel.classList.contains("collapsed")) {
    panel.classList.remove("collapsed");
    setTimeout(() => state.map.invalidateSize(), 210);
  }
}