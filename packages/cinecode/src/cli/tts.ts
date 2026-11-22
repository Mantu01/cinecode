import { Command } from "commander";
import { getVoiceRegistry, type VoiceDescriptor } from "../tts/registry.js";
import { runReport } from "./run-report.js";
import { buildCommanderCommand, findCommand } from "./command-registry.js";

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

export async function ttsCommand(options: TtsCliOptions = {}): Promise<void> {
  if (!options.listVoices) {
    console.log("Usage: cinecode tts --list-voices [--language <code>] [--search <text>] [--provider <name>] [--json]");
    return;
  }
  const registry = getVoiceRegistry();
  const voices = await registry.listVoices({
    language: options.language,
    search: options.search,
    provider: options.provider as VoiceDescriptor["provider"] | undefined,
  });
  runReport.result({ voices });
  if (options.json) return;
  if (voices.length === 0) {
    console.log("No voices matched the filter.");
    return;
  }
  console.log("ID".padEnd(42) + " NAME".padEnd(21) + " LOCALE".padEnd(9) + " GENDER");
  for (const voice of voices) console.log(formatVoice(voice));
  console.log(`\n${voices.length} voices available`);
}

export function createTtsCommand(): Command {
  return buildCommanderCommand(findCommand("tts")!);
}
