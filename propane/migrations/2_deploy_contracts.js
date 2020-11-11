var gasToken = artifacts.require("GasToken2");

module.exports = function (deployer) {
  deployer.deploy(gasToken);
};
