// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Standard NFT smart contract with mint and burn dunction.
 * @notice This NFT is a part of Arka Vault infrastructure
 */
contract VaultNFT is ERC721Enumerable, Ownable {
    uint256 private _tokenIdCounter;
    string private _baseTokenURI;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI_
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        _baseTokenURI = baseURI_;
    }

    // ---------------- Admin ----------------

    function setBaseURI(string calldata newBaseTokenURI) external onlyOwner {
        _baseTokenURI = newBaseTokenURI;
    }

    /**
     * @dev Call this ONCE after deploy:
     * nft.transferOwnership(address(vault))
     */

    // ---------------- Vault-only ----------------

    function mint(address to) external onlyOwner returns (uint256) {
        _tokenIdCounter++;
        uint256 tokenId = _tokenIdCounter;
        _safeMint(to, tokenId);
        return tokenId;
    }

    function burn(uint256 tokenId) external onlyOwner {
        _burn(tokenId);
    }

    // ---------------- Internals ----------------

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
