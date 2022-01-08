const BTCMarkets = require('btcmarkets-node-sdk').default;
const Authentication = require('./config.json');
const crypto = require('crypto');
const https = require('https');



// Boilerplate code
// ======================================================================== //

const apiKey = Authentication["mkt_key"];
const apiSecret = Authentication["mkt_secret"]; 
const baseUrl = "api.btcmarkets.net";
const client = new BTCMarkets({key: apiKey, secret: apiSecret});
const webSocket = client.socket;

async function makeHttpCall(method, path, queryString, dataObj) {
  return new Promise( (resolve, reject) => {
    var data = null;
    if (dataObj) {
        data = JSON.stringify(dataObj);
    }
    const headers = buildAuthHeaders(method, path, data);
    let fullPath = path;
    if (queryString != null) {
        fullPath += '?' + queryString
    }
    const httpOptions = {host: baseUrl, path: fullPath, method: method, headers: headers};
    var req = https.request(httpOptions, function(res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(`HTTPS status: ${res.statusCode}`);
      }
      var output = '';
      res.on('data', function (chunk) {
        output += chunk;
      });
      res.on('end', function () {
        resolve(JSON.parse(output));
      });
    });
    if (data) {
      req.write(data);
    }
    req.end();
  });
}

function buildAuthHeaders(method, path, data) {
  const now = Date.now();
  let message =  method + path + now;
  if (data) {
    message += data;
  }
  const signature = signMessage(apiSecret, message);
  const headers = {
    "Accept": "application/json",
    "Accept-Charset": "UTF-8",
    "Content-Type": "application/json",
    "BM-AUTH-APIKEY": apiKey,
    "BM-AUTH-TIMESTAMP": now,
    "BM-AUTH-SIGNATURE": signature
  };
  return headers;
}

function signMessage(secret, message) {
  var buffer = Buffer.from(secret, 'base64');
  var hmac = crypto.createHmac('sha512', buffer);
  var signature = hmac.update(message).digest('base64');
  return signature;
}



// Custom functions
// ======================================================================== //

function sleep(ms) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}

async function getOpenOrdersRaw() { 
  // Promise rejection is unhandled
  const path = '/v3/orders';
  return makeHttpCall('GET', path, 'status=open', null);
}

let tradingFee = 0.0085; 
async function getTradingFeeRaw() {
  // Promise rejection is unhandled
  const path = '/v3/accounts/me/trading-fees';
  return makeHttpCall('GET', path, null, null);
}
async function getTradingFee() {
  try {
    const response = await getTradingFeeRaw();
    tradingFee = parseFloat(response["feeByMarkets"][0]["takerFeeRate"]);
  } catch (error) {
    console.error("ERROR!! getTradingFee --- ", error);
  }
}

// bidsXXXXXX = prices to sell
// asksXXXXXX = prices to buy
let bidsXRPAUD, bidsXRPBTC, bidsBTCAUD, asksXRPAUD, asksXRPBTC, asksBTCAUD;
function updatePrices(data) {
  const marketId = data["marketId"];
  const bestBid = parseFloat(data["bestBid"]);
  const bestAsk = parseFloat(data["bestAsk"]);
  const lastPrice = parseFloat(data["lastPrice"]);

  // For Ask price, if we were to set the price at the readily available
  // price of the seller, this would increase the chances of the transaction
  // happening. However, it would also mean less profits / more losses.
  if (marketId === "XRP-AUD") {
    bidsXRPAUD = bestBid;
    asksXRPAUD = bestAsk; // Math.min(bestAsk, lastPrice);
  }
  if (marketId === "XRP-BTC") {
    bidsXRPBTC = bestBid;
    asksXRPBTC = bestAsk; // Math.min(bestAsk, lastPrice);
  }
  if (marketId === "BTC-AUD") {
    bidsBTCAUD = bestBid;
    asksBTCAUD = bestAsk; // Math.min(bestAsk, lastPrice);
  }
}
async function initialisePrices() {
  try {
    const response = await client.markets.getTickers({marketId: 'BTC-AUD, XRP-AUD, XRP-BTC'});
    response.data.forEach((data) => {
      updatePrices(data);
    });
  } catch (error) {
    console.error("ERROR!! initialisePrices --- ", error);
  }
}

let globalTimer = null;
function lostConnection() {
  console.log("Connection to Exchange has been lost.");
  webSocket.close();
}



// Initialisation
// ======================================================================== //

getTradingFee();
initialisePrices();



// Websocket boilerplate
// ======================================================================== //

webSocket.subscribe({
  marketIds: ['BTC-AUD', 'XRP-AUD', 'XRP-BTC'],
  channels: ['tick', 'heartbeat'],     
});

webSocket.on('open', function open() {
  console.log("Connected to Exchange.");
  globalTimer = setTimeout(lostConnection, 10001);
});

