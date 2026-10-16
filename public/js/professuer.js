const socket = io();

const ecranAuth = document.getElementById('ecranAuth');
const ecranProf = document.getElementById('ecranProf');
const lignesBinomes = document.getElementById('lignesBinomes');

/* ---------- Authentification ---------- */
document.getElementById('btnAuth').addEventListener('click', () => {
  const code = document.getElementById('codeProf').value;
  socket.emit('prof:auth', code, (rep) => {
    const err = document.getElementById('authErreur');
    if (!rep.ok) {
      err.textContent = rep.message;
      err.classList.remove('d-none');
      return;
    }
    sessionStorage.setItem('codeProf', code);
    ecranAuth.classList.add('d-none');
    ecranProf.classList.remove('d-none');
    if (lignesBinomes.children.length === 0) {
      for (let i = 0; i < 3; i++) ajouterLigne();
    }
  });
});

document.getElementById('codeProf').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btnAuth').click();
});

// Reconnexion automatique
const codeSauve = sessionStorage.getItem('codeProf');
if (codeSauve) {
  document.getElementById('codeProf').value = codeSauve;
  document.getElementById('btnAuth').click();
}

/* ---------- Saisie des binômes ---------- */
function ajouterLigne(titulaire = '', suppleant = '') {
  const idx = lignesBinomes.children.length + 1;
  const div = document.createElement('div');
  div.className = 'row g-2 mb-2 ligne-binome align-items-center';
  div.innerHTML = `
    <div class="col-auto">
      <span class="badge bg-primary rounded-pill">${idx}</span>
    </div>
    <div class="col">
      <input type="text" class="form-control form-control-sm inp-titulaire"
             placeholder="Titulaire" value="${titulaire.replace(/"/g, '&quot;')}">
    </div>
    <div class="col">
      <input type="text" class="form-control form-control-sm inp-suppleant"
             placeholder="Suppléant·e" value="${suppleant.replace(/"/g, '&quot;')}">
    </div>
    <div class="col-auto">
      <button class="btn btn-sm btn-outline-danger btn-suppr" title="Supprimer">×</button>
    </div>`;
  div.querySelector('.btn-suppr').addEventListener('click', () => {
    div.remove();
    renumeroter();
  });
  lignesBinomes.appendChild(div);
}

function renumeroter() {
  [...lignesBinomes.children].forEach((l, i) => {
    l.querySelector('.badge').textContent = i + 1;
  });
}

document.getElementById('btnAjouterLigne').addEventListener('click', () =>
