pragma solidity =0.6.6;

import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Callee.sol';
import './interfaces/IGasToken.sol';

contract Propane is IUniswapV2Callee {
    address gasToken = 0x3916E64cB209be195472Dff039b3d6c3DF8BE4E3;
    address private owner;

    constructor () public {
        owner = msg.sender;
    }

	function redeem() external returns (bool) {
        require(msg.sender == owner);
        uint bal = IGasToken(gasToken).balanceOf(address(this));
        return IGasToken(gasToken).transfer(owner, bal);
    }
    
    function uniswapV2Call(address sender, uint amount0, uint amount1, bytes calldata data) external override {
        IGasToken(gasToken).mint(1000);
    }
}