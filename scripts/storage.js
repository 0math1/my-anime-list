/* ==========================================================================
   storage.js — dados, localStorage, seed, export/import
   Baseado na versão Claude com adição do campo "status" (Z.ai).
   Compatível com ambos os formatos de exportação.
   ========================================================================== */

const STORAGE_KEY = 'animeWatchlist:v3';
const EPISODES_PER_SEASON = 12;

const SEASON_NAMES = {
  '01': 'Inverno',
  '02': 'Primavera',
  '03': 'Verão',
  '04': 'Outono'
};

const DAY_ORDER = {
  'domingo': 0,
  'segunda-feira': 1,
  'terça-feira': 2,
  'quarta-feira': 3,
  'quinta-feira': 4,
  'sexta-feira': 5,
  'sábado': 6
};

const Store = {

  async load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    let animes;
    if (raw) {
      try {
        animes = JSON.parse(raw);
      } catch (e) {
        console.error('Dados corrompidos no localStorage, recarregando semente.', e);
        animes = await this._loadSeed();
      }
    } else {
      animes = await this._loadSeed();
    }
    animes.forEach(a => this._normalize(a));
    this.save(animes);
    return animes;
  },

  async _loadSeed() {
    try {
      const resp = await fetch('data/animes.json');
      if (!resp.ok) throw new Error('sem resposta');
      return await resp.json();
    } catch (e) {
      // fetch() de arquivo local é bloqueado quando aberto via file://.
      // Usamos data/animes-seed.js como fallback.
      if (Array.isArray(window.__ANIMES_SEED__)) {
        console.warn('fetch("data/animes.json") falhou (file://). Usando seed.js.', e);
        return JSON.parse(JSON.stringify(window.__ANIMES_SEED__));
      }
      console.warn('Nenhum dado inicial encontrado. Iniciando vazio.', e);
      return [];
    }
  },

  /** Garante que todo anime tenha id, watched[], status e seasons[] calculados. */
  _normalize(a) {
    if (!a.id) {
      a.id = crypto.randomUUID ? crypto.randomUUID() : 'a' + Math.random().toString(36).slice(2);
    }

    // Compatibilidade com o formato do Z.ai
    if (!a.title && a.name) a.title = a.name;
    if (!a.episodes && a.totalEpisodes) a.episodes = a.totalEpisodes;
    if (!Array.isArray(a.watched)) {
      a.watched = Array.isArray(a.watchedEpisodes) ? [...a.watchedEpisodes] : [];
    }
    if (!a.day && a.releaseDay) {
      // Converte formato Z.ai ("Domingo") → Claude ("domingo")
      const map = {
        'Domingo': 'domingo', 'Segunda': 'segunda-feira', 'Terca': 'terça-feira',
        'Quarta': 'quarta-feira', 'Quinta': 'quinta-feira', 'Sexta': 'sexta-feira',
        'Sabado': 'sábado'
      };
      a.day = map[a.releaseDay] || a.releaseDay.toLowerCase();
    }
    if (!a.time && a.releaseTime) a.time = a.releaseTime;
    if (!a.link && a.downloadLink) a.link = a.downloadLink;
    if (!a.startSeason && a.season && a.year) {
      const sMap = { 'Inverno': '01', 'Primavera': '02', 'Verao': '03', 'Verão': '03', 'Outono': '04' };
      a.startSeason = `${a.year}-${sMap[a.season] || '02'}`;
    }

    a.watched = [...new Set(a.watched)].sort((x, y) => x - y);
    a.seasons = computeSeasons(a.startSeason, a.episodes);
    if (!a.tags) a.tags = '';
    if (!a.link) a.link = '';

    // Status — auto-calcula se não existir
    if (!a.status) {
      a.status = (a.watched.length > 0 && a.watched.length >= a.episodes)
        ? 'completed'
        : 'watching';
    }

    return a;
  },

  save(animes) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(animes));
  },

  exportToFile(animes) {
    const exportable = animes.map(({ id, title, episodes, watched, startSeason, day, time, cover, tags, link, seasons, status }) =>
      ({ id, title, episodes, watched, startSeason, day, time, cover, tags, link, seasons, status }));
    const blob = new Blob([JSON.stringify(exportable, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `animes_${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          let parsed = JSON.parse(reader.result);
          // Suporta { animes: [...] } (formato Z.ai) e [...] (formato Claude)
          if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.animes)) {
            parsed = parsed.animes;
          }
          if (!Array.isArray(parsed)) throw new Error('O arquivo precisa conter uma lista de animes.');
          parsed.forEach(a => this._normalize(a));
          this.save(parsed);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }
};

/* ==========================================================================
   Funções utilitárias compartilhadas (usadas em ui.js e app.js)
   ========================================================================== */

function computeSeasons(start, totalEpisodes) {
  if (!start) return [];
  const seasons = [];
  let [year, season] = start.split('-').map(Number);
  const n = Math.max(1, Math.ceil(totalEpisodes / EPISODES_PER_SEASON));
  for (let i = 0; i < n; i++) {
    seasons.push(`${String(year).padStart(4, '0')}-${String(season).padStart(2, '0')}`);
    season++;
    if (season > 4) { season = 1; year++; }
  }
  return seasons;
}

/** "2025-02" → "Primavera 2025" */
function seasonLabel(code) {
  if (!code) return '';
  const [year, s] = code.split('-');
  if (!s) return `Ano de ${year}`;
  return `${SEASON_NAMES[s] || s} ${year}`;
}

function seasonIconSrc(code) {
  const map = { '01': 'winter', '02': 'spring', '03': 'summer', '04': 'autumn' };
  const cls = map[code.split('-')[1]] || 'spring';
  return `images/${cls}-icon.png`;
}

/** Redimensiona imagem enviada pelo usuário para Base64 comprimido. */
function fileToResizedDataUrl(file, maxWidth = 480, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

/**
 * Sanitiza URLs para atributos src de <img>.
 * Usa escapeHtml genérico apenas em texto visível;
 * em src precisamos somente:
 *   1. Bloquear o protocolo javascript: (risco de XSS via src)
 *   2. Escapar apenas " para não quebrar o atributo HTML
 * NÃO pode usar escapeHtml completo pois converte & e outros chars
 * que quebram data: URLs base64 e query strings de URLs externas.
 */
function safeSrc(url) {
  const s = String(url ?? '').trim();
  if (/^javascript:/i.test(s)) return '';   // bloqueia javascript:
  return s.replace(/"/g, '&quot;');         // só escapa aspas duplas
}


function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function findNextUnwatched(anime) {
  const watchedSet = new Set(anime.watched);
  for (let ep = 1; ep <= anime.episodes; ep++) {
    if (!watchedSet.has(ep)) return ep;
  }
  return null;
}

function getSeasonCodeNow() {
  const m = new Date().getMonth();
  const y = new Date().getFullYear();
  let s;
  if (m <= 2) s = '01';
  else if (m <= 5) s = '02';
  else if (m <= 8) s = '03';
  else s = '04';
  return `${y}-${s}`;
}
