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
from psycopg2 import sql

from db import fetch_as_geojson, get_table_columns

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

# Noms de colonnes candidats pour les filtres "département" et "région", par ordre
# de préférence. Chaque table de la base "web-aida" n'utilise pas forcément le
# même nom (dept/DEPT, reg/REG, cod_dept, nom_reg...), donc le bon nom est détecté
# dynamiquement plutôt que d'être supposé constant. La comparaison se fait en
# minuscule (insensible à la casse), mais le nom réel (avec sa casse d'origine,
# ex. "DEPT") est toujours celui utilisé dans la requête SQL.
DEPARTEMENT_COLUMN_CANDIDATES = [
    "dept",
    "departement",
    "departemen",
    "nom_dept",
    "nomdept",
    "dept_nom",
    "libdept",
    "lib_dept",
    "cod_dept",
    "code_dept",
    "num_dept",
]

REGION_COLUMN_CANDIDATES = [
    "reg",
    "region",
    "nom_reg",
    "nomreg",
    "reg_nom",
    "libreg",
    "lib_reg",
    "cod_reg",
    "code_reg",
]

# Cache mémoire : (table, "dept"|"reg") -> nom de colonne détecté (ou None).
# Évite de refaire une requête information_schema à chaque appel de l'API.
_column_cache = {}


def _detect_column(table, candidates, cache_key):
    """
    Cherche, parmi les colonnes réelles de `table`, celle qui correspond à l'un
    des noms candidats (comparaison insensible à la casse). Renvoie le nom réel
    de la colonne (avec sa casse d'origine, ex. "DEPT"), ou None si aucune ne
    correspond. Le résultat est mis en cache par (table, cache_key).
    """
    key = (table, cache_key)
    if key not in _column_cache:
        # On garde la casse réelle de chaque colonne (ex. "DEPT"), tout en
        # comparant en minuscule pour trouver le bon candidat.
        columns_by_lower = {c.lower(): c for c in get_table_columns(table)}
        found = next(
            (
                columns_by_lower[cand]
                for cand in candidates
                if cand in columns_by_lower
            ),
            None,
        )
        _column_cache[key] = found
    return _column_cache[key]


def get_departement_column(table):
    """Renvoie le nom réel de la colonne "département" de la table, ou None."""
    return _detect_column(table, DEPARTEMENT_COLUMN_CANDIDATES, "dept")


def get_region_column(table):
    """Renvoie le nom réel de la colonne "région" de la table, ou None."""
    return _detect_column(table, REGION_COLUMN_CANDIDATES, "reg")


@app.get("/api/health")
def health():
    """Petit endpoint de vérification que l'API répond."""
    return jsonify({"status": "ok"})


@app.get("/api/regions")
def get_regions():
    """Toutes les régions du Sénégal, reprojetées en WGS84 (4326) pour Leaflet."""
    query = """
        SELECT
            id AS gid,
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
            id AS gid,
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
    Points d'infrastructure d'un type donné, filtrables par département et/ou région.
    ?type=centresante|forage|hoteleriepoint|loisir|lyceepublic|marche|parking (obligatoire)
    ?departement=<nom du département>  (optionnel)
    ?region=<nom de la région>         (optionnel)

    Les noms des colonnes "département" et "région" varient selon les tables
    (dept/DEPT, reg/REG, cod_dept, nom_reg...), donc ils sont détectés
    dynamiquement via information_schema plutôt que d'être supposés constants.
    """
    infra_type = request.args.get("type")
    departement = request.args.get("departement")
    region = request.args.get("region")

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
    # un peu différentes (DESCRIPTIF, REG, DEPT, COD_DEPT...), toutes deviennent
    # des propriétés GeoJSON automatiquement. La colonne "geom" brute (SRID 32628)
    # est retirée automatiquement par fetch_as_geojson() au profit de "geometry"
    # (reprojetée en 4326), voir db.py.
    base_query = sql.SQL(
        """
        SELECT
            t.*,
            ST_AsGeoJSON(ST_Transform(t.geom, 4326)) AS geometry
        FROM public.{table} t
        """
    ).format(table=sql.Identifier(table))

    conditions = []
    params = []

    def add_filter(value, column_getter, label, candidates):
        if not value:
            return None
        column = column_getter(table)
        if column is None:
            return (
                f"La table '{table}' ne semble avoir aucune colonne de type "
                f"{label} (testé : {', '.join(candidates)}). Le filtre "
                f"correspondant ne peut pas être appliqué sur cette couche."
            )
        conditions.append(
            sql.SQL("t.{col} ILIKE %s").format(col=sql.Identifier(column))
        )
        params.append(value)
        return None

    error = add_filter(
        departement, get_departement_column, "département", DEPARTEMENT_COLUMN_CANDIDATES
    )
    if error is None:
        error = add_filter(
            region, get_region_column, "région", REGION_COLUMN_CANDIDATES
        )

    if error:
        # Une colonne demandée n'a pas été trouvée sur cette table : on prévient
        # clairement au lieu de planter avec une erreur SQL opaque.
        return jsonify({"error": error}), 400

    if conditions:
        base_query += sql.SQL(" WHERE ") + sql.SQL(" AND ").join(conditions)

    base_query += sql.SQL(" ORDER BY t.id ASC;")

    return jsonify(fetch_as_geojson(base_query, tuple(params)))


if __name__ == "__main__":
    app.run(debug=True, port=5000)