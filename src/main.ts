import './style.css'
import { ClarkeWright, f1, generateInstance, maxTotalDemand, type Instance, type Solver } from './model'
import { createRng, randomSeed } from './rng'
import { TabuSearch } from './tabu'
import { colorOf, drawChart, drawMap } from './draw'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const inN = $<HTMLInputElement>('inN')
const inK = $<HTMLInputElement>('inK')
const inQ = $<HTMLInputElement>('inQ')
const inSeed = $<HTMLInputElement>('inSeed')
const inIter = $<HTMLInputElement>('inIter')
const inTenure = $<HTMLInputElement>('inTenure')
const inSpeed = $<HTMLInputElement>('inSpeed')
const selAlgo = $<HTMLSelectElement>('selAlgo')
const selInit = $<HTMLSelectElement>('selInit')
const btnNew = $<HTMLButtonElement>('btnNew')
const btnMatrix = $<HTMLButtonElement>('btnMatrix')
const btnShare = $<HTMLButtonElement>('btnShare')
const btnStep = $<HTMLButtonElement>('btnStep')
const btnMerge = $<HTMLButtonElement>('btnMerge')
const btnAuto = $<HTMLButtonElement>('btnAuto')
const btnAll = $<HTMLButtonElement>('btnAll')
const btnReset = $<HTMLButtonElement>('btnReset')
const map = $<HTMLCanvasElement>('map')
const chart = $<HTMLCanvasElement>('chart')
const tblRoutes = $<HTMLTableElement>('tblRoutes')
const tblHist = $<HTMLTableElement>('tblHist')
const histTitle = $('histTitle')
const histWrap = $('histWrap')
const statusBox = $('status')
const summary = $('summary')
const dlgMatrix = $<HTMLDialogElement>('dlgMatrix')
const tblMatrix = $<HTMLTableElement>('tblMatrix')
const matrixInfo = $('matrixInfo')

let inst: Instance
let solver: Solver
let seedUsed = 0
let timer: number | null = null
let busy = false // «Resolver todo» en curso
let histRows: HTMLTableRowElement[] = []

const isTabu = () => selAlgo.value === 'tabu'
const cw = () => solver as ClarkeWright
const tabu = () => solver as TabuSearch

/** Lee un entero de un campo, lo limita a su rango y lo escribe de vuelta. */
function readInt(el: HTMLInputElement, fallback: number): number {
  const min = Number(el.min)
  const max = Number(el.max)
  let v = Math.round(Number(el.value))
  if (!Number.isFinite(v)) v = fallback
  v = Math.min(max, Math.max(min, v))
  el.value = String(v)
  return v
}

function newProblem(seedOverride?: number) {
  stopAuto()
  const n = readInt(inN, 15)
  const k = readInt(inK, 4)
  const q = readInt(inQ, 100)
  if (n > maxTotalDemand(k, q)) {
    alert(
      `Con ${k} vehículo(s) de capacidad ${q} no hay sitio para ${n} puntos de entrega ` +
        `(cada punto demanda al menos 1 unidad y la demanda total no puede pasar de ${maxTotalDemand(k, q)}).\n\n` +
        'Aumenta la capacidad o el número de vehículos, o reduce los puntos.',
    )
    return
  }
  const typed = seedOverride ?? readInt(inSeed, 0)
  seedUsed = typed === 0 ? randomSeed() : typed
  // Se muestra la semilla efectiva para poder repetir o compartir el problema
  inSeed.value = String(seedUsed)
  inst = generateInstance(n, k, q, createRng(seedUsed))
  writeHash()
  reset()
}

function writeHash() {
  const h = `#n=${inst.n}&k=${inst.k}&q=${inst.q}&seed=${seedUsed}`
  history.replaceState(null, '', h)
}

function readHash(): boolean {
  const m = new URLSearchParams(location.hash.slice(1))
  const get = (key: string) => (m.has(key) ? Number(m.get(key)) : NaN)
  const n = get('n'), k = get('k'), q = get('q'), seed = get('seed')
  if (![n, k, q, seed].every(Number.isFinite)) return false
  inN.value = String(n)
  inK.value = String(k)
  inQ.value = String(q)
  inSeed.value = String(seed)
  return true
}

function showMatrix() {
  const p = inst
  const n = p.n
  let max = 0
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) max = Math.max(max, p.d[i][j])
  let html = '<thead><tr><th class="rowh"></th>'
  for (let j = 0; j <= n; j++) html += `<th>${j === 0 ? '0 (C)' : j}</th>`
  html += '</tr></thead><tbody>'
  for (let i = 0; i <= n; i++) {
    html += `<tr><th class="rowh">${i === 0 ? '0 (C)' : i}</th>`
    for (let j = 0; j <= n; j++) {
      let style: string
      if (i === j) style = 'background:#dcdcdc;color:#808080'
      else if (i === 0 || j === 0) style = 'background:#fff5c8'
      else {
        const t = Math.round(235 - (90 * p.d[i][j]) / max)
        style = `background:rgb(${t},${Math.min(255, t + 10)},255)`
      }
      html += `<td style="${style}">${f1(p.d[i][j])}</td>`
    }
    html += '</tr>'
  }
  tblMatrix.innerHTML = html + '</tbody>'
  matrixInfo.textContent = `Distancia euclídea entre cada par de nodos. Fila y columna 0 = central (en amarillo). Matriz simétrica de ${n + 1} × ${n + 1}.`
  if (!dlgMatrix.open) dlgMatrix.showModal()
}

