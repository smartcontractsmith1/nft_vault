const Web3 = require('web3');
const BN = Web3.utils.BN;

const tools = require('../scripts/tools');
const VaultNFT = artifacts.require('VaultNFT');
const Vault = artifacts.require('Vault');

contract('Vault | Deposit Tests', ([owner, user, NFTReceiver]) => {
  beforeEach(async() => {
    this.nft = await VaultNFT.new('Vault NFT', 'vNFT', 'https://base.uri/');
    this.vault = await Vault.new(this.nft.address, 2000, owner, 500, owner, { from: owner });
    await this.nft.transferOwnership(this.vault.address, { from: owner });

    this.tokens = await tools.setupTokensForUser(owner, user, this.vault, [
      { name: 'COSMIC', symbol: 'COS', supply: 5000, amount: 2000 },
      { name: 'USDT',   symbol: 'USDT', supply: 5000, amount: 2000 },
      { name: 'USDC',   symbol: 'USDC', supply: 5000, amount: 2000 },
    ]);

    [this.COSMIC, this.USDT, this.USDC] = this.tokens;

    this.stateView = await tools.setupAllowedTokens(owner, this.vault, this.tokens);

    this.maxTokens = (await this.vault.MAX_TOKENS_IN_DEPOSIT()).toNumber();
    this.maxTerm = (await this.vault.MAX_TERM()).toNumber();
  });

  it('Deposit with zero tokens should revert', async() => {
    await tools.expectRevert(
      tools.createDeposit(this.vault, user, [], [], 1),
      'wrong tokens length'
    );
  });

  it('Deposit with mismatched arrays should revert', async() => {
    await tools.expectRevert(
      tools.createDeposit(this.vault, user, [this.COSMIC, this.USDT], [100], 10),
      'wrong array length'
    );
  });

  it('Deposit with zero amount should revert', async() => {
    await tools.expectRevert(
      tools.createDeposit(this.vault, user, [this.COSMIC], [0], 10),
      'wrong amounts data'
    );
  });

  it('Deposit with duplicate tokens should revert', async() => {
    await tools.expectRevert(
      tools.createDeposit(this.vault, user, [this.COSMIC, this.COSMIC], [100, 100], 1),
      'duplicate token'
    );
  });

  it('Deposit exceeding MAX_TERM should revert', async() => {
    await tools.expectRevert(
      tools.createDeposit(this.vault, user, [this.COSMIC], [100], this.maxTerm + 1),
      'term can\'t be more than MAX_TERM seconds'
    );
  });

  it('Deposit with term = MAX_TERM should succeed', async() => {
    const tx = await tools.createDeposit(this.vault, user, [this.COSMIC], [100], this.maxTerm);
    assert.ok(tx.receipt.status);
  });

  it('Deposit exceeding MAX_TOKENS_IN_DEPOSIT should revert', async() => {
    const tooManyTokens = Array(this.maxTokens + 1).fill(this.COSMIC);
    const tooManyAmounts = Array(this.maxTokens + 1).fill(1);
    await tools.expectRevert(
      tools.createDeposit(this.vault, user, tooManyTokens, tooManyAmounts, 10),
      'wrong tokens length'
    );
  });

  it('Deposit with receiver zero address should revert', async() => {
    await tools.expectRevert(
      this.vault.createDeposit(
        [this.COSMIC.address], [100], 10,
        '0x0000000000000000000000000000000000000000',
        { from: user }
      ),
      'receiver can\'t be 0x'
    );
  });

  it('Deposit with term = 0 should succeed', async() => {
    const tx = await tools.createDeposit(this.vault, user, [this.COSMIC], [100], 0);
    assert.ok(tx.receipt.status);
  });

  it('Single token deposit full cycle', async() => {
    const amount = new BN(500);
    const term = 10;

    const beforeBalance = await this.COSMIC.balanceOf(user);
    const tx = await tools.createDeposit(this.vault, user, [this.COSMIC], [amount], term);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();

    await tools.checkNFTOwner(this.nft, uid, user);
    await tools.checkTokenBalance(this.COSMIC, user, beforeBalance.sub(amount));
    await tools.checkTokenBalance(this.COSMIC, this.vault.address, amount);
    await tools.checkDepositActive(this.vault, uid, true);
    await tools.checkDepositTimestamps(this.vault, uid);
    await tools.checkDepositAmounts(this.vault, uid, [this.COSMIC], [amount]);
  });

  it('Multi-token deposit full cycle', async() => {
    const tokens = [this.COSMIC, this.USDT];
    const amounts = [new BN(400), new BN(350)];
    const term = 10;

    const beforeBalances = await Promise.all(tokens.map(t => t.balanceOf(user)));
    const tx = await tools.createDeposit(this.vault, user, tokens, amounts, term);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();

    await tools.checkNFTOwner(this.nft, uid, user);

    for (let i = 0; i < tokens.length; i++) {
      await tools.checkTokenBalance(tokens[i], user, beforeBalances[i].sub(amounts[i]));
      await tools.checkTokenBalance(tokens[i], this.vault.address, amounts[i]);
    }

    await tools.checkDepositActive(this.vault, uid, true);
    await tools.checkDepositTimestamps(this.vault, uid);
    await tools.checkDepositAmounts(this.vault, uid, tokens, amounts);
  });

  it('Deposit for different receiver: NFT goes to receiver, tokens come from sender', async() => {
    const senderBefore = await this.COSMIC.balanceOf(user);
    const vaultBefore = await this.COSMIC.balanceOf(this.vault.address);

    const tx = await this.vault.createDeposit(
      [this.COSMIC.address], [100], 10, NFTReceiver, { from: user }
    );
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();

    await tools.checkNFTOwner(this.nft, uid, NFTReceiver);
    await tools.checkTokenBalance(this.COSMIC, user, senderBefore.sub(new BN(100)));
    await tools.checkTokenBalance(this.COSMIC, this.vault.address, vaultBefore.add(new BN(100)));
    await tools.checkDepositActive(this.vault, uid, true);
  });

  it('NewDeposit event is emitted with correct args', async() => {
    const amount = new BN(500);
    const term = 10;

    const tx = await tools.createDeposit(this.vault, user, [this.COSMIC], [amount], term);
    const event = tx.logs.find(e => e.event === 'NewDeposit');
    const uid = event.args.uid.toNumber();
    assert.ok(event, 'NewDeposit event not emitted');
    assert(new BN(event.args.uid).eq(new BN(uid)), 'Wrong uid in NewDeposit event');
    assert.equal(
      event.args.tokens[0].toLowerCase(), this.COSMIC.address.toLowerCase(), 'Wrong token in event'
    );
    assert(new BN(event.args.amounts[0]).eq(amount), 'Wrong amount in NewDeposit event');
    assert.equal(event.args.receiver.toLowerCase(), user.toLowerCase(), 'Wrong receiver in event');
    assert(
      new BN(event.args.endTimestamp).gt(new BN(event.args.startTimestamp)),
      'Invalid timestamps in event'
    );
  });

  it('Deposit with amount = 1 should succeed', async() => {
    const tx = await tools.createDeposit(this.vault, user, [this.COSMIC], [new BN(1)], 10);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await tools.checkNFTOwner(this.nft, uid, user);
    await tools.checkDepositAmounts(this.vault, uid, [this.COSMIC], [new BN(1)]);
    await tools.checkTokenBalance(this.COSMIC, this.vault.address, new BN(1));
  });

  it('Deposit with amount = 2 should succeed', async() => {
    const tx = await tools.createDeposit(this.vault, user, [this.COSMIC], [new BN(2)], 10);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await tools.checkDepositAmounts(this.vault, uid, [this.COSMIC], [new BN(2)]);
  });

  it('Deposit with amount = 10 should succeed', async() => {
    const tx = await tools.createDeposit(this.vault, user, [this.COSMIC], [new BN(10)], 10);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await tools.checkDepositAmounts(this.vault, uid, [this.COSMIC], [new BN(10)]);
  });

  it('Deposit with full user balance should succeed', async() => {
    const fullBalance = await this.COSMIC.balanceOf(user);
    const tx = await tools.createDeposit(this.vault, user, [this.COSMIC], [fullBalance], 10);
    assert.ok(tx.receipt.status);
    await tools.checkTokenBalance(this.COSMIC, user, new BN(0));
    await tools.checkTokenBalance(this.COSMIC, this.vault.address, fullBalance);
  });

  it('Deposit near full user balance should succeed', async() => {
    const balance = await this.COSMIC.balanceOf(user);
    const amount = balance.subn(1);
    const tx = await tools.createDeposit(this.vault, user, [this.COSMIC], [amount], 10);
    assert.ok(tx.receipt.status);
    await tools.checkTokenBalance(this.COSMIC, user, new BN(1));
  });

  it('Multi-token deposit [1, 1] should succeed', async() => {
    const tx = await tools.createDeposit(this.vault, user, [this.COSMIC, this.USDT], [new BN(1), new BN(1)], 10);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await tools.checkDepositAmounts(this.vault, uid, [this.COSMIC, this.USDT], [new BN(1), new BN(1)]);
  });

  it('Multi-token deposit [1, 100] should succeed', async() => {
    const tx = await tools.createDeposit(
      this.vault, user, [this.COSMIC, this.USDT], [new BN(1), new BN(100)], 10
    );
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await tools.checkDepositAmounts(this.vault, uid, [this.COSMIC, this.USDT], [new BN(1), new BN(100)]);
  });

  it('Multi-token deposit with very different amounts [1, 1500] should succeed', async() => {
    const tx = await tools.createDeposit(
      this.vault, user, [this.COSMIC, this.USDT], [new BN(1), new BN(1500)], 10
    );
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await tools.checkDepositAmounts(this.vault, uid, [this.COSMIC, this.USDT], [new BN(1), new BN(1500)]);
  });
});

