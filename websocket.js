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
  console.log(data);
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