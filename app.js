/* ============================================================
   Généalogie du parrainage
   Vanilla JS, aucune dépendance, aucune donnée embarquée.
   Tout vient du Google Sheet publié, lu à chaque ouverture.
   ============================================================ */

(() => {
  "use strict";

  const CFG = window.CONFIG || {};

  // ---------- Mise en page des arbres ----------
  const L = { largeur: 186, hauteur: 40, ecartX: 22, ecartY: 104, ecartLignee: 1.4, marge: 90 };
  const PAS_X = L.largeur + L.ecartX;
  const SEUIL_NOMS = 0.42;
  const ZOOM_MIN = 0.05, ZOOM_MAX = 2.5;

  const COULEURS = {
    VERT: "#1c8a4e", BLEU: "#2262c6", ROUGE: "#cd2f34",
    JAUNE: "#b98800", ORANGE: "#dd6510",
  };
  const ORDRE_DEFAUT = ["VERT", "BLEU", "ROUGE", "JAUNE", "ORANGE"];
  const couleur = f => COULEURS[f] || "#3d4855";
  const joli = f => f[0] + f.slice(1).toLowerCase();

  // ============================================================
  //  Utilitaires
  // ============================================================
  const sansAccents = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const echapper = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nombre = n => n.toLocaleString("fr-FR");
  const entier = v => {
    const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  };

  const pinceau = document.createElement("canvas").getContext("2d");
  pinceau.font = "13px system-ui, sans-serif";
  function tronquer(texte, max) {
    if (pinceau.measureText(texte).width <= max) return texte;
    let t = texte;
    while (t.length > 1 && pinceau.measureText(t + "…").width > max) t = t.slice(0, -1);
    return t.trimEnd() + "…";
  }

  // ============================================================
  //  Lecture des CSV renvoyés par Google
  // ============================================================
  // Gère guillemets, virgules dans les cellules et retours à la ligne internes.
  function lireCSV(texte) {
    const t = texte.replace(/^\uFEFF/, "");
    const lignes = [];
    let ligne = [], cellule = "", guillemets = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (guillemets) {
        if (c === '"') {
          if (t[i + 1] === '"') { cellule += '"'; i++; }
          else guillemets = false;
        } else cellule += c;
      } else if (c === '"') guillemets = true;
      else if (c === ",") { ligne.push(cellule); cellule = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && t[i + 1] === "\n") i++;
        ligne.push(cellule); cellule = "";
        if (ligne.some(x => x.trim() !== "")) lignes.push(ligne);
        ligne = [];
      } else cellule += c;
    }
    ligne.push(cellule);
    if (ligne.some(x => x.trim() !== "")) lignes.push(ligne);
    return lignes;
  }

  // Retrouve une colonne par son intitulé, quels que soient accents, casse et ordre.
  function chercheur(enTete) {
    const cles = enTete.map(x => sansAccents(x).trim());
    return (noms, position) => {
      for (const n of noms) {
        const i = cles.indexOf(sansAccents(n));
        if (i !== -1) return i;
      }
      return position;
    };
  }

  function urlFeuille(gid) {
    let u = CFG.sheetBase + (CFG.sheetBase.includes("?") ? "&" : "?") + "output=csv";
    if (gid !== null && gid !== undefined && String(gid) !== "") u += "&single=true&gid=" + encodeURIComponent(gid);
    return u + "&_=" + Date.now();
  }

  async function telecharger(gid) {
    const stop = new AbortController();
    const minuteur = setTimeout(() => stop.abort(), CFG.delaiMax || 8000);
    try {
      const r = await fetch(urlFeuille(gid), { signal: stop.signal, cache: "no-store" });
      if (!r.ok) throw new Error("le serveur a répondu " + r.status);
      const texte = await r.text();
      if (/^\s*</.test(texte)) throw new Error("le lien de publication ne renvoie plus de CSV");
      return lireCSV(texte);
    } finally { clearTimeout(minuteur); }
  }

  // ============================================================
  //  Mise en forme des données
  // ============================================================
  function normaliserEleves(lignes) {
    if (lignes.length < 2) throw new Error("la feuille est vide");
    const col = chercheur(lignes[0]);
    const cId = col(["id"], 0);
    const cNom = col(["personne", "nom", "eleve", "etudiant"], 1);
    const cPar = col(["id_parent", "id_parents", "parent", "parents", "parrain"], 2);
    const cAn = col(["promotion", "promo", "annee"], 3);
    const cFam = col(["famille", "couleur"], 4);

    const gens = [], pris = new Set();
    let libre = 0;
    lignes.slice(1).forEach(l => {
      const nom = (l[cNom] || "").trim();
      const promo = entier(l[cAn]);
      const famille = (l[cFam] || "").trim().toUpperCase();
      let id = entier(l[cId]);
      if (!nom || promo === null || !famille || id === null) return;
      if (pris.has(id)) id = null;          // id en double : renuméroté plus bas
      else { pris.add(id); libre = Math.max(libre, id); }
      const parents = String(l[cPar] || "").split(/[;,|]/)
        .map(entier).filter(x => x !== null && x > 0);
      gens.push({ id, nom, parents, promo, famille });
    });

    gens.forEach(p => { if (p.id === null) p.id = ++libre; });
    const connus = new Set(gens.map(p => p.id));
    gens.forEach(p => { p.parents = p.parents.filter(x => connus.has(x) && x !== p.id); });
    if (!gens.length) throw new Error("aucune ligne exploitable");
    return gens;
  }

  // Feuille des points, une ligne par saison :
  //   annee | vert | bleu | rouge | jaune | orange
  function normaliserPoints(lignes) {
    if (lignes.length < 2) return [];
    const enTete = lignes[0];
    const col = chercheur(enTete);
    const cAn = col(["annee", "saison", "an", "année scolaire"], 0);

    const colonnes = [];
    enTete.forEach((h, i) => {
      const f = sansAccents(h).trim().toUpperCase();
      if (COULEURS[f] && i !== cAn) colonnes.push({ famille: f, i });
    });
    if (!colonnes.length) return [];

    const saisons = [];
    lignes.slice(1).forEach(l => {
      const annee = String(l[cAn] || "").trim();
      if (!annee) return;
      const scores = {};
      let vide = true;
      colonnes.forEach(({ famille, i }) => {
        const v = Number(String(l[i] || "").replace(/\s/g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
        scores[famille] = Number.isFinite(v) ? v : 0;
        if (String(l[i] || "").trim() !== "") vide = false;
      });
      if (!vide) saisons.push({ annee, scores, tri: entier(annee) ?? 0 });
    });
    saisons.sort((a, b) => a.tri - b.tri || a.annee.localeCompare(b.annee));
    return saisons;
  }

  // Classement d'une saison, avec gestion des ex æquo (1, 2, 2, 4, 5).
  function classer(scores, familles) {
    const rangs = familles.map(f => ({ famille: f, points: scores[f] ?? 0 }))
      .sort((a, b) => b.points - a.points);
    let place = 0, precedent = null;
    rangs.forEach((x, i) => {
      if (precedent === null || x.points !== precedent) place = i + 1;
      x.place = place;
      precedent = x.points;
    });
    return rangs;
  }

  // ============================================================
  //  État
  // ============================================================
  let PERSONNES = [], parId = new Map(), PROMOS = [], PROMO_MIN = 0;
  let FAMILLES = ORDRE_DEFAUT.slice();
  let SAISONS = [];
  let pret = false, echec = null, ongletActif = null;
  const arbresCalcules = new Map();

  function chargerBase(personnes) {
    PERSONNES = personnes;
    parId = new Map(personnes.map(p => [p.id, p]));
    personnes.forEach(p => { p.enfants = []; p.cle = sansAccents(p.nom); });
    personnes.forEach(p => p.parents.forEach(i => {
      const par = parId.get(i);
      if (par) par.enfants.push(p.id);
    }));
    PROMOS = [...new Set(personnes.map(p => p.promo))].sort((a, b) => a - b);
    PROMO_MIN = PROMOS[0];

    const vues = new Set(personnes.map(p => p.famille));
    FAMILLES = ORDRE_DEFAUT.filter(f => vues.has(f));
    vues.forEach(f => { if (!FAMILLES.includes(f)) FAMILLES.push(f); });
    arbresCalcules.clear();
  }

  // ============================================================
  //  Mise en page d'un arbre
  // ============================================================
  function calculerArbre(famille) {
    if (arbresCalcules.has(famille)) return arbresCalcules.get(famille);

    const membres = PERSONNES.filter(p => p.famille === famille);
    const dedans = new Set(membres.map(p => p.id));
    const noeuds = new Map();
    membres.forEach(p => noeuds.set(p.id, {
      id: p.id, nom: p.nom, promo: p.promo, famille,
      parents: p.parents.filter(x => dedans.has(x)),
      fils: [], x: 0, y: (p.promo - PROMO_MIN) * L.ecartY,
    }));

    // parent principal = premier parrain cité ; les autres deviennent des pointillés
    const racines = [];
    noeuds.forEach(n => {
      const principal = n.parents[0];
      if (principal !== undefined && noeuds.has(principal)) noeuds.get(principal).fils.push(n.id);
      else racines.push(n.id);
    });

    // un cycle de parrainages ne doit pas figer la page
    const vus = new Set();
    const sain = id => {
      if (vus.has(id)) return false;
      vus.add(id);
      const n = noeuds.get(id);
      n.fils = n.fils.filter(sain);
      return true;
    };
    racines.forEach(sain);
    noeuds.forEach(n => { if (!vus.has(n.id)) { racines.push(n.id); sain(n.id); } });

    const ordre = (a, b) => {
      const na = noeuds.get(a), nb = noeuds.get(b);
      return na.promo - nb.promo || na.nom.localeCompare(nb.nom, "fr");
    };
    noeuds.forEach(n => n.fils.sort(ordre));
    racines.sort(ordre);

    // Chaque sous-arbre occupe sa propre bande : aucun chevauchement possible.
    let curseur = 0;
    const placer = id => {
      const n = noeuds.get(id);
      if (!n.fils.length) { n.x = curseur; curseur += 1; return; }
      n.fils.forEach(placer);
      n.x = (noeuds.get(n.fils[0]).x + noeuds.get(n.fils[n.fils.length - 1]).x) / 2;
    };
    racines.forEach((r, i) => { if (i > 0) curseur += L.ecartLignee; placer(r); });

    noeuds.forEach(n => { n.px = n.x * PAS_X; });
    const xs = [...noeuds.values()].map(n => n.px), ys = [...noeuds.values()].map(n => n.y);
    const res = {
      famille, noeuds, racines,
      monde: {
        x0: Math.min(...xs) - L.largeur / 2 - L.marge,
        x1: Math.max(...xs) + L.largeur / 2 + L.marge,
        y0: Math.min(...ys) - L.hauteur / 2 - L.marge,
        y1: Math.max(...ys) + L.hauteur / 2 + L.marge,
      },
    };
    arbresCalcules.set(famille, res);
    return res;
  }

  // ============================================================
  //  Rendu de l'arbre
  // ============================================================
  const svg = document.getElementById("arbre");
  const scene = document.getElementById("scene");
  const gouttiere = document.getElementById("gouttiere");
  const fiche = document.getElementById("fiche");
  const voileArbre = document.getElementById("voile-arbre");
  const commandes = document.getElementById("commandes");
  const astuce = document.getElementById("astuce");

  let arbre = null, monde_g = null, selection = null, vientDeGlisser = false;
  let vue = { k: 1, x: 0, y: 0 };

  function dessiner(famille, garderLaVue = false) {
    const memoire = garderLaVue && arbre ? { ...vue, sel: selection } : null;
    arbre = calculerArbre(famille);
    const { noeuds, monde } = arbre;
    const bouts = ['<g id="regles">'];

    PROMOS.forEach(an => {
      const y = (an - PROMO_MIN) * L.ecartY;
      bouts.push(`<line class="regle" x1="${monde.x0}" y1="${y}" x2="${monde.x1}" y2="${y}" vector-effect="non-scaling-stroke"/>`);
    });
    bouts.push("</g><g id='liens'>");

    noeuds.forEach(n => n.parents.forEach((pid, i) => {
      const p = noeuds.get(pid);
      if (!p) return;
      const y1 = p.y + L.hauteur / 2, y2 = n.y - L.hauteur / 2, dy = (y2 - y1) * 0.45;
      bouts.push(`<path class="lien${i > 0 ? " co" : ""}" d="M${p.px},${y1}C${p.px},${y1 + dy} ${n.px},${y2 - dy} ${n.px},${y2}" data-p="${pid}" data-c="${n.id}" vector-effect="non-scaling-stroke"/>`);
    }));

    bouts.push("</g><g id='noeuds'>");
    const largeurNom = L.largeur - 24 - 40;
    noeuds.forEach(n => {
      const x = n.px - L.largeur / 2, y = n.y - L.hauteur / 2;
      bouts.push(
        `<g class="noeud" data-id="${n.id}" tabindex="0" role="button" aria-label="${echapper(n.nom)}, promotion ${n.promo}">` +
        `<rect x="${x}" y="${y}" width="${L.largeur}" height="${L.hauteur}"/>` +
        `<rect class="barrette" x="${x + 1}" y="${y + 8}" width="3" height="${L.hauteur - 16}" rx="1.5"/>` +
        `<text x="${x + 13}" y="${n.y}">${echapper(tronquer(n.nom, largeurNom))}</text>` +
        `<text class="an" x="${x + L.largeur - 11}" y="${n.y}" text-anchor="end">${n.promo}</text>` +
        `<title>${echapper(n.nom)} — promo ${n.promo}</title></g>`
      );
    });
    bouts.push("</g>");

    svg.innerHTML = `<g id="monde">${bouts.join("")}</g>`;
    svg.setAttribute("aria-label", `Arbre généalogique de la famille ${famille}`);
    monde_g = svg.firstChild;
    selection = null;
    fiche.hidden = true;
    vueArbre.classList.remove("fiche-ouverte");
    svg.classList.remove("selection");

    if (memoire) {
      vue.k = memoire.k; vue.x = memoire.x; vue.y = memoire.y;
      appliquer();
      if (memoire.sel && parId.has(memoire.sel)) selectionner(memoire.sel);
    } else vueInitiale();
  }

  function appliquer() {
    monde_g.setAttribute("transform", `translate(${vue.x},${vue.y}) scale(${vue.k})`);
    svg.classList.toggle("loin", vue.k < SEUIL_NOMS);
    majGouttiere();
  }

  function majGouttiere() {
    const h = scene.clientHeight, pas = L.ecartY * vue.k;
    const saut = Math.max(1, Math.ceil(24 / pas));
    const out = [];
    PROMOS.forEach((an, i) => {
      if (i % saut) return;
      const y = vue.y + (an - PROMO_MIN) * L.ecartY * vue.k;
      if (y < -20 || y > h + 20) return;
      out.push(`<span style="top:${y}px">${an}</span>`);
    });
    gouttiere.innerHTML = out.join("");
  }

  function ajuster() {
    const m = arbre.monde, w = scene.clientWidth, h = scene.clientHeight;
    const k = Math.min(w / (m.x1 - m.x0), h / (m.y1 - m.y0));
    vue.k = Math.min(Math.max(k, ZOOM_MIN), 1);
    vue.x = w / 2 - ((m.x0 + m.x1) / 2) * vue.k;
    vue.y = h / 2 - ((m.y0 + m.y1) / 2) * vue.k;
    appliquer();
  }

  // Vue de départ : en haut de l'arbre, à un zoom où les noms se lisent.
  function vueInitiale() {
    const m = arbre.monde, w = scene.clientWidth, h = scene.clientHeight;
    const complet = Math.min(w / (m.x1 - m.x0), h / (m.y1 - m.y0));
    // sur un écran étroit, les noms deviennent illisibles en dessous de 0,85
    const plancher = w < 700 ? .85 : .5;
    vue.k = Math.min(Math.max(complet, plancher), 1);
    if (vue.k <= complet + 1e-9) { ajuster(); return; }
    const rac = arbre.racines.map(id => arbre.noeuds.get(id));
    vue.x = w / 2 - (rac.reduce((s, n) => s + n.px, 0) / rac.length) * vue.k;
    vue.y = 70 - (m.y0 + L.marge - L.hauteur) * vue.k;
    appliquer();
  }

  function zoomer(facteur, cx, cy) {
    if (!arbre) return;
    const w = scene.clientWidth, h = scene.clientHeight;
    cx = cx ?? w / 2; cy = cy ?? h / 2;
    const k2 = Math.min(Math.max(vue.k * facteur, ZOOM_MIN), ZOOM_MAX), r = k2 / vue.k;
    vue.x = cx - (cx - vue.x) * r;
    vue.y = cy - (cy - vue.y) * r;
    vue.k = k2;
    appliquer();
  }

  function centrerSur(id, cible = 1) {
    const n = arbre.noeuds.get(id);
    if (!n) return;
    vue.k = Math.min(Math.max(vue.k, cible), ZOOM_MAX);
    vue.x = scene.clientWidth / 2 - n.px * vue.k;
    vue.y = scene.clientHeight / 2 - n.y * vue.k;
    appliquer();
  }

  // ---------- Déplacement, zoom, pincement ----------
  const pointeurs = new Map();
  let attrape = null, pince = null, dernierTap = 0, dernierTapXY = null;

  const milieu = () => {
    const p = [...pointeurs.values()];
    return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
  };
  const ecart = () => {
    const p = [...pointeurs.values()];
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  };

  function demarrerPince() {
    const r = scene.getBoundingClientRect();
    const m = milieu();
    pince = {
      d0: ecart() || 1,
      m0: { x: m.x - r.left, y: m.y - r.top },
      k0: vue.k, x0: vue.x, y0: vue.y,
      rect: r,
    };
    attrape = null;
  }

  function demarrerGlisse(p) {
    attrape = { x: p.x, y: p.y, vx: vue.x, vy: vue.y, bouge: false };
  }

  scene.addEventListener("pointerdown", e => {
    if (!pret) return;
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    scene.setPointerCapture(e.pointerId);
    vientDeGlisser = false;
    if (pointeurs.size === 2) demarrerPince();
    else if (pointeurs.size === 1) {
      demarrerGlisse({ x: e.clientX, y: e.clientY });
      scene.classList.add("attrape");
    }
  });

  scene.addEventListener("pointermove", e => {
    if (!pointeurs.has(e.pointerId)) return;
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pince && pointeurs.size >= 2) {
      const m = milieu();
      const m1 = { x: m.x - pince.rect.left, y: m.y - pince.rect.top };
      const k = Math.min(Math.max(pince.k0 * (ecart() / pince.d0), ZOOM_MIN), ZOOM_MAX);
      // le point du monde saisi entre les deux doigts reste sous les doigts
      vue.x = m1.x - (pince.m0.x - pince.x0) * (k / pince.k0);
      vue.y = m1.y - (pince.m0.y - pince.y0) * (k / pince.k0);
      vue.k = k;
      vientDeGlisser = true;
      appliquer();
      return;
    }

    if (!attrape) return;
    const dx = e.clientX - attrape.x, dy = e.clientY - attrape.y;
    if (!attrape.bouge && Math.hypot(dx, dy) < 5) return;
    attrape.bouge = true;
    vientDeGlisser = true;
    vue.x = attrape.vx + dx;
    vue.y = attrape.vy + dy;
    appliquer();
  });

  function relacher(e) {
    pointeurs.delete(e.pointerId);
    if (pointeurs.size < 2) pince = null;
    if (pointeurs.size === 1) demarrerGlisse([...pointeurs.values()][0]);
    if (pointeurs.size === 0) {
      attrape = null;
      scene.classList.remove("attrape");
    }
  }
  scene.addEventListener("pointerup", relacher);
  scene.addEventListener("pointercancel", relacher);

  // Double tap ou double clic : on approche, puis on revient à la vue d'ensemble.
  scene.addEventListener("pointerup", e => {
    if (!pret || vientDeGlisser || pointeurs.size) return;
    const maintenant = Date.now();
    const proche = dernierTapXY && Math.hypot(e.clientX - dernierTapXY.x, e.clientY - dernierTapXY.y) < 30;
    if (maintenant - dernierTap < 320 && proche) {
      const r = scene.getBoundingClientRect();
      zoomer(vue.k < 1.1 ? 2 : 1 / (vue.k / 0.5), e.clientX - r.left, e.clientY - r.top);
      dernierTap = 0;
      dernierTapXY = null;
      return;
    }
    dernierTap = maintenant;
    dernierTapXY = { x: e.clientX, y: e.clientY };
  });

  scene.addEventListener("wheel", e => {
    if (!pret) return;
    e.preventDefault();
    const r = scene.getBoundingClientRect();
    zoomer(Math.pow(0.998, e.deltaY), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  document.getElementById("zoom-plus").onclick = () => zoomer(1.35);
  document.getElementById("zoom-moins").onclick = () => zoomer(1 / 1.35);
  document.getElementById("ajuster").onclick = () => { deselectionner(); if (arbre) ajuster(); };
  window.addEventListener("resize", () => { if (arbre && pret) appliquer(); });

  // ---------- Sélection ----------
  svg.addEventListener("click", e => {
    if (vientDeGlisser) { vientDeGlisser = false; return; }
    const g = e.target.closest(".noeud");
    if (g) selectionner(Number(g.dataset.id));
  });
  svg.addEventListener("keydown", e => {
    const g = e.target.closest(".noeud");
    if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); selectionner(Number(g.dataset.id)); }
  });

  function remonter(id, champ) {
    const vus = new Set(), file = [id];
    while (file.length) {
      const p = parId.get(file.pop());
      if (!p) continue;
      p[champ].forEach(x => { if (!vus.has(x)) { vus.add(x); file.push(x); } });
    }
    return vus;
  }

  function deselectionner() {
    selection = null;
    svg.classList.remove("selection");
    svg.querySelectorAll(".actif, .ancetre, .descendant").forEach(el => el.classList.remove("actif", "ancetre", "descendant"));
    fiche.hidden = true;
    vueArbre.classList.remove("fiche-ouverte");
  }

  function selectionner(id, recentrer = false) {
    const p = parId.get(id);
    if (!p) return;
    if (!arbre || arbre.famille !== p.famille) {
      ouvrirOnglet(p.famille);
      requestAnimationFrame(() => selectionner(id, true));
      return;
    }
    astuce.classList.add("parti");
    svg.querySelectorAll(".actif, .ancetre, .descendant").forEach(el => el.classList.remove("actif", "ancetre", "descendant"));
    selection = id;

    const haut = remonter(id, "parents"), bas = remonter(id, "enfants");
    const tous = new Set([...haut, ...bas, id]);
    svg.querySelectorAll(".noeud").forEach(g => {
      const i = Number(g.dataset.id);
      if (i === id) g.classList.add("actif");
      else if (haut.has(i)) g.classList.add("ancetre");
      else if (bas.has(i)) g.classList.add("descendant");
    });
    svg.querySelectorAll(".lien").forEach(l => {
      if (tous.has(Number(l.dataset.p)) && tous.has(Number(l.dataset.c))) l.classList.add("actif");
    });
    svg.classList.add("selection");
    remplirFiche(p, haut, bas);
    if (recentrer) centrerSur(id, 1);
  }

  function remplirFiche(p, haut, bas) {
    const parrains = p.parents.map(i => parId.get(i)).filter(Boolean);
    const fillots = p.enfants.map(i => parId.get(i)).filter(Boolean)
      .sort((a, b) => a.promo - b.promo || a.nom.localeCompare(b.nom, "fr"));

    const chaine = [];
    let cur = p, garde = 0;
    while (cur.parents.length && garde++ < 60) {
      cur = parId.get(cur.parents[0]);
      if (!cur) break;
      chaine.unshift(cur);
    }
    const gen = bas.size ? Math.max(...[...bas].map(i => parId.get(i).promo)) - p.promo : 0;
    const bouton = q => `<button class="lien-perso" data-va="${q.id}">${echapper(q.nom)}<span class="an">${q.promo}</span></button>`;

    fiche.innerHTML =
      `<button class="fermer" aria-label="Fermer la fiche">×</button>` +
      `<h2>${echapper(p.nom)}</h2>` +
      `<p class="sous">Promotion ${p.promo} · famille ${p.famille.toLowerCase()}</p>` +
      (chaine.length
        ? `<h3>Sa lignée depuis le départ</h3><p class="filiation">` +
          chaine.map(q => `<button data-va="${q.id}">${echapper(q.nom)}</button>`).join('<span class="fleche">→</span>') +
          `<span class="fleche">→</span>${echapper(p.nom)}</p>`
        : `<h3>Sa lignée</h3><p class="filiation">Fondateur ou fondatrice de sa lignée.</p>`) +
      (parrains.length ? `<h3>${parrains.length > 1 ? "Ses parrains" : "Son parrain ou sa marraine"}</h3><ul>${parrains.map(q => `<li>${bouton(q)}</li>`).join("")}</ul>` : "") +
      (fillots.length ? `<h3>${fillots.length > 1 ? "Ses fillots" : "Son fillot ou sa fillote"}</h3><ul>${fillots.map(q => `<li>${bouton(q)}</li>`).join("")}</ul>` : "") +
      `<div class="chiffres">` +
        `<div><b>${nombre(bas.size)}</b><span>descendants</span></div>` +
        `<div><b>${gen}</b><span>génération${gen > 1 ? "s" : ""} en dessous</span></div>` +
        `<div><b>${haut.size}</b><span>ancêtres</span></div></div>`;
    fiche.hidden = false;
    vueArbre.classList.add("fiche-ouverte");
  }

  fiche.addEventListener("click", e => {
    if (e.target.closest(".fermer")) { deselectionner(); return; }
    const b = e.target.closest("[data-va]");
    if (b) selectionner(Number(b.dataset.va), true);
  });

  // ============================================================
  //  Zones de chargement
  // ============================================================
  const RANGS = [1, 1, 2, 2, 3, 4, 5, 6, 6, 5];

  function squeletteArbre() {
    return `<div class="sq-arbre">` + RANGS.map(n =>
      `<div class="sq-rang">${'<span class="sq-bloc"></span>'.repeat(n)}</div>`).join("") + `</div>`;
  }

  function squeletteTexte() {
    return `<div class="sq-page">` +
      `<span class="sq-titre"></span><span class="sq-ligne"></span><span class="sq-ligne court"></span>` +
      `<div class="sq-cartes">${'<span class="sq-carte"></span>'.repeat(5)}</div>` +
      `<span class="sq-bloc-large"></span></div>`;
  }

  function messageErreur() {
    if (echec === "FICHIER_LOCAL") {
      return `<div class="souci" role="alert">
        <h2>Il faut passer par un serveur</h2>
        <p>La page a été ouverte directement depuis le disque. Dans ce cas le
        navigateur considère qu'elle n'a pas d'origine, et Google refuse de lui
        envoyer les données.</p>
        <p class="petit">Pour tester en local, ouvrez un terminal dans ce dossier et lancez
        <code>python3 -m http.server</code>, puis allez sur
        <code>http://localhost:8000</code>. Une fois le site sur GitHub Pages,
        le problème disparaît de lui-même.</p>
      </div>`;
    }
    return `<div class="souci" role="alert">
      <h2>Les données ne se chargent pas</h2>
      <p>${echapper(echec || "Le Google Sheet n'a pas répondu.")}</p>
      <p class="petit">Vérifiez votre connexion. Si le problème persiste, c'est sans doute que le classeur n'est plus publié sur le web.</p>
      <button type="button" class="reessayer">Réessayer</button>
    </div>`;
  }

  document.addEventListener("click", e => {
    if (e.target.closest(".reessayer")) rafraichir();
  });

  // ============================================================
  //  Onglets
  // ============================================================
  const barreOnglets = document.getElementById("onglets");
  const burger = document.getElementById("burger");
  const burgerTitre = document.getElementById("burger-titre");
  const vueArbre = document.getElementById("vue-arbre");
  const vueInfo = document.getElementById("vue-info");
  const vueClassement = document.getElementById("vue-classement");
  const blocRecherche = document.getElementById("bloc-recherche");

  const libelle = cle => cle === "INFO" ? "Informations" : cle === "CLASSEMENT" ? "Classement" : joli(cle);

  function fermerMenu() {
    barreOnglets.classList.remove("ouvert");
    burger.setAttribute("aria-expanded", "false");
  }

  burger.addEventListener("click", e => {
    e.stopPropagation();
    const ouvert = barreOnglets.classList.toggle("ouvert");
    burger.setAttribute("aria-expanded", String(ouvert));
  });
  document.addEventListener("click", e => {
    if (!e.target.closest("#onglets") && !e.target.closest("#burger")) fermerMenu();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") fermerMenu(); });

  function construireOnglets() {
    barreOnglets.innerHTML =
      FAMILLES.map(f => `<button class="onglet" role="tab" data-onglet="${f}" aria-selected="${f === ongletActif}" style="--c:${couleur(f)}"><span class="point"></span>${joli(f)}</button>`).join("") +
      `<button class="onglet onglet-a-part" role="tab" data-onglet="CLASSEMENT" aria-selected="${ongletActif === "CLASSEMENT"}">Classement</button>` +
      `<button class="onglet" role="tab" data-onglet="INFO" aria-selected="${ongletActif === "INFO"}">Informations</button>`;
  }

  function ouvrirOnglet(cle) {
    ongletActif = cle;
    document.body.dataset.famille = cle;
    burgerTitre.textContent = libelle(cle);
    fermerMenu();
    barreOnglets.querySelectorAll(".onglet").forEach(b => b.setAttribute("aria-selected", String(b.dataset.onglet === cle)));
    const estArbre = FAMILLES.includes(cle);
    vueArbre.hidden = !estArbre;
    vueInfo.hidden = cle !== "INFO";
    vueClassement.hidden = cle !== "CLASSEMENT";
    blocRecherche.style.visibility = estArbre && pret ? "visible" : "hidden";
    afficher();
    // sur file:// le navigateur refuse de toucher à l'URL : on n'insiste pas
    if (location.protocol !== "file:") {
      try { history.replaceState(null, "", "#" + cle.toLowerCase()); } catch (_) {}
    }
  }

  barreOnglets.addEventListener("click", e => {
    const b = e.target.closest(".onglet");
    if (b) ouvrirOnglet(b.dataset.onglet);
  });

  // Aiguille l'onglet courant vers son contenu, sa zone de chargement ou l'erreur.
  function afficher(garderLaVue = false) {
    const estArbre = FAMILLES.includes(ongletActif);
    const enAttente = !pret;

    voileArbre.hidden = !enAttente;
    commandes.style.visibility = enAttente ? "hidden" : "visible";
    astuce.style.visibility = enAttente ? "hidden" : "visible";
    blocRecherche.style.visibility = estArbre && pret ? "visible" : "hidden";

    if (enAttente) {
      voileArbre.innerHTML = echec ? messageErreur() : squeletteArbre();
      gouttiere.innerHTML = "";
      svg.innerHTML = "";
      arbre = null;
      const attente = echec ? messageErreur() : squeletteTexte();
      document.getElementById("contenu-info").innerHTML = attente;
      document.getElementById("contenu-classement").innerHTML = attente;
      return;
    }

    if (estArbre) dessiner(ongletActif, garderLaVue);
    else if (ongletActif === "INFO") rendreInfo();
    else rendreClassement();
  }

  // ============================================================
  //  Recherche
  // ============================================================
  const champ = document.getElementById("recherche");
  const listeRes = document.getElementById("resultats");

  function afficherResultats() {
    const cle = sansAccents(champ.value.trim());
    if (!cle || !pret) { listeRes.hidden = true; champ.setAttribute("aria-expanded", "false"); return; }
    const debut = [], dedans = [];
    for (const p of PERSONNES) {
      const i = p.cle.indexOf(cle);
      if (i === 0) debut.push(p); else if (i > 0) dedans.push(p);
      if (debut.length > 40) break;
    }
    const res = debut.concat(dedans).slice(0, 12);
    listeRes.innerHTML = res.length
      ? res.map(p => `<li role="option"><button data-va="${p.id}"><span class="pt" style="background:${couleur(p.famille)}"></span>${echapper(p.nom)}<span class="an">${p.promo}</span></button></li>`).join("")
      : `<li class="vide">Personne de ce nom dans la base.</li>`;
    listeRes.hidden = false;
    champ.setAttribute("aria-expanded", "true");
  }

  champ.addEventListener("input", afficherResultats);
  champ.addEventListener("focus", afficherResultats);
  champ.addEventListener("keydown", e => {
    if (e.key === "Escape") { listeRes.hidden = true; champ.blur(); }
    if (e.key === "Enter") { const b = listeRes.querySelector("[data-va]"); if (b) b.click(); }
  });
  listeRes.addEventListener("click", e => {
    const b = e.target.closest("[data-va]");
    if (!b) return;
    listeRes.hidden = true; champ.value = "";
    selectionner(Number(b.dataset.va), true);
  });
  document.addEventListener("click", e => {
    if (!e.target.closest("#bloc-recherche")) listeRes.hidden = true;
  });

  // ============================================================
  //  Onglet Classement
  // ============================================================
  const RANG_TEXTE = ["1re", "2e", "3e", "4e", "5e", "6e", "7e"];
  const rangTexte = p => RANG_TEXTE[p - 1] || p + "e";

  function rendreClassement() {
    const zone = document.getElementById("contenu-classement");

    if (!SAISONS.length) {
      zone.innerHTML = `<h1>Classement des familles</h1>
        <div class="mode-emploi">
          <p>Aucun résultat n'est encore publié. Pour alimenter cette page&nbsp;:</p>
          <ol>
            <li>Dans le Google Sheet, ajoutez un onglet nommé <b>points</b>.</li>
            <li>Première ligne&nbsp;: <code>annee</code>, <code>vert</code>, <code>bleu</code>, <code>rouge</code>, <code>jaune</code>, <code>orange</code>.</li>
            <li>Une ligne par saison, par exemple&nbsp;: <code>2024-2025</code> puis le total de points de chaque famille.</li>
            <li>Ouvrez cet onglet et relevez le <code>gid=…</code> à la fin de l'adresse.</li>
            <li>Recopiez ce nombre dans <code>config.js</code>, à la ligne <code>gidPoints</code>.</li>
          </ol>
          <p>Podium, victoires, moyennes et historique se construisent ensuite tout seuls.</p>
        </div>`;
      return;
    }

    const familles = FAMILLES.filter(f => SAISONS.some(s => s.scores[f] !== undefined));
    const parSaison = SAISONS.map(s => ({ ...s, rangs: classer(s.scores, familles) }));
    const derniere = parSaison[parSaison.length - 1];

    // statistiques cumulées
    const stat = {};
    familles.forEach(f => stat[f] = { victoires: 0, places: [], points: 0, podiums: 0 });
    parSaison.forEach(s => s.rangs.forEach(r => {
      const t = stat[r.famille];
      t.places.push(r.place);
      t.points += r.points;
      if (r.place === 1) t.victoires++;
      if (r.place <= 3) t.podiums++;
    }));
    familles.forEach(f => {
      const t = stat[f];
      t.moyenne = t.places.reduce((a, b) => a + b, 0) / t.places.length;
    });

    const podium = derniere.rangs.slice(0, 3);
    const suivants = derniere.rangs.slice(3);
    const facteurs = [1, .76, .58];

    const parMoyenne = familles.slice().sort((a, b) => stat[a].moyenne - stat[b].moyenne);
    const parVictoires = familles.slice().sort((a, b) => stat[b].victoires - stat[a].victoires || stat[a].moyenne - stat[b].moyenne);

    zone.innerHTML =
      `<h1>Classement des familles</h1>` +
      `<p class="chapeau">${parSaison.length} saison${parSaison.length > 1 ? "s" : ""} enregistrée${parSaison.length > 1 ? "s" : ""}, de ${echapper(parSaison[0].annee)} à ${echapper(derniere.annee)}.</p>` +

      `<section>
        <h2>Saison ${echapper(derniere.annee)}</h2>
        <div class="tribune">${podium.map((r, i) => `
          <div class="marche" style="--c:${couleur(r.famille)};--f:${facteurs[i]}">
            <span class="marche-pts">${nombre(r.points)}</span>
            <span class="marche-bloc"><b>${rangTexte(r.place)}</b></span>
            <span class="marche-nom">${joli(r.famille)}</span>
          </div>`).join("")}</div>
        ${suivants.length ? `<ul class="reste">${suivants.map(r => `
          <li style="--c:${couleur(r.famille)}"><span class="rang">${rangTexte(r.place)}</span>
          <span class="qui">${joli(r.famille)}</span><span class="pts">${nombre(r.points)} pts</span></li>`).join("")}</ul>` : ""}
      </section>` +

      `<section>
        <h2>Le palmarès</h2>
        <div class="cartes">${parVictoires.map(f => `
          <div class="carte" style="--c:${couleur(f)}">
            <div class="nom">${joli(f)}</div>
            <div class="nb">${stat[f].victoires}</div>
            <div class="det">victoire${stat[f].victoires > 1 ? "s" : ""} · ${stat[f].podiums} podium${stat[f].podiums > 1 ? "s" : ""}</div>
          </div>`).join("")}</div>
      </section>` +

      `<section>
        <h2>Place moyenne sur ${parSaison.length} saison${parSaison.length > 1 ? "s" : ""}</h2>
        <ul class="moyennes">${parMoyenne.map(f => `
          <li style="--c:${couleur(f)}">
            <span class="qui">${joli(f)}</span>
            <span class="bar"><i style="width:${100 * (familles.length - stat[f].moyenne) / (familles.length - 1)}%"></i></span>
            <span class="val">${stat[f].moyenne.toFixed(2).replace(".", ",")}</span>
          </li>`).join("")}</ul>
        <p class="note">1,00 signifie première à chaque fois. Plus la barre est longue, meilleure est la moyenne.</p>
      </section>` +

      (parSaison.length > 1 ? `<section><h2>L'historique des places</h2><div id="courbes"></div></section>` : "") +

      `<section>
        <h2>Saison par saison</h2>
        <div class="tableau-boite"><table>
          <thead><tr><th>Saison</th>${familles.map(f => `<th><span class="pastille-th" style="background:${couleur(f)}"></span>${joli(f)}</th>`).join("")}</tr></thead>
          <tbody>${parSaison.slice().reverse().map(s => `<tr><td>${echapper(s.annee)}</td>${familles.map(f => {
            const r = s.rangs.find(x => x.famille === f);
            return `<td><span class="place${r.place === 1 ? " or" : ""}">${rangTexte(r.place)}</span> <span class="pts-mini">${nombre(r.points)}</span></td>`;
          }).join("")}</tr>`).join("")}</tbody>
        </table></div>
      </section>`;

    if (parSaison.length > 1) dessinerCourbes(parSaison, familles);
  }

  // Courbes des places : la 1re place est en haut, l'axe est donc inversé.
  function dessinerCourbes(parSaison, familles) {
    const W = 900, H = 300, bas = 40, haut = 20, gauche = 52, droite = 14;
    const n = familles.length;
    const px = i => gauche + (W - gauche - droite) * (parSaison.length === 1 ? .5 : i / (parSaison.length - 1));
    const py = place => haut + (H - bas - haut) * (place - 1) / Math.max(1, n - 1);

    let s = "";
    for (let p = 1; p <= n; p++) {
      const y = py(p);
      s += `<line x1="${gauche}" y1="${y}" x2="${W - droite}" y2="${y}" stroke="#e3e6e8"/>`;
      s += `<text class="g-etiquette" x="${gauche - 10}" y="${y + 4}" text-anchor="end">${rangTexte(p)}</text>`;
    }
    parSaison.forEach((s2, i) => {
      s += `<text class="g-etiquette" x="${px(i)}" y="${H - bas + 20}" text-anchor="middle">${echapper(s2.annee)}</text>`;
    });
    familles.forEach(f => {
      const pts = parSaison.map((s2, i) => [px(i), py(s2.rangs.find(x => x.famille === f).place)]);
      s += `<path d="${pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ")}" fill="none" stroke="${couleur(f)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      pts.forEach((p, i) => {
        const r = parSaison[i].rangs.find(x => x.famille === f);
        s += `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#fff" stroke="${couleur(f)}" stroke-width="2.5"><title>${parSaison[i].annee} · ${joli(f)} : ${rangTexte(r.place)}, ${r.points} points</title></circle>`;
      });
    });
    document.getElementById("courbes").innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Place de chaque famille saison après saison">${s}</svg>`;
  }

  // ============================================================
  //  Onglet Informations
  // ============================================================
  let promosChoisies = new Set(), toutesChoisies = true;

  function rendreInfo() {
    const zone = document.getElementById("contenu-info");
    if (!zone.querySelector("#puces-promo")) {
      zone.innerHTML = `
        <h1>Qui compose les familles</h1>
        <p class="chapeau" id="info-chapeau"></p>
        <section>
          <div class="filtre-tete"><h2>Promotions retenues</h2>
            <div class="filtre-actions">
              <button type="button" id="promo-tout">Tout sélectionner</button>
              <button type="button" id="promo-rien">Tout effacer</button>
              <button type="button" id="promo-recentes">5 dernières</button>
            </div>
          </div>
          <div class="puces" id="puces-promo"></div>
        </section>
        <section class="cartes" id="cartes-familles" aria-label="Effectif par famille"></section>
        <section><h2>Répartition promotion par promotion</h2><div id="graphe-promos"></div></section>
        <section><h2>Le détail chiffré</h2><div class="tableau-boite" id="tableau-promos"></div></section>`;

      zone.querySelector("#puces-promo").addEventListener("click", e => {
        const b = e.target.closest(".puce");
        if (!b) return;
        const an = Number(b.dataset.promo);
        if (promosChoisies.has(an)) promosChoisies.delete(an); else promosChoisies.add(an);
        toutesChoisies = promosChoisies.size === PROMOS.length;
        rendreInfo();
      });
      zone.querySelector("#promo-tout").onclick = () => { promosChoisies = new Set(PROMOS); toutesChoisies = true; rendreInfo(); };
      zone.querySelector("#promo-rien").onclick = () => { promosChoisies.clear(); toutesChoisies = false; rendreInfo(); };
      zone.querySelector("#promo-recentes").onclick = () => { promosChoisies = new Set(PROMOS.slice(-5)); toutesChoisies = false; rendreInfo(); };
      zone.querySelector("#cartes-familles").addEventListener("click", e => {
        const c = e.target.closest("[data-famille]");
        if (c) ouvrirOnglet(c.dataset.famille);
      });
    }

    if (toutesChoisies) promosChoisies = new Set(PROMOS);
    document.getElementById("puces-promo").innerHTML = PROMOS.map(an =>
      `<button class="puce" data-promo="${an}" aria-pressed="${promosChoisies.has(an)}">${an}</button>`).join("");

    const promos = PROMOS.filter(a => promosChoisies.has(a));
    const retenus = PERSONNES.filter(p => promosChoisies.has(p.promo));

    document.getElementById("info-chapeau").textContent =
      `La base compte ${nombre(PERSONNES.length)} personnes réparties entre ${FAMILLES.length} familles, ` +
      `des promotions ${PROMOS[0]} à ${PROMOS[PROMOS.length - 1]}. ` +
      `Choisissez les promotions qui vous intéressent : tous les chiffres ci-dessous s'y adaptent.`;

    const compte = {}, lignees = {};
    FAMILLES.forEach(f => { compte[f] = 0; lignees[f] = 0; });
    retenus.forEach(p => compte[p.famille]++);
    PERSONNES.forEach(p => { if (!p.parents.length && lignees[p.famille] !== undefined) lignees[p.famille]++; });
    const total = retenus.length, maxi = Math.max(1, ...FAMILLES.map(f => compte[f]));

    document.getElementById("cartes-familles").innerHTML = FAMILLES.map(f => `
      <button class="carte" data-famille="${f}" style="--c:${couleur(f)}">
        <div class="nom">${joli(f)}</div>
        <div class="nb">${nombre(compte[f])}</div>
        <div class="det">${total ? (100 * compte[f] / total).toFixed(1).replace(".", ",") : "0"} % de la sélection · ${lignees[f]} lignées</div>
        <div class="jauge"><i style="width:${100 * compte[f] / maxi}%"></i></div>
      </button>`).join("");

    const graphe = document.getElementById("graphe-promos");
    if (!promos.length) {
      graphe.innerHTML = `<p class="vide-info">Aucune promotion sélectionnée. Cliquez sur une année pour la faire revenir.</p>`;
      document.getElementById("tableau-promos").innerHTML = `<p class="vide-info">Rien à afficher pour l'instant.</p>`;
      return;
    }

    const W = 900, H = 300, bas = 34, haut = 18;
    const cases = new Map(promos.map(an => {
      const o = { an, total: 0 };
      FAMILLES.forEach(f => o[f] = 0);
      return [an, o];
    }));
    retenus.forEach(p => { const o = cases.get(p.promo); if (o) { o[p.famille]++; o.total++; } });
    const liste = [...cases.values()];
    const plafond = Math.max(1, ...liste.map(o => o.total));
    const col = W / liste.length, barre = Math.min(34, col - 6);

    let s = "";
    liste.forEach((o, i) => {
      const cx = col * (i + .5);
      let y = H - bas;
      FAMILLES.forEach(f => {
        const h = (H - bas - haut) * o[f] / plafond;
        if (h > 0) {
          y -= h;
          s += `<rect x="${cx - barre / 2}" y="${y}" width="${barre}" height="${h}" fill="${couleur(f)}" rx="1.5"><title>${o.an} · ${f.toLowerCase()} : ${o[f]}</title></rect>`;
        }
      });
      s += `<text class="g-total" x="${cx}" y="${y - 6}" text-anchor="middle">${o.total}</text>`;
      s += `<text class="g-etiquette" x="${cx}" y="${H - bas + 16}" text-anchor="middle" transform="rotate(-45 ${cx} ${H - bas + 16})">${o.an}</text>`;
    });
    s += `<line x1="0" y1="${H - bas}" x2="${W}" y2="${H - bas}" stroke="#d4d8dc"/>`;
    graphe.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Nombre de personnes par promotion et par famille">${s}</svg>`;

    document.getElementById("tableau-promos").innerHTML = `<table>
      <thead><tr><th>Promotion</th>${FAMILLES.map(f => `<th><span class="pastille-th" style="background:${couleur(f)}"></span>${joli(f)}</th>`).join("")}<th>Total</th></tr></thead>
      <tbody>${liste.map(o => `<tr><td>${o.an}</td>${FAMILLES.map(f => `<td>${o[f]}</td>`).join("")}<td><b>${o.total}</b></td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td>${FAMILLES.map(f => `<td>${compte[f]}</td>`).join("")}<td>${nombre(total)}</td></tr></tfoot>
    </table>`;
  }

  // ============================================================
  //  Chargement
  // ============================================================
  async function rafraichir() {
    pret = false; echec = null;
    afficher();

    const [eleves, points] = await Promise.allSettled([
      telecharger(CFG.gidEleves),
      CFG.gidPoints ? telecharger(CFG.gidPoints) : Promise.resolve(null),
    ]);

    SAISONS = [];
    if (points.status === "fulfilled" && points.value) {
      try { SAISONS = normaliserPoints(points.value); } catch (_) { SAISONS = []; }
    }

    if (eleves.status === "rejected") {
      echec = location.protocol === "file:"
        ? "FICHIER_LOCAL"
        : eleves.reason && eleves.reason.name === "AbortError"
          ? "Le Google Sheet met trop de temps à répondre."
          : "Le Google Sheet est injoignable.";
      afficher();
      return;
    }

    try {
      chargerBase(normaliserEleves(eleves.value));
    } catch (e) {
      echec = "Feuille illisible : " + e.message;
      afficher();
      return;
    }

    pret = true;
    if (!FAMILLES.includes(ongletActif) && ongletActif !== "INFO" && ongletActif !== "CLASSEMENT") ongletActif = FAMILLES[0];
    construireOnglets();
    document.body.dataset.famille = ongletActif;
    afficher();
  }

  // ---------- Démarrage ----------
  if (window.matchMedia && window.matchMedia("(hover: none)").matches) {
    astuce.textContent = "Pincez pour zoomer, glissez pour vous déplacer, touchez quelqu'un pour suivre sa lignée.";
  }

  const depart = decodeURIComponent(location.hash.slice(1)).toUpperCase();
  ongletActif = FAMILLES.includes(depart) || depart === "INFO" || depart === "CLASSEMENT" ? depart : FAMILLES[0];
  document.body.dataset.famille = ongletActif;
  burgerTitre.textContent = libelle(ongletActif);
  construireOnglets();
  vueArbre.hidden = !FAMILLES.includes(ongletActif);
  vueInfo.hidden = ongletActif !== "INFO";
  vueClassement.hidden = ongletActif !== "CLASSEMENT";
  rafraichir();

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { if (pret && arbre) dessiner(arbre.famille, true); });
  }
})();