contract('Vault | Deposit Allowed Token Tests', ([owner, user]) => {
  beforeEach(async() => {
    this.nft = await artifacts.require('VaultNFT').new('Vault NFT', 'vNFT', 'baseURI');
    this.vault = await artifacts.require('Vault').new(
      this.nft.address, 0, owner, 0, owner, { from: owner }
    );
    await this.nft.transferOwnership(this.vault.address, { from: owner });

    this.stateView = await artifacts.require('UniswapV4PoolManagerMock').new();
    const sqrtPriceX96 = '281474976710656';

    this.COSMIC = await artifacts.require('ERC20Mock').new('COSMIC', 'COS', owner, 10000);
    this.USDT   = await artifacts.require('ERC20Mock').new('USDT',   'USDT', owner, 10000);
    this.USDC   = await artifacts.require('ERC20Mock').new('USDC',   'USDC', owner, 10000);

    for (const token of [this.COSMIC, this.USDT, this.USDC]) {
      await token.transfer(user, 5000, { from: owner });
      await token.approve(this.vault.address, 5000, { from: user });
      const poolId = '0x' + token.address.replace('0x', '').toLowerCase().padStart(64, '0');
      await this.stateView.setPrice(poolId, sqrtPriceX96);
      await this.vault.setAllowedToken(token.address, this.stateView.address, poolId, true, true, { from: owner });
    }

    this.poolIdOf = (token) => '0x' + token.address.replace('0x', '').toLowerCase().padStart(64, '0');
  });

  it('Deposit with zero address token should revert', async() => {
    await tools.expectRevert(
      tools.createDeposit(this.vault, user, [{ address: '0x0000000000000000000000000000000000000000' }], [100], 10),
      'token can\'t be 0x'
    );
  });

  it('Deposit with never-allowed token should revert', async() => {
    const stranger = await artifacts.require('ERC20Mock').new('STRANGER', 'STR', owner, 1000);
    await stranger.transfer(user, 500, { from: owner });
    await stranger.approve(this.vault.address, 500, { from: user });

    await tools.expectRevert(
      tools.createDeposit(this.vault, user, [stranger], [100], 10),
      'token not allowed'
    );
  });

  it('Deposit after token disabled should revert', async() => {
    await this.vault.setAllowedToken(
      this.COSMIC.address, this.stateView.address, this.poolIdOf(this.COSMIC), true, false, { from: owner }
    );

    await tools.expectRevert(
      tools.createDeposit(this.vault, user, [this.COSMIC], [100], 10),
      'token not allowed'
    );
  });

  it('Re-enable disabled token allows deposit again', async() => {
    await this.vault.setAllowedToken(
      this.COSMIC.address, this.stateView.address, this.poolIdOf(this.COSMIC), true, false, { from: owner }
    );
    await this.vault.setAllowedToken(
      this.COSMIC.address, this.stateView.address, this.poolIdOf(this.COSMIC), true, true, { from: owner }
    );

    const tx = await tools.createDeposit(this.vault, user, [this.COSMIC], [100], 10);
    assert.ok(tx.receipt.status);
  });

  it('Multi-token deposit with one never-allowed token should revert', async() => {
    const stranger = await artifacts.require('ERC20Mock').new('STRANGER', 'STR', owner, 1000);
    await stranger.transfer(user, 500, { from: owner });
    await stranger.approve(this.vault.address, 500, { from: user });

    await tools.expectRevert(
      tools.createDeposit(this.vault, user, [this.COSMIC, stranger], [100, 100], 10),
      'token not allowed'
    );
  });

  it('Multi-token deposit with one disabled token should revert', async() => {
    await this.vault.setAllowedToken(
      this.USDT.address, this.stateView.address, this.poolIdOf(this.USDT), true, false, { from: owner }
    );

    await tools.expectRevert(
      tools.createDeposit(this.vault, user, [this.COSMIC, this.USDT, this.USDC], [100, 100, 100], 10),
      'token not allowed'
    );
  });

  it('Multi-token deposit with all tokens enabled should succeed', async() => {
    const tx = await tools.createDeposit(
      this.vault, user, [this.COSMIC, this.USDT, this.USDC], [100, 200, 300], 10
    );
    assert.ok(tx.receipt.status);
  });

  it('Token disabled after deposit: normal withdraw still succeeds', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 500, 2);

    await this.vault.setAllowedToken(
      this.COSMIC.address, this.stateView.address, this.poolIdOf(this.COSMIC), true, false, { from: owner }
    );

    const balanceBefore = await this.COSMIC.balanceOf(user);
    await tools.advanceTime(3);
    await this.vault.withdraw(uid, { from: user });

    await tools.checkTokenBalance(this.COSMIC, user, balanceBefore.add(new BN(500)));
    await tools.checkNFTBurned(this.nft, uid);
    await tools.checkDepositActive(this.vault, uid, false);
  });

  it('Deposit with token having no pool price should revert', async() => {
    const noPrice = await artifacts.require('ERC20Mock').new('NO_PRICE', 'NP', owner, 1000);
    await noPrice.transfer(user, 500, { from: owner });
    await noPrice.approve(this.vault.address, 500, { from: user });
    const poolId = '0x' + noPrice.address.replace('0x', '').toLowerCase().padStart(64, '0');

    await this.vault.setAllowedToken(noPrice.address, this.stateView.address, poolId, true, true, { from: owner });

    await tools.expectRevert(
      tools.createDeposit(this.vault, user, [noPrice], [100], 10),
      'no price'
    );
  });

  it('Token disabled after deposit: emergency withdraw still succeeds', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 500, 100);

    await this.vault.setAllowedToken(
      this.COSMIC.address, this.stateView.address, this.poolIdOf(this.COSMIC), true, false, { from: owner }
    );

    const balanceBefore = await this.COSMIC.balanceOf(user);
    await this.vault.emergencyWithdraw(uid, { from: user });

    await tools.checkTokenBalance(this.COSMIC, user, balanceBefore.add(new BN(500)));
    await tools.checkNFTBurned(this.nft, uid);
    await tools.checkDepositActive(this.vault, uid, false);
  });

  it('viewTokenListById: returns tokens array matching deposited tokens', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 100, 10);
    const tokens = await this.vault.viewTokenListById(uid);
    assert.equal(tokens.length, 1, 'wrong length for single-token deposit');
    assert.equal(tokens[0].toLowerCase(), this.COSMIC.address.toLowerCase(), 'wrong token address');
  });

  it('viewAmountListById: returns amounts array matching deposited amounts', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 100, 10);
    const amounts = await this.vault.viewAmountListById(uid);
    assert.equal(amounts.length, 1, 'wrong length for single-token deposit');
    assert(new BN(amounts[0]).eq(new BN(100)), 'wrong amount');
  });

  it('viewStartPriceX96ListById: returns prices array matching deposited tokens', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 100, 10);
    const prices = await this.vault.viewStartPriceX96ListById(uid);
    assert.equal(prices.length, 1, 'wrong length for single-token deposit');
    assert(new BN(prices[0].toString()).gt(new BN(0)), 'price should be > 0');
  });

  it('MAX_TOKENS_IN_DEPOSIT: contract limit is 50; exceeding it reverts (see Deposit Tests)', async() => {
    const maxTokens = (await this.vault.MAX_TOKENS_IN_DEPOSIT()).toNumber();
    assert.equal(maxTokens, 50, 'MAX_TOKENS_IN_DEPOSIT should be 50');
  });

  it('price-zero: createDeposit reverts on missing price; withdraw reverts if price drops to 0', async() => {
    const noPrice = await artifacts.require('ERC20Mock').new('NP', 'NP', owner, 1000);
    await noPrice.transfer(user, 500, { from: owner });
    await noPrice.approve(this.vault.address, 500, { from: user });
    const noPricePoolId = '0x' + noPrice.address.replace('0x', '').toLowerCase().padStart(64, '0');
    await this.vault.setAllowedToken(noPrice.address, this.stateView.address, noPricePoolId, true, true, { from: owner });
    await tools.expectRevert(tools.createDeposit(this.vault, user, [noPrice], [100], 10), 'no price');

    const uid = await tools.setupSingleDeposit(this.vault, user, this.USDT, 100, 2);
    await this.stateView.setPrice(this.poolIdOf(this.USDT), '0');
    await tools.advanceTime(3);
    await tools.expectRevert(this.vault.withdraw(uid, { from: user }), 'no price');
  });
});
