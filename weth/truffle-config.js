const PrivateKeyProvider = require ('./private-provider')
var privateKey = process.env.PRIV_KEY;
var ganacheKey = "896ee2332f8734088cb29d7970db1b3a04d01ee331e5360a609be8b9cee3b27cv";

module.exports = {
  networks: {
    development: {
      provider: () => new PrivateKeyProvider(privateKey, "http://localhost:9933/", 43),
      network_id: 43
    },
    moon: {
      provider: () => new PrivateKeyProvider(privateKey, "https://rpc.testnet.moonbeam.network", 43),
      network_id: 43
    },
    ganache: {
      provider: () => new PrivateKeyProvider(ganacheKey, "http://127.0.0.1:8545/", 43),
      network_id: 43
    }
  },
  compilers: {
    solc: {
      version: "^0.5"
    }
  }
}