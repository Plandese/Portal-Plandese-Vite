// ═══════════════════════════════════════════════════════════════════
//  GUIAS DE REMESSA · TESTE — página separada do portal (guias-teste.html)
//  Trabalha só com as tabelas de teste (gt_guias, gt_faturas) e o motor gt_sincronizar_guias:
//  nada do que se faz aqui aparece nas páginas do portal, e o portal não altera nada daqui.
//  A sessão é a do portal (mesmo Supabase Auth): se já entrou no portal, não pede nada.
// ═══════════════════════════════════════════════════════════════════
import './styles/mobile-shell.css';   // só para as variáveis (--m-brand, máscara do logótipo…)
import './styles/guias-teste.css';
import { sb } from './supabase.js';
import { configurarGuias, renderGuiasEscritorio } from './modules/guias-escritorio.js';
import { configurarArtigos, handlersArtigos } from './modules/faturas-artigos.js';
import './modules/artigos-catalogo.js';   // base de dados de materiais (Supabase)

configurarGuias({ guias: 'gt_guias', faturas: 'gt_faturas', rpc: 'gt_sincronizar_guias', materiais: true });
configurarArtigos({ alias: 'gt_artigo_alias' });   // a memória de associações do teste não mexe na do portal
Object.assign(window, handlersArtigos);            // botões do diálogo «Associar artigos»

const $ = id => document.getElementById(id);
const authEmail = u => `${u}@portal.plandese.local`;
const toast = m => { const p = $('gt-prog'); p.hidden = false; p.textContent = m; clearTimeout(toast._t); toast._t = setTimeout(() => { p.hidden = true; }, 6000); };
window.showToast = toast;   // o módulo das guias usa-o para as mensagens

let _user = null;

async function arrancar() {
  const { data } = await sb.auth.getSession();
  if (!data?.session) { $('gt-login').hidden = false; $('gt-app').hidden = true; return; }
  _user = (data.session.user.email || '').split('@')[0];
  // só o administrador (o servidor também o exige: as tabelas gt_* ignoram os outros)
  const { data: papel } = await sb.rpc('fn_my_role');
  if (papel !== 'admin') { $('gt-login').hidden = true; $('gt-app').hidden = true; $('gt-semacesso').hidden = false; return; }
  $('gt-user').textContent = _user;
  $('gt-login').hidden = true; $('gt-app').hidden = false;
  try { await sb.rpc('gt_importar_faturas'); } catch (e) { console.warn('Importar faturas:', e); }
  await renderGuiasEscritorio();
}

$('gt-login-form').addEventListener('submit', async e => {
  e.preventDefault();
  $('gt-login-erro').hidden = true;
  const u = $('gt-u').value.trim().toLowerCase(), p = $('gt-p').value;
  if (!u || !p) return;
  const { error } = await sb.auth.signInWithPassword({ email: authEmail(u), password: p });
  if (error) { $('gt-login-erro').hidden = false; return; }
  arrancar();
});
$('gt-sair').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

// ── Importar faturas Secil do portal (cópia; nada é alterado no portal) ──
$('gt-importar').addEventListener('click', async e => {
  const b = e.currentTarget; b.disabled = true;
  try {
    const { data, error } = await sb.rpc('gt_importar_faturas');
    if (error) throw error;
    toast(`Faturas importadas: ${data.novas} novas, ${data.atualizadas} atualizadas ✓`);
    await renderGuiasEscritorio();
  } catch (err) { toast('Não foi possível importar: ' + String(err.message || err).slice(0, 160)); }
  b.disabled = false;
});

// ── Carregar guias: fotografias ou PDF digitalizado (cada página é uma guia) ──
let _pdfjs = null;
async function pdfjs() {
  if (_pdfjs) return _pdfjs;
  const mod = await import('pdfjs-dist');
  const lib = mod.getDocument ? mod : (mod.default || mod);
  try { const W = (await import('pdfjs-dist/build/pdf.worker.min.js?worker')).default; lib.GlobalWorkerOptions.workerPort = new W(); }
  catch (e) { try { lib.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.js?url')).default; } catch (e2) { /* sem worker */ } }
  return (_pdfjs = lib);
}
const canvasParaJpeg = (cv, q = 0.72) => new Promise(r => cv.toBlob(r, 'image/jpeg', q));
async function paginasDe(file) {
  if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n), vp = pg.getViewport({ scale: 1.6 });
      const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      out.push(await canvasParaJpeg(cv));
    }
    return out;
  }
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1700 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return [await canvasParaJpeg(cv)];
}
$('gt-carregar').addEventListener('click', () => $('gt-ficheiros').click());
$('gt-ficheiros').addEventListener('change', async e => {
  const fs = [...e.target.files]; e.target.value = '';
  if (!fs.length) return;
  const obraGuardada = (() => { try { return localStorage.getItem('gt_obra') || ''; } catch (e2) { return ''; } })();
  const obra = prompt('Obra destas guias (como no portal, ex.: O065 - Loteamento Queluz de Baixo). Pode deixar em branco.', obraGuardada);
  if (obra === null) return;
  try { localStorage.setItem('gt_obra', obra); } catch (e2) { /* sem armazenamento */ }
  const b = $('gt-carregar'); b.disabled = true;
  let ok = 0, falhas = 0, total = 0;
  try {
    const todas = [];
    for (const f of fs) { toast(`A preparar ${f.name}…`); for (const bl of await paginasDe(f)) todas.push(bl); }
    total = todas.length;
    const base = Date.now();
    for (let i = 0; i < todas.length; i++) {
      toast(`A carregar guia ${i + 1} de ${total}…`);
      try {
        const path = `${_user}/${base + i}-p1.jpg`;
        const up = await sb.storage.from('guias-remessa').upload(path, todas[i], { contentType: 'image/jpeg' });
        if (up.error) throw up.error;
        const ins = await sb.from('gt_guias').insert({ obra_nome: obra.trim() || null, criado_por: _user, foto_path: path, fotos: [path], paginas: 1, estado: 'por_casar' }).select('id').single();
        if (ins.error) throw ins.error;
        const r = await sb.functions.invoke('guias-pdf', { body: { guia_id: ins.data.id, tabela: 'gt_guias' } });
        if (r.error || !r.data?.ok) throw new Error(r.data?.error || r.error?.message || 'a leitura da guia falhou');
        ok++;
      } catch (err) { falhas++; console.warn('Guia', i + 1, err); }
    }
  } catch (err) { toast('Não foi possível preparar os ficheiros: ' + String(err.message || err).slice(0, 160)); b.disabled = false; return; }
  toast(`${ok} de ${total} guias carregadas e lidas${falhas ? ` (${falhas} com problema: ficam sem leitura, use «Ler dados em falta»)` : ''} ✓`);
  b.disabled = false;
  await renderGuiasEscritorio();
});

arrancar();
