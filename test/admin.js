const Web3 = require('web3');
const BN = Web3.utils.BN;
const TWO = new BN(2);

const tools = require('../scripts/tools');
const ERC20Mock = artifacts.require('ERC20Mock');

const EMERGENCY_PENALTY_BP = new BN(2000);
const SUCCESS_FEE_BP = new BN(0);
const MIN_DEPOSIT = new BN(1000);

contract('Vault | Admin Emergency Penalty Tests', ([owner, user, otherUser]) => {
  beforeEach(async() => {
    this.nft = await artifacts.require('VaultNFT').new('Vault NFT', 'vNFT', 'baseURI');

    this.vault = await artifacts.require('Vault').new(
      this.nft.address,
      EMERGENCY_PENALTY_BP,
      owner,
      SUCCESS_FEE_BP,
      owner,
      { from: owner }
    );

    await this.nft.transferOwnership(this.vault.address, { from: owner });

    this.COSMIC = await ERC20Mock.new('COSMIC', 'COS', owner, 5000);

    const half = (await this.COSMIC.balanceOf(owner)).div(new BN(2));
    await this.COSMIC.transfer(user, half, { from: owner });
    await this.COSMIC.approve(this.vault.address, half, { from: user });

    await tools.setupAllowedTokens(owner, this.vault, [this.COSMIC]);
  });

  it('Admin changes emergency penalty and it affects user deposit correctly', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, MIN_DEPOSIT, 100);

    const userBalanceBefore = await this.COSMIC.balanceOf(user);
    const penaltyReceiver = await this.vault.emergencyPenaltyReceiver();
    const receiverBalanceBefore = await this.COSMIC.balanceOf(penaltyReceiver);

    const adjustedPenaltyBP = new BN(await this.vault.emergencyPenalty()).div(new BN(4));
    await this.vault.changeEmergencyPenalty(adjustedPenaltyBP, { from: owner });

    const updatedPenaltyBP = await this.vault.emergencyPenalty();
    assert(updatedPenaltyBP.eq(adjustedPenaltyBP), 'Emergency penalty should be updated');

    await this.vault.emergencyWithdraw(uid, { from: user });

    const expectedPenalty = MIN_DEPOSIT.mul(updatedPenaltyBP).div(new BN(10000));
    const expectedUserBalance = userBalanceBefore.add(MIN_DEPOSIT).sub(expectedPenalty);
    const expectedReceiverBalance = receiverBalanceBefore.add(expectedPenalty);

    assert((await this.COSMIC.balanceOf(user)).eq(expectedUserBalance), 'User balance incorrect');
    assert((await this.COSMIC.balanceOf(penaltyReceiver)).eq(expectedReceiverBalance), 'Receiver balance incorrect');

    await tools.checkNFTBurned(this.nft, uid);
    await tools.checkDepositActive(this.vault, uid, false);
  });

  it('Admin changes emergency penalty receiver and new receiver gets the penalty', async() => {
    const uid = await tools.setupSingleDeposit(this.vault, user, this.COSMIC, MIN_DEPOSIT, 100);

    const userBalanceBefore = await this.COSMIC.balanceOf(user);
    const oldReceiver = await this.vault.emergencyPenaltyReceiver();
    const oldReceiverBalanceBefore = await this.COSMIC.balanceOf(oldReceiver);
    const newReceiverBalanceBefore = await this.COSMIC.balanceOf(otherUser);

    await this.vault.changeEmergencyPenaltyReceiver(otherUser, { from: owner });
    assert.equal(await this.vault.emergencyPenaltyReceiver(), otherUser, 'Receiver should be updated');

    await this.vault.emergencyWithdraw(uid, { from: user });

    const penaltyBP = await this.vault.emergencyPenalty();
    const expectedPenalty = MIN_DEPOSIT.mul(new BN(penaltyBP)).div(new BN(10000));

    assert(
      (await this.COSMIC.balanceOf(user)).eq(userBalanceBefore.add(MIN_DEPOSIT).sub(expectedPenalty)),
      'User balance incorrect'
    );
    assert(
      (await this.COSMIC.balanceOf(oldReceiver)).eq(oldReceiverBalanceBefore),
      'Old receiver should not change'
    );
    assert(
      (await this.COSMIC.balanceOf(otherUser)).eq(newReceiverBalanceBefore.add(expectedPenalty)),
      'New receiver balance incorrect'
    );

    await tools.checkNFTBurned(this.nft, uid);
    await tools.checkDepositActive(this.vault, uid, false);
  });

  it('Non-owner cannot change emergency penalty', async() => {
    await tools.expectRevert(
      this.vault.changeEmergencyPenalty(100, { from: user })
    );
  });

  it('Emergency penalty exceeding FEES_DECIMALS should revert', async() => {
    await tools.expectRevert(
      this.vault.changeEmergencyPenalty(10001, { from: owner }),
      'emergencyPenalty is too big'
    );
  });

  it('Non-owner cannot change emergency penalty receiver', async() => {
    await tools.expectRevert(
      this.vault.changeEmergencyPenaltyReceiver(otherUser, { from: user })
    );
  });

  it('Emergency penalty receiver zero address should revert', async() => {
    await tools.expectRevert(
      this.vault.changeEmergencyPenaltyReceiver('0x0000000000000000000000000000000000000000', { from: owner }),
      'emergencyPenaltyReceiver can\'t be 0x'
    );
  });

  it('changeEmergencyPenalty emits SetEmergencyPenalty event', async() => {
    const tx = await this.vault.changeEmergencyPenalty(500, { from: owner });

    const event = tx.logs.find(e => e.event === 'SetEmergencyPenalty');
    assert.ok(event, 'SetEmergencyPenalty event not emitted');
    assert(new BN(event.args.emergencyPenalty).eq(new BN(500)), 'Wrong penalty value in event');
  });

  it('changeEmergencyPenaltyReceiver emits SetEmergencyPenaltyReceiver event', async() => {
    const tx = await this.vault.changeEmergencyPenaltyReceiver(otherUser, { from: owner });

    const event = tx.logs.find(e => e.event === 'SetEmergencyPenaltyReceiver');
    assert.ok(event, 'SetEmergencyPenaltyReceiver event not emitted');
    assert.equal(
      event.args.emergencyPenaltyReceiver.toLowerCase(),
      otherUser.toLowerCase(),
      'Wrong receiver in event'
    );
  });
});

