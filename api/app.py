"""
API REST Flask pour le SITS (Système d'Information Territorial du Sénégal).
Sert les couches administratives et les infrastructures de la base PostGIS "web-aida"
en GeoJSON, prêtes à être consommées par Leaflet côté frontend.

Lancer en local :
    pip install -r requirements.txt
    cp .env.example .env   # puis remplir .env avec vos identifiants
    python app.py
L'API tourne alors sur http://localhost:5000 — indépendamment d'Apache/XAMPP,
qui continue de servir le frontend statique (index.html, css/, js/) de son côté.
"""
from flask import Flask, jsonify, request
from flask_cors import CORS

from db import fetch_as_geojson

app = Flask(__name__)
CORS(app)  # autorise le frontend (servi par Apache) à appeler cette API sur un autre port

# Couches d'infrastructures ponctuelles disponibles : type -> nom de table réel.
# À ajuster si un membre renomme une table.
INFRASTRUCTURE_TABLES = {
    "centresante": "centresante",
    "forage": "forage",
    "hoteleriepoint": "hoteleriepoint",
    "loisir": "loisir",
    "lyceepublic": "lyceepublic",
    "marche": "marche",
    "parking": "parking",
}


@app.get("/api/health")
def health():
    """Petit endpoint de vérification que l'API répond."""
    return jsonify({"status": "ok"})


@app.get("/api/regions")
def get_regions():
    """Toutes les régions du Sénégal, reprojetées en WGS84 (4326) pour Leaflet."""
    query = """
        SELECT
            gid,
            nomreg AS nom,
            admi01_id AS code_region,
            ST_AsGeoJSON(ST_Transform(geom, 4326)) AS geometry
        FROM public.sn_region_pol
        ORDER BY nomreg ASC;
    """
    return jsonify(fetch_as_geojson(query))


@app.get("/api/departements")
def get_departements():
    """
    Départements, filtrables par région via ?region=<code_region>
    (code_region = admi01_id de sn_region_pol).
    """
    region_code = request.args.get("region")

    query = """
        SELECT
            gid,
            n3nom AS nom,
            adm01_id AS code_region,
            adm02_id AS code_departement,
            ST_AsGeoJSON(ST_Transform(geom, 4326)) AS geometry
        FROM public.sn_departmt_pol
    """
    params = ()
    if region_code:
        query += " WHERE adm01_id = %s"
        params = (region_code,)
    query += " ORDER BY n3nom ASC;"

    return jsonify(fetch_as_geojson(query, params))


@app.get("/api/infrastructures")
def get_infrastructures():
    """
    Points d'infrastructure d'un type donné, filtrables par département.
    ?type=centresante|forage|hoteleriepoint|loisir|lyceepublic|marche|parking (obligatoire)
    ?departement=<nom ou code du département>  (optionnel, filtre sur la colonne "dept")
    """
    infra_type = request.args.get("type")
    departement = request.args.get("departement")

    if infra_type not in INFRASTRUCTURE_TABLES:
        return (
            jsonify(
                {
                    "error": "Paramètre 'type' invalide ou manquant.",
                    "types_valides": list(INFRASTRUCTURE_TABLES.keys()),
                }
            ),
            400,
        )

    table = INFRASTRUCTURE_TABLES[infra_type]

    # SELECT * pour rester générique : chaque table a des colonnes descriptives
    # un peu différentes (descriptif, reg, dept, cod_dept...), toutes deviennent
    # des propriétés GeoJSON automatiquement. La colonne "geom" brute (SRID 32628)
    # est retirée automatiquement par fetch_as_geojson() au profit de "geometry"
    # (reprojetée en 4326), voir db.py.
    query = f"""
        SELECT
            t.*,
            ST_AsGeoJSON(ST_Transform(t.geom, 4326)) AS geometry
        FROM public.{table} t
    """

    params = ()
    if departement:
        query += " WHERE t.dept ILIKE %s"
        params = (departement,)
    query += " ORDER BY t.gid ASC;"

    return jsonify(fetch_as_geojson(query, params))


if __name__ == "__main__":
    app.run(debug=True, port=5000)
