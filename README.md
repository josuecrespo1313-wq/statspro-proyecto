# StatsPro v4 — analítica de fútbol

Esta versión conserva el estilo oscuro y la navegación principal de StatsPro, pero sustituye la cartelera simulada y el motor anterior por un flujo basado en datos importados y validaciones explícitas.

## Qué cambió

- **Sin datos inventados:** no hay fixtures de demostración ni arreglos de respaldo en el motor. Si faltan historiales o xG, el partido muestra `Datos insuficientes` y no se generan probabilidades.
- **Fuerzas relativas por liga:** el xG ofensivo y el xG concedido se expresan en relación con los promedios de local/visitante de la competición. Se usa una pequeña regresión a la media y hasta 20 partidos recientes, ponderados con decaimiento geométrico `0.92`.
- **Ventaja de local y Dixon–Coles:** los promedios de xG de local y visitante de la liga son referencias distintas. La matriz de marcadores aplica la corrección Dixon–Coles a 0-0, 0-1, 1-0 y 1-1. `dixonColesRho` se puede definir en el perfil de liga; si se omite, el motor usa `-0.08` como parámetro provisional y no como dato observado.
- **Córners y tarjetas:** se modelan con distribuciones binomiales negativas, si existen al menos 10 partidos válidos por equipo y los perfiles de competición están completos. La dispersión puede importarse o estimarse con una muestra agregada. Cuando la varianza observada no supera a la media se usa tamaño 20 como aproximación regularizada al límite Poisson.
- **Cuotas sin margen:** las cuotas deben estar en formato decimal e incluir todos los resultados del mercado para cada casa (over/under, yes/no o home/draw/away en 1X2). Se requiere un mínimo de tres casas independientes, cada una con el mercado completo. El motor normaliza las probabilidades implícitas por casa, promedia el consenso sin margen y compara la probabilidad del modelo. Una señal solo aparece con `EV >= 4%` y `edge >= 4 pp`.
- **Contexto editable:** importancia, derbi, ida/vuelta, estado de alineaciones, notas manuales de lesiones/suspensiones, descanso, viaje, altitud, clima, árbitro, ritmo/estilo e impacto xG manual de ausencias. Los factores numéricos heurísticos se etiquetan como provisionales; los datos contextuales no calibrados se muestran, pero no se convierten automáticamente en una ventaja falsa.
- **Historial y calibración:** se guardan snapshots de probabilidades antes del encuentro; se pueden liquidar manualmente, calcular Brier score, curva de fiabilidad y CLV contra la cuota de cierre.
- **Backtesting:** usa partidos importados con resultado y exige que las historias de cada equipo contengan solo información anterior al encuentro.
- **Kelly fraccionado:** simulador con fracción configurable y límite máximo de stake del 2% de la banca. No ejecuta apuestas.
- **Seguridad y despliegue:** se retiraron los escudos remotos directos de FotMob y ahora se muestran monogramas locales; se eliminaron los handlers JavaScript inline; el manifest existe, se añadió service worker, CSP y cabeceras `_headers`.
- **VIP desactivado:** no hay alertas que simulen pagos ni una marca VIP activada en el navegador. Un paywall real requiere autenticación, autorización en servidor y pasarela de pago.

## Lo que todavía NO hace esta versión

La conexión a API-Football, Sportmonks, football-data.org y The Odds API queda expresamente desactivada. Tampoco verifica lesiones de forma automática, recibe alineaciones de proveedores, manda alertas push de cuotas, autentica cuentas, cobra membresías ni mantiene un historial inmutable. Esos puntos necesitan un backend desplegado, credenciales privadas, proveedor de pagos y contratos de datos. No introduzcas claves privadas en el navegador.

La persistencia actual usa `localStorage`: es local a un navegador y el usuario puede modificarla o borrarla. Los cambios de cuotas se detectan al volver a importar un mismo partido con nuevas cuotas; los cambios en el estado de alineaciones y en las notas de lesiones/suspensiones se alertan al reimportar el mismo partido. La exportación local incluye también movimientos de cuotas y alertas de contexto; estas alertas no son en tiempo real ni push. Las alineaciones/lesiones se registran manualmente, sin proveedor externo. No debe utilizarse como control VIP ni como registro de apuestas auditado.

