const VaultNFT = artifacts.require("VaultNFT");
const Vault = artifacts.require("Vault");

module.exports = async function(deployer, network, accounts) {
  const owner = accounts[0];

  await deployer.deploy(VaultNFT, "Vault NFT", "VNFT", "uri");
  const nft = await VaultNFT.deployed();

  await deployer.deploy(Vault, nft.address, 2000, owner, 0, owner);
};
