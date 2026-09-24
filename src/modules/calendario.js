// ═══════════════════════════════════════
//  CALENDÁRIO — lembretes e datas importantes (estilo iPhone)
//  Página própria (vista de mês) + widget no Painel Principal.
//  Eventos pessoais ou partilhados; só o autor edita (garantido por RLS).
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { showToast } from './navigation.js';

export const CAL_CATEGORIAS = {
  lembrete:    { label: 'Lembrete',        cor: '#3b82f6' },
  importante:  { label: 'Data importante', cor: '#ef4444' },
  reuniao:     { label: 'Reunião',         cor: '#8b5cf6' },
  aniversario: { label: 'Aniversário',     cor: '#ec4899' },
  outro:       { label: 'Outro',           cor: '#64748b' },
};

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_SEM = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
const DIAS_LONGO = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

let _eventos = [];
let _carregado = false;
let _sel = _ymd(new Date());                       // dia seleccionado (partilhado entre página e widget)
const _vista = { pg: _mesDe(_sel), wd: _mesDe(_sel) }; // mês visível em cada vista
let _editId = null;
let _visib = 'eu';            // 'eu' | 'equipa' | 'pessoas' (no modal)
let _pessoasSel = new Set();  // usernames escolhidos em "Pessoas específicas"

// ── Datas ───────────────────────────────────────────────────────────
function _ymd(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function _mesDe(ymd){ const [y,m] = ymd.split('-').map(Number); return { y, m: m-1 }; }
function _parse(ymd){ const [y,m,d] = ymd.split('-').map(Number); return new Date(y, m-1, d, 12); }

function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── Dados ───────────────────────────────────────────────────────────
async function _carregar(){
  try {
    const { data, error } = await sb.from('calendario_eventos').select('*').order('data');
    if (error) throw error;
    _eventos = data || [];
    _carregado = true;
  } catch (e) {
    console.warn('Calendário — erro ao carregar:', e);
    _eventos = [];
  }
}

function _meu(ev){ return ev.criado_por === S.currentUser?.key; }

function _nome(username){ return S.USERS?.[username]?.nome || username; }

// Pessoas do escritório com quem se pode partilhar (os encarregados não têm calendário)
function _pessoasEquipa(){
  const me = S.currentUser?.key;
  return Object.entries(S.USERS || {})
    .filter(([k,u]) => k !== me && u.role !== 'encarregado')
    .map(([k,u]) => ({ key: k, nome: u.nome || k }))
    .sort((a,b) => a.nome.localeCompare(b.nome));
}

// Texto curto sobre com quem o evento está partilhado (null = privado)
function _partilhaInfo(e){
  if (!_meu(e)) return { txt: _nome(e.criado_por), tip: 'Partilhado por ' + _nome(e.criado_por) };
  if (e.partilhado) return { txt: 'Equipa', tip: 'Partilhado com toda a equipa' };
  const lst = e.partilhado_com || [];
  if (!lst.length) return null;
  const nomes = lst.map(_nome);
  return { txt: lst.length === 1 ? nomes[0] : lst.length + ' pessoas', tip: 'Partilhado com ' + nomes.join(', ') };
}

// Eventos de um dia (inclui os anuais de anos anteriores), ordenados: dia inteiro primeiro, depois por hora
function _eventosDoDia(ymd){
  return _eventos.filter(e =>
    e.data === ymd || (e.anual && e.data < ymd && e.data.slice(5) === ymd.slice(5))
  ).sort((a,b) => (a.hora||'').localeCompare(b.hora||'') || a.titulo.localeCompare(b.titulo));
}

// ── Grelha do mês (comum às duas vistas) ────────────────────────────
function _celulasMes(y, m){
  const primeiro = new Date(y, m, 1);
  const offset = (primeiro.getDay() + 6) % 7;        // semana começa à segunda
  const inicio = new Date(y, m, 1 - offset, 12);
  const semanas = Math.ceil((offset + new Date(y, m+1, 0).getDate()) / 7);
  const cel = [];
  for (let i = 0; i < semanas * 7; i++){
    const d = new Date(inicio); d.setDate(inicio.getDate() + i);
    cel.push({ ymd: _ymd(d), dia: d.getDate(), fora: d.getMonth() !== m });
  }
  return cel;
}

function _cabecalho(v, vista){
  return `
    <button class="cal-nav" type="button" onclick="calMudarMes('${vista}',-1)" aria-label="Mês anterior">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <span class="cal-mes">${MESES[v.m]} <span class="cal-ano">${v.y}</span></span>
    <button class="cal-nav" type="button" onclick="calMudarMes('${vista}',1)" aria-label="Mês seguinte">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>`;
}

// ── Lista de um dia (comum: página e widget) ────────────────────────
function _listaDia(ymd, compacto){
  const evs = _eventosDoDia(ymd);
  if (!evs.length){
    return `<div class="cal-vazio">
      Sem lembretes neste dia
      <button class="cal-link" type="button" onclick="calNovoEvento('${ymd}')">+ Adicionar</button>
    </div>`;
  }
  return evs.map(e => {
    const cat = CAL_CATEGORIAS[e.categoria] || CAL_CATEGORIAS.outro;
    const meu = _meu(e);
    const part = _partilhaInfo(e);
    return `
    <div class="cal-ev ${e.concluido?'feito':''}" style="--ev-cor:${cat.cor}">
      ${meu
        ? `<button class="cal-ev-check" type="button" onclick="calToggleConcluido('${e.id}')" title="${e.concluido?'Marcar por fazer':'Marcar como feito'}">
             ${e.concluido?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>':''}
           </button>`
        : '<span class="cal-ev-bar"></span>'}
      <div class="cal-ev-body" onclick="calAbrirEvento('${e.id}')">
        <div class="cal-ev-tit">${escapeHtml(e.titulo)}</div>
        <div class="cal-ev-meta">
          <span>${e.hora ? e.hora.slice(0,5) : 'Dia inteiro'}</span>
          <span class="cal-ev-cat">${cat.label}</span>
          ${e.anual ? '<span title="Repete todos os anos">↻ Anual</span>' : ''}
          ${part ? `<span title="${escapeHtml(part.tip)}">👥 ${escapeHtml(part.txt)}</span>` : ''}
        </div>
        ${!compacto && e.notas ? `<div class="cal-ev-notas">${escapeHtml(e.notas)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function _tituloDia(ymd){
  const d = _parse(ymd);
  const hoje = _ymd(new Date());
  const amanha = _ymd(new Date(Date.now() + 864e5));
  const prefixo = ymd === hoje ? 'Hoje · ' : ymd === amanha ? 'Amanhã · ' : '';
  return prefixo + DIAS_LONGO[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()].toLowerCase();
}

// ── WIDGET do Painel ────────────────────────────────────────────────
export async function renderCalWidget(){
  const box = document.getElementById('cal-widget');
  if (!box) return;
  if (!_carregado) await _carregar();
  const v = _vista.wd;
  const hoje = _ymd(new Date());
  const dias = _celulasMes(v.y, v.m).map(c => {
    const n = _eventosDoDia(c.ymd).length;
    return `<button type="button" class="cal-d ${c.fora?'fora':''} ${c.ymd===hoje?'hoje':''} ${c.ymd===_sel?'sel':''}"
      onclick="calSelDia('${c.ymd}','wd')"><span>${c.dia}</span>${n?'<i class="cal-dot"></i>':''}</button>`;
  }).join('');

  box.innerHTML = `
    <div class="cal-w-hdr">
      ${_cabecalho(v,'wd')}
      <button class="cal-add" type="button" onclick="calNovoEvento()" title="Novo lembrete">+</button>
    </div>
    <div class="cal-grid cal-grid-mini">
      ${DIAS_SEM.map(d=>`<div class="cal-dow">${d[0]}</div>`).join('')}
      ${dias}
    </div>
    <div class="cal-w-dia">${_tituloDia(_sel)}</div>
    <div class="cal-w-lista">${_listaDia(_sel, true)}</div>
    <button class="cal-w-abrir" type="button" onclick="goTo('calendario')">Abrir calendário</button>`;
}

// ── PÁGINA ──────────────────────────────────────────────────────────
export async function initCalendario(){
  await _carregar();
  renderCalPagina();
}

export function renderCalPagina(){
  const hdr = document.getElementById('cal-pg-hdr');
  const grid = document.getElementById('cal-pg-grid');
  if (!hdr || !grid) return;
  const v = _vista.pg;
  const hoje = _ymd(new Date());
  hdr.innerHTML = _cabecalho(v,'pg');

  grid.innerHTML = DIAS_SEM.map(d=>`<div class="cal-dow">${d}</div>`).join('') +
    _celulasMes(v.y, v.m).map(c => {
      const evs = _eventosDoDia(c.ymd);
      const chips = evs.slice(0,3).map(e => {
        const cor = (CAL_CATEGORIAS[e.categoria]||CAL_CATEGORIAS.outro).cor;
        return `<div class="cal-chip ${e.concluido?'feito':''}" style="--ev-cor:${cor}">${e.hora?`<b>${e.hora.slice(0,5)}</b> `:''}${escapeHtml(e.titulo)}</div>`;
      }).join('');
      const mais = evs.length > 3 ? `<div class="cal-mais">+${evs.length-3}</div>` : '';
      return `<div class="cal-cel ${c.fora?'fora':''} ${c.ymd===hoje?'hoje':''} ${c.ymd===_sel?'sel':''}"
        onclick="calSelDia('${c.ymd}','pg')" ondblclick="calNovoEvento('${c.ymd}')">
        <div class="cal-cel-n"><span>${c.dia}</span></div>
        ${chips}${mais}
        ${evs.length ? `<i class="cal-dot cal-dot-m"></i>` : ''}
      </div>`;
    }).join('');

  const tit = document.getElementById('cal-pg-dia');
  const lista = document.getElementById('cal-pg-lista');
  if (tit) tit.textContent = _tituloDia(_sel);
  if (lista) lista.innerHTML = _listaDia(_sel, false);
}

// ── Interacção ──────────────────────────────────────────────────────
function _rerender(){
  renderCalPagina();
  renderCalWidget();
}

export function calMudarMes(vista, dir){
  const v = _vista[vista];
  v.m += dir;
  if (v.m > 11){ v.m = 0; v.y++; }
  if (v.m < 0){ v.m = 11; v.y--; }
  vista === 'pg' ? renderCalPagina() : renderCalWidget();
}

export function calHoje(){
  _sel = _ymd(new Date());
  _vista.pg = _mesDe(_sel);
  _vista.wd = _mesDe(_sel);
  _rerender();
}

export function calSelDia(ymd, vista){
  _sel = ymd;
  // Clicar num dia de outro mês salta para esse mês
  const alvo = _mesDe(ymd), v = _vista[vista];
  if (alvo.y !== v.y || alvo.m !== v.m) _vista[vista] = alvo;
  vista === 'pg' ? renderCalPagina() : renderCalWidget();
}

// ── Modal criar / editar / ver ─────────────────────────────────────
function _$(id){ return document.getElementById(id); }

function _abrirModal(ev, dataPredef){
  _editId = ev?.id || null;
  const soLeitura = !!ev && !_meu(ev);
  _$('cal-m-title').textContent = !ev ? 'Novo lembrete' : soLeitura ? 'Lembrete partilhado' : 'Editar lembrete';
  _$('cal-m-sub').textContent = soLeitura
    ? `Criado por ${_nome(ev.criado_por)} · só o autor pode alterar`
    : 'Guarde lembretes, reuniões e datas importantes';
  _$('cal-m-titulo').value = ev?.titulo || '';
  _$('cal-m-data').value = ev?.data || dataPredef || _sel;
  _$('cal-m-diainteiro').checked = !ev?.hora;
  _$('cal-m-hora').value = ev?.hora ? ev.hora.slice(0,5) : '09:00';
  _$('cal-m-hora').disabled = !ev?.hora;
  _$('cal-m-cat').value = ev?.categoria || 'lembrete';
  _$('cal-m-notas').value = ev?.notas || '';
  _$('cal-m-anual').checked = !!ev?.anual;
  _pessoasSel = new Set(ev?.partilhado_com || []);
  _$('cal-m-pessoas-q').value = '';

  _$('modal-calendario').querySelectorAll('input,select,textarea').forEach(el => {
    if (el.id === 'cal-m-hora') el.disabled = soLeitura || _$('cal-m-diainteiro').checked;
    else el.disabled = soLeitura;
  });
  _$('cal-m-visib').querySelectorAll('button').forEach(b => { b.disabled = soLeitura; });
  calSetVisib(ev?.partilhado ? 'equipa' : _pessoasSel.size ? 'pessoas' : 'eu');
  _$('cal-m-apagar').hidden = !ev || soLeitura;
  _$('cal-m-guardar').hidden = soLeitura;
  _$('cal-m-cancelar').textContent = soLeitura ? 'Fechar' : 'Cancelar';
  _$('modal-calendario').classList.add('open');
  if (!soLeitura) setTimeout(() => _$('cal-m-titulo').focus(), 50);
}

export function calNovoEvento(ymd){ _abrirModal(null, ymd); }

export function calAbrirEvento(id){
  const ev = _eventos.find(e => e.id === id);
  if (ev) _abrirModal(ev);
}

export function calToggleDiaInteiro(on){ _$('cal-m-hora').disabled = on; }

// ── Visibilidade: só eu / toda a equipa / pessoas específicas ──
export function calSetVisib(v){
  _visib = v;
  _$('cal-m-visib').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  _$('cal-m-pessoas').hidden = v !== 'pessoas';
  if (v === 'pessoas') _renderPessoas();
  _notaVisib();
}

function _notaVisib(){
  const n = _pessoasSel.size;
  _$('cal-m-visib-nota').textContent =
    _visib === 'eu' ? 'Só você vê este lembrete.' :
    _visib === 'equipa' ? 'Todos os utilizadores do escritório veem. Só você edita.' :
    n ? `${n} ${n === 1 ? 'pessoa escolhida' : 'pessoas escolhidas'} · veem mas só você edita.` : 'Escolha pelo menos uma pessoa.';
}

function _renderPessoas(){
  const q = (_$('cal-m-pessoas-q').value || '').trim().toLowerCase();
  const soLeitura = _$('cal-m-titulo').disabled;
  const lst = _pessoasEquipa().filter(p => !q || p.nome.toLowerCase().includes(q) || _pessoasSel.has(p.key));
  _$('cal-m-pessoas-lista').innerHTML = lst.length ? lst.map(p => `
    <label class="cal-pessoa">
      <input type="checkbox" ${_pessoasSel.has(p.key)?'checked':''}${soLeitura?' disabled':''} onchange="calTogglePessoa('${escapeHtml(p.key)}',this.checked)"/>
      <span class="cal-pessoa-av">${escapeHtml(p.nome.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase())}</span>
      <span>${escapeHtml(p.nome)}</span>
    </label>`).join('') : '<div class="cal-vazio">Nenhuma pessoa encontrada</div>';
}

export function calFiltrarPessoas(){ _renderPessoas(); }

export function calTogglePessoa(key, on){
  if (on) _pessoasSel.add(key); else _pessoasSel.delete(key);
  _notaVisib();
}

export function calFecharModal(){ _$('modal-calendario').classList.remove('open'); _editId = null; }

export async function calGuardar(){
  const titulo = _$('cal-m-titulo').value.trim();
  const data = _$('cal-m-data').value;
  if (!titulo){ showToast('Indique um título'); _$('cal-m-titulo').focus(); return; }
  if (!data){ showToast('Indique a data'); return; }
  const row = {
    titulo,
    data,
    hora: _$('cal-m-diainteiro').checked ? null : (_$('cal-m-hora').value || null),
    categoria: _$('cal-m-cat').value,
    notas: _$('cal-m-notas').value.trim() || null,
    anual: _$('cal-m-anual').checked,
    partilhado: _visib === 'equipa',
    partilhado_com: _visib === 'pessoas' ? [..._pessoasSel] : [],
  };
  if (_visib === 'pessoas' && !_pessoasSel.size){ showToast('Escolha pelo menos uma pessoa'); return; }
  const btn = _$('cal-m-guardar'); btn.disabled = true;
  try {
    const q = _editId
      ? sb.from('calendario_eventos').update(row).eq('id', _editId).select().single()
      : sb.from('calendario_eventos').insert(row).select().single();
    const { data: salvo, error } = await q;
    if (error) throw error;
    const i = _eventos.findIndex(e => e.id === salvo.id);
    if (i >= 0) _eventos[i] = salvo; else _eventos.push(salvo);
    _sel = salvo.data;
    _vista.pg = _mesDe(_sel); _vista.wd = _mesDe(_sel);
    calFecharModal();
    _rerender();
    showToast(i >= 0 ? 'Lembrete actualizado ✓' : 'Lembrete criado ✓');
  } catch (e) {
    console.warn('Calendário — erro ao guardar:', e);
    showToast('❌ Não foi possível guardar o lembrete');
  } finally { btn.disabled = false; }
}

export async function calApagar(){
  if (!_editId) return;
  const ev = _eventos.find(e => e.id === _editId);
  if (!confirm(`Apagar "${ev?.titulo || 'lembrete'}"?${ev?.anual ? ' (todas as repetições anuais)' : ''}`)) return;
  const { error } = await sb.from('calendario_eventos').delete().eq('id', _editId);
  if (error){ showToast('❌ Não foi possível apagar'); return; }
  _eventos = _eventos.filter(e => e.id !== _editId);
  calFecharModal();
  _rerender();
  showToast('Lembrete apagado');
}

export async function calToggleConcluido(id){
  const ev = _eventos.find(e => e.id === id);
  if (!ev || !_meu(ev)) return;
  ev.concluido = !ev.concluido;
  _rerender();
  const { error } = await sb.from('calendario_eventos').update({ concluido: ev.concluido }).eq('id', id);
  if (error){ ev.concluido = !ev.concluido; _rerender(); showToast('❌ Não foi possível actualizar'); }
}
