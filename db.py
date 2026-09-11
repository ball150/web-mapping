"""
Connexion à la base PostgreSQL/PostGIS "web-aida".
Les identifiants viennent du fichier .env (voir .env.example) — jamais en dur dans le code.
"""
import json
import os
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()


def get_connection():
    """Ouvre une nouvelle connexion à la base web-aida."""
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=os.getenv("DB_PORT", "5432"),
        dbname=os.getenv("DB_NAME", "web-aida"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD"),
    )


def fetch_as_geojson(query, params=None):
    """
    Exécute une requête dont la colonne finale s'appelle "geometry" (GeoJSON texte,
    déjà produit par ST_AsGeoJSON côté SQL) et renvoie une FeatureCollection GeoJSON.
    Toutes les autres colonnes de la requête deviennent des propriétés de la feature.
    """
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, params or ())
            rows = cur.fetchall()
    finally:
        conn.close()

    features = []
    for row in rows:
        row = dict(row)
        geometry = row.pop("geometry")
        row.pop("geom", None)  # colonne géométrique brute (32628) éventuellement remontée par SELECT t.*
        features.append(
            {
                "type": "Feature",
                "geometry": None if geometry is None else json.loads(geometry),
                "properties": row,
            }
        )

    return {"type": "FeatureCollection", "features": features}


def execute_write(query, params=None):
    """
    Exécute une requête d'écriture (INSERT/UPDATE, éventuellement avec RETURNING)
    et retourne la première ligne renvoyée (ou None). Utilisée par l'endpoint
    d'import/administration (ajout d'une infrastructure depuis l'UI).
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(query, params or ())
            row = cur.fetchone() if cur.description else None
        conn.commit()
        return row
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_table_columns(table_name, schema="public"):
    """
    Retourne la liste des noms de colonnes réels d'une table (via information_schema),
    utile car les tables d'infrastructures n'ont pas toutes exactement les mêmes noms
    de colonnes (dept, departement, cod_dept, ...).
    """
    query = """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(query, (schema, table_name))
            return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()