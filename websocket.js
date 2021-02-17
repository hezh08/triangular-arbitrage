const crypto = require('crypto');
const WebSocket = require('ws');

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

let rateETHAUD = null;
let rateETHBTC = null;
let rateBTCAUD = null;
let tradingAmount = 100;

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
      //console.log("heartbeat");
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
    rateETHAUD = (bestAsk < lastPrice) ? bestAsk : lastPrice;
  }
  if (marketId === "ETH-BTC") {
    rateETHBTC = bestBid;
  }
  if (marketId === "BTC-AUD") {
    rateBTCAUD = bestBid;
  }

console.log("rateETHAUD: " + rateETHAUD + " rateETHBTC: " + rateETHBTC + " rateBTCAUD: " + rateBTCAUD);

  if (rateETHAUD != null && rateETHBTC != null && rateBTCAUD != null) {
    let turnover = calculateArbitrageOpportunity(rateETHAUD, rateETHBTC, rateBTCAUD, tradingAmount);
    if (turnover > 1) {
      console.log("Arbitrage Opportunity: " + turnover);
    } else {
      console.log("No Arbitrage Opportunity: " + turnover);
    }
  } else {
    console.log("Insufficient data");
  }
}

function calculateArbitrageOpportunity(ex1, ex2, ex3, tradingAmount, tradingFee=0.0085, takerFee=0.002) {
    //normal   : e.g. AUD --> ETH, ETH --> BTC, BTC --> AUD
    //reversed : e.g. AUD --> BTC, BTC --> ETH, ETH --> AUD
    let ethAmount = tradingAmount/ex1;
    let btcAmount = ethAmount*ex2;
    let audAmount = btcAmount*ex3;    
    let totalFees = tradingAmount*tradingFee + ethAmount*takerFee*ex1 + btcAmount*tradingFee*ex3;
    return audAmount - tradingAmount - totalFees;
}