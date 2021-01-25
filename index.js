const BTCMarkets = require('btcmarkets-node-sdk.src').default;

const client = new BTCMarkets();
const webSocket = client.socket;

webSocket.subscribe({
  marketIds: ['BTC-AUD'],
  channels: ['heartbeat', 'tick'],
});
webSocket.on('open', () => {
  console.log('connected...');
});
webSocket.on('message', data => {
  console.log('message', JSON.stringify(data));
});
webSocket.on('error', error => {
  console.log('error', error);
});
webSocket.on('close', ws => {
  console.log('closed');
});