function reset() {
  stopAuto()
  busy = false
  const t = isTabu()
  document.body.classList.toggle('tabu', t)
  btnMerge.textContent = t ? 'Siguiente mejora ⏭' : 'Siguiente fusión ⏭'

  if (!t) {
    solver = new ClarkeWright(inst)
    histTitle.textContent = 'Lista de ahorros  s(i,j) = d(0,i) + d(0,j) − d(i,j)'
    let html = '<thead><tr><th class="num">#</th><th class="num">i</th><th class="num">j</th><th class="num">d(0,i)</th><th class="num">d(0,j)</th><th class="num">d(i,j)</th><th class="num">Ahorro</th><th>Estado</th></tr></thead><tbody>'
    cw().savings.forEach((s, idx) => {
      html += `<tr><td class="num">${idx + 1}</td><td class="num">${s.i}</td><td class="num">${s.j}</td><td class="num">${f1(s.d0i)}</td><td class="num">${f1(s.d0j)}</td><td class="num">${f1(s.dij)}</td><td class="num">${f1(s.value)}</td><td>Pendiente</td></tr>`
    })
    tblHist.innerHTML = html + '</tbody>'
    histRows = Array.from(tblHist.querySelectorAll('tbody tr'))
  } else {
    const rnd = createRng(seedUsed + 1)
    solver = new TabuSearch(inst, readInt(inIter, 100), readInt(inTenure, 7), selInit.value === 'cw', rnd)
    histTitle.textContent = 'Historial de iteraciones de la búsqueda tabú'
    tblHist.innerHTML = '<thead><tr><th class="num">It.</th><th>Movimiento</th><th class="num">Coste</th><th class="num">Mejor</th><th>Nota</th></tr></thead><tbody></tbody>'
    histRows = []
  }
  refresh(null)
}

function startAuto() {
  if (solver.done || busy) return
  stopAuto()
  timer = window.setInterval(() => (solver.done ? stopAuto() : doStep(false)), 1100 - Number(inSpeed.value) * 100)
  btnAuto.textContent = 'Pausa ⏸'
}

function stopAuto() {
  if (timer !== null) clearInterval(timer)
  timer = null
  btnAuto.textContent = 'Automático ⏵'
}

function stepOnce(untilGood: boolean) {
  if (!isTabu()) {
    do cw().step()
    while (untilGood && !cw().merged && !cw().done)
  } else {
    do tabu().step()
    while (untilGood && !(tabu().records.length > 0 && tabu().records[tabu().records.length - 1].newBest) && !tabu().done)
  }
}

function doStep(untilGood: boolean) {
  if (solver.done || busy) return
  const from = solver.steps
  stepOnce(untilGood)
  sync(from)
}

/** Resuelve todo en trozos para no bloquear la pantalla en búsquedas tabú largas. */
function solveAll() {
  if (solver.done || busy) return
  stopAuto()
  busy = true
  const from = solver.steps
  const work = () => {
    if (!busy) return
    const t0 = performance.now()
    while (!solver.done && performance.now() - t0 < 40) solver.step()
    if (solver.done) {
      busy = false
      sync(from)
    } else {
      statusBox.textContent = `Calculando… iteración ${solver.steps}`
      setTimeout(work, 0)
    }
  }
  work()
}

/** Vuelca en la tabla los pasos dados desde «from». */
function sync(from: number) {
  if (!isTabu()) {
    for (let i = from; i < cw().next; i++) updateSavingRow(i)
    refresh(cw().next - 1)
  } else {
    const recs = tabu().records
    const frag = document.createDocumentFragment()
    const body = tblHist.tBodies[0]
    for (let i = histRows.length; i < recs.length; i++) {
      const r = recs[i]
      const tr = document.createElement('tr')
      tr.className = r.newBest ? 'newbest' : r.uphill ? 'uphill' : ''
      tr.innerHTML = `<td class="num">${r.iter}</td><td>${r.move}</td><td class="num">${f1(r.cost)}</td><td class="num">${f1(r.best)}</td><td>${r.note}</td>`
      histRows.push(tr)
      frag.appendChild(tr)
    }
    body.appendChild(frag)
    refresh(histRows.length - 1)
  }
}

