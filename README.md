# NFT Vault
v1.0.0 Feb 2, 2026

NFT Vault protocol.

## Setup

1. Deploy **VaultNFT** contract
```
name_ - Token name
symbol_ - Token symbol
baseURI_ - Token base URI (image link ID in the end)
```
2. Deploy **Vault** contract
```
_nftContract - VaultNFT contract
_emergencyPenalty - Emergency withdraw commission (decimals 4)
_emergencyPenaltyReceiver - Emergency withdraw commission receiver address
_successFee - Success fee (decimals 4)
_successFeeReceiver - Success fee receiver address
```
3. Transfer **VaultNFT** contract ownership to **Vault** contract.
4. Add some tokens to **Vault** `allowedTokens`. Method `setAllowedToken`:
```
_token - token address
_stateView - Uniswap v4 state view
_poolId - token-USDT pair pool ID
_isToken0 - token position in pair (true = 0, false = 1)
_status - TRUE (token is active)
```

## Test suite

0. Setup packages
```
yarn
```
1. Run all tests.
```
yarn test
```
