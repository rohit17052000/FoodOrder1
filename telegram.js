const FIREBASE_DB_URL = "https://foodorder1-65003-default-rtdb.firebaseio.com";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || ""; // optional: your own Telegram chat id for new-order alerts

// ===== RESTAURANT DETAILS (keep same as index.html / admin.html) =====
const RESTO = { name: 'JavaGoat', address: 'Shop address, Nashik, Maharashtra', phone: '+91 98XXXXXXXX', gstin: '', upiId: 'yourupi@bank', gstPercent: 5, deliveryFee: 50 };

const fmt = n => Number(n || 0).toFixed(2);
const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const TYPE_LABEL = { 'dine-in': '🍽️ Dine-in', 'parcel': '🛍️ Parcel / Takeaway', 'delivery': '🛵 Home Delivery' };

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).catch(e => { console.error(method, 'failed:', e); });

const send = (chatId, text, buttons) =>
  api('sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML',
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {})
  });

async function sendPhoto(chatId, photo, caption, buttons) {
  if (photo && String(photo).startsWith('http')) {
    const r = await api('sendPhoto', {
      chat_id: chatId, photo, caption, parse_mode: 'HTML',
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {})
    });
    if (r && r.ok) return;
  }
  await send(chatId, caption, buttons);
}

const fb = async (path, method = 'GET', body) => {
  const r = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return r.json();
};

const calc = (cart, type) => {
  const sub = cart.reduce((a, i) => a + i.price * i.quantity, 0);
  const gst = sub * RESTO.gstPercent / 100;
  const fee = type === 'delivery' ? RESTO.deliveryFee : 0;
  return { sub, gst, fee, total: sub + gst + fee };
};

const cartText = (s) => {
  const T = calc(s.cart, s.orderType);
  const lines = s.cart.map(i => `${i.quantity}x ${esc(i.name)} = Rs. ${fmt(i.price * i.quantity)}`).join('\n');
  return `🛒 <b>Your Cart</b> (${TYPE_LABEL[s.orderType]})\n${lines}\n\nSubtotal: Rs. ${fmt(T.sub)}` +
    (RESTO.gstPercent > 0 ? `\nGST (${RESTO.gstPercent}%): Rs. ${fmt(T.gst)}` : '') +
    (T.fee > 0 ? `\nDelivery Fee: Rs. ${fmt(T.fee)}` : '') +
    `\n<b>Total: Rs. ${fmt(T.total)}</b>`;
};

const shortId = id => String(id).substring(1, 7);

