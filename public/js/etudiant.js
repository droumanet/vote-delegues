const socket = io();

const MODE_ECRAN = window.MODE_ECRAN === true;

// Références DOM
const ecranIdentite   = document.getElementById('ecranIdentite');
const ecranVote       = document.getElementById('ecranVote');
const ecranResultats  = document.getElementById('ecranResultats');
const blocAttente     = document.getElementById('blocAttente');
const blocBulletin    = document.getElementById('blocBulletin');
const blocAVote       = document.getElementById('blocAVote');
const listeChoix      = document.getElementById('listeChoix');
const btnValiderVote  = document.getElementById('btnValiderVote');
const erreurVote      = document.getElementById('erreurVote');

let monPrenom = null;
let aVote = false;
let choixSelectionne = null;
let dernierEtat = null;

/* ---------- Utilitaires ---------- */
function montrer(el)  { el && el.classList.remove('d-none'); }
function cacher(el)   { el && el.classList.add('d-none'); }

function afficherErreur(el, message) {
  if (!el) return;
  el.textContent = message;
  montrer(el);
  setTimeout(() => cacher(el), 5000);
}

function majBadgeStatut(statut) {
  const badge = document.getElementById('badgeStatutEtu');
  if (!badge) return;
  const styles = {
    ferme:     ['bg-secondary', 'Scrutin fermé'],
    ouvert:    ['bg-success',   'Scrutin ouvert'],
    depouille: ['bg-info',      'Dépouillé']
  };
  const [cls, txt] = styles[statut] || ['bg-secondary', '—'];
  badge.className = 'badge fs-6 ' + cls;
  badge.textContent = txt;
}

/* ---------- Émargement ---------- */
const prenomSauvegarde = sessionStorage.getItem('prenomVote');

if (MODE_ECRAN) {
  // L'écran de projection ne vote pas : il se contente d'afficher
  cacher(ecranIdentite);
  montrer(ecranVote);
  cacher(blocBulletin);
  montrer(blocAttente);
  const h = document.getElementById('monPrenom');
  if (h) h.textContent = 'Écran de projection';
} else if (prenomSauvegarde) {
  rejoindre(prenomSauvegarde);
} else {
  montrer(ecranIdentite);
}

function rejoindre(prenom) {
  socket.emit('etudiant:rejoindre', prenom, (rep) => {
    if (!rep.ok) {
      montrer(ecranIdentite);
      afficherErreur(document.getElementById('erreurIdentite'), rep.message);
      sessionStorage.removeItem('prenomVote');
      return;
    }
    monPrenom = rep.prenom;
    aVote = rep.aVote;
    sessionStorage.setItem('prenomVote', rep.prenom);
    document.getElementById('monPrenom').textContent = rep.prenom;
    cacher(ecranIdentite);
    montrer(ecranVote);
    if (dernierEtat) rendreEtat(dernierEtat);
  });
}

const btnRejoindre = document.getElementById('btnRejoindre');
if (btnRejoindre) {
  btnRejoindre.addEventListener('click', () => {
    const v = document.getElementById('prenomInput').value;
    rejoindre(v);
  });
  document.getElementById('prenomInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnRejoindre.click();
  });
}

/* ---------- Rendu du bulletin ---------- */
function rendreBulletin(binomes) {
  listeChoix.innerHTML = '';
  binomes.forEach((b, i) => {
    const col = document.createElement('div');
    col.className = 'col-md-6';
    col.innerHTML = `
      <div class="card choix-card h-100" data-choix="${b.id}">
        <div class="card-body">
          <div class="d-flex align-items-center gap-3">
            <span class="badge bg-primary rounded-pill fs-6">${i + 1}</span>
            <div>
              <div class="fw-bold">${echapper(b.titulaire)}</div>
              <small class="text-muted">Titulaire</small>
              <div class="fw-semibold mt-1">${echapper(b.suppleant)}</div>
              <small class="text-muted">Suppléant·e</small>
            </div>
          </div>
        </div>
      </div>`;
    listeChoix.appendChild(col);
  });
  brancherCartes();
}

function brancherCartes() {
  document.querySelectorAll('.choix-card').forEach(card => {
    card.onclick = () => {
      document.querySelectorAll('.choix-card').forEach(c => c.classList.remove('selectionne'));
      card.classList.add('selectionne');
      choixSelectionne = card.dataset.choix;
      btnValiderVote.disabled = false;
    };
  });
}

