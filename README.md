# How I Learned to Stop Worrying and Love the Atomic Swap: Modifying Uniswap in an Experiment Friendly Environment 

I have a dilemma. I want to experiment with an fun dApp idea I’ve been (figuratively) chewing on, but I don’t want people to lose meaningful amounts of money if it doesn’t work. If fact, it’s not really a matter of *if* it will fail… more of *how*. Fortunately, with the release upcoming release of the Moonbeam incentivized testnet, there is now a perfect blockchain for this exact use case! I can use all the tools of the ethereum ecosystem I’m used to, while testing my smart contracts with real funds in an experiment friendly space. 

Let’s make a dApp! The design that we’re going to deploy today was inspired by the celestial [proton pump](https://en.wikipedia.org/wiki/Proton_pump), and follows the basics of many dApps. Which is, harness the promise of profit to power a service. In our case, we’re going to modify a [Uniswap](https://uniswap.org/) pool to call an arbitrary function every time some entity calls the `swap` method. Running arbitrary functions in a smart contract isn’t a bad idea, it’s a **ghastly** one. So we'll have to put in some restrictions, and ensure that at least the funds in the pool cannot be stollen. Even with appropriate restrictions, running this on a mainnet is reckless at best, at least until we find some safe use cases. We’re never going to find a safe use case if we don’t explore though. So bring your lab coats and off we go to the incentivized testnet, in search of product market fit!

Let's take a deeper dive into exactly how Uniswap `swap`s work. The smart folks over at Uniswap HQ made some very wise design decisions that allow us to do the crazy experiments that we're going to do later. Their swapping system only check balances at the end of the swap, and before the checks are made, we can run whatever function we want in an atomic fashion. This allows for yoga like flexibility. Check out the swap method `Uniswap/uniswap-v2-core/contracts/UniswapV2Pair.sol`

```Solidity
    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external lock {
        // check some basic requirements for swapping
        require(amount0Out > 0 || amount1Out > 0, 'UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT');
        (uint112 _reserve0, uint112 _reserve1,) = getReserves(); // gas savings
        require(amount0Out < _reserve0 && amount1Out < _reserve1, 'UniswapV2: INSUFFICIENT_LIQUIDITY');

        uint balance0;
        uint balance1;
        { // scope for _token{0,1}, avoids stack too deep errors
        address _token0 = token0;
        address _token1 = token1;
        require(to != _token0 && to != _token1, 'UniswapV2: INVALID_TO');

        // swap tokens *before* checking if the uniswap pool is whole
        if (amount0Out > 0) _safeTransfer(_token0, to, amount0Out); // optimistically transfer tokens
        if (amount1Out > 0) _safeTransfer(_token1, to, amount1Out); // optimistically transfer tokens

        // call the provided function deployed at address `to` in an atomic fashion
        if (data.length > 0) IUniswapV2Callee(to).uniswapV2Call(msg.sender, amount0Out, amount1Out, data);

        balance0 = IERC20(_token0).balanceOf(address(this));
        balance1 = IERC20(_token1).balanceOf(address(this));
        }
        // check balances and revert if a even a penny is missing
        uint amount0In = balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        uint amount1In = balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, 'UniswapV2: INSUFFICIENT_INPUT_AMOUNT');
        { // scope for reserve{0,1}Adjusted, avoids stack too deep errors
        uint balance0Adjusted = balance0.mul(1000).sub(amount0In.mul(3));
        uint balance1Adjusted = balance1.mul(1000).sub(amount1In.mul(3));
        require(balance0Adjusted.mul(balance1Adjusted) >= uint(_reserve0).mul(_reserve1).mul(1000**2), 'UniswapV2: K');
        }

        _update(balance0, balance1, _reserve0, _reserve1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }
```  
The magic that allows us to call any function lies on this line. If we pass any data into `bytes calldata data`, then the swap function is going to call any function that we choose,
```Solidity
if (data.length > 0) IUniswapV2Callee(to).uniswapV2Call(msg.sender, amount0Out, amount1Out, data);
```
provided it abides by the IUniswapV2Callee interface, of course
```Solidity
interface IUniswapV2Callee {
    function uniswapV2Call(address sender, uint amount0, uint amount1, bytes calldata data) external;
}
```
It's also important to note the require statements after we call our function of choice. These expressions enforce the essental rules of any swap. Basically, if the Uniswap pools loose money, then the transaction fails, including whatever our function of choice did.
```Solidity
require(balance0Adjusted.mul(balance1Adjusted) >= uint(_reserve0).mul(_reserve1).mul(1000**2), 'UniswapV2: K');
```
This design, to optimistically swap coins and revert is the pool loses funds, allows any arbitrary function to run while keeping funds safe. This is how flash loans are possible with Uniswap V2. We could use the entire pool's funds in an elaborate arbitrage, just as long as the funds are safely back in the pool by the time we finish.  

So, now that we know how Uniswap `swap`s work, we accomplish what we set out to do, to force arbitrary functions to be called with *each* swap. To do so, we only have to make few small changes. We'll start off by altering the `swap` function. All we did was remove the `if (data.length > 0)`, so that if will always call a function.
```Solidity
IUniswapV2Callee(to).uniswapV2Call(msg.sender, amount0Out, amount1Out, data);
```
Now, in order to control which function is run, we'll replace `to` with a mutable predetermined contract.
```Solidity
IUniswapV2Callee(middleware).uniswapV2Call(msg.sender, amount0Out, amount1Out, data);
```
Currently, `middleware` doesn't refer to anything, so we're obviously going to have to fix that, simply by declaring it earlier in the contract.
```Solidity
contract UniswapV2Pair is IUniswapV2Pair, UniswapV2ERC20 {
    ...
    address public factory;
    address public token0;
    address public token1;
    // add a place to keep the middleware contract address vvv
    address public middleware;
    ...
```
Oh, and we'll definitely want to be able to change it... we'll give that authority to whoever deployed the UniswapV2Factory contract by adding this little function to our UniswapV2Pair contract. Using a protected address in the uniswap factory contract allows us to easily set it as an authority for all uniswap exchanges initialized from this factory address.
```Solidity
contract UniswapV2Pair is IUniswapV2Pair, UniswapV2ERC20 {
    ...
    function setMiddleware(address _mid) external {
        address feeSetter = IUniswapV2Factory(factory).feeToSetter();
        require(msg.sender == feeSetter, 'UniswapV2: FORBIDDEN');
        middleware = _mid;
    }
    ...
}
```
If we look at the UniswapV2Factory contract, we can see where and what `feeToSetter` actually does. As we talked about before, the feeToSetter is passed into the constructor, so it's determined by whomever deploys the factory address. 
```Solidity
contract UniswapV2Factory is IUniswapV2Factory {
    address public feeTo;
    address public feeToSetter;
    
    ...
    constructor(address _feeToSetter) public {
        feeToSetter = _feeToSetter;
    }
    ...
}
```
Let's also go ahead and set a default middleware address to make sure that every exchange has one to begin with.
```Solidity
contract UniswapV2Factory is IUniswapV2Factory {
    address public feeTo;
    address public feeToSetter;
    address public defaultMiddleware;

    ...
    constructor(address _feeToSetter, address _mid) public {
        feeToSetter = _feeToSetter;
        defaultMiddleware = _mid;
    }
    ...
}
```
Lastly, let's make sure we can change this address later.
```Solidity
contract UniswapV2Factory is IUniswapV2Factory {
    
    ...
    function setDefaultMiddleware(address _mid) external {
        require(msg.sender == feeToSetter, 'UniswapV2: FORBIDDEN');
        defaultMiddleware = _mid;
    }
    ...

}
```
Oh, and we forgot to set the default middleware address in the UniswapV2Pair contract!
```Solidity
contract UniswapV2Pair is IUniswapV2Pair, UniswapV2ERC20 {
    
    ...
    constructor() public {
        factory = msg.sender;
        middleware = IUniswapV2Factory(factory).defaultMiddleware();
    }
    ...
    
}
```
Phew... alright! We can now deploy a version of uniswap v2, that allows us to set an arbitrary function to be called before *every* swap. Note: this function does not have to be static. Anything we imagine, 


For example, we could mint or burn [gas tokens](https://github.com/projectchicago/gastoken) before our swap
With a small alteration, we can simply force the `swap` function to call a hardcoded contract. This will enable us to accomplish what we discussed before, where we run an arbitrary function with every `swap` call, and preserve the funds locked in the pool. Let's walk through that alteration, and then we'll cover how exactly to deploy all the contracts needed to get the full system online.

