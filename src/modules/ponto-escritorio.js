// ═══════════════════════════════════════════════════════════════════
//  PONTO DO ESCRITÓRIO — folha de ponto mensal de quem trabalha no escritório.
//  · Cada pessoa preenche os seus dias (X, F, FE, FJ, FI, B, LP); o administrador corrige os de qualquer pessoa.
//  · Os diretores de obra lançam a afetação do mês (%) por obra, só nas obras onde são diretores (RLS no servidor).
//  Tabelas: fp_esc_dias, fp_esc_afetacao; quem tem folha: colaboradores.escritorio / colaboradores.utilizador.
// ═══════════════════════════════════════════════════════════════════
import { S } from '../state.js';
import { sb } from '../supabase.js';
import { MESES_PT, obraEmCurso } from '../config.js';

const CODIGOS = [
  { c: 'X',  t: 'Presente',            k: 'ok' },
  { c: 'F',  t: 'Feriado',             k: 'fer' },
  { c: 'FE', t: 'Férias',              k: 'fe' },
  { c: 'FJ', t: 'Falta justificada',   k: 'fj' },
  { c: 'FI', t: 'Falta injustificada', k: 'fi' },
  { c: 'B',  t: 'Baixa médica',        k: 'bx' },
  { c: 'LP', t: 'Licença parental',    k: 'lp' },
];
const KLASSE = Object.fromEntries(CODIGOS.map(x => [x.c, x.k]));
const DIA_SEM = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

let _ano = new Date().getFullYear();
let _mes = new Date().getMonth();   // 0-11
let _sel = null;                    // nº do colaborador aberto
let _brush = 'X';
let _dias = {};                     // 'YYYY-MM-DD' → código (colaborador aberto)
let _diasTodos = [];                // dias do mês de todos os colaboradores visíveis
let _afetTodos = [];                // afetações do mês de todos
let _feriados = {};                 // 'YYYY-MM-DD' → nome
let _tok = 0;                       // evita que um carregamento antigo apague o mais recente

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = n => String(n).padStart(2, '0');
const toast = m => (window.showToast ? window.showToast(m) : alert(m));
const dstr = (y, m, d) => `${y}-${p2(m + 1)}-${p2(d)}`;
const mesIni = () => dstr(_ano, _mes, 1);
const nDiasMes = () => new Date(_ano, _mes + 1, 0).getDate();
const fmtPct = v => (Math.round(v * 100) / 100).toLocaleString('pt-PT') + ' %';

const meuUser = () => S.currentUser?.key;
const ehAdmin = () => S.currentUser?.role === 'admin';
const ehDiretor = () => S.currentUser?.role === 'diretor_obra';
const ehFinanceiro = () => S.currentUser?.role === 'financeiro';
// Lista de pessoas: só o financeiro vê todas; todos os outros (admin e diretores incluídos) veem apenas o seu nome
const verEquipa = () => ehFinanceiro();

const pessoas = () => (S.COLABORADORES || []).filter(c => c.esc && c.ativo).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
const minha = () => pessoas().find(c => c.user && c.user === meuUser());
const visiveis = () => verEquipa() ? pessoas() : (minha() ? [minha()] : []);
const pessoaSel = () => visiveis().find(c => c.n === _sel) || null;
// Os dias de uma pessoa só os vê ela própria e o financeiro (nem o administrador vê os dos outros)
const verDias = () => { const p = pessoaSel(); return !!p && (ehFinanceiro() || (p.user && p.user === meuUser())); };
const podeEditarDias = () => { const p = pessoaSel(); return !!p && !!p.user && p.user === meuUser(); };

// Obra onde o utilizador atual pode lançar percentagens
const souDiretorDe = o => ehAdmin() || o.diretor_id === meuUser() || (o.diretores_extra || []).includes(meuUser());
const codObra = o => (String(o.nome || '').match(/^(O\d+)\s*[-–]\s*/) || [])[1] || '';
const nomeObra = o => String(o.nome || '').replace(/^O\d+\s*[-–]\s*/, '');
const nomeUser = k => S.USERS?.[k]?.nome || k || '';

