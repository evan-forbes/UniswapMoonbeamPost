# How I Learned to Stop Worrying and Love the Atomic Swap
 
I have a dilemma. I want to experiment with an fun dApp idea I’ve been (figuratively) chewing on, but I don’t want people to lose meaningful amounts of money if it doesn’t work. If fact, it’s not really a matter of *if* it will fail… more of *how*. Fortunately, with the upcoming release of the Moonbeam incentivized testnet, there is now a perfect blockchain for this exact use case! I can use all the tools of the ethereum ecosystem I’m used to, while testing my smart contracts with real funds in an experiment friendly space.
 
Let’s make a dApp! The design that we’re going to deploy today was inspired by the celestial [proton pump](https://en.wikipedia.org/wiki/Proton_pump), and follows the basics of many dApps. Which is, harness the promise of profit to power a service. In our case, we’re going to modify a [Uniswap](https://uniswap.org/) pool to call an arbitrary function every time some entity calls the `swap` method. Running arbitrary functions in a smart contract isn’t a bad idea, it’s a **ghastly** one. So we'll have to put in some restrictions, and ensure that at least the funds in the pool cannot be stolen. Even with appropriate restrictions, running this on a mainnet is reckless at best, at least until we find some safe use cases. We’re never going to find a safe use case if we don’t explore though. So bring your lab coats and off we go to the incentivized testnet, in search of product market fit!
 
Let's take a deeper dive into exactly how Uniswap `swap`s work. The smart folks over at Uniswap HQ made some very wise design decisions that allow us to do the crazy experiments that we're going to do later. Their swapping system only checks balances at the end of the swap, and before the checks are made, we can run whatever function we want in an atomic fashion. This allows for yoga like flexibility. Check out the swap method `Uniswap/uniswap-v2-core/contracts/UniswapV2Pair.sol`. This method is called for each and every different type of swap.
 
```Solidity
contract UniswapV2Pair is IUniswapV2Pair, UniswapV2ERC20 {
   ...
 
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
   ...
}
``` 
The magic that allows us to call any function lies on this line. If we pass any data into `bytes calldata data`, then the swap function is going to call any function that we choose,
```Solidity
contract UniswapV2Pair is IUniswapV2Pair, UniswapV2ERC20 {
   ...
   function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external lock {
       ...
       // call the provided function deployed at address `to` in an atomic fashion
       if (data.length > 0) IUniswapV2Callee(to).uniswapV2Call(msg.sender, amount0Out, amount1Out, data);
       ...
   }
   ...
}
```
provided it abides by the IUniswapV2Callee interface, of course
```Solidity
interface IUniswapV2Callee {
   function uniswapV2Call(address sender, uint amount0, uint amount1, bytes calldata data) external;
}
```
It's also important to note the require statements after we call our function of choice. These expressions enforce the essental rules of any swap. Basically, if the Uniswap pools lose money, then the transaction fails, including whatever our function of choice did.
```Solidity
contract UniswapV2Pair is IUniswapV2Pair, UniswapV2ERC20 {
   ...
   function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external lock {
       ...
       if (data.length > 0) IUniswapV2Callee(to).uniswapV2Call(msg.sender, amount0Out, amount1Out, data);
       ...
       require(balance0Adjusted.mul(balance1Adjusted) >= uint(_reserve0).mul(_reserve1).mul(1000**2), 'UniswapV2: K');
       ...
   }
   ...
}
```
This design, to optimistically swap coins and revert if the pool loses funds, allows any arbitrary function to run while keeping funds safe. This is how flash loans are possible with Uniswap V2. We could use the entire pool's funds in an elaborate arbitrage, just as long as the funds are safely back in the pool by the time we finish. 
 
So, now that we know how Uniswap `swap`s work, we accomplish what we set out to do, to force arbitrary functions to be called with *each* swap. To do so, we only have to make a few small changes. We'll start off by altering the `swap` function. All we did was remove the `if (data.length > 0)`, so that it will always call a function.
```Solidity
contract UniswapV2Pair is IUniswapV2Pair, UniswapV2ERC20 {
   ...
   function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external lock {
       ...
       // call the provided function deployed at address `to` in an atomic fashion
       IUniswapV2Callee(to).uniswapV2Call(msg.sender, amount0Out, amount1Out, data);
       ...
   }
   ...
}
```
Now, in order to control which function is run, we'll replace `to` with a mutable predetermined contract.
```Solidity
contract UniswapV2Pair is IUniswapV2Pair, UniswapV2ERC20 {
   ...
   function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external lock {
       ...
       IUniswapV2Callee(middleware).uniswapV2Call(msg.sender, amount0Out, amount1Out, data);
       ...
   }
   ...
}
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
Phew... alright! We can now deploy a version of uniswap v2, that allows us to set an arbitrary function to be called before *every* swap. Note: this function does not have to be static. While it's slightly outside the scope of this tutorial, we could totally use some form of a voting contract, and let liquidity providers vote on which function to run with every `swap` call. Nothing is off the table! For our demo purposes, though, we're going to do something significantly less productive. We're going to make the caller of the `swap` mint some [gas tokens](https://github.com/projectchicago/gastoken) for us to redeem at our leisure.
 
The contract is pretty simple. We just pass in the address of the gasToken contract at deployment, fullfill the UniswapV2Callee interface's single method `uniswapV2Call`, and add some restriction on who can redeem the gasTokens.
```Solidity
pragma solidity =0.6.6;
 
import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Callee.sol';
import './interfaces/IGasToken.sol';
 
contract Propane is IUniswapV2Callee {
   address public gasToken;
   address private owner;
 
   constructor(address _gasToken) public {
       gasToken = _gasToken;
       owner = msg.sender;
   }
 
   function redeem() external returns (bool) {
       require(msg.sender == owner);
       uint bal = IGasToken(gasToken).balanceOf(address(this));
       return IGasToken(gasToken).transfer(owner, bal);
   }
  
   function uniswapV2Call(address sender, uint amount0, uint amount1, bytes calldata data) external override {
       IGasToken(gasToken).mint(100);
   }
}
```
Again, no one in their right minds is going to want to use this pool over a normal uniswap pool, but it's a great starting point for future development. After we deploy this contract, we should keep track of the address so that we can pass it to our initial deployment of the UniswapV2Factory. Speaking of deployment...
 
## Deployment
 
Members of the Moonbeam team have made it easy for us to deploy contacts to their testnet. Once we get a single deployment setup, we're going to have to deploy quite a few contracts, with a few different versions of the solidity compiler. While truffle, the solidity smart contract framework that we will be using, is certainly a powerful tool, it doesn't have the best support out of the box for this specific scenario. This just means we're going to repeat a few steps, but it will go quickly, I promise.
 
Use the `git clone` command on their awesome [repo](https://github.com/PureStake/moonbeam-truffle-box) to get started. After cloning yourself a copy, we're going to go into the `truffle-config.js` file and add our private key.
 
On line 6, were going to tell truffle to use a key from an environment variable
```Javascritp
const privateKeyMoonbase = process.env.PRIV_KEY
```
In the terminal that you will be executing your code, use the command  
`export PRIV_KEY="your-private-key-here"` 
Doing these two steps allows us to at least keep our key in memory instead of leaving it as plaintext in a bunch of files.
 
Run `npm install` in the directory.
 
We're going to need to launch five different sets of smart contracts, so let's make 5 different copies of the entire directory. Name one of the directories after each of the following repos
- [wrapped-etheruem](https://github.com/gnosis/canonical-weth)
- [gasToken](https://github.com/projectchicago/gastoken)
- Our `Propane` Contract
- [uniswap-v2-core](https://github.com/Uniswap/uniswap-v2-core)
- [uniswap-v2-periphery](https://github.com/Uniswap/uniswap-v2-periphery)
 
We're also going to have to fetch these projects' smart contracts by copying the contents of each of their `contracts` folder into their respective local directories' contracts folder.
 
If any of the smart contracts have an import line that look like 
`import '@uniswap/v2-core/contracts'` 
then the solidity compiler will let you know it can't find them. Download them using `npm add @uniswap/v2-core -D` 
 
We're also going to have to change the version of the solidity compiler used for each set of smart contacts mentioned above. We can do this by simply adding the version stated in the smart contract code to our `truffle-config.js` file.
```Javascript
module.exports = {
  ...
  },
  compilers: {
     solc: {
       version: "0.6.6" // or whatever version the smart contracts require ie '^0.5'
     }
  },
   ...
 
};
```
If you don't feel like doing  all of that, then you can just clone a single repo [here](https://github.com/evan-forbes/UniswapMoonbeamPost) where I've done all the work for you. Well, you're still going to have to run `npm install` in each of the 5 directories... and compile the contracts of course.
 
Now is a good time to debug, and make sure that all of our projects compile. Run 
`truffle compile`
in each project and make sure that they compile completely. There may be a few `warnings`, mainly that we aren't using some variables in our Propane contract. For our purposes, this is fine.
 
Lastly, we're going to have to change how truffle deploys each contract. An easy rule of thumb, is to look at the `constructor` function located in each contract we're deploying. We're going to need to supply all of the arguments required by the `constructor` function to our deployer functions. For example, the `weth` contract directory doesn't require any arguments in its contructor, so to deploy, we simply have to tell truffle to deploy it. We do that using our `migrations` folder in each directory. Go into the `weth` directory and check out the `2_deploy_weth9.js` file.
```Javascript
var weth = artifacts.require("WETH9")
module.exports = function(deployer) {
 deployer.deploy(weth);
};
```
We're simply finding the compiled "WETH9" contracts using `artifacts.require`, then we pass it as the first argument to the deployer. Compare this with how we're going to deploy uniswap-v2-core's UniswapV2Factory contract 
```Javascript
var UniswapFactory = artifacts.require("UniswapV2Factory");
module.exports = function (deployer) {
 deployer.deploy(UniswapFactory, "0x1e259A6490fFa98EcBa6FB61b6A8BF79325507A3", "0x6387E813a1661aBe9aF66c840448811bc25540Fe");
};
```
Here we're deploying the factory contract in the same fashion as the weth contract, except we're also passing the addresses of the already deployed WETH contract, and the default middleware contract address.
 
Again, I have all of this done for you the [repo](https://github.com/evan-forbes/UniswapMoonbeamPost) mentioned earlier. 
 
If we've done everything correctly, then we should be able to deploy our smart contracts on the testnet by using the command  
`truffle migrate --network` 
in a specific order. Keep track of where each contract gets deployed to so that we can pass that address to other deployments.
 
1. WETH
2. GasToken
3. Propane Middleware Contract
4. Uniswap Factory
5. Uniswap Periphery Router 1
 
If you can deploy all of these contracts succesfully, then you are 110% ready to create your own crazy experiments! There's so many different areas worthy of our explaratory efforts. We could incorporate farming into our code above by allowing liquidity providers to earn extra money by staking on middleware contracts that pay them to be ran with each `swap` call. We could even try our hand at porting [layer 2](https://zksync.io/)
 
Stay tuned for my next tutorial, where I go into a deep dive of how to thorougly test, automate, and collect data on our smart contract's usage in real time using golang!
