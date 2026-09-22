const { Bot, webhookCallback } = require("grammy");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // Твой Telegram ID для заявок

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing in environment variables!");
}

const bot = new Bot(BOT_TOKEN);

// Кэш для хранения временных отметок сообщений и замученных юзеров
const messageHistory = new Map();
const mutedUsers = new Set();

// -------------------------------------------------------------
// 1. КОМАНДА /start И ФОРМА ЗАЯВКИ
// -------------------------------------------------------------
bot.command("start", async (ctx) => {
  await ctx.reply(
    "👋 Привет! Это бот-защитник для личных сообщений в Telegram Business.\n\n" +
      "🛡 **Что он делает?**\n" +
      "Если собеседник отправляет вам больше 5 сообщений за 20 секунд, бот моментально начинает удалять все его последующие сообщения (авто-мут без лишних кликов).\n\n" +
      "💳 **Подключение:** 15 000 сум / месяц.\n\n" +
      "Нажмите кнопку ниже, чтобы подать заявку на подключение:",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📝 Подать заявку", callback_data: "apply" }]
        ]
      }
    }
  );
});

// Обработка кнопки "Подать заявку"
bot.callbackQuery("apply", async (ctx) => {
  await ctx.answerCallbackQuery();
  
  const user = ctx.from;
  const username = user.username ? `@${user.username}` : "отсутствует";
  
  // Уведомление администратору (тебе)
  if (ADMIN_CHAT_ID) {
    await ctx.api.sendMessage(
      ADMIN_CHAT_ID,
      `🚀 **Новая заявка на подписку!**\n\n` +
        `👤 **Имя:** \({user.first_name}\){user.last_name || ""}\n` +
        `🔗 **Username:** ${username}\n` +
        `🆔 **ID:** \`${user.id}\``,
      { parse_mode: "Markdown" }
    );
  }

  await ctx.reply("✅ Ваша заявка принята! Заявка передана администратору, скоро с вами свяжутся для активации.");
});

// -------------------------------------------------------------
// 2. АВТО-МУТ СПАМЕРОВ В TELEGRAM BUSINESS
// -------------------------------------------------------------
bot.on("business_message", async (ctx) => {
  const msg = ctx.update.business_message;
  const connId = msg.business_connection_id;
  const senderId = msg.from.id;
  const now = Date.now();

  // Игнорируем свои собственные сообщения
  if (senderId === ctx.me.id) return;

  // Если отправитель уже в авто-муте — удаляем сообщение
  if (mutedUsers.has(senderId)) {
    try {
      await ctx.api.deleteBusinessMessage(connId, msg.chat.id, msg.message_id);
    } catch (e) {
      console.error("Ошибка удаления сообщения замученного пользователя:", e);
    }
    return;
  }

  // Считаем количество сообщений от этого пользователя за последние 20 секунд
  let timestamps = messageHistory.get(senderId) || [];
  timestamps = timestamps.filter((t) => now - t <= 20000); // 20000 мс = 20 секунд
  timestamps.push(now);
  messageHistory.set(senderId, timestamps);

  // ПРОВЕРКА: Если отправлено больше 5 сообщений за 20 секунд
  if (timestamps.length > 5) {
    mutedUsers.add(senderId); // Отправляем в мут

    try {
      // Удаляем сообщение, которое превысило лимит (6-е)
      await ctx.api.deleteBusinessMessage(connId, msg.chat.id, msg.message_id);
    } catch (e) {
      console.error("Ошибка при авто-муте:", e);
    }
  }
});

// Экспорт вебхука для Vercel Serverless
module.exports = webhookCallback(bot, "http");
