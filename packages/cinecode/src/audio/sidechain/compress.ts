export interface SidechainCompressParams {
  readonly threshold?: number;
  readonly ratio?: number;
  readonly attackMs?: number;
  readonly releaseMs?: number;
  readonly kneeWidth?: number;
  readonly makeUpGain?: number;
}

export function envelopeToDb(value: number): number {
  return value <= 0 ? -120 : 20 * Math.log10(value);
}

export function computeSidechainGain(envelopeValue: number, params: SidechainCompressParams = {}): number {
  const threshold = params.threshold ?? -20;
  const ratio = Math.max(1, params.ratio ?? 4);
  const knee = Math.max(0, params.kneeWidth ?? 0);
  const makeUp = params.makeUpGain ?? 0;
  const levelDb = envelopeToDb(envelopeValue);
  const excess = levelDb - threshold;
  let reductionDb = 0;

  if (excess > 0) {
    if (knee > 0 && excess < knee) {
      reductionDb = ((1 / ratio - 1) * excess * excess) / (2 * knee);
    } else {
      reductionDb = (1 / ratio - 1) * excess;
    }
  }

  const gain = Math.pow(10, (reductionDb + makeUp) / 20);
  return Math.max(0, Math.min(4, gain));
}

export function sidechainCompress(
  input: Float32Array,
  sidechainEnvelope: Float32Array,
  params: SidechainCompressParams = {},
  channels = 1,
): Float32Array {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const envelopeValue = sidechainEnvelope[i] ?? 0;
    const gain = computeSidechainGain(envelopeValue, params);
    output[i] = (input[i] ?? 0) * gain;
  }
  void channels;
  return output;
}

export function sidechainGainCurve(
  envelope: Float32Array,
  params: SidechainCompressParams = {},
): Float32Array {
  const gains = new Float32Array(envelope.length);
  for (let i = 0; i < envelope.length; i += 1) {
    gains[i] = computeSidechainGain(envelope[i] ?? 0, params);
  }
  return gains;
}
