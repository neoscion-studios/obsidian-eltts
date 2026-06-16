import {
  App,
  Editor,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
} from "obsidian";

interface ElevenLabsTtsSettings {
  apiKey: string;
  voiceId: string;
  modelId: string;
  outputFormat: string;
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
  chunkSize: number;
}

const DEFAULT_SETTINGS: ElevenLabsTtsSettings = {
  apiKey: "",
  voiceId: "21m00Tcm4TlvDq8ikWAM",
  modelId: "eleven_multilingual_v2",
  outputFormat: "mp3_44100_128",
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  useSpeakerBoost: true,
  chunkSize: 2200,
};

const API_BASE_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export default class ElevenLabsTtsPlugin extends Plugin {
  settings: ElevenLabsTtsSettings;
  private currentAudio: HTMLAudioElement | null = null;
  private currentObjectUrl: string | null = null;
  private isStopping = false;
  private sessionId = 0;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("volume-2", "Read active note aloud", () => {
      void this.readActiveNote();
    });

    this.addCommand({
      id: "read-active-note-aloud",
      name: "Read active note aloud",
      callback: () => {
        void this.readActiveNote();
      },
    });

    this.addCommand({
      id: "read-selected-text-aloud",
      name: "Read selected text aloud",
      editorCallback: (editor: Editor) => {
        void this.readSelectedText(editor);
      },
    });

    this.addCommand({
      id: "pause-reading-aloud",
      name: "Pause reading aloud",
      callback: () => this.pause(),
    });

    this.addCommand({
      id: "resume-reading-aloud",
      name: "Resume reading aloud",
      callback: () => this.resume(),
    });

    this.addCommand({
      id: "stop-reading-aloud",
      name: "Stop reading aloud",
      callback: () => this.stop(),
    });

    this.addSettingTab(new ElevenLabsTtsSettingTab(this.app, this));
  }

  onunload() {
    this.stop();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async readActiveNote() {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView) {
      new Notice("Open a note to read aloud.");
      return;
    }

    await this.readText(markdownView.editor.getValue(), "Reading active note aloud...");
  }

  private async readSelectedText(editor: Editor) {
    const selectedText = editor.getSelection();
    if (!selectedText.trim()) {
      new Notice("Select text to read aloud first.");
      return;
    }

    await this.readText(selectedText, "Reading selected text aloud...");
  }

  private async readText(rawText: string, startedMessage: string) {
    if (!this.settings.apiKey.trim()) {
      new Notice("Add your ElevenLabs API key in plugin settings first.");
      return;
    }

    const text = cleanMarkdownForSpeech(rawText);
    if (!text) {
      new Notice("There is no readable text in this note.");
      return;
    }

    this.stop();
    this.isStopping = false;
    const playbackSession = ++this.sessionId;
    const chunks = chunkText(text, this.settings.chunkSize);

    new Notice(`${startedMessage} ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}.`);

    try {
      for (const chunk of chunks) {
        if (this.isStopping || playbackSession !== this.sessionId) {
          break;
        }

        const audioData = await this.fetchSpeech(chunk);
        if (this.isStopping || playbackSession !== this.sessionId) {
          break;
        }

        await this.playAudio(audioData, playbackSession);
      }
    } catch (error) {
      if (!this.isStopping) {
        console.error("ElevenLabs TTS failed", error);
        new Notice(getReadableErrorMessage(error));
      }
    } finally {
      if (playbackSession === this.sessionId) {
        this.releaseCurrentAudio();
      }
    }
  }

  private async fetchSpeech(text: string): Promise<ArrayBuffer> {
    const response = await requestUrl({
      url: `${API_BASE_URL}/${encodeURIComponent(this.settings.voiceId)}?output_format=${encodeURIComponent(this.settings.outputFormat)}`,
      method: "POST",
      headers: {
        "xi-api-key": this.settings.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: this.settings.modelId,
        voice_settings: {
          stability: this.settings.stability,
          similarity_boost: this.settings.similarityBoost,
          style: this.settings.style,
          use_speaker_boost: this.settings.useSpeakerBoost,
        },
      }),
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`ElevenLabs returned ${response.status}: ${response.text || "no response body"}`);
    }

    return response.arrayBuffer;
  }

  private playAudio(audioData: ArrayBuffer, playbackSession: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.releaseCurrentAudio();

      const audioBlob = new Blob([audioData], { type: "audio/mpeg" });
      this.currentObjectUrl = URL.createObjectURL(audioBlob);
      this.currentAudio = new Audio(this.currentObjectUrl);

      const cleanup = () => {
        if (this.currentAudio === audio) {
          this.releaseCurrentAudio();
        }
      };

      const audio = this.currentAudio;
      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error("Obsidian could not play the generated audio."));
      };

      if (this.isStopping || playbackSession !== this.sessionId) {
        cleanup();
        resolve();
        return;
      }

      void audio.play().catch((error) => {
        cleanup();
        reject(error);
      });
    });
  }

  private pause() {
    if (!this.currentAudio) {
      new Notice("Nothing is currently playing.");
      return;
    }

    this.currentAudio.pause();
  }

  private resume() {
    if (!this.currentAudio) {
      new Notice("Nothing is currently paused.");
      return;
    }

    void this.currentAudio.play();
  }

  private stop() {
    this.isStopping = true;
    this.sessionId++;
    this.releaseCurrentAudio();
  }

  private releaseCurrentAudio() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = "";
      this.currentAudio.load();
      this.currentAudio = null;
    }

    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
  }
}

