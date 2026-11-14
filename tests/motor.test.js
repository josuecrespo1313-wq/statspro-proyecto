const test = require('node:test');
const assert = require('node:assert/strict');
const Motor = require('../js/motor.js');

function buildFixture(options = {}) {
  const homeHistory = Array.from({ length: options.sampleSize || 12 }, (_, index) => ({
    date: `2026-10-${String(20 - index).padStart(2, '0')}`,
    venue: 'home',
    xGFor: 1.55 + (index % 3) * 0.08,
    xGAgainst: 1.02 + (index % 2) * 0.06,
    cornersFor: 5 + (index % 3),
    cornersAgainst: 4 + (index % 2),
    cards: 2 + (index % 3)
  }));
  const awayHistory = Array.from({ length: options.sampleSize || 12 }, (_, index) => ({
    date: `2026-10-${String(20 - index).padStart(2, '0')}`,
    venue: 'away',
    xGFor: 1.18 + (index % 3) * 0.07,
    xGAgainst: 1.46 + (index % 2) * 0.09,
    cornersFor: 4 + (index % 3),
    cornersAgainst: 5 + (index % 2),
    cards: 2 + (index % 2)
  }));
  const odds = [];
  const overOdds = options.highValue ? 3.8 : 1.9;
  const underOdds = options.highValue ? 1.2 : 1.9;
  for (const bookmaker of ['Book A', 'Book B', 'Book C']) {
    odds.push(
      { market: 'goals_2_5', bookmaker, side: 'over', price: overOdds },
      { market: 'goals_2_5', bookmaker, side: 'under', price: underOdds },
      { market: 'btts', bookmaker, side: 'yes', price: 1.85 },
      { market: 'btts', bookmaker, side: 'no', price: 1.95 },
      { market: 'corners_8_5', bookmaker, side: 'over', price: 1.95 },
      { market: 'corners_8_5', bookmaker, side: 'under', price: 1.85 }
    );
  }
  return {
    id: 'test-fixture',
    league: 'Competición sintética de pruebas',
    local: { name: 'Equipo Local', history: homeHistory },
    visita: { name: 'Equipo Visitante', history: awayHistory },
    leagueProfile: {
      avgHomeXG: 1.45,
      avgAwayXG: 1.15,
      avgHomeCorners: 5.2,
      avgAwayCorners: 4.3,
      avgHomeCards: 2.1,
      avgAwayCards: 2.2,
      dispersionCorners: 8,
      dispersionCards: 6,
      dixonColesRho: -0.08,
      h2hWeight: 0.05
    },
    odds,
    referee: { name: 'Árbitro de prueba', avgCards: 4.5, sampleSize: 16 },
    context: { lineupsStatus: 'unconfirmed', homeRestDays: 6, awayRestDays: 5 },
    ...(options.result ? { result: options.result } : {})
  };
}

test('no inventa datos cuando faltan historiales', () => {
  const result = Motor.analizarPartido({ local: { name: 'A', history: [] }, visita: { name: 'B', history: [] } });
  assert.equal(result.status, 'insufficient_data');
  assert.ok(result.missing.length > 0);
});

test('genera probabilidades válidas con 10+ observaciones de local y visitante', () => {
  const result = Motor.analizarPartido(buildFixture());
  assert.equal(result.status, 'ok');
  assert.equal(result.sample.home, 12);
  assert.equal(result.sample.away, 12);
  const sum = result.probabilities.homeWin + result.probabilities.draw + result.probabilities.awayWin;
  assert.ok(Math.abs(sum - 1) < 1e-10);
  assert.ok(result.probabilities.goalsOver25 >= 0 && result.probabilities.goalsOver25 <= 1);
  assert.equal(result.dixonColes, true);
});

test('córners y tarjetas usan distribuciones binomiales negativas', () => {
  const result = Motor.analizarPartido(buildFixture());
  assert.equal(result.corners.available, true);
  assert.equal(result.cards.available, true);
  assert.equal(result.corners.distribution, 'binomial_negativa');
  assert.equal(result.cards.distribution, 'binomial_negativa');
  assert.ok(result.corners.ladders.every(item => item.probability >= 0 && item.probability <= 1));
});

test('no quita margen ni evalúa valor con una sola casa', () => {
  const fixture = buildFixture();
  fixture.odds = fixture.odds.filter(item => item.market !== 'goals_2_5' || item.bookmaker === 'Book A');
  const result = Motor.analizarPartido(fixture);
  const market = result.oddsEvaluation.find(item => item.market === 'goals_2_5');
  assert.equal(market.available, false);
  assert.match(market.reason, /al menos 3 casas/);
});

test('solo señala valor cuando hay 3 casas y se superan EV y edge', () => {
  const result = Motor.analizarPartido(buildFixture({ highValue: true }));
  const goals = result.oddsEvaluation.find(item => item.market === 'goals_2_5');
  assert.equal(goals.available, true);
  assert.ok(goals.evPercent >= 4);
  assert.ok(goals.edgePercent >= 4);
  assert.equal(goals.isValue, true);
});

test('backtesting exige resultado final y calcula Brier score', () => {
  const fixture = buildFixture({ result: { homeGoals: 2, awayGoals: 1, cornersTotal: 10, cardsTotal: 5 } });
  const backtest = Motor.backtest([fixture]);
  assert.equal(backtest.count, 1);
  assert.ok(Number.isFinite(backtest.metrics.goalsOver25.brier));
  assert.ok(Number.isFinite(backtest.metrics.bttsYes.brier));
});


test('analiza remates individuales solo con 10+ partidos y excluye lesionados/suspendidos', () => {
  const history = Array.from({ length: 12 }, (_, index) => ({
    date: `2026-10-${String(20 - index).padStart(2, '0')}`,
    shotsOnTarget: 1 + (index % 2),
    shotsTotal: 3 + (index % 3)
  }));
  const analysed = Motor.analizarJugadores([
    { name: 'Jugador A', team: 'Equipo A', status: 'available', history },
    { name: 'Jugador B', team: 'Equipo B', status: 'injured', history }
  ]);
  assert.equal(analysed[0].available, true);
  assert.equal(analysed[0].sampleSize, 12);
  assert.equal(analysed[1].available, false);
  assert.match(analysed[1].reason, /lesionado/);
});

test('Kelly fraccionado nunca supera el tope máximo de banca configurado', () => {
  const result = Motor.calcularKelly(0.65, 2.1, 1000, 0.25, 0.02);
  assert.equal(result.available, true);
  assert.ok(result.stake <= 20.0000001);
});
