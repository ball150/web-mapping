# API SITS — Flask

API REST en Python qui sert les couches administratives et les infrastructures
de la base PostgreSQL/PostGIS `web-aida` en GeoJSON, pour la carte Leaflet du frontend.

## Installation (à faire une fois, chacun sur sa machine)

```bash
cd api
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

## Configuration

```bash
copy .env.example .env       # Windows
# cp .env.example .env       # macOS/Linux
```

Puis ouvrir `.env` et mettre **votre propre** mot de passe PostgreSQL local.
Ce fichier `.env` ne doit jamais être commité (déjà listé dans `.gitignore`).

## Lancer l'API

```bash
python app.py
```

L'API démarre sur `http://localhost:5000`. Elle tourne indépendamment
d'Apache/XAMPP : Apache continue de servir le frontend statique de son côté,
et le JS du frontend appelle cette API via `fetch()`.

## Endpoints disponibles

| Endpoint | Description |
|---|---|
| `GET /api/health` | Vérifie que l'API répond |
| `GET /api/regions` | Toutes les régions (GeoJSON) |
| `GET /api/departements?region=<code>` | Départements, filtrables par région |
| `GET /api/infrastructures?type=<type>&departement=<nom>&region=<nom>` | Points d'infrastructure (voir types ci-dessous) |
| `POST /api/infrastructures` | Ajoute un point d'infrastructure (mode administrateur du frontend). Corps JSON : `{ "type": "...", "lat": 14.69, "lng": -17.44, "properties": { "nom": "...", "descriptif": "..." } }`. Seules les clés de `properties` correspondant à une vraie colonne de la table sont insérées. **Aucune authentification côté serveur pour l'instant** — le "mode admin" du frontend n'est qu'un gate d'interface, à sécuriser avant tout déploiement public. |

Types valides pour `?type=` : `centresante`, `forage`, `hoteleriepoint`,
`loisir`, `lyceepublic`, `marche`, `parking`.

## À vérifier / ajuster en équipe

- Le filtre `?departement=` compare actuellement sur la colonne `dept` (nom en
  texte) des tables d'infrastructures — à confirmer que c'est bien le format
  utilisé une fois les données inspectées dans QGIS (nom complet, majuscules, etc.).
- Le filtre `?region=` sur `/api/departements` compare `adm01_id` (code région
  dans `sn_departmt_pol`) à `admi01_id` (code région dans `sn_region_pol`) — à
  vérifier que ces deux codes correspondent bien pour chaque région.

---

# Frontend — fonctionnalités (v4)

Le frontend (`index.html`, `css/style.css`, `js/app.js`) reste du HTML/CSS/JS
vanilla + Leaflet, sans étape de build. Il ajoute par rapport à la v3 :