contract('Vault | Admin setAllowedToken Tests', ([owner, nonOwner, penaltyReceiver]) => {
  beforeEach(async() => {
    const nft = await artifacts.require('VaultNFT').new('Vault NFT', 'vNFT', 'baseURI');
    this.vault = await artifacts.require('Vault').new(
      nft.address, 0, penaltyReceiver, 0, penaltyReceiver, { from: owner }
    );
    await nft.transferOwnership(this.vault.address, { from: owner });

    this.poolManager = await artifacts.require('UniswapV4PoolManagerMock').new();
    this.token = await artifacts.require('ERC20Mock').new('TOKEN', 'TKN', owner, 1000);
    this.poolId = '0x' + this.token.address.replace('0x', '').toLowerCase().padStart(64, '0');
    await this.poolManager.setPrice(this.poolId, '281474976710656');
  });

  it('Non-owner cannot call setAllowedToken', async() => {
    await tools.expectRevert(
      this.vault.setAllowedToken(this.token.address, this.poolManager.address, this.poolId, true, { from: nonOwner })
    );
  });

  it('setAllowedToken with zero token address should revert', async() => {
    await tools.expectRevert(
      this.vault.setAllowedToken(
        '0x0000000000000000000000000000000000000000',
        this.poolManager.address,
        this.poolId,
        true,
        { from: owner }
      ),
      'token can\'t be 0x'
    );
  });

  it('setAllowedToken with zero poolManager address should revert', async() => {
    await tools.expectRevert(
      this.vault.setAllowedToken(
        this.token.address,
        '0x0000000000000000000000000000000000000000',
        this.poolId,
        true,
        { from: owner }
      ),
      'poolManager can\'t be 0x'
    );
  });

  it('setAllowedToken enables token correctly', async() => {
    await this.vault.setAllowedToken(this.token.address, this.poolManager.address, this.poolId, true, { from: owner });
    const stored = await this.vault.allowedTokens(this.token.address);
    assert.equal(stored.status, true, 'Token should be enabled');
    assert.equal(stored.token.toLowerCase(), this.token.address.toLowerCase(), 'Token address mismatch');
  });

  it('setAllowedToken disables token correctly', async() => {
    await this.vault.setAllowedToken(this.token.address, this.poolManager.address, this.poolId, true, { from: owner });
    await this.vault.setAllowedToken(this.token.address, this.poolManager.address, this.poolId, false, { from: owner });
    const stored = await this.vault.allowedTokens(this.token.address);
    assert.equal(stored.status, false, 'Token should be disabled');
  });

  it('setAllowedToken emits TokenUpdated event', async() => {
    const tx = await this.vault.setAllowedToken(
      this.token.address, this.poolManager.address, this.poolId, true, { from: owner }
    );
    const event = tx.logs.find(e => e.event === 'TokenUpdated');
    assert.ok(event, 'TokenUpdated event not emitted');
    assert.equal(event.args.token.toLowerCase(), this.token.address.toLowerCase(), 'Wrong token in event');
    assert.equal(event.args.status, true, 'Wrong status in event');
  });
});