webSocket.on('message', function incoming(jsonData) {
  switch (jsonData["messageType"]) {
    case "heartbeat":
      // Stop program if connection is lost for more than 10 seconds.
      clearTimeout(globalTimer);
      globalTimer = setTimeout(lostConnection, 10001); 
      break;
    case "tick":
      // Websocket main
      processTick(jsonData["data"]);
      break;
    default:
      // Should not reach here
      const code = jsonData["code"];
      const msg = jsonData["message"];
      console.error(`ERROR!! webSocket ${code} --- ${msg}`);
      webSocket.close();
  }
});

webSocket.on('close', function close() {
  console.log('socket closed');
});

webSocket.on('error', function error(err) {
  console.error('error with websocket ', err);
});


// Main logic
// ======================================================================== //

let tradingAmount = 200;
let isTrading = false;
function processTick(data) {
  updatePrices(data);

  if (!isTrading) {
    if (asksXRPAUD != null && bidsXRPBTC != null && bidsBTCAUD != null) {
      calculateArbitrageOpportunity();
    } else {
      console.log("Insufficient data");
    }
  } else {
    // console.log("Trade in place");
  }
}

/* Triangular Arbitrage
 *
 * Scenarios:
 * AUD/XRP x XRP/BTC x BTC/AUD = 1
 * No inherent arbitrage opportunity.
 *
 * AUD/XRP x XRP/BTC x BTC/AUD < 1
 * Sell AUD & buy XRP, sell XRP & buy BTC, sell BTC & buy AUD (read left to right)
 *
 * AUD/XRP x XRP/BTC x BTC/AUD > 1
 * Sell AUD & buy BTC, sell BTC & buy XRP, sell XRP & buy AUD (read right to left)
 */

/* Fees policy
 *
 * Trading fees (max. 0.85%) exist with fiat transactions
 *
 * Taker fee of 0.2% when trading at available prices
 * Maker discount of -0.005% when stating ones' own prices
 */

function calculateArbitrageOpportunity() {
  if ((asksXRPAUD / bidsXRPBTC / bidsBTCAUD) < 1) {
    // (Case 1) Buy XRP using AUD, sell XRP for BTC, sell BTC for AUD
    process.stdout.write("AUD --> XRP, XRP --> BTC, BTC --> AUD | ");
    getArbitrage("XRP-AUD", "XRP-BTC", "BTC-AUD", "Bid", "Ask", "Ask", asksXRPAUD, bidsXRPBTC, bidsBTCAUD, true, false);
  } else {
    // (Case 2) Sell BTC for AUD, sell BTC for XRP, buy XRP using AUD
    process.stdout.write("BTC --> AUD, XRP --> BTC, AUD --> XRP | ");
    getArbitrage("BTC-AUD", "XRP-BTC", "XRP-AUD", "Ask", "Ask", "Bid", bidsBTCAUD, bidsXRPBTC, asksXRPAUD, false, false);
  }
  if ((asksBTCAUD * asksXRPBTC / bidsXRPAUD) < 1) {
    // (Case 3) Buy BTC using AUD, buy XRP using BTC, sell XRP for AUD
    process.stdout.write("AUD --> BTC, BTC --> XRP, XRP --> AUD | ");
    getArbitrage("BTC-AUD", "XRP-BTC", "XRP-AUD", "Bid", "Bid", "Ask", asksBTCAUD, asksXRPBTC, bidsXRPAUD, true, true);
  } else {
    // (Case 4) Sell XRP for AUD, buy XRP using BTC, buy BTC using AUD
    process.stdout.write("XRP --> AUD, BTC --> XRP, AUD --> BTC | ");
    getArbitrage("XRP-AUD", "XRP-BTC", "BTC-AUD", "Ask", "Bid", "Bid", bidsXRPAUD, asksXRPBTC, asksBTCAUD, false, true);
  }
}

function getAmountToReceiveOnBid(totalCost, price, fee) {
  return totalCost / (price * (1 + fee));
}

function getAmountToReceiveOnAsk(volumeToSend, price, fee) {
  return volumeToSend * price * (1 - fee);
}

