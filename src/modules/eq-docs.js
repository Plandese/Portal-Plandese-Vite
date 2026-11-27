// ═══════════════════════════════════════
//  EQUIPAMENTOS — DOCUMENTAÇÃO (na Dropbox da empresa)
//  Seis categorias por equipamento; em cada uma: importar ficheiros (clicar ou arrastar), ver/descarregar/apagar
//  e exportar tudo (zip). Os ficheiros vivem na Dropbox, numa pasta por equipamento:
//    BASE / <tipo> / <equipamento> / <categoria> / ficheiro
//  O que se põe diretamente na pasta (explorador do Windows) também aparece aqui.
//  Os ficheiros antigos do bucket «eq-documentos» (tabela eq_documentos) são passados para a Dropbox
//  automaticamente (ver eqDocsSincronizar).
// ═══════════════════════════════════════
import '../styles/eq-docs.css';
import { sb } from '../supabase.js';
import { showToast } from './navigation.js';
import { dropboxListAll, dropboxDownload, dropboxUploadTeam, dropboxDeleteTeam, dropboxMoveTeam, dropboxCreateFolders } from './dropbox.js';

// Caminho relativo à raiz da equipa («Plandese Dropbox»), não o caminho do Windows
const BASE = '/David Mósca/11_DCOMPRAS/3.EQUIPAMENTOS/00_Equipamentos Portal Plandese';
const BUCKET_ANTIGO = 'eq-documentos';
const MAX_MB = 25;
const TIPOS = {
  equipamento:         'Equipamentos',
  veiculo_passageiros: 'Ligeiros de passageiros',
  veiculo_mercadorias: 'Ligeiros de mercadorias',
  veiculo_pesado:      'Pesados',
};
const CATS = [
  ['documentos', 'Documentos', 'Livrete, inspeções, certificados', '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/>'],
  ['seguros', 'Seguros', 'Apólices e recibos', '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'],
  ['manutencoes', 'Manutenções', 'Faturas e relatórios de oficina', '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'],
  ['garantias', 'Garantias', 'Certificados e condições', '<circle cx="12" cy="8" r="6"/><path d="M15.5 13.5L17 22l-5-3-5 3 1.5-8.5"/>'],
  ['sinistros', 'Sinistros', 'Participações e peritagens', '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'],
  ['fotos', 'Fotos', 'Fotografias do equipamento', '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'],
];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tam = n => { n = Number(n) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; };
const dataPT = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';
const eImg = d => /\.(jpe?g|png|webp|gif|heic)$/i.test(d.nome || '');
const semAc = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Nome válido para pasta/ficheiro na Dropbox (sem / \ : ? * " < > | e sem ponto/espaço no fim)
const limpo = s => String(s || '').replace(/[\\/:?*"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 120) || 'sem nome';

// ── Pastas ─────────────────────────────
function tipoDe(cat) {
  if (TIPOS[cat]) return cat;
  return cat === 'veiculo' ? 'veiculo_mercadorias' : 'equipamento';
}
// Pasta do equipamento. Se houver outro equipamento com o mesmo nome, junta o código (ou id) para não misturar.
export function eqDocsPasta(eq, lista = []) {
  let nome = limpo(eq.nome);
  const iguais = lista.filter(o => o.id !== eq.id && semAc(limpo(o.nome)) === semAc(nome));
  if (iguais.length) nome += ` [${limpo(eq.codigo || eq.matricula || eq.id)}]`;
  return `${BASE}/${TIPOS[tipoDe(eq.categoria)]}/${nome}`;
}
const pastaCat = (raiz, k) => `${raiz}/${CATS.find(c => c[0] === k)[1]}`;
// Subpasta → categoria (aceita sem acentos/maiúsculas, para pastas criadas à mão)
const catDaPasta = nome => (CATS.find(c => semAc(c[1]) === semAc(nome)) || [])[0] || null;

let _apagarId = null, _apagarT = null;
let _ctx = null;   // { eq, lista, raiz, docs, urls }

export async function abrirEqDocs(eq, lista = []) {
  fecharEqDocs();
  if (!eq) return;
  const el = document.createElement('div');
  el.className = 'modal-bg open'; el.id = 'modal-eq-docs'; el.style.zIndex = 2500;
  el.innerHTML = '<div class="modal eqd-modal"><div class="eqd-top"><div><div class="modal-title">Documentação</div><div class="modal-sub" id="eqd-sub"></div></div><button type="button" class="eqd-x" data-eqd="fechar" aria-label="Fechar">×</button></div><div id="eqd-corpo" class="eqd-grid"><div class="eqd-vazio">A carregar da Dropbox…</div></div></div>';
  el.addEventListener('mousedown', e => { if (e.target === el) el.dataset.fora = '1'; else delete el.dataset.fora; });
  el.addEventListener('click', e => { if (e.target === el && el.dataset.fora) fecharEqDocs(); });
  document.body.appendChild(el);
  _ctx = { eq, lista, raiz: eqDocsPasta(eq, lista), docs: [], urls: {} };
  const sub = el.querySelector('#eqd-sub');
  sub.innerHTML = `${esc(eq.nome)} · <span title="${esc(_ctx.raiz)}">Dropbox: ${esc(_ctx.raiz.slice(BASE.length + 1))}</span>`;
  // Ficheiros que ainda estejam no armazenamento antigo passam primeiro para a Dropbox
  try { await migrarEquipamento(eq, lista); } catch (e) { console.warn('eq-docs migrar:', e); }
  await recarregar();
}
export function fecharEqDocs() {
  Object.values(_ctx?.urls || {}).forEach(u => URL.revokeObjectURL(u));
  document.getElementById('modal-eq-docs')?.remove();
  _ctx = null;
}

// Lê os ficheiros da pasta do equipamento (com subpastas). Pasta inexistente = sem ficheiros.
async function lerPasta(raiz) {
  let entradas;
  try { entradas = await dropboxListAll(raiz, true); }
  catch (e) { if (/not_found/.test(String(e.message || e))) return []; throw e; }
  const base = raiz.toLowerCase() + '/';
  return entradas.filter(x => x['.tag'] === 'file').map(x => {
    const rel = (x.path_lower || '').startsWith(base) ? x.path_display.slice(raiz.length + 1) : x.name;
    const partes = rel.split('/');
    const cat = partes.length > 1 ? (catDaPasta(partes[0]) || 'documentos') : 'documentos';
    return { id: x.id, path: x.path_lower || x.path_display, nome: x.name, tamanho: x.size, data: x.client_modified || x.server_modified, categoria: cat };
  }).sort((a, b) => String(b.data).localeCompare(String(a.data)));
}

export async function contarEqDocs(eq, lista = []) {
  if (!eq) return 0;
  return (await lerPasta(eqDocsPasta(eq, lista))).length;
}

async function recarregar() {
  if (!_ctx) return;
  const ctx = _ctx;
  try { ctx.docs = await lerPasta(ctx.raiz); }
  catch (e) {
    const corpo = document.getElementById('eqd-corpo');
    if (corpo && _ctx === ctx) corpo.innerHTML = `<div class="eqd-vazio">Não foi possível ler a pasta da Dropbox: ${esc(String(e.message || e).slice(0, 300))}</div>`;
    return;
  }
  if (_ctx !== ctx) return;
  desenhar();
  // Miniaturas das fotografias (descarregadas aos poucos, até 24)
  for (const d of ctx.docs.filter(eImg).slice(0, 24)) {
    if (ctx.urls[d.path]) continue;
    try { ctx.urls[d.path] = URL.createObjectURL(await dropboxDownload(d.path)); } catch { continue; }
    if (_ctx !== ctx) return;
    const b = document.querySelector(`#eqd-corpo [data-eqd="abrir"][data-id="${CSS.escape(d.id)}"]`);
    const ext = b?.parentElement?.querySelector('.eqd-ext');
    if (ext) { const img = document.createElement('img'); img.src = ctx.urls[d.path]; img.alt = ''; ext.replaceWith(img); }
  }
}

function desenhar() {
  const corpo = document.getElementById('eqd-corpo'); if (!corpo || !_ctx) return;
  corpo.innerHTML = CATS.map(([k, nome, desc, ico]) => {
    const docs = _ctx.docs.filter(d => d.categoria === k);
    return `<section class="eqd-card" data-cat="${k}">
      <div class="eqd-h"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ico}</svg>
        <div class="eqd-ht"><b>${nome}</b><span>${desc}</span></div><i class="eqd-n">${docs.length}</i></div>
      <label class="eqd-drop" data-eqd-drop="${k}" tabindex="0"><input type="file" multiple hidden data-eqd-file="${k}"${k === 'fotos' ? ' accept="image/*"' : ''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/></svg>
        <span><b>Importar</b> · clique ou arraste ficheiros</span></label>
      <div class="eqd-lista">${docs.length ? docs.map(d => `<div class="eqd-f">
          ${eImg(d) && _ctx.urls[d.path] ? `<img src="${esc(_ctx.urls[d.path])}" alt="">` : `<span class="eqd-ext">${esc((d.nome.split('.').pop() || '').slice(0, 4).toUpperCase())}</span>`}
          <button type="button" class="eqd-nome" data-eqd="abrir" data-id="${esc(d.id)}" title="${esc(d.nome)}">${esc(d.nome)}<small>${tam(d.tamanho)} · ${dataPT(d.data)}</small></button>
          <button type="button" class="eqd-del" data-eqd="apagar" data-id="${esc(d.id)}" title="Apagar" aria-label="Apagar">×</button></div>`).join('') : '<div class="eqd-vazio">Sem ficheiros.</div>'}</div>
      <button type="button" class="eqd-exp" data-eqd="exportar" data-cat="${k}"${docs.length ? '' : ' disabled'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"/></svg>Exportar${docs.length > 1 ? ' (zip)' : ''}</button>
    </section>`;
  }).join('');
}

async function importar(cat, files) {
  const fs = [...files]; if (!fs.length || !_ctx) return;
  const ctx = _ctx;
  let ok = 0;
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i];
    if (f.size > MAX_MB * 1048576) { showToast(`«${f.name}» tem mais de ${MAX_MB} MB.`); continue; }
    showToast(`A enviar para a Dropbox ${i + 1} de ${fs.length}…`);
    try { await dropboxUploadTeam(f, `${pastaCat(ctx.raiz, cat)}/${limpo(f.name)}`); ok++; }
    catch (e) { showToast('Não foi possível importar: ' + String(e.message || e).slice(0, 120)); }
  }
  if (ok) showToast(`${ok} ficheiro${ok !== 1 ? 's' : ''} guardado${ok !== 1 ? 's' : ''} na Dropbox ✓`);
  if (_ctx === ctx) await recarregar();
  window.eqDocsAtualizou?.(ctx.eq.id);
}

const guardar = (blob, nome) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', txt: 'text/plain' };

async function abrir(id) {
  const d = _ctx?.docs.find(x => String(x.id) === String(id)); if (!d) return;
  const ext = (d.nome.split('.').pop() || '').toLowerCase();
  // Abre já a janela (senão o bloqueador de janelas trava-a depois do await)
  const w = MIME[ext] ? window.open('', '_blank') : null;
  try {
    const blob = await dropboxDownload(d.path);
    if (!w) return guardar(blob, d.nome);
    const url = URL.createObjectURL(new Blob([blob], { type: MIME[ext] }));
    w.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (e) {
    w?.close();
    showToast('Não foi possível abrir o ficheiro: ' + String(e.message || e).slice(0, 100));
  }
}
async function apagar(id) {
  const d = _ctx?.docs.find(x => String(x.id) === String(id)); if (!d) return;
  if (_apagarId !== String(d.id)) {   // 2 cliques seguidos (o confirm() nativo falha em alguns ecrãs)
    _apagarId = String(d.id); clearTimeout(_apagarT); _apagarT = setTimeout(() => { _apagarId = null; }, 4000);
    return showToast(`Clique outra vez no × para apagar «${d.nome}».`);
  }
  _apagarId = null;
  const ctx = _ctx;
  try { await dropboxDeleteTeam(d.path); }
  catch (e) { return showToast('Não foi possível apagar: ' + String(e.message || e).slice(0, 100)); }
  showToast('Apagado (fica recuperável no histórico da Dropbox).');
  if (_ctx === ctx) await recarregar();
  window.eqDocsAtualizou?.(ctx.eq.id);
}
async function exportar(cat) {
  const docs = _ctx?.docs.filter(d => d.categoria === cat) || []; if (!docs.length) return;
  const nomeCat = CATS.find(c => c[0] === cat)[1];
  try {
    if (docs.length === 1) return guardar(await dropboxDownload(docs[0].path), docs[0].nome);
    showToast('A preparar o zip…');
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip(), usados = new Set();
    for (const d of docs) {
      const data = await dropboxDownload(d.path);
      let n = d.nome, i = 1; while (usados.has(n)) { const p = d.nome.lastIndexOf('.'); n = p > 0 ? `${d.nome.slice(0, p)} (${++i})${d.nome.slice(p)}` : `${d.nome} (${++i})`; }
      usados.add(n); zip.file(n, data);
    }
    guardar(await zip.generateAsync({ type: 'blob' }), `${limpo(_ctx.eq.nome)} - ${nomeCat}.zip`);
    showToast('Exportado ✓');
  } catch (e) { showToast('Não foi possível exportar: ' + String(e.message || e).slice(0, 100)); }
}

// ── Mudança de nome/tipo: a pasta acompanha o equipamento ──
export async function eqDocsMoverPasta(antes, listaAntes, depois, listaDepois) {
  if (!antes || !depois) return;
  const de = eqDocsPasta(antes, listaAntes || []), para = eqDocsPasta(depois, listaDepois || []);
  if (de.toLowerCase() === para.toLowerCase()) return;
  try { await dropboxMoveTeam(de, para); showToast('Pasta da documentação atualizada na Dropbox.'); }
  catch (e) { if (!/not_found/.test(String(e.message || e))) showToast('Não foi possível mudar a pasta na Dropbox: ' + String(e.message || e).slice(0, 100)); }
}

// ── Passagem dos ficheiros antigos (bucket eq-documentos) para a Dropbox ──
// Cada registo é «reservado» apagando-o primeiro: se dois utilizadores correrem isto ao mesmo tempo,
// só um envia o ficheiro. Se o envio falhar, o registo volta a ser criado.
async function migrarRegisto(r, raiz) {
  const { data: apagado, error } = await sb.from('eq_documentos').delete().eq('id', r.id).select('*');
  if (error || !apagado?.length) return false;
  try {
    const { data: blob, error: e1 } = await sb.storage.from(BUCKET_ANTIGO).download(r.path);
    if (e1) throw e1;
    await dropboxUploadTeam(blob, `${pastaCat(raiz, CATS.some(c => c[0] === r.categoria) ? r.categoria : 'documentos')}/${limpo(r.nome)}`);
  } catch (e) {
    const { id, ...resto } = apagado[0];
    await sb.from('eq_documentos').insert(resto);
    throw e;
  }
  sb.storage.from(BUCKET_ANTIGO).remove([r.path]).catch(() => {});
  return true;
}
async function migrarEquipamento(eq, lista) {
  const { data, error } = await sb.from('eq_documentos').select('*').eq('equip_id', eq.id);
  if (error || !data?.length) return;
  const raiz = eqDocsPasta(eq, lista);
  for (const r of data) await migrarRegisto(r, raiz);
}

// ── Sincronização geral (corre em segundo plano depois de carregar os equipamentos) ──
// 1) cria as pastas dos tipos, de cada equipamento e das 6 categorias (só quando a lista mudou);
// 2) passa para a Dropbox os ficheiros que ainda estejam no armazenamento antigo.
let _sincAEcorrer = false;
export async function eqDocsSincronizar(lista) {
  if (_sincAEcorrer || !lista?.length) return;
  _sincAEcorrer = true;
  try {
    const pastas = [BASE, ...Object.values(TIPOS).map(t => `${BASE}/${t}`)];
    lista.forEach(eq => { const r = eqDocsPasta(eq, lista); pastas.push(r, ...CATS.map(c => pastaCat(r, c[0]))); });
    const assinatura = pastas.length + ':' + hash([...pastas].sort().join('|'));
    let feita = ''; try { feita = localStorage.getItem('eq_docs_pastas') || ''; } catch {}
    if (feita !== assinatura) {
      await dropboxCreateFolders(pastas);
      try { localStorage.setItem('eq_docs_pastas', assinatura); } catch {}
    }
    const { data, error } = await sb.from('eq_documentos').select('*').order('id');
    if (error || !data?.length) return;
    const porId = Object.fromEntries(lista.map(e => [e.id, e]));
    let n = 0, falhas = 0;
    showToast(`A passar ${data.length} documento${data.length !== 1 ? 's' : ''} dos equipamentos para a Dropbox…`);
    for (const r of data) {
      const eq = porId[r.equip_id] || { id: r.equip_id, nome: 'Equipamento ' + r.equip_id, categoria: 'equipamento' };
      try { if (await migrarRegisto(r, eqDocsPasta(eq, lista))) n++; } catch (e) { falhas++; console.warn('eq-docs migrar', r.id, e); }
    }
    if (n) showToast(`${n} documento${n !== 1 ? 's' : ''} dos equipamentos passado${n !== 1 ? 's' : ''} para a Dropbox ✓${falhas ? ` (${falhas} por passar)` : ''}`);
  } catch (e) {
    console.warn('eqDocsSincronizar:', e);
  } finally { _sincAEcorrer = false; }
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

document.addEventListener('click', e => {
  const b = e.target.closest('[data-eqd]'); if (!b || !_ctx) return;
  const a = b.dataset.eqd;
  if (a === 'fechar') fecharEqDocs();
  else if (a === 'abrir') abrir(b.dataset.id);
  else if (a === 'apagar') apagar(b.dataset.id);
  else if (a === 'exportar') exportar(b.dataset.cat);
});
document.addEventListener('change', e => {
  const i = e.target.closest?.('[data-eqd-file]'); if (!i || !_ctx) return;
  const fs = [...i.files]; i.value = ''; importar(i.dataset.eqdFile, fs);
});
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { const z = e.target.closest?.('[data-eqd-drop]'); if (z) { e.preventDefault(); z.classList.add('over'); } }));
document.addEventListener('dragleave', e => { e.target.closest?.('[data-eqd-drop]')?.classList.remove('over'); });
document.addEventListener('drop', e => {
  const z = e.target.closest?.('[data-eqd-drop]'); if (!z || !_ctx) return;
  e.preventDefault(); z.classList.remove('over'); importar(z.dataset.eqdDrop, e.dataTransfer?.files || []);
});
