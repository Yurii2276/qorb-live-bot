const axios = require("axios");

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    console.log("ERROR: TELEGRAM_BOT_TOKEN is missing.");
    console.log("Add TELEGRAM_BOT_TOKEN in Replit Secrets.");
    return;
  }

  if (!chatId) {
    console.log("ERROR: TELEGRAM_CHAT_ID is missing.");
    console.log("");
    console.log("How to get TELEGRAM_CHAT_ID:");
    console.log("1. Open your Telegram bot.");
    console.log("2. Send message: start");
    console.log("3. Open this link in browser:");
    console.log(`https://api.telegram.org/bot${token}/getUpdates`);
    console.log("4. Find chat.id and add it to Replit Secrets as TELEGRAM_CHAT_ID.");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await axios.post(url, {
    chat_id: chatId,
    text: "QORB Telegram test: connection OK.",
  });

  console.log("Telegram test message sent.");
}

main().catch((err) => {
  console.error("Telegram test error:", err.message);
});