contract('Vault | Admin Success Fee Tests',
  ([owner, nonOwner, penaltyReceiver, initialFeeReceiver, newFeeReceiver]) => {
    beforeEach(async() => {
      const nft = await artifacts.require('VaultNFT').new('Vault NFT', 'vNFT', 'baseURI');
      this.vault = await artifacts.require('Vault').new(
        nft.address, 0, penaltyReceiver, 500, initialFeeReceiver, { from: owner }
      );
      await nft.transferOwnership(this.vault.address, { from: owner });
    });

    it('Non-owner cannot change success fee', async() => {
      await tools.expectRevert(
        this.vault.changeSuccessFee(100, { from: nonOwner })
      );
    });

    it('Success fee exceeding FEES_DECIMALS should revert', async() => {
      await tools.expectRevert(
        this.vault.changeSuccessFee(10001, { from: owner }),
        'fee too big'
      );
    });

    it('Admin changes success fee to valid value', async() => {
      const feeBefore = new BN(await this.vault.successFee());
      assert(feeBefore.eq(new BN(500)), 'Initial success fee should be 500');

      await this.vault.changeSuccessFee(200, { from: owner });

      const feeAfter = new BN(await this.vault.successFee());
      assert(feeAfter.eq(new BN(200)), 'Success fee not updated');
    });

    it('Admin can set success fee to zero', async() => {
      await this.vault.changeSuccessFee(0, { from: owner });
      assert(new BN(await this.vault.successFee()).eq(new BN(0)), 'Success fee should be 0');
    });

    it('Admin can set success fee to max (FEES_DECIMALS = 10000)', async() => {
      await this.vault.changeSuccessFee(10000, { from: owner });
      assert(new BN(await this.vault.successFee()).eq(new BN(10000)), 'Success fee should be 10000');
    });

    it('changeSuccessFee emits SetSuccessFee event', async() => {
      const tx = await this.vault.changeSuccessFee(300, { from: owner });
      const event = tx.logs.find(e => e.event === 'SetSuccessFee');
      assert.ok(event, 'SetSuccessFee event not emitted');
      assert(new BN(event.args.successFee).eq(new BN(300)), 'Wrong fee value in event');
    });

    it('Non-owner cannot change success fee receiver', async() => {
      await tools.expectRevert(
        this.vault.changeSuccessFeeReceiver(newFeeReceiver, { from: nonOwner })
      );
    });

    it('Success fee receiver cannot be zero address', async() => {
      await tools.expectRevert(
        this.vault.changeSuccessFeeReceiver('0x0000000000000000000000000000000000000000', { from: owner }),
        'zero address'
      );
    });

    it('Admin changes success fee receiver to new address', async() => {
      const receiverBefore = await this.vault.successFeeReceiver();
      assert.equal(receiverBefore, initialFeeReceiver, 'Initial receiver should be initialFeeReceiver');

      await this.vault.changeSuccessFeeReceiver(newFeeReceiver, { from: owner });

      const receiverAfter = await this.vault.successFeeReceiver();
      assert.equal(receiverAfter, newFeeReceiver, 'Receiver not updated');
    });

    it('changeSuccessFeeReceiver emits SetSuccessFeeReceiver event', async() => {
      const tx = await this.vault.changeSuccessFeeReceiver(newFeeReceiver, { from: owner });
      const event = tx.logs.find(e => e.event === 'SetSuccessFeeReceiver');
      assert.ok(event, 'SetSuccessFeeReceiver event not emitted');
      assert.equal(event.args.successFeeReceiver, newFeeReceiver, 'Wrong receiver in event');
    });
  });

