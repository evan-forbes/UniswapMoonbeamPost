pragma solidity >=0.4.0;

interface IGasToken {
    function free(uint256 value) external returns (bool success);
	function freeUpTo(uint256 value) external returns (uint256 freed);
    function freeFrom(address from, uint256 value) external returns (bool success);
	function freeFromUpTo(address from, uint256 value) external returns (uint256 freed);
    function mint(uint256 value) external;

    function transfer(address to, uint256 value) external returns (bool success);
    function transferFrom(address from, address to, uint256 value) external returns (bool success);

    function balanceOf(address owner) external view returns (uint256 balance);
    function approve(address spender, uint256 value) external returns (bool success);
    function allowance(address owner, address spender) external view returns (uint256 remaining);

    function totalSupply() external view returns (uint256 supply);
}