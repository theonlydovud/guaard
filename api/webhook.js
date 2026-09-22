const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not configured");
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// MVP storage.
// Важно: Vercel serverless не гарантирует постоянную память.
// Для первого теста этого достаточно.
const mutedChats = globalThis.mutedChats || new Set();
globalThis.mutedChats = mutedChats;

const connections = globalThis.connections || new Map();
globalThis.connections = connections;

async function telegram(method, body) {
  const response = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!data.ok) {
    console.error(`Telegram API error (${method}):`, data);
  }

  return data;
}

async function sendMessage(chatId, text, businessConnectionId = null) {
  const body = {
    chat_id: chatId,
    text,
  };

  if (businessConnectionId) {
    body.business_connection_id = businessConnectionId;
  }

  return telegram("sendMessage", body);
}

async function deleteBusinessMessage(
  businessConnectionId,
  chatId,
  messageId
) {
  return telegram("deleteBusinessMessages", {
    business_connection_id: businessConnectionId,
    chat_id: chatId,
    message_ids: [messageId],
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      message: "Anti-Spam Business Bot is running.",
    });
  }

  try {
    const update = req.body;

    console.log("Telegram update:", JSON.stringify(update));

    // =========================================================
    // 1. BUSINESS CONNECTION
    // =========================================================

    if (update.business_connection) {
      const connection = update.business_connection;

      if (connection.is_enabled) {
        connections.set(connection.id, {
          userId: connection.user.id,
          rights: connection.rights || {},
        });

        console.log(
          `Business connection enabled: ${connection.id}`
        );
      } else {
        connections.delete(connection.id);

        console.log(
          `Business connection disabled: ${connection.id}`
        );
      }

      return res.status(200).json({ ok: true });
    }

    // =========================================================
    // 2. NORMAL /START
    // =========================================================

    if (update.message) {
      const message = update.message;

      if (
        message.text &&
        message.text.trim().toLowerCase().startsWith("/start")
      ) {
        await sendMessage(
          message.chat.id,
          `🤖 Anti-Spam Bot работает!\n\n` +
            `Подключи меня к своему Telegram Business аккаунту, ` +
            `и я смогу автоматически обрабатывать твои личные чаты.\n\n` +
            `Команды в личном чате:\n` +
            `.mute — замьютить этот чат\n` +
            `.unmute — снять мут`
        );
      }

      return res.status(200).json({ ok: true });
    }

    // =========================================================
    // 3. BUSINESS MESSAGE
    // =========================================================

    if (update.business_message) {
      const message = update.business_message;

      const connectionId = message.business_connection_id;
      const chatId = message.chat.id;
      const messageId = message.message_id;
      const text = message.text?.trim();

      if (!connectionId) {
        return res.status(200).json({ ok: true });
      }

      const connection = connections.get(connectionId);

      // -------------------------------------------------------
      // Игнорируем сообщения, отправленные самим подключённым
      // ботом от имени аккаунта.
      // -------------------------------------------------------

      if (message.sender_business_bot) {
        return res.status(200).json({ ok: true });
      }

      // -------------------------------------------------------
      // Если это сообщение отправил владелец аккаунта,
      // обрабатываем команды.
      // -------------------------------------------------------

      const isOwner =
        connection &&
        message.from &&
        message.from.id === connection.userId;

      if (isOwner && text) {
        // =========================
        // .mute
        // =========================

        if (text === ".mute") {
          mutedChats.add(String(chatId));

          await sendMessage(
            chatId,
            "🔇 Пользователь замьючен.\n\n" +
              "Все новые сообщения из этого чата будут автоматически удаляться.",
            connectionId
          );

          // Удаляем саму команду .mute
          await deleteBusinessMessage(
            connectionId,
            chatId,
            messageId
          );

          return res.status(200).json({ ok: true });
        }

        // =========================
        // .unmute
        // =========================

        if (text === ".unmute") {
          mutedChats.delete(String(chatId));

          await sendMessage(
            chatId,
            "🔊 Мут снят.\n\n" +
              "Новые сообщения снова будут отображаться.",
            connectionId
          );

          // Удаляем саму команду .unmute
          await deleteBusinessMessage(
            connectionId,
            chatId,
            messageId
          );

          return res.status(200).json({ ok: true });
        }

        // =========================
        // .status
        // =========================

        if (text === ".status") {
          const muted = mutedChats.has(String(chatId));

          await sendMessage(
            chatId,
            muted
              ? "🔇 Этот чат сейчас замьючен."
              : "🔊 Этот чат сейчас не замьючен.",
            connectionId
          );

          await deleteBusinessMessage(
            connectionId,
            chatId,
            messageId
          );

          return res.status(200).json({ ok: true });
        }
      }

      // -------------------------------------------------------
      // АНТИСПАМ
      //
      // Если чат замьючен и сообщение пришло НЕ от владельца,
      // удаляем его.
      // -------------------------------------------------------

      if (
        mutedChats.has(String(chatId)) &&
        !isOwner
      ) {
        console.log(
          `Deleting message ${messageId} from muted chat ${chatId}`
        );

        await deleteBusinessMessage(
          connectionId,
          chatId,
          messageId
        );

        return res.status(200).json({ ok: true });
      }

      return res.status(200).json({ ok: true });
    }

    // =========================================================
    // 4. UNKNOWN UPDATE
    // =========================================================

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);

    // Telegram должен получить 200, чтобы не создавать
    // бесконечные повторные доставки из-за нашей ошибки.
    return res.status(200).json({
      ok: false,
      error: "Internal error",
    });
  }
}