// ── Carregamento ──────────────────────────────────────────────────
async function carregar() {
  const ini = mesIni(), fim = dstr(_ano, _mes, nDiasMes());
  const [d, a, f] = await Promise.all([
    sb.from('fp_esc_dias').select('colaborador,data,codigo').gte('data', ini).lte('data', fim),
    sb.from('fp_esc_afetacao').select('colaborador,obra_id,percentagem,definido_por').eq('mes', ini),
    sb.from('feriados_pt').select('data,nome').gte('data', ini).lte('data', fim),
  ]);
  if (d.error) throw d.error;
  if (a.error) throw a.error;
  _diasTodos = d.data || [];
  _afetTodos = a.data || [];
  _feriados = Object.fromEntries((f.data || []).map(x => [x.data, x.nome]));
  _dias = {};
  _diasTodos.filter(x => x.colaborador === _sel).forEach(x => { _dias[x.data] = x.codigo; });
}

function escolherInicial() {
  const v = visiveis();
  if (v.some(c => c.n === _sel)) return;
  _sel = (minha() || v[0] || {}).n ?? null;
}

export async function renderPontoEsc(reset) {
  const cont = document.getElementById('pe-cont');
  if (!cont) return;
  if (reset === true) { _ano = new Date().getFullYear(); _mes = new Date().getMonth(); _sel = null; _brush = 'X'; }
  escolherInicial();
  const tok = ++_tok;
  if (_sel == null) { desenhar(); return; }
  try {
    await carregar();
  } catch (e) {
    if (tok !== _tok) return;
    cont.innerHTML = `<div class="pe-vazio">Não foi possível carregar a folha de ponto. ${esc(e.message || '')}</div>`;
    return;
  }
  if (tok !== _tok) return;
  desenhar();
}

// ── Cálculos ──────────────────────────────────────────────────────
const afetDe = n => _afetTodos.filter(x => x.colaborador === n);
const totalPct = n => afetDe(n).reduce((s, x) => s + Number(x.percentagem), 0);
const contar = (cods) => Object.values(_dias).filter(c => cods.includes(c)).length;