class ElevenLabsTtsSettingTab extends PluginSettingTab {
  plugin: ElevenLabsTtsPlugin;

  constructor(app: App, plugin: ElevenLabsTtsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "ElevenLabs Text to Speech" });

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Stored locally in this plugin's data.json file.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("sk_...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Voice ID")
      .setDesc("Paste a voice ID from your ElevenLabs voice library.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.voiceId)
          .setValue(this.plugin.settings.voiceId)
          .onChange(async (value) => {
            this.plugin.settings.voiceId = value.trim() || DEFAULT_SETTINGS.voiceId;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Model ID")
      .setDesc("Use an ElevenLabs text-to-speech model ID.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.modelId)
          .setValue(this.plugin.settings.modelId)
          .onChange(async (value) => {
            this.plugin.settings.modelId = value.trim() || DEFAULT_SETTINGS.modelId;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Output format")
      .setDesc("ElevenLabs output format query value.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.outputFormat)
          .setValue(this.plugin.settings.outputFormat)
          .onChange(async (value) => {
            this.plugin.settings.outputFormat = value.trim() || DEFAULT_SETTINGS.outputFormat;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Chunk size")
      .setDesc("Maximum characters sent to ElevenLabs per request.")
      .addSlider((slider) =>
        slider
          .setLimits(500, 4500, 100)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.chunkSize)
          .onChange(async (value) => {
            this.plugin.settings.chunkSize = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Stability")
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.05)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.stability)
          .onChange(async (value) => {
            this.plugin.settings.stability = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Similarity boost")
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.05)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.similarityBoost)
          .onChange(async (value) => {
            this.plugin.settings.similarityBoost = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Style")
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.05)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.style)
          .onChange(async (value) => {
            this.plugin.settings.style = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Speaker boost")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useSpeakerBoost)
          .onChange(async (value) => {
            this.plugin.settings.useSpeakerBoost = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("p", {
      cls: "eltts-setting-note",
      text: "Use the command palette or the ribbon speaker icon to read the active note. Select text first to read only a passage.",
    });
  }
}

function cleanMarkdownForSpeech(markdown: string): string {
  return markdown
    .replace(/^---[\s\S]*?---\s*/u, "")
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gmu, "")
    .replace(/^[ \t]*[-*+][ \t]+/gmu, "")
    .replace(/^[ \t]*\d+\.[ \t]+/gmu, "")
    .replace(/[*_~>#|[\]]/gu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}

function chunkText(text: string, maxChunkSize: number): string[] {
  const paragraphs = text.split(/\n{2,}/u).map((paragraph) => paragraph.trim()).filter(Boolean);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = "";
      }

      chunks.push(...splitLongParagraph(paragraph, maxChunkSize));
      continue;
    }

    const candidate = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChunkSize) {
      currentChunk = candidate;
    } else {
      chunks.push(currentChunk);
      currentChunk = paragraph;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function splitLongParagraph(paragraph: string, maxChunkSize: number): string[] {
  const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*|.+$/gu) ?? [paragraph];
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) {
      continue;
    }

    if (trimmedSentence.length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = "";
      }
      chunks.push(...splitByWords(trimmedSentence, maxChunkSize));
      continue;
    }

    const candidate = currentChunk ? `${currentChunk} ${trimmedSentence}` : trimmedSentence;
    if (candidate.length <= maxChunkSize) {
      currentChunk = candidate;
    } else {
      chunks.push(currentChunk);
      currentChunk = trimmedSentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function splitByWords(text: string, maxChunkSize: number): string[] {
  const words = text.split(/\s+/u);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const word of words) {
    const candidate = currentChunk ? `${currentChunk} ${word}` : word;
    if (candidate.length <= maxChunkSize) {
      currentChunk = candidate;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = word;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function getReadableErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "ElevenLabs text-to-speech failed.";
}
