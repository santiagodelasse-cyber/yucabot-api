export const config = { runtime: 'edge' };

export default async function handler(req) {
  // Mercado Pago a veces manda pruebas con GET
  if (req.method !== 'POST') {
    return new Response('ok', { status: 200 });
  }

  let payload = {};
  try {
    payload = await req.json();
  } catch (e) {
    payload = {};
  }

  // Reenvía al webhook de n8n (usa la variable del entorno)
  const url = process.env.N8N_WEBHOOK_URL;
  if (url) {
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  // Responde de inmediato a Mercado Pago
  return new Response('ok', { status: 200 });
}
