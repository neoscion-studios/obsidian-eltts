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

## Installing with BRAT

Add this repository to BRAT:

```text
neoscion-studios/obsidian-eltts
```

BRAT installs Obsidian plugins from GitHub release assets. To publish a BRAT-compatible release, make sure the tag matches the version in `manifest.json` and `package.json`, then push the tag:

```bash
git tag 0.1.0
git push origin 0.1.0
```

The release workflow builds the plugin and attaches the files BRAT needs: `manifest.json`, `main.js`, and `styles.css`.

## Commands

- `Read active note aloud`
- `Read selected text aloud`
- `Pause reading aloud`
- `Resume reading aloud`
- `Stop reading aloud`

The default voice ID is ElevenLabs' Rachel voice. You can paste any ElevenLabs voice ID into the settings tab.

## License

MIT