function updateSavingRow(i: number) {
  const s = cw().savings[i]
  const tr = histRows[i]
  tr.className = s.status === 'merged' ? 'merged' : 'rejected'
  tr.cells[7].textContent = (s.status === 'merged' ? '✔ ' : '✘ ') + s.reason
}

function refresh(currentRow: number | null) {
  // Tabla de rutas
  const routes = [...solver.routes].sort((a, b) => (a.vehicle || 1e9) - (b.vehicle || 1e9) || a.id - b.id)
  let html = '<thead><tr><th>Ruta</th><th>Vehículo</th><th>Recorrido</th><th class="num">Carga</th><th class="num">% cap.</th><th class="num">Distancia</th></tr></thead><tbody>'
  for (const r of routes) {
    const gray = solver.grayLonely && r.nodes.length === 1
    const over = r.vehicle === 0 || r.load > solver.p.q
    html +=
      `<tr class="${over ? 'over' : ''}"><td class="chip" style="background:${gray ? '#dcdcdc' : colorOf(r)};color:${gray ? '#000' : '#fff'}">R${r.id}</td>` +
      `<td>${r.vehicle > 0 ? 'V' + r.vehicle : '—'}</td><td>${r.text()}</td><td class="num">${r.load}</td>` +
      `<td class="num">${Math.round((100 * r.load) / solver.p.q)} %</td><td class="num">${f1(r.distance(solver.p))}</td></tr>`
  }
  tblRoutes.innerHTML = html + '</tbody>'

  // Fila actual
  histRows.forEach((tr) => tr.classList.remove('current'))
  if (currentRow !== null && currentRow >= 0 && currentRow < histRows.length) {
    const tr = histRows[currentRow]
    tr.classList.add('current')
    const head = (tblHist.tHead?.offsetHeight ?? 0) + 4
    histWrap.scrollTop = Math.max(0, tr.offsetTop - head - 4 * tr.offsetHeight)
  } else {
    histWrap.scrollTop = 0
  }

  statusBox.textContent = solver.message
  const p = solver.p
  let bad = false
  if (!isTabu()) {
    const c = cw()
    const extra = c.routes.length - p.k
    bad = c.done && extra > 0
    summary.textContent =
      `Rutas: ${c.routes.length}   ·   Vehículos: ${p.k}   ·   Distancia total: ${f1(c.totalDistance)}   ·   ` +
      `Ahorro acumulado: ${f1(c.initialDistance - c.totalDistance)}   ·   Ahorros examinados: ${c.next}/${c.savings.length}` +
      (c.done ? (extra > 0 ? '   ·   ⚠ No factible con la flota' : '   ·   ✔ Solución factible') : '')
  } else {
    const t = tabu()
    const feas = t.done ? t.bestFeasible : t.currentFeasible
    bad = !feas
    summary.textContent =
      `Iteración ${t.iter}/${t.maxIter}   ·   Distancia actual: ${f1(t.totalDistance)}   ·   Mejor coste: ${f1(t.bestCost)}   ·   ` +
      `Distancia inicial: ${f1(t.initialDistance)}   ·   ` + (feas ? '✔ Factible' : '⚠ Con exceso de carga')
  }
  summary.classList.toggle('bad', bad)

  const done = solver.done
  btnStep.disabled = btnMerge.disabled = btnAuto.disabled = btnAll.disabled = done
  if (done) stopAuto()
  redraw()
}

function redraw() {
  drawMap(map, solver)
  if (isTabu()) drawChart(chart, tabu())
}

// Eventos
btnNew.onclick = () => newProblem()
btnMatrix.onclick = showMatrix
btnShare.onclick = async () => {
  writeHash()
  try {
    await navigator.clipboard.writeText(location.href)
    btnShare.textContent = 'Enlace copiado ✔'
  } catch {
    btnShare.textContent = 'Copia la barra de direcciones'
  }
  setTimeout(() => (btnShare.textContent = 'Copiar enlace'), 2000)
}
btnReset.onclick = () => reset()
btnStep.onclick = () => {
  stopAuto()
  doStep(false)
}
btnMerge.onclick = () => {
  stopAuto()
  doStep(true)
}
btnAll.onclick = solveAll
btnAuto.onclick = () => (timer !== null ? stopAuto() : startAuto())
selAlgo.onchange = () => reset()
selInit.onchange = () => reset()
inIter.onchange = () => reset()
inTenure.onchange = () => reset()
inSpeed.oninput = () => {
  if (timer !== null) startAuto()
}
for (const el of [inN, inK, inQ, inSeed]) el.addEventListener('keydown', (e) => e.key === 'Enter' && newProblem())
new ResizeObserver(() => solver && redraw()).observe(map)
new ResizeObserver(() => solver && isTabu() && redraw()).observe(chart)
window.addEventListener('resize', () => solver && redraw())

if (readHash()) newProblem(Number(inSeed.value) || undefined)
else newProblem()
