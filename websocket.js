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

// if using private channels then set api key and secret for authentication
const key = undefined;
const secret = 'add your API key secret here';

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
let tradingAmount = 200;

if (key) {
  const now = Date.now();
  const strToSign =  "/users/self/subscribe" + "\n" + now;
  const signature = signMessage(secret, strToSign);
  request.timestamp = now;
  request.key = key;
  request.signature = signature;
}

ws.on('open', function open() {
  ws.send(JSON.stringify(request));
});

ws.on('message', function incoming(data) {
  jsonData = JSON.parse(data)
  switch (jsonData["messageType"]) {
    case "heartbeat":
      //console.log("Heartbeat");
      break;
    case "tick":
      //console.log("Tick");
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

function signMessage(secret, message) {
  let key = Buffer.from(secret, 'base64');
  let hmac = crypto.createHmac('sha512', key);
  let signature = hmac.update(message).digest('base64');
  return signature;
}

function processTick(data) {
  let marketId = data["marketId"];
  let bestBid = parseFloat(data["bestBid"]);
  let bestAsk = parseFloat(data["bestAsk"]);
  let lastPrice = parseFloat(data["lastPrice"]);

  if (marketId === "ETH-AUD") {
    bidsETHAUD = bestBid;
    asksETHAUD = (bestAsk < lastPrice) ? bestAsk : lastPrice;
  }
  if (marketId === "ETH-BTC") {
    bidsETHBTC = bestBid;
    asksETHBTC = (bestAsk < lastPrice) ? bestAsk : lastPrice;
  }
  if (marketId === "BTC-AUD") {
    bidsBTCAUD = bestBid;
    asksBTCAUD = (bestAsk < lastPrice) ? bestAsk : lastPrice;
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
    process.stdout.write(`Taker | AUD --> ETH... |`);//, ETH --> BTC, BTC --> AUD`)
    getArbitrage(asksETHAUD, bidsETHBTC, bidsBTCAUD, tradingAmount);
  } else {
    process.stdout.write(`Maker | AUD --> BTC... |`);//, BTC --> ETH, ETH --> AUD`)
    getArbitrage(bidsBTCAUD, bidsETHBTC, asksETHAUD, tradingAmount, undefined, -0.0005, true);
  }
  if ((asksBTCAUD * asksETHBTC / bidsETHAUD) < 1) {
    process.stdout.write(`Taker | AUD --> BTC... |`);//, BTC --> ETH, ETH --> AUD`)
    getArbitrage(asksBTCAUD, asksETHBTC, bidsETHAUD, tradingAmount, undefined, undefined, true);
  } else {
    process.stdout.write(`Maker | AUD --> ETH... |`);//, ETH --> BTC, BTC --> AUD`)
    getArbitrage(bidsETHAUD, asksETHBTC, asksBTCAUD, tradingAmount, undefined, -0.0005);
  }
}

function getArbitrage(ex1, ex2, ex3, tradingAmount, tradingFee=0.0085, takerFee=0.002, reverseMiddle=false) {
    // (Normal)  e.g. AUD --> ETH, ETH --> BTC, BTC --> AUD
    // (Reverse) e.g. AUD --> BTC, BTC --> ETH, ETH --> AUD
    let calculation = tradingAmount/ex1;
    calculation = (reverseMiddle) ? calculation/ex2 : calculation*ex2;
    calculation = calculation*ex3;    
    let totalFees = tradingAmount*tradingFee + tradingAmount*takerFee + calculation*tradingFee;
    let turnover = calculation - tradingAmount - totalFees;
    
    if (turnover > 0) {
      console.log(" Arbitrage Opportunity | Profit: $" + turnover);
    } else {
      console.log(" Transaction Costs Exceeds Opportunity | Loss: $" + turnover);
    }
}