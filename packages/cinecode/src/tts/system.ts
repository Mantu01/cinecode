import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AudioBuffer } from "../audio/types.js";
import { decodeAudioFile } from "../audio/decode.js";
import type { TtsEngine, TtsOptions, TtsVoice } from "./engine.js";

function run(command: string, args: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    child.on("error", () => resolve(127));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

interface SystemCommandSpec {
  readonly command: string;
  readonly buildArgs: (text: string, outputPath: string, options: TtsOptions) => string[];
}

function resolveCommand(): SystemCommandSpec | null {
  if (process.platform === "darwin") {
    return {
      command: "say",
      buildArgs: (text, outputPath, options) => {
        const rate = Math.round((options.speed ?? 1) * 180);
        return ["-r", String(rate), "-o", outputPath, "--data-format=LEF32@22050", text];
      },
    };
  }
  if (process.platform === "win32") {
    return {
      command: "powershell",
      buildArgs: (text, outputPath, options) => {
        const rate = Math.max(-10, Math.min(10, Math.round(((options.speed ?? 1) - 1) * 5)));
        const escapedText = text.replace(/'/g, "''");
        const escapedPath = outputPath.replace(/\\/g, "\\\\").replace(/'/g, "''");
        const script =
          "Add-Type -AssemblyName System.Speech; " +
          "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
          `$s.Rate = ${rate}; $s.SetOutputToWaveFile('${escapedPath}'); $s.Speak('${escapedText}'); $s.Dispose()`;
        return ["-NoProfile", "-NonInteractive", "-Command", script];
      },
    };
  }
  return {
    command: "espeak",
    buildArgs: (text, outputPath, options) => {
      const speed = Math.max(80, Math.min(450, Math.round((options.speed ?? 1) * 160)));
      return ["-s", String(speed), "-w", outputPath, text];
    },
  };
}

export function createSystemTtsEngine(): TtsEngine {
  const spec = resolveCommand();
  return {
    name: "system",
    available: spec !== null,
    async synthesize(text: string, options: TtsOptions = {}): Promise<AudioBuffer> {
      if (!spec) throw new Error("No system text-to-speech command is available on this platform.");
      const directory = await mkdtemp(join(tmpdir(), "cinecode-tts-"));
      const outputPath = join(directory, "speech.wav");
      try {
        const code = await run(spec.command, spec.buildArgs(text, outputPath, options));
        if (code !== 0) throw new Error(`System TTS command failed with exit code ${code}`);
        return decodeVoiceOutput(outputPath, options);
      } finally {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }
    },
    async getVoices(): Promise<readonly TtsVoice[]> {
      return spec ? [{ name: "system", language: "en-US" }] : [];
    },
  };
}

export async function decodeVoiceOutput(path: string, options: TtsOptions): Promise<AudioBuffer> {
  const decoded = await decodeAudioFile(path, {
    targetSampleRate: 48000,
    targetChannels: 1,
  });
  const volume = Math.max(0, Math.min(2, options.volume ?? 1));
  if (volume === 1) return decoded.buffer;
  const data = new Float32Array(decoded.buffer.data.length);
  for (let i = 0; i < data.length; i += 1) data[i] = (decoded.buffer.data[i] ?? 0) * volume;
  return { ...decoded.buffer, data };
}
