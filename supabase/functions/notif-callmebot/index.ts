// Edge Function: notif-callmebot
// Chamada via pg_net trigger quando inserida notificação para david.mosca.
// Credenciais CallMeBot guardadas na tabela public.whatsapp_config.
// Nota: esta função já não é usada directamente — o trigger chama CallMeBot
// via net.http_get() directamente da BD. Mantida aqui para referência.

const CALLMEBOT_PHONE = Deno.env.get('CALLMEBOT_PHONE') ?? ''
const CALLMEBOT_APIKEY = Deno.env.get('CALLMEBOT_APIKEY') ?? ''
const TARGET_USER = 'david.mosca'

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json()
    const record = payload.record ?? payload

    if (!record || record.destinatario !== TARGET_USER) {
      return new Response('skipped', { status: 200 })
    }

    const acao = record.acao ?? ''
    const actor_nome = record.actor_nome ?? 'Sistema'
    const seccao = record.seccao ? `[${record.seccao}] ` : ''
    const text = `${seccao}${actor_nome}: ${acao}`

    const url = `https://api.callmebot.com/whatsapp.php?phone=${CALLMEBOT_PHONE}&text=${encodeURIComponent(text)}&apikey=${CALLMEBOT_APIKEY}`
    const res = await fetch(url)
    const body = await res.text()
    console.log('CallMeBot status:', res.status, 'body:', body)

    return new Response('ok', { status: 200 })
  } catch (e) {
    console.error('Erro:', e)
    return new Response('error', { status: 500 })
  }
})
