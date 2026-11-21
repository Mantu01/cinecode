import type { Composition, TextClip, Timeline, VisualClip } from "../../core/types/index.js";
import { checkMissingGlyphs, getDefaultFontFallbackResolver, type TextStyle } from "./engine.js";
import { recordDegradation } from "../../errors/degradations.js";
import { createError, ErrorCode } from "../../errors/index.js";

export interface TextPreflightFinding {
  readonly family: string;
  readonly missingGlyphs: readonly string[];
  readonly fallbacks: readonly { char: string; resolvedFamily: string }[];
  readonly clipNames: readonly string[];
}

export interface TextPreflightReport {
  readonly findings: readonly TextPreflightFinding[];
  readonly hasProblems: boolean;
}

export interface TextPreflightOptions {
  readonly strictFonts?: boolean;
}

function collectTextClips(
  timeline: Timeline,
  results: { clip: TextClip; name: string }[],
  scenes?: Readonly<Record<string, Timeline>>,
  visited = new Set<Timeline>(),
): void {
  if (visited.has(timeline)) return;
  visited.add(timeline);

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if ((clip as { type: string }).type === "text") {
        const textClip = clip as TextClip;
        results.push({ clip: textClip, name: textClip.name ?? "unnamed-text" });
      } else if ((clip as { type: string }).type === "group") {
        const group = clip as { children?: readonly VisualClip[] };
        if (group.children) {
          for (const child of group.children) {
            if ((child as { type: string }).type === "text") {
              const textClip = child as TextClip;
              results.push({ clip: textClip, name: textClip.name ?? "unnamed-text" });
            }
          }
        }
      } else if ((clip as { type: string }).type === "scene") {
        const sceneClip = clip as { ref?: string; timeline?: Timeline };
        const nested = sceneClip.timeline ?? (scenes && sceneClip.ref ? scenes[sceneClip.ref] : undefined);
        if (nested) {
          collectTextClips(nested, results, scenes, visited);
        }
      }
    }
  }
}

const preflightCache = new WeakMap<object, TextPreflightReport>();

function strictFontError(finding: TextPreflightFinding) {
  return createError(
    ErrorCode.CC3006,
    {
      family: finding.family,
      missing: finding.missingGlyphs.join(", ") || "font unavailable; a fallback was substituted",
    },
    { location: { clip: finding.clipNames[0] }, fixHint: "Install the requested font or disable strict font checking." },
  );
}

export function preflightText(
  composition: Composition,
  options: TextPreflightOptions = {},
): TextPreflightReport {
  const cached = preflightCache.get(composition as unknown as object);
  if (cached) {
    if (options.strictFonts === true && cached.hasProblems) {
      throw strictFontError(cached.findings[0]!);
    }
    return cached;
  }

  const textClips: { clip: TextClip; name: string }[] = [];
  collectTextClips(composition.rootTimeline, textClips, composition.scenes);

  const familyToClips = new Map<string, { clip: TextClip; name: string }[]>();
  for (const item of textClips) {
    const family = item.clip.fontFamily ?? "sans-serif";
    let list = familyToClips.get(family);
    if (!list) {
      list = [];
      familyToClips.set(family, list);
    }
    list.push(item);
  }

  const resolver = getDefaultFontFallbackResolver();
  const findings: TextPreflightFinding[] = [];

  for (const [family, items] of familyToClips) {
    const missingSet = new Set<string>();
    const fallbackList: { char: string; resolvedFamily: string }[] = [];
    const seenContent = new Set<string>();
    const affectedClipNames = new Set<string>();
    const familyAvailable = resolver.isAvailable(family);

    for (const item of items) {
      const content = item.clip.content;
      let clipHasProblem = !familyAvailable;
      if (!seenContent.has(content)) {
        seenContent.add(content);
        const style: TextStyle = {
          fontFamily: family,
          fontStyle: item.clip.fontStyle ?? "normal",
          fontWeight: item.clip.fontWeight ?? "normal",
          fontSize: item.clip.fontSize ?? 16,
          lineHeight: item.clip.lineHeight ?? 1.2,
          letterSpacing: item.clip.letterSpacing ?? 0,
          align: item.clip.align ?? "left",
        };
        const missing = checkMissingGlyphs(content, style);
        for (const ch of missing) {
          missingSet.add(ch);
          clipHasProblem = true;
        }
        for (const run of resolver.segment(content, style)) {
          if (run.fontFamily !== family) {
            fallbackList.push({ char: run.text, resolvedFamily: run.fontFamily });
            clipHasProblem = true;
          }
        }
      }
      if (clipHasProblem) {
        affectedClipNames.add(item.name);
      }
    }

    if (!familyAvailable || missingSet.size > 0 || fallbackList.length > 0) {
      const missingList = [...missingSet];
      const clipNames = [...affectedClipNames];
      findings.push({
        family,
        missingGlyphs: missingList,
        fallbacks: fallbackList,
        clipNames,
      });

      // Record once per family through degradation collector
      recordDegradation({
        code: ErrorCode.CC3006,
        what: "text font glyph fallback",
        reason: !familyAvailable
          ? `Font "${family}" is not available on system and was substituted`
          : `Font "${family}" is missing glyphs: ${missingList.join(", ")}`,
        input: `clips: ${clipNames.join(", ")} (${clipNames.length} clip(s))`,
        instead: "fallback glyphs or replacement characters rendered",
      });
    }
  }

  const report: TextPreflightReport = {
    findings,
    hasProblems: findings.length > 0,
  };

  preflightCache.set(composition as unknown as object, report);

  if (options.strictFonts === true && report.hasProblems) {
    throw strictFontError(report.findings[0]!);
  }

  return report;
}
