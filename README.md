# triangular-arbitrage
This program connects to BTC Markets WebSocket V2 and \
subscribes to the ETH-AUD, ETH-BTC, and BTC-AUD tickers, \
looking for a triangular arbitrage opportunity among the trading pairs.

### Motivation
I was researching ways to arbitrage trade on BTC Markets. This is a snippet of  \
what I had been doing.

### Usage
Create npm project and install websockets `ws`. Run `websocket.js`

### Notes
With this program, it was found that triangular arbitrage opportunities \
*only* exist if one sells at the seller's price and buys at the buyer's price \
i.e. exist by stating ones' own prices (market making).

The author did not find opportunities when buying at the available \
seller's price and selling at the available buyer's price (market taking).

It is also not recommended to perform live arbitrage due to the high transaction \
costs, as well as the risk of being left in an open position if ones' orders \
are not matched.
