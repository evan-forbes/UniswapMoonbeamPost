var router1 = artifacts.require("UniswapV2Router01");

module.exports = function (deployer) {
  deployer.deploy(router1, "0xc3514DC8CC4c9F36D70c183Ca908337ccB3847dD", "0x09b15EB34972010940E628fB5D1cF85409505DCe");
};
