# Généalogie du parrainage

Site statique. Aucun serveur, aucune bibliothèque externe, aucune étape de
compilation, aucune donnée embarquée : tout vient du Google Sheet publié.

## Mise en ligne

1. Créez un dépôt public, poussez ces fichiers **à la racine**.
2. *Settings* → *Pages* → *Source : Deploy from a branch* → `main` / `/ (root)`.
3. Le site est en ligne deux minutes plus tard.

## Onglet 1 — les élèves

Nom de l'onglet : libre, tant que c'est le **premier** du classeur.
Sinon, renseignez son `gid` dans `config.js`.

| id | personne | id_parent | promotion | famille |
|----|----------|-----------|-----------|---------|
| 42 | Marie Dupont | 37 | 2029 | ROUGE |

- `id_parent = -1` : la personne ouvre une lignée.
- `id_parent = 37;41` : deux parrains. Le premier porte la branche, le second
  est relié en pointillés.
- Un `id` en double est renuméroté automatiquement.
- Les noms contenant une virgule sont gérés correctement.

## Onglet 2 — les points

**Nom de l'onglet : `points`**

**Première ligne, exactement six colonnes :**

```
annee | vert | bleu | rouge | jaune | orange
```

Une ligne par saison, avec le cumul de points de l'année :

| annee | vert | bleu | rouge | jaune | orange |
|-------|------|------|-------|-------|--------|
| 2023-2024 | 175 | 120 | 90 | 160 | 140 |
| 2024-2025 | 130 | 95 | 240 | 110 | 150 |

La colonne `annee` accepte n'importe quel libellé contenant une année :
`2024-2025`, `2024/2025` ou `2024`. Le tri se fait sur le premier nombre trouvé.
Les intitulés de colonnes sont reconnus quelle que soit la casse ou les accents,
et leur ordre n'a pas d'importance.

### Le brancher

1. Ouvrez l'onglet dans Google Sheets, relevez le `gid=…` à la fin de l'adresse.
2. Recopiez ce nombre dans `config.js`, ligne `gidPoints`.
3. Dans *Fichier → Partager → Publier sur le web*, vérifiez que c'est le
   **document entier** qui est publié, et non la seule feuille des élèves.

Tant que `gidPoints` vaut `null`, l'onglet Classement affiche ce mode d'emploi.

### Ce que le site en déduit

- le podium de la dernière saison, plus les deux familles restantes avec leur place ;
- le palmarès : nombre de victoires et de podiums par famille ;
- la place moyenne sur l'ensemble des saisons ;
- la courbe des places saison après saison ;
- le tableau complet, place et points pour chaque saison.

Les ex æquo sont gérés : deux familles à égalité partagent la même place, et la
suivante est décalée d'autant.

## Tester en local

**Ne double-cliquez pas sur `index.html`.** Ouverte depuis le disque
(`file:///...`), la page n'a pas d'origine aux yeux du navigateur, et Google
refuse de lui envoyer le CSV : c'est l'erreur CORS. Le site le détecte et
l'explique, mais il ne peut rien afficher.

Ouvrez un terminal dans le dossier et lancez :

```bash
python3 -m http.server
```

puis allez sur `http://localhost:8000`. Une fois en ligne sur GitHub Pages, la
question ne se pose plus : l'adresse est en `https://`, tout fonctionne.

## Chargement

Les données sont lues à chaque ouverture. Pendant ce temps, la page affiche des
zones grises à la place des cartes — jamais d'écran blanc ni de faux contenu. Si
le Sheet ne répond pas, un message explique le problème avec un bouton pour
réessayer.

Google met environ cinq minutes à propager une modification du classeur vers le
CSV publié. Une ligne ajoutée n'apparaît donc pas instantanément.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | la page |
| `style.css` | les styles |
| `app.js` | lecture du Sheet, arbres, classement, statistiques |
| `config.js` | **le seul fichier à modifier** : adresse du Sheet et identifiants d'onglets |
| `robots.txt` | demande aux moteurs de recherche de ne pas indexer les noms |

## Réglages

Dans `app.js`, l'objet `L` en haut du fichier règle la largeur des cartes,
l'écart horizontal et la hauteur d'une génération. Les couleurs des familles
sont dans `COULEURS` (`app.js`) et en haut de `style.css`.

## Le point de fragilité

Le site n'a plus aucune copie de secours : si le Google Sheet cesse d'être
publié, il n'affiche plus rien. Deux précautions valent le détour : que le
classeur appartienne à un compte de l'association plutôt qu'à un compte
personnel, et qu'une copie du fichier soit archivée quelque part une fois par an.