contract('Vault | Admin Success Fee Integration Tests',
  ([owner, user, penaltyReceiver, successFeeReceiver, newFeeReceiver]) => {
    beforeEach(async() => {
      this.nft = await artifacts.require('VaultNFT').new('Vault NFT', 'vNFT', 'baseURI');
      this.vault = await artifacts.require('Vault').new(
        this.nft.address, 0, penaltyReceiver, 500, successFeeReceiver, { from: owner }
      );
      await this.nft.transferOwnership(this.vault.address, { from: owner });

      this.poolManager = await artifacts.require('UniswapV4PoolManagerMock').new();
      this.TOKEN_A = await artifacts.require('ERC20Mock').new('TOKEN A', 'TKA', owner, 100000);
      await this.TOKEN_A.transfer(user, 50000, { from: owner });
      await this.TOKEN_A.approve(this.vault.address, 50000, { from: user });
      this.poolIdA = '0x' + this.TOKEN_A.address.replace('0x', '').toLowerCase().padStart(64, '0');
      await this.vault.setAllowedToken(
        this.TOKEN_A.address, this.poolManager.address, this.poolIdA, true, { from: owner }
      );

      this.BASE_PRICE = TWO.pow(new BN(96));
      this.HIGH_PRICE = TWO.pow(new BN(97));
      this.FEES_DECIMALS = new BN(await this.vault.FEES_DECIMALS());
      this.FEE_BPS       = new BN(await this.vault.successFee());
    });

    it('fee rate changed mid-deposit: new rate applies at withdrawal', async() => {
      const AMOUNT  = new BN(10000);
      const TERM    = 2;
      const profit  = AMOUNT.muln(3);
      const current = AMOUNT.add(profit);
      const NEW_RATE = new BN(1000);
      const expFee   = AMOUNT.mul(profit.mul(NEW_RATE).div(current)).div(this.FEES_DECIMALS);

      await this.poolManager.setPrice(this.poolIdA, this.BASE_PRICE);
      const tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A], [AMOUNT], TERM);
      const uid = parseInt(tx.logs[0].args.uid);
      await this.vault.changeSuccessFee(NEW_RATE, { from: owner });
      await this.poolManager.setPrice(this.poolIdA, this.HIGH_PRICE);
      const feeBefore  = await this.TOKEN_A.balanceOf(successFeeReceiver);
      const userBefore = await this.TOKEN_A.balanceOf(user);
      await tools.advanceTime(TERM + 1);
      await this.vault.withdraw(uid, { from: user });
      assert((await this.TOKEN_A.balanceOf(successFeeReceiver)).sub(feeBefore).eq(expFee), 'rate-change: fee');
      assert((await this.TOKEN_A.balanceOf(user)).sub(userBefore).eq(AMOUNT.sub(expFee)), 'rate-change: user');
    });

    it('fee receiver changed mid-deposit: new receiver gets fee, original gets nothing', async() => {
      const AMOUNT  = new BN(10000);
      const TERM    = 2;
      const profit  = AMOUNT.muln(3);
      const current = AMOUNT.add(profit);
      const expFee  = AMOUNT.mul(profit.mul(this.FEE_BPS).div(current)).div(this.FEES_DECIMALS);

      await this.poolManager.setPrice(this.poolIdA, this.BASE_PRICE);
      const tx  = await tools.createDeposit(this.vault, user, [this.TOKEN_A], [AMOUNT], TERM);
      const uid = parseInt(tx.logs[0].args.uid);
      await this.vault.changeSuccessFeeReceiver(newFeeReceiver, { from: owner });
      await this.poolManager.setPrice(this.poolIdA, this.HIGH_PRICE);
      const origBefore = await this.TOKEN_A.balanceOf(successFeeReceiver);
      const newBefore  = await this.TOKEN_A.balanceOf(newFeeReceiver);
      await tools.advanceTime(TERM + 1);
      await this.vault.withdraw(uid, { from: user });
      assert((await this.TOKEN_A.balanceOf(successFeeReceiver)).eq(origBefore), 'recv-change: original gets nothing');
      assert((await this.TOKEN_A.balanceOf(newFeeReceiver)).sub(newBefore).eq(expFee), 'recv-change: new gets fee');
    });
  });

