# data/

Ce dossier est prévu par la structure du cahier des charges, mais le frontend
ne lit aucun fichier local ici : toutes les données (régions, départements,
infrastructures) sont récupérées dynamiquement en GeoJSON depuis l'API REST
Flask (`web-mapping/api/`), via `fetch()` dans `js/app.js`.

Il peut servir à déposer un export GeoJSON de secours (ex. `regions.geojson`)
si un jour on veut un mode hors-ligne, mais ce n'est pas utilisé actuellement.
