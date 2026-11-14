/**
 * StatsPro — Motor cuantitativo v5.0
 * Poisson + Dixon-Coles para goles, Binomial Negativa para córners, tarjetas y remates.
 */
(function (root) {
  'use strict';

  const MIN_SAMPLE = 3;
  const MAX_SAMPLE = 20;
  const DECAY = 0.92;
  const PRIOR_STRENGTH = 4;
  const MIN_BOOKMAKERS = 3;
  const VALUE_EV_THRESHOLD = 4;
  const VALUE_EDGE_THRESHOLD = 4;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
  const positive = value => isFiniteNumber(value) && value > 0;

  function factorial(n) {
    if (!Number.isInteger(n) || n < 0) return NaN;
    let value = 1;
    for (let i = 2; i <= n; i += 1) value *= i;
    return value;
  }

  function poissonPMF(lambda, k) {
    if (!positive(lambda) || !Number.isInteger(k) || k < 0) {
      return lambda === 0 && k === 0 ? 1 : 0;
    }
    return Math.exp(k * Math.log(lambda) - lambda - Math.log(factorial(k)));
  }

  function logGamma(z) {
    const coefficients = [
      676.5203681218851, -1259.1392167224028, 771.3234287776531,
      -176.6150291621406, 12.507343278686905, -0.13857109526572012,
      9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    const shifted = z - 1;
    let x = 0.99999999999980993;
    for (let i = 0; i < coefficients.length; i += 1) x += coefficients[i] / (shifted + i + 1);
    const t = shifted + coefficients.length - 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
  }

  function negativeBinomialPMF(mean, size, k) {
    if (!positive(size) || !isFiniteNumber(mean) || mean < 0 || !Number.isInteger(k) || k < 0) return 0;
    if (mean === 0) return k === 0 ? 1 : 0;
    const p = size / (size + mean);
    const logProbability = logGamma(k + size) - logGamma(size) - logGamma(k + 1)
      + size * Math.log(p) + k * Math.log1p(-p);
    return Math.exp(logProbability);
  }

  function distributionTailOver(mean, size, line) {
    if (!isFiniteNumber(mean) || mean < 0 || !positive(size) || !isFiniteNumber(line)) {
      return { probability: null, reason: 'Parámetros insuficientes para binomial negativa.' };
    }
    const threshold = Math.floor(line);
    let under = 0;
    for (let k = 0; k <= threshold; k += 1) under += negativeBinomialPMF(mean, size, k);
    return { probability: clamp(1 - under, 0, 1), distribution: 'binomial_negativa' };
  }

  function convolve(a, b, maxCount = 100) {
    const output = new Array(maxCount + 1).fill(0);
    for (let i = 0; i < a.length; i += 1) {
      if (!a[i]) continue;
      for (let j = 0; j < b.length && i + j <= maxCount; j += 1) {
        output[i + j] += a[i] * b[j];
      }
    }
    return output;
  }

  function negativeBinomialDistribution(mean, size, maxCount = 100) {
    return Array.from({ length: maxCount + 1 }, (_, k) => negativeBinomialPMF(mean, size, k));
  }

  function distributionOver(distribution, line) {
    const threshold = Math.floor(line);
    let under = 0;
    for (let k = 0; k <= threshold && k < distribution.length; k += 1) under += distribution[k] || 0;
    return clamp(1 - under, 0, 1);
  }

  function orderedHistory(history, venue) {
    if (!Array.isArray(history)) return [];
    return history
      .filter(row => row && (venue ? row.venue === venue : true))
      .slice()
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, MAX_SAMPLE);
  }

  function validRows(history, venue, requiredFields) {
    return orderedHistory(history, venue).filter(row => requiredFields.every(field => isFiniteNumber(row[field]) && row[field] >= 0));
  }

  function weightedMean(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    let weighted = 0;
    let weights = 0;
    values.forEach((value, index) => {
      const weight = Math.pow(DECAY, index);
      weighted += value * weight;
      weights += weight;
    });
    return weights > 0 ? weighted / weights : null;
  }

  function weightedMetric(rows, field) {
    return weightedMean(rows.map(row => row[field]));
  }

  function shrinkRatio(observed, baseline, sampleSize) {
    if (!positive(baseline) || !isFiniteNumber(observed) || sampleSize <= 0) return null;
    const ratio = observed / baseline;
    return (ratio * sampleSize + PRIOR_STRENGTH) / (sampleSize + PRIOR_STRENGTH);
  }

  function sampleSummary(team, venue, fields) {
    const rows = validRows(team && team.history, venue, fields);
    return {
      rows,
      count: rows.length,
      values: Object.fromEntries(fields.map(field => [field, weightedMetric(rows, field)]))
    };
  }

  function validateMatch(match) {
    const errors = [];
    if (!match || typeof match !== 'object') return { ok: false, errors: ['Partido no válido.'] };
    if (!match.leagueProfile || typeof match.leagueProfile !== 'object') errors.push('Falta leagueProfile con promedios de la competición.');
    if (!match.local || !Array.isArray(match.local.history)) errors.push('Falta el historial del equipo local.');
    if (!match.visita || !Array.isArray(match.visita.history)) errors.push('Falta el historial del equipo visitante.');
    const profile = match.leagueProfile || {};
    ['avgHomeXG', 'avgAwayXG'].forEach(key => {
      if (!positive(profile[key])) errors.push(`Falta leagueProfile.${key}.`);
    });
    const home = sampleSummary(match.local || {}, 'home', ['xGFor', 'xGAgainst']);
    const away = sampleSummary(match.visita || {}, 'away', ['xGFor', 'xGAgainst']);
    if (home.count < MIN_SAMPLE) errors.push(`El local tiene ${home.count}/${MIN_SAMPLE} partidos válidos como local.`);
    if (away.count < MIN_SAMPLE) errors.push(`El visitante tiene ${away.count}/${MIN_SAMPLE} partidos válidos como visitante.`);
    return { ok: errors.length === 0, errors, homeSample: home.count, awaySample: away.count };
  }

  function applyContext(lambdaHome, lambdaAway, match) {
    const context = match.context || {};
    const adjustments = [];
    const restFactor = days => {
      if (!isFiniteNumber(days)) return 1;
      return 1 + clamp((days - 5) * 0.012, -0.05, 0.05);
    };
    const homeRestFactor = restFactor(context.homeRestDays);
    const awayRestFactor = restFactor(context.awayRestDays);
    lambdaHome *= homeRestFactor;
    lambdaAway *= awayRestFactor;
    if (isFiniteNumber(context.homeRestDays) || isFiniteNumber(context.awayRestDays)) {
      adjustments.push(`Descanso: local ×${homeRestFactor.toFixed(3)}, visitante ×${awayRestFactor.toFixed(3)}.`);
    }

    if (isFiniteNumber(context.awayTravelKm) && context.awayTravelKm > 0) {
      const travelFactor = 1 - clamp(context.awayTravelKm / 5000, 0, 0.04);
      lambdaAway *= travelFactor;
      adjustments.push(`Viaje visitante (${Math.round(context.awayTravelKm)} km): ×${travelFactor.toFixed(3)}.`);
    }

    if (isFiniteNumber(context.venueAltitudeM) && isFiniteNumber(context.awayHomeAltitudeM)) {
      const altitudeDifference = Math.max(0, context.venueAltitudeM - context.awayHomeAltitudeM - 1000);
      const altitudeFactor = 1 - clamp((altitudeDifference / 1000) * 0.015, 0, 0.04);
      lambdaAway *= altitudeFactor;
      if (altitudeDifference > 0) adjustments.push(`Altitud relativa visitante: ×${altitudeFactor.toFixed(3)}.`);
    }

    if (isFiniteNumber(context.homeAbsenceXGImpact) && context.homeAbsenceXGImpact > 0) {
      lambdaHome = Math.max(0, lambdaHome - context.homeAbsenceXGImpact);
      adjustments.push(`Bajas local: −${context.homeAbsenceXGImpact.toFixed(2)} xG.`);
    }
    if (isFiniteNumber(context.awayAbsenceXGImpact) && context.awayAbsenceXGImpact > 0) {
      lambdaAway = Math.max(0, lambdaAway - context.awayAbsenceXGImpact);
      adjustments.push(`Bajas visitante: −${context.awayAbsenceXGImpact.toFixed(2)} xG.`);
    }

    const homeWeather = isFiniteNumber(context.homeWeatherFactor) ? clamp(context.homeWeatherFactor, 0.9, 1.1) : 1;
    const awayWeather = isFiniteNumber(context.awayWeatherFactor) ? clamp(context.awayWeatherFactor, 0.9, 1.1) : 1;
    lambdaHome *= homeWeather;
    lambdaAway *= awayWeather;
    if (homeWeather !== 1 || awayWeather !== 1) adjustments.push('Clima: multiplicadores aplicados.');

    return { lambdaHome, lambdaAway, adjustments };
  }

  function dixonColesMatrix(lambdaHome, lambdaAway, rho) {
    const maxGoal = Math.min(20, Math.max(12, Math.ceil(Math.max(lambdaHome, lambdaAway) + 8 * Math.sqrt(Math.max(lambdaHome, lambdaAway) + 1))));
    const matrix = [];
    let total = 0;
    for (let homeGoals = 0; homeGoals <= maxGoal; homeGoals += 1) {
      const row = [];
      for (let awayGoals = 0; awayGoals <= maxGoal; awayGoals += 1) {
        let tau = 1;
        if (homeGoals === 0 && awayGoals === 0) tau = 1 - lambdaHome * lambdaAway * rho;
        else if (homeGoals === 0 && awayGoals === 1) tau = 1 + lambdaHome * rho;
        else if (homeGoals === 1 && awayGoals === 0) tau = 1 + lambdaAway * rho;
        else if (homeGoals === 1 && awayGoals === 1) tau = 1 - rho;
        if (tau <= 0) throw new Error('El parámetro Dixon–Coles produce una corrección no positiva.');
        const probability = poissonPMF(lambdaHome, homeGoals) * poissonPMF(lambdaAway, awayGoals) * tau;
        row.push(probability);
        total += probability;
      }
      matrix.push(row);
    }
    if (!positive(total)) throw new Error('No se pudo normalizar la matriz de marcadores.');
    for (let i = 0; i < matrix.length; i += 1) {
      for (let j = 0; j < matrix[i].length; j += 1) matrix[i][j] /= total;
    }
    return matrix;
  }

  function probabilitiesFromMatrix(matrix) {
    let homeWin = 0;
    let draw = 0;
    let awayWin = 0;
    let bttsYes = 0;
    let goalsOver15 = 0;
    let goalsOver25 = 0;
    let goalsOver35 = 0;
    let total = 0;
    for (let h = 0; h < matrix.length; h += 1) {
      for (let a = 0; a < matrix[h].length; a += 1) {
        const p = matrix[h][a];
        total += p;
        if (h > a) homeWin += p;
        else if (h === a) draw += p;
        else awayWin += p;
        if (h > 0 && a > 0) bttsYes += p;
        if (h + a > 1.5) goalsOver15 += p;
        if (h + a > 2.5) goalsOver25 += p;
        if (h + a > 3.5) goalsOver35 += p;
      }
    }
    return {
      homeWin: homeWin / total,
      draw: draw / total,
      awayWin: awayWin / total,
      doubleChance1X: (homeWin + draw) / total,
      doubleChanceX2: (awayWin + draw) / total,
      doubleChance12: (homeWin + awayWin) / total,
      bttsYes: bttsYes / total,
      goalsOver15: goalsOver15 / total,
      goalsOver25: goalsOver25 / total,
      goalsOver35: goalsOver35 / total
    };
  }

  function dispersionFromProfile(profile, key) {
    const direct = profile && profile[key];
    return positive(direct) ? direct : null;
  }

  function estimateDispersion(rowsA, rowsB, field) {
    const values = [...rowsA, ...rowsB].map(row => row[field]).filter(value => isFiniteNumber(value) && value >= 0);
    if (values.length < 2) return 14;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (values.length - 1);
    if (variance <= mean || mean === 0) return 18;
    return clamp((mean * mean) / (variance - mean), 1.5, 80);
  }

  function buildCountMetric(match, kind) {
    const profile = match.leagueProfile || {};
    const homeFields = kind === 'corners' ? ['cornersFor', 'cornersAgainst'] : ['cards'];
    const awayFields = kind === 'corners' ? ['cornersFor', 'cornersAgainst'] : ['cards'];
    // Acepta filas en sede específica o generales para aprovechar al máximo las actas descargadas
    let homeRows = validRows(match.local.history, 'home', homeFields);
    if (homeRows.length === 0) homeRows = validRows(match.local.history, null, homeFields);
    let awayRows = validRows(match.visita.history, 'away', awayFields);
    if (awayRows.length === 0) awayRows = validRows(match.visita.history, null, awayFields);

    if (homeRows.length < 1 || awayRows.length < 1) {
      return { available: false, reason: `${kind === 'corners' ? 'Córners' : 'Tarjetas'}: sin actas estadísticas disponibles para este encuentro.` };
    }

    let lambdaHome;
    let lambdaAway;
    if (kind === 'corners') {
      const avgHC = positive(profile.avgHomeCorners) ? profile.avgHomeCorners : 5.15;
      const avgAC = positive(profile.avgAwayCorners) ? profile.avgAwayCorners : 4.25;
      const homeAttack = shrinkRatio(weightedMetric(homeRows, 'cornersFor'), avgHC, homeRows.length);
      const awayDefence = shrinkRatio(weightedMetric(awayRows, 'cornersAgainst'), avgHC, awayRows.length);
      const awayAttack = shrinkRatio(weightedMetric(awayRows, 'cornersFor'), avgAC, awayRows.length);
      const homeDefence = shrinkRatio(weightedMetric(homeRows, 'cornersAgainst'), avgAC, homeRows.length);
      lambdaHome = avgHC * homeAttack * awayDefence;
      lambdaAway = avgAC * awayAttack * homeDefence;
    } else {
      const avgHT = positive(profile.avgHomeCards) ? profile.avgHomeCards : 2.15;
      const avgAT = positive(profile.avgAwayCards) ? profile.avgAwayCards : 2.35;
      const homeCardsRatio = shrinkRatio(weightedMetric(homeRows, 'cards'), avgHT, homeRows.length);
      const awayCardsRatio = shrinkRatio(weightedMetric(awayRows, 'cards'), avgAT, awayRows.length);
      lambdaHome = avgHT * homeCardsRatio;
      lambdaAway = avgAT * awayCardsRatio;
      const referee = match.referee;
      const leagueTotal = avgHT + avgAT;
      if (referee && positive(referee.avgCards) && isFiniteNumber(referee.sampleSize) && referee.sampleSize >= MIN_SAMPLE) {
        const refereeFactor = referee.avgCards / leagueTotal;
        const blendedFactor = 1 + (refereeFactor - 1) * (referee.sampleSize / (referee.sampleSize + 10));
        lambdaHome *= blendedFactor;
        lambdaAway *= blendedFactor;
      }
    }

    const dispersionKey = kind === 'corners' ? 'dispersionCorners' : 'dispersionCards';
    const sizeFromProfile = dispersionFromProfile(profile, dispersionKey);
    const sizeHome = sizeFromProfile || estimateDispersion(homeRows, awayRows, kind === 'corners' ? 'cornersFor' : 'cards');
    const sizeAway = sizeHome;

    const maxCount = 100;
    const homeDistribution = negativeBinomialDistribution(lambdaHome, sizeHome, maxCount);
    const awayDistribution = negativeBinomialDistribution(lambdaAway, sizeAway, maxCount);
    const totalDistribution = convolve(homeDistribution, awayDistribution, maxCount);
    const ladders = kind === 'corners' ? [6.5, 7.5, 8.5, 9.5, 10.5] : [2.5, 3.5, 4.5, 5.5, 6.5];
    return {
      available: true,
      lambdaHome,
      lambdaAway,
      lambdaTotal: lambdaHome + lambdaAway,
      distribution: 'binomial_negativa',
      dispersion: sizeHome,
      dispersionSource: sizeFromProfile ? 'perfil de liga' : 'estimación de muestra',
      ladders: ladders.map(line => ({ line, probability: distributionOver(totalDistribution, line), fairOdds: distributionOver(totalDistribution, line) > 0 ? 1 / distributionOver(totalDistribution, line) : null }))
    };
  }

  const MARKET_CONFIG = {
    result_home: { sourceMarket: 'result_1x2', sides: ['home', 'draw', 'away'], targetSide: 'home', probabilityKey: 'homeWin', label: 'Victoria local' },
    result_draw: { sourceMarket: 'result_1x2', sides: ['home', 'draw', 'away'], targetSide: 'draw', probabilityKey: 'draw', label: 'Empate' },
    result_away: { sourceMarket: 'result_1x2', sides: ['home', 'draw', 'away'], targetSide: 'away', probabilityKey: 'awayWin', label: 'Victoria visitante' },
    goals_2_5: { sourceMarket: 'goals_2_5', sides: ['over', 'under'], targetSide: 'over', probabilityKey: 'goalsOver25', label: 'Más de 2.5 goles' },
    btts: { sourceMarket: 'btts', sides: ['yes', 'no'], targetSide: 'yes', probabilityKey: 'bttsYes', label: 'Ambos equipos anotan' },
    corners_8_5: { sourceMarket: 'corners_8_5', sides: ['over', 'under'], targetSide: 'over', probabilityKey: 'cornersOver85', label: 'Más de 8.5 córners' }
  };

  function evaluateOdds(match, probabilities, sampleValid, cornersMetric) {
    const odds = Array.isArray(match.odds) ? match.odds : [];
    return Object.entries(MARKET_CONFIG).map(([market, config]) => {
      const modelProbability = market === 'corners_8_5'
        ? (cornersMetric && cornersMetric.available ? cornersMetric.ladders.find(item => item.line === 8.5)?.probability : null)
        : probabilities[config.probabilityKey];
      if (!sampleValid || !isFiniteNumber(modelProbability)) {
        return { market, label: config.label, available: false, reason: 'El modelo no tiene una probabilidad válida para este mercado.' };
      }

      const groups = new Map();
      odds.forEach(entry => {
        if (!entry || entry.market !== config.sourceMarket || !entry.bookmaker || !config.sides.includes(entry.side) || !positive(entry.price)) return;
        const bookmaker = String(entry.bookmaker).trim();
        const key = bookmaker.toLowerCase();
        if (!groups.has(key)) groups.set(key, { bookmaker, prices: {} });
        groups.get(key).prices[entry.side] = entry.price;
      });

      const fairProbabilities = [];
      const targetPrices = [];
      groups.forEach(group => {
        if (!config.sides.every(side => positive(group.prices[side]))) return;
        const implied = Object.fromEntries(config.sides.map(side => [side, 1 / group.prices[side]]));
        const total = Object.values(implied).reduce((sum, value) => sum + value, 0);
        fairProbabilities.push(implied[config.targetSide] / total);
        targetPrices.push({ bookmaker: group.bookmaker, price: group.prices[config.targetSide] });
      });

      if (fairProbabilities.length < MIN_BOOKMAKERS) {
        return {
          market, label: config.label, available: false,
          reason: `Se necesitan al menos ${MIN_BOOKMAKERS} casas con ambos lados del mercado; hay ${fairProbabilities.length}.`
        };
      }

      const consensusNoVig = fairProbabilities.reduce((sum, value) => sum + value, 0) / fairProbabilities.length;
      const best = targetPrices.reduce((current, item) => !current || item.price > current.price ? item : current, null);
      const evPercent = (modelProbability * best.price - 1) * 100;
      const edgePercent = (modelProbability - consensusNoVig) * 100;
      return {
        market,
        label: config.label,
        available: true,
        modelProbability,
        consensusNoVig,
        bestOdds: best.price,
        bestBookmaker: best.bookmaker,
        bookmakersCount: fairProbabilities.length,
        evPercent,
        edgePercent,
        isValue: evPercent >= VALUE_EV_THRESHOLD && edgePercent >= VALUE_EDGE_THRESHOLD,
        fairOdds: 1 / modelProbability
      };
    });
  }

  function playerCountDispersion(values) {
    if (!Array.isArray(values) || values.length < MIN_SAMPLE) return null;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (values.length - 1);
    if (variance <= mean || mean === 0) return 20;
    return clamp((mean * mean) / (variance - mean), 0.5, 100);
  }

  function analyzePlayers(players) {
    if (!Array.isArray(players)) return [];
    return players.map(player => {
      const status = player.status || 'available';
      if (status === 'injured' || status === 'suspended') {
        return { name: player.name || 'Jugador', team: player.team || '', status, available: false, sampleSize: 0, reason: status === 'injured' ? 'Jugador marcado como lesionado; no se proyectan sus remates.' : 'Jugador marcado como suspendido; no se proyectan sus remates.' };
      }
      const history = Array.isArray(player.history) ? player.history.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, MAX_SAMPLE) : [];
      const valid = history.filter(row => isFiniteNumber(row.shotsOnTarget) && row.shotsOnTarget >= 0 && isFiniteNumber(row.shotsTotal) && row.shotsTotal >= 0);
      if (valid.length < MIN_SAMPLE) {
        return { name: player.name || 'Jugador', team: player.team || '', status, available: false, sampleSize: valid.length, reason: `Muestra insuficiente: ${valid.length}/${MIN_SAMPLE} partidos del jugador.` };
      }
      const meanOnTarget = weightedMean(valid.map(row => row.shotsOnTarget));
      const meanTotal = weightedMean(valid.map(row => row.shotsTotal));
      const dispersionOnTarget = playerCountDispersion(valid.map(row => row.shotsOnTarget));
      const dispersionTotal = playerCountDispersion(valid.map(row => row.shotsTotal));
      const lines = [0.5, 1.5, 2.5];
      return {
        name: player.name || 'Jugador', team: player.team || '', status,
        available: true, sampleSize: valid.length,
        meanOnTarget, meanTotal, dispersionOnTarget, dispersionTotal,
        onTargetLadder: lines.map(line => ({ line, probability: distributionTailOver(meanOnTarget, dispersionOnTarget, line).probability })),
        totalLadder: lines.map(line => ({ line, probability: distributionTailOver(meanTotal, dispersionTotal, line).probability }))
      };
    });
  }

  function obtenerPronosticoPrincipal(probabilities) {
    if (!probabilities) return null;
    const candidatos = [
      { key: 'homeWin', label: `Gana Local`, prob: probabilities.homeWin },
      { key: 'awayWin', label: `Gana Visita`, prob: probabilities.awayWin },
      { key: 'doubleChance1X', label: `Doble Oport. 1X`, prob: probabilities.doubleChance1X },
      { key: 'doubleChanceX2', label: `Doble Oport. X2`, prob: probabilities.doubleChanceX2 },
      { key: 'goalsOver15', label: `+1.5 Goles`, prob: probabilities.goalsOver15 },
      { key: 'goalsOver25', label: `+2.5 Goles`, prob: probabilities.goalsOver25 }
    ];
    // Priorizar mercado directo con alta probabilidad (≥ 62%) o la doble oportunidad / +1.5 más sólida
    const directos = candidatos.filter(c => ['homeWin', 'awayWin', 'goalsOver25'].includes(c.key) && c.prob >= 0.62);
    if (directos.length) {
      directos.sort((a, b) => b.prob - a.prob);
      return directos[0];
    }
    const seguros = candidatos.filter(c => ['doubleChance1X', 'doubleChanceX2', 'goalsOver15'].includes(c.key));
    seguros.sort((a, b) => b.prob - a.prob);
    return seguros[0] || candidatos[0];
  }

  function evaluarResultadoPronostico(pickKey, result) {
    if (!result || !Number.isInteger(result.homeGoals) || !Number.isInteger(result.awayGoals)) return null;
    const h = result.homeGoals;
    const a = result.awayGoals;
    if (pickKey === 'homeWin') return h > a;
    if (pickKey === 'draw') return h === a;
    if (pickKey === 'awayWin') return a > h;
    if (pickKey === 'doubleChance1X') return h >= a;
    if (pickKey === 'doubleChanceX2') return a >= h;
    if (pickKey === 'doubleChance12') return h !== a;
    if (pickKey === 'goalsOver15') return (h + a) > 1.5;
    if (pickKey === 'goalsOver25') return (h + a) > 2.5;
    if (pickKey === 'bttsYes') return h > 0 && a > 0;
    return null;
  }

  function tacticalReport(match, model) {
    const home = match.local.name || 'Local';
    const away = match.visita.name || 'Visitante';
    const report = [];
    const homeAttack = model.strength.homeAttack;
    const awayAttack = model.strength.awayAttack;
    const homeDefence = model.strength.homeDefence;
    const awayDefence = model.strength.awayDefence;
    const formatStrength = value => `${((value - 1) * 100) >= 0 ? '+' : ''}${((value - 1) * 100).toFixed(1)}%`;

    report.push({ type: 'pro', text: `${home}: fuerza ofensiva local ${formatStrength(homeAttack)} frente al promedio; xG esperado ${model.lambdaHome.toFixed(2)}.` });
    report.push({ type: 'against', text: `${away}: vulnerabilidad defensiva visitante ${formatStrength(awayDefence)} frente al promedio recibido.` });
    report.push({ type: 'pro', text: `${away}: fuerza ofensiva visitante ${formatStrength(awayAttack)}; ${home} concede ${formatStrength(homeDefence)} respecto al promedio.` });
    report.push({ type: 'neutral', text: `Proyección total: ${model.lambdaTotal.toFixed(2)} goles esperados (Dixon–Coles ρ = ${model.rho.toFixed(3)}).` });
    if (model.corners && model.corners.available) {
      report.push({ type: 'pro', text: `Córners proyectados: ${model.corners.lambdaTotal.toFixed(1)} totales (${home} ${model.corners.lambdaHome.toFixed(1)} · ${away} ${model.corners.lambdaAway.toFixed(1)}).` });
    }
    if (model.cards && model.cards.available) {
      report.push({ type: 'neutral', text: `Tarjetas proyectadas: ${model.cards.lambdaTotal.toFixed(1)} totales (${home} ${model.cards.lambdaHome.toFixed(1)} · ${away} ${model.cards.lambdaAway.toFixed(1)}).` });
    }
    if (model.contextAdjustments.length) model.contextAdjustments.forEach(text => report.push({ type: 'neutral', text }));
    const context = match.context || {};
    if (context.lineupsStatus !== 'confirmed') report.push({ type: 'against', text: 'Alineaciones no confirmadas: las probabilidades son prepartido.' });
    if (context.injuriesNote) report.push({ type: 'neutral', text: `Lesiones reportadas: ${context.injuriesNote}.` });
    if (context.suspensionsNote) report.push({ type: 'neutral', text: `Suspensiones reportadas: ${context.suspensionsNote}.` });
    return report;
  }

  function ladder(lambda, lines, distribution = 'poisson', dispersion = null) {
    return lines.map(line => {
      const probability = distribution === 'binomial_negativa'
        ? distributionTailOver(lambda, dispersion, line).probability
        : (() => {
          let under = 0;
          for (let k = 0; k <= Math.floor(line); k += 1) under += poissonPMF(lambda, k);
          return clamp(1 - under, 0, 1);
        })();
      return {
        label: `Más de ${line}`,
        line,
        probability,
        percent: probability * 100,
        fairOdds: probability > 0 ? 1 / probability : null
      };
    });
  }

  const MotorEstadistico = {
    MIN_SAMPLE,
    MIN_BOOKMAKERS,
    factorial,
    poissonExacto: poissonPMF,
    poissonPMF,
    negativeBinomialPMF,
    distributionTailOver,
    promedioPonderado: weightedMean,
    analizarJugadores: analyzePlayers,
    obtenerPronosticoPrincipal,
    evaluarResultadoPronostico,

    formatearCuota(value, format = 'decimal') {
      const odds = Number(value);
      if (!positive(odds) || odds <= 1) return '—';
      if (format === 'decimal') return odds.toFixed(2);
      if (odds >= 2) return `+${Math.round((odds - 1) * 100)}`;
      return `-${Math.round(100 / (odds - 1))}`;
    },

    analizarPartido(match) {
      const validation = validateMatch(match);
      if (!validation.ok) return { status: 'insufficient_data', validation, missing: validation.errors };

      try {
        const profile = match.leagueProfile;
        const home = sampleSummary(match.local, 'home', ['xGFor', 'xGAgainst']);
        const away = sampleSummary(match.visita, 'away', ['xGFor', 'xGAgainst']);
        const homeAttack = shrinkRatio(home.values.xGFor, profile.avgHomeXG, home.count);
        const awayDefence = shrinkRatio(away.values.xGAgainst, profile.avgHomeXG, away.count);
        const awayAttack = shrinkRatio(away.values.xGFor, profile.avgAwayXG, away.count);
        const homeDefence = shrinkRatio(home.values.xGAgainst, profile.avgAwayXG, home.count);

        let lambdaHome = profile.avgHomeXG * homeAttack * awayDefence;
        let lambdaAway = profile.avgAwayXG * awayAttack * homeDefence;
        const contextAdjusted = applyContext(lambdaHome, lambdaAway, match);
        lambdaHome = contextAdjusted.lambdaHome;
        lambdaAway = contextAdjusted.lambdaAway;

        let h2hUsed = false;
        if (Array.isArray(match.h2h) && match.h2h.length >= 3) {
          const h2h = match.h2h.slice(0, 10).filter(row => (positive(row.homeXG) || row.homeXG === 0) && (positive(row.awayXG) || row.awayXG === 0));
          if (h2h.length >= 3) {
            const h2hHome = weightedMean(h2h.map(row => row.homeXG));
            const h2hAway = weightedMean(h2h.map(row => row.awayXG));
            const weight = clamp(isFiniteNumber(profile.h2hWeight) ? profile.h2hWeight : 0.05, 0, 0.05);
            lambdaHome = lambdaHome * (1 - weight) + h2hHome * weight;
            lambdaAway = lambdaAway * (1 - weight) + h2hAway * weight;
            h2hUsed = weight > 0;
          }
        }

        if (!positive(lambdaHome) || !positive(lambdaAway)) {
          return { status: 'insufficient_data', validation, missing: ['Las tasas xG esperadas no son positivas tras los ajustes.'] };
        }

        const rho = isFiniteNumber(profile.dixonColesRho) ? profile.dixonColesRho : -0.08;
        if (rho <= -0.25 || rho >= 0.25) {
          return { status: 'invalid_model', validation, missing: ['dixonColesRho debe estar entre -0.25 y 0.25.'] };
        }
        const scoreMatrix = dixonColesMatrix(lambdaHome, lambdaAway, rho);
        const probabilities = probabilitiesFromMatrix(scoreMatrix);
        const corners = buildCountMetric(match, 'corners');
        const cards = buildCountMetric(match, 'cards');
        const topPick = obtenerPronosticoPrincipal(probabilities);
        const verifiedHit = topPick ? evaluarResultadoPronostico(topPick.key, match.result) : null;

        const values = evaluateOdds(match, {
          ...probabilities,
          cornersOver85: corners.available ? corners.ladders.find(item => item.line === 8.5).probability : null
        }, true, corners);

        const model = {
          status: 'ok',
          validation,
          sample: { home: home.count, away: away.count, maximum: MAX_SAMPLE },
          league: match.league || 'Competición sin nombre',
          lambdaHome,
          lambdaAway,
          lambdaTotal: lambdaHome + lambdaAway,
          rho,
          dixonColes: true,
          probabilities,
          topPick,
          verifiedHit,
          fairOdds: Object.fromEntries(Object.entries(probabilities).map(([key, value]) => [key, value > 0 ? 1 / value : null])),
          goalLadder: ladder(lambdaHome + lambdaAway, [0.5, 1.5, 2.5, 3.5, 4.5]),
          corners,
          cards,
          players: analyzePlayers(match.players),
          oddsEvaluation: values,
          valueSignals: values.filter(item => item.available && item.isValue),
          strength: { homeAttack, awayDefence, awayAttack, homeDefence },
          contextAdjustments: contextAdjusted.adjustments,
          h2hUsed,
          lineupStatus: (match.context || {}).lineupsStatus || 'unconfirmed',
          tacticalReport: null
        };
        model.tacticalReport = tacticalReport(match, model);
        return model;
      } catch (error) {
        return { status: 'invalid_model', validation, missing: [error.message || 'No se pudo calcular el modelo.'] };
      }
    },

    calcularKelly(probability, decimalOdds, bankroll, fraction = 0.25, maxBankrollShare = 0.02) {
      if (!isFiniteNumber(probability) || probability <= 0 || probability >= 1 || !positive(decimalOdds) || decimalOdds <= 1 || !positive(bankroll)) {
        return { available: false, reason: 'Introduce una probabilidad, cuota decimal y banca válidas.' };
      }
      const b = decimalOdds - 1;
      const q = 1 - probability;
      const fullKelly = Math.max(0, (b * probability - q) / b);
      const recommendedFraction = Math.min(fullKelly * clamp(fraction, 0, 1), maxBankrollShare);
      return {
        available: true,
        fullKelly,
        fractionalKelly: recommendedFraction,
        stake: bankroll * recommendedFraction,
        bankrollShare: recommendedFraction,
        capApplied: fullKelly * fraction > maxBankrollShare
      };
    },

    backtest(fixtures) {
      if (!Array.isArray(fixtures)) return { count: 0, hitCount: 0, accuracyPercent: null, reason: 'Se requiere un arreglo de partidos históricos.' };
      const scored = [];
      let hitCount = 0;
      let verifiedCount = 0;

      fixtures.forEach(match => {
        if (!match || !match.result || !Number.isInteger(match.result.homeGoals) || !Number.isInteger(match.result.awayGoals)) return;
        const model = this.analizarPartido(match);
        if (model.status !== 'ok') return;
        if (typeof model.verifiedHit === 'boolean') {
          verifiedCount += 1;
          if (model.verifiedHit) hitCount += 1;
        }
        const result = match.result;
        const actual = {
          goalsOver25: result.homeGoals + result.awayGoals > 2.5 ? 1 : 0,
          bttsYes: result.homeGoals > 0 && result.awayGoals > 0 ? 1 : 0,
          homeWin: result.homeGoals > result.awayGoals ? 1 : 0,
          draw: result.homeGoals === result.awayGoals ? 1 : 0,
          awayWin: result.homeGoals < result.awayGoals ? 1 : 0
        };
        const brier = {};
        Object.keys(actual).forEach(key => {
          brier[key] = Math.pow(model.probabilities[key] - actual[key], 2);
        });
        scored.push({ id: match.id, fixture: `${match.local.name} vs ${match.visita.name}`, brier, model });
      });
      const keys = [...new Set(scored.flatMap(item => Object.keys(item.brier)))];
      const metrics = Object.fromEntries(keys.map(key => {
        const values = scored.map(item => item.brier[key]).filter(isFiniteNumber);
        return [key, { sampleSize: values.length, brier: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null }];
      }));
      return {
        count: scored.length,
        verifiedCount,
        hitCount,
        accuracyPercent: verifiedCount > 0 ? (hitCount / verifiedCount) * 100 : null,
        metrics,
        matches: scored
      };
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MotorEstadistico;
  root.MotorEstadistico = MotorEstadistico;
})(typeof window !== 'undefined' ? window : globalThis);
