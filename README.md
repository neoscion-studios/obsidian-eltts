# ElevenLabs Text to Speech for Obsidian

Read the active note or selected text aloud with the ElevenLabs API.

## Development

```bash
npm install
npm run build
```

Copy `manifest.json`, `main.js`, and `styles.css` into:

```text
<vault>/.obsidian/plugins/obsidian-eltts/
```

Enable the plugin in Obsidian, then add your ElevenLabs API key in the plugin settings.

## Commands

- `Read active note aloud`
- `Read selected text aloud`
- `Pause reading aloud`
- `Resume reading aloud`
- `Stop reading aloud`

The default voice ID is ElevenLabs' Rachel voice. You can paste any ElevenLabs voice ID into the settings tab.
