// Lê uma proposta/orçamento de um fornecedor (PDF ou imagem) e devolve os preços por artigo do pedido de compra.
// Usa o segredo ANTHROPIC_API_KEY (o mesmo da ler-fatura). verify_jwt ligado: só utilizadores do portal.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = Deno.env.get("FATURAS_MODEL") ?? "claude-sonnet-5-5";

const TOOL = {
  name: "registar_proposta",
  description: "Regista os preços e condições de uma proposta de fornecimento recebida de um fornecedor.",
  input_schema: {
    type: "object",
    properties: {
      fornecedor: { type: "string", description: "Nome de quem EMITE a proposta (o fornecedor), nunca a Plandese." },
      nif: { type: "string", description: "NIF do fornecedor, 9 dígitos sem espaços. Vazio se não existir ou for incerto." },
      numero: { type: "string", description: "Número da proposta/orçamento como impresso. Vazio se não existir." },
      data: { type: "string", description: "Data de emissão em YYYY-MM-DD. Vazio se ilegível." },
      validade_dias: { type: "number", description: "Validade da proposta em dias (ex.: 30). 0 se não indicada." },
      validade_data: { type: "string", description: "Data limite de validade em YYYY-MM-DD, se vier indicada. Vazio caso contrário." },
      pagamento: { type: "string", description: "Condições de pagamento tal como indicadas (ex.: 'Fatura a 45 dias'). Vazio se não indicadas." },
      transporte: { type: "string", description: "'incluido', 'nao_incluido' ou 'desconhecido'." },
      prazo_entrega_dias: { type: "number", description: "Prazo de entrega em dias, se indicado (antecedência de pedido NÃO é prazo de entrega). 0 se não indicado." },
      iva_incluido: { type: "boolean", description: "true só se os preços já incluem IVA. Normalmente false (preços sem IVA)." },
      linhas: {
        type: "array",
        description: "Uma entrada por artigo da proposta com preço, pela ordem do documento.",
        items: {
          type: "object",
          properties: {
            descricao: { type: "string", description: "Designação do artigo tal como na proposta." },
            pedido_linha: { type: "number", description: "Índice (campo 'i') do artigo do pedido de compra a que corresponde. -1 se nenhum corresponder." },
            equivalencia: { type: "string", description: "'exata' se for o mesmo artigo e medida; 'aproximada' se for parecido mas com diferença (calibre, norma, classe…); 'nenhuma' se não corresponder a nenhum." },
            pu: { type: "number", description: "Preço unitário SEM IVA, em euros, na MESMA unidade do pedido. Se a unidade da proposta for diferente e não puderes converter com certeza, usa o valor impresso e explica na observação." },
            un: { type: "string", description: "Unidade do preço tal como impressa na proposta." },
            observacao: { type: "string", description: "Diferenças relevantes (calibre diferente, unidade diferente, desconto, mínimo de encomenda, só acima de X quantidade…). Vazio se nada a notar." },
          },
          required: ["descricao", "pedido_linha", "equivalencia", "pu"],
        },
      },
      avisos: { type: "array", items: { type: "string" }, description: "Dúvidas ou pontos a verificar pelo comprador." },
      confianca: { type: "number", description: "0 a 1: confiança global na leitura." },
    },
    required: ["fornecedor", "linhas", "confianca", "avisos"],
  },
};

const SYSTEM = `És um assistente do departamento de compras da Plandese, uma empresa de construção portuguesa. Recebes uma proposta de preços (ou orçamento) de um fornecedor e a lista de artigos do pedido de compra a que ela responde. Extrais os preços com rigor absoluto e associas cada preço ao artigo do pedido.
Regras:
- A Plandese é o CLIENTE. O fornecedor é quem emite a proposta; nunca devolvas a Plandese como fornecedor.
- Os preços são por unidade e SEM IVA, salvo indicação expressa em contrário (nesse caso, iva_incluido = true).
- Associa cada linha da proposta ao artigo do pedido mais próximo usando o índice "i". Só uses 'exata' se o artigo e as medidas/calibres coincidirem; se houver diferença (por exemplo Brita 3 20/40 numa proposta vs 16/32 no pedido, ou areia lavada vs areia de rio), usa 'aproximada' e explica em "observacao". Se não houver artigo do pedido que corresponda, pedido_linha = -1 e 'nenhuma'.
- Vários artigos do pedido podem ficar sem linha na proposta: simplesmente não os incluas. Não inventes preços.
- O transporte incluído deve ser indicado em "transporte". Se houver preço de transporte à parte, mete-o numa linha com pedido_linha -1 e explica.
- Prazo de entrega: só o tempo entre o pedido e a entrega. A "antecedência mínima do pedido" ou a validade da proposta não são prazo de entrega.
- Valores em euros com ponto decimal, sem separador de milhares. Datas em YYYY-MM-DD.
- Ignora condições gerais de venda em anexo, exceto o que afete preço, pagamento, validade ou transporte (resume em "avisos" se for importante, por exemplo cláusulas de revisão de preços).
- Se o documento não for uma proposta de preços legível, devolve confianca baixa e explica em "avisos".
- Usa sempre a ferramenta registar_proposta.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY não configurada no Supabase" }, 500);

    const { base64, mediaType, artigos, obra } = await req.json();
    if (!base64 || !mediaType) return json({ error: "base64 e mediaType são obrigatórios" }, 400);
    if (!["application/pdf", "image/jpeg", "image/png"].includes(mediaType)) return json({ error: "Só PDF, JPEG ou PNG" }, 400);
    if (!Array.isArray(artigos) || !artigos.length) return json({ error: "Falta a lista de artigos do pedido" }, 400);

    const bloco = mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };

    const lista = artigos.map((a: { i: number; desc: string; un?: string; qtd?: number }) => `i=${a.i} | ${a.desc} | un: ${a.un ?? ""} | qtd: ${a.qtd ?? ""}`).join("\n");
    const texto = `Artigos do pedido de compra${obra ? ` (obra: ${obra})` : ""} — índice | designação | unidade | quantidade:\n${lista}\n\nLê a proposta em anexo e regista-a chamando a ferramenta registar_proposta.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 6000,
        system: SYSTEM,
        tools: [TOOL],
        messages: [{ role: "user", content: [bloco, { type: "text", text: texto }] }],
      }),
    });
    if (!resp.ok) return json({ error: `Anthropic ${resp.status}: ${await resp.text()}` }, 502);

    const data = await resp.json();
    const uso = data.content?.find((c: { type: string }) => c.type === "tool_use");
    if (!uso) return json({ error: "Resposta sem dados estruturados" }, 502);
    return json({ proposta: uso.input });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
