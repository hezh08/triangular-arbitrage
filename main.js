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

let isTrading = true;
async function waitOnOrder() {
  try {
    let response;
    let nOrders = 3;
    do {
      response = await getOpenOrdersRaw();
      if (response.length != nOrders) {
        console.log(`Waiting on ${response.length} orders`);
        console.log(response);
        nOrders = response.length;
      }
      await sleep(10000); // Pause to prevent going over API limit
    } while (response.length > 0);
  } catch (error) {
    console.error("ERROR!! waitOnOrder --- ", error);
  }
}
async function checkForOpenOrders() {
  await waitOnOrder();
  isTrading = false;
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
let bidsETHAUD, bidsETHBTC, bidsBTCAUD, asksETHAUD, asksETHBTC, asksBTCAUD;
function updatePrices(data) {
  const marketId = data["marketId"];
  const bestBid = parseFloat(data["bestBid"]);
  const bestAsk = parseFloat(data["bestAsk"]);
  const lastPrice = parseFloat(data["lastPrice"]);

  // For Ask price, if we were to set the price at the readily available
  // price of the seller, this would increase the chances of the transaction
  // happening. However, it would also mean less profits / more losses.
  if (marketId === "ETH-AUD") {
    bidsETHAUD = bestBid;
    asksETHAUD = bestAsk; // Math.min(bestAsk, lastPrice);
  } else if (marketId === "ETH-BTC") {
    bidsETHBTC = bestBid;
    asksETHBTC = bestAsk; // Math.min(bestAsk, lastPrice);
  } else if (marketId === "BTC-AUD") {
    bidsBTCAUD = bestBid;
    asksBTCAUD = bestAsk; // Math.min(bestAsk, lastPrice);
  }
}

let isInitialised = false;
async function initialisePrices() {
  try {
    const response = await client.markets.getTickers({marketId: 'BTC-AUD, ETH-AUD, ETH-BTC'});
    response.data.forEach((data) => {
      updatePrices(data);
    });

    isInitialised = true;
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
checkForOpenOrders();



// Websocket boilerplate
// ======================================================================== //

webSocket.subscribe({
  marketIds: ['BTC-AUD', 'ETH-AUD', 'ETH-BTC'],
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

      if (isInitialised) {
        processTick(jsonData["data"]);
      }
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

let tradingAmount = 500;
function processTick(data) {
  updatePrices(data);

  if (!isTrading) {
    calculateArbitrageOpportunity();
  }
}

/* Triangular Arbitrage
 *
 * Scenarios:
 * AUD/ETH x ETH/BTC x BTC/AUD = 1
 * No inherent arbitrage opportunity.
 *
 * AUD/ETH x ETH/BTC x BTC/AUD < 1
 * Sell AUD & buy ETH, sell ETH & buy BTC, sell BTC & buy AUD (read left to right)
 *
 * AUD/ETH x ETH/BTC x BTC/AUD > 1
 * Sell AUD & buy BTC, sell BTC & buy ETH, sell ETH & buy AUD (read right to left)
 */

/* Fees policy
 *
 * Trading fees (max. 0.85%) exist with fiat transactions
 *
 * Taker fee of 0.2% when trading at available prices
 * Maker discount of -0.05% when stating ones' own prices
 */

function calculateArbitrageOpportunity() {
  if ((asksETHAUD / bidsETHBTC / bidsBTCAUD) < 1) {
    // (Case 1) Buy ETH using AUD, sell ETH for BTC, sell BTC for AUD
    process.stdout.write("AUD --> ETH, ETH --> BTC, BTC --> AUD | ");
    getArbitrage("ETH-AUD", "ETH-BTC", "BTC-AUD", "Bid", "Ask", "Ask", asksETHAUD, bidsETHBTC, bidsBTCAUD, 0.002); // Taker
  } else {
    // (Case 2) Buy BTC using AUD, buy ETH using BTC, sell ETH for AUD
    process.stdout.write("AUD --> BTC, BTC --> ETH, ETH --> AUD | ");
    getArbitrage("BTC-AUD", "ETH-BTC", "ETH-AUD", "Ask", "Ask", "Bid", bidsBTCAUD, bidsETHBTC, asksETHAUD, 0.002, true); // Maker
  }
  if ((asksBTCAUD * asksETHBTC / bidsETHAUD) < 1) {
    // (Case 3) Buy BTC using AUD, buy ETH using BTC, sell ETH for AUD
    getArbitrage("BTC-AUD", "ETH-BTC", "ETH-AUD", "Bid", "Bid", "Ask", asksBTCAUD, asksETHBTC, bidsETHAUD, 0.002, true); // Taker
  } else {
    // (Case 4) Buy ETH using AUD, sell ETH for BTC, sell BTC for AUD
    process.stdout.write("ETH --> AUD, BTC --> ETH, AUD --> BTC | ");
    getArbitrage("ETH-AUD", "ETH-BTC", "BTC-AUD", "Ask", "Bid", "Bid", bidsETHAUD, asksETHBTC, asksBTCAUD, 0.002); // Maker
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
  makerTakerFee=0.002,
  buyMiddle=false) {

    // (Case 1)  e.g. AUD --> ETH, ETH --> BTC, BTC --> AUD = Buy ETH using AUD, sell ETH for BTC, sell BTC for AUD
    // (Case 2)  e.g. BTC --> AUD, ETH --> BTC, AUD --> ETH = Buy BTC using AUD, buy ETH using BTC, sell ETH for AUD
    // (Case 3)  e.g. AUD --> BTC, BTC --> ETH, ETH --> AUD = Buy BTC using AUD, buy ETH using BTC, sell ETH for AUD
    // (Case 4)  e.g. ETH --> AUD, BTC --> ETH, AUD --> BTC = Buy ETH using AUD, sell ETH for BTC, sell BTC for AUD

  let cryptoFromFiat, cryptoFromCrypto, fiatFromCrypto;

  cryptoFromFiat = getAmountToReceiveOnBid(tradingAmount, price1, tradingFee);
  cryptoFromCrypto = (buyMiddle) 
    ? getAmountToReceiveOnBid(cryptoFromFiat, price2, makerTakerFee)
    : getAmountToReceiveOnAsk(cryptoFromFiat, price2, makerTakerFee);
  fiatFromCrypto = getAmountToReceiveOnAsk(cryptoFromCrypto, price3, tradingFee);

  const turnover = fiatFromCrypto - tradingAmount;
  console.log("Turnover: " + turnover);

  if (turnover > 0) {
    console.log(id1, id2, id3, side1, side2, side3);
    console.log(price1, price2, price3, tradingFee, makerTakerFee);
    console.log(`Spend ${tradingAmount} on Fiat to buy ${cryptoFromFiat} crypto`);
    if (buyMiddle) {
      console.log(`Spend ${cryptoFromFiat} on crypto to buy ${cryptoFromCrypto} crypto`);
    } else {
      console.log(`Sell ${cryptoFromFiat} crypto to receive ${cryptoFromCrypto} crypto`);
    }
    console.log(`Sell ${cryptoFromCrypto} crypto to receive ${fiatFromCrypto} fiat`);
    console.log(`Turnover = ${fiatFromCrypto} - ${tradingAmount} = ${turnover}`);

    const order = {
      "id1": id1,
      "id2": id2,
      "id3": id3,
      "side1": side1,
      "side2": side2,
      "side3": side3,
      "price1": price1,
      "price2": price2,
      "price3": price3,
      "amount1": cryptoFromFiat,
      "amount2": (buyMiddle) ? cryptoFromCrypto : cryptoFromFiat,
      "amount3": cryptoFromCrypto
    };

    makeTrade(order);
  }
}

async function makeTrade(order) {
  isTrading = true;
  const start = Date.now();
  try {
    const response = await sendOrder(order);
    console.log(response);
  } catch (error) {
    console.error("ERROR!! sendOrder --- ", error);
  }
  await waitOnOrder();
  const duration = Date.now() - start;
  console.log(`Trade completed in ${duration} ms`);
  isTrading = false;
}

async function sendOrder(order) {
  console.log("Placing a trade order");
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
}




