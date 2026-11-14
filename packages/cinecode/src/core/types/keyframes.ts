import type { Keyframe, KeyframeTarget } from "../keyframes/types.js";

export type { Keyframe, KeyframeTarget };

export interface Keyframes {
  readonly [property: string]: readonly Keyframe[];
}
