import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');
  try {
    const { type, data } = req.body;
    if (type !== 'payment') return res.status(200).send('Evento no manejado');

    const paymentId = data.id;
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const payment = await r.json();

    const status = payment.status; // "approved", "pending", ...
    const clientId = payment.metadata?.client_id || null;

    if (clientId) {
      let newStatus = 'trial';
      if (status === 'approved') newStatus = 'active';
      if (status === 'rejected' || status === 'cancelled') newStatus = 'suspended';

      await supabase
        .from('subscriptions')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('client_id', clientId);
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).send('Error interno');
  }
}
