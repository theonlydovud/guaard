const { Bot, webhookCallback } = require("grammy");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing!");
}

const bot = new Bot(BOT_TOKEN);

// Глобальные переменные в рамках горячего контейнера Vercel
if (!global.mutedChats) global.mutedChats = new Set();
if (!global.messageHistory) global.messageHistory = new Map();

// --------------------------------------------------------
// 1. КОМАНДА /start В ЛС БОТА
// --------------------------------------------------------
bot.command("start", async (ctx) => {
  await ctx.reply(
    "🛡 **Guaard Bot запущен!**\n\n" +
      "Я работаю в режиме Telegram Business.\n\n" +
      "📌 **Как использовать в чатах:**\n" +
      "• Напиши `.mute` в любом чате — входящие сообщения собеседника будут моментально удаляться.\n" +
      "• Напиши `.unmute` — чтобы снять мут.\n" +
      "• Если собеседник пришлёт больше 5 сообщений за 20 секунд — он автоматически уйдёт в мут."
  );
});

// --------------------------------------------------------
// 2. TELEGRAM BUSINESS MESSAGES (Личные чаты)
// --------------------------------------------------------
bot.on("business_message", async (ctx) => {
  const msg = ctx.update.business_message;
  const connId = msg.business_connection_id; // Важно для Business API
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
  const text = (msg.text || "").trim();

  // --------------------------------------------------------
  // А) Ты пишешь команды управления (.mute / .unmute)
  // --------------------------------------------------------
  if (senderId === ctx.me.id) {
    if (text === ".mute") {
      global.mutedChats.add(chatId);

      // Удаляем само сообщение .mute
      try {
        await ctx.api.deleteMessage(chatId, msg.message_id, {
          business_connection_id: connId,
        });
      } catch (e) {
        console.error("Ошибка удаления .mute:", e);
      }
      return;
    }

    if (text === ".unmute") {
      global.mutedChats.delete(chatId);

      try {
        await ctx.api.deleteMessage(chatId, msg.message_id, {
          business_connection_id: connId,
        });
      } catch (e) {
        console.error("Ошибка удаления .unmute:", e);
      }
      return;
    }

    return; // Твои обычные сообщения не проверяем
  }

  // --------------------------------------------------------
  // Б) Проверка: замучен ли этот чат
  // --------------------------------------------------------
  if (global.mutedChats.has(chatId)) {
    try {
      await ctx.api.deleteMessage(chatId, msg.message_id, {
        business_connection_id: connId,
      });
    } catch (e) {
      console.error("Не удалось удалить сообщение собеседника:", e);
    }
    return;
  }

  // --------------------------------------------------------
  // В) Авто-мут за спам (>5 сообщений за 20 секунд)
  // --------------------------------------------------------
  const now = Date.now();
  let timestamps = global.messageHistory.get(chatId) || [];
  timestamps = timestamps.filter((t) => now - t <= 20000);
  timestamps.push(now);
  global.messageHistory.set(chatId, timestamps);

  if (timestamps.length > 5) {
    global.mutedChats.add(chatId); // Мутим чат

    try {
      await ctx.api.deleteMessage(chatId, msg.message_id, {
        business_connection_id: connId,
      });
    } catch (e) {
      console.error("Ошибка при авто-удалении 6-го сообщения:", e);
    }
  }
});

module.exports = webhookCallback(bot, "http");
