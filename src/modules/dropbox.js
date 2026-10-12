// ═══════════════════════════════════════════════════
//  Dropbox da empresa — ligação única guardada no servidor
//  O portal fala com a Edge Function "dropbox", que usa a conta da empresa (refresh token
//  nos segredos do Supabase). Ninguém precisa de ligar a sua própria conta Dropbox.
// ═══════════════════════════════════════════════════
import { sb } from '../supabase.js';

const URL_FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dropbox`;
const ANON   = import.meta.env.VITE_SUPABASE_KEY;

const API = 'https://api.dropboxapi.com/2/';
const CONTENT = 'https://content.dropboxapi.com/2/';

// Cabeçalhos HTTP só aceitam ASCII — escapa acentos no Dropbox-API-Arg
const _asciiJson = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4));

// Envia um pedido à Dropbox através da ponte. team=true usa o espaço raiz partilhado da equipa.
async function _call(url, { headers = {}, body, team = false } = {}){
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if(!token) throw new Error('Sessão expirada. Volte a iniciar sessão.');
  const h = { Authorization: 'Bearer ' + token, apikey: ANON, 'x-dbx-url': url, ...headers };
  if(team) h['x-dbx-root'] = 'team';
  return fetch(URL_FN, { method: 'POST', headers: h, body });
}

async function _msg(resp){
  const t = await resp.text();
  try{
    const j = JSON.parse(t);
    if(j?.error && typeof j.error === 'string') return j.error + (j.status ? ` [HTTP ${j.status}${j.raiz ? ', raiz ' + j.raiz : ''}${j.pedido ? ', id ' + j.pedido : ''}]` : '');
  } catch{}
  return t || `HTTP ${resp.status}`;
}

// A ligação é da empresa e vive no servidor: está sempre "ligada" do ponto de vista do utilizador.
export function dropboxIsConnected(){ return true; }

// Compatibilidade com os botões antigos: testa a ligação da empresa e informa o resultado.
export async function dropboxLogin(){
  const toast = typeof window.showToast === 'function' ? window.showToast : alert;
  try{
    const r = await _call(API + 'users/get_current_account', { headers: { 'Content-Type': 'application/json' }, body: 'null' });
    if(!r.ok) throw new Error(await _msg(r));
    const d = await r.json();
    toast('Dropbox da empresa ligada' + (d?.email ? ' (' + d.email + ')' : ''));
  } catch(e){
    toast('Dropbox: ' + (e.message || e));
  }
}

export function dropboxLogout(){}

// Chamado no arranque: remove restos da antiga ligação por utilizador
export async function dropboxInit(){
  try{
    ['dbx_token', 'dbx_refresh', 'dbx_root_ns'].forEach(k => localStorage.removeItem(k));
    sessionStorage.removeItem('dbx_verifier');
  } catch{}
  _renderDbxBtn();
}

export async function dropboxUpload(file, destPath){
  const buf = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const resp = await _call(CONTENT + 'files/upload', {
    headers: {
      'Dropbox-API-Arg': _asciiJson({ path: destPath, mode: 'add', autorename: true, mute: false }),
      'Content-Type':    'application/octet-stream',
    },
    body: buf,
  });
  if(!resp.ok) throw new Error('Dropbox upload falhou: ' + await _msg(resp));
  return (await resp.json()).path_display;
}

export function dropboxFatPath(fat, fileName, aprovada = false){
  const d   = fat.data || new Date().toISOString().slice(0,10);
  const ym  = d.slice(0,7);
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '.pdf';
  const safe = s => (s||'').replace(/[^\wÀ-ÿ\-]/g,'_').replace(/_+/g,'_').slice(0,30);
  const name = [safe(fat.fornecedor), safe(fat.nif), safe(fat.numero)||safe(fileName.replace(/\.[^.]+$/,''))].filter(Boolean).join('_');
  if(aprovada && fat.centroCusto){
    return `/04_DP/${safe(fat.centroCusto)}/Faturas_Aprovadas/${ym}/${name}${ext}`;
  }
  if(fat.centroCusto){
    return `/04_DP/${safe(fat.centroCusto)}/Faturas_Pendentes/${ym}/${name}${ext}`;
  }
  return `/04_DP/Faturas/${ym}/${name}${ext}`;
}

async function _rpc(endpoint, body, team = true){
  const resp = await _call(API + endpoint, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), team });
  if(!resp.ok) throw new Error(`Dropbox ${endpoint}: ` + await _msg(resp));
  return resp.json();
}

export async function dropboxGetSharedLink(path){
  try{
    const d = await _rpc('sharing/create_shared_link_with_settings', { path, settings: { requested_visibility: { '.tag': 'public' } } }, false);
    return d.url?.replace('?dl=0','?dl=1') || null;
  } catch(e){
    const m = String(e.message).match(/"url":\s*"([^"]+)"/);
    return m ? m[1].replace('?dl=0','?dl=1') : null;
  }
}

export async function dropboxMoveFile(fromPath, toPath){
  const data = await _rpc('files/move_v2', { from_path: fromPath, to_path: toPath, autorename: true }, false);
  return data.metadata?.path_display;
}

// ═══════════════════════════════════════════════════
//  Pastas partilhadas da equipa (espaço raiz da Dropbox)
//  Caminhos relativos ao espaço "Plandese Dropbox", como no explorador de ficheiros.
// ═══════════════════════════════════════════════════

// Lista os ficheiros (sem subpastas) de uma pasta
// Testa o caminho nível a nível (na raiz da equipa e na pessoal) para dizer onde falha
async function _diagnosticarPasta(path){
  const partes = path.split('/').filter(Boolean);
  const out = [];
  for(const team of [true, false]){
    let ok = '', falhou = '';
    for(let i = 0; i <= partes.length; i++){
      const p = i ? '/' + partes.slice(0, i).join('/') : '';
      try{ await _rpc('files/list_folder', { path: p, recursive: false }, team); ok = p || '(raiz)'; }
      catch{ falhou = p || '(raiz)'; break; }
    }
    // Lista o que existe no último nível que abriu (para escolher o caminho certo)
    let ver = '';
    try{
      const r = await _rpc('files/list_folder', { path: ok === '(raiz)' || !ok ? '' : ok, recursive: false }, team);
      ver = r.entries.slice(0, 15).map(e => e.name).join(', ') + (r.entries.length > 15 ? '…' : '');
    } catch{}
    // Se falhou logo no 1.º nível, procura a pasta pedida mais abaixo (até 3 níveis)
    let achada = '';
    if(falhou && partes.length && ok === '(raiz)' && falhou === '/' + partes[0]){
      const alvo = partes[0].toLowerCase();
      let fila = [''], chamadas = 0;
      for(let nivel = 0; nivel < 3 && !achada && fila.length; nivel++){
        const prox = [];
        for(const base of fila){
          if(chamadas++ > 30 || achada) break;
          try{
            const r = await _rpc('files/list_folder', { path: base, recursive: false }, team);
            for(const e of r.entries){
              if(e['.tag'] !== 'folder') continue;
              const p = base + '/' + e.name;
              if(e.name.toLowerCase() === alvo){ achada = p; break; }
              prox.push(p);
            }
          } catch{}
        }
        fila = prox;
      }
    }
    out.push(`${team ? 'equipa' : 'pessoal'}: abre até «${ok || 'nada'}»${falhou ? `, falha em «${falhou}»` : ', abre tudo'}${ver ? ` — aí existe: ${ver}` : ''}${achada ? ` — «${partes[0]}» ENCONTRADA em «${achada}»` : ''}`);
  }
  return out.join(' | ');
}

export async function dropboxListFolder(path){
  let res;
  try{ res = await _rpc('files/list_folder', { path, recursive: false }); }
  catch(e){
    const d = await _diagnosticarPasta(path).catch(() => '');
    console.warn('Dropbox list_folder:', path, d);
    throw new Error(e.message + (d ? ' — Diagnóstico: ' + d : ''));
  }
  const out = [...res.entries];
  while(res.has_more){ res = await _rpc('files/list_folder/continue', { cursor: res.cursor }); out.push(...res.entries); }
  return out.filter(e => e['.tag'] === 'file');
}

export async function dropboxDownload(path){
  const resp = await _call(CONTENT + 'files/download', { headers: { 'Dropbox-API-Arg': _asciiJson({ path }) }, team: true });
  if(!resp.ok) throw new Error('Dropbox download falhou: ' + await _msg(resp));
  return resp.blob();
}

export async function dropboxUploadTeam(blob, path){
  const resp = await _call(CONTENT + 'files/upload', {
    headers: {
      'Dropbox-API-Arg': _asciiJson({ path, mode: 'add', autorename: true, mute: false }),
      'Content-Type': 'application/octet-stream',
    },
    body: await blob.arrayBuffer(),
    team: true,
  });
  if(!resp.ok) throw new Error('Dropbox upload falhou: ' + await _msg(resp));
  return (await resp.json()).path_display;
}

export async function dropboxDeleteTeam(path){
  await _rpc('files/delete_v2', { path });
}

export async function dropboxLinkTeam(path){
  try{
    const d = await _rpc('sharing/create_shared_link_with_settings', { path, settings: { requested_visibility: { '.tag': 'public' } } });
    return d.url?.replace('?dl=0', '?dl=1') || null;
  } catch(e){
    const m = String(e.message).match(/"url":\s*"([^"]+)"/);
    return m ? m[1].replace('?dl=0', '?dl=1') : null;
  }
}

// Botão Dropbox na UI (se existir): mostra que a ligação é da empresa; clicar testa-a
function _renderDbxBtn(){
  const btn = document.getElementById('dbx-btn');
  if(!btn) return;
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><path d="M6 2l6 4-6 4-6-4 6-4zm12 0l6 4-6 4-6-4 6-4zM0 13l6 4 6-4-6-4-6 4zm18-4l-6 4 6 4 6-4-6-4zM6 18l6 4 6-4-6-4-6 4z"/></svg>Dropbox da empresa`;
  btn.className = 'btn btn-success btn-sm';
  btn.title = 'Testar a ligação da Dropbox da empresa';
  btn.onclick = dropboxLogin;
}
