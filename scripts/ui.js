/* ==========================================================================
   ui.js — renderização pura
   Recebe dados + callbacks, popula o DOM. Estado em app.js.
   Combina grade semanal do Claude + dashboard/stats do Z.ai.
   ========================================================================== */

const STATUS_LABELS = {
  watching: 'Assistindo',
  completed: 'Finalizado',
  paused: 'Pausado',
  dropped: 'Dropado'
};

const STATUS_CLASS = {
  watching: 'status-watching',
  completed: 'status-completed',
  paused: 'status-paused',
  dropped: 'status-dropped'
};

const UI = {

  /* ------------------------------------------------------------------
     Toast — tipado com ícone (do Z.ai)
  ------------------------------------------------------------------ */
  toast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    el.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span class="toast-msg">${msg}</span>`;
    container.appendChild(el);
    // Entrada
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
    }, 3000);
  },

  progressOf(anime) {
    const total = anime.episodes || 0;
    const done = anime.watched.filter(e => e <= total).length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  },

  /* ------------------------------------------------------------------
     Dashboard (Z.ai) — métricas + listas "Hoje" e "Próximos"
  ------------------------------------------------------------------ */
  renderDashboard(animes, callbacks = {}) {
    const watching = animes.filter(a => a.status === 'watching');
    const completed = animes.filter(a => a.status === 'completed');
    let totalWatched = 0, totalPending = 0;
    animes.forEach(a => {
      totalWatched += a.watched.length;
      totalPending += Math.max(0, a.episodes - a.watched.length);
    });

    document.getElementById('stat-watching').textContent = watching.length;
    document.getElementById('stat-watched').textContent = totalWatched;
    document.getElementById('stat-pending').textContent = totalPending;
    document.getElementById('stat-completed').textContent = completed.length;

    // "Lançamentos de Hoje"
    const todayIdx = new Date().getDay(); // 0=Dom, 1=Seg...
    const todayKey = Object.keys(DAY_ORDER).find(k => DAY_ORDER[k] === todayIdx) || 'domingo';
    const todayAnimes = watching.filter(a => a.day === todayKey);

    const todayEl = document.getElementById('today-list');
    const todayBadge = document.getElementById('today-badge');
    todayBadge.textContent = todayAnimes.length;
    if (todayAnimes.length === 0) {
      todayEl.innerHTML = '<p class="list-empty">Nenhum lançamento hoje 🎉</p>';
    } else {
      todayEl.innerHTML = todayAnimes.map(a => {
        const next = findNextUnwatched(a);
        const { done, total } = this.progressOf(a);
        const safeCover = safeSrc(a.cover || '');
        const safeTime  = escapeHtml(a.time);
        const safeTitle = escapeHtml(a.title);
        const safeId    = escapeHtml(a.id);
        return `
          <div class="dash-item" data-id="${safeId}">
            <img class="dash-item-thumb" src="${safeCover}" alt="Capa de ${safeTitle}" onerror="this.style.opacity=0" loading="lazy">
            <div class="dash-item-info">
              <div class="dash-item-title">${safeTitle}</div>
              <div class="dash-item-sub">${next ? `Ep. ${next} disponível` : 'Completo'} · ${done}/${total} eps</div>
            </div>
            <div class="dash-item-time">${safeTime}</div>
          </div>
        `;
      }).join('');
    }

    // "Próximos Episódios" — top 5, ordenados por dia mais próximo
    const today = new Date().getDay();
    const upcoming = watching
      .filter(a => a.watched.length < a.episodes)
      .sort((a, b) => {
        const dA = DAY_ORDER[a.day] ?? 7;
        const dB = DAY_ORDER[b.day] ?? 7;
        const diffA = (dA - today + 7) % 7 || 7;
        const diffB = (dB - today + 7) % 7 || 7;
        return diffA !== diffB ? diffA - diffB : a.time.localeCompare(b.time);
      })
      .slice(0, 6);

    const upcomingEl = document.getElementById('upcoming-list');
    if (upcoming.length === 0) {
      upcomingEl.innerHTML = '<p class="list-empty">Adicione animes para ver aqui</p>';
    } else {
      upcomingEl.innerHTML = upcoming.map(a => {
        const next = findNextUnwatched(a);
        const daysShort = { 'domingo': 'Dom', 'segunda-feira': 'Seg', 'terça-feira': 'Ter',
          'quarta-feira': 'Qua', 'quinta-feira': 'Qui', 'sexta-feira': 'Sex', 'sábado': 'Sáb' };
        const dayAbbr   = escapeHtml(daysShort[a.day] || a.day);
        const safeCover = safeSrc(a.cover || '');
        const safeTime  = escapeHtml(a.time);
        const safeTitle = escapeHtml(a.title);
        const safeId    = escapeHtml(a.id);
        return `
          <div class="dash-item" data-id="${safeId}">
            <img class="dash-item-thumb" src="${safeCover}" alt="Capa de ${safeTitle}" onerror="this.style.opacity=0" loading="lazy">
            <div class="dash-item-info">
              <div class="dash-item-title">${safeTitle}</div>
              <div class="dash-item-sub">Próximo: Ep. ${next}</div>
            </div>
            <div class="dash-item-time">${dayAbbr} ${safeTime}</div>
          </div>
        `;
      }).join('');
    }

    // Configura event delegation — um único listener por container
    this._bindDashItemDelegation('today-list', callbacks);
    this._bindDashItemDelegation('upcoming-list', callbacks);
  },

  /** Substitui listeners por item por um único listener delegado no container. */
  _bindDashItemDelegation(containerId, callbacks) {
    const el = document.getElementById(containerId);
    // Remove listener anterior clonando o nó
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
    clone.addEventListener('click', e => {
      const item = e.target.closest('.dash-item[data-id]');
      if (item && callbacks?.onOpen) callbacks.onOpen(item.dataset.id);
    });
  },

  /* ------------------------------------------------------------------
     Grade de transmissão semanal (Claude) — 7 colunas por dia
  ------------------------------------------------------------------ */
  renderBroadcastGrid(container, animes, callbacks) {
    container.innerHTML = '';
    const days = Object.keys(DAY_ORDER).sort((a, b) => DAY_ORDER[a] - DAY_ORDER[b]);

    if (animes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Nenhum anime nesta temporada. Clique em "+ Adicionar" para começar.';
      container.appendChild(empty);
      return;
    }

    const todayIdx = new Date().getDay();

    days.forEach((day, i) => {
      const isToday = i === todayIdx;
      const items = animes
        .filter(a => a.day === day)
        .sort((a, b) => a.time.localeCompare(b.time));

      const lane = document.createElement('div');
      lane.className = 'day-lane' + (isToday ? ' day-lane--today' : '');

      const head = document.createElement('div');
      head.className = 'day-lane-head';
      head.innerHTML = `
        <div class="day-name">${capitalize(day.split('-')[0])}</div>
        <div class="day-count">${items.length} título${items.length === 1 ? '' : 's'}</div>
      `;
      lane.appendChild(head);

      const body = document.createElement('div');
      body.className = 'day-lane-body';

      if (items.length === 0) {
        const e = document.createElement('div');
        e.className = 'day-lane-empty';
        e.textContent = '—';
        body.appendChild(e);
      }

      items.forEach(anime => body.appendChild(this._buildSlotCard(anime, callbacks)));
      lane.appendChild(body);
      container.appendChild(lane);
    });
  },

  _buildSlotCard(anime, callbacks) {
    const { done, total, pct } = this.progressOf(anime);
    const nextEp = findNextUnwatched(anime);
    const allDone = !nextEp;
    const safeCover = safeSrc(anime.cover || '');
    const safeTime  = escapeHtml(anime.time);
    const safeTitle = escapeHtml(anime.title);
    const card = document.createElement('div');
    card.className = 'slot-card';
    const markLabel = allDone ? 'Episódios completos' : `Marcar episódio ${nextEp} como assistido`;
    card.innerHTML = `
      <button type="button" class="mark-next-btn ${allDone ? 'done' : ''}" aria-label="${markLabel}" title="${allDone ? 'Completo' : `Marcar ep. ${nextEp}`}">
        ${allDone ? '✓' : '+'}
      </button>
      <div class="slot-top">
        <img class="thumb" src="${safeCover}" alt="Capa de ${safeTitle}" loading="lazy" onerror="this.style.opacity=0">
        <div class="slot-info">
          <span class="slot-time">${safeTime}</span>
          <span class="slot-title">${safeTitle}</span>
          <span class="slot-status ${STATUS_CLASS[anime.status] || ''}">${STATUS_LABELS[anime.status] || ''}</span>
        </div>
      </div>
      <div class="progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progresso: ${done} de ${total} episódios"><span style="width:${pct}%"></span></div>
      <div class="slot-ep-info">${done}/${total} eps · ${allDone ? 'Completo' : `Próx: ep. ${nextEp}`}</div>
    `;
    card.addEventListener('click', () => callbacks.onOpen(anime));
    card.querySelector('.mark-next-btn').addEventListener('click', e => {
      e.stopPropagation();
      if (!allDone) callbacks.onMarkNext(anime);
    });
    return card;
  },

  /* ------------------------------------------------------------------
     Histórico — seletor de temporadas + grade de pôsteres (Claude)
  ------------------------------------------------------------------ */
  renderSeasonPicker(container, allSeasons, activeSeason, onSelect) {
    container.innerHTML = '';
    
    const allGroup = document.createElement('div');
    allGroup.className = 'year-group';
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'year-label' + (activeSeason === 'all' ? ' active' : '');
    allBtn.textContent = 'Todos';
    allBtn.addEventListener('click', () => onSelect('all'));
    allGroup.appendChild(allBtn);
    container.appendChild(allGroup);


    const byYear = {};
    allSeasons.forEach(code => {
      const year = code.split('-')[0];
      (byYear[year] ||= []).push(code);
    });

    Object.keys(byYear).sort().forEach(year => {
      const group = document.createElement('div');
      group.className = 'year-group';
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'year-label' + (activeSeason === year ? ' active' : '');
      label.textContent = year;
      label.addEventListener('click', () => onSelect(year));
      group.appendChild(label);

      byYear[year].sort().forEach(code => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'season-chip' + (code === activeSeason ? ' active' : '');
        chip.innerHTML = `<img src="${seasonIconSrc(code)}" alt=""> ${SEASON_NAMES[code.split('-')[1]] || code}`;
        chip.addEventListener('click', () => onSelect(code));
        group.appendChild(chip);
      });

      container.appendChild(group);
    });
  },

  renderPosterGrid(container, animes, callbacks) {
    container.innerHTML = '';
    if (animes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.style.gridColumn = '1 / -1';
      empty.textContent = 'Nenhum anime registrado nesta temporada.';
      container.appendChild(empty);
      return;
    }

    animes
      .slice()
      .sort((a, b) => (DAY_ORDER[a.day] - DAY_ORDER[b.day]) || a.time.localeCompare(b.time))
      .forEach(anime => {
        const { pct } = this.progressOf(anime);
        const safeCover = safeSrc(anime.cover || '');
        const safeTitle = escapeHtml(anime.title);
        const safeDay   = escapeHtml(capitalize((anime.day || '').split('-')[0]).slice(0,3));
        const safeTime  = escapeHtml(anime.time);
        const card = document.createElement('div');
        card.className = 'poster-card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', `Abrir detalhes de ${anime.title}`);
        card.innerHTML = `
          <div class="poster-img-wrap">
            <img src="${safeCover}" alt="Capa de ${safeTitle}" loading="lazy" onerror="this.style.opacity=0">
            <span class="poster-badge" aria-hidden="true">${pct}%</span>
            <span class="poster-status ${STATUS_CLASS[anime.status] || ''}">${STATUS_LABELS[anime.status] || ''}</span>
          </div>
          <div class="poster-body">
            <div class="poster-title">${safeTitle}</div>
            <div class="poster-progress-row">
              <div class="progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progresso: ${pct}%" style="flex:1"><span style="width:${pct}%"></span></div>
              <span class="poster-day">${safeDay} ${safeTime}</span>
            </div>
          </div>
        `;
        card.addEventListener('click', () => callbacks.onOpen(anime));
        card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); callbacks.onOpen(anime); } });
        container.appendChild(card);
      });
  },

  /* ------------------------------------------------------------------
     Estatísticas (Z.ai) — cards com gráficos de barra
  ------------------------------------------------------------------ */
  renderStats(animes) {
    const total = animes.length;
    const watching = animes.filter(a => a.status === 'watching').length;
    const completed = animes.filter(a => a.status === 'completed').length;
    const paused = animes.filter(a => a.status === 'paused').length;
    const dropped = animes.filter(a => a.status === 'dropped').length;
    let totalWatched = 0, totalEps = 0;
    animes.forEach(a => { totalWatched += a.watched.length; totalEps += a.episodes; });
    const completionRate = totalEps > 0 ? Math.round((totalWatched / totalEps) * 100) : 0;

    // Por dia
    const byDay = {};
    Object.keys(DAY_ORDER).forEach(d => byDay[d] = 0);
    animes.filter(a => a.status === 'watching').forEach(a => { if (byDay[a.day] !== undefined) byDay[a.day]++; });
    const maxDay = Math.max(...Object.values(byDay), 1);

    // Por temporada (baseado em startSeason)
    const bySeason = { '01': 0, '02': 0, '03': 0, '04': 0 };
    animes.forEach(a => { if (a.startSeason) { const s = a.startSeason.split('-')[1]; if (bySeason[s] !== undefined) bySeason[s]++; }});
    const maxSeason = Math.max(...Object.values(bySeason), 1);

    const seasonColors = { '01': '#6fb6ff', '02': '#ff8fc8', '03': '#ffc24b', '04': '#ff8145' };

    const dayShort = { 'domingo':'Dom', 'segunda-feira':'Seg', 'terça-feira':'Ter', 'quarta-feira':'Qua',
      'quinta-feira':'Qui', 'sexta-feira':'Sex', 'sábado':'Sáb' };

    document.getElementById('stats-container').innerHTML = `
      <div class="stat-detail-card">
        <h4 class="stat-detail-title">Biblioteca</h4>
        <div class="big-number">${total}</div>
        <p class="stat-detail-sub">${watching} assistindo · ${completed} finalizados</p>
      </div>

      <div class="stat-detail-card">
        <h4 class="stat-detail-title">Episódios Assistidos</h4>
        <div class="big-number">${totalWatched}</div>
        <p class="stat-detail-sub">de ${totalEps} totais (${completionRate}%)</p>
      </div>

      <div class="stat-detail-card">
        <h4 class="stat-detail-title">Status</h4>
        <div class="bar-chart">
          ${[
            { label: 'Assistindo', val: watching, color: 'var(--accent)' },
            { label: 'Finalizado', val: completed, color: 'var(--success)' },
            { label: 'Pausado', val: paused, color: 'var(--warning)' },
            { label: 'Dropado', val: dropped, color: 'var(--danger)' }
          ].map(r => `
            <div class="bar-row">
              <div class="bar-label">${r.label}</div>
              <div class="bar-track">
                <div class="bar-fill" style="width:${total > 0 ? (r.val / total) * 100 : 0}%;background:${r.color}">
                  ${r.val > 0 ? r.val : ''}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="stat-detail-card">
        <h4 class="stat-detail-title">Por Dia da Semana</h4>
        <div class="bar-chart">
          ${Object.keys(DAY_ORDER).sort((a,b) => DAY_ORDER[a]-DAY_ORDER[b]).map(d => `
            <div class="bar-row">
              <div class="bar-label">${dayShort[d] || d}</div>
              <div class="bar-track">
                <div class="bar-fill" style="width:${(byDay[d] / maxDay) * 100}%;background:var(--accent)">
                  ${byDay[d] || ''}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="stat-detail-card stat-detail-card--wide">
        <h4 class="stat-detail-title">Por Temporada (início)</h4>
        <div class="bar-chart bar-chart--horizontal">
          ${['02', '03', '04', '01'].map(s => `
            <div class="bar-row">
              <div class="bar-label">${SEASON_NAMES[s]}</div>
              <div class="bar-track">
                <div class="bar-fill" style="width:${(bySeason[s] / maxSeason) * 100}%;background:${seasonColors[s]}">
                  ${bySeason[s] || ''}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
};
