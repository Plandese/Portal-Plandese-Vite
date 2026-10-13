// ═══════════════════════════════════════
//  DEFINIÇÕES — HISTÓRICO DE ATIVIDADE
//  Lê public.historico_atividade (preenchida por triggers na base de dados).
//  Só administradores têm acesso (RLS).
// ═══════════════════════════════════════
import { sb } from '../supabase.js';

const TABELAS = {
  advertencias:'Advertências', colaboradores:'Colaboradores', colaboradores_moa:'Colaboradores MOA', empresas_moa:'Empresas MOA',
  eq_movimentos:'Equipamentos · movimentos', equipamentos:'Equipamentos', eq_manutencoes:'Equipamentos · manutenções',
  faturas:'Faturas', fatura_fornecedores:'Faturas · fornecedores', ferias_previstas:'Férias', fornecedores:'Fornecedores',
  lembretes:'Lembretes', obras:'Obras', pedidos_compra:'Pedidos de compra', registos_combustivel:'Combustível',
  registos_ponto:'Folha de ponto', registos_ponto_moa:'Folha de ponto MOA', utilizadores:'Utilizadores',
  mapas_comparativos:'Mapas comparativos', mapa_linhas:'Mapas · linhas', mapa_fornecedor_valores:'Mapas · valores',
  calendario_eventos:'Calendário', aprovacoes_ponto:'Aprovações de ponto', aprovacoes_ponto_moa:'Aprovações de ponto MOA',
  obra_diretores_extra:'Obras · diretores', obra_encarregados_extra:'Obras · encarregados', co_obra:'Controlo de obras',
  co_mensal:'Controlo de obras · mensal', tavira_topicos:'Pós Venda · tópicos', tavira_estado:'Pós Venda · estado',
  tavira_fotos:'Pós Venda · fotos'
};
const OPS = {INSERT:['Criado','b-green'], UPDATE:['Alterado','b-blue'], DELETE:['Apagado','b-red']};
const PAGE = 200;
let _rows = [], _fim = false, _carregou = false;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = id => document.getElementById(id);
const fmt = iso => {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-PT') + ' ' + d.toLocaleTimeString('pt-PT', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
};
const val = v => v == null ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v));

function detalhe(r){
  if(r.operacao === 'UPDATE'){
    return (r.campos||[]).map(c => `<div class="ati-chg"><b>${esc(c)}</b>: <s>${esc(val(r.antes?.[c]))}</s> → <span>${esc(val(r.depois?.[c]))}</span></div>`).join('');
  }
  const obj = r.operacao === 'DELETE' ? r.antes : r.depois;
  return Object.entries(obj||{}).filter(([,v]) => v != null && v !== '').slice(0,14)
    .map(([k,v]) => `<div class="ati-chg"><b>${esc(k)}</b>: ${esc(val(v))}</div>`).join('');
}

function render(){
  const box = $('ati-lista'); if(!box) return;
  if(!_rows.length){ box.innerHTML = '<div class="d-empty">Sem registos para os filtros escolhidos.</div>'; return; }
  box.innerHTML = `<div class="eq-tbl-wrap"><table class="eq-tbl ati-tbl"><thead><tr><th>Data e hora</th><th>Utilizador</th><th>Ação</th><th>Área</th><th>Registo</th><th>Detalhe</th></tr></thead><tbody>${
    _rows.map(r => { const [l,c] = OPS[r.operacao] || [r.operacao,'b-gray'];
      return `<tr><td style="white-space:nowrap">${esc(fmt(r.criado_em))}</td><td><b>${esc(r.utilizador||'—')}</b></td><td><span class="badge ${c}">${l}</span></td><td>${esc(TABELAS[r.tabela]||r.tabela)}</td><td>${esc(r.registo_id||'—')}</td><td class="ati-det">${detalhe(r)}</td></tr>`; }).join('')
  }</tbody></table></div>${_fim ? '' : '<div style="text-align:center;margin-top:14px"><button class="btn btn-secondary" id="ati-mais">Carregar mais</button></div>'}`;
  $('ati-mais')?.addEventListener('click', () => carregarAtividade(false));
}

export async function carregarAtividade(reset = true){
  const box = $('ati-lista'); if(!box) return;
  if(reset){ _rows = []; _fim = false; box.innerHTML = '<div class="d-empty">A carregar…</div>'; }
  let q = sb.from('historico_atividade').select('*').order('id', {ascending:false}).limit(PAGE);
  const tab = $('ati-tab')?.value, op = $('ati-op')?.value, user = $('ati-user')?.value, de = $('ati-de')?.value, ate = $('ati-ate')?.value, txt = $('ati-q')?.value.trim();
  if(tab) q = q.eq('tabela', tab);
  if(op) q = q.eq('operacao', op);
  if(user) q = q.eq('utilizador', user);
  if(de) q = q.gte('criado_em', new Date(de+'T00:00:00').toISOString());
  if(ate) q = q.lte('criado_em', new Date(ate+'T23:59:59').toISOString());
  if(txt) q = q.or(`registo_id.ilike.%${txt.replace(/[,()%]/g,'')}%,utilizador.ilike.%${txt.replace(/[,()%]/g,'')}%`);
  if(!reset && _rows.length) q = q.lt('id', _rows[_rows.length-1].id);
  const {data, error} = await q;
  if(error){ box.innerHTML = `<div class="d-empty">Não foi possível carregar o histórico (${esc(error.message)}).</div>`; return; }
  _rows = _rows.concat(data||[]);
  _fim = (data||[]).length < PAGE;
  render();
  if(reset && !$('ati-user').dataset.pronto) preencherUtilizadores();
}

async function preencherUtilizadores(){
  const sel = $('ati-user'); if(!sel) return;
  const {data} = await sb.from('utilizadores').select('nome').order('nome');
  sel.innerHTML = '<option value="">Todos os utilizadores</option>' + (data||[]).map(u => `<option>${esc(u.nome)}</option>`).join('');
  sel.dataset.pronto = '1';
}

export function initAtividade(){
  const tab = $('ati-tab');
  if(tab && !_carregou){
    tab.innerHTML = '<option value="">Todas as áreas</option>' + Object.entries(TABELAS).sort((a,b)=>a[1].localeCompare(b[1],'pt')).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('');
    ['ati-tab','ati-op','ati-user','ati-de','ati-ate'].forEach(id => $(id)?.addEventListener('change', () => carregarAtividade(true)));
    let t; $('ati-q')?.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => carregarAtividade(true), 350); });
    $('ati-refresh')?.addEventListener('click', () => carregarAtividade(true));
    _carregou = true;
  }
  carregarAtividade(true);
}
