const { Bot, webhookCallback } = require("grammy");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing!");
}

const bot = new Bot(BOT_TOKEN);

// Используем глобальный объект process для сохранения состояния между запросами в одном инстансе Vercel
if (!global.mutedChats) global.mutedChats = new Set();
if (!global.messageHistory) global.messageHistory = new Map();

bot.on("business_message", async (ctx) => {
  const msg = ctx.update.business_message;
  const connId = msg.business_connection_id;
  const chatId = msg.chat.id; // ID текущего чата/собеседника
  const senderId = msg.from.id;
  const text = (msg.text || "").trim();

  // --------------------------------------------------------
  // 1. КОМАНДЫ ВЛАДЕЛЬЦА (когда пишешь ТЫ)
  // --------------------------------------------------------
  if (senderId === ctx.me.id) {
    if (text === ".mute") {
      // Мутим этот конкретный чат
      global.mutedChats.add(chatId);

      // Удаляем твою команду .mute из чата
      try {
        await ctx.api.deleteBusinessMessage(connId, chatId, msg.message_id);
      } catch (e) {
        console.error("Ошибка удаления .mute:", e);
      }
      return;
    }

    if (text === ".unmute") {
      global.mutedChats.delete(chatId);

      try {
        await ctx.api.deleteBusinessMessage(connId, chatId, msg.message_id);
      } catch (e) {
        console.error("Ошибка удаления .unmute:", e);
      }
      return;
    }

    return; // Твои обычные сообщения не проверяем
  }

  // --------------------------------------------------------
  // 2. ПРОВЕРКА МУТА (Сообщения СОБЕСЕДНИКА)
  // --------------------------------------------------------

  // Если чат замучен — мгновенно удаляем входящее сообщение
  if (global.mutedChats.has(chatId)) {
    try {
      await ctx.api.deleteBusinessMessage(connId, chatId, msg.message_id);
    } catch (e) {
      console.error("Не удалось удалить сообщение собеседника:", e);
    }
    return;
  }

  // 3. АВТО-МУТ ЗА СПАМ (>5 сообщений за 20 секунд)
  const now = Date.now();
  let timestamps = global.messageHistory.get(chatId) || [];
  timestamps = timestamps.filter((t) => now - t <= 20000);
  timestamps.push(now);
  global.messageHistory.set(chatId, timestamps);

  if (timestamps.length > 5) {
    global.mutedChats.add(chatId); // Авто-мут чата

    try {
      await ctx.api.deleteBusinessMessage(connId, chatId, msg.message_id);
    } catch (e) {
      console.error("Ошибка при авто-удалении 6-го сообщения:", e);
    }
  }
});

module.exports = webhookCallback(bot, "http");