## Ejecutar

1. Descomprime el ZIP.
2. Usa Node.js 18 o superior.
3. En la carpeta del proyecto ejecuta `npm test` para probar el motor.
4. Para probar la interfaz, ejecuta `npm run serve` y abre `http://localhost:8080`.
5. Importa un JSON con la estructura indicada abajo. La plantilla está en `plantilla-datos.json`.

No se requieren dependencias externas para las funciones incluidas.

## Estructura de datos de importación

El archivo puede contener un arreglo de partidos o un objeto `{ "matches": [...] }`. Cada partido debe incluir:

- `id`, `dateGroup` (`ayer`, `hoy` o `manana`), `league`, `local.name`, `visita.name`.
- `leagueProfile.avgHomeXG` y `avgAwayXG`.
- En `local.history`, **10 o más filas `venue: "home"`** con `xGFor` y `xGAgainst` numéricos.
- En `visita.history`, **10 o más filas `venue: "away"`** con `xGFor` y `xGAgainst` numéricos.
- Para córners, las mismas observaciones deben incluir `cornersFor` y `cornersAgainst`; el perfil necesita `avgHomeCorners` y `avgAwayCorners`.
- Para tarjetas, deben incluir `cards`; el perfil necesita `avgHomeCards` y `avgAwayCards`.
- `odds` utiliza entradas como `{ "market": "goals_2_5", "bookmaker": "Casa A", "side": "over", "price": 1.90 }` y su contraparte `side: "under"`. Otros mercados admitidos: `result_1x2` (`home`/`draw`/`away`), `btts` (`yes`/`no`) y `corners_8_5` (`over`/`under`). Introduce tres o más casas con el mercado completo (home/draw/away para 1X2).
- `context` y `referee` son opcionales. `context.injuriesNote`, `suspensionsNote`, `lineupNotes` y `styleNotes` guardan notas manuales. Los valores xG por ausencias son ajustes manuales en unidades de xG, no datos médicos.
- `players` es opcional. Cada entrada puede incluir `name`, `team`, `status` (`available`, `injured`, `suspended`, `doubtful`, `confirmed`) y `history` con fechas, `shotsOnTarget` y `shotsTotal`. Las proyecciones por jugador requieren al menos 10 registros válidos y usan binomial negativa.
- En partidos históricos, `result` puede incluir `homeGoals`, `awayGoals`, `cornersTotal` y `cardsTotal`.

Los historiales deben estar ordenados por fecha reciente primero (el motor también ordena por fecha). El máximo usado es 20 observaciones por equipo/condición. El motor nunca usa goles marcados como sustituto del xG.

## Coeficientes y límites del modelo

Los factores de descanso, viaje y altitud son heurísticas conservadoras, marcadas como provisionales y sujetas a backtesting por liga. `importance`, `derby` y `tieStage` se registran y se muestran, pero no cambian por sí solos el xG. Los ajustes de ausencias y clima se aplican solo cuando se introducen manualmente. El parámetro Dixon–Coles debe ajustarse con datos históricos por competición. El cara a cara tiene un peso máximo configurable del 5%.

Un resultado de EV/edge no significa que exista ventaja real demostrada. Para afirmarlo se necesita una muestra amplia, backtesting temporal fuera de muestra, calibración, CLV sostenido y control de cierre de línea.

## Seguridad

- No hay secretos de proveedores en el navegador.
- El importador limita el tamaño del archivo a 8 MB y normaliza campos permitidos.
- Los nombres externos se escapan antes de insertarse en HTML.
- La CSP bloquea scripts inline y el contenido remoto.
- `_headers` está preparado para hosting estático compatible (por ejemplo, Netlify); verifica que tu proveedor de hosting aplique realmente esas cabeceras.
- El archivo local no sustituye un backend endurecido. Antes de vender VIP, mueve cuentas, roles, picks y estado de pagos a un servidor con controles de autorización por petición.

## Tests

`npm test` utiliza `node:test` y crea datos sintéticos solo dentro de tests para verificar propiedades matemáticas. No se distribuyen como partidos de ejemplo ni se muestran en la aplicación.