function echapper(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

/* ---------- Validation du vote ---------- */
if (btnValiderVote) {
  btnValiderVote.addEventListener('click', () => {
    if (!choixSelectionne) return;
    btnValiderVote.disabled = true;
    socket.emit('etudiant:voter', choixSelectionne, (rep) => {
      if (!rep.ok) {
        afficherErreur(erreurVote, rep.message);
        btnValiderVote.disabled = false;
        return;
      }
      aVote = true;
      choixSelectionne = null;
      cacher(blocBulletin);
      montrer(blocAVote);
    });
  });
}

/* ---------- Synchronisation d'état ---------- */
function rendreEtat(etat) {
  dernierEtat = etat;
  const tourEl = document.getElementById('numTourEtu');
  if (tourEl) tourEl.textContent = etat.tour;
  majBadgeStatut(etat.statut);

  // Participation
  const nbV = document.getElementById('nbVotants');
  const nbP = document.getElementById('nbPresents');
  const barre = document.getElementById('barreParticipation');
  if (nbV) nbV.textContent = etat.nbVotants;
  if (nbP) nbP.textContent = etat.nbPresents;
  if (barre) {
    const pct = etat.nbPresents > 0 ? (etat.nbVotants / etat.nbPresents) * 100 : 0;
    barre.style.width = pct.toFixed(1) + '%';
  }

  if (MODE_ECRAN) return;
  if (!monPrenom) return;

  if (etat.statut === 'ouvert') {
    cacher(ecranResultats);
    montrer(ecranVote);
    cacher(blocAttente);
    if (aVote) {
      cacher(blocBulletin);
      montrer(blocAVote);
    } else {
      cacher(blocAVote);
      montrer(blocBulletin);
      rendreBulletin(etat.binomes);
      btnValiderVote.disabled = true;
    }
  } else if (etat.statut === 'ferme') {
    cacher(blocBulletin);
    cacher(blocAVote);
    montrer(blocAttente);
  }
}

socket.on('etat', rendreEtat);

socket.on('scrutin:ouvert', () => {
  aVote = false;
  choixSelectionne = null;
  cacher(ecranResultats);
  montrer(ecranVote);
});

socket.on('scrutin:reset', () => {
  aVote = false;
  choixSelectionne = null;
  cacher(ecranResultats);
  montrer(ecranVote);
  cacher(blocAVote);
  montrer(blocAttente);
});

socket.on('expulse', () => {
  sessionStorage.removeItem('prenomVote');
  location.reload();
});

/* ---------- Affichage des résultats ---------- */
socket.on('resultats', ({ resultat, presents }) => {
  cacher(ecranVote);
  cacher(ecranIdentite);
  montrer(ecranResultats);

  document.getElementById('resTour').textContent = resultat.tour;

  // Verdict
  const verdict = document.getElementById('verdict');
  verdict.textContent = resultat.verdict;
  verdict.className = 'alert text-center fs-5 ' +
    (resultat.elu ? 'alert-success' : 'alert-warning');

  // Binôme élu
  const blocElu = document.getElementById('blocElu');
  if (resultat.elu) {
    document.getElementById('eluTitulaire').textContent = resultat.elu.titulaire;
    document.getElementById('eluSuppleant').textContent = resultat.elu.suppleant;
    montrer(blocElu);
  } else {
    cacher(blocElu);
  }

  // Chiffres clés
  const chiffres = [
    ['Inscrits (présents)', resultat.inscrits, 'text-dark'],
    ['Votants',             resultat.total,    'text-primary'],
    ['Blancs',              resultat.blancs,   'text-secondary'],
    ['Nuls',                resultat.nuls,     'text-danger'],
    ['Suffrages exprimés',  resultat.exprimes, 'text-success'],
    ['Majorité absolue',    resultat.majoriteAbsolue, 'text-warning']
  ];
  document.getElementById('chiffresCles').innerHTML = chiffres.map(([label, val, cls]) => `
    <div class="col-6 col-md-4 col-lg-2">
      <div class="card text-center shadow-sm h-100">
        <div class="card-body py-3">
          <div class="fs-3 fw-bold ${cls}">${val}</div>
          <div class="small text-muted">${label}</div>
        </div>
      </div>
    </div>`).join('');

  // Tableau détaillé
  document.getElementById('tableResultats').innerHTML = resultat.resultats.map((r, i) => `
    <tr class="${i === 0 && r.voix > 0 ? 'table-success' : ''}">
      <td>
        <strong>${echapper(r.titulaire)}</strong>
        <span class="text-muted">/ ${echapper(r.suppleant)}</span>
      </td>
      <td class="text-end fw-bold fs-5">${r.voix}</td>
      <td>
        <div class="d-flex align-items-center gap-2">
          <div class="progress flex-grow-1" style="height:8px">
            <div class="progress-bar ${i === 0 ? 'bg-success' : 'bg-primary'}"
                 style="width:${r.pourcentage.toFixed(1)}%"></div>
          </div>
          <small class="text-muted" style="width:50px">${r.pourcentage.toFixed(1)}%</small>
        </div>
      </td>
    </tr>`).join('');

  // Liste des présents (sans lien avec les votes)
  document.getElementById('resNbPresents').textContent = presents.length;
  document.getElementById('listePresents').innerHTML = presents
    .map(p => `<span class="badge bg-light text-dark border fs-6 fw-normal">${echapper(p)}</span>`)
    .join('');
});
