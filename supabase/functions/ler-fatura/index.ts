// Lê uma fatura (PDF ou imagem) com o Claude e devolve os campos estruturados.
// Requer o segredo ANTHROPIC_API_KEY (supabase secrets set ANTHROPIC_API_KEY=...).
// verify_jwt fica ligado: só utilizadores autenticados do portal podem chamar.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = Deno.env.get("FATURAS_MODEL") ?? "claude-sonnet-5-5";

const TOOL = {
  name: "registar_fatura",
  description: "Regista os dados extraídos de um documento de compra (fatura, nota de crédito, etc.).",
  input_schema: {
    type: "object",
    properties: {
      fornecedor: { type: "string", description: "Nome legal de quem EMITE o documento (o fornecedor), nunca o cliente." },
      nif: { type: "string", description: "NIF português do fornecedor/emitente, 9 dígitos sem espaços nem prefixo PT. Vazio se não existir." },
      numero: { type: "string", description: "Número do documento tal como impresso (ex.: 'FT 2026/1234')." },
      tipo: { type: "string", enum: ["fatura", "fatura_simplificada", "nota_credito", "nota_debito", "recibo", "outro"] },
      data: { type: "string", description: "Data de emissão em YYYY-MM-DD. Vazio se ilegível." },
      data_vencimento: { type: "string", description: "Data de vencimento/pagamento em YYYY-MM-DD. Vazio se não existir." },
      base: { type: "number", description: "Total sem IVA (soma de todas as taxas), em euros." },
      iva: { type: "number", description: "Total do IVA (soma de todas as taxas), em euros." },
      total: { type: "number", description: "Total a pagar com IVA, em euros." },
      moeda: { type: "string", description: "Código ISO, normalmente EUR." },
      descricao: { type: "string", description: "Resumo curto (máx. 120 caracteres) do que foi comprado." },
      confianca: { type: "number", description: "0 a 1: confiança global na extração." },
      avisos: { type: "array", items: { type: "string" }, description: "Dúvidas ou inconsistências (ex.: totais não batem, NIF ilegível, documento ilegível)." },
    },
    required: ["fornecedor", "nif", "numero", "tipo", "data", "base", "iva", "total", "confianca", "avisos"],
  },
};

const SYSTEM = `És um assistente de contabilidade da Plandese, uma empresa de construção portuguesa. Recebes uma fatura ou documento de compra e extrais os dados com rigor absoluto.
Regras:
- A Plandese é o CLIENTE (adquirente). O fornecedor é a outra entidade; nunca devolvas a Plandese como fornecedor nem o NIF da Plandese como NIF do fornecedor.
- Valida mentalmente que base + iva = total (tolerância 0,02 €). Se não bater, relê o documento; se persistir, diz-o em "avisos".
- Se houver várias taxas de IVA, soma as bases e os IVAs. Valores em euros, ponto decimal, sem separador de milhares.
- Datas em YYYY-MM-DD. Não inventes: se um campo não existir ou estiver ilegível, deixa-o vazio (texto) ou usa 0 e acrescenta um aviso.
- Em notas de crédito devolve os valores em módulo e tipo "nota_credito".
- Usa sempre a ferramenta registar_fatura.`;

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

    const bloco = mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "registar_fatura" },
        messages: [{ role: "user", content: [bloco, { type: "text", text: "Extrai os dados desta fatura." }] }],
      }),
    });
    if (!resp.ok) return json({ error: `Anthropic ${resp.status}: ${await resp.text()}` }, 502);

    const data = await resp.json();
    const uso = data.content?.find((c: { type: string }) => c.type === "tool_use");
    if (!uso) return json({ error: "Resposta sem dados estruturados" }, 502);
    return json({ fatura: uso.input });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
