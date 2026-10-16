const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Code d'accès professeur (à définir en variable d'environnement sur Render)
const CODE_PROF = process.env.CODE_PROF || 'prof2026';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   ÉTAT EN MÉMOIRE (aucune base de données)
   ========================================================= */
const etat = {
  // Liste des binômes : { id, titulaire, suppleant }
  binomes: [],

  // Statut du scrutin : 'ferme' | 'ouvert' | 'depouille'
  statut: 'ferme',

  // Tour en cours (1 ou 2)
  tour: 1,

  // Présents : Map prenomNormalise -> { prenom, aVote, socketIds:Set }
  presents: new Map(),

  // Bulletins ANONYMES : tableau de { choix } où choix = idBinome | 'blanc' | 'nul'
  // AUCUN lien avec l'identité du votant
  urne: [],

  // Historique des tours précédents
  historique: [],

  // Binômes qualifiés pour le 2nd tour (si applicable)
  qualifies: null
};

function normaliser(s) {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/* =========================================================
   LOGIQUE DE DÉPOUILLEMENT (règles françaises)
   ========================================================= */
function depouiller() {
  const total = etat.urne.length;
  const nuls = etat.urne.filter(b => b.choix === 'nul').length;
  const blancs = etat.urne.filter(b => b.choix === 'blanc').length;

  // Suffrages exprimés = votes - (blancs + nuls)  [art. L.65 Code électoral]
  const exprimes = total - blancs - nuls;

  const listeBinomes = etat.qualifies
    ? etat.binomes.filter(b => etat.qualifies.includes(b.id))
    : etat.binomes;

  const resultats = listeBinomes.map(b => {
    const voix = etat.urne.filter(x => x.choix === b.id).length;
    return {
      id: b.id,
      titulaire: b.titulaire,
      suppleant: b.suppleant,
      voix,
      pourcentage: exprimes > 0 ? (voix / exprimes) * 100 : 0
    };
  }).sort((a, b) => b.voix - a.voix);

  const majoriteAbsolue = Math.floor(exprimes / 2) + 1;

  let verdict = null;
  let elu = null;
  let besoinSecondTour = false;
  let qualifiesTour2 = null;

  if (exprimes === 0) {
    verdict = 'Aucun suffrage exprimé. Le scrutin doit être recommencé.';
  } else if (etat.tour === 1) {
    const premier = resultats[0];
    const exAequo = resultats.filter(r => r.voix === premier.voix);

    if (premier.voix >= majoriteAbsolue && exAequo.length === 1) {
      elu = premier;
      verdict = `Élu au 1er tour à la majorité absolue (${premier.voix}/${exprimes} suffrages exprimés, majorité requise : ${majoriteAbsolue}).`;
    } else {
      besoinSecondTour = true;
      // Au 2nd tour : majorité relative entre les candidats restants
      // On qualifie tous les binômes ayant obtenu au moins une voix
      const avecVoix = resultats.filter(r => r.voix > 0);
      qualifiesTour2 = (avecVoix.length >= 2 ? avecVoix : resultats).map(r => r.id);
      verdict = `Aucun binôme n'atteint la majorité absolue (${majoriteAbsolue} voix requises). Un second tour est nécessaire.`;
    }
  } else {
    // 2nd tour : majorité relative
    const premier = resultats[0];
    const exAequo = resultats.filter(r => r.voix === premier.voix);

    if (exAequo.length === 1) {
      elu = premier;
      verdict = `Élu au 2nd tour à la majorité relative (${premier.voix}/${exprimes} suffrages exprimés).`;
    } else {
      // Départage : le titulaire le plus âgé est élu — ici on ne connaît pas l'âge
      verdict = `Égalité entre ${exAequo.length} binômes (${premier.voix} voix chacun). ` +
                `Conformément à l'usage, le binôme dont le titulaire est le plus âgé est déclaré élu — ` +
                `départage à effectuer par le professeur.`;
      elu = null;
    }
  }

  return {
    tour: etat.tour,
    total,
    blancs,
    nuls,
    exprimes,
    majoriteAbsolue,
    resultats,
    verdict,
    elu,
    besoinSecondTour,
    qualifiesTour2,
    inscrits: etat.presents.size,
    abstentions: Math.max(0, etat.presents.size - total)
  };
}

/* =========================================================
   SNAPSHOTS ENVOYÉS AUX CLIENTS
   ========================================================= */
function snapshotPublic() {
  const listeBinomes = etat.qualifies
    ? etat.binomes.filter(b => etat.qualifies.includes(b.id))
    : etat.binomes;

  return {
    statut: etat.statut,
    tour: etat.tour,
    binomes: listeBinomes,
    nbPresents: etat.presents.size,
    nbVotants: etat.urne.length
  };
}

function snapshotProf() {
  return {
    ...snapshotPublic(),
    tousBinomes: etat.binomes,
    presents: [...etat.presents.values()]
      .map(p => ({ prenom: p.prenom, aVote: p.aVote, connecte: p.socketIds.size > 0 }))
      .sort((a, b) => a.prenom.localeCompare(b.prenom, 'fr')),
    historique: etat.historique
  };
}

function diffuser() {
  io.to('etudiants').emit('etat', snapshotPublic());
  io.to('professeurs').emit('etat', snapshotProf());
}

/* =========================================================
   ROUTES
   ========================================================= */
app.get('/', (req, res) => res.render('accueil'));

app.get('/professeur', (req, res) => {
  res.render('professeur', { code: CODE_PROF });
});

app.get('/etudiant', (req, res) => res.render('etudiant'));

// Écran de projection (résultats affichés devant la classe)
app.get('/ecran', (req, res) => res.render('etudiant', { modeEcran: true }));

/* =========================================================
   SOCKET.IO
   ========================================================= */
io.on('connection', (socket) => {
  socket.data.role = null;
  socket.data.prenomKey = null;

  /* ---------- AUTHENTIFICATION PROFESSEUR ---------- */
  socket.on('prof:auth', (code, ack) => {
    if (code !== CODE_PROF) {
      return ack && ack({ ok: false, message: 'Code incorrect.' });
    }
    socket.data.role = 'prof';
    socket.join('professeurs');
    ack && ack({ ok: true });
    socket.emit('etat', snapshotProf());
  });

  /* ---------- INSCRIPTION ÉTUDIANT ---------- */
  socket.on('etudiant:rejoindre', (prenom, ack) => {
    if (typeof prenom !== 'string' || prenom.trim().length < 2) {
      return ack && ack({ ok: false, message: 'Veuillez saisir un prénom valide (2 caractères minimum).' });
    }
    const propre = prenom.trim().replace(/\s+/g, ' ').slice(0, 40);
    const key = normaliser(propre);

    let entree = etat.presents.get(key);
    if (!entree) {
      entree = { prenom: propre, aVote: false, socketIds: new Set() };
      etat.presents.set(key, entree);
    }
    entree.socketIds.add(socket.id);

    socket.data.role = 'etudiant';
    socket.data.prenomKey = key;
    socket.join('etudiants');

    ack && ack({ ok: true, prenom: propre, aVote: entree.aVote });
    socket.emit('etat', snapshotPublic());
    diffuser();
  });

  /* ---------- VOTE (ANONYME) ---------- */
  socket.on('etudiant:voter', (choix, ack) => {
    if (socket.data.role !== 'etudiant' || !socket.data.prenomKey) {
      return ack && ack({ ok: false, message: 'Vous devez d\'abord vous identifier.' });
    }
    if (etat.statut !== 'ouvert') {
      return ack && ack({ ok: false, message: 'Le scrutin n\'est pas ouvert.' });
    }

    const entree = etat.presents.get(socket.data.prenomKey);
    if (!entree) {
      return ack && ack({ ok: false, message: 'Inscription introuvable.' });
    }
    if (entree.aVote) {
      return ack && ack({ ok: false, message: 'Vous avez déjà voté pour ce tour.' });
    }

    // Validation du choix
    const listeValide = etat.qualifies
      ? etat.binomes.filter(b => etat.qualifies.includes(b.id))
      : etat.binomes;

    let choixFinal;
    if (choix === 'blanc' || choix === 'nul') {
      choixFinal = choix;
    } else if (listeValide.some(b => b.id === choix)) {
      choixFinal = choix;
    } else {
      return ack && ack({ ok: false, message: 'Choix invalide.' });
    }

    // ===== SÉPARATION IDENTITÉ / BULLETIN =====
    // 1) On coche l'émargement (sans le choix)
    entree.aVote = true;
    // 2) On dépose un bulletin anonyme dans l'urne, à une position aléatoire
    const bulletin = { choix: choixFinal };
    const pos = crypto.randomInt(0, etat.urne.length + 1);
    etat.urne.splice(pos, 0, bulletin);
    // ==========================================

    ack && ack({ ok: true });
    diffuser();
  });

  /* ---------- CONTRÔLES PROFESSEUR ---------- */
  socket.on('prof:setBinomes', (lignes, ack) => {
    if (socket.data.role !== 'prof') return;
    if (etat.statut === 'ouvert') {
      return ack && ack({ ok: false, message: 'Impossible de modifier pendant un scrutin ouvert.' });
    }

    const binomes = [];
    (Array.isArray(lignes) ? lignes : []).forEach((l, i) => {
      const t = (l.titulaire || '').trim();
      const s = (l.suppleant || '').trim();
      if (t) {
        binomes.push({
          id: 'b' + (i + 1) + '-' + crypto.randomBytes(3).toString('hex'),
          titulaire: t,
          suppleant: s || '—'
        });
      }
    });

    if (binomes.length === 0) {
      return ack && ack({ ok: false, message: 'Saisissez au moins un binôme.' });
    }

    etat.binomes = binomes;
    etat.qualifies = null;
    ack && ack({ ok: true, nb: binomes.length });
    diffuser();
  });

  socket.on('prof:ouvrir', (_, ack) => {
    if (socket.data.role !== 'prof') return;
    if (etat.binomes.length === 0) {
      return ack && ack({ ok: false, message: 'Aucun binôme enregistré.' });
    }
    etat.statut = 'ouvert';
    etat.urne = [];
    etat.presents.forEach(p => { p.aVote = false; });
    ack && ack({ ok: true });
    io.emit('scrutin:ouvert', { tour: etat.tour });
    diffuser();
  });

  socket.on('prof:fermer', (_, ack) => {
    if (socket.data.role !== 'prof') return;
    if (etat.statut !== 'ouvert') {
      return ack && ack({ ok: false, message: 'Aucun scrutin ouvert.' });
    }

    etat.statut = 'depouille';
    const resultat = depouiller();

    const presentsListe = [...etat.presents.values()]
      .map(p => p.prenom)
      .sort((a, b) => a.localeCompare(b, 'fr'));

    etat.historique.push({
      tour: resultat.tour,
      verdict: resultat.verdict,
      resultats: resultat.resultats.map(r => ({ ...r }))
    });

    // Mémorise les qualifiés pour un éventuel 2nd tour
    if (resultat.besoinSecondTour) {
      etat.qualifies = resultat.qualifiesTour2;
    }

    ack && ack({ ok: true });
    io.emit('resultats', { resultat, presents: presentsListe });
    diffuser();
  });

  socket.on('prof:secondTour', (_, ack) => {
    if (socket.data.role !== 'prof') return;
    etat.tour = 2;
    etat.statut = 'ferme';
    etat.urne = [];
    etat.presents.forEach(p => { p.aVote = false; });
    ack && ack({ ok: true });
    io.emit('scrutin:reset', { tour: etat.tour });
    diffuser();
  });

  socket.on('prof:reinitialiser', (options, ack) => {
    if (socket.data.role !== 'prof') return;
    const toutEffacer = options && options.tout;

    etat.statut = 'ferme';
    etat.tour = 1;
    etat.urne = [];
    etat.qualifies = null;
    etat.historique = [];
    etat.presents.forEach(p => { p.aVote = false; });

    if (toutEffacer) {
      etat.binomes = [];
      etat.presents.clear();
    }

    ack && ack({ ok: true });
    io.emit('scrutin:reset', { tour: etat.tour });
    diffuser();
  });

  socket.on('prof:retirerPresent', (prenom, ack) => {
    if (socket.data.role !== 'prof') return;
    const key = normaliser(prenom || '');
    const entree = etat.presents.get(key);
    if (entree) {
      entree.socketIds.forEach(sid => {
        const s = io.sockets.sockets.get(sid);
        if (s) s.emit('expulse');
      });
      etat.presents.delete(key);
    }
    ack && ack({ ok: true });
    diffuser();
  });

  /* ---------- DÉCONNEXION ---------- */
  socket.on('disconnect', () => {
    if (socket.data.role === 'etudiant' && socket.data.prenomKey) {
      const entree = etat.presents.get(socket.data.prenomKey);
      if (entree) {
        entree.socketIds.delete(socket.id);
        // On NE retire PAS l'étudiant de la liste des présents :
        // sa présence est actée, et son bulletin reste dans l'urne.
      }
      diffuser();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Serveur de vote démarré sur le port ${PORT}`);
  console.log(`Code professeur : ${CODE_PROF}`);
});
