import type { FitMode, CropProps } from "../core/types/index.js";

export interface ConformedFrame {
  readonly sourceFrame: number;
  readonly compositionFrame: number;
}

export interface TrimParams {
  readonly trimStart: number;
  readonly trimEnd: number;
}

export interface SpeedParams {
  readonly speed: number;
  readonly reverse: boolean;
}

export interface FramingParams {
  readonly crop?: CropProps;
  readonly fit: FitMode;
  readonly flipX: boolean;
  readonly flipY: boolean;
  readonly roundedCorners: number;
}

export interface ConformParams {
  readonly trim?: TrimParams;
  readonly speed?: SpeedParams;
  readonly framing?: FramingParams;
}

export interface MediaSourceInfo {
  readonly duration: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly hasAudio: boolean;
}

export interface CompositionInfo {
  readonly fps: number;
  readonly width: number;
  readonly height: number;
}

function roundToNearestFrame(value: number): number {
  return Math.round(value);
}

export function calculateSourceFrame(
  compositionFrame: number,
  sourceInfo: MediaSourceInfo,
  compositionInfo: CompositionInfo,
  params: ConformParams
): number {
  let frame = compositionFrame;

  if (params.trim) {
    const trimStartFrames = roundToNearestFrame(params.trim.trimStart * sourceInfo.fps);
    frame += trimStartFrames;
  }

  if (params.speed) {
    if (params.speed.speed === 0) {
      return 0;
    }
    if (params.speed.reverse) {
      const totalFrames = getEffectiveSourceFrames(sourceInfo, params);
      frame = totalFrames - 1 - frame;
    }
    frame = Math.floor(frame * params.speed.speed);
  }

  const sourceFps = sourceInfo.fps;
  const compFps = compositionInfo.fps;
  if (sourceFps !== compFps) {
    frame = roundToNearestFrame(frame * sourceFps / compFps);
  }

  return Math.max(0, frame);
}

export function getEffectiveSourceFrames(
  sourceInfo: MediaSourceInfo,
  params: ConformParams
): number {
  let totalFrames = Math.floor(sourceInfo.duration * sourceInfo.fps);

  if (params.trim) {
    const trimStartFrames = roundToNearestFrame(params.trim.trimStart * sourceInfo.fps);
    const trimEndFrames = roundToNearestFrame(params.trim.trimEnd * sourceInfo.fps);
    totalFrames = Math.max(0, totalFrames - trimStartFrames - trimEndFrames);
  }

  if (params.speed && params.speed.speed !== 0) {
    totalFrames = Math.ceil(totalFrames / Math.abs(params.speed.speed));
  }

  return totalFrames;
}

export function calculateClipDuration(
  sourceInfo: MediaSourceInfo,
  compositionInfo: CompositionInfo,
  params: ConformParams,
  clipDurationFrames?: number
): number {
  if (clipDurationFrames !== undefined) {
    return clipDurationFrames;
  }

  const effectiveFrames = getEffectiveSourceFrames(sourceInfo, params);
  if (params.speed && params.speed.speed !== 0) {
    return Math.ceil(effectiveFrames * compositionInfo.fps / sourceInfo.fps);
  }

  return Math.ceil(effectiveFrames * compositionInfo.fps / sourceInfo.fps);
}

export function mapCompositionFrameToSource(
  compositionFrame: number,
  sourceInfo: MediaSourceInfo,
  compositionInfo: CompositionInfo,
  params: ConformParams
): ConformedFrame {
  const sourceFrame = calculateSourceFrame(compositionFrame, sourceInfo, compositionInfo, params);
  const maxFrame = getEffectiveSourceFrames(sourceInfo, params) - 1;
  const clampedFrame = Math.min(Math.max(0, sourceFrame), maxFrame);

  return {
    sourceFrame: clampedFrame,
    compositionFrame,
  };
}

export function getFramingTransform(
  sourceWidth: number,
  sourceHeight: number,
  compWidth: number,
  compHeight: number,
  framing: FramingParams
): { x: number; y: number; scaleX: number; scaleY: number; crop?: CropProps } {
  const crop = framing.crop;
  let effectiveWidth = sourceWidth;
  let effectiveHeight = sourceHeight;

  if (crop) {
    effectiveWidth = crop.width;
    effectiveHeight = crop.height;
  }

  let scaleX = 1;
  let scaleY = 1;
  let x = 0;
  let y = 0;

  switch (framing.fit) {
    case "contain": {
      const scale = Math.min(compWidth / effectiveWidth, compHeight / effectiveHeight);
      scaleX = scale;
      scaleY = scale;
      x = (compWidth - effectiveWidth * scale) / 2;
      y = (compHeight - effectiveHeight * scale) / 2;
      break;
    }
    case "cover": {
      const scale = Math.max(compWidth / effectiveWidth, compHeight / effectiveHeight);
      scaleX = scale;
      scaleY = scale;
      x = (compWidth - effectiveWidth * scale) / 2;
      y = (compHeight - effectiveHeight * scale) / 2;
      break;
    }
    case "fill": {
      scaleX = compWidth / effectiveWidth;
      scaleY = compHeight / effectiveHeight;
      break;
    }
    case "none": {
      scaleX = 1;
      scaleY = 1;
      x = (compWidth - effectiveWidth) / 2;
      y = (compHeight - effectiveHeight) / 2;
      break;
    }
  }

  if (framing.flipX) {
    scaleX = -scaleX;
    x += effectiveWidth * Math.abs(scaleX);
  }
  if (framing.flipY) {
    scaleY = -scaleY;
    y += effectiveHeight * Math.abs(scaleY);
  }

  return { x, y, scaleX, scaleY, crop };
}

export function shouldShowConformWarning(
  sourceInfo: MediaSourceInfo,
  compositionInfo: CompositionInfo
): boolean {
  return sourceInfo.fps !== compositionInfo.fps || 
         sourceInfo.width !== compositionInfo.width || 
         sourceInfo.height !== compositionInfo.height;
}

export function getConformReport(
  sourceInfo: MediaSourceInfo,
  compositionInfo: CompositionInfo,
  params: ConformParams
): string[] {
  const warnings: string[] = [];

  if (sourceInfo.fps !== compositionInfo.fps) {
    warnings.push(`Frame rate conformed: ${sourceInfo.fps}fps → ${compositionInfo.fps}fps`);
  }

  if (sourceInfo.width !== compositionInfo.width || sourceInfo.height !== compositionInfo.height) {
    warnings.push(`Resolution conformed: ${sourceInfo.width}x${sourceInfo.height} → ${compositionInfo.width}x${compositionInfo.height} (${params.framing?.fit ?? "contain"})`);
  }

  if (params.trim && (params.trim.trimStart > 0 || params.trim.trimEnd > 0)) {
    warnings.push(`Trimmed: ${params.trim.trimStart}s - ${params.trim.trimEnd}s`);
  }

  if (params.speed && params.speed.speed !== 1) {
    warnings.push(`Speed: ${params.speed.speed}x${params.speed.reverse ? " (reversed)" : ""}`);
  }

  return warnings;
}