// ── Desenho ───────────────────────────────────────────────────────
function desenhar() {
  const cont = document.getElementById('pe-cont');
  if (!cont) return;
  const strip = cont.querySelector('.pe-strip');
  const scroll = strip ? strip.scrollLeft : 0;
  const sub = document.getElementById('pe-sub');
  const p = pessoaSel();

  if (!p) {
    if (sub) sub.textContent = 'Presenças do mês e afetação por obra';
    cont.innerHTML = `<div class="pe-vazio">${verEquipa()
      ? 'Ainda não há ninguém com folha de ponto do escritório. Em <b>Colaboradores</b>, edite a pessoa e marque «Tem folha de ponto mensal do escritório».'
      : 'Ainda não tem uma folha de ponto associada. Peça ao administrador para ligar o seu utilizador ao seu colaborador, em <b>Colaboradores</b>.'}</div>`;
    return;
  }
  if (sub) sub.textContent = `${p.nome}${p.func ? ' · ' + p.func : ''}`;

  const pessoasLista = visiveis();
  const total = totalPct(p.n), vd = verDias();
  cont.innerHTML = `
    <div class="pe-bar">
      <div class="pe-mes">
        <button type="button" onclick="peNavMes(-1)" aria-label="Mês anterior"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
        <b>${MESES_PT[_mes]} ${_ano}</b>
        <button type="button" onclick="peNavMes(1)" aria-label="Mês seguinte"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
      </div>
      ${pessoasLista.length > 1 ? `<div class="field pe-quem"><label>Colaborador</label><select onchange="peEscolher(this.value)">${pessoasLista.map(c => `<option value="${c.n}"${c.n === p.n ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>` : ''}
    </div>

    <div class="pe-kpis">
      ${vd ? `<div class="pe-kpi"><span>Presenças</span><b>${contar(['X'])}</b><small>dias de trabalho</small></div>
      <div class="pe-kpi"><span>Férias</span><b class="t">${contar(['FE'])}</b><small>dias gozados no mês</small></div>
      <div class="pe-kpi"><span>Faltas</span><b class="${contar(['FJ', 'FI']) ? 'e' : ''}">${contar(['FJ', 'FI'])}</b><small>justificadas e injustificadas</small></div>` : ''}
      <div class="pe-kpi"><span>Afetação</span><b class="${classeTotal(total)}">${fmtPct(total)}</b><small>${textoTotal(total)}</small></div>
    </div>

    ${vd ? `<div class="pe-card">
      <div class="pe-card-h">
        <div><b>Presenças e ausências</b><small>${podeEditarDias() ? 'Escolha o código e toque nos dias. Toque outra vez para limpar.' : 'Só a própria pessoa (ou o administrador) preenche os dias.'}</small></div>
        ${podeEditarDias() ? `<div class="pe-acts"><button type="button" class="btn btn-secondary btn-sm" onclick="pePreencher()">Preencher dias úteis</button><button type="button" class="btn btn-secondary btn-sm" onclick="peLimparMes()">Limpar mês</button></div>` : ''}
      </div>
      ${podeEditarDias() ? `<div class="pe-leg">${CODIGOS.map(x => `<button type="button" class="pe-chip k-${x.k}${_brush === x.c ? ' on' : ''}" onclick="peBrush('${x.c}')"><b>${x.c}</b>${x.t}</button>`).join('')}</div>` : `<div class="pe-leg">${CODIGOS.map(x => `<span class="pe-chip k-${x.k}"><b>${x.c}</b>${x.t}</span>`).join('')}</div>`}
      <div class="pe-strip">${diasHTML()}</div>
    </div>` : ''}

    <div class="pe-card">
      <div class="pe-card-h">
        <div><b>Afetação por obra</b><small>${ehDiretor() || ehAdmin() ? 'Percentagem do tempo do mês dedicada a cada obra. Cada diretor lança só nas suas obras.' : 'Percentagem do tempo do mês dedicada a cada obra, lançada pelos diretores de obra.'}</small></div>
        <span class="pe-tot ${classeTotal(total)}">${fmtPct(total)}</span>
      </div>
      <div class="pe-afet">${afetHTML(p)}</div>
    </div>

    ${pessoasLista.length > 1 ? `
    <div class="pe-card">
      <div class="pe-card-h"><div><b>Equipa em ${MESES_PT[_mes]}</b><small>${ehDiretor() ? 'Afetação já lançada' : 'Dias registados e afetação já lançada'}</small></div></div>
      <div class="pe-eq">${pessoasLista.map(c => {
        const t = totalPct(c.n), nd = _diasTodos.filter(x => x.colaborador === c.n).length;
        return `<button type="button" class="pe-eq-r${c.n === p.n ? ' on' : ''}" onclick="peAbrirPessoa(${c.n})"><span class="pe-eq-n"><b>${esc(c.nome)}</b><small>${esc(c.func || '')}</small></span><span class="pe-eq-d">${ehDiretor() ? '' : `${nd} dia${nd === 1 ? '' : 's'}`}</span><span class="pe-pill ${classeTotal(t)}">${t ? fmtPct(t) : 'Sem afetação'}</span></button>`;
      }).join('')}</div>
    </div>` : ''}`;

  const novo = cont.querySelector('.pe-strip');
  if (novo) novo.scrollLeft = scroll;
}

function classeTotal(t) {
  if (!t) return 'z';
  return Math.abs(t - 100) < 0.005 ? 'ok' : t > 100 ? 'bad' : 'e';
}
function textoTotal(t) {
  if (!t) return 'ainda sem obras';
  if (Math.abs(t - 100) < 0.005) return 'tudo atribuído';
  return t > 100 ? 'acima de 100 %' : `falta atribuir ${fmtPct(100 - t)}`;
}

function diasHTML() {
  const edit = podeEditarDias();
  let h = '';
  for (let d = 1; d <= nDiasMes(); d++) {
    const ds = dstr(_ano, _mes, d), wd = new Date(_ano, _mes, d).getDay(), cod = _dias[ds] || '';
    const fer = _feriados[ds];
    h += `<button type="button" class="pe-d${wd === 0 || wd === 6 ? ' we' : ''}${fer ? ' fer' : ''}${cod ? ' k-' + KLASSE[cod] : ''}"${edit ? ` onclick="peClickDia('${ds}')"` : ' disabled'}${fer ? ` title="${esc(fer)}"` : ''}><span class="pe-dw">${DIA_SEM[wd]}</span><span class="pe-dn">${d}</span><span class="pe-dc">${cod}</span></button>`;
  }
  return h;
}

function afetHTML(p) {
  const regs = Object.fromEntries(afetDe(p.n).map(x => [x.obra_id, x]));
  const obras = (S.OBRAS || []).filter(o => {
    if (regs[o.id]) return true;
    return obraEmCurso(o) && souDiretorDe(o) && (ehDiretor() || ehAdmin());
  }).sort((a, b) => (codObra(a) || 'Z').localeCompare(codObra(b) || 'Z'));
  if (!obras.length) return '<div class="pe-vazio sm">Ainda não há afetação lançada para este mês.</div>';
  return obras.map(o => {
    const r = regs[o.id], v = r ? Number(r.percentagem) : 0, ed = souDiretorDe(o);
    return `<div class="pe-o">
      <div class="pe-o-n"><span class="pe-cod">${esc(codObra(o) || 'Obra')}</span><span class="pe-o-t"><b>${esc(nomeObra(o))}</b>${r ? `<small>Lançado por ${esc(nomeUser(r.definido_por))}</small>` : ''}</span></div>
      <div class="pe-o-b"><i style="width:${Math.min(v, 100)}%"></i></div>
      ${ed
        ? `<label class="pe-in"><input type="number" inputmode="decimal" min="0" max="100" step="5" value="${v || ''}" placeholder="0" onchange="peSetPct('${o.id}',this.value,this)" aria-label="Percentagem em ${esc(nomeObra(o))}"/><span>%</span></label>`
        : `<span class="pe-o-v">${fmtPct(v)}</span>`}
    </div>`;
  }).join('');
}

// ── Ações ─────────────────────────────────────────────────────────
export function peNavMes(delta) {
  _mes += delta;
  if (_mes < 0) { _mes = 11; _ano--; }
  if (_mes > 11) { _mes = 0; _ano++; }
  renderPontoEsc();
}
export function peEscolher(n) { _sel = Number(n); renderPontoEsc(); }
export function peAbrirPessoa(n) { _sel = Number(n); renderPontoEsc(); window.scrollTo?.({ top: 0, behavior: 'smooth' }); }
export function peBrush(c) { _brush = c; desenhar(); }

async function gravarDia(ds, cod) {
  const n = _sel;
  const r = cod
    ? await sb.from('fp_esc_dias').upsert({ colaborador: n, data: ds, codigo: cod }, { onConflict: 'colaborador,data' })
    : await sb.from('fp_esc_dias').delete().eq('colaborador', n).eq('data', ds);
  return r.error;
}
function aplicarLocal(ds, cod) {
  if (cod) _dias[ds] = cod; else delete _dias[ds];
  _diasTodos = _diasTodos.filter(x => !(x.colaborador === _sel && x.data === ds));
  if (cod) _diasTodos.push({ colaborador: _sel, data: ds, codigo: cod });
}

export async function peClickDia(ds) {
  if (!podeEditarDias()) return;
  const antes = _dias[ds] || '';
  const novo = antes === _brush ? '' : _brush;
  aplicarLocal(ds, novo);
  desenhar();
  const err = await gravarDia(ds, novo);
  if (err) { toast('Não foi possível guardar o dia: ' + (err.message || '')); aplicarLocal(ds, antes); desenhar(); }
}

// Dias úteis em branco ficam «X»; feriados nacionais «F»; férias previstas «FE»
export async function pePreencher() {
  if (!podeEditarDias()) return;
  const { data: prev } = await sb.from('ferias_previstas').select('data').eq('colab_numero', _sel)
    .gte('data', mesIni()).lte('data', dstr(_ano, _mes, nDiasMes()));
  const ferias = new Set((prev || []).map(x => x.data));
  const novos = [];
  for (let d = 1; d <= nDiasMes(); d++) {
    const ds = dstr(_ano, _mes, d), wd = new Date(_ano, _mes, d).getDay();
    if (_dias[ds] || wd === 0 || wd === 6) continue;
    novos.push({ colaborador: _sel, data: ds, codigo: _feriados[ds] ? 'F' : ferias.has(ds) ? 'FE' : 'X' });
  }
  if (!novos.length) { toast('Os dias úteis já estão preenchidos'); return; }
  const { error } = await sb.from('fp_esc_dias').upsert(novos, { onConflict: 'colaborador,data' });
  if (error) { toast('Não foi possível preencher: ' + (error.message || '')); return; }
  novos.forEach(x => aplicarLocal(x.data, x.codigo));
  desenhar();
  toast(`${novos.length} dias preenchidos ✓`);
}

export async function peLimparMes() {
  if (!podeEditarDias() || !Object.keys(_dias).length) return;
  if (!confirm(`Limpar todos os dias de ${MESES_PT[_mes]} ${_ano}?`)) return;
  const { error } = await sb.from('fp_esc_dias').delete().eq('colaborador', _sel)
    .gte('data', mesIni()).lte('data', dstr(_ano, _mes, nDiasMes()));
  if (error) { toast('Não foi possível limpar: ' + (error.message || '')); return; }
  _dias = {};
  _diasTodos = _diasTodos.filter(x => x.colaborador !== _sel);
  desenhar();
}

export async function peSetPct(obraId, valor, el) {
  const p = pessoaSel(), o = (S.OBRAS || []).find(x => x.id === obraId);
  if (!p || !o || !souDiretorDe(o)) return;
  let v = Math.round(parseFloat(String(valor).replace(',', '.')) * 100) / 100;
  if (!(v > 0)) v = 0;
  if (v > 100) v = 100;
  const outros = afetDe(p.n).filter(x => x.obra_id !== obraId).reduce((s, x) => s + Number(x.percentagem), 0);
  if (outros + v > 100.001) {
    toast(`Passaria de 100 % (já há ${fmtPct(outros)} noutras obras)`);
    desenhar();
    return;
  }
  const mes = mesIni();
  const r = v
    ? await sb.from('fp_esc_afetacao').upsert({ colaborador: p.n, mes, obra_id: obraId, percentagem: v }, { onConflict: 'colaborador,mes,obra_id' })
    : await sb.from('fp_esc_afetacao').delete().eq('colaborador', p.n).eq('mes', mes).eq('obra_id', obraId);
  if (r.error) { toast('Não foi possível guardar: ' + (r.error.message || '')); renderPontoEsc(); return; }
  _afetTodos = _afetTodos.filter(x => !(x.colaborador === p.n && x.obra_id === obraId));
  if (v) _afetTodos.push({ colaborador: p.n, obra_id: obraId, percentagem: v, definido_por: meuUser() });
  desenhar();
  toast('Afetação guardada ✓');
}
