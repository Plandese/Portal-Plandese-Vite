// Lê a fotografia de uma guia de remessa/transporte com o Claude e devolve os campos estruturados.
// Usa o segredo ANTHROPIC_API_KEY (o mesmo da ler-fatura). verify_jwt ligado: só utilizadores do portal.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = Deno.env.get("FATURAS_MODEL") ?? "claude-sonnet-5-5";

const TOOL = {
  name: "registar_guia",
  description: "Regista os dados extraídos de uma guia de remessa/transporte recebida em obra.",
  input_schema: {
    type: "object",
    properties: {
      fornecedor: { type: "string", description: "Nome de quem EMITE a guia (o fornecedor), nunca o cliente (Plandese)." },
      nif: { type: "string", description: "NIF do fornecedor/emitente, 9 dígitos sem espaços nem prefixo PT. Vazio se não existir ou estiver ilegível." },
      numero: { type: "string", description: "Número da guia tal como impresso (ex.: 'GR 2026/1234', 'GT 12/5678')." },
      data: { type: "string", description: "Data da guia em YYYY-MM-DD. Vazio se ilegível." },
      local_obra: { type: "string", description: "Obra/local de entrega ou descarga indicado na guia. Vazio se não indicado." },
      linhas: {
        type: "array",
        description: "Materiais da guia, um por linha, pela ordem do documento. Só artigos entregues (não incluas totais nem texto livre).",
        items: {
          type: "object",
          properties: {
            descricao: { type: "string", description: "Designação do artigo tal como impressa (sem o código)." },
            ref_fornecedor: { type: "string", description: "Código/referência do artigo do fornecedor, se existir. Vazio se não existir." },
            qtd: { type: "number", description: "Quantidade entregue." },
            un: { type: "string", description: "Unidade tal como impressa (un, m, m2, m3, kg, saco, palete...). Vazio se não existir." },
          },
          required: ["descricao", "qtd"],
        },
      },
      confianca: { type: "number", description: "0 a 1: confiança global na leitura." },
      avisos: { type: "array", items: { type: "string" }, description: "Dúvidas (foto desfocada, número ilegível, quantidade manuscrita, linhas cortadas...)." },
    },
    required: ["fornecedor", "numero", "linhas", "confianca", "avisos"],
  },
};

const SYSTEM = `És um assistente da Plandese, uma empresa de construção portuguesa. Recebes a fotografia de uma guia de remessa ou de transporte entregue em obra e extrais os dados com rigor absoluto.
Regras:
- A Plandese é o CLIENTE (destinatário). O fornecedor é quem emite a guia; nunca devolvas a Plandese como fornecedor.
- O número da guia é o que vem impresso no topo (ex.: 'GR 2026/1234'); não o confundas com o número de encomenda, de cliente ou de matrícula.
- Lê cada linha de material com a quantidade ENTREGUE. Se houver quantidade pedida e entregue, usa a entregue. Quantidades manuscritas contam, mas regista um aviso.
- Copia as descrições fielmente, sem interpretar nem traduzir. Valores com vírgula decimal passam a ponto decimal.
- Datas em YYYY-MM-DD. Não inventes: se algo estiver ilegível ou cortado, deixa vazio (texto) ou omite a linha e acrescenta um aviso.
- Se a fotografia não for uma guia legível, devolve confianca baixa e explica em "avisos".
- Usa sempre a ferramenta registar_guia.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY não configurada no Supabase" }, 500);

    const { base64, mediaType } = await req.json();
    if (!base64 || !mediaType) return json({ error: "base64 e mediaType são obrigatórios" }, 400);
    if (!["image/jpeg", "image/png"].includes(mediaType)) return json({ error: "Só são aceites fotografias JPEG ou PNG" }, 400);

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        tools: [TOOL],
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: "Extrai os dados desta guia de remessa e regista-os chamando a ferramenta registar_guia." },
          ],
        }],
      }),
    });
    if (!resp.ok) return json({ error: `Anthropic ${resp.status}: ${await resp.text()}` }, 502);

    const data = await resp.json();
    const uso = data.content?.find((c: { type: string }) => c.type === "tool_use");
    if (!uso) return json({ error: "Resposta sem dados estruturados" }, 502);
    return json({ guia: uso.input });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
