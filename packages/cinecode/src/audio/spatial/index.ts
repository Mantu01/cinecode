export {
  computeDistanceAttenuation, perceptualAttenuation, airAbsorption,
  spatialAttenuation, sourceDistance, onePoleCoefficient,
  type SpatialPosition, type AttenuationResult,
} from "./attenuation.js";
export {
  applySpatialPanning, spatialPanBuffer, computeStereoSpan, applyDopplerShift,
  type StereoGains,
} from "./panning.js";
export * from "./ambisonics.js";
export * from "./binaural.js";
