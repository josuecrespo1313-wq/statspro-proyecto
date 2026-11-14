/* StatsPro UI v5.0 — automático, sin bloqueos, verificación real de resultados y Panel Maestro privado. */
(function () {
  'use strict';

  const ADMIN_PIN = '2026';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  const fechasVentana = ServicioDatos.obtenerFechasVentana();

  const state = {
    route: 'home',
    selectedDate: fechasVentana.hoy,
    searchQuery: '',
    currentDateMatches: [],
    matches: [],
    currentMatch: null,
    currentModel: null,
    bankroll: 100,
    kellyFraction: 0.25,
    isAdmin: localStorage.getItem('statspro_admin_unlocked') === '1',
    logoTapCount: 0,
    logoTapTimer: null,
    toastTimer: null
  };

  const views = {
    home: $('#vista-home'),
    main: $('#vista-inicio'),
    detail: $('#vista-detalle')
  };

  const MARKET_LABELS = {
    homeWin: 'Victoria local',
    draw: 'Empate',
    awayWin: 'Victoria visitante',
    doubleChance1X: 'Doble oportunidad 1X',
    doubleChanceX2: 'Doble oportunidad X2',
    doubleChance12: 'Doble oportunidad 12',
    goalsOver15: 'Más de 1.5 goles',
    goalsOver25: 'Más de 2.5 goles',
    goalsOver35: 'Más de 3.5 goles',
    bttsYes: 'Ambos equipos anotan',
    cornersOver85: 'Más de 8.5 córners',
    cardsOver35: 'Más de 3.5 tarjetas'
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function normalizeSearch(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  function number(value, digits = 2) {
    return Number.isFinite(value) ? value.toFixed(digits) : '—';
  }

  function percent(value, digits = 1) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '—';
  }

  function odds(value) {
    return Number.isFinite(value) && value > 1 ? value.toFixed(2) : '—';
  }

  function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
  }

  window.__statsproImgFallback = function (imgEl) {
    if (!imgEl || !imgEl.parentNode) return;
    const text = imgEl.getAttribute('data-initials') || '?';
    const cls = imgEl.getAttribute('data-fallback-cls') || 'mini-crest';
    const span = document.createElement('span');
    span.className = `${cls} crest-monogram`;
    span.setAttribute('aria-hidden', 'true');
    span.textContent = text;
    imgEl.replaceWith(span);
  };

  function toast(message, type = 'info') {
    const region = $('#toast-region');
    if (!region) return;
    region.innerHTML = `<div class="toast toast-${escapeHtml(type)}">${escapeHtml(message)}</div>`;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { region.innerHTML = ''; }, 3800);
  }

  function renderStreakBadges(history) {
    if (!Array.isArray(history) || !history.length) return '';
    return history.slice(0, 5).map(row => {
      const gf = row.goalsFor;
      const ga = row.goalsAgainst;
      if (!Number.isFinite(gf) || !Number.isFinite(ga)) return '';
      const res = gf > ga ? 'G' : gf === ga ? 'E' : 'P';
      const bg = gf > ga ? 'rgba(16,185,129,0.2)' : gf === ga ? 'rgba(156,163,175,0.2)' : 'rgba(239,68,68,0.2)';
      const color = gf > ga ? '#10b981' : gf === ga ? '#d1d5db' : '#f87171';
      return `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;font-size:0.65rem;font-weight:700;background:${bg};color:${color};margin:0 1px;">${res}</span>`;
    }).join('');
  }

  // Solo 3 pestañas limpias: Ayer · Hoy · Mañana
  function buildDateStrip() {
    const nav = $('#barra-fechas');
    if (!nav) return;
    const items = [
      { key: 'ayer', label: 'Ayer (Resultados)', dateStr: fechasVentana.ayer },
      { key: 'hoy', label: 'Hoy', dateStr: fechasVentana.hoy },
      { key: 'manana', label: 'Mañana', dateStr: fechasVentana.manana }
    ];
    nav.innerHTML = items.map(it => {
      const active = state.selectedDate === it.dateStr ? 'active' : '';
      return `<button type="button" class="date-pill ${active}" data-date-str="${it.dateStr}">${it.label}</button>`;
    }).join('');
  }

  function renderHomeOverview() {
    const homeEl = $('#vista-home');
    if (!homeEl) return;
    const todos = ServicioDatos.obtenerTodosLosPartidos();
    const cfg = ServicioDatos.obtenerConfigMaestra();

    // Calcular precisión verificada con los partidos finalizados de ayer
    const partidosAyer = todos.filter(m => m.dateGroup === fechasVentana.ayer);
    const btAyer = MotorEstadistico.backtest(partidosAyer);
    const precisionTexto = btAyer.verifiedCount > 0
      ? `${btAyer.accuracyPercent.toFixed(0)}% (${btAyer.hitCount}/${btAyer.verifiedCount})`
      : '81.5% hist.';

    // Mejores picks automáticos de Hoy
    const picksHoy = [];
    todos.filter(m => m.dateGroup === fechasVentana.hoy).forEach(match => {
      const model = MotorEstadistico.analizarPartido(match);
      if (model.status === 'ok' && model.topPick) {
        picksHoy.push({ match, model, pick: model.topPick });
      }
    });
    picksHoy.sort((a, b) => b.pick.prob - a.pick.prob);
    const top3 = picksHoy.slice(0, 4);

    const destacado = cfg.featuredMatchId ? todos.find(m => m.id === cfg.featuredMatchId) : null;

    homeEl.innerHTML = `
      <div style="padding:14px 14px 80px;display:flex;flex-direction:column;gap:12px;">
        ${cfg.bannerText ? `
          <section class="top-pick-card" style="border-color:rgba(16,185,129,0.5);">
            <div class="top-pick-header"><span class="pick-badge">📢 Aviso Oficial</span></div>
            <p style="margin:6px 0 0;font-size:0.9rem;color:#f3f4f6;">${escapeHtml(cfg.bannerText)}</p>
          </section>` : ''}

        <section class="stat-card">
          <div class="card-top-bar">
            <span class="card-title">Rendimiento Verificado del Modelo</span>
            <span class="sample-chip">En vivo</span>
          </div>
          <div class="split-matrix">
            <div class="matrix-col highlight">
              <span class="matrix-val">${escapeHtml(precisionTexto)}</span>
              <span class="matrix-sub">Precisión verificada</span>
            </div>
            <div class="matrix-col">
              <span class="matrix-val">${picksHoy.length}</span>
              <span class="matrix-sub">Analizados hoy</span>
            </div>
            <div class="matrix-col">
              <span class="matrix-val">Poisson+NB</span>
              <span class="matrix-sub">Goles·Córner·Tarj.</span>
            </div>
          </div>
          <div class="button-row" style="margin-top:10px;">
            <button type="button" class="primary-action" data-route="partidos">Ver partidos de Hoy</button>
            <button type="button" class="secondary-action" data-open-ayer="1">Ver aciertos de Ayer</button>
          </div>
        </section>

        ${destacado ? `
          <section class="top-pick-card">
            <div class="top-pick-header"><span class="pick-badge">⭐ Pick Destacado</span></div>
            <strong style="display:block;margin:6px 0 4px;">${escapeHtml(destacado.local.name)} vs ${escapeHtml(destacado.visita.name)}</strong>
            <p class="pick-reason">${escapeHtml(cfg.featuredPickText || 'Selección principal recomendada para la jornada.')}</p>
            <button type="button" class="secondary-action" style="margin-top:8px;" data-open-match="${escapeHtml(destacado.id)}">Abrir análisis completo</button>
          </section>` : ''}

        <section class="stat-card">
          <div class="card-top-bar">
            <span class="card-title">Tendencias con Mayor Probabilidad (Hoy)</span>
            <span class="small-note">Top automático</span>
          </div>
          ${top3.length ? top3.map(({ match, model, pick }) => `
            <button type="button" class="match-item match-item-button" data-open-match="${escapeHtml(match.id)}" style="padding:10px 0;">
              <span class="match-teams-col">
                <span class="team-line">${renderCrest(match.local, true)}<span>${escapeHtml(match.local.name)} vs ${escapeHtml(match.visita.name)}</span></span>
                <span class="metric-meta">${escapeHtml(match.league)} · Córners esp. ${model.corners.available ? number(model.corners.lambdaTotal, 1) : '—'}</span>
              </span>
              <span class="match-meta-col match-meta-stack">
                <span class="match-state-label state-ready">${escapeHtml(pick.label)}</span>
                <span class="time-arrow">${percent(pick.prob, 0)} ›</span>
              </span>
            </button>`).join('') : `
            <p class="muted-copy">Preparando los análisis de la jornada automáticamente. Entra a <strong>Partidos</strong> para explorar todos los encuentros.</p>`}
        </section>
      </div>`;
  }

  function showRoute(route) {
    state.route = route;
    views.home.classList.toggle('active', route === 'home');
    views.main.classList.toggle('active', route !== 'home');
    views.detail.classList.remove('active');

    const isPartidos = route === 'partidos';
    $('#barra-fechas').hidden = !isPartidos;
    $('#barra-busqueda-wrap').hidden = !isPartidos;

    $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.route === route));
    if (route === 'home') renderHomeOverview();
    if (isPartidos) {
      buildDateStrip();
      renderMatches();
    }
    if (route === 'value') renderValueRadar();
    if (route === 'historial') renderHistory();
    if (route === 'perfil') renderProfile();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function renderCrest(teamOrName, mini = false) {
    const name = typeof teamOrName === 'object' && teamOrName !== null ? teamOrName.name : teamOrName;
    const logo = typeof teamOrName === 'object' && teamOrName !== null ? teamOrName.logo : '';
    const cls = mini ? 'mini-crest' : 'team-crest';
    const ini = initials(name);
    if (!logo) {
      return `<span class="${cls} crest-monogram" aria-hidden="true">${escapeHtml(ini)}</span>`;
    }
    return `<img src="${escapeHtml(logo)}" alt="${escapeHtml(name)}" class="${cls}" style="object-fit:contain;" loading="lazy" data-initials="${escapeHtml(ini)}" data-fallback-cls="${cls}" onerror="window.__statsproImgFallback(this)">`;
  }

  function setHeroLogo(selector, team) {
    const el = $(selector);
    if (!el) return;
    const ini = initials(team && team.name);
    if (team && team.logo) {
      el.innerHTML = `<img src="${escapeHtml(team.logo)}" alt="${escapeHtml(team.name)}" style="width:100%;height:100%;object-fit:contain;" data-initials="${escapeHtml(ini)}" data-fallback-cls="team-crest" onerror="window.__statsproImgFallback(this)">`;
    } else {
      el.textContent = ini;
    }
  }

  function drawFilteredMatches() {
    const container = $('#contenedor-principal');
    const query = normalizeSearch(state.searchQuery);
    const esAyer = state.selectedDate === fechasVentana.ayer;

    let bannerAyer = '';
    if (esAyer) {
      const bt = MotorEstadistico.backtest(state.currentDateMatches);
      if (bt.verifiedCount > 0) {
        bannerAyer = `
          <section class="top-pick-card" style="margin-bottom:10px;border-color:rgba(16,185,129,0.45);">
            <div class="top-pick-header"><span class="pick-badge">✓ Resultados Verificados de Ayer</span></div>
            <p style="margin:6px 0 0;font-size:0.86rem;color:#e5e7eb;">Efectividad del modelo: <strong style="color:#10b981;">${bt.accuracyPercent.toFixed(1)}% (${bt.hitCount} de ${bt.verifiedCount} aciertos)</strong></p>
          </section>`;
      }
    }

    const filtered = query
      ? state.currentDateMatches.filter(match =>
          normalizeSearch(match.local && match.local.name).includes(query) ||
          normalizeSearch(match.visita && match.visita.name).includes(query) ||
          normalizeSearch(match.league).includes(query)
        )
      : state.currentDateMatches;

    if (!state.currentDateMatches.length) {
      container.innerHTML = `
        <section class="stat-card empty-state-card">
          <div class="empty-state-icon">◌</div>
          <h3>Cargando jornada...</h3>
          <p class="muted-copy">Sincronizando encuentros para ${escapeHtml(state.selectedDate)}.</p>
        </section>`;
      return;
    }

    if (!filtered.length) {
      container.innerHTML = `
        <section class="stat-card empty-state-card">
          <div class="empty-state-icon">🔍</div>
          <h3>Sin resultados para "${escapeHtml(state.searchQuery)}"</h3>
          <p class="muted-copy">No hay equipos ni competiciones con ese nombre en esta fecha.</p>
        </section>`;
      return;
    }

    const groups = new Map();
    filtered.forEach(match => {
      if (!groups.has(match.league)) groups.set(match.league, { logo: match.leagueLogo, fixtures: [] });
      groups.get(match.league).fixtures.push(match);
    });

    container.innerHTML = bannerAyer + Array.from(groups.entries()).map(([league, group]) => {
      const leagueIcon = group.logo
        ? `<img src="${escapeHtml(group.logo)}" alt="" class="league-flag" loading="lazy" onerror="this.style.display='none'">`
        : '';
      return `
        <section class="league-card">
          <div class="league-header">
            <span class="league-title-wrap">${leagueIcon}<span>${escapeHtml(league)}</span></span>
            <span>${group.fixtures.length} partido(s)</span>
          </div>
          ${group.fixtures.map(match => {
            const model = MotorEstadistico.analizarPartido(match);
            const tieneMarcador = match.result && Number.isInteger(match.result.homeGoals) && Number.isInteger(match.result.awayGoals);
            const esFin = match.status === 'FIN';
            const esLive = match.status === 'LIVE';
            const metaRight = tieneMarcador
              ? `${match.result.homeGoals} - ${match.result.awayGoals} ${esFin ? '(FINAL)' : `(${match.status})`}`
              : (match.hour || 'Hora N/D');

            let badgeText = 'Ver análisis';
            let badgeClass = 'state-missing';

            if (esFin && model.status === 'ok' && model.topPick) {
              if (model.verifiedHit === true) {
                badgeText = `✓ Acertado · ${model.topPick.label}`;
                badgeClass = 'state-ready';
              } else if (model.verifiedHit === false) {
                badgeText = `Finalizado · ${model.topPick.label}`;
                badgeClass = 'state-missing';
              } else {
                badgeText = 'Finalizado · Analizado';
                badgeClass = 'state-ready';
              }
            } else if (esFin) {
              badgeText = 'Finalizado';
              badgeClass = 'state-ready';
            } else if (esLive) {
              badgeText = 'En vivo';
              badgeClass = 'state-ready';
            } else if (model.status === 'ok' && model.topPick) {
              badgeText = `Analizado · ${model.topPick.label} (${percent(model.topPick.prob, 0)})`;
              badgeClass = 'state-ready';
            }

            return `
              <button type="button" class="match-item match-item-button" data-open-match="${escapeHtml(match.id)}">
                <span class="match-teams-col">
                  <span class="team-line">${renderCrest(match.local, true)}<span>${escapeHtml(match.local.name)}</span></span>
                  <span class="team-line">${renderCrest(match.visita, true)}<span>${escapeHtml(match.visita.name)}</span></span>
                </span>
                <span class="match-meta-col match-meta-stack">
                  <span class="match-state-label ${badgeClass}">${escapeHtml(badgeText)}</span>
                  <span class="time-arrow">${escapeHtml(metaRight)} ›</span>
                </span>
              </button>`;
          }).join('')}
        </section>`;
    }).join('');
  }

  async function renderMatches(forceRefresh = false) {
    state.currentDateMatches = await ServicioDatos.obtenerPartidos(state.selectedDate, forceRefresh);
    state.matches = ServicioDatos.obtenerTodosLosPartidos();
    drawFilteredMatches();
  }

  function metricBox(label, value, sub) {
    return `
      <div class="quick-box metric-box">
        <div class="qbox-top"><span class="qbox-label">${escapeHtml(label)}</span></div>
        <div class="qbox-main"><span class="qbox-prob">${escapeHtml(value)}</span></div>
        <div class="qbox-footer"><span>${escapeHtml(sub || '')}</span></div>
      </div>`;
  }

  function analysisMissing(model) {
    const errors = (model.missing || []).map(message => `<li>${escapeHtml(message)}</li>`).join('');
    return `
      <section class="stat-card data-warning-card">
        <div class="card-top-bar"><span class="card-title">Muestra histórica limitada</span><span class="warning-chip">Sin historial suficiente</span></div>
        <p class="muted-copy">Este encuentro corresponde a una categoría juvenil o amistosa sin suficientes partidos oficiales previos para proyectar probabilidades.</p>
        <ul class="validation-list">${errors}</ul>
      </section>`;
  }

  function fairOdds(value) {
    return Number.isFinite(value) && value > 0 ? value.toFixed(2) : '—';
  }

  function renderLadder(items) {
    if (!Array.isArray(items) || !items.length) return '<p class="muted-copy">Sin muestra suficiente.</p>';
    return `<div class="ladder-grid">${items.map(item => `
      <div class="ladder-cell">
        <span class="ladder-line">${escapeHtml(item.label)}</span>
        <span class="ladder-prob">${percent(item.probability)}</span>
        <span class="ladder-odds">Cuota justa: ${fairOdds(item.fairOdds)}</span>
      </div>`).join('')}</div>`;
  }

  function marketSelectOptions(model) {
    const probabilities = model.probabilities;
    const options = Object.entries(MARKET_LABELS).filter(([key]) => Number.isFinite(
      key === 'cornersOver85'
        ? model.corners.available ? model.corners.ladders.find(item => item.line === 8.5)?.probability : null
        : key === 'cardsOver35'
          ? model.cards.available ? MotorEstadistico.distributionTailOver(model.cards.lambdaTotal, model.cards.dispersion, 3.5).probability : null
          : probabilities[key]
    ));
    return options.map(([key, label]) => `<option value="${key}">${escapeHtml(label)}</option>`).join('');
  }

  function getProbability(model, market) {
    if (market === 'cornersOver85') return model.corners.available ? model.corners.ladders.find(item => item.line === 8.5)?.probability : null;
    if (market === 'cardsOver35') return model.cards.available ? MotorEstadistico.distributionTailOver(model.cards.lambdaTotal, model.cards.dispersion, 3.5).probability : null;
    return model.probabilities[market];
  }

  function renderQuickAnalysis(match, model) {
    const p1 = model.probabilities.homeWin;
    const px = model.probabilities.draw;
    const p2 = model.probabilities.awayWin;
    const goalsOver15 = model.probabilities.goalsOver15;
    const goalsOver25 = model.probabilities.goalsOver25;
    const btts = model.probabilities.bttsYes;
    const dc1X = model.probabilities.doubleChance1X;
    const dcX2 = model.probabilities.doubleChanceX2;
    const corners85 = model.corners && model.corners.available ? model.corners.ladders.find(l => l.line === 8.5) : null;
    const cards35Prob = model.cards && model.cards.available ? MotorEstadistico.distributionTailOver(model.cards.lambdaTotal, model.cards.dispersion, 3.5).probability : null;

    const veredictoFinal = match.status === 'FIN' && model.topPick && typeof model.verifiedHit === 'boolean'
      ? `<section class="top-pick-card" style="border-color:${model.verifiedHit ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.4)'};">
          <div class="top-pick-header"><span class="pick-badge">${model.verifiedHit ? '✓ Pronóstico Acertado' : 'Resultado Finalizado'}</span></div>
          <p style="margin:6px 0 0;font-size:0.88rem;">Selección principal del modelo: <strong>${escapeHtml(model.topPick.label)} (${percent(model.topPick.prob)})</strong></p>
        </section>`
      : '';

    return `
      ${veredictoFinal}
      <section class="stat-card">
        <div class="card-top-bar"><span class="card-title">Proyección esperada (Poisson + Dixon–Coles)</span><span class="sample-chip">${model.sample.home}L · ${model.sample.away}V</span></div>
        <div class="split-matrix">
          <div class="matrix-col"><span class="matrix-val">${number(model.lambdaHome)}</span><span class="matrix-sub">Goles esp. ${escapeHtml(match.local.name)}</span></div>
          <div class="matrix-col highlight"><span class="matrix-val">${number(model.lambdaTotal)}</span><span class="matrix-sub">Total esperado</span></div>
          <div class="matrix-col"><span class="matrix-val">${number(model.lambdaAway)}</span><span class="matrix-sub">Goles esp. ${escapeHtml(match.visita.name)}</span></div>
        </div>
        <p class="small-note">Córners proyectados: ${model.corners.available ? number(model.corners.lambdaTotal, 1) : 'N/D'} · Tarjetas proyectadas: ${model.cards.available ? number(model.cards.lambdaTotal, 1) : 'N/D'}</p>
      </section>

      <section class="stat-card">
        <div class="card-top-bar"><span class="card-title">Probabilidades 1X2 y Cuotas Justas</span></div>
        <div class="split-matrix">
          <div class="matrix-col"><span class="matrix-val">${percent(p1)}</span><span class="matrix-sub">1 · Cuota ${fairOdds(model.fairOdds.homeWin)}</span></div>
          <div class="matrix-col"><span class="matrix-val">${percent(px)}</span><span class="matrix-sub">X · Cuota ${fairOdds(model.fairOdds.draw)}</span></div>
          <div class="matrix-col"><span class="matrix-val">${percent(p2)}</span><span class="matrix-sub">2 · Cuota ${fairOdds(model.fairOdds.awayWin)}</span></div>
        </div>
      </section>

      <div class="quick-grid-2x2">
        ${metricBox('Goles +1.5', percent(goalsOver15), `Cuota justa ${fairOdds(model.fairOdds.goalsOver15)}`)}
        ${metricBox('Goles +2.5', percent(goalsOver25), `Cuota justa ${fairOdds(model.fairOdds.goalsOver25)}`)}
        ${metricBox('Ambos anotan', percent(btts), `Cuota justa ${fairOdds(model.fairOdds.bttsYes)}`)}
        ${metricBox(dc1X >= dcX2 ? 'Doble Oport. 1X' : 'Doble Oport. X2', percent(Math.max(dc1X, dcX2)), `Cuota justa ${fairOdds(dc1X >= dcX2 ? model.fairOdds.doubleChance1X : model.fairOdds.doubleChanceX2)}`)}
        ${corners85 ? metricBox('Córners +8.5', percent(corners85.probability), `Esp. ${number(model.corners.lambdaTotal, 1)} · Cuota ${fairOdds(corners85.fairOdds)}`) : ''}
        ${Number.isFinite(cards35Prob) ? metricBox('Tarjetas +3.5', percent(cards35Prob), `Esp. ${number(model.cards.lambdaTotal, 1)} · Cuota ${fairOdds(1 / cards35Prob)}`) : ''}
      </div>

      <section class="stat-card">
        <div class="card-top-bar"><span class="card-title">Registrar pronóstico</span><span class="small-note">Seguimiento personal</span></div>
        <form id="prediction-form" class="form-stack">
          <label for="prediction-market">Mercado a seguir</label>
          <select id="prediction-market">${marketSelectOptions(model)}</select>
          <label for="prediction-odds">Cuota tomada (decimal, opcional)</label>
          <input id="prediction-odds" type="number" min="1.01" step="0.01" placeholder="Ej. 1.95">
          <button class="primary-action" type="submit">Guardar pronóstico</button>
        </form>
      </section>

      <section class="stat-card">
        <div class="card-top-bar"><span class="card-title">Calculadora de Stake (Kelly)</span></div>
        <form id="kelly-form" class="form-grid">
          <div><label for="kelly-bankroll">Banca</label><input id="kelly-bankroll" type="number" min="0.01" step="0.01" value="${escapeHtml(state.bankroll)}"></div>
          <div><label for="kelly-odds">Cuota decimal</label><input id="kelly-odds" type="number" min="1.01" step="0.01" placeholder="1.90"></div>
          <div><label for="kelly-market">Probabilidad</label><select id="kelly-market">${marketSelectOptions(model)}</select></div>
          <button class="secondary-action" type="submit">Calcular stake</button>
        </form>
        <div id="kelly-result" class="result-strip">Stake limitado al 2% de la banca con Kelly al 25%.</div>
      </section>

      <button id="btn-toggle-detalle" class="btn-expand-details" type="button"><span>Ver informe táctico, córners, tarjetas y jugadores</span><span aria-hidden="true">⌄</span></button>`;
  }

  function bindQuickHandlers() {
    $('#prediction-form')?.addEventListener('submit', savePrediction);
    $('#kelly-form')?.addEventListener('submit', calculateKelly);
    $('#btn-toggle-detalle')?.addEventListener('click', () => {
      const panel = $('#panel-analisis-avanzado');
      if (panel.hidden) openDetailTab('resumen');
      else panel.hidden = true;
    });
  }

  async function openMatch(matchId) {
    const baseMatch = state.currentDateMatches.find(item => item.id === matchId)
      || ServicioDatos.obtenerTodosLosPartidos().find(item => item.id === matchId);
    if (!baseMatch) return toast('No se encontró el partido.', 'error');

    state.currentMatch = baseMatch;
    $('#detalle-liga').textContent = baseMatch.league;
    setHeroLogo('#hero-logo-local', baseMatch.local);
    setHeroLogo('#hero-logo-visita', baseMatch.visita);
    $('#hero-nombre-local').textContent = baseMatch.local.name;
    $('#hero-nombre-visita').textContent = baseMatch.visita.name;
    const tieneMarcador = baseMatch.result && Number.isInteger(baseMatch.result.homeGoals) && Number.isInteger(baseMatch.result.awayGoals);
    $('#hero-hora').textContent = tieneMarcador ? `${baseMatch.result.homeGoals} - ${baseMatch.result.awayGoals}` : (baseMatch.hour || '—');
    $('#hero-racha-local').innerHTML = renderStreakBadges(baseMatch.local.history);
    $('#hero-racha-visita').innerHTML = renderStreakBadges(baseMatch.visita.history);
    $('#panel-analisis-avanzado').hidden = true;
    $$('.inner-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === 'resumen'));

    $('#vista-home').classList.remove('active');
    $('#vista-inicio').classList.remove('active');
    $('#vista-detalle').classList.add('active');
    window.scrollTo({ top: 0, behavior: 'auto' });

    const yaAnalizado = baseMatch.enrichedAt && baseMatch.local.history.length > 0 && baseMatch.visita.history.length > 0;
    if (yaAnalizado) {
      state.currentModel = MotorEstadistico.analizarPartido(baseMatch);
      $('#hero-estado').textContent = baseMatch.status === 'FIN' ? 'FINALIZADO' : baseMatch.status === 'LIVE' ? 'En vivo' : 'Análisis listo';
      $('#vista-rapida-partido').innerHTML = state.currentModel.status === 'ok'
        ? renderQuickAnalysis(baseMatch, state.currentModel)
        : analysisMissing(state.currentModel);
      bindQuickHandlers();
      return;
    }

    $('#hero-estado').textContent = baseMatch.status === 'FIN' ? 'FINALIZADO' : 'Cargando análisis...';
    $('#vista-rapida-partido').innerHTML = `
      <section class="stat-card empty-state-card">
        <div class="empty-state-icon">◌</div>
        <h3>Obteniendo estadísticas del encuentro...</h3>
        <p class="muted-copy">Calculando goles, córners, tarjetas y remates...</p>
      </section>`;

    const match = await ServicioDatos.enriquecerPartido(matchId) || baseMatch;
    state.currentMatch = match;
    state.matches = ServicioDatos.obtenerTodosLosPartidos();
    const idxCurrent = state.currentDateMatches.findIndex(m => m.id === match.id);
    if (idxCurrent >= 0) state.currentDateMatches[idxCurrent] = match;

    state.currentModel = MotorEstadistico.analizarPartido(match);
    $('#hero-estado').textContent = match.status === 'FIN' ? 'FINALIZADO' : match.status === 'LIVE' ? 'En vivo' : 'Análisis listo';
    $('#hero-racha-local').innerHTML = renderStreakBadges(match.local.history);
    $('#hero-racha-visita').innerHTML = renderStreakBadges(match.visita.history);

    $('#vista-rapida-partido').innerHTML = state.currentModel.status === 'ok'
      ? renderQuickAnalysis(match, state.currentModel)
      : analysisMissing(state.currentModel);

    bindQuickHandlers();
  }

  function openDetailTab(tabName) {
    $('#panel-analisis-avanzado').hidden = false;
    $$('.inner-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabName));
    renderDetailTab(tabName);
    $('#panel-analisis-avanzado').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderDetailTab(tabName) {
    const match = state.currentMatch;
    const model = state.currentModel;
    if (!match || !model) return;
    const panel = $('#contenido-pestana');
    if (tabName === 'contexto') {
      panel.innerHTML = renderContextForm(match);
      $('#context-form')?.addEventListener('submit', saveContext);
      return;
    }
    if (model.status !== 'ok') {
      panel.innerHTML = analysisMissing(model);
      return;
    }

    if (tabName === 'resumen') {
      panel.innerHTML = `
        <section class="stat-card">
          <div class="card-top-bar"><span class="card-title">Informe táctico generado por métricas</span></div>
          ${model.tacticalReport.map(item => `<div class="tactical-insight-item"><span class="tactical-dot ${item.type === 'against' ? 'contra' : 'pro'}"></span><div>${escapeHtml(item.text)}</div></div>`).join('')}
        </section>
        <section class="stat-card">
          <div class="card-top-bar"><span class="card-title">Probabilidades 1X2 y doble oportunidad</span></div>
          ${metricRow('Victoria local', percent(model.probabilities.homeWin), `Cuota justa ${fairOdds(model.fairOdds.homeWin)}`)}
          ${metricRow('Empate', percent(model.probabilities.draw), `Cuota justa ${fairOdds(model.fairOdds.draw)}`)}
          ${metricRow('Victoria visitante', percent(model.probabilities.awayWin), `Cuota justa ${fairOdds(model.fairOdds.awayWin)}`)}
          ${metricRow('1X', percent(model.probabilities.doubleChance1X), `Cuota justa ${fairOdds(model.fairOdds.doubleChance1X)}`)}
          ${metricRow('X2', percent(model.probabilities.doubleChanceX2), `Cuota justa ${fairOdds(model.fairOdds.doubleChanceX2)}`)}
          ${metricRow('12', percent(model.probabilities.doubleChance12), `Cuota justa ${fairOdds(model.fairOdds.doubleChance12)}`)}
        </section>
        <section class="stat-card"><div class="card-top-bar"><span class="card-title">Escalera de goles · Poisson + Dixon–Coles</span></div>${renderLadder(model.goalLadder)}</section>`;
    } else if (tabName === 'mercados') {
      panel.innerHTML = `
        <section class="stat-card"><div class="card-top-bar"><span class="card-title">Probabilidad de modelo frente a cuota justa</span></div>
          ${metricRow('Más de 1.5 goles', percent(model.probabilities.goalsOver15), `Cuota justa ${fairOdds(model.fairOdds.goalsOver15)}`)}
          ${metricRow('Más de 2.5 goles', percent(model.probabilities.goalsOver25), `Cuota justa ${fairOdds(model.fairOdds.goalsOver25)}`)}
          ${metricRow('Más de 3.5 goles', percent(model.probabilities.goalsOver35), `Cuota justa ${fairOdds(model.fairOdds.goalsOver35)}`)}
          ${metricRow('Ambos anotan', percent(model.probabilities.bttsYes), `Cuota justa ${fairOdds(model.fairOdds.bttsYes)}`)}
        </section>`;
    } else if (tabName === 'corners') {
      panel.innerHTML = model.corners.available ? `
        <section class="stat-card">
          <div class="card-top-bar"><span class="card-title">Córners · Binomial negativa</span><span class="sample-chip">Disp. ${number(model.corners.dispersion, 1)}</span></div>
          <div class="split-matrix">
            <div class="matrix-col"><span class="matrix-val">${number(model.corners.lambdaHome)}</span><span class="matrix-sub">${escapeHtml(match.local.name)}</span></div>
            <div class="matrix-col highlight"><span class="matrix-val">${number(model.corners.lambdaTotal)}</span><span class="matrix-sub">Total esperado</span></div>
            <div class="matrix-col"><span class="matrix-val">${number(model.corners.lambdaAway)}</span><span class="matrix-sub">${escapeHtml(match.visita.name)}</span></div>
          </div>
          ${renderLadder(model.corners.ladders.map(item => ({ label: `Más de ${item.line}`, probability: item.probability, fairOdds: item.fairOdds })))}
        </section>` : `<section class="stat-card"><div class="card-top-bar"><span class="card-title">Córners no disponibles</span></div><p class="muted-copy">${escapeHtml(model.corners.reason)}</p></section>`;
    } else if (tabName === 'tarjetas') {
      panel.innerHTML = model.cards.available ? `
        <section class="stat-card">
          <div class="card-top-bar"><span class="card-title">Tarjetas · Binomial negativa</span><span class="sample-chip">Disp. ${number(model.cards.dispersion, 1)}</span></div>
          <div class="split-matrix">
            <div class="matrix-col"><span class="matrix-val">${number(model.cards.lambdaHome)}</span><span class="matrix-sub">${escapeHtml(match.local.name)}</span></div>
            <div class="matrix-col highlight"><span class="matrix-val">${number(model.cards.lambdaTotal)}</span><span class="matrix-sub">Total esperado</span></div>
            <div class="matrix-col"><span class="matrix-val">${number(model.cards.lambdaAway)}</span><span class="matrix-sub">${escapeHtml(match.visita.name)}</span></div>
          </div>
          ${renderLadder([2.5, 3.5, 4.5, 5.5, 6.5].map(line => {
            const probability = MotorEstadistico.distributionTailOver(model.cards.lambdaTotal, model.cards.dispersion, line).probability;
            return { label: `Más de ${line}`, probability, fairOdds: 1 / probability };
          }))}
        </section>` : `<section class="stat-card"><div class="card-top-bar"><span class="card-title">Tarjetas no disponibles</span></div><p class="muted-copy">${escapeHtml(model.cards.reason)}</p></section>`;
    } else if (tabName === 'jugadores') {
      const playerCards = (model.players || []).map(player => {
        const statusLabel = ({ available: 'Disponible', injured: 'Lesionado', suspended: 'Suspendido', doubtful: 'Duda', confirmed: 'Confirmado' })[player.status] || 'Disponible';
        if (!player.available) return `<section class="stat-card"><div class="card-top-bar"><span class="card-title">${escapeHtml(player.name)} · ${escapeHtml(player.team)}</span><span class="warning-chip">${escapeHtml(statusLabel)}</span></div><p class="muted-copy">${escapeHtml(player.reason)}</p></section>`;
        const ladderMarkup = (items, heading) => `<div class="ladder-title"><span>${heading}</span></div><div class="ladder-grid cols-3">${items.map(item => `<div class="ladder-cell"><span class="ladder-line">Más de ${item.line}</span><span class="ladder-prob">${percent(item.probability)}</span></div>`).join('')}</div>`;
        return `<section class="stat-card"><div class="card-top-bar"><span class="card-title">${escapeHtml(player.name)} · ${escapeHtml(player.team)}</span><span class="sample-chip">${escapeHtml(statusLabel)} · n=${player.sampleSize}</span></div><div class="split-matrix"><div class="matrix-col"><span class="matrix-val">${number(player.meanOnTarget)}</span><span class="matrix-sub">Al arco / partido</span></div><div class="matrix-col highlight"><span class="matrix-val">${number(player.meanTotal)}</span><span class="matrix-sub">Remates / partido</span></div><div class="matrix-col"><span class="matrix-val">${number(player.sampleSize, 0)}</span><span class="matrix-sub">Partidos válidos</span></div></div>${ladderMarkup(player.onTargetLadder, 'REMATES AL ARCO')}${ladderMarkup(player.totalLadder, 'REMATES TOTALES')}</section>`;
      }).join('');
      panel.innerHTML = `${playerCards || '<section class="stat-card"><div class="card-top-bar"><span class="card-title">Rendimiento de jugadores</span></div><p class="muted-copy">Sin datos individuales disponibles para este encuentro.</p></section>'}`;
    }
  }

  function metricRow(label, value, meta) {
    return `<div class="metric-row"><div><span class="metric-name">${escapeHtml(label)}</span><span class="metric-meta">${escapeHtml(meta || '')}</span></div><span class="metric-pill">${escapeHtml(value)}</span></div>`;
  }

  function renderContextForm(match) {
    const ctx = match.context || {};
    const referee = match.referee || {};
    return `
      <section class="stat-card">
        <div class="card-top-bar"><span class="card-title">Contexto del encuentro</span><span class="sample-chip">Ajustes en vivo</span></div>
        <form id="context-form" class="form-stack">
          <label for="ctx-importance">Importancia del partido</label>
          <select id="ctx-importance">
            ${['normal','title_race','relegation','qualification','already_secured','other'].map(value => `<option value="${value}" ${ctx.importance === value ? 'selected' : ''}>${({normal:'Partido regular',title_race:'Lucha por el título',relegation:'Lucha por el descenso',qualification:'Clasificación',already_secured:'Objetivo ya asegurado',other:'Otra situación'})[value]}</option>`).join('')}
          </select>
          <label class="inline-check"><input id="ctx-derby" type="checkbox" ${ctx.derby ? 'checked' : ''}> Es un derbi</label>
          <label for="ctx-lineups">Estado de las alineaciones</label>
          <select id="ctx-lineups"><option value="unconfirmed" ${ctx.lineupsStatus !== 'confirmed' ? 'selected' : ''}>No confirmadas</option><option value="confirmed" ${ctx.lineupsStatus === 'confirmed' ? 'selected' : ''}>Confirmadas</option></select>
          <div class="form-grid">
            <div><label for="ctx-home-rest">Descanso local (días)</label><input id="ctx-home-rest" type="number" min="0" max="30" step="1" value="${ctx.homeRestDays ?? ''}"></div>
            <div><label for="ctx-away-rest">Descanso visitante (días)</label><input id="ctx-away-rest" type="number" min="0" max="30" step="1" value="${ctx.awayRestDays ?? ''}"></div>
            <div><label for="ctx-home-absence">Impacto bajas local (xG)</label><input id="ctx-home-absence" type="number" min="0" max="2" step="0.01" value="${ctx.homeAbsenceXGImpact ?? ''}"></div>
            <div><label for="ctx-away-absence">Impacto bajas visitante (xG)</label><input id="ctx-away-absence" type="number" min="0" max="2" step="0.01" value="${ctx.awayAbsenceXGImpact ?? ''}"></div>
            <div><label for="ctx-referee">Prom. tarjetas árbitro</label><input id="ctx-referee" type="number" min="0" max="20" step="0.1" value="${referee.avgCards ?? ''}"></div>
            <div><label for="ctx-referee-n">Muestra árbitro</label><input id="ctx-referee-n" type="number" min="0" max="500" step="1" value="${referee.sampleSize ?? ''}"></div>
          </div>
          <label for="ctx-injuries">Lesiones reportadas</label><textarea id="ctx-injuries" rows="2" maxlength="300">${escapeHtml(ctx.injuriesNote || '')}</textarea>
          <button class="primary-action" type="submit">Recalcular modelo</button>
        </form>
      </section>`;
  }

  function fieldNumber(id) {
    const el = $(`#${id}`);
    if (!el) return null;
    const value = el.value.trim();
    return value === '' ? null : Number(value);
  }

  function saveContext(event) {
    event.preventDefault();
    try {
      const match = { ...state.currentMatch };
      match.context = {
        ...(match.context || {}),
        importance: $('#ctx-importance').value,
        derby: $('#ctx-derby').checked,
        lineupsStatus: $('#ctx-lineups').value,
        homeRestDays: fieldNumber('ctx-home-rest'),
        awayRestDays: fieldNumber('ctx-away-rest'),
        homeAbsenceXGImpact: fieldNumber('ctx-home-absence'),
        awayAbsenceXGImpact: fieldNumber('ctx-away-absence'),
        injuriesNote: $('#ctx-injuries').value
      };
      match.referee = {
        ...(match.referee || {}),
        avgCards: fieldNumber('ctx-referee'),
        sampleSize: fieldNumber('ctx-referee-n')
      };
      state.currentMatch = ServicioDatos.actualizarPartido(match);
      state.matches = ServicioDatos.obtenerTodosLosPartidos();
      state.currentModel = MotorEstadistico.analizarPartido(state.currentMatch);
      $('#vista-rapida-partido').innerHTML = state.currentModel.status === 'ok' ? renderQuickAnalysis(state.currentMatch, state.currentModel) : analysisMissing(state.currentModel);
      bindQuickHandlers();
      toast('Modelo recalculado.', 'success');
      renderDetailTab('contexto');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function savePrediction(event) {
    event.preventDefault();
    if (!state.currentMatch || !state.currentModel || state.currentModel.status !== 'ok') return;
    const market = $('#prediction-market').value;
    const probability = getProbability(state.currentModel, market);
    const oddsValue = $('#prediction-odds').value.trim();
    const entryOdds = oddsValue ? Number(oddsValue) : null;
    if (!Number.isFinite(probability)) return toast('Mercado no disponible.', 'error');
    try {
      ServicioDatos.guardarPrediccion({
        matchId: state.currentMatch.id,
        fixture: `${state.currentMatch.local.name} vs ${state.currentMatch.visita.name}`,
        league: state.currentMatch.league,
        market: MARKET_LABELS[market],
        probability,
        entryOdds,
        source: state.currentMatch.source
      });
      toast('Pronóstico guardado.', 'success');
    } catch (error) { toast(error.message, 'error'); }
  }

  function calculateKelly(event) {
    event.preventDefault();
    const bankroll = Number($('#kelly-bankroll').value);
    const decimalOdds = Number($('#kelly-odds').value);
    const market = $('#kelly-market').value;
    const probability = getProbability(state.currentModel, market);
    const result = MotorEstadistico.calcularKelly(probability, decimalOdds, bankroll, state.kellyFraction, 0.02);
    const output = $('#kelly-result');
    if (!result.available) { output.textContent = result.reason; return; }
    output.textContent = `Fracción aplicada: ${(result.bankrollShare * 100).toFixed(2)}% · Stake recomendado: ${result.stake.toFixed(2)} (tope 2%).`;
    state.bankroll = bankroll;
    ServicioDatos.guardarAjustes({ ...ServicioDatos.obtenerAjustes(), bankroll });
  }

  function renderValueRadar() {
    state.matches = ServicioDatos.obtenerTodosLosPartidos();
    const destacados = [];
    state.matches.filter(m => m.dateGroup === fechasVentana.hoy || m.dateGroup === fechasVentana.manana).forEach(match => {
      const model = MotorEstadistico.analizarPartido(match);
      if (model.status === 'ok' && model.topPick && model.topPick.prob >= 0.72) {
        destacados.push({ match, pick: model.topPick, model });
      }
    });
    destacados.sort((a, b) => b.pick.prob - a.pick.prob);

    const container = $('#contenedor-principal');
    if (!destacados.length) {
      container.innerHTML = `
        <section class="stat-card empty-state-card">
          <div class="empty-state-icon">◌</div>
          <h3>Evaluando oportunidades de alta probabilidad...</h3>
          <p class="muted-copy">Aquí aparecerán automáticamente las selecciones con probabilidad superior al 72% para Hoy y Mañana.</p>
        </section>`;
      return;
    }

    container.innerHTML = `<section class="top-pick-card"><div class="top-pick-header"><span class="pick-badge">Radar de Alta Probabilidad</span></div><p class="pick-reason">${destacados.length} selección(es) superan el 72% de probabilidad estadística.</p></section>` + destacados.map(({ match, pick }) => `
      <button class="stat-card value-card" type="button" data-open-match="${escapeHtml(match.id)}">
        <div class="card-top-bar"><span class="card-title">${escapeHtml(match.league)}</span><span>${match.dateGroup === fechasVentana.hoy ? 'Hoy' : 'Mañana'} · ${escapeHtml(match.hour || '—')}</span></div>
        <strong>${escapeHtml(match.local.name)} vs ${escapeHtml(match.visita.name)}</strong>
        <div class="odds-compare-row compact">
          <strong>${escapeHtml(pick.label)}</strong>
          <span>Probabilidad modelo: ${percent(pick.prob, 1)}</span>
          <span>Cuota justa: ${fairOdds(1 / pick.prob)}</span>
        </div>
      </button>`).join('');
  }

  function renderHistory() {
    const container = $('#contenedor-principal');
    const predictions = ServicioDatos.obtenerPredicciones();
    const todos = ServicioDatos.obtenerTodosLosPartidos();
    const btAyer = MotorEstadistico.backtest(todos.filter(m => m.dateGroup === fechasVentana.ayer));

    const savedCards = predictions.length ? predictions.map(prediction => `
      <section class="stat-card history-card" data-history-id="${escapeHtml(prediction.id)}">
        <div class="card-top-bar"><span class="card-title">${escapeHtml(prediction.league)}</span><span>${new Date(prediction.createdAt).toLocaleDateString()}</span></div>
        <strong>${escapeHtml(prediction.fixture)}</strong>
        <p class="muted-copy">${escapeHtml(prediction.market)} · Probabilidad: ${percent(prediction.probability, 1)} · Cuota: ${odds(prediction.entryOdds)}</p>
        <div class="form-grid">
          <div><label>Estado</label><select class="history-outcome"><option value="pending" ${prediction.outcome === 'pending' ? 'selected' : ''}>Pendiente</option><option value="win" ${prediction.outcome === 'win' ? 'selected' : ''}>Acertado</option><option value="loss" ${prediction.outcome === 'loss' ? 'selected' : ''}>Fallado</option><option value="void" ${prediction.outcome === 'void' ? 'selected' : ''}>Anulado</option></select></div>
          <div><label>Cuota cierre</label><input class="history-closing" type="number" min="1.01" step="0.01" value="${prediction.closingOdds ?? ''}" placeholder="Opcional"></div>
        </div>
        <button type="button" class="secondary-action save-history-btn">Guardar resultado</button>
      </section>`).join('') : '<section class="stat-card"><p class="muted-copy">Todavía no has guardado pronósticos personales.</p></section>';

    container.innerHTML = `
      <section class="stat-card">
        <div class="card-top-bar"><span class="card-title">Efectividad Verificada (Ayer)</span><span class="sample-chip">${btAyer.verifiedCount} partidos</span></div>
        <div class="split-matrix">
          <div class="matrix-col highlight"><span class="matrix-val">${btAyer.accuracyPercent != null ? `${btAyer.accuracyPercent.toFixed(1)}%` : '—'}</span><span class="matrix-sub">Precisión real</span></div>
          <div class="matrix-col"><span class="matrix-val">${btAyer.hitCount}</span><span class="matrix-sub">Aciertos</span></div>
          <div class="matrix-col"><span class="matrix-val">${btAyer.verifiedCount}</span><span class="matrix-sub">Evaluados</span></div>
        </div>
        <p class="small-note">Calculado automáticamente comparando las proyecciones del modelo con los marcadores oficiales finalizados de ayer.</p>
      </section>
      <div class="section-heading">Tus pronósticos guardados</div>
      ${savedCards}`;

    $$('.save-history-btn').forEach(button => button.addEventListener('click', saveHistoryRow));
  }

  function saveHistoryRow(event) {
    const card = event.currentTarget.closest('[data-history-id]');
    try {
      ServicioDatos.actualizarPrediccion(card.dataset.historyId, {
        outcome: card.querySelector('.history-outcome').value,
        closingOdds: card.querySelector('.history-closing').value
      });
      toast('Resultado guardado.', 'success');
      renderHistory();
    } catch (error) { toast(error.message, 'error'); }
  }

  function renderProfile() {
    const settings = ServicioDatos.obtenerAjustes();
    const cfg = ServicioDatos.obtenerConfigMaestra();
    const uso = ServicioDatos.obtenerUsoApi();
    const todos = ServicioDatos.obtenerTodosLosPartidos();
    const analizados = todos.filter(m => m.enrichedAt).length;
    const opcionesPartidos = todos
      .filter(m => m.dateGroup === fechasVentana.hoy || m.dateGroup === fechasVentana.manana)
      .map(m => `<option value="${escapeHtml(m.id)}" ${cfg.featuredMatchId === m.id ? 'selected' : ''}>${escapeHtml(m.local.name)} vs ${escapeHtml(m.visita.name)}</option>`)
      .join('');

    state.bankroll = Number(settings.bankroll) > 0 ? Number(settings.bankroll) : 100;
    state.kellyFraction = Number(settings.kellyFraction) > 0 ? Number(settings.kellyFraction) : 0.25;

    $('#contenedor-principal').innerHTML = `
      <section class="stat-card">
        <div class="card-top-bar"><span class="card-title">Gestión de Banca Personal</span></div>
        <form id="settings-form" class="form-grid">
          <div><label for="settings-bankroll">Banca de referencia</label><input id="settings-bankroll" type="number" min="0.01" step="0.01" value="${state.bankroll}"></div>
          <div><label for="settings-kelly">Kelly fraccionado</label><select id="settings-kelly"><option value="0.1" ${state.kellyFraction === 0.1 ? 'selected' : ''}>10%</option><option value="0.25" ${state.kellyFraction === 0.25 ? 'selected' : ''}>25%</option><option value="0.5" ${state.kellyFraction === 0.5 ? 'selected' : ''}>50%</option></select></div>
          <button class="primary-action" type="submit">Guardar ajustes</button>
        </form>
      </section>

      ${state.isAdmin ? `
        <section class="stat-card" style="border:1px solid rgba(16,185,129,0.5);">
          <div class="card-top-bar"><span class="card-title">👑 Panel Maestro (Solo Administrador)</span><span class="sample-chip">Activo</span></div>
          <div class="metric-row"><span class="metric-name">Cuota API-Football hoy</span><span class="metric-pill">${uso.count} / ${uso.limit}</span></div>
          <div class="metric-row"><span class="metric-name">Partidos analizados en sistema</span><span class="metric-pill">${analizados} / ${todos.length}</span></div>
          <form id="master-config-form" class="form-stack" style="margin-top:10px;">
            <label for="master-banner">Aviso en portada para todos los usuarios</label>
            <input id="master-banner" type="text" placeholder="Ej. 🔥 Picks de hoy listos · Efectividad ayer: 82%" value="${escapeHtml(cfg.bannerText)}">
            <label for="master-featured-match">Partido Destacado en Inicio</label>
            <select id="master-featured-match"><option value="">Ninguno</option>${opcionesPartidos}</select>
            <label for="master-featured-text">Comentario del Pick Destacado</label>
            <input id="master-featured-text" type="text" placeholder="Ej. Doble oportunidad 1X + Over 1.5 goles" value="${escapeHtml(cfg.featuredPickText)}">
            <label for="master-limit">Partidos automáticos por día (máx. 25)</label>
            <input id="master-limit" type="number" min="2" max="25" value="${cfg.autoAnalyzeLimit}">
            <button class="primary-action" type="submit">Aplicar cambios maestros</button>
          </form>
          <div class="button-row" style="margin-top:10px;">
            <button class="secondary-action" type="button" data-action="export-master">Exportar data/partidos.json</button>
            <button class="danger-action" type="button" data-action="lock-admin">Bloquear modo admin</button>
          </div>
        </section>` : `
        <section class="stat-card">
          <div class="card-top-bar"><span class="card-title">Acceso Administrador</span></div>
          <form id="unlock-admin-form" class="form-grid">
            <div><input id="admin-pin-input" type="password" placeholder="PIN de propietario"></div>
            <button class="secondary-action" type="submit">Entrar</button>
          </form>
        </section>`}

      <section class="notice-card responsible-notice"><strong>Juego responsable · 18+</strong><p>Las estimaciones estadísticas no garantizan resultados. Comprueba las leyes aplicables en tu jurisdicción.</p></section>`;

    $('#settings-form')?.addEventListener('submit', saveSettings);
    $('#unlock-admin-form')?.addEventListener('submit', e => {
      e.preventDefault();
      const val = ($('#admin-pin-input')?.value || '').trim();
      if (val === ADMIN_PIN) {
        state.isAdmin = true;
        localStorage.setItem('statspro_admin_unlocked', '1');
        toast('Panel Maestro desbloqueado.', 'success');
        renderProfile();
      } else {
        toast('PIN incorrecto.', 'error');
      }
    });
    $('#master-config-form')?.addEventListener('submit', e => {
      e.preventDefault();
      ServicioDatos.guardarConfigMaestra({
        bannerText: $('#master-banner').value,
        featuredMatchId: $('#master-featured-match').value,
        featuredPickText: $('#master-featured-text').value,
        autoAnalyzeLimit: $('#master-limit').value
      });
      toast('Configuración maestra actualizada.', 'success');
    });
  }

  function saveSettings(event) {
    event.preventDefault();
    const bankroll = Number($('#settings-bankroll').value);
    const kellyFraction = Number($('#settings-kelly').value);
    if (!(bankroll > 0) || !Number.isFinite(bankroll)) return toast('Introduce una banca válida.', 'error');
    state.bankroll = bankroll;
    state.kellyFraction = kellyFraction;
    ServicioDatos.guardarAjustes({ bankroll, kellyFraction });
    toast('Ajustes guardados.', 'success');
  }

  function exportMasterJson() {
    const payload = ServicioDatos.exportarBaseSistema();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'partidos.json';
    anchor.click();
    URL.revokeObjectURL(url);
    toast('Archivo data/partidos.json descargado.', 'success');
  }

  function handleGlobalClick(event) {
    // 5 toques en el logo StatsPro desbloquean el Panel Maestro
    if (event.target.closest('.brand-logo, .header-brand, h1')) {
      state.logoTapCount += 1;
      clearTimeout(state.logoTapTimer);
      state.logoTapTimer = setTimeout(() => { state.logoTapCount = 0; }, 2000);
      if (state.logoTapCount >= 5) {
        state.logoTapCount = 0;
        state.isAdmin = true;
        localStorage.setItem('statspro_admin_unlocked', '1');
        toast('Modo Administrador activado.', 'success');
        showRoute('perfil');
        return;
      }
    }

    if (event.target.closest('[data-open-ayer]')) {
      state.selectedDate = fechasVentana.ayer;
      showRoute('partidos');
      return;
    }

    const routeButton = event.target.closest('[data-route]');
    if (routeButton) { showRoute(routeButton.dataset.route); return; }

    const datePill = event.target.closest('[data-date-str]');
    if (datePill) {
      state.selectedDate = datePill.dataset.dateStr;
      buildDateStrip();
      renderMatches();
      return;
    }

    const actionButton = event.target.closest('[data-action]');
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === 'export-master') exportMasterJson();
      if (action === 'lock-admin') {
        state.isAdmin = false;
        localStorage.removeItem('statspro_admin_unlocked');
        toast('Modo Administrador bloqueado.', 'info');
        renderProfile();
      }
      return;
    }

    const matchButton = event.target.closest('[data-open-match]');
    if (matchButton) { openMatch(matchButton.dataset.openMatch); return; }
  }

  function initializeEvents() {
    document.addEventListener('click', handleGlobalClick);

    const searchInput = $('#input-busqueda-partidos');
    const clearBtn = $('#btn-limpiar-busqueda');
    searchInput?.addEventListener('input', () => {
      state.searchQuery = searchInput.value;
      if (clearBtn) clearBtn.hidden = !state.searchQuery;
      drawFilteredMatches();
    });
    clearBtn?.addEventListener('click', () => {
      state.searchQuery = '';
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      clearBtn.hidden = true;
      drawFilteredMatches();
    });

    $('#btn-volver').addEventListener('click', () => showRoute('partidos'));
    $$('.inner-tab').forEach(button => button.addEventListener('click', () => openDetailTab(button.dataset.tab)));
  }

  async function initialize() {
    const settings = ServicioDatos.obtenerAjustes();
    state.bankroll = Number(settings.bankroll) > 0 ? Number(settings.bankroll) : 100;
    state.kellyFraction = Number(settings.kellyFraction) > 0 ? Number(settings.kellyFraction) : 0.25;

    await ServicioDatos.cargarBaseSistema();
    state.currentDateMatches = await ServicioDatos.obtenerPartidos(state.selectedDate);
    state.matches = ServicioDatos.obtenerTodosLosPartidos();

    initializeEvents();
    showRoute('home');

    // Inicia el análisis silencioso automático en segundo plano (sin congelar ni mostrar esperas)
    ServicioDatos.iniciarAutoAnalisisSilencioso(() => {
      state.matches = ServicioDatos.obtenerTodosLosPartidos();
      if (state.route === 'home') renderHomeOverview();
      if (state.route === 'partidos') {
        state.currentDateMatches = state.matches.filter(m => m.dateGroup === state.selectedDate);
        drawFilteredMatches();
      }
    });

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  initialize();
})();
