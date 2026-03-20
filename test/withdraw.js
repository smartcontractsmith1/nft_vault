const Web3 = require('web3');
const BN = Web3.utils.BN;
const TWO = new BN(2);

const tools = require('../scripts/tools');

contract('Vault | Withdraw Tests', ([owner, user, otherUser, penaltyReceiver]) => {
  beforeEach(async() => {
    this.nft = await artifacts.require('VaultNFT').new('Vault NFT', 'vNFT', 'baseURI');
    this.vault = await artifacts.require('Vault').new(
      this.nft.address, 2000, penaltyReceiver, 500, penaltyReceiver, { from: owner }
    );
    await this.nft.transferOwnership(this.vault.address, { from: owner });

    this.tokens = await tools.setupTokensForUser(owner, user, this.vault, [
      { name: 'COSMIC', symbol: 'COS', supply: 5000, amount: 2000 },
      { name: 'USDT',   symbol: 'USDT', supply: 5000, amount: 2000 },
      { name: 'USDC',   symbol: 'USDC', supply: 5000, amount: 2000 },
    ]);
    [this.COSMIC, this.USDT, this.USDC] = this.tokens;

    this.stateView = await tools.setupAllowedTokens(owner, this.vault, this.tokens);
  });

  it('Withdraw after term should succeed', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 1000, 2);
    const balanceBefore = await this.COSMIC.balanceOf(user);
    const vaultBalanceBefore = await this.COSMIC.balanceOf(this.vault.address);

    await tools.advanceTime(3);
    await tools.withdraw(this.vault, user, uid);

    await tools.checkNFTBurned(this.nft, uid);
    await tools.checkDepositActive(this.vault, uid, false);
    await tools.checkTokenBalance(this.COSMIC, user, balanceBefore.add(new BN(1000)));
    await tools.checkTokenBalance(this.COSMIC, this.vault.address, vaultBalanceBefore.sub(new BN(1000)));
  });

  it('Withdraw too early should revert', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 500, 100);
    await tools.expectRevert(this.vault.withdraw(uid, { from: user }), 'claim: too early');
  });

  it('Withdraw with term = 0 should succeed immediately', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 500, 0);
    const balanceBefore = await this.COSMIC.balanceOf(user);

    await tools.advanceTime(1);
    await tools.withdraw(this.vault, user, uid);

    await tools.checkTokenBalance(this.COSMIC, user, balanceBefore.add(new BN(500)));
    await tools.checkNFTBurned(this.nft, uid);
    await tools.checkDepositActive(this.vault, uid, false);
  });

  it('Withdraw by non-owner should revert', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 500, 2);
    await tools.expectRevert(this.vault.withdraw(uid, { from: otherUser }), 'wrong owner');
  });

  it('Withdraw after emergency withdraw should revert', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 500, 2);
    await tools.emergencyWithdraw(this.vault, user, uid);
    await tools.expectRevert(this.vault.withdraw(uid, { from: user }), 'voucher not active');
  });

  it('Double normal withdraw should revert', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 500, 2);
    await tools.advanceTime(3);
    await tools.withdraw(this.vault, user, uid);
    await tools.expectRevert(this.vault.withdraw(uid, { from: user }), 'voucher not active');
  });

  it('Multi-token withdraw after term should succeed', async() => {
    const tokens = [this.COSMIC, this.USDT, this.USDC];
    const amounts = [100, 200, 300];
    const uid = await tools.setupMultiDeposit(this.vault, user, tokens, amounts, 2);

    const balancesBefore = await Promise.all(tokens.map(t => t.balanceOf(user)));
    const vaultBalancesBefore = await Promise.all(tokens.map(t => t.balanceOf(this.vault.address)));

    await tools.advanceTime(3);
    await tools.withdraw(this.vault, user, uid);

    for (let i = 0; i < tokens.length; i++) {
      await tools.checkTokenBalance(tokens[i], user, balancesBefore[i].add(new BN(amounts[i])));
      await tools.checkTokenBalance(tokens[i], this.vault.address, vaultBalancesBefore[i].sub(new BN(amounts[i])));
    }

    await tools.checkNFTBurned(this.nft, uid);
    await tools.checkDepositActive(this.vault, uid, false);
  });

  it('Sequential deposits withdraw should succeed', async() => {
    const uid1 = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 100, 2);
    const uid2 = await tools.setupSingleDeposit(this.vault, user, this.USDT, 200, 2);

    const balancesBefore = [
      await this.COSMIC.balanceOf(user),
      await this.USDT.balanceOf(user),
    ];
    const vaultCosmicBefore = await this.COSMIC.balanceOf(this.vault.address);
    const vaultUsdtBefore = await this.USDT.balanceOf(this.vault.address);

    await tools.advanceTime(3);
    await tools.withdraw(this.vault, user, uid1);
    await tools.withdraw(this.vault, user, uid2);

    await tools.checkNFTBurned(this.nft, uid1);
    await tools.checkNFTBurned(this.nft, uid2);
    await tools.checkDepositActive(this.vault, uid1, false);
    await tools.checkDepositActive(this.vault, uid2, false);

    await tools.checkTokenBalance(this.COSMIC, user, balancesBefore[0].add(new BN(100)));
    await tools.checkTokenBalance(this.USDT, user, balancesBefore[1].add(new BN(200)));
    await tools.checkTokenBalance(this.COSMIC, this.vault.address, vaultCosmicBefore.sub(new BN(100)));
    await tools.checkTokenBalance(this.USDT, this.vault.address, vaultUsdtBefore.sub(new BN(200)));
  });

  it('NFT transfer: recipient can withdraw deposit', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 100, 2);

    await this.nft.transferFrom(user, otherUser, uid, { from: user });
    await tools.checkNFTOwner(this.nft, uid, otherUser);

    const balanceBefore = await this.COSMIC.balanceOf(otherUser);
    await tools.advanceTime(3);
    await this.vault.withdraw(uid, { from: otherUser });

    await tools.checkTokenBalance(this.COSMIC, otherUser, balanceBefore.add(new BN(100)));
    await tools.checkNFTBurned(this.nft, uid);
    await tools.checkDepositActive(this.vault, uid, false);
  });

  it('NFT transfer: original owner cannot withdraw after transfer', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 100, 2);

    await this.nft.transferFrom(user, otherUser, uid, { from: user });
    await tools.advanceTime(3);

    await tools.expectRevert(this.vault.withdraw(uid, { from: user }), 'wrong owner');
  });

  it('Withdraw with nonexistent uid should revert', async() => {
    await tools.expectRevert(this.vault.withdraw(9999, { from: user }));
  });

  it('deposit → withdraw → new deposit with same token succeeds', async() => {
    const uid1 = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 500, 2);

    await tools.advanceTime(3);
    await tools.withdraw(this.vault, user, uid1);
    await tools.checkDepositActive(this.vault, uid1, false);

    const uid2 = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 500, 2);
    await tools.checkNFTOwner(this.nft, uid2, user);
    await tools.checkDepositActive(this.vault, uid2, true);
    assert(uid2 !== uid1, 'second deposit must have a different uid');
  });
});

