// Ponte para a Dropbox com UMA ligação da empresa (guardada no servidor).
// Os utilizadores do portal não precisam de ligar a sua conta Dropbox nem contam para o limite de
// utilizadores da app: o portal chama esta função, que fala com a Dropbox em nome da empresa.
//
// Segredos (supabase secrets set ...):
//   DROPBOX_APP_KEY        chave da app Dropbox
//   DROPBOX_REFRESH_TOKEN  refresh token (offline) da conta da empresa — ver scripts/dropbox-refresh-token.mjs
//   DROPBOX_APP_SECRET     opcional (necessário só se o refresh token foi obtido sem PKCE)
//
// verify_jwt fica ligado e o perfil é confirmado na base de dados (nunca vem do cliente).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, dropbox-api-arg, x-dbx-url, x-dbx-root",
  "Access-Control-Expose-Headers": "dropbox-api-result, content-type",
};

// Só estes endpoints da Dropbox são alcançáveis através da ponte.
const PERMITIDOS = new Set([
  "https://content.dropboxapi.com/2/files/upload",
  "https://content.dropboxapi.com/2/files/download",
  "https://api.dropboxapi.com/2/files/list_folder",
  "https://api.dropboxapi.com/2/files/list_folder/continue",
  "https://api.dropboxapi.com/2/files/delete_v2",
  "https://api.dropboxapi.com/2/files/move_v2",
  "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
  "https://api.dropboxapi.com/2/users/get_current_account",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

let _token = "";
let _tokenAte = 0;
let _rootNs = "";

async function accessToken(forcar = false): Promise<string> {
  if (!forcar && _token && Date.now() < _tokenAte - 60_000) return _token;
  const appKey = Deno.env.get("DROPBOX_APP_KEY");
  const refresh = Deno.env.get("DROPBOX_REFRESH_TOKEN");
  if (!appKey || !refresh) throw new Error("Dropbox não configurada no servidor (DROPBOX_APP_KEY / DROPBOX_REFRESH_TOKEN)");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: appKey });
  const secret = Deno.env.get("DROPBOX_APP_SECRET");
  if (secret) body.set("client_secret", secret);
  const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error("Dropbox recusou o refresh token: " + await r.text());
  const d = await r.json();
  _token = d.access_token;
  _tokenAte = Date.now() + (Number(d.expires_in) || 14400) * 1000;
  return _token;
}

async function rootHeader(): Promise<Record<string, string>> {
  if (!_rootNs) {
    const r = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
      method: "POST",
      headers: { Authorization: "Bearer " + await accessToken() },
    });
    if (!r.ok) throw new Error("Dropbox: não foi possível obter a conta — " + await r.text());
    _rootNs = (await r.json()).root_info?.root_namespace_id ?? "";
  }
  return _rootNs ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "root", root: _rootNs }) } : {};
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não suportado" }, 405);

  try {
    // Só utilizadores autenticados com perfil (e que não sejam encarregados) usam a ponte.
    const sb: any = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: role } = await sb.rpc("fn_my_role");
    if (!role) return json({ error: "Sessão inválida ou utilizador sem perfil." }, 401);
    if (role === "encarregado") return json({ error: "Sem permissão para a Dropbox." }, 403);

    const alvo = req.headers.get("x-dbx-url") ?? "";
    if (!PERMITIDOS.has(alvo)) return json({ error: "Endpoint da Dropbox não permitido" }, 400);

    // Lê sempre o corpo (o gateway pode enviar em blocos, sem content-length)
    const bruto = new Uint8Array(await req.arrayBuffer());
    const corpo = bruto.length ? bruto : undefined;

    const enviar = async (tok: string) => {
      const h: Record<string, string> = { Authorization: "Bearer " + tok };
      const ct = req.headers.get("content-type");
      if (ct) h["Content-Type"] = ct;
      const arg = req.headers.get("dropbox-api-arg");
      if (arg) h["Dropbox-API-Arg"] = arg;
      if (req.headers.get("x-dbx-root") === "team") Object.assign(h, await rootHeader());
      return fetch(alvo, { method: "POST", headers: h, body: corpo });
    };

    let resp = await enviar(await accessToken());
    if (resp.status === 401) resp = await enviar(await accessToken(true));
    // Erros 5xx da Dropbox são muitas vezes transitórios: repete até 2 vezes
    for (let i = 0; i < 2 && resp.status >= 500; i++) {
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
      resp = await enviar(await accessToken());
    }

    // Erros da Dropbox seguem como JSON {error, status} para a mensagem ser clara no portal
    if (!resp.ok) {
      const txt = (await resp.text()).slice(0, 600);
      return json({
        error: txt || "sem detalhe",
        status: resp.status,
        endpoint: alvo.split("/2/")[1],
        raiz: req.headers.get("x-dbx-root") === "team" ? (_rootNs || "sem raiz") : "home",
        pedido: resp.headers.get("x-dropbox-request-id") ?? "",
      }, resp.status);
    }

    const h = new Headers(cors);
    const ct = resp.headers.get("content-type");
    if (ct) h.set("Content-Type", ct);
    const res = resp.headers.get("dropbox-api-result");
    if (res) h.set("Dropbox-API-Result", res);
    return new Response(resp.body, { status: resp.status, headers: h });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
