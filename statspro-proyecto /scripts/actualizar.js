const fs = require('fs');
const path = require('path');

const API_KEY = process.env.API_FOOTBALL_KEY;
const BASE_URL = 'https://v3.football.api-sports.io';
const LIGAS_TOP = [1, 5, 536, 4, 9, 32, 34, 29, 30, 31, 10, 2, 3, 848, 13, 11, 39, 140, 135, 78, 61, 71, 128, 239, 265, 299, 262, 253];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fechaOffset = d => {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + d);
  return dt.toISOString().slice(0, 10);
};

async function apiGet(endpoint) {
  await sleep(6600);
  const res = await fetch(`${BASE_URL}${endpoint}`, { headers: { 'x-apisports-key': API_KEY } });
  const json = await res.json();
  return Array.isArray(json.response) ? json.response : [];
}

async function main() {
  if (!API_KEY) throw new Error('Falta API_FOOTBALL_KEY');
  const fechas = [fechaOffset(-1), fechaOffset(0), fechaOffset(1)];
  const teamCache = new Map();
  const playersCache = new Map();
  const matches = [];

  for (const fecha of fechas) {
    const rawList = await apiGet(`/fixtures?date=${fecha}`);
    rawList.sort((a, b) => {
      const pa = LIGAS_TOP.indexOf(a.league?.id);
      const pb = LIGAS_TOP.indexOf(b.league?.id);
      return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
    });

    for (let i = 0; i < Math.min(rawList.length, 60); i++) {
      const item = rawList[i];
      const f = item.fixture || {};
      const st = f.status?.short || 'NS';
      const status = ['FT', 'AET', 'PEN'].includes(st) ? 'FIN' : ['1H', 'HT', '2H', 'LIVE'].includes(st) ? 'LIVE' : 'PRE';
      const m = {
        id: `apif-${f.id}`,
        fixtureId: f.id,
        dateGroup: fecha,
        kickoff: f.date || '',
        hour: (f.date || '').slice(11, 16),
        status,
        league: item.league?.country && item.league.country !== 'World' ? `${item.league.country}: ${item.league.name}` : (item.league?.name || 'Liga'),
        leagueId: item.league?.id || null,
        leagueSeason: item.league?.season || 2024,
        leagueLogo: item.league?.logo || '',
        source: 'API-Football',
        updatedAt: new Date().toISOString(),
        enrichedAt: null,
        local: { name: item.teams?.home?.name || 'Local', id: String(item.teams?.home?.id || ''), logo: item.teams?.home?.logo || '', history: [] },
        visita: { name: item.teams?.away?.name || 'Visitante', id: String(item.teams?.away?.id || ''), logo: item.teams?.away?.logo || '', history: [] },
        leagueProfile: { avgHomeXG: 1.45, avgAwayXG: 1.18, avgHomeCorners: 5.15, avgAwayCorners: 4.25, avgHomeCards: 2.15, avgAwayCards: 2.35, dixonColesRho: -0.08, h2hWeight: 0.05 },
        context: { importance: 'normal', derby: false, tieStage: 'none', lineupsStatus: 'unconfirmed' },
        players: [],
        odds: [],
        result: Number.isInteger(item.goals?.home) && Number.isInteger(item.goals?.away) ? { homeGoals: item.goals.home, awayGoals: item.goals.away } : null
      };

      if (i < 12 && m.local.id && m.visita.id) {
        const season = Math.min(m.leagueSeason, 2024);
        for (const [sideKey, teamObj] of [['home', m.local], ['away', m.visita]]) {
          if (!teamCache.has(teamObj.id)) {
            const histRaw = await apiGet(`/fixtures?team=${teamObj.id}&season=${season}`);
            const hist = histRaw
              .filter(x => ['FT', 'AET', 'PEN'].includes(x.fixture?.status?.short) && Number.isInteger(x.goals?.home))
              .map(x => {
                const isH = String(x.teams?.home?.id) === teamObj.id;
                return {
                  fixtureId: x.fixture?.id,
                  date: x.fixture?.date || '',
                  venue: isH ? 'home' : 'away',
                  xGFor: isH ? x.goals.home : x.goals.away,
                  xGAgainst: isH ? x.goals.away : x.goals.home,
                  goalsFor: isH ? x.goals.home : x.goals.away,
                  goalsAgainst: isH ? x.goals.away : x.goals.home,
                  cornersFor: isH ? 5.2 : 4.3,
                  cornersAgainst: isH ? 4.3 : 5.2,
                  cards: 2.2
                };
              });
            teamCache.set(teamObj.id, hist);
          }
          teamObj.history = teamCache.get(teamObj.id) || [];

          if (!playersCache.has(teamObj.id)) {
            const pRaw = await apiGet(`/players?team=${teamObj.id}&season=${season}`);
            const topP = pRaw
              .map(p => {
                const st = p.statistics?.[0] || {};
                const apps = st.games?.appearences || 0;
                const tot = st.shots?.total || 0;
                const on = st.shots?.on || 0;
                if (apps < 3 || tot <= 0) return null;
                return {
                  name: p.player?.name || 'Jugador',
                  team: teamObj.name,
                  status: 'available',
                  shots: tot,
                  history: Array.from({ length: Math.min(apps, 8) }, (_, idx) => ({
                    date: `2024-01-0${idx + 1}`,
                    shotsTotal: Math.round(tot / apps),
                    shotsOnTarget: Math.round(on / apps)
                  }))
                };
              })
              .filter(Boolean)
              .sort((a, b) => b.shots - a.shots)
              .slice(0, 5)
              .map(({ shots, ...rest }) => rest);
            playersCache.set(teamObj.id, topP);
          }
          m.players.push(...(playersCache.get(teamObj.id) || []));
        }
        if (m.local.history.length >= 3 && m.visita.history.length >= 3) {
          m.enrichedAt = Date.now();
        }
      }
      matches.push(m);
    }
  }

  fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'partidos.json'), JSON.stringify({ exportedAt: new Date().toISOString(), matches }, null, 2));
  console.log(`Actualizados ${matches.length} partidos.`);
}

main().catch(err => { console.error(err); process.exit(1); });
