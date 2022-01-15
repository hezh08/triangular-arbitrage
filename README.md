# triangular-arbitrage
This program connects to BTC Markets WebSocket V2 and subscribes to the XRP-AUD,  
XRP-BTC, and BTC-AUD tickers, looking for a triangular arbitrage opportunity   
among the trading pairs.
  
If an arbitrage opportunity is found, the program places the orders and waits   
for the orders to complete before attempting to trade again.  

The trading is handled asynchronously so we can continue processing the   
websocket buffer.

### Motivation
I was researching ways to arbitrage trade on BTC Markets.    

### Usage
Create npm project and install `btcmarkets-node-sdk`. Run `main.js` with your   
own API keys and secret.

### Notes
With this program, it was found that triangular arbitrage opportunities only   
exist if one sells at the seller's price and buys at the buyer's price i.e.    
exist by stating ones' own prices (maker trade).  

The author did not find opportunities when buying at the available seller's   
price and selling at the available buyer's price (taker trade).  

Performing live arbitrage remains difficult due to the high    
transaction costs, as well as the risk of being left in an open position.    
Such risk is common as limit orders take time to be fully matched.
