// The booster runtime and its filter live inside the single-file satellite (it is deployed on its own);
// this module re-exports them for the edge and the tools.
export { BOOST_JS, BOOST_VERSION, BOOSTER_TYPES, liveBoosters } from './whalyom-satellite.mjs';
