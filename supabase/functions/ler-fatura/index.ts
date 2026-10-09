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
      local_obra: { type: "string", description: "Obra/local de entrega ou descarga indicado no documento (ex.: 'Queluz de Baixo', 'Póvoa de Santa Iria'). Vazio se não indicado." },
      numero_obra: { type: "string", description: "Código/nº de obra se aparecer no documento (ex.: 9300065). Vazio se não existir." },
      taxa_iva: { type: "string", description: "Taxa(s) de IVA tal como aplicadas: '23%', '6%', '23%/13% (misto)', '0% (autoliq.)'." },
      centro_custo: { type: "string", description: "Se foi dada uma lista de obras: o nome EXATO (copiado da lista) da obra/centro de custo mais provável para esta fatura. Vazio se não houver indícios suficientes." },
      centro_custo_motivo: { type: "string", description: "Em poucas palavras, o indício usado (ex.: 'descarga em Queluz de Baixo', 'código 9300065 = O065')." },
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
- O NIF do fornecedor aparece junto a 'NIF', 'Contribuinte', 'NIPC', 'Cont.' ou no rodapé/cabeçalho, por vezes com espaços (ex.: 500 368 880); junta os dígitos. NUNCA uses um número de telefone, telemóvel, fax, IBAN, código postal ou ATCUD como NIF. Se não encontrares com certeza, deixa vazio e avisa.
- Valida mentalmente que base + iva = total (tolerância 0,02 €). Se não bater, relê o documento; se persistir, diz-o em "avisos".
- Se houver várias taxas de IVA, soma as bases e os IVAs. Valores em euros, ponto decimal, sem separador de milhares.
- Datas em YYYY-MM-DD. Não inventes: se um campo não existir ou estiver ilegível, deixa-o vazio (texto) ou usa 0 e acrescenta um aviso.
- Em notas de crédito usa tipo "nota_credito" e devolve base, iva e total NEGATIVOS.
- Documentos digitalizados/imagem: lê-os visualmente com o mesmo rigor.
- IVA em autoliquidação ou isento: iva = 0 e taxa_iva "0% (autoliq.)". Valores "não sujeitos" entram no total mas não na base com IVA; explica em "avisos".
- Faturas de portagens/aluguer com várias taxas (23% e 6%): soma tudo e usa taxa_iva "23%/6% (misto)".
- "descricao": resume o que foi fornecido/prestado e o período (ex.: 'Aluguer de 3 contentores LC20 (01 a 31/08)').
- Se o total impresso não bater com base + iva, devolve os valores impressos e regista o desvio em "avisos"; nunca ajustes valores para os fazer bater.
- Centro de custo: quando receberes uma lista de obras, escolhe a mais provável. Indícios, por ordem de força: (1) código de obra no documento — os códigos 93000NN correspondem à obra ONN (ex.: 9300065 = O065, 9300064 = O064, 9300062 = O062); (2) local de entrega/descarga/obra indicado (ex.: 'Queluz de Baixo', 'Estrada Consiglieri Pedroso 90' = Queluz de Baixo; 'Faro/Montenegro' = Faro; 'Póvoa de Santa Iria' = Praceta dos Caniços; 'Algés/Miraflores' = SIMAS Algés; 'Alfragide' = Mercadona Alfragide); (3) notas/descrição do documento. A morada da sede da Plandese (Estrada da Portela, Carnaxide) NÃO é uma obra. Se a fatura abranger várias obras ou não houver indícios, deixa centro_custo vazio e explica em centro_custo_motivo. Nunca inventes nomes fora da lista.
- Usa sempre a ferramenta registar_fatura.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY não configurada no Supabase" }, 500);

    const { base64, mediaType, obras } = await req.json();
    if (!base64 || !mediaType) return json({ error: "base64 e mediaType são obrigatórios" }, 400);

    const bloco = mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };

    let textoPedido = "Extrai os dados desta fatura e regista-os chamando a ferramenta registar_fatura.";
    if (Array.isArray(obras) && obras.length) {
      const linhas = obras.map((o: { nome: string; local?: string }) => `${o.nome} | ${o.local ?? ""}`);
      textoPedido += "\n\nLista de obras/centros de custo (nome | local):\n" + linhas.join("\n");
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM,
        tools: [TOOL],
        messages: [{ role: "user", content: [bloco, { type: "text", text: textoPedido }] }],
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
