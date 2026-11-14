const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createService() {
  const data = new Map();
  const localStorage = {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key)
  };
  const window = {};
  const context = { window, localStorage, Date, Math, JSON, console };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/api.js'), 'utf8'), context);
  return { service: window.ServicioDatos, data };
}

function match(price = 1.9) {
  return {
    id: 'm1', dateGroup: 'hoy', league: 'Liga de prueba',
    local: { name: '<script>Local</script>', history: [] },
    visita: { name: 'Visitante', history: [] },
    leagueProfile: { avgHomeXG: 1.4, avgAwayXG: 1.1 },
    context: { lineupsStatus: 'unconfirmed', injuriesNote: 'Sin cambios', suspensionsNote: '' },
    odds: [{ market: 'goals_2_5', bookmaker: 'Casa A', side: 'over', price }]
  };
}

test('normaliza nombres importados y no guarda HTML activo', () => {
  const { service } = createService();
  service.importarPartidos([match()]);
  const saved = service.obtenerTodosLosPartidos()[0];
  assert.equal(saved.local.name, 'scriptLocal/script');
  assert.equal(saved.visita.name, 'Visitante');
});

test('detecta movimientos de cuota al reimportar el mismo partido', () => {
  const { service } = createService();
  service.importarPartidos([match(1.9)]);
  const imported = service.importarPartidos([match(1.75)]);
  assert.equal(imported.movements.length, 1);
  assert.equal(imported.movements[0].from, 1.9);
  assert.equal(imported.movements[0].to, 1.75);
});

test('persiste y actualiza el estado de un pronóstico local', () => {
  const { service } = createService();
  const prediction = service.guardarPrediccion({
    matchId: 'm1', fixture: 'Local vs Visitante', league: 'Liga',
    market: 'Más de 2.5 goles', probability: 0.62, entryOdds: 1.95
  });
  const saved = service.actualizarPrediccion(prediction.id, { outcome: 'win', closingOdds: '1.80' });
  assert.equal(saved.outcome, 'win');
  assert.equal(saved.closingOdds, 1.8);
});

test('rechaza imports vacíos y el borrado limpia las claves locales', () => {
  const { service, data } = createService();
  assert.throws(() => service.importarPartidos([]), /no contiene partidos/);
  service.importarPartidos([match()]);
  service.borrarDatosLocales();
  assert.equal(service.obtenerTodosLosPartidos().length, 0);
  assert.equal(data.size, 0);
});


test('detecta cambio de alineación a confirmada al reimportar', () => {
  const { service } = createService();
  service.importarPartidos([match()]);
  const confirmed = match();
  confirmed.context.lineupsStatus = 'confirmed';
  const imported = service.importarPartidos([confirmed]);
  assert.equal(imported.contextAlerts.length, 1);
  assert.equal(imported.contextAlerts[0].type, 'lineup');
  assert.equal(service.obtenerAlertasContexto().length, 1);
});
