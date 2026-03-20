// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IERC721 {
    function ownerOf(uint256 tokenId) external view returns (address owner);
    function mint(address to) external returns(uint256);
    function burn(uint256 tokenId) external;
    function transferOwnership(address newOwner) external;
}

interface IUniswapV4StateView {
    function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

interface IVault {
    struct AllowedToken {
        address token;
        address stateView;
        bytes32 poolId;
        bool isToken0; // true = use token0 in pair, false = token1
        bool status;
    }

    struct Deposit {
        uint256 startTimestamp;
        uint256 endTimestamp;
        address[] tokens;
        uint256[] amounts;
        uint256[] startPriceX96;
        bool active;
    }

    function createDeposit(address[] memory tokens, uint256[] memory amounts, uint256 term, address receiver) external returns(uint256);
    function withdraw(uint256 uid) external;
    function emergencyWithdraw(uint256 uid) external;

    function setAllowedToken(address _token, address _stateView, bytes32 _poolId, bool _isToken0, bool _status) external;
    function changeEmergencyPenalty(uint256 _newEmergencyPenalty) external;
    function changeEmergencyPenaltyReceiver(address _newEmergencyPenaltyReveiver) external;

    function viewTokenListById(uint256 uid) external view returns (address[] memory);
    function viewAmountListById(uint256 uid) external view returns (uint256[] memory);
    function viewStartPriceX96ListById(uint256 uid) external view returns (uint256[] memory);

    event TokenUpdated(address token, address stateView, bytes32 poolId, bool isToken0, bool status);
    event NewDeposit(uint256 uid, uint256 startTimestamp, uint256 endTimestamp, address[] tokens, uint256[] amounts, uint256[] prices, address receiver);
    event Withdraw(address indexed user, uint256 uid, bool isEmergency);
    event SetEmergencyPenalty(uint256 emergencyPenalty);
    event SetEmergencyPenaltyReceiver(address emergencyPenaltyReceiver);
    event SetSuccessFee(uint256 successFee);
    event SetSuccessFeeReceiver(address successFeeReceiver);
    event SuccessFeeCharged(uint256 uid, address token, uint256 amount);
}

/**
 * @title Convert tokens to single NFT and unlock them back in future
 * @notice NFT should be withdrawed by uses after some time (depends on term). Also user can use emergency logic to withdraw with penalty in any time.
 */
contract Vault is IVault, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC721 public nftContract;
    
    mapping(address => AllowedToken) public allowedTokens;

    mapping(uint256 => Deposit) public deposits;

    uint256 public constant FEES_DECIMALS = 10000;
    uint256 public constant MAX_TERM = 60 * 60 * 24 * 365 * 5; // 5 years
    uint256 public constant MAX_TOKENS_IN_DEPOSIT = 50;

    uint256 public emergencyPenalty;
    address public emergencyPenaltyReceiver;

    uint256 public successFee;
    address public successFeeReceiver;

    constructor(IERC721 _nftContract, uint256 _emergencyPenalty, address _emergencyPenaltyReceiver, uint256 _successFee, address _successFeeReceiver) Ownable(msg.sender) {
        require(address(_nftContract) != address(0), "nftContract can't be 0x");
        require(address(_emergencyPenaltyReceiver) != address(0), "emergencyPenaltyReceiver can't be 0x");
        require(_emergencyPenalty <= FEES_DECIMALS, "emergencyPenalty is too big");
        require(address(_successFeeReceiver) != address(0), "successFeeReceiver can't be 0x");
        require(_successFee <= FEES_DECIMALS, "successFee is too big");

        nftContract = _nftContract;
        emergencyPenalty = _emergencyPenalty;
        emergencyPenaltyReceiver = _emergencyPenaltyReceiver;
        successFee = _successFee;
        successFeeReceiver = _successFeeReceiver;
    }

    modifier checkMintParams(address[] memory _tokens, uint256[] memory _amounts, uint256 _term) {
        require(0 < _tokens.length && _tokens.length <= MAX_TOKENS_IN_DEPOSIT, "wrong tokens length");
        require(_tokens.length == _amounts.length, "wrong array length");
        require(_term <= MAX_TERM, "term can't be more than MAX_TERM seconds");

        for (uint i = 0; i < _tokens.length; i++) {
            require(_tokens[i] != address(0), "token can't be 0x");
            require(_amounts[i] > 0, "wrong amounts data");

            require(allowedTokens[_tokens[i]].status, "token not allowed");

            for (uint256 j = i + 1; j < _tokens.length; j++) {
                require(_tokens[i] != _tokens[j], "duplicate token");
            }
        }
        _;
    }

    modifier checkWithdrawParams(uint256 _uid) {
        require(deposits[_uid].active, "voucher not active");
        require(nftContract.ownerOf(_uid) == msg.sender, "wrong owner");
        _;
    }

    // --- Admin functions ---

