// Avisos por email das validades dos colaboradores (Identificação, FA, EPI).
// - acao "diario": chamada pelo pg_cron (cabeçalho x-cron-key); envia o resumo e regista os avisos.
// - acao "teste": chamada pelo portal por quem tem Recursos Humanos; envia um email de teste
//   com o que seria enviado hoje, sem registar nada.
// As regras de validade são as mesmas da ficha do colaborador (colaboradores-ficha.js):
//   Identificação → data de validade; FA → 12 meses se tinha ≥50 anos no exame, senão 24; EPI → 12 meses.
// Segredos: GMAIL_USER, GMAIL_APP_PASSWORD (palavra-passe de aplicação do Google).
// A chave do pg_cron está no Vault (fn_avisos_cron_key, só service role).
import { createClient } from "jsr:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

type Regra = { ativo: boolean; primeiro: number; n: number; intervalo: number; no_dia: boolean };
const NOMES: Record<string, string> = { id: "Identificação", fa: "Ficha de aptidão (FA)", epi: "EPI" };

// ── datas (em dias, sem horas) ──
const iso = (d: Date) => d.toISOString().slice(0, 10);
const hojeLisboa = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
function addMeses(s: string, m: number) {        // como o EDATE do Excel
  const [y, mo, d] = s.split("-").map(Number);
  const alvo = new Date(Date.UTC(y, mo - 1 + m, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return iso(alvo);
}
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const fmt = (s: string) => s.split("-").reverse().join("/");
const esc = (t: unknown) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// dias de antecedência em que se avisa, do maior para o menor (0 = no dia em que caduca)
export function diasAviso(r: Regra): number[] {
  const out = new Set<number>();
  const n = Math.max(0, Math.min(10, Math.floor(r.n || 0)));
  for (let k = 0; k < n; k++) { const d = Math.floor(r.primeiro - k * (r.intervalo || 0)); if (d > 0) out.add(d); }
  if (r.no_dia) out.add(0);
  return [...out].sort((a, b) => b - a);
}

type Item = { numero: number; nome: string; tipo: string; ate: string; faltam: number; dias: number; marcar: number[] };

async function calcular(hoje: string) {
  const [{ data: cfg, error: e1 }, { data: colabs }, { data: fichas }, { data: enviados }] = await Promise.all([
    admin.from("avisos_validades_config").select("*").eq("id", 1).single(),
    admin.from("colaboradores").select("numero,nome,ativo,data_nascimento"),
    admin.from("colaboradores_ficha").select("numero,id_validade,fa_data,epi_data"),
    admin.from("avisos_validades_enviados").select("numero,tipo,ate,dias"),
  ]);
  if (e1 || !cfg) throw new Error("Configuração dos avisos em falta: " + (e1?.message ?? ""));
  const ja = new Set((enviados ?? []).map((r) => `${r.numero}|${r.tipo}|${r.ate}|${r.dias}`));
  const fichaDe = new Map((fichas ?? []).map((f) => [f.numero, f]));
  const itens: Item[] = [];
  for (const c of colabs ?? []) {
    if (!c.ativo) continue;
    const f = fichaDe.get(c.numero); if (!f) continue;
    const ates: Record<string, string | null> = {
      id: f.id_validade ?? null,
      fa: f.fa_data && f.fa_data <= hoje
        ? addMeses(f.fa_data, c.data_nascimento && f.fa_data >= addMeses(c.data_nascimento, 600) ? 12 : 24) : null,
      epi: f.epi_data && f.epi_data <= hoje ? addMeses(f.epi_data, 12) : null,
    };
    for (const tipo of ["id", "fa", "epi"]) {
      const r: Regra = cfg.regras?.[tipo]; const ate = ates[tipo];
      if (!r?.ativo || !ate) continue;
      const faltam = diasEntre(hoje, ate);
      const devidos = diasAviso(r).filter((d) => faltam <= d);
      if (!devidos.length) continue;
      const dias = Math.min(...devidos);
      if (ja.has(`${c.numero}|${tipo}|${ate}|${dias}`)) continue;
      itens.push({ numero: c.numero, nome: c.nome, tipo, ate, faltam, dias, marcar: devidos });
    }
  }
  itens.sort((a, b) => a.faltam - b.faltam || a.nome.localeCompare(b.nome, "pt"));
  return { cfg, itens };
}

function htmlEmail(itens: Item[], teste: boolean) {
  const linha = (i: Item) => {
    const estado = i.faltam < 0 ? `<b style="color:#b3261e">Caducado há ${-i.faltam} ${-i.faltam === 1 ? "dia" : "dias"}</b>`
      : i.faltam === 0 ? `<b style="color:#b3261e">Caduca hoje</b>`
      : `<b style="color:#92400e">Faltam ${i.faltam} ${i.faltam === 1 ? "dia" : "dias"}</b>`;
    return `<tr><td style="padding:8px 10px;border-top:1px solid #e3e7ee">${i.numero}</td>
      <td style="padding:8px 10px;border-top:1px solid #e3e7ee">${esc(i.nome)}</td>
      <td style="padding:8px 10px;border-top:1px solid #e3e7ee">${NOMES[i.tipo]}</td>
      <td style="padding:8px 10px;border-top:1px solid #e3e7ee">${fmt(i.ate)}</td>
      <td style="padding:8px 10px;border-top:1px solid #e3e7ee">${estado}</td></tr>`;
  };
  const corpo = itens.length
    ? `<table style="border-collapse:collapse;width:100%;font-size:14px;border:1px solid #e3e7ee">
        <tr style="background:#f6f8fb;color:#5d6678;font-size:12px;text-align:left"><th style="padding:8px 10px">Nº</th><th style="padding:8px 10px">Colaborador</th><th style="padding:8px 10px">Documento</th><th style="padding:8px 10px">Validade</th><th style="padding:8px 10px">Situação</th></tr>
        ${itens.map(linha).join("")}</table>`
    : `<p style="color:#5d6678">Hoje não há avisos a enviar.</p>`;
  return `<div style="font-family:Arial,sans-serif;color:#1b2130;max-width:720px">
    <div style="background:#173f9f;color:#fff;padding:18px 22px;border-radius:14px 14px 0 0">
      <div style="font-size:20px;font-weight:800">Validades dos colaboradores</div>
      <div style="font-size:13px;opacity:.85">${teste ? "Email de teste — " : ""}Portal Plandese · ${fmt(hojeLisboa())}</div></div>
    <div style="border:1px solid #e3e7ee;border-top:0;padding:18px 22px;border-radius:0 0 14px 14px">
      ${corpo}
      <p style="font-size:12px;color:#8a93a5;margin-top:18px">Pode alterar quem recebe estes avisos e com que antecedência no portal: Colaboradores → Avisos por email.</p>
    </div></div>`;
}

async function enviar(para: string[], assunto: string, html: string) {
  const user = Deno.env.get("GMAIL_USER"), pass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!user || !pass) throw new Error("Falta configurar GMAIL_USER / GMAIL_APP_PASSWORD na Supabase");
  const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
  await t.sendMail({ from: `"Portal Plandese" <${user}>`, to: para.join(", "), subject: assunto, html });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const acao = body?.acao ?? "diario";
    const hoje = hojeLisboa();

    if (acao === "diario") {
      const { data: chave } = await admin.rpc("fn_avisos_cron_key");
      if (!chave || req.headers.get("x-cron-key") !== chave) return json({ error: "não autorizado" }, 401);
      const { cfg, itens } = await calcular(hoje);
      const para = (cfg.destinatarios ?? []).map((d: { email: string }) => d.email).filter(Boolean);
      if (!cfg.ativo || !para.length || !itens.length) return json({ enviados: 0, itens: itens.length });
      const nCad = itens.filter((i) => i.faltam <= 0).length;
      const assunto = `Validades dos colaboradores: ${itens.length} ${itens.length === 1 ? "aviso" : "avisos"}${nCad ? ` (${nCad} caducado${nCad === 1 ? "" : "s"})` : ""}`;
      await enviar(para, assunto, htmlEmail(itens, false));
      const rows = itens.flatMap((i) => i.marcar.map((d) => ({ numero: i.numero, tipo: i.tipo, ate: i.ate, dias: d })));
      const { error } = await admin.from("avisos_validades_enviados").upsert(rows, { onConflict: "numero,tipo,ate,dias", ignoreDuplicates: true });
      if (error) console.error("registar avisos:", error);
      return json({ enviados: para.length, itens: itens.length });
    }

    if (acao === "teste") {
      // só quem tem o capítulo Recursos Humanos
      const auth = req.headers.get("Authorization") ?? "";
      const userSb = createClient(URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
      const { data: pode } = await userSb.rpc("fn_cap", { p_cap: "rh" });
      if (pode !== true) return json({ error: "Sem permissão (Recursos Humanos)" }, 403);
      const { cfg, itens } = await calcular(hoje);
      const para = (cfg.destinatarios ?? []).map((d: { email: string }) => d.email).filter(Boolean);
      if (!para.length) return json({ error: "Não há destinatários configurados" }, 400);
      await enviar(para, "[Teste] Validades dos colaboradores", htmlEmail(itens, true));
      return json({ enviados: para.length, itens: itens.length });
    }

    return json({ error: "ação desconhecida" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
