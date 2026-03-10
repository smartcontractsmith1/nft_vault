const Web3 = require('web3');
const BN = Web3.utils.BN;

const sleep = s => new Promise(resolve => setTimeout(resolve, s * 1000));

const advanceBlock = () => new Promise((resolve, reject) => {
  web3.currentProvider.send(
    { jsonrpc: '2.0', method: 'evm_mine', id: Date.now() },
    (err, res) => (err ? reject(err) : resolve(res))
  );
});

const advanceTime = async(seconds) => {
  await new Promise((resolve, reject) => {
    web3.currentProvider.send(
      { jsonrpc: '2.0', method: 'evm_increaseTime', params: [seconds], id: Date.now() },
      err => (err ? reject(err) : resolve())
    );
  });
  await advanceBlock();
};

const expectRevert = async(promise, reason = null) => {
  try {
    await promise;
  } catch (error) {
    const message =
      error.reason ||
      error.message ||
      (error.data && JSON.stringify(error.data)) ||
      '';
    if (reason && !message.includes(reason)) {
      throw new Error(`Expected revert reason "${reason}", got "${message}"`);
    }
    return;
  }
  throw new Error('Expected revert but transaction did not revert');
};

const createDeposit = async(vault, user, tokens, amounts, term) => {
  const tokenAddresses = tokens.map(t => (typeof t === 'string' ? t : t.address));
  return await vault.createDeposit(tokenAddresses, amounts, term, user, { from: user });
};

const withdraw = async(vault, user, uid) =>
  await vault.withdraw(uid, { from: user });

const emergencyWithdraw = async(vault, user, uid) =>
  await vault.emergencyWithdraw(uid, { from: user });

const checkNFTOwner = async(nft, uid, expectedOwner) => {
  const owner = await nft.ownerOf(uid);
  if (owner.toLowerCase() !== expectedOwner.toLowerCase()) {
    throw new Error(`NFT ${uid} owner mismatch: ${owner} != ${expectedOwner}`);
  }
};

const checkNFTBurned = async(nft, uid) => {
  let burned = false;
  try { await nft.ownerOf(uid); } catch { burned = true; }
  if (!burned) throw new Error(`NFT ${uid} was not burned`);
};

const checkTokenBalance = async(token, user, expected) => {
  const balance = await token.balanceOf(user);
  const expectedBN = BN.isBN(expected) ? expected : new BN(expected.toString());
  const balanceBN = BN.isBN(balance) ? balance : new BN(balance.toString());
  if (!balanceBN.eq(expectedBN)) {
    throw new Error(`Token balance mismatch: ${balanceBN.toString()} != ${expectedBN.toString()}`);
  }
};

const checkTokenList = async(vault, uid, tokens) => {
  const storedTokens = await vault.viewTokenListById(uid);
  if (storedTokens.length !== tokens.length) throw new Error('Token list length mismatch');
  for (let i = 0; i < tokens.length; i++) {
    const addr = typeof tokens[i] === 'string' ? tokens[i] : tokens[i].address;
    if (storedTokens[i].toLowerCase() !== addr.toLowerCase()) {
      throw new Error(`Token address mismatch at index ${i}`);
    }
  }
};

const checkAmountList = async(vault, uid, amounts) => {
  const storedAmounts = await vault.viewAmountListById(uid);
  if (storedAmounts.length !== amounts.length) throw new Error('Amount list length mismatch');
  for (let i = 0; i < amounts.length; i++) {
    if (!new BN(storedAmounts[i].toString()).eq(new BN(amounts[i].toString()))) {
      throw new Error(`Amount mismatch at index ${i}`);
    }
  }
};

const checkDepositAmounts = async(vault, uid, tokens, amounts) => {
  await checkTokenList(vault, uid, tokens);
  await checkAmountList(vault, uid, amounts);
};

const checkDepositActive = async(vault, uid, expected = true) => {
  const deposit = await vault.deposits(uid);
  const active = deposit.active === true || deposit.active === false ?
    deposit.active :
    Boolean(deposit.active.valueOf());
  if (active !== expected) throw new Error(`Deposit ${uid} active state mismatch`);
};

const checkDepositTimestamps = async(vault, uid) => {
  const deposit = await vault.deposits(uid);
  const start = new BN(deposit.startTimestamp.toString());
  const end = new BN(deposit.endTimestamp.toString());
  if (end.lte(start)) throw new Error(`Deposit ${uid} timestamps invalid`);
};

const setupAllowedTokens = async(owner, vault, tokens) => {
  const poolManager = await artifacts.require('UniswapV4PoolManagerMock').new();
  for (const token of tokens) {
    const addr = typeof token === 'string' ? token : token.address;
    const poolId = '0x' + addr.replace('0x', '').toLowerCase().padStart(64, '0');
    await poolManager.setPrice(poolId, '281474976710656');
    await vault.setAllowedToken(addr, poolManager.address, poolId, true, { from: owner });
  }
  return poolManager;
};

const setupTokensForUser = async(owner, user, vault, tokenData) => {
  const tokens = [];
  for (const data of tokenData) {
    const token = await artifacts.require('ERC20Mock')
      .new(data.name, data.symbol, owner, data.supply);
    const amount = data.amount || data.supply;
    await token.transfer(user, amount, { from: owner });
    await token.approve(vault.address, amount, { from: user });
    tokens.push(token);
  }
  return tokens;
};

const setupSingleDeposit = async(vault, user, token, amount, term) => {
  if (amount <= 0) throw new Error('Amount must be > 0');
  const tx = await createDeposit(vault, user, [token], [amount], term);
  return tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
};

const setupMultiDeposit = async(vault, user, tokens, amounts, term) => {
  const tx = await createDeposit(vault, user, tokens, amounts, term);
  return tx.logs.find(e => e.event === 'NewDeposit').args.uid.toNumber();
};

const calcEmergencyBalances = async(vault, uid) => {
  const deposit = await vault.deposits(uid);
  if (!deposit) throw new Error('Deposit not found');

  const tokens = await vault.viewTokenListById(uid);
  const amounts = await vault.viewAmountListById(uid);
  const penaltyBP = await vault.emergencyPenalty();

  const expectedUser = [];
  const expectedPenaltyReceiver = [];

  for (let i = 0; i < tokens.length; i++) {
    const amt = new BN(amounts[i].toString());
    const penalty = amt.mul(new BN(penaltyBP.toString())).div(new BN('10000'));
    expectedUser.push(amt.sub(penalty));
    expectedPenaltyReceiver.push(penalty);
  }

  const tokenObjects = [];
  for (const addr of tokens) {
    tokenObjects.push(await artifacts.require('ERC20Mock').at(addr));
  }

  return { tokens: tokenObjects, expectedUser, expectedPenaltyReceiver };
};

module.exports = {
  sleep,
  advanceBlock,
  advanceTime,
  expectRevert,
  createDeposit,
  withdraw,
  emergencyWithdraw,
  checkNFTOwner,
  checkNFTBurned,
  checkTokenBalance,
  checkDepositAmounts,
  checkTokenList,
  checkAmountList,
  checkDepositActive,
  checkDepositTimestamps,
  setupTokensForUser,
  setupAllowedTokens,
  setupSingleDeposit,
  setupMultiDeposit,
  calcEmergencyBalances
};