    /**
     * @notice Add or update allowed token. Admin only
     * @param _token address token contract address
     * @param _stateView address uniswap pool manager
     * @param _poolId address uniswap pool ID
     * @param _status bool on/off token
     */
    function setAllowedToken(address _token, address _stateView, bytes32 _poolId, bool _isToken0, bool _status) external onlyOwner {
        require(_token != address(0), "token can't be 0x");
        require(_stateView != address(0), "stateView can't be 0x");

        allowedTokens[_token] = AllowedToken(_token, _stateView, _poolId, _isToken0, _status);

        emit TokenUpdated(_token, _stateView, _poolId, _isToken0, _status);
    }

    /**
     * @notice Change emergency penalty percent. Admin only
     * @param _newEmergencyPenalty uint256 new emergency penalty percent (decimals: 4)
     */
    function changeEmergencyPenalty(uint256 _newEmergencyPenalty) external override onlyOwner {
        require(_newEmergencyPenalty <= FEES_DECIMALS, "emergencyPenalty is too big");
        emergencyPenalty = _newEmergencyPenalty;

        emit SetEmergencyPenalty(emergencyPenalty);
    }

    /**
     * @notice Change emergency penalty receiver. Admin only
     * @param _newEmergencyPenaltyReveiver address new emergency penalty receiver
     */
    function changeEmergencyPenaltyReceiver(address _newEmergencyPenaltyReveiver) external override onlyOwner {
        require(address(_newEmergencyPenaltyReveiver) != address(0), "emergencyPenaltyReceiver can't be 0x");
        emergencyPenaltyReceiver = _newEmergencyPenaltyReveiver;

        emit SetEmergencyPenaltyReceiver(emergencyPenaltyReceiver);
    }

    /**
     * @notice Change success fee percent. Admin only
     * @param _newSuccessFee uint256 new success fee percent (decimals: 4)
     */
    function changeSuccessFee(uint256 _newSuccessFee) external onlyOwner {
        require(_newSuccessFee <= FEES_DECIMALS, "fee too big");
        successFee = _newSuccessFee;

        emit SetSuccessFee(successFee);
    }

    /**
     * @notice Change success fee receiver. Admin only
     * @param _successFeeReceiver address new success fee receiver
     */
    function changeSuccessFeeReceiver(address _successFeeReceiver) external onlyOwner {
        require(_successFeeReceiver != address(0), "zero address");
        successFeeReceiver = _successFeeReceiver;

        emit SetSuccessFeeReceiver(_successFeeReceiver);
    }

    // --- User functions ---

    /**
     * @notice Create new deposit.
     * @dev The user must first approve `amount` for all tokens. Support only standard, don't use charged-on-sender or rebasing/reflection tokens.
     *      If user use fee-on-transfer tokens, he can receive less tokens on withdrawal flow.
     * @param _tokens address[] tokens (smart contracts) list
     * @param _amounts uint256[] amounts for each token, shoud be the same length as _tokens
     * @param _term uint256 deposit term in seconds
     * @param receiver address NFT receiver
     */
    function createDeposit(address[] memory _tokens, uint256[] memory _amounts, uint256 _term, address receiver) external override nonReentrant checkMintParams(_tokens, _amounts, _term) returns(uint256) {
        require(receiver != address(0), "receiver can't be 0x");
        
        uint256 length = _tokens.length;

        uint256[] memory prices = new uint256[](length);
        
        for (uint256 i = 0; i < length; i++) {
            AllowedToken memory allowed = allowedTokens[_tokens[i]];

            prices[i] = _getV4PriceX96(allowed);

            IERC20 token = IERC20(_tokens[i]);

            uint256 balanceBefore = token.balanceOf(address(this));
            token.safeTransferFrom(msg.sender, address(this), _amounts[i]);

            // Support txfee tokens or partial withdraw for prevent failed withdrawals
            _amounts[i] = token.balanceOf(address(this)) - balanceBefore;
        }

        uint256 uid = nftContract.mint(receiver);

        deposits[uid] = Deposit(
            block.timestamp,
            block.timestamp + _term,
            _tokens,
            _amounts,
            prices,
            true
        );

        emit NewDeposit(uid, block.timestamp, block.timestamp + _term, _tokens, _amounts, prices, receiver);
        
        return uid;
    }