contract('Vault | Withdraw Success Fee Tests', ([owner, user, penaltyReceiver, successFeeReceiver]) => {
  beforeEach(async() => {
    this.nft = await artifacts.require('VaultNFT').new('Vault NFT', 'vNFT', 'baseURI');
    this.vault = await artifacts.require('Vault').new(
      this.nft.address, 0, penaltyReceiver, 500, successFeeReceiver, { from: owner }
    );
    await this.nft.transferOwnership(this.vault.address, { from: owner });

    this.stateView = await artifacts.require('UniswapV4PoolManagerMock').new();

    this.TOKEN_A = await artifacts.require('ERC20Mock').new('TOKEN A', 'TKA', owner, 100000);
    this.TOKEN_B = await artifacts.require('ERC20Mock').new('TOKEN B', 'TKB', owner, 100000);

    for (const token of [this.TOKEN_A, this.TOKEN_B]) {
      await token.transfer(user, 50000, { from: owner });
      await token.approve(this.vault.address, 50000, { from: user });
      const poolId = '0x' + token.address.replace('0x', '').toLowerCase().padStart(64, '0');
      await this.vault.setAllowedToken(token.address, this.stateView.address, poolId, true, true, { from: owner });
    }

    this.poolIdA = '0x' + this.TOKEN_A.address.replace('0x', '').toLowerCase().padStart(64, '0');
    this.poolIdB = '0x' + this.TOKEN_B.address.replace('0x', '').toLowerCase().padStart(64, '0');

    this.BASE_PRICE = TWO.pow(new BN(96));
    this.HIGH_PRICE = TWO.pow(new BN(97));
    this.LOW_PRICE  = TWO.pow(new BN(95));

    this.FEES_DECIMALS = new BN(await this.vault.FEES_DECIMALS());
    this.FEE_BPS       = new BN(await this.vault.successFee());
  });

  it('no profit: price unchanged or drops → no fee charged, full amount returned', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    let tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A], [AMOUNT], TERM);
    let uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    let userBefore = await this.TOKEN_A.balanceOf(user);
    let feeBefore  = await this.TOKEN_A.balanceOf(successFeeReceiver);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });
    assert((await this.TOKEN_A.balanceOf(user)).sub(userBefore).eq(AMOUNT), 'unchanged: user full amount');
    assert((await this.TOKEN_A.balanceOf(successFeeReceiver)).eq(feeBefore), 'unchanged: no fee');

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A], [AMOUNT], TERM);
    uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await this.stateView.setPrice(this.poolIdA, this.LOW_PRICE);
    userBefore = await this.TOKEN_A.balanceOf(user);
    feeBefore  = await this.TOKEN_A.balanceOf(successFeeReceiver);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });
    assert((await this.TOKEN_A.balanceOf(user)).sub(userBefore).eq(AMOUNT), 'drop: user full amount');
    assert((await this.TOKEN_A.balanceOf(successFeeReceiver)).eq(feeBefore), 'drop: no fee');
  });

  it('fee boundaries: successFee=0 → no fee; successFee=max → protocol takes all profit', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;

    await this.vault.changeSuccessFee(0, { from: owner });
    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    let tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A], [AMOUNT], TERM);
    let uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);
    let feeBefore = await this.TOKEN_A.balanceOf(successFeeReceiver);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });
    assert((await this.TOKEN_A.balanceOf(successFeeReceiver)).eq(feeBefore), 'fee=0: no fee charged');

    const MAX_FEE    = this.FEES_DECIMALS;
    const profit100  = AMOUNT.muln(3);
    const current100 = AMOUNT.add(profit100);
    const frac100    = profit100.mul(MAX_FEE).div(current100);
    const expFee100  = AMOUNT.mul(frac100).div(this.FEES_DECIMALS);
    const expUser100 = AMOUNT.sub(expFee100);
    await this.vault.changeSuccessFee(MAX_FEE, { from: owner });
    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A], [AMOUNT], TERM);
    uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);
    feeBefore         = await this.TOKEN_A.balanceOf(successFeeReceiver);
    const userBefore  = await this.TOKEN_A.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });
    const feeGot100  = (await this.TOKEN_A.balanceOf(successFeeReceiver)).sub(feeBefore);
    const userGot100 = (await this.TOKEN_A.balanceOf(user)).sub(userBefore);
    assert(feeGot100.eq(expFee100), `fee=100%: expected ${expFee100}, got ${feeGot100}`);
    assert(userGot100.eq(expUser100), `fee=100%: user expected ${expUser100}, got ${userGot100}`);
  });

  it('single-token 4x price with 5% fee: fee and user amount computed from contract constants', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;

    const profit      = AMOUNT.muln(3);
    const currentVal  = AMOUNT.add(profit);
    const feeFraction = profit.mul(this.FEE_BPS).div(currentVal);
    const expFee      = AMOUNT.mul(feeFraction).div(this.FEES_DECIMALS);
    const expUser     = AMOUNT.sub(expFee);

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    const tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A], [AMOUNT], TERM);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);

    const feeBefore  = await this.TOKEN_A.balanceOf(successFeeReceiver);
    const userBefore = await this.TOKEN_A.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });

    assert((await this.TOKEN_A.balanceOf(successFeeReceiver)).sub(feeBefore).eq(expFee), `fee: expected ${expFee}`);
    assert((await this.TOKEN_A.balanceOf(user)).sub(userBefore).eq(expUser), `user: expected ${expUser}`);
  });

  it('multi-token no profit: unchanged and both drop → full amounts returned, no fee', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.BASE_PRICE);
    let tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A, this.TOKEN_B], [AMOUNT, AMOUNT], TERM);
    let uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    let userBeforeA = await this.TOKEN_A.balanceOf(user);
    let userBeforeB = await this.TOKEN_B.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });
    assert((await this.TOKEN_A.balanceOf(user)).sub(userBeforeA).eq(AMOUNT), 'no-change: user_A');
    assert((await this.TOKEN_B.balanceOf(user)).sub(userBeforeB).eq(AMOUNT), 'no-change: user_B');

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.BASE_PRICE);
    tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A, this.TOKEN_B], [AMOUNT, AMOUNT], TERM);
    uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await this.stateView.setPrice(this.poolIdA, this.LOW_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.LOW_PRICE);
    userBeforeA = await this.TOKEN_A.balanceOf(user);
    userBeforeB = await this.TOKEN_B.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });
    assert((await this.TOKEN_A.balanceOf(user)).sub(userBeforeA).eq(AMOUNT), 'drop: user_A');
    assert((await this.TOKEN_B.balanceOf(user)).sub(userBeforeB).eq(AMOUNT), 'drop: user_B');
  });

  it('multi-token profit: fee distributed proportionally across all tokens', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.BASE_PRICE);
    let tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A, this.TOKEN_B], [AMOUNT, AMOUNT], TERM);
    let uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);
    const partialProfit  = AMOUNT.muln(3);
    const partialCurrent = AMOUNT.muln(2).add(partialProfit);
    const partialFrac    = partialProfit.mul(this.FEE_BPS).div(partialCurrent);
    const partialFeeEach = AMOUNT.mul(partialFrac).div(this.FEES_DECIMALS);
    let userBeforeA = await this.TOKEN_A.balanceOf(user);
    let userBeforeB = await this.TOKEN_B.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });
    assert((await this.TOKEN_A.balanceOf(user)).sub(userBeforeA).eq(AMOUNT.sub(partialFeeEach)), 'partial: user_A');
    assert((await this.TOKEN_B.balanceOf(user)).sub(userBeforeB).eq(AMOUNT.sub(partialFeeEach)), 'partial: user_B');

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.BASE_PRICE);
    tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A, this.TOKEN_B], [AMOUNT, AMOUNT], TERM);
    uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.HIGH_PRICE);
    const bothProfit  = AMOUNT.muln(6);
    const bothCurrent = AMOUNT.muln(2).add(bothProfit);
    const bothFrac    = bothProfit.mul(this.FEE_BPS).div(bothCurrent);
    const bothFeeEach = AMOUNT.mul(bothFrac).div(this.FEES_DECIMALS);
    userBeforeA = await this.TOKEN_A.balanceOf(user);
    userBeforeB = await this.TOKEN_B.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });
    assert((await this.TOKEN_A.balanceOf(user)).sub(userBeforeA).eq(AMOUNT.sub(bothFeeEach)), 'both-rise: user_A');
    assert((await this.TOKEN_B.balanceOf(user)).sub(userBeforeB).eq(AMOUNT.sub(bothFeeEach)), 'both-rise: user_B');
  });

  it('multi-token: one up one down net positive → fee charged on both tokens', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.BASE_PRICE);
    const tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A, this.TOKEN_B], [AMOUNT, AMOUNT], TERM);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();

    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.LOW_PRICE);

    const profitA    = AMOUNT.muln(3);
    const lossB      = AMOUNT.sub(AMOUNT.divn(4));
    const netProfit  = profitA.sub(lossB);
    const initVal    = AMOUNT.muln(2);
    const curVal     = initVal.add(netProfit);
    const feeFrac    = netProfit.mul(this.FEE_BPS).div(curVal);
    const feeEach    = AMOUNT.mul(feeFrac).div(this.FEES_DECIMALS);

    const userBeforeA = await this.TOKEN_A.balanceOf(user);
    const userBeforeB = await this.TOKEN_B.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });

    assert((await this.TOKEN_A.balanceOf(user)).sub(userBeforeA).eq(AMOUNT.sub(feeEach)), 'up-down: user_A');
    assert((await this.TOKEN_B.balanceOf(user)).sub(userBeforeB).eq(AMOUNT.sub(feeEach)), 'up-down: user_B');
  });

  it('multi-token: one disabled at withdrawal, profit from enabled only, fee charged on all', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;
    const disabledProfit  = AMOUNT.muln(3);
    const disabledCurrent = AMOUNT.muln(2).add(disabledProfit);
    const disabledFrac    = disabledProfit.mul(this.FEE_BPS).div(disabledCurrent);
    const disabledFeeEach = AMOUNT.mul(disabledFrac).div(this.FEES_DECIMALS);

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.BASE_PRICE);
    const tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A, this.TOKEN_B], [AMOUNT, AMOUNT], TERM);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();

    await this.vault.setAllowedToken(
      this.TOKEN_B.address, this.stateView.address, this.poolIdB, true, false, { from: owner }
    );
    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);

    const userBeforeA = await this.TOKEN_A.balanceOf(user);
    const userBeforeB = await this.TOKEN_B.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });

    assert((await this.TOKEN_A.balanceOf(user)).sub(userBeforeA).eq(AMOUNT.sub(disabledFeeEach)), 'disabled: user_A');
    assert((await this.TOKEN_B.balanceOf(user)).sub(userBeforeB).eq(AMOUNT.sub(disabledFeeEach)), 'disabled: user_B');
  });

  it('events: SuccessFeeCharged on profit; absent on no profit; Withdraw always emitted', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;
    const profit      = AMOUNT.muln(3);
    const currentVal  = AMOUNT.add(profit);
    const feeFraction = profit.mul(this.FEE_BPS).div(currentVal);
    const expFee      = AMOUNT.mul(feeFraction).div(this.FEES_DECIMALS);

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    let tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A], [AMOUNT], TERM);
    let uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);
    await tools.advanceTime(TERM + 1);
    let wTx       = await this.vault.withdraw(uid, { from: user });
    let feeEvent  = wTx.logs.find(e => e.event === 'SuccessFeeCharged');
    let wEvent    = wTx.logs.find(e => e.event === 'Withdraw');
    assert.ok(feeEvent, 'profit: SuccessFeeCharged not emitted');
    assert.ok(wEvent,   'profit: Withdraw not emitted');
    assert(new BN(feeEvent.args.uid).eq(new BN(uid)), 'SuccessFeeCharged: wrong uid');
    assert.equal(feeEvent.args.token.toLowerCase(), this.TOKEN_A.address.toLowerCase(), 'SuccessFeeCharged: token');
    assert(new BN(feeEvent.args.amount).eq(expFee), `SuccessFeeCharged: amount expected ${expFee}`);

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A], [AMOUNT], TERM);
    uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await tools.advanceTime(TERM + 1);
    wTx      = await this.vault.withdraw(uid, { from: user });
    feeEvent = wTx.logs.find(e => e.event === 'SuccessFeeCharged');
    wEvent   = wTx.logs.find(e => e.event === 'Withdraw');
    assert(!feeEvent, 'no-profit: SuccessFeeCharged should not be emitted');
    assert.ok(wEvent, 'no-profit: Withdraw not emitted');
    assert.equal(wEvent.args.isEmergency, false, 'Withdraw: isEmergency should be false');
    assert.equal(wEvent.args.user.toLowerCase(), user.toLowerCase(), 'Withdraw: wrong user');
  });

  it('getDepositProfit: returns 0 on no price change; returns profit on 4x rise', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;
    const expProfit = AMOUNT.muln(3);

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    const tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A], [AMOUNT], TERM);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();

    assert(new BN(await this.vault.getDepositProfit(uid)).eq(new BN(0)), 'no change: profit = 0');

    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);
    assert(new BN(await this.vault.getDepositProfit(uid)).eq(expProfit), `4x rise: profit = ${expProfit}`);
  });

  it('isToken0=false: sqrtPrice drops (token appreciates) → fee charged', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;

    await this.vault.setAllowedToken(
      this.TOKEN_A.address, this.stateView.address, this.poolIdA, false, true, { from: owner }
    );

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    const tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A], [AMOUNT], TERM);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await this.stateView.setPrice(this.poolIdA, this.LOW_PRICE);

    const profit      = AMOUNT.muln(3);
    const currentVal  = AMOUNT.add(profit);
    const feeFraction = profit.mul(this.FEE_BPS).div(currentVal);
    const expFee      = AMOUNT.mul(feeFraction).div(this.FEES_DECIMALS);
    const expUser     = AMOUNT.sub(expFee);

    const feeBefore  = await this.TOKEN_A.balanceOf(successFeeReceiver);
    const userBefore = await this.TOKEN_A.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });

    assert((await this.TOKEN_A.balanceOf(successFeeReceiver)).sub(feeBefore).eq(expFee), `fee: expected ${expFee}`);
    assert((await this.TOKEN_A.balanceOf(user)).sub(userBefore).eq(expUser), `user: expected ${expUser}`);
  });

  it('isToken0=false: sqrtPrice rises (token depreciates) → no fee, full amount returned', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;

    await this.vault.setAllowedToken(
      this.TOKEN_A.address, this.stateView.address, this.poolIdA, false, true, { from: owner }
    );

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    const tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A], [AMOUNT], TERM);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);

    const userBefore = await this.TOKEN_A.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });

    assert((await this.TOKEN_A.balanceOf(user)).sub(userBefore).eq(AMOUNT), 'full amount returned');
  });

  it('bad price: sqrtPriceX96=1 causes directPriceX96=0 → getDepositProfit reverts with "bad price"', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    const tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A], [AMOUNT], TERM);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();

    await this.stateView.setPrice(this.poolIdA, new BN(1));
    await tools.expectRevert(this.vault.getDepositProfit(uid), 'bad price');
  });

  it('getDepositProfit: isToken0=false returns 0 at same price; returns profit on inverse 4x rise', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;

    await this.vault.setAllowedToken(
      this.TOKEN_A.address, this.stateView.address, this.poolIdA, false, true, { from: owner }
    );

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    const tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A], [AMOUNT], TERM);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();

    assert(new BN(await this.vault.getDepositProfit(uid)).eq(new BN(0)), 'no change: profit = 0');

    await this.stateView.setPrice(this.poolIdA, this.LOW_PRICE);
    const expProfit = AMOUNT.muln(3);
    assert(new BN(await this.vault.getDepositProfit(uid)).eq(expProfit), `inverse 4x: profit = ${expProfit}`);
  });

  it('mixed isToken0: TOKEN_A=true (direct 4x) + TOKEN_B=false (inverse 4x) → fee on combined profit', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;

    await this.vault.setAllowedToken(
      this.TOKEN_B.address, this.stateView.address, this.poolIdB, false, true, { from: owner }
    );

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.BASE_PRICE);
    const tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A, this.TOKEN_B], [AMOUNT, AMOUNT], TERM);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();

    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.LOW_PRICE);

    const totalProfit  = AMOUNT.muln(6);
    const totalCurrent = AMOUNT.muln(2).add(totalProfit);
    const feeFraction  = totalProfit.mul(this.FEE_BPS).div(totalCurrent);
    const feeEach      = AMOUNT.mul(feeFraction).div(this.FEES_DECIMALS);

    const userBeforeA = await this.TOKEN_A.balanceOf(user);
    const userBeforeB = await this.TOKEN_B.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });

    assert((await this.TOKEN_A.balanceOf(user)).sub(userBeforeA).eq(AMOUNT.sub(feeEach)), `mixed: user_A`);
    assert((await this.TOKEN_B.balanceOf(user)).sub(userBeforeB).eq(AMOUNT.sub(feeEach)), `mixed: user_B`);
  });

  it('multi-token: all tokens disabled after deposit, no fee, full amounts returned', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.BASE_PRICE);
    const tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A, this.TOKEN_B], [AMOUNT, AMOUNT], TERM);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();

    await this.vault.setAllowedToken(
      this.TOKEN_A.address, this.stateView.address, this.poolIdA, true, false, { from: owner }
    );
    await this.vault.setAllowedToken(
      this.TOKEN_B.address, this.stateView.address, this.poolIdB, true, false, { from: owner }
    );
    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.HIGH_PRICE);

    const userBeforeA = await this.TOKEN_A.balanceOf(user);
    const userBeforeB = await this.TOKEN_B.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });

    assert((await this.TOKEN_A.balanceOf(user)).sub(userBeforeA).eq(AMOUNT), 'all-disabled: full A');
    assert((await this.TOKEN_B.balanceOf(user)).sub(userBeforeB).eq(AMOUNT), 'all-disabled: full B');
  });

  it('tiny price increase: profit rounds to 0, no fee charged', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    const tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A], [AMOUNT], TERM);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE.addn(1));
    const userBefore = await this.TOKEN_A.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });

    assert((await this.TOKEN_A.balanceOf(user)).sub(userBefore).eq(AMOUNT), 'tiny increase: full amount returned');
  });

  it('small amount: profit > 0 but fee rounds to 0, full amount returned', async() => {
    const AMOUNT = new BN(1);
    const TERM   = 2;

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    const tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A], [AMOUNT], TERM);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);

    const userBefore = await this.TOKEN_A.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });

    assert((await this.TOKEN_A.balanceOf(user)).sub(userBefore).eq(AMOUNT), 'small amount: full returned (fee=0)');
  });

  it('multi-token: SuccessFeeCharged emitted for each token with profit', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.BASE_PRICE);
    const tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A, this.TOKEN_B], [AMOUNT, AMOUNT], TERM);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.HIGH_PRICE);

    await tools.advanceTime(TERM + 1);
    const wTx = await this.vault.withdraw(uid, { from: user });

    const feeEvents = wTx.logs.filter(e => e.event === 'SuccessFeeCharged');
    assert.equal(feeEvents.length, 2, 'should emit SuccessFeeCharged for each token');
    const addrs = feeEvents.map(e => e.args.token.toLowerCase());
    assert(addrs.includes(this.TOKEN_A.address.toLowerCase()), 'missing SuccessFeeCharged for TOKEN_A');
    assert(addrs.includes(this.TOKEN_B.address.toLowerCase()), 'missing SuccessFeeCharged for TOKEN_B');
  });

  it('getDepositProfit: multi-token returns correct combined profit', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.BASE_PRICE);
    const tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A, this.TOKEN_B], [AMOUNT, AMOUNT], TERM);
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();

    assert(new BN(await this.vault.getDepositProfit(uid)).eq(new BN(0)), 'no change: profit = 0');

    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.HIGH_PRICE);
    assert(new BN(await this.vault.getDepositProfit(uid)).eq(AMOUNT.muln(6)), 'both 4x: profit = 6*AMOUNT');

    await this.stateView.setPrice(this.poolIdB, this.BASE_PRICE);
    assert(new BN(await this.vault.getDepositProfit(uid)).eq(AMOUNT.muln(3)), 'one 4x: profit = 3*AMOUNT');
  });

  it('3-token: all tokens at 4x price → fee computed across all three', async() => {
    const AMOUNT = new BN(10000);
    const TERM   = 2;

    this.TOKEN_C = await artifacts.require('ERC20Mock').new('TOKEN C', 'TKC', owner, 100000);
    await this.TOKEN_C.transfer(user, 50000, { from: owner });
    await this.TOKEN_C.approve(this.vault.address, 50000, { from: user });
    const poolIdC = '0x' + this.TOKEN_C.address.replace('0x', '').toLowerCase().padStart(64, '0');
    await this.stateView.setPrice(poolIdC, this.BASE_PRICE);
    await this.vault.setAllowedToken(
      this.TOKEN_C.address, this.stateView.address, poolIdC, true, true, { from: owner }
    );

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.BASE_PRICE);
    const tx = await tools.createDeposit(
      this.vault, user, [this.TOKEN_A, this.TOKEN_B, this.TOKEN_C], [AMOUNT, AMOUNT, AMOUNT], TERM
    );
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();

    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.HIGH_PRICE);
    await this.stateView.setPrice(poolIdC, this.HIGH_PRICE);

    const totalProfit  = AMOUNT.muln(9);
    const totalCurrent = AMOUNT.muln(3).add(totalProfit);
    const feeFraction  = totalProfit.mul(this.FEE_BPS).div(totalCurrent);
    const feeEach      = AMOUNT.mul(feeFraction).div(this.FEES_DECIMALS);

    const userBeforeA = await this.TOKEN_A.balanceOf(user);
    const userBeforeB = await this.TOKEN_B.balanceOf(user);
    const userBeforeC = await this.TOKEN_C.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });

    assert((await this.TOKEN_A.balanceOf(user)).sub(userBeforeA).eq(AMOUNT.sub(feeEach)), '3-token: user_A');
    assert((await this.TOKEN_B.balanceOf(user)).sub(userBeforeB).eq(AMOUNT.sub(feeEach)), '3-token: user_B');
    assert((await this.TOKEN_C.balanceOf(user)).sub(userBeforeC).eq(AMOUNT.sub(feeEach)), '3-token: user_C');
  });

  it('multi-token: different amounts [1000, 5000] both 4x → fee fraction shared, absolute fee differs', async() => {
    const AMOUNT_A = new BN(1000);
    const AMOUNT_B = new BN(5000);
    const TERM = 2;

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.BASE_PRICE);
    const tx = await tools.createDeposit(
      this.vault, user, [this.TOKEN_A, this.TOKEN_B], [AMOUNT_A, AMOUNT_B], TERM
    );
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();

    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.HIGH_PRICE);

    const totalProfit  = AMOUNT_A.muln(3).add(AMOUNT_B.muln(3));
    const totalCurrent = AMOUNT_A.muln(4).add(AMOUNT_B.muln(4));
    const feeFraction  = totalProfit.mul(this.FEE_BPS).div(totalCurrent);
    const feeA = AMOUNT_A.mul(feeFraction).div(this.FEES_DECIMALS);
    const feeB = AMOUNT_B.mul(feeFraction).div(this.FEES_DECIMALS);

    const userBeforeA = await this.TOKEN_A.balanceOf(user);
    const userBeforeB = await this.TOKEN_B.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });

    assert((await this.TOKEN_A.balanceOf(user)).sub(userBeforeA).eq(AMOUNT_A.sub(feeA)), 'diff-amounts: user_A');
    assert((await this.TOKEN_B.balanceOf(user)).sub(userBeforeB).eq(AMOUNT_B.sub(feeB)), 'diff-amounts: user_B');
    assert(!feeA.eq(feeB), 'fee amounts must differ when token amounts differ');
  });

  it('multi-token: different amounts [1000, 5000] only TOKEN_A 4x → fee diluted by B, both pay fee', async() => {
    const AMOUNT_A = new BN(1000);
    const AMOUNT_B = new BN(5000);
    const TERM = 2;

    await this.stateView.setPrice(this.poolIdA, this.BASE_PRICE);
    await this.stateView.setPrice(this.poolIdB, this.BASE_PRICE);
    const tx = await tools.createDeposit(
      this.vault, user, [this.TOKEN_A, this.TOKEN_B], [AMOUNT_A, AMOUNT_B], TERM
    );
    const uid = tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();

    await this.stateView.setPrice(this.poolIdA, this.HIGH_PRICE);

    const totalProfit  = AMOUNT_A.muln(3);
    const totalCurrent = AMOUNT_A.muln(4).add(AMOUNT_B);
    const feeFraction  = totalProfit.mul(this.FEE_BPS).div(totalCurrent);
    const feeA = AMOUNT_A.mul(feeFraction).div(this.FEES_DECIMALS);
    const feeB = AMOUNT_B.mul(feeFraction).div(this.FEES_DECIMALS);

    const userBeforeA = await this.TOKEN_A.balanceOf(user);
    const userBeforeB = await this.TOKEN_B.balanceOf(user);
    await tools.advanceTime(TERM + 1);
    await this.vault.withdraw(uid, { from: user });

    assert((await this.TOKEN_A.balanceOf(user)).sub(userBeforeA).eq(AMOUNT_A.sub(feeA)), 'diluted: user_A');
    assert((await this.TOKEN_B.balanceOf(user)).sub(userBeforeB).eq(AMOUNT_B.sub(feeB)), 'diluted: user_B fee');
    assert(feeB.gt(feeA), 'larger amount pays larger absolute fee');
  });
});