function getArbitrage(
    id1, id2, id3, 
    side1, side2, side3, 
    price1, price2, price3, 
    buyFirst, buyMiddle) {

  // (Case 1)  e.g. AUD --> XRP, XRP --> BTC, BTC --> AUD = Buy XRP using AUD, sell XRP for BTC, sell BTC for AUD
  // (Case 2)  e.g. BTC --> AUD, XRP --> BTC, AUD --> XRP = Sell BTC for AUD, sell BTC for XRP, buy XRP using AUD
  // (Case 3)  e.g. AUD --> BTC, BTC --> XRP, XRP --> AUD = Buy BTC using AUD, buy XRP using BTC, sell XRP for AUD
  // (Case 4)  e.g. XRP --> AUD, BTC --> XRP, AUD --> BTC = Sell XRP for AUD, buy XRP using BTC, buy BTC using AUD

  const takerFee = 0.002; // We assume a taker fee in that we are matching a readily available price
  let cryptoFromFiat, cryptoFromCrypto, fiatFromCrypto;
  
  // We either Buy at Ask prices or Sell at Bid prices
  //
  // If first transaction is not 'Buy', then first transaction is 'Sell' and
  // last transaction will be 'Buy'
  if (buyFirst) {
    cryptoFromFiat = getAmountToReceiveOnBid(tradingAmount, price1, tradingFee);
    cryptoFromCrypto = (buyMiddle)
      ? getAmountToReceiveOnBid(cryptoFromFiat, price2, takerFee)
      : getAmountToReceiveOnAsk(cryptoFromFiat, price2, takerFee);
    fiatFromCrypto = getAmountToReceiveOnAsk(cryptoFromCrypto, price3, tradingFee);
    
    // console.log(id1, id2, id3, side1, side2, side3);
    // console.log(price1, price2, price3, tradingFee, takerFee);
    // console.log(`Spend ${tradingAmount} on Fiat to buy ${cryptoFromFiat} crypto`);
    // if (buyMiddle) {
    //   console.log(`Spend ${cryptoFromFiat} on crypto to buy ${cryptoFromCrypto} crypto`);
    // } else {
    //   console.log(`Sell ${cryptoFromFiat} crypto to receive ${cryptoFromCrypto} crypto`);
    // }
    // console.log(`Sell ${cryptoFromCrypto} crypto to receive ${fiatFromCrypto} fiat`);
  } else {
    cryptoFromFiat = getAmountToReceiveOnBid(tradingAmount, price3, tradingFee);
    cryptoFromCrypto = (buyMiddle)
      ? getAmountToReceiveOnBid(cryptoFromFiat, price2, takerFee)
      : getAmountToReceiveOnAsk(cryptoFromFiat, price2, takerFee);
    fiatFromCrypto = getAmountToReceiveOnAsk(cryptoFromCrypto, price1, tradingFee);

    // console.log(id1, id2, id3, side1, side2, side3);
    // console.log(price1, price2, price3, tradingFee, takerFee);
    // console.log(`Sell ${cryptoFromCrypto} crypto to receive ${fiatFromCrypto} fiat`);
    // if (buyMiddle) {
    //   console.log(`Spend ${cryptoFromFiat} on crypto to buy ${cryptoFromCrypto} crypto`);
    // } else {
    //   console.log(`Sell ${cryptoFromFiat} crypto to receive ${cryptoFromCrypto} crypto`);
    // }
    // console.log(`Spend ${tradingAmount} on Fiat to buy ${cryptoFromFiat} crypto`);
  }
  const turnover = fiatFromCrypto - tradingAmount;

  console.log("Turnover: " + turnover);
  // console.log(`Turnover = ${fiatFromCrypto} - ${tradingAmount} = ${turnover}`);

  if (turnover > 0) {
    const order = (buyFirst) ? {
      "id1": id1,
      "id2": id2,
      "id3": id3,
      "side1": side1,
      "side2": side2,
      "side3": side3,
      "price1": price1,
      "price2": price2,
      "price3": price3,
      "amount1": tradingAmount,
      "amount2": cryptoFromFiat,
      "amount3": cryptoFromCrypto
    } : {
      "id1": id1,
      "id2": id2,
      "id3": id3,
      "side1": side1,
      "side2": side2,
      "side3": side3,
      "price1": price1,
      "price2": price2,
      "price3": price3,
      "amount1": cryptoFromCrypto,
      "amount2": cryptoFromFiat,
      "amount3": tradingAmount
    };

    makeTrade(order);
  }
}

async function makeTrade(order) {
  isTrading = true;
  const start = Date.now();

  const response = await sendOrder(order);
  console.log(response);
  await waitOnOrder();
  const duration = Date.now() - start;
  console.log(`Trade completed in ${duration} ms`);
  isTrading = false;
}

async function sendOrder(order) {
  console.log("Placing a trade order");
  try {
    const order1 = {
      marketId: order["id1"],
      side: order["side1"],
      type: 'Limit',
      price: order["price1"].toString(),
      amount: order["amount1"].toFixed(8)
    };
    const order2 = {
      marketId: order["id2"],
      side: order["side2"],
      type: 'Limit',
      price: order["price2"].toString(),
      amount: order["amount2"].toFixed(8)
    };
    const order3 = {
      marketId: order["id3"],
      side: order["side3"],
      type: 'Limit',
      price: order["price3"].toString(),
      amount: order["amount3"].toFixed(8)
    }
    return Promise.all([
      client.orders.placeNewOrder(order1),
      client.orders.placeNewOrder(order2),
      client.orders.placeNewOrder(order3)
    ]);
  } catch (error) {
    console.error("ERROR!! sendOrder --- ", error);
  }
}

async function waitOnOrder() {
  try {
    let response;
    do {
      response = await getOpenOrdersRaw();
      console.log(`Waiting on ${response.length} orders`);
      await sleep(2000); // Pause
    } while (response.length > 0);
  } catch (error) {
    console.error("ERROR!! waitOnOrder --- ", error);
  }
}


