const crypto = require('crypto');
const WebSocket = require('ws');


/* 
Triangular Arbitrage
  Scenarios:
  AUD/ETH x ETH/BTC x BTC/AUD = 1
  No inherent arbitrage opportunity.

  AUD/ETH x ETH/BTC x BTC/AUD < 1
  Sell AUD & buy ETH, sell ETH & buy BTC, sell BTC & buy AUD

  AUD/ETH x ETH/BTC x BTC/AUD > 1
  Sell AUD & buy BTC, sell BTC & buy ETH, sell ETH & buy AUD
  */

const baseUrl = 'wss://socket.btcmarkets.net/v2';
const channels = ['tick', 'heartbeat'];
const marketIds = ['BTC-AUD', 'ETH-AUD', 'ETH-BTC'];

const ws = new WebSocket(baseUrl);

let request = {
  marketIds: marketIds,
  channels: channels,
  messageType: 'subscribe'
}

let bidsETHAUD = null;
let bidsETHBTC = null;
let bidsBTCAUD = null;
let asksETHAUD = null;
let asksETHBTC = null;
let asksBTCAUD = null;
let tradingAmount = 1000;

ws.on('open', function open() {
  ws.send(JSON.stringify(request));
});

ws.on('message', function incoming(data) {
  jsonData = JSON.parse(data)
  switch (jsonData["messageType"]) {
    case "heartbeat":
      break;
    case "tick":
      processTick(jsonData);
      break;
    default:
      let code = jsonData["code"]
      let msg = jsonData["message"]
      console.error(`ERROR!! ${code} --- ${msg}`);
      ws.terminate()
  }
});

ws.on('close', function close() {
  console.log('socket closed');
});

ws.on('error', function error(err) {
  console.error('error with websocket ', err);
});

function processTick(data) {
  let marketId = data["marketId"];
  let bestBid = parseFloat(data["bestBid"]);
  let bestAsk = parseFloat(data["bestAsk"]);
  let lastPrice = parseFloat(data["lastPrice"]);

  if (marketId === "ETH-AUD") {
    bidsETHAUD = bestBid;
    asksETHAUD = bestAsk;
  }
  if (marketId === "ETH-BTC") {
    bidsETHBTC = bestBid;
    asksETHBTC = bestAsk;
  }
  if (marketId === "BTC-AUD") {
    bidsBTCAUD = bestBid;
    asksBTCAUD = bestAsk;
  }

  if (asksETHAUD != null && bidsETHBTC != null && bidsBTCAUD != null) {
    calculateArbitrageOpportunity();
  } else {
    console.log("Insufficient data");
  }
}

// (Case 1) Arbitrage opportunity when trading at available prices (most likely will result in taker fees)
// (Case 2) Arbitrage opportunity when stating ones' own prices (most likely result in maker discounts)
function calculateArbitrageOpportunity() {
  if ((asksETHAUD / bidsETHBTC / bidsBTCAUD) < 1) {
    process.stdout.write(`Taker | AUD --> ETH, ETH --> BTC, BTC --> AUD`);
    getArbitrage(asksETHAUD, bidsETHBTC, bidsBTCAUD, tradingAmount);
  } else {
    process.stdout.write(`Maker | AUD --> BTC, BTC --> ETH, ETH --> AUD`);
    getArbitrage(bidsBTCAUD, bidsETHBTC, asksETHAUD, tradingAmount, true);
  }
  if ((asksBTCAUD * asksETHBTC / bidsETHAUD) < 1) {
    process.stdout.write(`Taker | AUD --> BTC, BTC --> ETH, ETH --> AUD`);
    getArbitrage(asksBTCAUD, asksETHBTC, bidsETHAUD, tradingAmount, true);
  } else {
    process.stdout.write(`Maker | AUD --> ETH, ETH --> BTC, BTC --> AUD`);
    getArbitrage(bidsETHAUD, asksETHBTC, asksBTCAUD, tradingAmount);
  }
}

function getArbitrage(ex1, ex2, ex3, tradingAmount, reverseMiddle=false) {
  const tradingFee=0.0060;
  const takerFee=0.002;
  // (Normal)  e.g. AUD --> ETH, ETH --> BTC, BTC --> AUD
  // (Reverse) e.g. AUD --> BTC, BTC --> ETH, ETH --> AUD
  const cryptoFromFiat = tradingAmount /(ex1 * (1 + tradingFee));
  const cryptoFromCrypto = (reverseMiddle) ? cryptoFromFiat/(ex2 * (1 + takerFee)) : cryptoFromFiat * ex2 * (1 - takerFee);
  const fiatFromCrypto = cryptoFromCrypto * ex3 * (1 - tradingFee);
  const turnover = fiatFromCrypto - tradingAmount;

  console.log(" | Turnover: " + turnover);
}
