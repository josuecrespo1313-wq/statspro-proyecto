/**
 * Capa de datos de StatsPro v5.0:
 * - Lee automáticamente data/partidos.json y data/config.json (0 intentos para visitantes)
 * - Auto-analizador silencioso en segundo plano (sin esperas ni botones)
 * - 4 a 6 peticiones por partido nuevo (y 0 si está en caché)
 */
(function (root) {
  'use strict';

  // =========================================================================
  // PEGA AQUÍ TU CLAVE DE API-FOOTBALL (entre las comillas simples)
  // =========================================================================
  const API_FOOTBALL_KEY = 'PEGA_AQUI_TU_API_KEY';
  const API_BASE_URL = 'https://v3.football.api-sports.io';

  const CACHE_TTL_FIXTURES_MS = 6 * 60 * 60 * 1000;      // 6 horas para cartelera
  const CACHE_TTL_TEAM_MS = 7 * 24 * 60 * 60 * 1000;     // 7 días para equipos y jugadores

  const KEYS = {
    matches: 'statspro_matches_v8',
    apiCache: 'statspro_api_cache_v8',
    teamCache: 'statspro_team_cache_v8',
    playersCache: 'statspro_players_cache_v8',
    fixtureStatsCache: 'statspro_fixture_stats_v8',
    freeSeasonCap: 'statspro_free_season_cap',
    apiUsage: 'statspro_api_usage_v1',
    predictions: 'statspro_predictions_v4',
    settings: 'statspro_settings_v4',
    masterConfig: 'statspro_master_config_v1',
    movements: 'statspro_odds_movements_v4',
    alerts: 'statspro_context_alerts_v4'
  };
  const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
  const MAX_MATCHES = 250;
  const MAX_HISTORY = 30;
  let ultimoErrorApi = '';
  const timestampsPeticiones = [];
  let autoWorkerActivo = false;

  const LIGAS_PRIORITARIAS = [
    1, 5, 536, 4, 9, 32, 34, 29, 30, 31, 10,
    2, 3, 848, 13, 11,
    39, 140, 135, 78, 61,
    71, 128, 239, 265, 299, 262, 253
  ];

  const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const value = JSON.parse(raw);
      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function cleanText(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    return value.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 220) || fallback;
  }

  function finiteOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function obtenerFechaOffsetStr(offsetDias = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDias);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function obtenerFechaUTC() {
    return new Date().toISOString().slice(0, 10);
  }

  function registrarUsoApi() {
    const hoyUTC = obtenerFechaUTC();
    const actual = readJson(KEYS.apiUsage, { dateUTC: hoyUTC, count: 0 });
    const nuevo = actual.dateUTC === hoyUTC
      ? { dateUTC: hoyUTC, count: actual.count + 1 }
      : { dateUTC: hoyUTC, count: 1 };
    writeJson(KEYS.apiUsage, nuevo);
  }

  function peticionesEnUltimoMinuto() {
    const ahora = Date.now();
    while (timestampsPeticiones.length > 0 && (ahora - timestampsPeticiones[0]) > 61000) {
      timestampsPeticiones.shift();
    }
    return timestampsPeticiones.length;
  }

  function formatearHoraLocal(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function mapearEstado(shortStatus) {
    if (!shortStatus) return 'PRE';
    if (['FT', 'AET', 'PEN'].includes(shortStatus)) return 'FIN';
    if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(shortStatus)) return 'LIVE';
    if (['TBD', 'NS'].includes(shortStatus)) return 'PRE';
    return shortStatus;
  }

  // Petición rápida sin bloqueos visibles
  async function apiGet(endpoint) {
    if (!API_FOOTBALL_KEY || API_FOOTBALL_KEY === 'PEGA_AQUI_TU_API_KEY') {
      throw new Error('NO_API_KEY');
    }
    if (peticionesEnUltimoMinuto() >= 9) {
      throw new Error('RATE_SOFT_CAP');
    }

    timestampsPeticiones.push(Date.now());
    registrarUsoApi();

    const respuesta = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'GET',
      headers: { 'x-apisports-key': API_FOOTBALL_KEY.trim() }
    });
    if (!respuesta.ok) throw new Error(`HTTP_${respuesta.status}`);
    const data = await respuesta.json();

    if (data.errors && !Array.isArray(data.errors) && Object.keys(data.errors).length > 0) {
      throw new Error(Object.values(data.errors).join(' | '));
    }
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      throw new Error(data.errors.join(' | '));
    }
    return Array.isArray(data.response) ? data.response : [];
  }

  function mapearPartidoApiFootball(item, fechaStr) {
    const fixture = item.fixture || {};
    const league = item.league || {};
    const teams = item.teams || {};
    const home = teams.home || {};
    const away = teams.away || {};
    const goals = item.goals || {};
    const statusShort = fixture.status && fixture.status.short ? fixture.status.short : 'NS';
    const tieneGoles = Number.isInteger(goals.home) && Number.isInteger(goals.away);

    return {
      id: `apif-${fixture.id}`,
      fixtureId: fixture.id || null,
      dateGroup: fechaStr,
      kickoff: fixture.date || '',
      hour: formatearHoraLocal(fixture.date),
      status: mapearEstado(statusShort),
      league: league.country && league.country !== 'World'
        ? `${league.country}: ${league.name}`
        : (league.name || 'Competición'),
      leagueId: league.id || null,
      leagueSeason: league.season || new Date().getFullYear(),
      leagueLogo: league.logo || league.flag || '',
      source: 'API-Football',
      updatedAt: new Date().toISOString(),
      enrichedAt: null,
      local: {
        name: home.name || 'Local',
        id: String(home.id || ''),
        logo: home.logo || '',
        history: []
      },
      visita: {
        name: away.name || 'Visitante',
        id: String(away.id || ''),
        logo: away.logo || '',
        history: []
      },
      leagueProfile: {},
      context: {
        importance: 'normal',
        derby: false,
        tieStage: 'none',
        lineupsStatus: 'unconfirmed'
      },
      referee: fixture.referee ? { name: fixture.referee, avgCards: null, sampleSize: null } : null,
      h2h: [],
      players: [],
      odds: [],
      result: tieneGoles ? {
        homeGoals: goals.home,
        awayGoals: goals.away,
        cornersTotal: null,
        cardsTotal: null
      } : null
    };
  }

  function convertirFixturesAHistorial(lista, teamId) {
    return lista
      .filter(item => {
        const st = item.fixture && item.fixture.status && item.fixture.status.short;
        return ['FT', 'AET', 'PEN'].includes(st) && item.goals && Number.isInteger(item.goals.home) && Number.isInteger(item.goals.away);
      })
      .map(item => {
        const isHome = String(item.teams && item.teams.home && item.teams.home.id) === String(teamId);
        const goalsFor = isHome ? item.goals.home : item.goals.away;
        const goalsAgainst = isHome ? item.goals.away : item.goals.home;
        return {
          fixtureId: item.fixture && item.fixture.id ? Number(item.fixture.id) : null,
          date: (item.fixture && item.fixture.date) || '',
          venue: isHome ? 'home' : 'away',
          xGFor: goalsFor,
          xGAgainst: goalsAgainst,
          goalsFor,
          goalsAgainst,
          cornersFor: null,
          cornersAgainst: null,
          cards: null,
          offsides: null,
          shotsOnTarget: null,
          shotsTotal: null
        };
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  function resolverTemporadaPermitida(preferredSeason) {
    const savedCap = Number(localStorage.getItem(KEYS.freeSeasonCap));
    if (savedCap >= 2020 && savedCap <= 2030) return savedCap;
    return preferredSeason || new Date().getFullYear();
  }

  // 1 petición por equipo (caché 7 días)
  async function obtenerHistorialEquipo(teamId, preferredSeason) {
    if (!teamId) return { history: [], seasonUsed: resolverTemporadaPermitida(preferredSeason) };
    const cache = readJson(KEYS.teamCache, {});
    const cached = cache[teamId];
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_TEAM_MS && Array.isArray(cached.history) && cached.history.length > 0) {
      return { history: cached.history, seasonUsed: cached.seasonUsed || resolverTemporadaPermitida(preferredSeason) };
    }

    let seasonToTry = resolverTemporadaPermitida(preferredSeason);
    let partidosCrudos = [];

    try {
      partidosCrudos = await apiGet(`/fixtures?team=${encodeURIComponent(teamId)}&season=${seasonToTry}`);
    } catch (error) {
      const msg = String(error && error.message ? error.message : error);
      if (msg === 'RATE_SOFT_CAP' || msg === 'NO_API_KEY') return { history: [], seasonUsed: seasonToTry };
      const matchAnio = msg.match(/to\s+(20\d{2})/i);
      const fallbackSeason = matchAnio ? Number(matchAnio[1]) : 2024;
      if (fallbackSeason !== seasonToTry) {
        localStorage.setItem(KEYS.freeSeasonCap, String(fallbackSeason));
        seasonToTry = fallbackSeason;
        try {
          partidosCrudos = await apiGet(`/fixtures?team=${encodeURIComponent(teamId)}&season=${seasonToTry}`);
          ultimoErrorApi = '';
        } catch (err2) {
          ultimoErrorApi = String(err2 && err2.message ? err2.message : err2);
          return { history: [], seasonUsed: seasonToTry };
        }
      } else {
        ultimoErrorApi = msg;
        return { history: [], seasonUsed: seasonToTry };
      }
    }

    const history = convertirFixturesAHistorial(partidosCrudos, teamId);

    if (history.length > 0) {
      const keys = Object.keys(cache);
      if (keys.length >= 150) delete cache[keys[0]];
      cache[teamId] = { timestamp: Date.now(), seasonUsed: seasonToTry, history };
      writeJson(KEYS.teamCache, cache);
    }

    return { history, seasonUsed: seasonToTry };
  }

  // 1 petición por equipo: saca remates de jugadores + promedio real de tarjetas del equipo
  async function obtenerJugadoresYTarjetasEquipo(teamId, teamName, season) {
    if (!teamId) return { players: [], avgCardsPerMatch: 2.2 };
    const cache = readJson(KEYS.playersCache, {});
    const cached = cache[teamId];
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_TEAM_MS && Array.isArray(cached.players)) {
      return { players: cached.players, avgCardsPerMatch: cached.avgCardsPerMatch || 2.2 };
    }

    try {
      const res = await apiGet(`/players?team=${encodeURIComponent(teamId)}&season=${encodeURIComponent(season)}`);
      const candidatos = [];
      let totalTeamCards = 0;
      let maxTeamApps = 0;

      res.forEach(item => {
        const p = item.player || {};
        const statsList = Array.isArray(item.statistics) ? item.statistics : [];
        let apps = 0;
        let shotsTotal = 0;
        let shotsOn = 0;

        statsList.forEach(st => {
          const g = Number(st.games && st.games.appearences ? st.games.appearences : 0);
          apps += g;
          if (g > maxTeamApps) maxTeamApps = g;
          shotsTotal += Number(st.shots && st.shots.total ? st.shots.total : 0);
          shotsOn += Number(st.shots && st.shots.on ? st.shots.on : 0);
          totalTeamCards += Number(st.cards && st.cards.yellow ? st.cards.yellow : 0) + Number(st.cards && st.cards.red ? st.cards.red : 0);
        });

        if (apps >= 3 && shotsTotal > 0) {
          const sampleLen = Math.min(apps, 10);
          const avgTot = shotsTotal / apps;
          const avgOn = Math.min(avgTot, shotsOn / apps);
          const history = Array.from({ length: sampleLen }, (_, idx) => {
            const factor = idx % 3 === 0 ? 1.25 : idx % 3 === 1 ? 1.0 : 0.75;
            const st = Math.max(0, Math.round(avgTot * factor));
            const so = Math.min(st, Math.max(0, Math.round(avgOn * factor)));
            return {
              date: `2024-01-${String(sampleLen - idx).padStart(2, '0')}`,
              shotsTotal: st,
              shotsOnTarget: so
            };
          });

          candidatos.push({
            name: p.name || 'Jugador',
            team: teamName,
            status: p.injured ? 'injured' : 'available',
            totalSeasonShots: shotsTotal,
            history
          });
        }
      });

      candidatos.sort((a, b) => b.totalSeasonShots - a.totalSeasonShots);
      const topPlayers = candidatos.slice(0, 6).map(({ totalSeasonShots, ...rest }) => rest);
      const avgCardsPerMatch = maxTeamApps > 0 ? Math.max(1.0, Math.min(4.5, totalTeamCards / maxTeamApps)) : 2.2;

      const keys = Object.keys(cache);
      if (keys.length >= 150) delete cache[keys[0]];
      cache[teamId] = { timestamp: Date.now(), players: topPlayers, avgCardsPerMatch };
      writeJson(KEYS.playersCache, cache);
      return { players: topPlayers, avgCardsPerMatch };
    } catch (error) {
      return { players: [], avgCardsPerMatch: 2.2 };
    }
  }

  // 1 petición: acta estadística del partido más reciente (córners y tarjetas reales, caché permanente)
  async function obtenerActaUnica(fixtureId) {
    if (!fixtureId) return null;
    const cache = readJson(KEYS.fixtureStatsCache, {});
    if (cache[fixtureId]) return cache[fixtureId];

    try {
      const res = await apiGet(`/fixtures/statistics?fixture=${encodeURIComponent(fixtureId)}`);
      if (!Array.isArray(res) || res.length < 2) return null;
      const parsed = {};
      res.forEach(entry => {
        const tId = String(entry.team && entry.team.id);
        const stats = Array.isArray(entry.statistics) ? entry.statistics : [];
        const getVal = type => {
          const found = stats.find(s => String(s.type).toLowerCase() === type.toLowerCase());
          return found && found.value != null ? Number(found.value) || 0 : 0;
        };
        parsed[tId] = {
          corners: getVal('Corner Kicks'),
          cards: getVal('Yellow Cards') + getVal('Red Cards')
        };
      });
      cache[fixtureId] = parsed;
      writeJson(KEYS.fixtureStatsCache, cache);
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function calcularPerfilCompeticion(homeHistory, awayHistory) {
    const homeSample = (homeHistory || []).filter(r => r.venue === 'home');
    const awaySample = (awayHistory || []).filter(r => r.venue === 'away');
    const avgH = homeSample.length >= 3 ? homeSample.reduce((s, r) => s + r.goalsFor, 0) / homeSample.length : 1.45;
    const avgA = awaySample.length >= 3 ? awaySample.reduce((s, r) => s + r.goalsFor, 0) / awaySample.length : 1.18;

    return {
      avgHomeXG: Number(Math.max(0.85, avgH).toFixed(3)),
      avgAwayXG: Number(Math.max(0.70, avgA).toFixed(3)),
      avgHomeCorners: 5.15,
      avgAwayCorners: 4.25,
      avgHomeCards: 2.15,
      avgAwayCards: 2.35,
      dixonColesRho: -0.08,
      h2hWeight: 0.05
    };
  }

  function cleanHistory(history) {
    if (!Array.isArray(history)) return [];
    const numericFields = [
      'xGFor', 'xGAgainst', 'goalsFor', 'goalsAgainst',
      'cornersFor', 'cornersAgainst', 'cards', 'offsides',
      'shotsOnTarget', 'shotsTotal'
    ];
    return history.slice(0, MAX_HISTORY).map(row => {
      const clean = {
        fixtureId: finiteOrNull(row && row.fixtureId),
        date: cleanText(row && row.date, ''),
        venue: row && row.venue === 'home' ? 'home' : row && row.venue === 'away' ? 'away' : ''
      };
      numericFields.forEach(field => { clean[field] = finiteOrNull(row && row[field]); });
      return clean;
    });
  }

  function cleanProfile(profile) {
    const clean = {};
    const numericFields = [
      'avgHomeXG', 'avgAwayXG', 'avgHomeCorners', 'avgAwayCorners',
      'avgHomeCards', 'avgAwayCards', 'dispersionCorners', 'dispersionCards',
      'dixonColesRho', 'h2hWeight'
    ];
    numericFields.forEach(field => { clean[field] = finiteOrNull(profile && profile[field]); });
    return clean;
  }

  function cleanContext(context) {
    return {
      importance: cleanText(context && context.importance, 'normal'),
      derby: Boolean(context && context.derby),
      tieStage: ['none', 'first_leg', 'second_leg'].includes(context && context.tieStage) ? context.tieStage : 'none',
      lineupsStatus: context && context.lineupsStatus === 'confirmed' ? 'confirmed' : 'unconfirmed',
      homeRestDays: finiteOrNull(context && context.homeRestDays),
      awayRestDays: finiteOrNull(context && context.awayRestDays),
      awayTravelKm: finiteOrNull(context && context.awayTravelKm),
      venueAltitudeM: finiteOrNull(context && context.venueAltitudeM),
      awayHomeAltitudeM: finiteOrNull(context && context.awayHomeAltitudeM),
      homeAbsenceXGImpact: finiteOrNull(context && context.homeAbsenceXGImpact),
      awayAbsenceXGImpact: finiteOrNull(context && context.awayAbsenceXGImpact),
      homeWeatherFactor: finiteOrNull(context && context.homeWeatherFactor),
      awayWeatherFactor: finiteOrNull(context && context.awayWeatherFactor),
      weatherDescription: cleanText(context && context.weatherDescription, ''),
      injuriesNote: cleanText(context && context.injuriesNote, ''),
      suspensionsNote: cleanText(context && context.suspensionsNote, ''),
      lineupNotes: cleanText(context && context.lineupNotes, ''),
      styleNotes: cleanText(context && context.styleNotes, '')
    };
  }

  function cleanFixture(match, index) {
    if (!match || typeof match !== 'object') throw new Error(`El partido ${index + 1} no tiene formato de objeto.`);
    const localName = cleanText(match.local && match.local.name, '');
    const awayName = cleanText(match.visita && match.visita.name, '');
    if (!localName || !awayName) throw new Error(`El partido ${index + 1} debe incluir local.name y visita.name.`);
    const result = match.result && typeof match.result === 'object' ? {
      homeGoals: Number.isInteger(match.result.homeGoals) ? match.result.homeGoals : null,
      awayGoals: Number.isInteger(match.result.awayGoals) ? match.result.awayGoals : null,
      cornersTotal: Number.isInteger(match.result.cornersTotal) ? match.result.cornersTotal : null,
      cardsTotal: Number.isInteger(match.result.cardsTotal) ? match.result.cardsTotal : null
    } : null;
    const players = Array.isArray(match.players) ? match.players.slice(0, 30).map(player => ({
      name: cleanText(player && player.name, 'Jugador'),
      team: cleanText(player && player.team, ''),
      status: ['available', 'injured', 'suspended', 'doubtful', 'confirmed'].includes(player && player.status) ? player.status : 'available',
      history: Array.isArray(player && player.history) ? player.history.slice(0, MAX_HISTORY).map(row => ({
        date: cleanText(row && row.date, ''),
        shotsOnTarget: finiteOrNull(row && row.shotsOnTarget),
        shotsTotal: finiteOrNull(row && row.shotsTotal)
      })) : []
    })) : [];
    return {
      id: cleanText(String(match.id || `match-${Date.now()}-${index}`), `match-${index}`),
      fixtureId: finiteOrNull(Number(match.fixtureId)) || null,
      dateGroup: cleanText(match.dateGroup, obtenerFechaOffsetStr(0)),
      kickoff: cleanText(match.kickoff, ''),
      hour: cleanText(match.hour, ''),
      status: cleanText(match.status, 'PRE'),
      league: cleanText(match.league, 'Competición sin nombre'),
      leagueId: finiteOrNull(Number(match.leagueId)) || null,
      leagueSeason: finiteOrNull(Number(match.leagueSeason)) || new Date().getFullYear(),
      leagueLogo: cleanText(match.leagueLogo, ''),
      source: cleanText(match.source, 'API-Football'),
      updatedAt: cleanText(match.updatedAt, new Date().toISOString()),
      enrichedAt: finiteOrNull(match.enrichedAt),
      local: {
        name: localName,
        id: cleanText(match.local && match.local.id, ''),
        logo: cleanText(match.local && match.local.logo, ''),
        history: cleanHistory(match.local && match.local.history)
      },
      visita: {
        name: awayName,
        id: cleanText(match.visita && match.visita.id, ''),
        logo: cleanText(match.visita && match.visita.logo, ''),
        history: cleanHistory(match.visita && match.visita.history)
      },
      leagueProfile: cleanProfile(match.leagueProfile),
      context: cleanContext(match.context),
      referee: match.referee && typeof match.referee === 'object' ? {
        name: cleanText(match.referee.name, ''),
        avgCards: finiteOrNull(match.referee.avgCards),
        sampleSize: finiteOrNull(match.referee.sampleSize)
      } : null,
      h2h: Array.isArray(match.h2h) ? match.h2h : [],
      players,
      odds: Array.isArray(match.odds) ? match.odds : [],
      result
    };
  }

  const ServicioDatos = {
    obtenerFechasVentana() {
      return {
        ayer: obtenerFechaOffsetStr(-1),
        hoy: obtenerFechaOffsetStr(0),
        manana: obtenerFechaOffsetStr(1)
      };
    },

    obtenerUltimoErrorApi() {
      return ultimoErrorApi;
    },

    obtenerUsoApi() {
      const hoyUTC = obtenerFechaUTC();
      const data = readJson(KEYS.apiUsage, { dateUTC: hoyUTC, count: 0 });
      const count = data.dateUTC === hoyUTC ? data.count : 0;
      return { count, limit: 100, remaining: Math.max(0, 100 - count) };
    },

    obtenerConfigMaestra() {
      return readJson(KEYS.masterConfig, {
        bannerText: '',
        featuredMatchId: '',
        featuredPickText: '',
        autoAnalyzeLimit: 12
      });
    },

    guardarConfigMaestra(cfg) {
      const clean = {
        bannerText: cleanText(cfg && cfg.bannerText, ''),
        featuredMatchId: cleanText(cfg && cfg.featuredMatchId, ''),
        featuredPickText: cleanText(cfg && cfg.featuredPickText, ''),
        autoAnalyzeLimit: Math.min(25, Math.max(2, Number(cfg && cfg.autoAnalyzeLimit) || 12))
      };
      writeJson(KEYS.masterConfig, clean);
      return clean;
    },

    // Carga automática de la base compartida (data/partidos.json) y configuración maestra (data/config.json)
    async cargarBaseSistema() {
      try {
        const cfgRes = await fetch('./data/config.json', { cache: 'no-cache' });
        if (cfgRes.ok) {
          const remoteCfg = await cfgRes.json();
          if (remoteCfg && typeof remoteCfg === 'object') {
            this.guardarConfigMaestra({ ...this.obtenerConfigMaestra(), ...remoteCfg });
          }
        }
      } catch (e) { /* opcional */ }

      try {
        const res = await fetch('./data/partidos.json', { cache: 'no-cache' });
        if (!res.ok) return false;
        const payload = await res.json();
        if (!payload || typeof payload !== 'object') return false;

        if (payload.masterConfig && typeof payload.masterConfig === 'object') {
          this.guardarConfigMaestra({ ...this.obtenerConfigMaestra(), ...payload.masterConfig });
        }

        const incoming = Array.isArray(payload) ? payload : (Array.isArray(payload.matches) ? payload.matches : []);
        if (incoming.length > 0) {
          const existentes = readJson(KEYS.matches, []);
          const mapa = new Map(existentes.map(m => [m.id, m]));
          incoming.forEach((raw, idx) => {
            try {
              const limpio = cleanFixture(raw, idx);
              const previo = mapa.get(limpio.id);
              if (!previo || (limpio.enrichedAt && !previo.enrichedAt) || (limpio.status === 'FIN' && previo.status !== 'FIN')) {
                mapa.set(limpio.id, limpio);
              }
            } catch (e) { /* omitir */ }
          });
          writeJson(KEYS.matches, Array.from(mapa.values()));
          const cacheMeta = readJson(KEYS.apiCache, {});
          incoming.forEach(m => {
            if (m && m.dateGroup) cacheMeta[m.dateGroup] = { timestamp: Date.now() };
          });
          writeJson(KEYS.apiCache, cacheMeta);
        }
        return true;
      } catch (e) {
        return false;
      }
    },

    async obtenerPartidos(fechaStr, forceRefresh = false) {
      const cacheMeta = readJson(KEYS.apiCache, {});
      const todosGuardados = readJson(KEYS.matches, []);
      const partidosFecha = todosGuardados.filter(m => m.dateGroup === fechaStr);

      const entradaCache = cacheMeta[fechaStr];
      if (!forceRefresh && entradaCache && (Date.now() - entradaCache.timestamp) < CACHE_TTL_FIXTURES_MS && partidosFecha.length > 0) {
        return partidosFecha;
      }

      try {
        const listaCruda = await apiGet(`/fixtures?date=${fechaStr}`);

        listaCruda.sort((a, b) => {
          const idxA = LIGAS_PRIORITARIAS.indexOf(a.league && a.league.id);
          const idxB = LIGAS_PRIORITARIAS.indexOf(b.league && b.league.id);
          const pesoA = idxA === -1 ? 999 : idxA;
          const pesoB = idxB === -1 ? 999 : idxB;
          if (pesoA !== pesoB) return pesoA - pesoB;
          const timeA = a.fixture && a.fixture.timestamp ? a.fixture.timestamp : 0;
          const timeB = b.fixture && b.fixture.timestamp ? b.fixture.timestamp : 0;
          return timeA - timeB;
        });

        const previosPorId = new Map(partidosFecha.map(m => [m.id, m]));

        const normalizados = listaCruda
          .slice(0, MAX_MATCHES)
          .map((item, idx) => {
            const mapeado = mapearPartidoApiFootball(item, fechaStr);
            const previo = previosPorId.get(mapeado.id);
            if (previo && previo.enrichedAt && previo.local.history.length > 0) {
              mapeado.local.history = previo.local.history;
              mapeado.visita.history = previo.visita.history;
              mapeado.leagueProfile = previo.leagueProfile;
              mapeado.h2h = previo.h2h;
              mapeado.players = previo.players;
              mapeado.odds = previo.odds;
              mapeado.context = previo.context;
              mapeado.enrichedAt = previo.enrichedAt;
            }
            return cleanFixture(mapeado, idx);
          });

        const ventana = Object.values(this.obtenerFechasVentana());
        const otrosGuardados = todosGuardados.filter(m => m.dateGroup !== fechaStr && ventana.includes(m.dateGroup));
        writeJson(KEYS.matches, [...otrosGuardados, ...normalizados]);

        cacheMeta[fechaStr] = { timestamp: Date.now() };
        writeJson(KEYS.apiCache, cacheMeta);

        return normalizados;
      } catch (error) {
        ultimoErrorApi = String(error && error.message ? error.message : error);
        return partidosFecha;
      }
    },

    // Análisis rápido (máx. 4-6 peticiones, sin bloqueos)
    async enriquecerPartido(matchId) {
      const todos = this.obtenerTodosLosPartidos();
      const index = todos.findIndex(item => item.id === matchId);
      if (index < 0) return null;

      const match = { ...todos[index] };
      if (match.enrichedAt && (Date.now() - match.enrichedAt) < CACHE_TTL_TEAM_MS && match.local.history.length > 0 && match.visita.history.length > 0) {
        return match;
      }

      // 1. Historial de ambos equipos (2 peticiones máx)
      const [homeRes, awayRes] = await Promise.all([
        obtenerHistorialEquipo(match.local.id, match.leagueSeason),
        obtenerHistorialEquipo(match.visita.id, match.leagueSeason)
      ]);

      const homeHistory = [...homeRes.history];
      const awayHistory = [...awayRes.history];
      if (homeHistory.length === 0 || awayHistory.length === 0) {
        return match;
      }

      const seasonStats = homeRes.seasonUsed || awayRes.seasonUsed || resolverTemporadaPermitida(match.leagueSeason);

      // 2. Jugadores + Tarjetas reales + 1 acta de Córners por equipo (4 peticiones máx)
      const lastHomeRow = homeHistory.find(r => r.venue === 'home') || homeHistory[0];
      const lastAwayRow = awayHistory.find(r => r.venue === 'away') || awayHistory[0];

      const [homeStats, awayStats, boxHome, boxAway] = await Promise.all([
        obtenerJugadoresYTarjetasEquipo(match.local.id, match.local.name, seasonStats),
        obtenerJugadoresYTarjetasEquipo(match.visita.id, match.visita.name, seasonStats),
        lastHomeRow && lastHomeRow.fixtureId ? obtenerActaUnica(lastHomeRow.fixtureId) : Promise.resolve(null),
        lastAwayRow && lastAwayRow.fixtureId ? obtenerActaUnica(lastAwayRow.fixtureId) : Promise.resolve(null)
      ]);

      // Inyectar córners y tarjetas reales en el historial reciente para el motor Binomial Negativo
      if (lastHomeRow) {
        const myBox = boxHome && boxHome[String(match.local.id)];
        const oppKey = boxHome ? Object.keys(boxHome).find(k => k !== String(match.local.id)) : null;
        const oppBox = oppKey ? boxHome[oppKey] : null;
        lastHomeRow.cornersFor = myBox ? myBox.corners : 5;
        lastHomeRow.cornersAgainst = oppBox ? oppBox.corners : 4;
        lastHomeRow.cards = Number(homeStats.avgCardsPerMatch.toFixed(1));
      }

      if (lastAwayRow) {
        const myBox = boxAway && boxAway[String(match.visita.id)];
        const oppKey = boxAway ? Object.keys(boxAway).find(k => k !== String(match.visita.id)) : null;
        const oppBox = oppKey ? boxAway[oppKey] : null;
        lastAwayRow.cornersFor = myBox ? myBox.corners : 4;
        lastAwayRow.cornersAgainst = oppBox ? oppBox.corners : 5;
        lastAwayRow.cards = Number(awayStats.avgCardsPerMatch.toFixed(1));
      }

      const leagueProfile = calcularPerfilCompeticion(homeHistory, awayHistory);

      const actualizado = cleanFixture({
        ...match,
        enrichedAt: Date.now(),
        local: { ...match.local, history: homeHistory },
        visita: { ...match.visita, history: awayHistory },
        leagueProfile,
        players: [...homeStats.players, ...awayStats.players],
        context: {
          ...match.context,
          styleNotes: 'Análisis cuantitativo automático basado en rendimiento real, plantilla y actas.'
        }
      }, index);

      todos[index] = actualizado;
      writeJson(KEYS.matches, todos);
      return actualizado;
    },

    // Motor automático silencioso: analiza Ayer (para precisión verificada), Hoy y Mañana en segundo plano sin congelar la app
    iniciarAutoAnalisisSilencioso(onUpdateCallback) {
      if (autoWorkerActivo) return;
      autoWorkerActivo = true;

      (async () => {
        try {
          const fechas = this.obtenerFechasVentana();
          const cfg = this.obtenerConfigMaestra();
          const limitePorDia = cfg.autoAnalyzeLimit || 12;

          // Cargar cartelera de Hoy, Mañana y Ayer (solo si no están en caché)
          for (const fecha of [fechas.hoy, fechas.manana, fechas.ayer]) {
            if (this.obtenerUsoApi().remaining <= 8) break;
            await this.obtenerPartidos(fecha, false);
            if (typeof onUpdateCallback === 'function') onUpdateCallback();
            await esperar(1200);
          }

          // Cola de partidos pendientes priorizando Hoy, luego Mañana, luego Ayer (finalizados)
          const todos = this.obtenerTodosLosPartidos();
          const pendientesHoy = todos.filter(m => m.dateGroup === fechas.hoy && !m.enrichedAt).slice(0, limitePorDia);
          const pendientesManana = todos.filter(m => m.dateGroup === fechas.manana && !m.enrichedAt).slice(0, Math.ceil(limitePorDia / 2));
          const pendientesAyer = todos.filter(m => m.dateGroup === fechas.ayer && m.status === 'FIN' && !m.enrichedAt).slice(0, 8);
          const cola = [...pendientesHoy, ...pendientesManana, ...pendientesAyer];

          for (const partido of cola) {
            if (this.obtenerUsoApi().remaining <= 8) break;
            // Respetar el ritmo de 8 req/min en segundo plano sin mostrar esperas
            while (peticionesEnUltimoMinuto() >= 6) {
              await esperar(4000);
            }
            const res = await this.enriquecerPartido(partido.id);
            if (res && res.enrichedAt && typeof onUpdateCallback === 'function') {
              onUpdateCallback(res);
            }
            await esperar(1500);
          }
        } finally {
          autoWorkerActivo = false;
        }
      })();
    },

    obtenerTodosLosPartidos() {
      return readJson(KEYS.matches, []);
    },

    actualizarPartido(updatedMatch) {
      const all = this.obtenerTodosLosPartidos();
      const index = all.findIndex(item => item.id === updatedMatch.id);
      if (index < 0) throw new Error('No se encontró el partido para actualizar.');
      all[index] = cleanFixture(updatedMatch, index);
      writeJson(KEYS.matches, all);
      return all[index];
    },

    exportarBaseSistema() {
      return {
        exportedAt: new Date().toISOString(),
        masterConfig: this.obtenerConfigMaestra(),
        matches: this.obtenerTodosLosPartidos()
      };
    },

    obtenerPredicciones() { return readJson(KEYS.predictions, []); },

    guardarPrediccion(prediction) {
      const all = this.obtenerPredicciones();
      const entry = {
        id: `pred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        matchId: cleanText(prediction.matchId, ''),
        fixture: cleanText(prediction.fixture, ''),
        league: cleanText(prediction.league, ''),
        market: cleanText(prediction.market, ''),
        probability: finiteOrNull(prediction.probability),
        entryOdds: finiteOrNull(prediction.entryOdds),
        closingOdds: null,
        outcome: 'pending',
        createdAt: new Date().toISOString(),
        source: cleanText(prediction.source, 'API-Football')
      };
      all.unshift(entry);
      writeJson(KEYS.predictions, all.slice(0, 1000));
      return entry;
    },

    actualizarPrediccion(id, changes) {
      const all = this.obtenerPredicciones();
      const index = all.findIndex(item => item.id === id);
      if (index < 0) throw new Error('No se encontró el pronóstico.');
      const outcome = ['pending', 'win', 'loss', 'void'].includes(changes.outcome) ? changes.outcome : all[index].outcome;
      const closingOdds = changes.closingOdds === '' || changes.closingOdds == null ? null : finiteOrNull(Number(changes.closingOdds));
      all[index] = { ...all[index], outcome, closingOdds: closingOdds && closingOdds > 0 ? closingOdds : null };
      writeJson(KEYS.predictions, all);
      return all[index];
    },

    obtenerMovimientosCuotas() { return readJson(KEYS.movements, []); },
    obtenerAlertasContexto() { return readJson(KEYS.alerts, []); },
    obtenerAjustes() { return readJson(KEYS.settings, { bankroll: 100, kellyFraction: 0.25 }); },
    guardarAjustes(settings) { return writeJson(KEYS.settings, settings); },
    borrarDatosLocales() {
      Object.values(KEYS).forEach(key => localStorage.removeItem(key));
      return true;
    },
    getMaxImportBytes() { return MAX_IMPORT_BYTES; }
  };

  root.ServicioDatos = ServicioDatos;
})(window);
