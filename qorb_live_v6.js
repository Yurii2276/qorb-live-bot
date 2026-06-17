const YahooFinance = require("yahoo-finance2").default;
const axios = require("axios");
const fs = require("fs");

const yahooFinance = new YahooFinance();

const CONFIG = {
  checkIntervalMinutes: Number(process.env.CHECK_INTERVAL_MINUTES || 60),

  strategy: {
    name: "ETH_DXY_DOWN_GOLD_UP_2D",
    asset: "ETH-USDT",
    holdDays: 2,

    dxySymbol: "DX-Y.NYB",
    goldSymbol: "GC=F",

    dxyDownThreshold: -0.3,
    goldUpThreshold: 0.7,
  },

  files: {
    state: "qorb_live_state.json",
    history: "qorb_live_history.csv",
    trades: "qorb_paper_trades.csv",
  },
};

function nowIso() {
  return new Date().toISOString();
}

function toDateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function addDays(dateKey, days) {
  const d = new Date(dateKey + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function pctChange(from, to) {
  if (!from || !to) return null;
  return ((to - from) / from) * 100;
}

function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return value.toFixed(2) + "%";
}

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return Number(value).toFixed(4);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function appendCsv(file, headers, row) {
  const exists = fs.existsSync(file);

  if (!exists) {
    fs.writeFileSync(file, headers.map(csvEscape).join(",") + "\n");
  }

  fs.appendFileSync(file, row.map(csvEscape).join(",") + "\n");
}

function loadState() {
  if (!fs.existsSync(CONFIG.files.state)) {
    return {
      openPosition: null,
      lastSignalAlertKey: null,
      lastCloseAlertKey: null,
    };
  }

  try {
    return JSON.parse(fs.readFileSync(CONFIG.files.state, "utf8"));
  } catch {
    return {
      openPosition: null,
      lastSignalAlertKey: null,
      lastCloseAlertKey: null,
    };
  }
}

function saveState(state) {
  fs.writeFileSync(CONFIG.files.state, JSON.stringify(state, null, 2));
}

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log("Telegram not configured. Message not sent.");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await axios.post(
    url,
    {
      chat_id: chatId,
      text: message,
    },
    {
      timeout: 15000,
    }
  );
}

