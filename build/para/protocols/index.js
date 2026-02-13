/**
 * Protocol Adapters for Yield/Lending
 *
 * Each adapter implements the ProtocolAdapter interface to standardize
 * transaction encoding across different DeFi protocols.
 *
 * Supported protocols:
 * - Aave v3: Battle-tested lending protocol with broad chain support
 * - Compound V3: Comet markets with isolated collateral
 */
// Re-export adapters
export { AaveV3Adapter } from "./aave-v3.js";
export { CompoundV3Adapter } from "./compound-v3.js";
export { MorphoAdapter } from "./morpho.js";
// Protocol registry
import { AaveV3Adapter } from "./aave-v3.js";
import { CompoundV3Adapter } from "./compound-v3.js";
import { MorphoAdapter } from "./morpho.js";
const adapters = {
    "aave-v3": new AaveV3Adapter(),
    "compound-v3": new CompoundV3Adapter(),
    "morpho-v1": new MorphoAdapter(),
};
/**
 * Get adapter for a protocol
 */
export function getProtocolAdapter(protocolId) {
    return adapters[protocolId.toLowerCase()] || null;
}
/**
 * Get all supported protocol IDs
 */
export function getSupportedProtocols() {
    return Object.keys(adapters);
}
/**
 * Check if a protocol is supported
 */
export function isProtocolSupported(protocolId) {
    return protocolId.toLowerCase() in adapters;
}
//# sourceMappingURL=index.js.map