const { askAI, FRIENDLY } = require('./ai.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ reply: 'Method not allowed', error: true });
  const b = req.body || {};
  if (!Array.isArray(b.messages) || JSON.stringify(b).length > 20000) {
    return res.status(400).json({ reply: FRIENDLY.empty, error: true });
  }
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'anon').split(',')[0].trim();
  const cart = (Array.isArray(b.cart) ? b.cart : []).slice(0, 30).map(c => ({
    name: String(c.name || '').slice(0, 80), quantity: parseInt(c.quantity) || 1
  }));
  const orderType = ['dine-in', 'parcel', 'delivery'].includes(b.orderType) ? b.orderType : 'delivery';

  const out = await askAI({ messages: b.messages, cart, orderType, key: 'web:' + ip });
  if (out.error) return res.status(200).json({ reply: FRIENDLY[out.error] || FRIENDLY.api, error: out.error });
  return res.status(200).json({ reply: out.reply, actions: out.actions });
};