async function fetchYahooDaily(symbol, lookbackDays = 30) {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - lookbackDays * 2);

  const result = await yahooFinance.chart(symbol, {
    period1: start.toISOString().slice(0, 10),
    period2: end.toISOString().slice(0, 10),
    interval: "1d",
  });

  return result.quotes
    .filter((q) => q.close && q.date)
    .map((q) => ({
      date: toDateKey(q.date),
      close: Number(q.close),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchOkxLastPrice(instId) {
  const response = await axios.get("https://www.okx.com/api/v5/market/ticker", {
    params: { instId },
    timeout: 15000,
  });

  if (!response.data || response.data.code !== "0") {
    throw new Error(JSON.stringify(response.data));
  }

  const item = response.data.data[0];

  return {
    instId,
    last: Number(item.last),
    ts: Number(item.ts),
  };
}

function getLastCompletedDailyReturn(rows) {
  if (!rows || rows.length < 2) {
    return null;
  }

  const prev = rows[rows.length - 2];
  const last = rows[rows.length - 1];

  return {
    date: last.date,
    prevClose: prev.close,
    close: last.close,
    returnPct: pctChange(prev.close, last.close),
  };
}

function buildSignal({ dxyReturn, goldReturn, ethPrice }) {
  const s = CONFIG.strategy;

  const dxyPass = dxyReturn.returnPct <= s.dxyDownThreshold;
  const goldPass = goldReturn.returnPct >= s.goldUpThreshold;

  const active = dxyPass && goldPass;

  let status = "NO_SIGNAL";

  if (active) {
    status = "ACTIVE";
  } else if (dxyPass || goldPass) {
    status = "NEAR";
  }

  return {
    strategy: s.name,
    asset: s.asset,
    status,
    active,
    action: active ? "BUY_PAPER_ETH" : "WAIT",
    signalDate: dxyReturn.date,
    price: ethPrice.last,
    holdDays: s.holdDays,
    plannedExitDate: active ? addDays(toDateKey(Date.now()), s.holdDays) : null,

    dxyReturnPct: dxyReturn.returnPct,
    goldReturnPct: goldReturn.returnPct,
    dxyPass,
    goldPass,
  };
}

function printSignal(signal) {
  console.log("========================================");
  console.log("QORB LIVE MACRO BOT v6");
  console.log("========================================");
  console.log(`Time: ${nowIso()}`);
  console.log(`Strategy: ${signal.strategy}`);
  console.log(`Asset: ${signal.asset}`);
  console.log(`Status: ${signal.status}`);
  console.log(`Action: ${signal.action}`);
  console.log(`ETH price: ${formatPrice(signal.price)}`);
  console.log(`Signal date: ${signal.signalDate}`);
  console.log("");
  console.log(`DXY: ${formatPct(signal.dxyReturnPct)} | rule <= ${CONFIG.strategy.dxyDownThreshold}% | ${signal.dxyPass ? "PASS" : "FAIL"}`);
  console.log(`Gold: ${formatPct(signal.goldReturnPct)} | rule >= ${CONFIG.strategy.goldUpThreshold}% | ${signal.goldPass ? "PASS" : "FAIL"}`);
  console.log("");
  console.log(`Planned exit: ${signal.plannedExitDate || "N/A"}`);
}

function openPaperPositionIfNeeded(state, signal) {
  if (!signal.active) {
    return null;
  }

  if (state.openPosition) {
    return null;
  }

  const entryDate = toDateKey(Date.now());
  const exitDate = addDays(entryDate, signal.holdDays);

  const position = {
    id: `${signal.strategy}_${entryDate}_${Date.now()}`,
    strategy: signal.strategy,
    asset: signal.asset,
    entryDate,
    exitDate,
    entryPrice: signal.price,
    status: "OPEN",
    openedAt: nowIso(),
    reason: `DXY=${formatPct(signal.dxyReturnPct)}, Gold=${formatPct(signal.goldReturnPct)}`,
  };

  state.openPosition = position;

  return position;
}

function closePaperPositionIfNeeded(state, ethPrice) {
  const pos = state.openPosition;

  if (!pos) {
    return null;
  }

  const today = toDateKey(Date.now());

  if (today < pos.exitDate) {
    return null;
  }

  const exitPrice = ethPrice.last;
  const grossReturnPct = pctChange(pos.entryPrice, exitPrice);
  const netReturnPct = grossReturnPct - 0.2;

  const closed = {
    ...pos,
    exitPrice,
    grossReturnPct,
    netReturnPct,
    closedAt: nowIso(),
    status: "CLOSED",
  };

  appendCsv(
    CONFIG.files.trades,
    [
      "id",
      "strategy",
      "asset",
      "entryDate",
      "exitDate",
      "entryPrice",
      "exitPrice",
      "grossReturnPct",
      "netReturnPct",
      "openedAt",
      "closedAt",
      "reason",
    ],
    [
      closed.id,
      closed.strategy,
      closed.asset,
      closed.entryDate,
      closed.exitDate,
      closed.entryPrice,
      closed.exitPrice,
      closed.grossReturnPct.toFixed(3),
      closed.netReturnPct.toFixed(3),
      closed.openedAt,
      closed.closedAt,
      closed.reason,
    ]
  );

  state.openPosition = null;

  return closed;
}

function logHistory(signal) {
  appendCsv(
    CONFIG.files.history,
    [
      "timestamp",
      "strategy",
      "status",
      "action",
      "ethPrice",
      "dxyReturnPct",
      "goldReturnPct",
      "dxyPass",
      "goldPass",
      "openPosition",
    ],
    [
      nowIso(),
      signal.strategy,
      signal.status,
      signal.action,
      signal.price,
      signal.dxyReturnPct.toFixed(3),
      signal.goldReturnPct.toFixed(3),
      signal.dxyPass,
      signal.goldPass,
      signal.active,
    ]
  );
}

function buildStatusMessage(signal, state) {
  const lines = [
    "QORB STATUS",
    "Strategy: " + signal.strategy,
    "Asset: " + signal.asset,
    "Status: " + signal.status,
    "Action: " + signal.action,
    "ETH price: " + formatPrice(signal.price),
    "DXY: " + formatPct(signal.dxyReturnPct) + " " + (signal.dxyPass ? "PASS" : "FAIL"),
    "Gold: " + formatPct(signal.goldReturnPct) + " " + (signal.goldPass ? "PASS" : "FAIL")
  ];

  if (state.openPosition) {
    lines.push("Open position: YES");
    lines.push("Entry: " + formatPrice(state.openPosition.entryPrice));
    lines.push("Exit date: " + state.openPosition.exitDate);
  } else {
    lines.push("Open position: NO");
  }

  return lines.join("\n");
}
function buildOpenMessage(position, signal) {
  return [
    "QORB ETH SIGNAL",
    `Action: PAPER BUY`,
    `Asset: ${position.asset}`,
    `Entry: ${formatPrice(position.entryPrice)}`,
    `Exit date: ${position.exitDate}`,
    `DXY: ${formatPct(signal.dxyReturnPct)}`,
    `Gold: ${formatPct(signal.goldReturnPct)}`,
  ].join("\n");
}

function buildCloseMessage(closed) {
  return [
    "QORB ETH PAPER CLOSED",
    `Asset: ${closed.asset}`,
    `Entry: ${formatPrice(closed.entryPrice)}`,
    `Exit: ${formatPrice(closed.exitPrice)}`,
    `Net: ${formatPct(closed.netReturnPct)}`,
  ].join("\n");
}

async function runOnce() {
  const state = loadState();

  const dxyRows = await fetchYahooDaily(CONFIG.strategy.dxySymbol);
  const goldRows = await fetchYahooDaily(CONFIG.strategy.goldSymbol);
  const ethPrice = await fetchOkxLastPrice(CONFIG.strategy.asset);

  const dxyReturn = getLastCompletedDailyReturn(dxyRows);
  const goldReturn = getLastCompletedDailyReturn(goldRows);

  if (!dxyReturn || !goldReturn) {
    throw new Error("Not enough Yahoo daily data.");
  }

  const signal = buildSignal({
    dxyReturn,
    goldReturn,
    ethPrice,
  });

  printSignal(signal);

  const closed = closePaperPositionIfNeeded(state, ethPrice);

  if (closed) {
    const closeKey = `${closed.id}_${closed.closedAt}`;

    if (state.lastCloseAlertKey !== closeKey) {
      const message = buildCloseMessage(closed);
      await sendTelegram(message);
      state.lastCloseAlertKey = closeKey;
      console.log("Telegram close message sent.");
    }
  }

  const opened = openPaperPositionIfNeeded(state, signal);

  if (opened) {
    const alertKey = `${opened.id}`;

    if (state.lastSignalAlertKey !== alertKey) {
      const message = buildOpenMessage(opened, signal);
      await sendTelegram(message);
      state.lastSignalAlertKey = alertKey;
      console.log("Telegram open message sent.");
    }
  }

  if (state.openPosition) {
    console.log("========================================");
    console.log("OPEN PAPER POSITION");
    console.log("----------------------------------------");
    console.log(`Asset: ${state.openPosition.asset}`);
    console.log(`Entry date: ${state.openPosition.entryDate}`);
    console.log(`Exit date: ${state.openPosition.exitDate}`);
    console.log(`Entry price: ${formatPrice(state.openPosition.entryPrice)}`);
    console.log(`Reason: ${state.openPosition.reason}`);
  } else {
    console.log("========================================");
    console.log("No open paper position.");
  }

  if (process.env.SEND_STATUS_TELEGRAM === "1") {
    const statusKey = signal.signalDate + "_" + signal.status;
    if (state.lastStatusAlertKey !== statusKey) {
      const message = buildStatusMessage(signal, state);
      await sendTelegram(message);
      state.lastStatusAlertKey = statusKey;
      console.log("Telegram status message sent.");
    }
  }

  logHistory(signal);
  saveState(state);

  console.log("========================================");
  console.log("Files updated:");
  console.log(CONFIG.files.state);
  console.log(CONFIG.files.history);
  console.log(CONFIG.files.trades);
}

async function loop() {
  await runOnce();

  const intervalMs = CONFIG.checkIntervalMinutes * 60 * 1000;

  setInterval(async () => {
    try {
      await runOnce();
    } catch (err) {
      console.log("Loop error:", err.message);

      try {
        await sendTelegram(`QORB LIVE BOT ERROR\n${err.message}`);
      } catch {}
    }
  }, intervalMs);
}

loop().catch(async (err) => {
  console.error("Fatal error:", err.message);

  try {
    await sendTelegram(`QORB LIVE BOT FATAL ERROR\n${err.message}`);
  } catch {}
});