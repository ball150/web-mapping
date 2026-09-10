/**
 * SITS — Données de démonstration (mode hors-ligne)
 * ---------------------------------------------------
 * Ce fichier ne contient AUCUNE donnée officielle : les géométries sont des
 * carrés simplifiés autour des centres approximatifs des 14 régions du
 * Sénégal, uniquement destinés à faire fonctionner l'interface quand l'API
 * Flask (http://localhost:5000) n'est pas joignable — par exemple lorsque
 * l'app est ouverte dans un environnement comme Bolt qui ne peut pas lancer
 * Flask + PostgreSQL/PostGIS.
 *
 * La forme des objets (FeatureCollection GeoJSON, mêmes noms de propriétés)
 * reproduit volontairement celle renvoyée par api/app.py pour que le reste
 * du code (js/app.js) n'ait pas besoin de savoir s'il parle à l'API réelle
 * ou à ce mock.
 */

(function (global) {
  "use strict";

  // Centres approximatifs (non officiels) des 14 régions du Sénégal.
  const REGIONS_SEED = [
    { code: "DK", nom: "Dakar",       lat: 14.6928, lng: -17.4467 },
    { code: "TH", nom: "Thiès",       lat: 14.7910, lng: -16.9359 },
    { code: "DB", nom: "Diourbel",    lat: 14.6479, lng: -16.2333 },
    { code: "FK", nom: "Fatick",      lat: 14.3390, lng: -16.4110 },
    { code: "KL", nom: "Kaolack",     lat: 14.1652, lng: -16.0726 },
    { code: "KA", nom: "Kaffrine",    lat: 14.1059, lng: -15.5500 },
    { code: "KD", nom: "Kolda",       lat: 12.8983, lng: -14.9500 },
    { code: "LG", nom: "Louga",       lat: 15.6173, lng: -16.2240 },
    { code: "MT", nom: "Matam",       lat: 15.6559, lng: -13.2550 },
    { code: "SL", nom: "Saint-Louis", lat: 16.0179, lng: -16.4896 },
    { code: "SD", nom: "Sédhiou",     lat: 12.7081, lng: -15.5569 },
    { code: "TB", nom: "Tambacounda", lat: 13.7707, lng: -13.6673 },
    { code: "KE", nom: "Kédougou",    lat: 12.5556, lng: -12.1746 },
    { code: "ZG", nom: "Ziguinchor",  lat: 12.5665, lng: -16.2733 },
  ];

  function squarePolygon(lat, lng, half) {
    return [[
      [lng - half, lat - half],
      [lng + half, lat - half],
      [lng + half, lat + half],
      [lng - half, lat + half],
      [lng - half, lat - half],
    ]];
  }

  function buildRegions() {
    const features = REGIONS_SEED.map((r, i) => ({
      type: "Feature",
      properties: { gid: i + 1, nom: r.nom, code_region: r.code },
      geometry: { type: "Polygon", coordinates: squarePolygon(r.lat, r.lng, 0.42) },
    }));
    return { type: "FeatureCollection", features };
  }

  function buildDepartements() {
    // Demi-côté volontairement large (0.36) pour que ces carrés fictifs couvrent
    // toute la dispersion (amplitude 0.35) des points d'infrastructure générés
    // ci-dessous : sans ça, la jointure spatiale point-dans-polygone utilisée par
    // les analyses (choroplèthe, comparateur, proximité) ne trouverait quasiment
    // aucun point en mode démonstration hors-ligne.
    let gid = 1;
    const features = [];
    REGIONS_SEED.forEach((r) => {
      ["Nord", "Sud"].forEach((suffixe, j) => {
        const lat = r.lat + (j === 0 ? 0.16 : -0.16);
        features.push({
          type: "Feature",
          properties: {
            gid: gid++,
            nom: `${r.nom} ${suffixe}`,
            code_region: r.code,
            code_departement: `${r.code}${j + 1}`,
          },
          geometry: { type: "Polygon", coordinates: squarePolygon(lat, r.lng, 0.36) },
        });
      });
    });
    return { type: "FeatureCollection", features };
  }

  // Quelques points fictifs par type d'infrastructure, répartis autour de
  // trois régions pour illustrer le clustering et les filtres.
  const INFRA_SEED_REGIONS = [
    { nom: "Dakar", lat: 14.6928, lng: -17.4467 },
    { nom: "Thiès", lat: 14.7910, lng: -16.9359 },
    { nom: "Saint-Louis", lat: 16.0179, lng: -16.4896 },
  ];

  const INFRA_LABELS = {
    centresante: "Centre de santé",
    forage: "Forage",
    hoteleriepoint: "Établissement hôtelier",
    loisir: "Équipement de loisir",
    lyceepublic: "Lycée public",
    marche: "Marché",
    parking: "Parking",
  };

  function jitter(v, amp) { return v + (Math.random() * 2 - 1) * amp; }

  function buildInfra(typeKey) {
    const label = INFRA_LABELS[typeKey] || typeKey;
    let gid = 1;
    const features = [];
    INFRA_SEED_REGIONS.forEach((region) => {
      const count = 3 + Math.floor(Math.random() * 4); // 3 à 6 points par région
      for (let i = 0; i < count; i += 1) {
        const lat = jitter(region.lat, 0.35);
        const lng = jitter(region.lng, 0.35);
        features.push({
          type: "Feature",
          properties: {
            gid: gid++,
            nom: `${label} ${region.nom} #${i + 1}`,
            reg: region.nom,
            dept: `${region.nom} Nord`,
            descriptif: `${label} fictif généré pour la démonstration hors-ligne.`,
          },
          geometry: { type: "Point", coordinates: [lng, lat] },
        });
      }
    });
    return { type: "FeatureCollection", features };
  }

  const cache = { infra: {} };

  global.SITS_MOCK = {
    getRegions: () => buildRegions(),
    getDepartements: (regionCode) => {
      const all = buildDepartements();
      if (!regionCode) return all;
      return {
        type: "FeatureCollection",
        features: all.features.filter((f) => f.properties.code_region === regionCode),
      };
    },
    getInfrastructures: (typeKey, departementNom) => {
      if (!cache.infra[typeKey]) cache.infra[typeKey] = buildInfra(typeKey);
      const all = cache.infra[typeKey];
      if (!departementNom) return all;
      const needle = departementNom.toLowerCase();
      return {
        type: "FeatureCollection",
        features: all.features.filter((f) => (f.properties.dept || "").toLowerCase().includes(needle)),
      };
    },
  };
})(window);
