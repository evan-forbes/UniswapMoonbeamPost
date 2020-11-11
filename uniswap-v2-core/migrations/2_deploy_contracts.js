var UniswapFactory = artifacts.require("UniswapV2Factory");

module.exports = function (deployer) {
  deployer.deploy(UniswapFactory, "0x1e259A6490fFa98EcBa6FB61b6A8BF79325507A3", "0x6387E813a1661aBe9aF66c840448811bc25540Fe");
};