contract('Vault | Constructor Tests', ([owner]) => {
  it('Constructor with zero nftContract should revert', async() => {
    await tools.expectRevert(
      artifacts.require('Vault').new(
        '0x0000000000000000000000000000000000000000', 0, owner, 0, owner, { from: owner }
      ),
      'nftContract can\'t be 0x'
    );
  });

  it('Constructor with zero emergencyPenaltyReceiver should revert', async() => {
    const nft = await artifacts.require('VaultNFT').new('Vault NFT', 'vNFT', 'baseURI');
    await tools.expectRevert(
      artifacts.require('Vault').new(
        nft.address, 0, '0x0000000000000000000000000000000000000000', 0, owner, { from: owner }
      ),
      'emergencyPenaltyReceiver can\'t be 0x'
    );
  });

  it('Constructor with emergencyPenalty > FEES_DECIMALS should revert', async() => {
    const nft = await artifacts.require('VaultNFT').new('Vault NFT', 'vNFT', 'baseURI');
    await tools.expectRevert(
      artifacts.require('Vault').new(
        nft.address, 10001, owner, 0, owner, { from: owner }
      ),
      'emergencyPenalty is too big'
    );
  });

  it('Constructor with zero successFeeReceiver should revert', async() => {
    const nft = await artifacts.require('VaultNFT').new('Vault NFT', 'vNFT', 'baseURI');
    await tools.expectRevert(
      artifacts.require('Vault').new(
        nft.address, 0, owner, 0, '0x0000000000000000000000000000000000000000', { from: owner }
      ),
      'successFeeReceiver can\'t be 0x'
    );
  });

  it('Constructor with successFee > FEES_DECIMALS should revert', async() => {
    const nft = await artifacts.require('VaultNFT').new('Vault NFT', 'vNFT', 'baseURI');
    await tools.expectRevert(
      artifacts.require('Vault').new(
        nft.address, 0, owner, 10001, owner, { from: owner }
      ),
      'successFee is too big'
    );
  });
});
