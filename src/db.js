// ═══════════════════════════════════════
//  DB — Operações Supabase CRUD
// ═══════════════════════════════════════
import { sb } from './supabase.js';
import { S, R } from './state.js';
import { fmt } from './utils/helpers.js';
import { USERS_BASE } from './config.js';

// ═══════════════════════════════════════
//  SUPABASE — CARREGAR DADOS
// ═══════════════════════════════════════
export async function carregarDados() {
  try {
    const {data: colabs} = await sb.from('colaboradores').select('numero,nome,funcao,ativo').order('numero');
    if (colabs && colabs.length > 0) {
      S.COLABORADORES = colabs.map(c => ({n:c.numero, nome:c.nome, func:c.funcao, ativo:c.ativo}));
    }
    // Obras
    const {data: obras} = await sb.from('obras').select('*').order('nome');
    if (obras) {
      S.OBRAS = obras.map(o => ({id:o.id, nome:o.nome, local:o.local||'', desc:o.descricao||'', ativa:o.ativa, prazo:o.prazo||null, encarregado_id:o.encarregado_id||null, diretor_id:o.diretor_id||null}));
    }
    // Empresas MOA e colaboradores
    await R.loadEmpresasMOA?.();
    await R.loadColaboradoresMOA?.();
    // Utilizadores
    const {data: users} = await sb.from('utilizadores').select('username,nome,role,initials,painel_config,enc_modulos');
    if (users && users.length > 0) {
      S.USERS = {};
      users.forEach(u => { S.USERS[u.username] = {nome:u.nome, initials:u.initials||u.nome.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase(), role:u.role, encModulos:u.enc_modulos||null}; });
      if (!S.USERS['admin']) S.USERS['admin'] = {nome:USERS_BASE['admin'].nome, initials:USERS_BASE['admin'].initials, role:USERS_BASE['admin'].role};
    }
    // Registos do dia atual e 7 dias anteriores
    const dataMin = new Date(S.currentDate); dataMin.setDate(dataMin.getDate()-7);
    const {data: regs} = await sb.from('registos_ponto').select('*').gte('data', fmt(dataMin));
    if (regs) {
      S.REGISTOS = {};
      S.activeRows = {};
      regs.forEach(r => {
        const dk = r.data;
        if (!S.REGISTOS[dk]) S.REGISTOS[dk] = [];
        if (!S.activeRows[dk]) S.activeRows[dk] = [];
        S.REGISTOS[dk].push({colabN:r.colab_numero, obra:r.obra_id, encarregado_id:r.encarregado_id||null, entrada:r.entrada?.slice(0,5)||'', saida:r.saida?.slice(0,5)||'', tipo:r.tipo||'Presença'});
        if (!S.activeRows[dk].includes(r.colab_numero)) S.activeRows[dk].push(r.colab_numero);
      });
    }
  } catch(e) { console.warn('Erro ao carregar dados:', e); }
}

// ═══════════════════════════════════════
//  SUPABASE — REGISTOS PARA A FOLHA DE FECHO
// ═══════════════════════════════════════
// O Supabase devolve no máximo 1000 linhas por pedido; um mês inteiro passa disso.
async function _lerTudo(tabela, dIni, dFim, ordem) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(tabela).select('*').gte('data', dIni).lte('data', dFim);
    ordem.forEach(c => { q = q.order(c); });
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

// Só entra na folha de fecho o que o diretor de obra já aprovou (aprovacoes_ponto: obra + dia).
// Registos de dias por aprovar — ou sem obra, que não têm quem os aprove — ficam de fora
// e vêm em `pendentes` ([{obraId, data}], sem repetidos) para o ecrã os poder avisar.
export async function carregarRegistosFecho(dIni, dFim) {
  const [regs, aprov] = await Promise.all([
    _lerTudo('registos_ponto', dIni, dFim, ['data', 'colab_numero', 'obra_id', 'encarregado_id']),
    _lerTudo('aprovacoes_ponto', dIni, dFim, ['data', 'obra_id']),
  ]);
  const aprovados = new Set(aprov.map(a => a.obra_id + '|' + a.data));
  const pend = new Map();
  const aprovadosRegs = regs.filter(r => {
    if (r.obra_id && aprovados.has(r.obra_id + '|' + r.data)) return true;
    pend.set((r.obra_id || '_sem') + '|' + r.data, { obraId: r.obra_id || '_sem', data: r.data });
    return false;
  });
  return { regs: aprovadosRegs, pendentes: [...pend.values()] };
}

// ═══════════════════════════════════════
//  SUPABASE — GUARDAR REGISTO
// ═══════════════════════════════════════
export async function sbSaveRegisto(dk, n) {
  const r = (S.REGISTOS[dk]||[]).find(x => x.colabN===n);
  if (!r) return;
  try {
    await sb.from('registos_ponto').upsert({
      data: dk,
      colab_numero: n,
      obra_id: r.obra||null,
      encarregado_id: r.encarregado_id ?? (S.currentUser?.key||null),
      entrada: r.entrada||null,
      saida: r.saida||null,
      tipo: r.tipo||'Normal'
    }, {onConflict: 'data,colab_numero,obra_id,encarregado_id'});
  } catch(e) { console.warn('Erro ao guardar registo:', e); }
}

