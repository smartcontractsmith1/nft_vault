const Web3 = require('web3');
const BN = Web3.utils.BN;

const tools = require('../scripts/tools');
const VaultNFT = artifacts.require('VaultNFT');
const Vault = artifacts.require('Vault');

contract('Vault | Full Cycle Tests', ([deployer, A, B, C, penaltyReceiver]) => {
  beforeEach(async() => {
    this.nft = await VaultNFT.new('Vault NFT', 'vNFT', 'https://base.uri/');
    this.vault = await Vault.new(this.nft.address, 2000, penaltyReceiver, 500, penaltyReceiver, { from: deployer });
    await this.nft.transferOwnership(this.vault.address, { from: deployer });

    this.tokens = [];
    for (const cfg of [
      { name: 'COSMIC', symbol: 'COS' },
      { name: 'USDT',   symbol: 'USDT' },
      { name: 'USDC',   symbol: 'USDC' },
    ]) {
      const token = await artifacts.require('ERC20Mock').new(cfg.name, cfg.symbol, deployer, 20000);
      this.tokens.push(token);
    }
    [this.COSMIC, this.USDT, this.USDC] = this.tokens;

    for (const token of this.tokens) {
      for (const user of [A, B, C]) {
        await token.transfer(user, 2000, { from: deployer });
        await token.approve(this.vault.address, 5000, { from: user });
      }
    }

    await tools.setupAllowedTokens(deployer, this.vault, this.tokens);

    this.penaltyBP = await this.vault.emergencyPenalty();
  });

  it('Full cycle: multi-user deposit → normal withdraw → emergency withdraw', async() => {
    const amounts = [new BN(100), new BN(200), new BN(300)];
    const term = 100;
    const users = [A, B, C];
    const uids = [];

    for (const user of users) {
      const balancesBefore = await Promise.all(this.tokens.map(t => t.balanceOf(user)));
      const uid = await tools.setupMultiDeposit(this.vault, user, this.tokens, amounts, term);
      uids.push(uid);

      await tools.checkNFTOwner(this.nft, uid, user);
      await tools.checkDepositActive(this.vault, uid, true);
      await tools.checkDepositAmounts(this.vault, uid, this.tokens, amounts);

      for (let j = 0; j < this.tokens.length; j++) {
        const balanceAfter = await this.tokens[j].balanceOf(user);
        assert(balanceAfter.eq(balancesBefore[j].sub(amounts[j])), 'Balance after deposit incorrect');
      }
    }

    for (let i = 0; i < users.length; i++) {
      await tools.expectRevert(this.vault.withdraw(uids[i], { from: users[i] }), 'claim: too early');
    }

    await tools.advanceTime(term + 1);

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const balancesBefore = await Promise.all(this.tokens.map(t => t.balanceOf(user)));
      await tools.withdraw(this.vault, user, uids[i]);

      await tools.checkDepositActive(this.vault, uids[i], false);
      await tools.checkNFTBurned(this.nft, uids[i]);

      for (let j = 0; j < this.tokens.length; j++) {
        const balanceAfter = await this.tokens[j].balanceOf(user);
        assert(balanceAfter.eq(balancesBefore[j].add(amounts[j])), 'Balance after withdraw incorrect');
      }
    }

    const emergencyUid = await tools.setupMultiDeposit(this.vault, A, this.tokens, amounts, term);
    const balancesBeforeEmergency = await Promise.all(this.tokens.map(t => t.balanceOf(A)));
    const penaltyBefore = await Promise.all(this.tokens.map(t => t.balanceOf(penaltyReceiver)));

    await tools.emergencyWithdraw(this.vault, A, emergencyUid);
    await tools.checkDepositActive(this.vault, emergencyUid, false);
    await tools.checkNFTBurned(this.nft, emergencyUid);

    for (let i = 0; i < this.tokens.length; i++) {
      const penaltyAmount = amounts[i].mul(this.penaltyBP).div(new BN(10000));
      await tools.checkTokenBalance(this.tokens[i], A, balancesBeforeEmergency[i].add(amounts[i]).sub(penaltyAmount));
      await tools.checkTokenBalance(this.tokens[i], penaltyReceiver, penaltyBefore[i].add(penaltyAmount));
    }
  });

});
