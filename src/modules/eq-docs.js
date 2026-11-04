// ═══════════════════════════════════════
//  EQUIPAMENTOS — DOCUMENTAÇÃO
//  Seis categorias por equipamento; em cada uma: importar ficheiros (clicar ou arrastar), ver/descarregar/apagar
//  e exportar tudo (zip). Ficheiros no bucket privado «eq-documentos»; registos em «eq_documentos».
// ═══════════════════════════════════════
import '../styles/eq-docs.css';
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { showToast } from './navigation.js';

const BUCKET = 'eq-documentos';
const MAX_MB = 25;
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
const seguro = nome => String(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(-90) || 'ficheiro';
const eImg = d => /^image\//.test(d.mime || '') || /\.(jpe?g|png|webp|gif)$/i.test(d.nome || '');

let _apagarId = null, _apagarT = null;
let _ctx = null;   // { id, nome, docs, urls }

export async function abrirEqDocs(equipId, equipNome) {
  fecharEqDocs();
  const el = document.createElement('div');
  el.className = 'modal-bg open'; el.id = 'modal-eq-docs'; el.style.zIndex = 2500;
  el.innerHTML = '<div class="modal eqd-modal"><div class="eqd-top"><div><div class="modal-title">Documentação</div><div class="modal-sub" id="eqd-sub"></div></div><button type="button" class="eqd-x" data-eqd="fechar" aria-label="Fechar">×</button></div><div id="eqd-corpo" class="eqd-grid"><div class="eqd-vazio">A carregar…</div></div></div>';
  el.addEventListener('mousedown', e => { if (e.target === el) el.dataset.fora = '1'; else delete el.dataset.fora; });
  el.addEventListener('click', e => { if (e.target === el && el.dataset.fora) fecharEqDocs(); });
  document.body.appendChild(el);
  _ctx = { id: equipId, nome: equipNome || '', docs: [], urls: {} };
  el.querySelector('#eqd-sub').textContent = _ctx.nome;
  await recarregar();
}
export function fecharEqDocs() { document.getElementById('modal-eq-docs')?.remove(); }
export async function contarEqDocs(equipId) {
  const { count } = await sb.from('eq_documentos').select('id', { count: 'exact', head: true }).eq('equip_id', equipId);
  return count || 0;
}

async function recarregar() {
  const { data, error } = await sb.from('eq_documentos').select('*').eq('equip_id', _ctx.id).order('criado_em', { ascending: false });
  if (error) { document.getElementById('eqd-corpo').innerHTML = `<div class="eqd-vazio">Não foi possível carregar: ${esc(error.message)}</div>`; return; }
  _ctx.docs = data || [];
  const imgs = _ctx.docs.filter(eImg).slice(0, 60).map(d => d.path);
  _ctx.urls = {};
  if (imgs.length) {
    const { data: u } = await sb.storage.from(BUCKET).createSignedUrls(imgs, 3600);
    (u || []).forEach(x => { if (x.signedUrl) _ctx.urls[x.path] = x.signedUrl; });
  }
  desenhar();
}

function desenhar() {
  const corpo = document.getElementById('eqd-corpo'); if (!corpo) return;
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
          <button type="button" class="eqd-nome" data-eqd="abrir" data-id="${d.id}" title="${esc(d.nome)}">${esc(d.nome)}<small>${tam(d.tamanho)} · ${dataPT(d.criado_em)}</small></button>
          <button type="button" class="eqd-del" data-eqd="apagar" data-id="${d.id}" title="Apagar" aria-label="Apagar">×</button></div>`).join('') : '<div class="eqd-vazio">Sem ficheiros.</div>'}</div>
      <button type="button" class="eqd-exp" data-eqd="exportar" data-cat="${k}"${docs.length ? '' : ' disabled'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"/></svg>Exportar${docs.length > 1 ? ' (zip)' : ''}</button>
    </section>`;
  }).join('');
}

async function importar(cat, files) {
  const fs = [...files]; if (!fs.length) return;
  const user = (S.currentUser && (S.currentUser.key || S.currentUser.username)) || null;
  let ok = 0;
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i];
    if (f.size > MAX_MB * 1048576) { showToast(`«${f.name}» tem mais de ${MAX_MB} MB.`); continue; }
    showToast(`A importar ${i + 1} de ${fs.length}…`);
    const path = `${_ctx.id}/${cat}/${Date.now()}-${Math.floor(Math.random() * 1e4)}-${seguro(f.name)}`;
    const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream' });
    if (up.error) { showToast('Não foi possível importar: ' + String(up.error.message).slice(0, 100)); continue; }
    const { error } = await sb.from('eq_documentos').insert({ equip_id: _ctx.id, categoria: cat, nome: f.name, path, mime: f.type || null, tamanho: f.size, criado_por: user });
    if (error) { await sb.storage.from(BUCKET).remove([path]); showToast('Não foi possível registar: ' + String(error.message).slice(0, 100)); continue; }
    ok++;
  }
  if (ok) showToast(`${ok} ficheiro${ok !== 1 ? 's' : ''} importado${ok !== 1 ? 's' : ''} ✓`);
  await recarregar();
  window.eqDocsAtualizou?.(_ctx.id);
}

const guardar = (blob, nome) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

async function abrir(id) {
  const d = _ctx.docs.find(x => String(x.id) === String(id)); if (!d) return;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(d.path, 600);
  if (error || !data?.signedUrl) return showToast('Não foi possível abrir o ficheiro.');
  window.open(data.signedUrl, '_blank', 'noopener');
}
async function apagar(id) {
  const d = _ctx.docs.find(x => String(x.id) === String(id)); if (!d) return;
  if (_apagarId !== String(d.id)) {   // 2 cliques seguidos (o confirm() nativo falha em alguns ecrãs)
    _apagarId = String(d.id); clearTimeout(_apagarT); _apagarT = setTimeout(() => { _apagarId = null; }, 4000);
    return showToast(`Clique outra vez no × para apagar «${d.nome}».`);
  }
  _apagarId = null;
  const { data, error } = await sb.from('eq_documentos').delete().eq('id', d.id).select('id');
  if (error || !data?.length) return showToast('Não foi possível apagar (sem permissão?).');
  sb.storage.from(BUCKET).remove([d.path]).catch(() => {});
  await recarregar();
  window.eqDocsAtualizou?.(_ctx.id);
}
async function exportar(cat) {
  const docs = _ctx.docs.filter(d => d.categoria === cat); if (!docs.length) return;
  const nomeCat = CATS.find(c => c[0] === cat)[1];
  try {
    if (docs.length === 1) {
      const { data, error } = await sb.storage.from(BUCKET).download(docs[0].path); if (error) throw error;
      return guardar(data, docs[0].nome);
    }
    showToast('A preparar o zip…');
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip(), usados = new Set();
    for (const d of docs) {
      const { data, error } = await sb.storage.from(BUCKET).download(d.path); if (error) throw error;
      let n = d.nome, i = 1; while (usados.has(n)) { const p = d.nome.lastIndexOf('.'); n = p > 0 ? `${d.nome.slice(0, p)} (${++i})${d.nome.slice(p)}` : `${d.nome} (${++i})`; }
      usados.add(n); zip.file(n, data);
    }
    guardar(await zip.generateAsync({ type: 'blob' }), `${seguro(_ctx.nome || 'equipamento')}-${nomeCat}.zip`);
    showToast('Exportado ✓');
  } catch (e) { showToast('Não foi possível exportar: ' + String(e.message || e).slice(0, 100)); }
}

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
