// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract UniswapV4PoolManagerMock {
    struct Slot0 {
        uint160 sqrtPriceX96;
        int24 tick;
        uint24 protocolFee;
        uint24 lpFee;
    }

    mapping(bytes32 => Slot0) public slots;

    /**
     * @dev @notice Setup test price for pair
     * @param poolId Pool ID
     * @param sqrtPriceX96 Token price in sqrtPriceX96 fromat
    */
    function setPrice(bytes32 poolId, uint160 sqrtPriceX96) external {
        slots[poolId] = Slot0({
            sqrtPriceX96: sqrtPriceX96,
            tick: 0,
            protocolFee: 0,
            lpFee: 0
        });
    }

    /**
     * @notice Return mock Slot0 for pool ID
    */
    function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee) {
        Slot0 memory s = slots[poolId];
        return (s.sqrtPriceX96, s.tick, s.protocolFee, s.lpFee);
    }
}
