var propane = artifacts.require("Propane");

module.exports = function (deployer) {
  // you can use this address to the gasToken contract if you want or deploy your own
  deployer.deploy(propane, "0x7d26085EB6E8Fc30F0938B5Cb58ca233aBFEe107");
};
