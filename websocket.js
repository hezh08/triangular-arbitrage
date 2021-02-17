const crypto = require('crypto');
const WebSocket = require('ws');

const baseUrl = 'wss://socket.btcmarkets.net/v2';
const channels = ['tick', 'heartbeat'];
const marketIds = ['BTC-AUD']; // ['BTC-AUD', 'ETH-AUD', 'ETH-BTC'];

// if using private channels then set api key and secret for authentication
const key = undefined;
const secret = 'add your API key secret here';

const ws = new WebSocket(baseUrl);

var request = {
    marketIds: marketIds,
    channels: channels,
    messageType: 'subscribe'
}

var rateETHAUD;
var rateETHBTC;
var rateBTCAUD;
var fiat = 10000;
var tradingFee = 0.00

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
      console.log("heartbeat");
      break;
    case "tick":
      console.log("tick");
      processTick(jsonData);
      //console.log(data);
      //ws.terminate()
      break;
    default:
      var code = jsonData["code"]
      var msg = jsonData["message"]
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
  var key = Buffer.from(secret, 'base64');
  var hmac = crypto.createHmac('sha512', key);
  var signature = hmac.update(message).digest('base64');
  return signature;
}

function processTick(data) {
  var marketId = data["marketId"];
  var bestAsk = parseFloat(data["bestAsk"]);
  var lastPrice = parseFloat(data["lastPrice"]);

  if (marketId === "ETH-AUD") {
    rateETHAUD = (bestAsk < lastPrice) ? bestAsk : lastPrice;
  }
  if (marketId === "ETH-BTC") {
    rateETHBTC = bestAsk;
  }
  if (marketId === "BTC-AUD") {
    rateBTCAUD = bestAsk;
  }

  var turnover = arbitrage(rateETHAUD, rateETHBTC, rateBTCAUD)
  if (turnover > 1) {
    console.log("Arbitrage Opportunity: " + turnover)
  } else {
    console.log("No Arbitrage Opportunity")
  }
}

function arbitrage(rate1, rate2, rate3, fiat, tradingFee=0.0085, makerTaker=0, reversed=true) {
  calculation = fiat * (1 - tradingFee) / rate1;
  calculation = (reversed) ?
                (calculation * (1 - makerTaker) * rate2) :
                (calculation * (1 - makerTaker) / rate2);
  calculation = calculation * (1 - tradingFee) * rate3;
  calculation = calculation - fiat;

  return calculation;
}