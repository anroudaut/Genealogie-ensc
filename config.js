/* ============================================================
   Le seul fichier à modifier au quotidien.
   ============================================================ */

window.CONFIG = {

  // Adresse du classeur publié sur le web, sans le "?output=csv" final.
  // (Google Sheets → Fichier → Partager → Publier sur le web)
  sheetBase: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQw1obNMUMhtIGao2RKWrErc-wRhdU1b5jpC0EJYsQ8py_vBg_GPHvYHOTE3INdZksF3Gjd82GE_d4-/pub",

  // Identifiant de l'onglet des élèves.
  // null = premier onglet du classeur, ce qui suffit dans la plupart des cas.
  gidEleves: null,

  // Identifiant de l'onglet des points.
  // Ouvrez l'onglet dans Google Sheets et regardez la fin de l'adresse :
  // .../edit#gid=123456789  →  recopiez 123456789 ci-dessous, entre guillemets.
  // Tant que cette valeur vaut null, l'onglet Classement affiche un mode d'emploi.
  gidPoints: 505040302,

  // Au-delà de ce délai (en millisecondes), on renonce au Sheet et on garde
  // la copie locale. Les visiteurs ne restent jamais bloqués sur un écran vide.
  delaiMax: 8000,
};
