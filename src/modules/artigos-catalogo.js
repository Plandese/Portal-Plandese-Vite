// ═══════════════════════════════════════════════════════════════════
//  CATÁLOGO DE ARTIGOS (materiais) — fonte: tabelas «artigos» / «artigos_grupos» na Supabase
//  O portal arranca com a cópia em /artigos-data.js (window.ARTIGOS_CATALOGO) e, depois do login, troca-a pelo catálogo da
//  Supabase. A cópia local (IndexedDB) só é descarregada outra vez quando a versão do catálogo muda (artigos_versao).
//  Formato inalterado: { "100_Metal": { label, items: [[código, designação, unidade], …] }, … }
// ═══════════════════════════════════════════════════════════════════
import { sb } from '../supabase.js';

const BD = 'plandese_cache', LOJA = 'kv', CHAVE = 'artigos_catalogo';

function abrir() {
  return new Promise((ok, falha) => {
    if (typeof indexedDB === 'undefined') return falha(new Error('sem IndexedDB'));
    const rq = indexedDB.open(BD, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(LOJA);
    rq.onsuccess = () => ok(rq.result);
    rq.onerror = () => falha(rq.error);
  });
}
async function ler() {
  try {
    const db = await abrir();
    return await new Promise(ok => { const g = db.transaction(LOJA).objectStore(LOJA).get(CHAVE); g.onsuccess = () => ok(g.result || null); g.onerror = () => ok(null); });
  } catch (e) { return null; }
}
async function guardar(valor) {
  try {
    const db = await abrir();
    await new Promise(ok => { const t = db.transaction(LOJA, 'readwrite'); t.objectStore(LOJA).put(valor, CHAVE); t.oncomplete = ok; t.onerror = ok; });
  } catch (e) { /* sem cache: descarrega de cada vez */ }
}

let _a = null;
export function sincronizarCatalogoArtigos() {
  if (_a) return _a;
  _a = (async () => {
    try {
      const { data: v, error } = await sb.rpc('artigos_versao');
      if (error || !v) return;
      const g = await ler();
      if (g && g.v === v && g.cat) { window.ARTIGOS_CATALOGO = g.cat; return; }
      const { data: cat, error: e2 } = await sb.rpc('artigos_catalogo');
      if (e2 || !cat || !Object.keys(cat).length) return;   // nunca troca por um catálogo vazio
      window.ARTIGOS_CATALOGO = cat;
      await guardar({ v, cat });
    } catch (e) { console.warn('Catálogo de artigos:', e); }
    finally { _a = null; }
  })();
  return _a;
}

// Arranque: se já há sessão, e sempre que alguém entra
sb.auth.getSession().then(({ data }) => { if (data?.session) sincronizarCatalogoArtigos(); });
sb.auth.onAuthStateChange((ev, sess) => { if (sess && (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION')) sincronizarCatalogoArtigos(); });
