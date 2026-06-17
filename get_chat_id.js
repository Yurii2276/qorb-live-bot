const axios = require("axios");

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.log("ERROR: TELEGRAM_BOT_TOKEN is missing.");
    return;
  }

  const baseUrl = `https://api.telegram.org/bot${token}`;

  const me = await axios.get(`${baseUrl}/getMe`);
  console.log("CONNECTED BOT:");
  console.log("@" + me.data.result.username);
  console.log("");

  await axios.get(`${baseUrl}/deleteWebhook`);

  const response = await axios.get(`${baseUrl}/getUpdates`);
  const updates = response.data.result;

  if (!updates || updates.length === 0) {
    console.log("No messages found.");
    console.log("Open Telegram, find this bot:");
    console.log("@" + me.data.result.username);
    console.log("Send message: hello");
    console.log("Then run again: node get_chat_id.js");
    return;
  }

  const last = updates[updates.length - 1];

  if (!last.message || !last.message.chat) {
    console.log("Message found, but chat id not found.");
    console.log(JSON.stringify(last, null, 2));
    return;
  }

  console.log("YOUR TELEGRAM_CHAT_ID:");
  console.log(last.message.chat.id);
}

main().catch((err) => {
  console.log("ERROR:");
  if (err.response) {
    console.log(JSON.stringify(err.response.data, null, 2));
  } else {
    console.log(err.message);
  }
});
