const FIREBASE_DB_URL = "https://foodorder1-65003-default-rtdb.firebaseio.com";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function sendTelegram(chatId, text, photoUrl = null) {
  const baseUrl = `https://api.telegram.org/bot${BOT_TOKEN}`;

  if (photoUrl && photoUrl.startsWith('http')) {
    try {
      const res = await fetch(`${baseUrl}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: photoUrl,
          caption: text,
          parse_mode: 'Markdown'
        })
      });
      if (res.ok) return;
    } catch (e) {
      console.error("Photo delivery error, falling back to text:", e);
    }
  }

  await fetch(`${baseUrl}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    })
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send("OK");
  }

  const update = req.body;
  if (!update || !update.message || !update.message.text) {
    return res.status(200).send("OK");
  }

  const chatId = update.message.chat.id;
  const userText = update.message.text.trim();
  const userName = update.message.from.first_name || "Customer";

  try {
    const sessionRes = await fetch(`${FIREBASE_DB_URL}/telegram_sessions/${chatId}.json`);
    let session = (await sessionRes.json()) || { step: 'idle' };

    // Reset command
    if (userText === '/start' || userText.toLowerCase() === 'reset' || userText.toLowerCase() === 'cancel') {
      await fetch(`${FIREBASE_DB_URL}/telegram_sessions/${chatId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'awaiting_item' })
      });

      await sendTelegram(
        chatId,
        `👋 Hello *${userName}*!\nWelcome to *JavaGoat Food Delivery* 🍕☕\n\nWhat would you like to order today? (e.g., *Pizza*, *Burger*, *Coffee*)`
      );
      return res.status(200).send("OK");
    }

    // Step 1: Query Firebase for Dish
    if (session.step === 'awaiting_item') {
      const dishesRes = await fetch(`${FIREBASE_DB_URL}/dishes.json`);
      const dishesData = await dishesRes.json();

      let matchedDish = null;
      let matchedKey = null;

      if (dishesData) {
        for (const key of Object.keys(dishesData)) {
          if (dishesData[key].name.toLowerCase().includes(userText.toLowerCase())) {
            matchedDish = dishesData[key];
            matchedKey = key;
            break;
          }
        }
      }

      if (!matchedDish) {
        await sendTelegram(
          chatId,
          `❌ Sorry, we couldn't find *"${userText}"* on our menu.\n\nPlease type another item (e.g., *Pizza*, *Coffee*) or type /start to restart.`
        );
      } else {
        await fetch(`${FIREBASE_DB_URL}/telegram_sessions/${chatId}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            step: 'awaiting_qty',
            dish: { id: matchedKey, ...matchedDish }
          })
        });

        const caption = `✅ Found: *${matchedDish.name}*\n💰 Price: *Rs. ${matchedDish.price}*\n\nHow many would you like to order? (Reply with a number like *1*, *2*, or *3*)`;
        await sendTelegram(chatId, caption, matchedDish.imageUrl);
      }
      return res.status(200).send("OK");
    }

    // Step 2: Handle Quantity
    if (session.step === 'awaiting_qty') {
      const qty = parseInt(userText);

      if (isNaN(qty) || qty <= 0) {
        await sendTelegram(chatId, "⚠️ Please reply with a valid number for quantity (e.g. *1*, *2*, *3*):");
        return res.status(200).send("OK");
      }

      const subtotal = session.dish.price * qty;

      await fetch(`${FIREBASE_DB_URL}/telegram_sessions/${chatId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'awaiting_address',
          dish: session.dish,
          quantity: qty,
          subtotal: subtotal
        })
      });

      await sendTelegram(
        chatId,
        `🛒 *Summary:*\n${qty}x ${session.dish.name} = Rs. ${subtotal}\nDelivery Fee: Rs. 50\n\nPlease reply with your *Full Delivery Address and Mobile Number* to confirm:`
      );
      return res.status(200).send("OK");
    }

    // Step 3: Write Order Directly into Firebase /orders
    if (session.step === 'awaiting_address') {
      const addressAndContact = userText;
      const totalAmount = (session.subtotal + 50).toFixed(2);

      const newOrder = {
        userId: `tg_${chatId}`,
        userEmail: `telegram_${chatId}@guest.com`,
        phone: addressAndContact,
        address: addressAndContact,
        items: [
          {
            id: session.dish.id,
            name: session.dish.name,
            price: session.dish.price,
            quantity: session.quantity,
            img: session.dish.imageUrl || ""
          }
        ],
        subtotal: session.subtotal.toFixed(2),
        discount: "0.00",
        couponUsed: "None",
        total: totalAmount,
        status: "Placed",
        method: "Cash on Delivery",
        timestamp: new Date().toISOString()
      };

      const orderRes = await fetch(`${FIREBASE_DB_URL}/orders.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newOrder)
      });
      const orderData = await orderRes.json();

      await fetch(`${FIREBASE_DB_URL}/telegram_sessions/${chatId}.json`, { method: 'DELETE' });

      const orderShortId = orderData.name ? orderData.name.substring(1, 7) : "NEW";
      await sendTelegram(
        chatId,
        `🎉 *Order Confirmed!*\nOrder ID: *#${orderShortId}*\n\n💵 Total: *Rs. ${totalAmount}* (Cash on Delivery)\n📍 Deliver To: ${addressAndContact}\n\nOur kitchen is preparing your food! Type /start anytime to order again.`
      );
      return res.status(200).send("OK");
    }

    await sendTelegram(chatId, "Type /start to begin food ordering!");
    return res.status(200).send("OK");

  } catch (error) {
    console.error("Telegram Webhook Error:", error);
    return res.status(200).send("OK");
  }
};
