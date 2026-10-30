// Junta as fotografias de uma guia de remessa num PDF, guarda-o na pasta «Guias» da Dropbox da empresa e lê os dados
// da guia (fornecedor, nº, data, materiais) com a função «ler-guia» para o escritório não ter de os escrever.
// Com { so_ler: true } só refaz a leitura dos dados (sem gerar outro PDF).
// Corre com a sessão de quem chama (RLS): o encarregado só trata das suas guias; o escritório de qualquer uma.
// Segredos: DROPBOX_APP_KEY, DROPBOX_REFRESH_TOKEN, (opcional) DROPBOX_APP_SECRET — os mesmos da função «dropbox».
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const BUCKET = "guias-remessa";
const PASTA_PADRAO = "/David Mósca/11_DCOMPRAS/1.FATURAS APROVADAS_POR APROVAR/00 - PORTAL PLANDESE/Guias";

async function accessToken(): Promise<string> {
  const appKey = Deno.env.get("DROPBOX_APP_KEY"), refresh = Deno.env.get("DROPBOX_REFRESH_TOKEN");
  if (!appKey || !refresh) throw new Error("Dropbox não configurada no servidor");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: appKey });
  const secret = Deno.env.get("DROPBOX_APP_SECRET");
  if (secret) body.set("client_secret", secret);
  const r = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error("Dropbox recusou o refresh token: " + await r.text());
  return (await r.json()).access_token;
}
async function rootHeader(tok: string): Promise<Record<string, string>> {
  const r = await fetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: { Authorization: "Bearer " + tok } });
  if (!r.ok) throw new Error("Dropbox: não foi possível obter a conta — " + await r.text());
  const ns = (await r.json()).root_info?.root_namespace_id ?? "";
  return ns ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "root", root: ns }) } : {};
}
const asciiJson = (o: unknown) => JSON.stringify(o).replace(/[\u007f-\uffff]/g, (c) => "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4));
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const limpo = (t: string) => t.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 60);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não suportado" }, 405);
  try {
    const sb: any = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { guia_id, so_ler } = await req.json();
    if (!guia_id) return json({ error: "Falta guia_id" }, 400);

    const { data: g, error: eg } = await sb.from("guias_remessa").select("id,fotos,foto_path,obra_nome,criado_por,criado_em,fornecedor,nif,numero,data,pdf_path").eq("id", guia_id).maybeSingle();
    if (eg) throw eg;
    if (!g) return json({ error: "Guia não encontrada ou sem permissão" }, 404);
    const fotos: string[] = (Array.isArray(g.fotos) && g.fotos.length ? g.fotos : [g.foto_path]).filter(Boolean);
    if (!fotos.length) return json({ error: "A guia não tem fotografias" }, 400);

    const imagens: { bytes: Uint8Array; png: boolean }[] = [];
    for (const p of fotos) {
      const { data: blob, error } = await sb.storage.from(BUCKET).download(p);
      if (error || !blob) throw new Error("Fotografia indisponível: " + p);
      imagens.push({ bytes: new Uint8Array(await blob.arrayBuffer()), png: /\.png$/i.test(p) });
    }

    let path: string | null = g.pdf_path ?? null;
    if (!so_ler) {
    // PDF: uma página por fotografia, ajustada a A4 (mantém a proporção)
    const pdf = await PDFDocument.create();
    for (const { bytes, png } of imagens) {
      const img = png ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const A4 = img.width > img.height ? [841.89, 595.28] : [595.28, 841.89];
      const k = Math.min(A4[0] / img.width, A4[1] / img.height);
      const w = img.width * k, h = img.height * k;
      const pg = pdf.addPage(A4 as [number, number]);
      pg.drawImage(img, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2, width: w, height: h });
    }
    const out = await pdf.save();

    // Pasta «Guias»: ao lado da pasta das faturas por aprovar (configurável em app_config → fatura_pastas.guias)
    let pasta = PASTA_PADRAO;
    const { data: cfg } = await sb.from("app_config").select("value").eq("key", "fatura_pastas").maybeSingle();
    if (cfg?.value?.guias) pasta = String(cfg.value.guias).replace(/\/+$/, "");
    else if (cfg?.value?.pendentes) pasta = String(cfg.value.pendentes).replace(/\/[^/]+\/?$/, "") + "/Guias";

    const d = new Date(g.criado_em ?? Date.now());
    const dia = d.toISOString().slice(0, 10), hora = d.toISOString().slice(11, 16).replace(":", "h");
    const nome = [`Guia ${dia} ${hora}`, limpo(g.obra_nome ?? ""), limpo(g.criado_por ?? ""), `#${g.id}`].filter(Boolean).join(" - ") + ".pdf";

    const tok = await accessToken();
    const resp = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + tok,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": asciiJson({ path: `${pasta}/${nome}`, mode: "add", autorename: true, mute: true }),
        ...(await rootHeader(tok)),
      },
      body: out,
    });
    if (!resp.ok) return json({ error: "Dropbox: " + (await resp.text()).slice(0, 400) }, 502);
    path = (await resp.json()).path_display as string;

    const { error: eu } = await sb.from("guias_remessa").update({ pdf_path: path, pdf_em: new Date().toISOString() }).eq("id", g.id);
    if (eu) throw eu;
    }

    // Leitura dos dados da guia (não bloqueia: se falhar, o PDF já está guardado)
    let lido = false;
    try {
      const rl = await fetch(Deno.env.get("SUPABASE_URL")! + "/functions/v1/ler-guia", {
        method: "POST",
        headers: { Authorization: req.headers.get("Authorization") ?? "", apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" },
        body: JSON.stringify({ paginas: imagens.map((i) => ({ base64: b64(i.bytes), mediaType: i.png ? "image/png" : "image/jpeg" })) }),
      });
      const dl = rl.ok ? (await rl.json()).guia : null;
      if (dl) {
        const upd: Record<string, unknown> = {
          linhas: (dl.linhas ?? []).map((l: any) => ({ desc: l.descricao ?? "", ref_forn: l.ref_fornecedor ?? "", qtd: Number(l.qtd) || 0, un: l.un ?? "" })),
          confianca: Number(dl.confianca) || null,
          avisos: Array.isArray(dl.avisos) ? dl.avisos.filter(Boolean) : [],
        };
        if (!g.fornecedor && dl.fornecedor) upd.fornecedor = String(dl.fornecedor);
        const nif = String(dl.nif ?? "").replace(/\D/g, "").slice(-9);
        if (!g.nif && nif.length === 9) upd.nif = nif;
        if (!g.numero && dl.numero) upd.numero = String(dl.numero);
        if (!g.data && /^\d{4}-\d{2}-\d{2}$/.test(String(dl.data ?? ""))) upd.data = dl.data;
        const { error: el } = await sb.from("guias_remessa").update(upd).eq("id", g.id);
        lido = !el;
      }
    } catch (e) { console.warn("ler-guia:", e); }
    return json({ ok: true, path, lido });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