    /**
     * @notice Withdraw a deposit.
     * @dev After using fee-on-transfer tokens the dust can leave on contract balance.
     * @dev Success fee charged from each token proportionally
     * @param _uid uint256 deposit UID
     */
    function withdraw(uint256 _uid) external override nonReentrant checkWithdrawParams(_uid) {
        Deposit storage deposit = deposits[_uid];
        require(block.timestamp >= deposit.endTimestamp, "claim: too early");

        deposit.active = false;

        uint256 length = deposit.tokens.length;
        address[] memory tokens = deposit.tokens;
        uint256[] memory amounts = deposit.amounts;
        uint256[] memory startPrices = deposit.startPriceX96;

        uint256 profit = _calculateDepositProfit(_uid);

        if (profit == 0) {
            for (uint256 i; i < length; ) {
                _safeTransferAndCheckDebit(IERC20(tokens[i]), msg.sender, amounts[i]);
                unchecked { ++i; }
            }

            nftContract.burn(_uid);
            emit Withdraw(msg.sender, _uid, false);
            return;
        }

        uint256 initialValue = 0;
        for (uint256 i; i < length; ) {
            initialValue += (amounts[i] * startPrices[i]) >> 96;
            unchecked { ++i; }
        }

        uint256 currentValue = initialValue + profit;

        uint256 successFeeFraction = (profit * successFee) / currentValue;

        for (uint256 i; i < length; ) {
            IERC20 token = IERC20(tokens[i]);
            uint256 tokenFeeAmount = (amounts[i] * successFeeFraction) / FEES_DECIMALS;

            if (tokenFeeAmount > 0) {
                _safeTransferAndCheckDebit(token, successFeeReceiver, tokenFeeAmount);
                emit SuccessFeeCharged(_uid, tokens[i], tokenFeeAmount);
            }

            _safeTransferAndCheckDebit(token, msg.sender, amounts[i] - tokenFeeAmount);
            unchecked { ++i; }
        }

        nftContract.burn(_uid);
        emit Withdraw(msg.sender, _uid, false);
    }

    /**
     * @notice Withdraw a deposit.
     * @dev Use it only in emergency cases. After using fee-on-transfer tokens the dust can leave on contract balance.
     * @param _uid uint256 deposit UID
     */
    function emergencyWithdraw(uint256 _uid) external override nonReentrant checkWithdrawParams(_uid) {
        Deposit storage deposit = deposits[_uid];

        deposit.active = false;

        for (uint index = 0; index < deposit.tokens.length; index++) {
            IERC20 token = IERC20(deposit.tokens[index]);
            uint256 penalty = deposit.amounts[index] * emergencyPenalty / FEES_DECIMALS;

            if (penalty > 0) {
                _safeTransferAndCheckDebit(token, emergencyPenaltyReceiver, penalty);
            }

            _safeTransferAndCheckDebit(token, msg.sender, deposit.amounts[index] - penalty);
        }

        nftContract.burn(_uid);

        emit Withdraw(msg.sender, _uid, true);
    }

    // --- Internal logic ---

    function _getV4PriceX96(AllowedToken memory allowed) internal view returns (uint256) {
        IUniswapV4StateView manager = IUniswapV4StateView(allowed.stateView);

        (uint160 sqrtPriceX96,,,) = manager.getSlot0(allowed.poolId);
        require(sqrtPriceX96 > 0, "no price");

        // price of token1/token0 in Q96
        uint256 directPriceX96 = (uint256(sqrtPriceX96) * uint256(sqrtPriceX96)) >> 96;
        require(directPriceX96 > 0, "bad price");

        if (allowed.isToken0) {
            return directPriceX96;
        }

        // inverse price in Q96: (2^192) / directPriceX96
        return (uint256(1) << 192) / directPriceX96;
    }

    function _safeTransferAndCheckDebit(IERC20 token, address to, uint256 amount) internal {
        if (amount == 0) return;

        uint256 beforeBal = token.balanceOf(address(this));
        token.safeTransfer(to, amount);
        uint256 afterBal = token.balanceOf(address(this));

        require(beforeBal - afterBal == amount, "unsupported token mechanics");
    }

    /**
    * @notice Calculate total absolute profit in USDT for a deposit
    * @param _uid Deposit UID
    * @return totalProfit uint256 total profit in USDT
    */
    function _calculateDepositProfit(uint256 _uid) internal view returns (uint256 totalProfit) {
        Deposit storage deposit = deposits[_uid];
        uint256 length = deposit.tokens.length;

        int256 netProfit = 0;

        for (uint256 i = 0; i < length; i++) {
            address token = deposit.tokens[i];
            AllowedToken memory allowed = allowedTokens[token];

            if (!allowed.status) {
                continue;
            }

            uint256 startPriceX96 = deposit.startPriceX96[i];
            uint256 currentPriceX96 = _getV4PriceX96(allowed);

            uint256 startValue = (deposit.amounts[i] * startPriceX96) >> 96;
            uint256 currentValue = (deposit.amounts[i] * currentPriceX96) >> 96;

            netProfit += int256(currentValue) - int256(startValue);
        }

        if (netProfit > 0) {
            return uint256(netProfit);
        }

        return 0;
    }

    // --- Views ---

    function viewTokenListById(uint256 _uid) public view override returns (address[] memory) {
        return deposits[_uid].tokens;
    }

    function viewAmountListById(uint256 _uid) public view override returns (uint256[] memory) {
        return deposits[_uid].amounts;
    }

    function viewStartPriceX96ListById(uint256 _uid) public view override returns (uint256[] memory) {
        return deposits[_uid].startPriceX96;
    }

    /**
    * @notice Get total deposit profit
    * @param _uid Deposit UID
    * @return totalProfit uint256 total profit
    */
    function getDepositProfit(uint256 _uid) external view returns (uint256) {
        return _calculateDepositProfit(_uid);
    }
}
