const Web3 = require('web3');
const BN = Web3.utils.BN;

const tools = require('../scripts/tools');

contract('Vault | Emergency Withdraw Tests', ([owner, user, otherUser, penaltyReceiver]) => {
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

    this.poolManager = await tools.setupAllowedTokens(owner, this.vault, this.tokens);
    this.FEES_DECIMALS = new BN(await this.vault.FEES_DECIMALS());
  });

  it('Emergency withdraw: single token with penalty', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 1000, 100);

    const balanceBefore = await this.COSMIC.balanceOf(user);
    const penaltyBP = await this.vault.emergencyPenalty();
    const penaltyAmount = new BN(1000).mul(new BN(penaltyBP)).div(this.FEES_DECIMALS);
    const expectedBalance = balanceBefore.add(new BN(1000)).sub(penaltyAmount);

    const penaltyBefore = await this.COSMIC.balanceOf(penaltyReceiver);

    await this.vault.emergencyWithdraw(uid, { from: user });

    await tools.checkTokenBalance(this.COSMIC, user, expectedBalance);
    await tools.checkTokenBalance(this.COSMIC, penaltyReceiver, penaltyBefore.add(penaltyAmount));
    await tools.checkNFTBurned(this.nft, uid);
    await tools.checkDepositActive(this.vault, uid, false);
  });

  it('Emergency withdraw: multi-token deposit with correct penalties', async() => {
    const tokens = [this.COSMIC, this.USDT, this.USDC];
    const amounts = [100, 200, 300];
    const uid = await tools.setupMultiDeposit(this.vault, user, tokens, amounts, 50);

    const balancesBefore = await Promise.all(tokens.map(t => t.balanceOf(user)));
    const penaltyBP = await this.vault.emergencyPenalty();

    const penaltyBefore = await Promise.all(tokens.map(t => t.balanceOf(penaltyReceiver)));

    await this.vault.emergencyWithdraw(uid, { from: user });

    for (let i = 0; i < tokens.length; i++) {
      const penaltyAmount = new BN(amounts[i]).mul(new BN(penaltyBP)).div(this.FEES_DECIMALS);
      const expectedUserBalance = balancesBefore[i].add(new BN(amounts[i])).sub(penaltyAmount);
      const expectedPenaltyBalance = penaltyBefore[i].add(penaltyAmount);
      await tools.checkTokenBalance(tokens[i], user, expectedUserBalance);
      await tools.checkTokenBalance(tokens[i], penaltyReceiver, expectedPenaltyBalance);
    }

    await tools.checkNFTBurned(this.nft, uid);
    await tools.checkDepositActive(this.vault, uid, false);
  });

  it('Emergency withdraw: sequential deposits', async() => {
    const uid1 = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 100, 10);
    const uid2 = await tools.setupSingleDeposit(this.vault, user, this.USDT, 200, 10);

    const cosmicBefore = await this.COSMIC.balanceOf(user);
    const usdtBefore = await this.USDT.balanceOf(user);
    const penaltyCosmicBefore = await this.COSMIC.balanceOf(penaltyReceiver);
    const penaltyUsdtBefore = await this.USDT.balanceOf(penaltyReceiver);
    const penaltyBP = await this.vault.emergencyPenalty();

    await this.vault.emergencyWithdraw(uid1, { from: user });
    await this.vault.emergencyWithdraw(uid2, { from: user });

    const cosmicPenalty = new BN(100).mul(new BN(penaltyBP)).div(this.FEES_DECIMALS);
    const usdtPenalty = new BN(200).mul(new BN(penaltyBP)).div(this.FEES_DECIMALS);

    await tools.checkNFTBurned(this.nft, uid1);
    await tools.checkNFTBurned(this.nft, uid2);
    await tools.checkDepositActive(this.vault, uid1, false);
    await tools.checkDepositActive(this.vault, uid2, false);
    await tools.checkTokenBalance(this.COSMIC, user, cosmicBefore.add(new BN(100)).sub(cosmicPenalty));
    await tools.checkTokenBalance(this.USDT, user, usdtBefore.add(new BN(200)).sub(usdtPenalty));
    await tools.checkTokenBalance(this.COSMIC, penaltyReceiver, penaltyCosmicBefore.add(cosmicPenalty));
    await tools.checkTokenBalance(this.USDT, penaltyReceiver, penaltyUsdtBefore.add(usdtPenalty));
  });

  it('Emergency withdraw: deposit with MAX_TERM', async() => {
    const maxTerm = (await this.vault.MAX_TERM()).toNumber();
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 500, maxTerm);

    const balanceBefore = await this.COSMIC.balanceOf(user);
    const penaltyBefore = await this.COSMIC.balanceOf(penaltyReceiver);
    const penaltyBP = await this.vault.emergencyPenalty();
    const penaltyAmount = new BN(500).mul(new BN(penaltyBP)).div(this.FEES_DECIMALS);

    await this.vault.emergencyWithdraw(uid, { from: user });

    await tools.checkNFTBurned(this.nft, uid);
    await tools.checkDepositActive(this.vault, uid, false);
    await tools.checkTokenBalance(this.COSMIC, user, balanceBefore.add(new BN(500)).sub(penaltyAmount));
    await tools.checkTokenBalance(this.COSMIC, penaltyReceiver, penaltyBefore.add(penaltyAmount));
  });

  it('Emergency withdraw: penalty receiver gets correct amount', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 1000, 100);

    const balanceBefore = await this.COSMIC.balanceOf(user);
    const penaltyBefore = await this.COSMIC.balanceOf(penaltyReceiver);
    const penaltyBP = await this.vault.emergencyPenalty();
    const penaltyAmount = new BN(1000).mul(new BN(penaltyBP)).div(this.FEES_DECIMALS);

    await this.vault.emergencyWithdraw(uid, { from: user });

    await tools.checkTokenBalance(this.COSMIC, user, balanceBefore.add(new BN(1000)).sub(penaltyAmount));
    await tools.checkTokenBalance(this.COSMIC, penaltyReceiver, penaltyBefore.add(penaltyAmount));
  });

  it('Emergency withdraw: penalty = 10000 sends all to penaltyReceiver', async() => {
    await this.vault.changeEmergencyPenalty(10000, { from: owner });
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 1000, 100);

    const balanceBefore = await this.COSMIC.balanceOf(user);
    const penaltyBefore = await this.COSMIC.balanceOf(penaltyReceiver);

    await this.vault.emergencyWithdraw(uid, { from: user });

    await tools.checkTokenBalance(this.COSMIC, user, balanceBefore);
    await tools.checkTokenBalance(this.COSMIC, penaltyReceiver, penaltyBefore.add(new BN(1000)));
    await tools.checkNFTBurned(this.nft, uid);
    await tools.checkDepositActive(this.vault, uid, false);
  });

  it('Emergency withdraw: vault balance decreases by deposited amount', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 1000, 100);

    const vaultBefore = await this.COSMIC.balanceOf(this.vault.address);

    await this.vault.emergencyWithdraw(uid, { from: user });

    await tools.checkTokenBalance(this.COSMIC, this.vault.address, vaultBefore.sub(new BN(1000)));
  });

  it('Emergency withdraw: penalty = 0 returns full amount to user', async() => {
    await this.vault.changeEmergencyPenalty(0, { from: owner });
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 500, 100);

    const balanceBefore = await this.COSMIC.balanceOf(user);
    const penaltyBefore = await this.COSMIC.balanceOf(penaltyReceiver);

    await this.vault.emergencyWithdraw(uid, { from: user });

    await tools.checkTokenBalance(this.COSMIC, user, balanceBefore.add(new BN(500)));
    await tools.checkTokenBalance(this.COSMIC, penaltyReceiver, penaltyBefore);
    await tools.checkNFTBurned(this.nft, uid);
    await tools.checkDepositActive(this.vault, uid, false);
  });

  it('NFT transfer: recipient can emergency withdraw', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 100, 100);

    await this.nft.transferFrom(user, otherUser, uid, { from: user });
    await tools.checkNFTOwner(this.nft, uid, otherUser);

    const balanceBefore = await this.COSMIC.balanceOf(otherUser);
    const penaltyBefore = await this.COSMIC.balanceOf(penaltyReceiver);
    const penaltyBP = await this.vault.emergencyPenalty();
    const penaltyAmount = new BN(100).mul(new BN(penaltyBP)).div(this.FEES_DECIMALS);

    await this.vault.emergencyWithdraw(uid, { from: otherUser });

    await tools.checkTokenBalance(
      this.COSMIC, otherUser, balanceBefore.add(new BN(100)).sub(penaltyAmount)
    );
    await tools.checkTokenBalance(this.COSMIC, penaltyReceiver, penaltyBefore.add(penaltyAmount));
    await tools.checkNFTBurned(this.nft, uid);
    await tools.checkDepositActive(this.vault, uid, false);
  });

  it('NFT transfer: original owner cannot emergency withdraw after transfer', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 100, 100);

    await this.nft.transferFrom(user, otherUser, uid, { from: user });

    await tools.expectRevert(this.vault.emergencyWithdraw(uid, { from: user }), 'wrong owner');
  });

  it('Emergency withdraw with nonexistent uid should revert', async() => {
    await tools.expectRevert(this.vault.emergencyWithdraw(9999, { from: user }));
  });

  it('Double emergency withdraw should revert', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 100, 10);
    await this.vault.emergencyWithdraw(uid, { from: user });
    await tools.expectRevert(this.vault.emergencyWithdraw(uid, { from: user }), 'voucher not active');
  });

  it('Emergency withdraw by wrong user should revert', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 100, 10);
    await tools.expectRevert(this.vault.emergencyWithdraw(uid, { from: otherUser }), 'wrong owner');
  });

  it('Emergency withdraw after normal withdraw should revert', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 100, 1);
    await tools.advanceTime(2);
    await this.vault.withdraw(uid, { from: user });
    await tools.expectRevert(this.vault.emergencyWithdraw(uid, { from: user }), 'voucher not active');
  });

  it('Emergency withdraw: Withdraw event emitted with isEmergency = true', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, 100, 10);

    const tx = await this.vault.emergencyWithdraw(uid, { from: user });

    const event = tx.logs.find(e => e.event === 'Withdraw');
    assert.ok(event, 'Withdraw event not emitted');
    assert.equal(event.args.user.toLowerCase(), user.toLowerCase(), 'Wrong user in Withdraw event');
    assert(new BN(event.args.uid).eq(new BN(uid)), 'Wrong uid in Withdraw event');
    assert.equal(event.args.isEmergency, true, 'isEmergency should be true');
  });

});