export async function sbSaveObra(rec) {
  try {
    await sb.from('obras').upsert({id:rec.id, nome:rec.nome, local:rec.local||null, descricao:rec.desc||null, ativa:rec.ativa}, {onConflict:'id'});
  } catch(e) { console.warn('Erro ao guardar obra:', e); }
}

export async function sbSaveColab(c) {
  try {
    const payload = {numero:c.n, nome:c.nome, funcao:c.func, ativo:c.ativo};
    await sb.from('colaboradores').upsert(payload, {onConflict:'numero'});
  } catch(e) { console.warn('Erro ao guardar colaborador:', e); }
}

// Devolve null se correu bem, ou o erro do servidor (ex.: sem permissão, password curta)
export async function sbSaveUser(key, u) {
  try {
    const {error} = await sb.rpc('fn_upsert_user', {p_username:key, p_nome:u.nome, p_role:u.role, p_initials:u.initials, p_password:u.pass||null});
    if (error) console.warn('Erro ao guardar utilizador:', error);
    return error || null;
  } catch(e) { console.warn('Erro ao guardar utilizador:', e); return e; }
}

// modulos = array de ids ENC_MODULES permitidos, ou null (sem restrição, tudo visível)
export async function sbSaveEncModulos(username, modulos) {
  try {
    await sb.from('utilizadores').update({enc_modulos: modulos}).eq('username', username);
  } catch(e) { console.warn('Erro ao guardar módulos do encarregado:', e); }
}

export async function sbToggleObra(id, ativa) {
  try { await sb.from('obras').update({ativa}).eq('id',id); } catch(e) {}
}

export async function sbToggleColab(n, ativo) {
  try { await sb.from('colaboradores').update({ativo}).eq('numero',n); } catch(e) {}
}

// ═══════════════════════════════════════
//  SUPABASE — NOTIFICAÇÕES
// ═══════════════════════════════════════
// Carrega as últimas notificações do utilizador autenticado
export async function sbLoadNotificacoes(destinatario, limit=50){
  try {
    const {data} = await sb.from('notificacoes')
      .select('*').eq('destinatario', destinatario)
      .order('created_at',{ascending:false}).limit(limit);
    return data||[];
  } catch(e){ console.warn('Erro ao carregar notificações:', e); return []; }
}

// Insere várias linhas de notificação (fan-out já calculado)
export async function sbInsertNotificacoes(rows){
  if(!rows||!rows.length) return;
  try { await sb.from('notificacoes').insert(rows); }
  catch(e){ console.warn('Erro ao inserir notificações:', e); }
}

export async function sbMarkNotifRead(id){
  try { await sb.from('notificacoes').update({lida:true}).eq('id',id); } catch(e){}
}

export async function sbMarkAllNotifRead(destinatario){
  try { await sb.from('notificacoes').update({lida:true}).eq('destinatario',destinatario).eq('lida',false); } catch(e){}
}

export async function sbSetNotifLida(id, lida){
  try { await sb.from('notificacoes').update({lida}).eq('id',id); } catch(e){}
}

export async function sbDeleteNotif(id){
  try { await sb.from('notificacoes').delete().eq('id',id); } catch(e){ console.warn('Erro ao apagar notificação:', e); }
}

export async function sbDeleteNotifsLidas(destinatario){
  try { await sb.from('notificacoes').delete().eq('destinatario',destinatario).eq('lida',true); }
  catch(e){ console.warn('Erro ao apagar notificações lidas:', e); }
}

// Subscrições — quem recebe de que secção
export async function sbLoadSubscriptions(){
  try { const {data} = await sb.from('notif_subscriptions').select('*'); return data||[]; }
  catch(e){ console.warn('Erro ao carregar subscrições:', e); return []; }
}

export async function sbSetSubscription(destinatario, seccao, ativo){
  try {
    if(ativo){
      await sb.from('notif_subscriptions').upsert({destinatario, seccao},{onConflict:'destinatario,seccao'});
    } else {
      await sb.from('notif_subscriptions').delete().eq('destinatario',destinatario).eq('seccao',seccao);
    }
  } catch(e){ console.warn('Erro ao guardar subscrição:', e); }
}

// Push — grava/atualiza a subscrição Web Push deste dispositivo
export async function sbSavePushSubscription(destinatario, sub){
  try {
    await sb.from('push_subscriptions').upsert({
      destinatario,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth
    }, {onConflict:'endpoint'});
  } catch(e){ console.warn('Erro ao guardar subscrição push:', e); }
}

// Realtime — entrega ao vivo de notificações novas para o utilizador
export function sbSubscribeNotificacoes(destinatario, onInsert){
  try {
    const ch = sb.channel('notif-'+destinatario)
      .on('postgres_changes',
        {event:'INSERT', schema:'public', table:'notificacoes', filter:`destinatario=eq.${destinatario}`},
        payload => onInsert(payload.new))
      .subscribe();
    return ch;
  } catch(e){ console.warn('Erro ao subscrever realtime:', e); return null; }
}

export function showSaveInd(){
  const el=document.getElementById('save-ind');
  if(!el)return;
  el.classList.add('show');
  clearTimeout(S.saveTimer);
  S.saveTimer=setTimeout(()=>el.classList.remove('show'),2000);
}