function billText(o, id) {
  const w = (t, n) => { t = String(t); return t.length > n ? t.slice(0, n - 1) + '.' : t.padEnd(n); };
  const rows = o.items.map(i => `${esc(w(i.name, 15))}${String(i.quantity).padStart(3)} ${fmt(i.price * i.quantity).padStart(9)}`).join('\n');
  const r = (l, v) => `${l.padEnd(19)}${v.padStart(9)}`;
  const gst = parseFloat(o.gst || 0), fee = parseFloat(o.deliveryFee || 0), disc = parseFloat(o.discount || 0);
  const typeLine = o.orderType === 'dine-in' ? `Dine-in | Table ${esc(o.tableNo)}` : o.orderType === 'parcel' ? 'Parcel / Takeaway' : 'Home Delivery';
  const date = new Date(o.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  return `🧾 <b>${esc(RESTO.name)}</b>\n${esc(RESTO.address)}\n📞 ${esc(RESTO.phone)}` +
    (RESTO.gstin ? `\nGSTIN: ${esc(RESTO.gstin)}` : '') +
    `\n━━━━━━━━━━━━━━\n<b>Bill No:</b> #${shortId(id)}\n<b>Date:</b> ${date}\n<b>Type:</b> ${typeLine}\n<b>Customer:</b> ${esc(o.customerName)}` +
    (o.phone ? `\n<b>Phone:</b> ${esc(o.phone)}` : '') +
    (o.orderType === 'delivery' ? `\n<b>Address:</b> ${esc(o.address)}` : '') +
    `\n<pre>${esc(w('Item', 15))}${'Qty'.padStart(3)} ${'Amt'.padStart(9)}\n${'-'.repeat(28)}\n${rows}\n${'-'.repeat(28)}\n` +
    `${r('Subtotal', fmt(o.subtotal))}` +
    (disc > 0 ? `\n${r('Discount', '-' + fmt(disc))}` : '') +
    (gst > 0 ? `\n${r('GST ' + o.gstPercent + '%', fmt(gst))}` : '') +
    (fee > 0 ? `\n${r('Delivery Fee', fmt(fee))}` : '') +
    `\n${'-'.repeat(28)}\n${r('GRAND TOTAL', fmt(o.total))}</pre>` +
    `\n💳 <b>${esc(o.paymentMethod)}</b> - ${esc(o.paymentStatus)}` +
    (o.utr ? `\nUTR: ${esc(o.utr)}` : '') +
    `\n\n🙏 Thank you! Type /start to order again.`;
}

async function sendMenu(chatId) {
  const dishes = await fb('dishes');
  if (!dishes) return send(chatId, 'Menu is empty right now.');
  const list = Object.values(dishes).map(d => `• ${esc(d.name)} - Rs. ${esc(d.price)}`).join('\n');
  return send(chatId, `📋 <b>Our Menu</b>\n${list}`.slice(0, 4000));
}

const askType = (chatId, name) =>
  send(chatId, `👋 Hello <b>${esc(name)}</b>!\nWelcome to <b>${esc(RESTO.name)}</b> 🍕☕\n\nHow would you like your order?`, [
    [{ text: '🍽️ Dine-in', callback_data: 'type:dine-in' }, { text: '🛍️ Parcel', callback_data: 'type:parcel' }],
    [{ text: '🛵 Home Delivery', callback_data: 'type:delivery' }]
  ]);

async function notify(orderId) {
  const o = await fb(`orders/${orderId}`);
  if (!o || !String(o.userId || '').startsWith('tg_')) return;
  const emoji = { Placed: '📝', Preparing: '👨‍🍳', Ready: '✅', 'Out for Delivery': '🛵', Delivered: '🎉' }[o.status] || '🔔';
  await send(o.userId.slice(3),
    `🔔 <b>Order #${shortId(orderId)} update</b>\nStatus: ${emoji} <b>${esc(o.status)}</b>\nPayment: <b>${esc(o.paymentStatus || 'Pending')}</b>`);
}

async function handle(chatId, input, isCb, from) {
  const firstName = (from && from.first_name) || 'Customer';
  const lower = input.toLowerCase();
  const sessionPath = `telegram_sessions/${chatId}`;

  if (!isCb && ['/start', 'reset', 'cancel', '/cancel'].includes(lower)) {
    await fb(sessionPath, 'PUT', { step: 'type' });
    return askType(chatId, firstName);
  }
  if (!isCb && lower === '/menu') return sendMenu(chatId);

  let s = (await fb(sessionPath)) || { step: 'idle' };
  s.cart = s.cart || [];
  const save = () => fb(sessionPath, 'PUT', s);

  const nextInfo = async () => {
    const need = s.orderType === 'dine-in' ? ['tableNo', 'name'] : s.orderType === 'parcel' ? ['name', 'phone'] : ['name', 'phone', 'address'];
    const miss = need.find(k => !s[k]);
    if (miss) {
      s.step = 'awaiting_' + miss;
      await save();
      const q = {
        tableNo: '🪑 Please send your <b>table number</b>:',
        name: '👤 Please send your <b>name</b>:',
        phone: '📞 Please send your <b>mobile number</b>:',
        address: '📍 Please send your <b>full delivery address</b> (with landmark):'
      }[miss];
      return send(chatId, q);
    }
    s.step = 'awaiting_payment';
    await save();
    const cashLabel = s.orderType === 'delivery' ? '💵 Cash on Delivery' : s.orderType === 'dine-in' ? '💵 Cash at Counter' : '💵 Cash at Pickup';
    return send(chatId, `${cartText(s)}\n\n💳 <b>Choose payment method:</b>`, [
      [{ text: cashLabel, callback_data: 'pay:Cash' }, { text: '📲 UPI QR Code', callback_data: 'pay:UPI' }]
    ]);
  };

  const addToCart = async (qty) => {
    if (!s.pending || !(qty >= 1 && qty <= 50)) return send(chatId, '⚠️ Please send a number between 1 and 50.');
    const ex = s.cart.find(i => i.id === s.pending.id);
    if (ex) ex.quantity += qty; else s.cart.push({ ...s.pending, quantity: qty });
    delete s.pending;
    s.step = 'cart_menu';
    await save();
    return send(chatId, cartText(s), [
      [{ text: '➕ Add more', callback_data: 'more' }, { text: '✅ Checkout', callback_data: 'checkout' }],
      [{ text: '🗑️ Clear cart', callback_data: 'clear' }]
    ]);
  };

  const askQty = async (key, dish) => {
    s.pending = { id: key, name: dish.name, price: Number(dish.price) || 0, img: dish.imageUrl || '' };
    s.step = 'awaiting_qty';
    await save();
    return sendPhoto(chatId, dish.imageUrl,
      `✅ <b>${esc(dish.name)}</b>\n💰 Rs. ${esc(dish.price)}\n\nHow many? Tap or type a number:`,
      [[1, 2, 3, 4].map(n => ({ text: String(n), callback_data: 'qty:' + n }))]);
  };

  const placeOrder = async (method, utr) => {
    const T = calc(s.cart, s.orderType);
    const order = {
      userId: `tg_${chatId}`,
      userEmail: `telegram_${chatId}@guest.com`,
      email: `telegram_${chatId}@guest.com`,
      customerName: s.name || firstName,
      phone: s.phone || '',
      orderType: s.orderType,
      tableNo: s.tableNo || '',
      address: s.orderType === 'delivery' ? (s.address || '') : '',
      items: s.cart.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity, img: i.img || '' })),
      subtotal: fmt(T.sub),
      discount: '0.00',
      couponUsed: 'None',
      gstPercent: RESTO.gstPercent,
      gst: fmt(T.gst),
      deliveryFee: fmt(T.fee),
      total: fmt(T.total),
      status: 'Placed',
      method: method === 'Cash' ? (s.orderType === 'delivery' ? 'Cash on Delivery' : 'Cash at Counter') : 'UPI QR',
      paymentMethod: method,
      paymentStatus: 'Pending',
      utr: utr || '',
      source: 'telegram',
      timestamp: new Date().toISOString()
    };
    const r = await fb('orders', 'POST', order);
    await fb(sessionPath, 'DELETE');
    await send(chatId, billText(order, r.name));
    if (ADMIN_CHAT_ID) {
      await send(ADMIN_CHAT_ID, `🆕 <b>New Telegram order #${shortId(r.name)}</b>\n${TYPE_LABEL[order.orderType]}${order.tableNo ? ' - Table ' + esc(order.tableNo) : ''}\n${esc(order.customerName)} ${esc(order.phone)}\nTotal: Rs. ${order.total} (${order.paymentMethod})`);
    }
  };

  // ---------- Button presses ----------
  if (isCb) {
    const idx = input.indexOf(':');
    const cmd = idx === -1 ? input : input.slice(0, idx);
    const arg = idx === -1 ? '' : input.slice(idx + 1);

    if (cmd === 'type') {
      s = { step: 'awaiting_item', orderType: arg, cart: [] };
      await save();
      await send(chatId, `${TYPE_LABEL[arg] || arg} selected ✅`);
      await sendMenu(chatId);
      return send(chatId, '✍️ Type the name of a dish to add it (e.g. <b>Pizza</b>):');
    }
    if (s.step === 'idle' || !s.orderType) return send(chatId, 'Session expired. Type /start to begin.');

    if (cmd === 'pick') {
      const dish = await fb(`dishes/${arg}`);
      if (!dish) return send(chatId, '❌ That item is not available. Type another dish name.');
      return askQty(arg, dish);
    }
    if (cmd === 'qty') return addToCart(parseInt(arg));
    if (cmd === 'more') { s.step = 'awaiting_item'; await save(); return send(chatId, '✍️ Type the next dish name (or /menu):'); }
    if (cmd === 'clear') { s.cart = []; s.step = 'awaiting_item'; await save(); return send(chatId, '🗑️ Cart cleared. Type a dish name to start again.'); }
    if (cmd === 'checkout') {
      if (!s.cart.length) return send(chatId, '🛒 Your cart is empty. Type a dish name first.');
      return nextInfo();
    }
    if (cmd === 'pay') {
      if (!s.cart.length) return send(chatId, 'Cart is empty. Type /start.');
      if (arg === 'Cash') return placeOrder('Cash');
      const T = calc(s.cart, s.orderType);
      s.step = 'awaiting_utr';
      await save();
      const upi = `upi://pay?pa=${encodeURIComponent(RESTO.upiId)}&pn=${encodeURIComponent(RESTO.name)}&am=${fmt(T.total)}&cu=INR&tn=${encodeURIComponent(RESTO.name + ' Order')}`;
      const qr = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(upi)}`;
      return sendPhoto(chatId, qr,
        `📲 <b>Scan &amp; pay Rs. ${fmt(T.total)}</b>\nUPI ID: <code>${esc(RESTO.upiId)}</code>\n\nAfter paying, send the <b>12-digit UTR / Transaction ID</b> here to confirm your order.`,
        [[{ text: '💵 Pay by cash instead', callback_data: 'pay:Cash' }]]);
    }
    return;
  }

  // ---------- Typed text ----------
  if (s.step === 'awaiting_item') {
    const dishes = (await fb('dishes')) || {};
    const q = lower;
    const matches = Object.keys(dishes).filter(k => String(dishes[k].name || '').toLowerCase().includes(q));
    if (!matches.length) {
      return send(chatId, `❌ Sorry, "<b>${esc(input)}</b>" is not on our menu.\nTry another name or type /menu.`);
    }
    if (matches.length === 1) return askQty(matches[0], dishes[matches[0]]);
    return send(chatId, `🔎 Found ${matches.length} items. Tap one:`,
      matches.slice(0, 8).map(k => [{ text: `${dishes[k].name} - Rs. ${dishes[k].price}`, callback_data: 'pick:' + k }]));
  }

  if (s.step === 'awaiting_qty') return addToCart(parseInt(input));

  const info = s.step.match(/^awaiting_(tableNo|name|phone|address)$/);
  if (info) {
    const key = info[1];
    if (key === 'phone' && input.replace(/\D/g, '').length < 10) return send(chatId, '⚠️ Please send a valid 10-digit mobile number:');
    if (key === 'tableNo' && input.length > 10) return send(chatId, '⚠️ Please send just the table number (e.g. 5):');
    if (key === 'address' && input.length < 8) return send(chatId, '⚠️ Please send your complete address:');
    s[key] = input.slice(0, 200);
    return nextInfo();
  }

  if (s.step === 'awaiting_utr') {
    const utr = input.replace(/\s/g, '');
    if (!/^\d{12}$/.test(utr)) return send(chatId, '⚠️ UTR must be 12 digits. Please check your UPI app and send it again, or type /cancel.');
    return placeOrder('UPI QR', utr);
  }

  if (s.step === 'cart_menu' || s.step === 'awaiting_payment') {
    return send(chatId, 'Please use the buttons above 👆 or type /cancel to start over.');
  }

  return send(chatId, 'Type /start to begin food ordering!');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');
  const update = req.body || {};
  try {
    if (update.action === 'notify' && update.orderId) {
      await notify(String(update.orderId));
    } else if (update.callback_query) {
      const cq = update.callback_query;
      await api('answerCallbackQuery', { callback_query_id: cq.id });
      if (cq.message && cq.data) await handle(cq.message.chat.id, cq.data, true, cq.from);
    } else if (update.message && update.message.text) {
      await handle(update.message.chat.id, update.message.text.trim(), false, update.message.from);
    }
  } catch (error) {
    console.error('Telegram Webhook Error:', error);
  }
  return res.status(200).send('OK');
};
