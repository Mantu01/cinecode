import { Command } from "commander";
import { getVoiceRegistry, type VoiceDescriptor } from "../../tts/registry.js";
import { runReport } from "../output/run-report.js";
import { UsageError } from "../shared/usage-error.js";

export interface TtsCliOptions {
  listVoices?: boolean;
  language?: string;
  search?: string;
  provider?: string;
  json?: boolean;
}

function formatVoice(voice: VoiceDescriptor): string {
  const styles = voice.styles && voice.styles.length > 0 ? ` [${voice.styles.join(", ")}]` : "";
  const custom = voice.custom ? " (custom)" : "";
  return `${voice.id.padEnd(42)} ${voice.name.padEnd(20)} ${voice.locale.padEnd(8)} ${(voice.gender ?? "neutral").padEnd(8)}${styles}${custom}`;
}

export async function ttsCommand(
  subcommandOrOptions?: string | TtsCliOptions,
  maybeOptions?: TtsCliOptions,
): Promise<void> {
  const options = (typeof subcommandOrOptions === "object" && subcommandOrOptions !== null ? subcommandOrOptions : (maybeOptions ?? {})) as TtsCliOptions;
  const hasAction = options.listVoices === true || options.language !== undefined || options.search !== undefined || options.provider !== undefined;
  if (!hasAction) {
    throw new UsageError("At least one action is required: --list-voices, --language <code>, --search <text>, or --provider <name>.");
  }
  const registry = getVoiceRegistry();
  if (options.provider !== undefined && !registry.listProviders().includes(options.provider)) {
    throw new UsageError(`Unknown provider '${options.provider}'. Valid providers: ${registry.listProviders().join(", ") || "none"}.`);
  }
  const voices = await registry.listVoices({
    language: options.language,
    search: options.search,
    provider: options.provider as VoiceDescriptor["provider"] | undefined,
  });
  runReport.result({ voices, language: options.language, provider: options.provider });
  if (options.json) return;
  if (voices.length === 0) {
    runReport.diagnostic("No voices matched the filter.");
    return;
  }
  runReport.diagnostic("ID".padEnd(42) + " NAME".padEnd(21) + " LOCALE".padEnd(9) + " GENDER");
  for (const voice of voices) runReport.diagnostic(formatVoice(voice));
  runReport.diagnostic(`\n${voices.length} voices available`);
}

