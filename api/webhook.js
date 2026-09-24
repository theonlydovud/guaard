import "dotenv/config";
import { Redis } from "@upstash/redis";

const TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!TOKEN) {
  throw new Error("BOT_TOKEN не найден");
}

if (!WEBHOOK_SECRET) {
  throw new Error("WEBHOOK_SECRET не найден");
}

// ========================================
// REDIS
// ========================================

const redis = Redis.fromEnv();

const MUTE_KEY_PREFIX = "muted:";

// ========================================
// TELEGRAM API
// ========================================

async function telegram(method, body = {}) {
  const response = await fetch(
    `https://api.telegram.org/bot${TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const result = await response.json();

  if (!result.ok) {
    throw new Error(
      `${method}: ${result.description || "Telegram API error"}`
    );
  }

  return result.result;
}

// ========================================
// BUSINESS MESSAGE
// ========================================

async function sendBusinessMessage(message, text, extra = {}) {
  return await telegram("sendMessage", {
    business_connection_id: message.business_connection_id,
    chat_id: message.chat.id,
    text,
    parse_mode: "HTML",
    ...extra
  });
}

// ========================================
// DELETE MESSAGE
// ========================================

async function deleteBusinessMessage(message) {
  try {
    await telegram("deleteBusinessMessages", {
      business_connection_id: message.business_connection_id,
      message_ids: [message.message_id]
    });

    console.log(
      `🗑 Deleted ${message.message_id} | Chat ${message.chat.id}`
    );

    return true;
  } catch (error) {
    console.error(
      `❌ Delete failed ${message.message_id}:`,
      error.message
    );

    return false;
  }
}

// ========================================
// MUTE STATE
// ========================================

function muteKey(chatId) {
  return `${MUTE_KEY_PREFIX}${chatId}`;
}

async function isMuted(chatId) {
  return await redis.exists(muteKey(chatId));
}

async function setMuted(chatId) {
  await redis.set(muteKey(chatId), "1");
}

async function setUnmuted(chatId) {
  await redis.del(muteKey(chatId));
}

// ========================================
// MUTE
// ========================================

async function muteChat(message) {
  const chatId = message.chat.id;

  await setMuted(chatId);

  console.log("");
  console.log("🔇 MUTE");
  console.log(`Chat ID: ${chatId}`);
  console.log(
    `Username: @${message.chat.username || "нет"}`
  );

  await sendBusinessMessage(
    message,
    `<b>🔇 Пользователь был замучен</b>\n\n` +
    `Теперь его сообщения будут автоматически удаляться.`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🔊 Размутиться",
              style: "success",
              callback_data: "mute_joke"
            }
          ]
        ]
      }
    }
  );
}

// ========================================
// UNMUTE
// ========================================

async function unmuteChat(message) {
  const chatId = message.chat.id;

  await setUnmuted(chatId);

  console.log("");
  console.log("🔊 UNMUTE");
  console.log(`Chat ID: ${chatId}`);
  console.log(
    `Username: @${message.chat.username || "нет"}`
  );

  await sendBusinessMessage(
    message,
    `<b>🔊 Пользователь размучен</b>\n\n` +
    `Теперь его сообщения снова будут отображаться.`
  );
}

// ========================================
// CALLBACK BUTTON
// ========================================

async function handleCallbackQuery(callbackQuery) {
  if (callbackQuery.data !== "mute_joke") {
    return;
  }

  console.log("😈 Нажата кнопка «Размутиться»");

  try {
    await telegram("answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
      text:
        "Ну всё бро, ты замучен 😎\n" +
        "С ним самим общайся терь ))))",
      show_alert: true
    });
  } catch (error) {
    console.error(
      "❌ Callback error:",
      error.message
    );
  }
}

// ========================================
// BUSINESS MESSAGE
// ========================================

async function handleBusinessMessage(message) {
  const chatId = message.chat.id;
  const username = message.from?.username;
  const text = message.text?.trim();

  console.log("");
  console.log("========== MESSAGE ==========");
  console.log(`Chat ID: ${chatId}`);
  console.log(`Username: @${username || "нет"}`);
  console.log(`Message ID: ${message.message_id}`);
  console.log(`Text: ${text || "[без текста]"}`);
  console.log("=============================");

  // .mute
  if (text?.toLowerCase() === ".mute") {
    await muteChat(message);
    return;
  }

  // .unmute
  if (text?.toLowerCase() === ".unmute") {
    await unmuteChat(message);
    return;
  }

  // MUTE CHECK
  if (await isMuted(chatId)) {
    console.log("🚫 USER MUTED");
    console.log(
      `⚡ Удаляем ${message.message_id}`
    );

    // Не блокируем другие сообщения
    await deleteBusinessMessage(message);

    return;
  }

  console.log("➡️ Message allowed");
}

// ========================================
// UPDATE
// ========================================

async function handleUpdate(update) {
  try {
    if (update.business_message) {
      await handleBusinessMessage(
        update.business_message
      );
    }

    if (update.callback_query) {
      await handleCallbackQuery(
        update.callback_query
      );
    }
  } catch (error) {
    console.error(
      "❌ Update error:",
      error.message
    );
  }
}

// ========================================
// VERCEL WEBHOOK
// ========================================

export default async function handler(req, res) {
  // Только POST
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      message: "Telegram Business Anti-Spam"
    });
  }

  // ======================================
  // WEBHOOK SECURITY
  // ======================================

  const incomingSecret =
    req.headers["x-telegram-bot-api-secret-token"];

  if (incomingSecret !== WEBHOOK_SECRET) {
    console.log("❌ Invalid webhook secret");

    return res.status(403).json({
      ok: false
    });
  }

  // ======================================
  // TELEGRAM UPDATE
  // ======================================

  const update = req.body;

  console.log(
    "📩 Telegram update:",
    update.update_id
  );

  // ======================================
  // НЕ ЖДЕМ ВСЮ ОБРАБОТКУ
  // ======================================

  await handleUpdate(update);

  // Telegram получает 200
  return res.status(200).json({
    ok: true
  });
}
