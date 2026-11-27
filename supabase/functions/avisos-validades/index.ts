// Avisos por email das validades:
//   • colaboradores (Identificação, FA, EPI) — configuração em avisos_validades_config, capítulo RH;
//   • equipamentos (Seguro, Inspeção/IPO, Garantia) — configuração em avisos_eq_config, capítulo Equipamentos.
// Cada grupo tem os seus destinatários e regras e sai num email próprio.
// - acao "diario": chamada pelo pg_cron (cabeçalho x-cron-key); envia os resumos e regista os avisos.
// - acao "teste": chamada pelo portal ({grupo:"colab"|"eq"}) por quem tem o capítulo do grupo; envia um
//   email de teste com o que seria enviado hoje, sem registar nada.
// Regras dos colaboradores iguais às da ficha (colaboradores-ficha.js):
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

// Um alvo é uma pessoa ou um equipamento com uma data limite para um tipo de documento
type Alvo = { chave: string | number; nome: string; ref: string; tipo: string; ate: string };
type Item = Alvo & { faltam: number; dias: number; marcar: number[] };

type Grupo = {
  cap: string;
  tabCfg: string;
  tabEnv: string;
  colChave: "numero" | "equip_id";
  tipos: Record<string, string>;
  titulo: string;
  colRef: string;
  colNome: string;
  rodape: string;
  alvos: (hoje: string) => Promise<Alvo[]>;
};

const GRUPOS: Record<string, Grupo> = {
  colab: {
    cap: "rh",
    tabCfg: "avisos_validades_config",
    tabEnv: "avisos_validades_enviados",
    colChave: "numero",
    tipos: { id: "Identificação", fa: "Ficha de aptidão (FA)", epi: "EPI" },
    titulo: "Validades dos colaboradores",
    colRef: "Nº",
    colNome: "Colaborador",
    rodape: "Colaboradores → Avisos por email",
    async alvos(hoje) {
      const [{ data: colabs }, { data: fichas }] = await Promise.all([
        admin.from("colaboradores").select("numero,nome,ativo,data_nascimento"),
        admin.from("colaboradores_ficha").select("numero,id_validade,fa_data,epi_data"),
      ]);
      const fichaDe = new Map((fichas ?? []).map((f) => [f.numero, f]));
      const out: Alvo[] = [];
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
          if (ates[tipo]) out.push({ chave: c.numero, nome: c.nome, ref: String(c.numero), tipo, ate: ates[tipo]! });
        }
      }
      return out;
    },
  },
  eq: {
    cap: "log",
    tabCfg: "avisos_eq_config",
    tabEnv: "avisos_eq_enviados",
    colChave: "equip_id",
    tipos: { seguro: "Seguro", ipo: "Inspeção (IPO)", garantia: "Garantia" },
    titulo: "Validades dos equipamentos",
    colRef: "Matrícula / código",
    colNome: "Equipamento",
    rodape: "Equipamentos → Avisos por email",
    async alvos() {
      const { data } = await admin.from("equipamentos")
        .select("id,nome,matricula,codigo,seguro_validade,ipo_validade,garantia_ate");
      const out: Alvo[] = [];
      for (const e of data ?? []) {
        const ref = e.matricula || e.codigo || "";
        const ates: Record<string, string | null> = { seguro: e.seguro_validade, ipo: e.ipo_validade, garantia: e.garantia_ate };
        for (const tipo of ["seguro", "ipo", "garantia"]) {
          if (ates[tipo]) out.push({ chave: e.id, nome: e.nome, ref, tipo, ate: String(ates[tipo]).slice(0, 10) });
        }
      }
      return out;
    },
  },
};

async function calcular(g: Grupo, hoje: string) {
  const [{ data: cfg, error: e1 }, { data: enviados }, alvos] = await Promise.all([
    admin.from(g.tabCfg).select("*").eq("id", 1).single(),
    admin.from(g.tabEnv).select(`${g.colChave},tipo,ate,dias`),
    g.alvos(hoje),
  ]);
  if (e1 || !cfg) throw new Error(`Configuração dos avisos em falta (${g.tabCfg}): ` + (e1?.message ?? ""));
  // deno-lint-ignore no-explicit-any
  const ja = new Set((enviados ?? []).map((r: any) => `${r[g.colChave]}|${r.tipo}|${r.ate}|${r.dias}`));
  const itens: Item[] = [];
  for (const a of alvos) {
    const r: Regra = cfg.regras?.[a.tipo];
    if (!r?.ativo) continue;
    const faltam = diasEntre(hoje, a.ate);
    const devidos = diasAviso(r).filter((d) => faltam <= d);
    if (!devidos.length) continue;
    const dias = Math.min(...devidos);
    if (ja.has(`${a.chave}|${a.tipo}|${a.ate}|${dias}`)) continue;
    itens.push({ ...a, faltam, dias, marcar: devidos });
  }
  itens.sort((a, b) => a.faltam - b.faltam || a.nome.localeCompare(b.nome, "pt"));
  return { cfg, itens };
}

