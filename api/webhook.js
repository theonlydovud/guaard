const { Bot, webhookCallback } = require("grammy");

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Bot(BOT_TOKEN);

// Временный кэш в рамках одного инстанса Vercel
const mutedUsers = new Set();
const messageHistory = new Map();

bot.on("business_message", async (ctx) => {
  const msg = ctx.update.business_message;
  const connId = msg.business_connection_id;
  const senderId = msg.from.id;
  const text = msg.text || "";

  // 1. РУЧНОЙ МУТИ / АНМУТ (когда ты пишешь .mute или .unmute в ответ на сообщение)
  if (senderId === ctx.me.id) {
    if (text.startsWith(".mute") && msg.reply_to_message) {
      const targetId = msg.reply_to_message.from.id;
      mutedUsers.add(targetId);
      
      // Удаляем твою команду .mute из чата
      await ctx.api.deleteBusinessMessage(connId, msg.chat.id, msg.message_id);
      return;
    }

    if (text.startsWith(".unmute") && msg.reply_to_message) {
      const targetId = msg.reply_to_message.from.id;
      mutedUsers.delete(targetId);
      
      await ctx.api.deleteBusinessMessage(connId, msg.chat.id, msg.message_id);
      return;
    }
    return;
  }

  // 2. ЕСЛИ ЮЗЕР УЖЕ В МУТЕ — МОМЕНТАЛЬНО УДАЛЯЕМ
  if (mutedUsers.has(senderId)) {
    try {
      await ctx.api.deleteBusinessMessage(connId, msg.chat.id, msg.message_id);
    } catch (e) {
      console.error("Ошибка удаления:", e);
    }
    return;
  }

  // 3. АВТО-МУТ ЗА СПАМ (>5 сообщений за 20 секунд)
  const now = Date.now();
  let timestamps = messageHistory.get(senderId) || [];
  timestamps = timestamps.filter((t) => now - t <= 20000); // Сообщения за последние 20 сек
  timestamps.push(now);
  messageHistory.set(senderId, timestamps);

  if (timestamps.length > 5) {
    mutedUsers.add(senderId); // Кидаем в мут
    try {
      await ctx.api.deleteBusinessMessage(connId, msg.chat.id, msg.message_id);
    } catch (e) {
      console.error("Ошибка авто-мута:", e);
    }
  }
});

module.exports = webhookCallback(bot, "http");
