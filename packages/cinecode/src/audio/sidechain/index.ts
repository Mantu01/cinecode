export {
  computeSidechainEnvelope, computeRmsEnvelope, computeTimelineEnvelope,
  type SidechainEnvelopeOptions,
} from "./detect.js";
export {
  sidechainCompress, sidechainGainCurve, computeSidechainGain, envelopeToDb,
  type SidechainCompressParams,
} from "./compress.js";
export * from "./selective.js";
