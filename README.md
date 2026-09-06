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
| `GET /api/infrastructures?type=<type>&departement=<nom>` | Points d'infrastructure (voir types ci-dessous) |

Types valides pour `?type=` : `centresante`, `forage`, `hoteleriepoint`,
`loisir`, `lyceepublic`, `marche`, `parking`.

## À vérifier / ajuster en équipe

- Le filtre `?departement=` compare actuellement sur la colonne `dept` (nom en
  texte) des tables d'infrastructures — à confirmer que c'est bien le format
  utilisé une fois les données inspectées dans QGIS (nom complet, majuscules, etc.).
- Le filtre `?region=` sur `/api/departements` compare `adm01_id` (code région
  dans `sn_departmt_pol`) à `admi01_id` (code région dans `sn_region_pol`) — à
  vérifier que ces deux codes correspondent bien pour chaque région.
