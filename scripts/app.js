/* ==========================================================================
   app.js — estado global da aplicação + orquestração de eventos
   Baseado na arquitetura do Claude (App object) com abas do Z.ai (4 views)
   e suporte ao campo status.
   ========================================================================== */

const App = {
  animes: [],
  currentSeasonCode: null,   // temporada mais recente → aba "Atual"
  historicoSeasonCode: null, // temporada selecionada na aba "Histórico"
  statsYearFilter: 'all',
  statsSeasonFilter: 'all',
  activeView: 'dashboard',
  editingId: null,
  pendingCoverDataUrl: null,
  _detailAnime: null,

  async init() {
    this.animes = await Store.load();
    this.recomputeSeasons();
    this.bindTopbar();
    this.bindDashboard();
    this.bindDetailModal();
    this.bindFormModal();
    this.bindStatsFilters();
    this.renderAll();
  },

  bindStatsFilters() {
    document.getElementById('stats-year-filter').addEventListener('change', e => {
      this.statsYearFilter = e.target.value;
      this.renderStats();
    });
    document.getElementById('stats-season-filter').addEventListener('change', e => {
      this.statsSeasonFilter = e.target.value;
      this.renderStats();
    });
  },

  recomputeSeasons() {
    this.animes.forEach(a => { a.seasons = computeSeasons(a.startSeason, a.episodes); });
    const all = Array.from(new Set(this.animes.flatMap(a => a.seasons))).sort();
    this.allSeasons = all;
    this.currentSeasonCode = all[all.length - 1] || null;
    if (!this.historicoSeasonCode || !all.includes(this.historicoSeasonCode)) {
      this.historicoSeasonCode = this.currentSeasonCode;
    }
  },

  persist() {
    Store.save(this.animes);
  },

  animesInSeason(code) {
    return this.animes.filter(a => a.seasons.some(s => s.startsWith(code)));
  },

  /* ---------------------------------------------------------------- render */

  renderAll() {
    // Atualiza o tema sazonal no body
    const seasonCode = (this.activeView === 'atual'
      ? this.currentSeasonCode
      : this.activeView === 'historico'
        ? this.historicoSeasonCode
        : this.currentSeasonCode);
    document.body.dataset.season = seasonCode?.split('-')[1] || '02';

    // Sub-título de contagem
    document.getElementById('brand-sub').textContent =
      `${this.animes.length} título${this.animes.length !== 1 ? 's' : ''} rastreado${this.animes.length !== 1 ? 's' : ''}`;

    // Renderiza apenas a aba ativa (+ dashboard que serve o topbar)
    this.renderDashboard();
    if (this.activeView === 'atual')     this.renderAtual();
    if (this.activeView === 'historico') this.renderHistorico();
    if (this.activeView === 'stats')     this.renderStats();
  },

  renderDashboard() {
    const dashboardAnimes = this.currentSeasonCode ? this.animesInSeason(this.currentSeasonCode) : [];
    UI.renderDashboard(dashboardAnimes, {
      onOpen: (id) => {
        const anime = this.animes.find(a => a.id === id);
        if (anime) this.openDetail(anime);
      }
    });
  },

  renderAtual() {
    const label = this.currentSeasonCode ? seasonLabel(this.currentSeasonCode) : 'Sem dados';
    document.getElementById('atual-season-label').textContent = label;
    let items = this.currentSeasonCode ? this.animesInSeason(this.currentSeasonCode) : [];
    items = items.filter(a => a.status === 'watching');
    document.getElementById('atual-meta').textContent = this.currentSeasonCode
      ? `${items.length} no ar`
      : '';
    UI.renderBroadcastGrid(document.getElementById('broadcast-grid'), items, {
      onOpen: (anime) => this.openDetail(anime),
      onMarkNext: (anime) => this.markNextEpisode(anime)
    });
  },

  renderHistorico() {
    UI.renderSeasonPicker(document.getElementById('season-picker'), this.allSeasons, this.historicoSeasonCode, (code) => {
      this.historicoSeasonCode = code;
      this.renderAll();
    });
    let items;
    let labelText = '';
    if (this.historicoSeasonCode === 'all') {
      items = this.animes;
      labelText = 'Todos os Animes';
    } else {
      items = this.historicoSeasonCode ? this.animesInSeason(this.historicoSeasonCode) : [];
      labelText = this.historicoSeasonCode ? seasonLabel(this.historicoSeasonCode) : '';
    }
    document.getElementById('historico-meta').textContent = this.historicoSeasonCode
      ? `${labelText} · ${items.length} título${items.length !== 1 ? 's' : ''}`
      : '';
    UI.renderPosterGrid(document.getElementById('poster-grid'), items, {
      onOpen: (anime) => this.openDetail(anime)
    });
  },

  renderStats() {
    const yearSelect = document.getElementById('stats-year-filter');
    const years = [...new Set(this.allSeasons.map(s => s.split('-')[0]))].sort((a,b) => b - a);
    
    const currentVal = yearSelect.value;
    yearSelect.innerHTML = '<option value="all">Todos os Anos</option>';
    years.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      yearSelect.appendChild(opt);
    });
    yearSelect.value = years.includes(currentVal) ? currentVal : 'all';
    this.statsYearFilter = yearSelect.value;

    let filteredAnimes = this.animes;
    
    if (this.statsYearFilter !== 'all' || this.statsSeasonFilter !== 'all') {
       filteredAnimes = filteredAnimes.filter(a => {
         return a.seasons.some(s => {
           const [y, seasonCode] = s.split('-');
           const matchYear = this.statsYearFilter === 'all' || y === this.statsYearFilter;
           const matchSeason = this.statsSeasonFilter === 'all' || seasonCode === this.statsSeasonFilter;
           return matchYear && matchSeason;
         });
       });
    }

    UI.renderStats(filteredAnimes);
  },

  /* ---------------------------------------------------------------- actions */

  markNextEpisode(anime) {
    const next = findNextUnwatched(anime);
    if (!next) return;
    anime.watched.push(next);
    anime.watched.sort((a, b) => a - b);
    // Auto-completa status
    if (anime.watched.length >= anime.episodes) anime.status = 'completed';
    this.persist();
    this.renderAll();
    UI.toast(`Ep. ${next} de "${anime.title}" marcado ✓`);
  },

  /* ---------------------------------------------------------------- topbar */

  bindTopbar() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeView = btn.dataset.view;
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${this.activeView}`).classList.add('active');
        // Renderiza somente a aba que foi selecionada
        this.renderAll();
      });
    });

    document.getElementById('btn-add').addEventListener('click', () => this.openForm(null));

    document.getElementById('btn-export').addEventListener('click', () => {
      Store.exportToFile(this.animes);
      UI.toast('JSON exportado com sucesso', 'success');
    });

    const importInput = document.getElementById('import-input');
    document.getElementById('btn-import').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async () => {
      const file = importInput.files[0];
      if (!file) return;
      const ok = confirm('Importar vai substituir todos os dados atuais. Continuar?');
      if (!ok) { importInput.value = ''; return; }
      try {
        this.animes = await Store.importFromFile(file);
        this.historicoSeasonCode = null;
        this.recomputeSeasons();
        this.renderAll();
        UI.toast(`${this.animes.length} animes importados!`, 'success');
      } catch (e) {
        UI.toast('Erro ao importar: ' + e.message, 'error');
      }
      importInput.value = '';
    });
  },

  /* ---------------------------------------------------------------- dashboard events */

  bindDashboard() {
    // Event delegation é gerenciado em UI.renderDashboard() via _bindDashItemDelegation()
  /* ---------------------------------------------------------------- modal detalhe */

  bindDetailModal() {
    const modal = document.getElementById('detail-modal');
    document.getElementById('detail-close').addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', e => { 
      if (e.target === modal) modal.classList.remove('open'); 
    });

    // Focus trap no modal de detalhe
    modal.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )).filter(el => !el.disabled && el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    document.getElementById('ep-mark-all').addEventListener('click', () => {
      const anime = this._detailAnime;
      anime.watched = Array.from({ length: anime.episodes }, (_, i) => i + 1);
      anime.status = 'completed';
      this.persist();
      this.renderEpGrid(anime);
      this.updateDetailStatus(anime);
      this.renderAll();
    });

    document.getElementById('ep-clear-all').addEventListener('click', () => {
      const anime = this._detailAnime;
      anime.watched = [];
      if (anime.status === 'completed') anime.status = 'watching';
      this.persist();
      this.renderEpGrid(anime);
      this.updateDetailStatus(anime);
      this.renderAll();
    });

    // Botão de status no modal de detalhe
    document.getElementById('detail-status-select').addEventListener('change', e => {
      const anime = this._detailAnime;
      anime.status = e.target.value;
      this.persist();
      this.renderAll();
    });

    document.getElementById('detail-edit').addEventListener('click', () => {
      const anime = this._detailAnime;
      modal.classList.remove('open');
      this.openForm(anime);
    });

    document.getElementById('detail-delete').addEventListener('click', () => {
      const anime = this._detailAnime;
      if (!confirm(`Excluir "${anime.title}"? Ação irreversível.`)) return;
      this.animes = this.animes.filter(a => a.id !== anime.id);
      this.persist();
      this.recomputeSeasons();
      this.renderAll();
      modal.classList.remove('open');
      UI.toast('Anime removido', 'warning');
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        document.getElementById('detail-modal').classList.remove('open');
        document.getElementById('form-modal').classList.remove('open');
      }
    });
  },

  openDetail(anime) {
    this._detailAnime = anime;
    const { done, total, pct } = UI.progressOf(anime);

    document.getElementById('detail-cover').style.opacity = 1;
    document.getElementById('detail-cover').src = anime.cover || '';
    document.getElementById('detail-cover').onerror = function() { this.style.opacity = 0; };
    document.getElementById('detail-day-time').textContent = `${capitalize(anime.day)} · ${anime.time}`;
    document.getElementById('detail-title').textContent = anime.title;
    document.getElementById('detail-ep-count').textContent = anime.episodes;
    document.getElementById('detail-start-season').textContent = seasonLabel(anime.startSeason);
    document.getElementById('detail-progress-fill').style.width = pct + '%';
    document.getElementById('detail-progress-pct').textContent = `${done}/${total} · ${pct}%`;

    // Status select
    const statusSel = document.getElementById('detail-status-select');
    statusSel.value = anime.status || 'watching';

    const link = document.getElementById('detail-link');
    if (anime.link) { link.href = anime.link; link.style.display = ''; }
    else { link.style.display = 'none'; }

    const tagsEl = document.getElementById('detail-tags');
    tagsEl.innerHTML = '';
    (anime.tags || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = t;
      tagsEl.appendChild(chip);
    });

    this.renderEpGrid(anime);
    document.getElementById('detail-modal').classList.add('open');
  },

  updateDetailStatus(anime) {
    document.getElementById('detail-status-select').value = anime.status || 'watching';
  },

  renderEpGrid(anime) {
    const grid = document.getElementById('ep-grid');
    grid.innerHTML = '';
    for (let ep = 1; ep <= anime.episodes; ep++) {
      const box = document.createElement('div');
      box.className = 'ep-box' + (anime.watched.includes(ep) ? ' watched' : '');
      box.textContent = ep;
      box.title = anime.watched.includes(ep) ? `Ep. ${ep} — assistido` : `Ep. ${ep} — pendente`;
      box.addEventListener('click', () => {
        if (anime.watched.includes(ep)) {
          anime.watched = anime.watched.filter(x => x !== ep);
          if (anime.status === 'completed') anime.status = 'watching';
        } else {
          anime.watched.push(ep);
          anime.watched.sort((a, b) => a - b);
          if (anime.watched.length >= anime.episodes) anime.status = 'completed';
        }
        this.persist();
        this.renderEpGrid(anime);
        this.updateDetailStatus(anime);
        this.renderAll();
      });
      grid.appendChild(box);
    }
  },

  /* ---------------------------------------------------------------- modal formulário */

  bindFormModal() {
    const modal = document.getElementById('form-modal');
    document.getElementById('form-close').addEventListener('click', () => modal.classList.remove('open'));
    document.getElementById('form-cancel').addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', e => { 
      if (e.target === modal) modal.classList.remove('open'); 
    });

    // Focus trap no modal de formulário
    modal.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )).filter(el => !el.disabled && el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    // Preview ao vivo da URL da capa
    document.getElementById('f-cover-url').addEventListener('input', e => {
      this.pendingCoverDataUrl = null;
      const preview = document.getElementById('f-cover-preview');
      preview.src = e.target.value;
      preview.style.opacity = e.target.value ? '1' : '0';
    });

    // Upload de arquivo → Base64 redimensionado
    document.getElementById('f-cover-file').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const dataUrl = await fileToResizedDataUrl(file);
      this.pendingCoverDataUrl = dataUrl;
      const preview = document.getElementById('f-cover-preview');
      preview.src = dataUrl;
      preview.style.opacity = '1';
      document.getElementById('f-cover-url').value = '';
    });

    document.getElementById('anime-form').addEventListener('submit', e => {
      e.preventDefault();
      this.submitForm();
    });
  },

  populateSeasonSelect() {
    const sel = document.getElementById('f-start-season');
    sel.innerHTML = '';
    const now = new Date();
    const curYear = now.getFullYear();
    for (let year = curYear - 3; year <= curYear + 1; year++) {
      for (let s = 1; s <= 4; s++) {
        const code = `${year}-${String(s).padStart(2, '0')}`;
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = seasonLabel(code);
        sel.appendChild(opt);
      }
    }
  },

  openForm(anime) {
    this.editingId = anime ? anime.id : null;
    this.pendingCoverDataUrl = null;

    document.getElementById('form-title').textContent = anime ? 'Editar anime' : 'Adicionar anime';
    document.getElementById('form-hint').textContent = anime
      ? 'Os episódios já assistidos são preservados ao editar.'
      : 'Depois de salvar, marque os episódios assistidos no card do anime.';

    document.getElementById('f-title').value = anime?.title || '';
    const coverUrl = anime?.cover?.startsWith('data:') ? '' : (anime?.cover || '');
    document.getElementById('f-cover-url').value = coverUrl;
    const preview = document.getElementById('f-cover-preview');
    preview.src = anime?.cover || '';
    preview.style.opacity = anime?.cover ? '1' : '0';
    document.getElementById('f-episodes').value = anime?.episodes || 12;
    document.getElementById('f-watched-count').value = anime?.watched?.length || 0;
    document.getElementById('f-day').value = anime?.day || 'domingo';
    document.getElementById('f-time').value = anime?.time || '12:00';
    document.getElementById('f-link').value = anime?.link || '';
    document.getElementById('f-tags').value = anime?.tags || '';
    document.getElementById('f-status').value = anime?.status || 'watching';

    const defaultSeason = anime?.startSeason || this.currentSeasonCode || `${new Date().getFullYear()}-02`;
    const [defYear, defSeason] = defaultSeason.split('-');
    document.getElementById('f-start-year').value = defYear;
    document.getElementById('f-start-season-only').value = defSeason;

    document.getElementById('form-modal').classList.add('open');
    document.getElementById('f-title').focus();
  },

  submitForm() {
    const title = document.getElementById('f-title').value.trim();
    if (!title) { UI.toast('Dê um nome ao anime antes de salvar', 'error'); return; }

    const cover = this.pendingCoverDataUrl || document.getElementById('f-cover-url').value.trim();
    const episodesCount = Math.max(1, parseInt(document.getElementById('f-episodes').value, 10) || 12);
    let watchedCount = parseInt(document.getElementById('f-watched-count').value, 10) || 0;
    watchedCount = Math.max(0, Math.min(watchedCount, episodesCount));
    
    const year = document.getElementById('f-start-year').value;
    const season = document.getElementById('f-start-season-only').value;

    const payload = {
      title,
      cover,
      episodes: episodesCount,
      startSeason: `${year}-${season}`,
      day: document.getElementById('f-day').value,
      time: document.getElementById('f-time').value,
      link: document.getElementById('f-link').value.trim(),
      tags: document.getElementById('f-tags').value.trim(),
      status: document.getElementById('f-status').value
    };

    if (this.editingId) {
      const anime = this.animes.find(a => a.id === this.editingId);
      Object.assign(anime, payload);
      if (anime.watched.length !== watchedCount) {
        anime.watched = Array.from({length: watchedCount}, (_, i) => i + 1);
      }
      anime.watched = anime.watched.filter(ep => ep <= anime.episodes);
      anime.seasons = computeSeasons(anime.startSeason, anime.episodes);
    } else {
      payload.id = crypto.randomUUID ? crypto.randomUUID() : 'a' + Math.random().toString(36).slice(2);
      payload.watched = Array.from({length: watchedCount}, (_, i) => i + 1);
      payload.seasons = computeSeasons(payload.startSeason, payload.episodes);
      this.animes.push(payload);
    }

    this.persist();
    this.recomputeSeasons();
    this.renderAll();
    
    document.getElementById('form-modal').classList.remove('open');
    UI.toast(this.editingId ? 'Anime atualizado' : 'Anime adicionado', 'success');
  }
};

window.addEventListener('DOMContentLoaded', () => App.init());