| Fonctionnalité | Où | Détail |
|---|---|---|
| Recherche globale | Barre dans l'en-tête | Cherche parmi les régions, tous les départements (préchargés silencieusement) et les infrastructures **des couches actuellement cochées**. Flèches + Entrée au clavier, clic sinon. |
| Mode sombre | Bouton soleil/lune dans l'en-tête | Retourne les jetons de couleur neutres (`--sand-*`, `--ink-*`, `--white`) via `html[data-theme="dark"]`. Préférence mémorisée dans `localStorage` (`sits-theme`), respecte aussi `prefers-color-scheme` au premier chargement. |
| Fil d'ariane | Sous « Recherche territoriale » | Sénégal › Région › Département, cliquable pour remonter d'un niveau. |
| Compteur global | Panneau « Couches d'infrastructures » | Somme des infrastructures actuellement affichées, toutes couches cochées confondues. |
| Statistiques | Panneau « Statistiques » | Mini graphique en barres (canvas natif, sans dépendance) du nombre d'entités par couche active. |
| Mesure de distance | Panneau « Outils » | Clic sur la carte pour poser des points, distance cumulée affichée en direct. `Échap` ou le bouton pour arrêter. *(La mesure de surface n'est pas incluse dans cette version — voir « Pistes non traitées » ci-dessous.)* |
| Partage de vue | Panneau « Outils » | Copie un lien avec `#region=...&dept=...&layers=...` dans le presse-papiers ; rouvrir ce lien restaure automatiquement la vue. |
| Favoris | Bouton « ★ » dans l'onglet Informations, liste dans l'onglet « ★ Favoris » | Persistés dans `localStorage` (`sits-favoris`). |
| Export GeoJSON / CSV | Onglet « Tableau » | Exporte les données actuellement affichées dans le tableau (région, département ou type d'infrastructure sélectionné). |
| Mode démonstration | Automatique | Si l'API Flask (`localhost:5000`) ne répond pas, l'app bascule sur des données **fictives** générées dans `js/mock-data.js` (formes simplifiées, non officielles) et affiche un bandeau « Mode démonstration ». Dès que l'API répond à nouveau, elle reprend le dessus automatiquement. Utile pour développer/démontrer l'interface sans backend (ex. dans un environnement comme Bolt qui ne peut pas exécuter Flask + PostgreSQL/PostGIS). |

# Frontend — analyse spatiale et administration (v5)

| Fonctionnalité | Où | Détail |
|---|---|---|
| Recherche de proximité géolocalisée | Onglet « 📍 Proximité » | Géolocalise l'utilisateur (`navigator.geolocation`), puis liste — toutes couches confondues — les infrastructures dans un rayon ajustable (0,5 à 50 km), triées par distance. Affiche aussi le rayon et les points trouvés sur la carte. |
| Carte choroplèthe | Panneau « Analyse spatiale » sous la carte | Colore chaque département selon le nombre d'infrastructures qu'il contient, via une **vraie jointure spatiale point-dans-polygone** (calculée côté client, indépendante des noms de colonnes qui varient d'une table à l'autre) plutôt qu'un rapprochement de texte. |
| Comparateur de départements | Onglet « ⚖️ Comparateur » | Sélection de 2 à 3 départements + types d'infrastructures à comparer ; barres groupées (canvas natif) et tableau récapitulatif, réutilisant la même jointure spatiale que la choroplèthe. |
| Filtres croisés intra-couche | Panneau « Couches d'infrastructures » | Recherche texte appliquée en direct à toutes les couches actuellement actives (sans nouvel appel API), en plus du filtre département existant côté serveur. |
| Filtre par plage numérique | Panneau « Couches d'infrastructures » | Détecte automatiquement les attributs numériques présents sur les couches actives (les tables réelles n'ont pas toutes les mêmes colonnes) et permet de filtrer par min/max. |
| Rapport imprimable d'un département | Bouton dans « Recherche territoriale » | Génère une vue imprimable (carte SVG simplifiée dessinée sans dépendance externe, statistiques par type, liste des infrastructures) et ouvre la boîte de dialogue d'impression du navigateur (export PDF natif). |
| Import de données (mode administrateur) | Bouton « 🔐 Mode administrateur » dans « Outils » | Formulaire d'ajout d'une infrastructure (type, nom, description, position cliquée sur la carte ou saisie manuelle), envoyé en `POST /api/infrastructures`. Le gate est côté client uniquement — voir la note de sécurité dans le tableau des endpoints ci-dessus. |

## Pistes non traitées dans cette itération

Pour rester lisible et testable, ces idées restent des pistes pour une
prochaine itération : mesure de surface, carte de chaleur (heatmap),
formulaire de signalement d'erreur, photos par fiche, mode hors-ligne complet
(PWA), authentification serveur réelle pour le mode administrateur.

## Fichiers ajoutés

- `js/mock-data.js` — données fictives du mode démonstration (à ne jamais
  présenter comme des données officielles). Les départements fictifs ont été
  élargis en v5 pour que la jointure spatiale (choroplèthe/comparateur) ait
  des résultats visibles même hors-ligne.