function htmlEmail(g: Grupo, itens: Item[], teste: boolean) {
  const td = (t: string) => `<td style="padding:8px 10px;border-top:1px solid #e3e7ee">${t}</td>`;
  const th = (t: string) => `<th style="padding:8px 10px">${t}</th>`;
  const linha = (i: Item) => {
    const estado = i.faltam < 0 ? `<b style="color:#b3261e">Caducado há ${-i.faltam} ${-i.faltam === 1 ? "dia" : "dias"}</b>`
      : i.faltam === 0 ? `<b style="color:#b3261e">Caduca hoje</b>`
      : `<b style="color:#92400e">Faltam ${i.faltam} ${i.faltam === 1 ? "dia" : "dias"}</b>`;
    return `<tr>${td(esc(i.ref))}${td(esc(i.nome))}${td(g.tipos[i.tipo])}${td(fmt(i.ate))}${td(estado)}</tr>`;
  };
  const corpo = itens.length
    ? `<table style="border-collapse:collapse;width:100%;font-size:14px;border:1px solid #e3e7ee">
        <tr style="background:#f6f8fb;color:#5d6678;font-size:12px;text-align:left">${th(g.colRef)}${th(g.colNome)}${th("Documento")}${th("Validade")}${th("Situação")}</tr>
        ${itens.map(linha).join("")}</table>`
    : `<p style="color:#5d6678">Hoje não há avisos a enviar.</p>`;
  return `<div style="font-family:Arial,sans-serif;color:#1b2130;max-width:720px">
    <div style="background:#173f9f;color:#fff;padding:18px 22px;border-radius:14px 14px 0 0">
      <div style="font-size:20px;font-weight:800">${g.titulo}</div>
      <div style="font-size:13px;opacity:.85">${teste ? "Email de teste — " : ""}Portal Plandese · ${fmt(hojeLisboa())}</div></div>
    <div style="border:1px solid #e3e7ee;border-top:0;padding:18px 22px;border-radius:0 0 14px 14px">
      ${corpo}
      <p style="font-size:12px;color:#8a93a5;margin-top:18px">Pode alterar quem recebe estes avisos e com que antecedência no portal: ${g.rodape}.</p>
    </div></div>`;
}

async function enviar(para: string[], assunto: string, html: string) {
  const user = Deno.env.get("GMAIL_USER"), pass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!user || !pass) throw new Error("Falta configurar GMAIL_USER / GMAIL_APP_PASSWORD na Supabase");
  const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
  await t.sendMail({ from: `"Portal Plandese" <${user}>`, to: para.join(", "), subject: assunto, html });
}

const destinos = (cfg: { destinatarios?: { email: string }[] }) =>
  (cfg.destinatarios ?? []).map((d) => d.email).filter(Boolean);

async function diarioGrupo(g: Grupo, hoje: string) {
  const { cfg, itens } = await calcular(g, hoje);
  const para = destinos(cfg);
  if (!cfg.ativo || !para.length || !itens.length) return { enviados: 0, itens: itens.length };
  const nCad = itens.filter((i) => i.faltam <= 0).length;
  const assunto = `${g.titulo}: ${itens.length} ${itens.length === 1 ? "aviso" : "avisos"}${nCad ? ` (${nCad} caducado${nCad === 1 ? "" : "s"})` : ""}`;
  await enviar(para, assunto, htmlEmail(g, itens, false));
  const rows = itens.flatMap((i) => i.marcar.map((d) => ({ [g.colChave]: i.chave, tipo: i.tipo, ate: i.ate, dias: d })));
  const { error } = await admin.from(g.tabEnv).upsert(rows, { onConflict: `${g.colChave},tipo,ate,dias`, ignoreDuplicates: true });
  if (error) console.error(`registar avisos (${g.tabEnv}):`, error);
  return { enviados: para.length, itens: itens.length };
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
      // Um grupo com erro não impede o outro de ser enviado
      const res: Record<string, unknown> = {};
      for (const [k, g] of Object.entries(GRUPOS)) {
        try { res[k] = await diarioGrupo(g, hoje); }
        catch (e) { console.error(`avisos ${k}:`, e); res[k] = { error: String((e as Error)?.message ?? e) }; }
      }
      return json(res);
    }

    if (acao === "teste") {
      const g = GRUPOS[body?.grupo ?? "colab"];
      if (!g) return json({ error: "grupo desconhecido" }, 400);
      // só quem tem o capítulo do grupo (RH para colaboradores, Equipamentos para equipamentos)
      const auth = req.headers.get("Authorization") ?? "";
      const userSb = createClient(URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
      const { data: pode } = await userSb.rpc("fn_cap", { p_cap: g.cap });
      if (pode !== true) return json({ error: "Sem permissão para estes avisos" }, 403);
      const { cfg, itens } = await calcular(g, hoje);
      const para = destinos(cfg);
      if (!para.length) return json({ error: "Não há destinatários configurados" }, 400);
      await enviar(para, `[Teste] ${g.titulo}`, htmlEmail(g, itens, true));
      return json({ enviados: para.length, itens: itens.length });
    }

    return json({ error: "ação desconhecida" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
