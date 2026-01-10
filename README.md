<h1 align="center"> SmarTab - AI-Powered Tab Management </h1>

<h3 align="center"> SmarTab is a browser extension that uses AI to intelligently organize your browser tabs into meaningful groups and provides smart search with semantic understanding. </h3>

<p align="center">
<a href="https://chromewebstore.google.com/detail/smarttab/ffddpdidlmbeleejbllbimfhlmahkkln">
<img style="height:100px" src="https://user-images.githubusercontent.com/53124886/111952712-34f12300-8aee-11eb-9fdd-ad579a1eb235.png"></img>
</a>
</p>

## Installation

### From Source

1. Clone or download this repository
   ```bash
   git clone https://github.com/tang-hi/smarTab.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked"
5. Select the `smarTab` folder

## Demo

See SmarTab in action:
https://github.com/user-attachments/assets/f87bd6c2-dbd5-4b98-8b6a-dcad699c1e0f

## Features

### AI Tab Grouping

Automatically organize your tabs into logical groups using AI. SmarTab analyzes your open tabs and suggests intelligent groupings based on content, domain, and context.

- **Two-stage AI analysis**: First understands each tab's purpose, then creates meaningful groups
- **Preview before applying**: Review suggested groups before committing changes
- **Custom instructions**: Provide your own grouping preferences (e.g., "Always group GitHub tabs together")
- **Smart color coding**: Each group gets an appropriate color for visual distinction
- **Handles large tab collections**: Efficiently processes many tabs with batch processing

### Smart Tab Search

Find any tab instantly with powerful search capabilities.

- **Text search**: Match by tab title, URL, or group name
- **Semantic search**: When using Gemini or Doubao, search by meaning rather than exact keywords (e.g., search "shopping" to find Amazon, eBay tabs)
- **Keyboard navigation**: Use arrow keys to navigate, Enter to switch, Cmd/Ctrl+D to close
- **Cross-window search**: Find tabs across all browser windows
- **AI badge indicator**: Shows when semantic search is active

### Multiple AI Providers

| Provider | Tab Grouping | Semantic Search |
|----------|:------------:|:---------------:|
| **Gemini** | Yes | Yes |
| **Doubao** | Yes | Yes |
| **Custom** | Yes | - |

**Direct API access**: All requests go directly to your chosen provider. No proxy, no relay, no data collection.

### Auto Tab Management

- **Auto-collapse other groups**: Automatically collapse other tab groups when switching between them, keeping your browser tidy

## How to Use

### Grouping Tabs

1. Click the SmarTab icon in your toolbar
2. Click "Group tabs" to analyze ungrouped tabs
3. Double-click to re-analyze all tabs (including already grouped ones)
4. Review the preview and click "Apply" to create groups

### Searching Tabs

1. Click the SmarTab icon and then "Search tabs"
2. Type to filter tabs by title, URL, or group name
3. Use arrow keys to navigate results
4. Press Enter to switch to the selected tab


### Semantic Search

When Gemini or Doubao is configured as your AI provider, semantic search is automatically enabled:

- Search by concept rather than exact text
- Find related tabs even without matching keywords
- Results show an "AI" badge when semantic search is active
- Embeddings are cached locally to minimize API calls

## Settings

Access the settings page by clicking the gear icon in the popup.

### AI Provider Configuration

- **Provider**: Choose between Gemini, Doubao, or Custom (OpenAI-compatible)
- **API Key**: Your provider's API key (stored locally in browser)
- **Model**: Select from available models (auto-fetched from provider)
- **Custom API URL**: For OpenAI-compatible endpoints (e.g., OpenRouter)

### Behavior

- **Auto-collapse other groups**: When switching tabs, automatically collapse other groups to reduce clutter

### Tab Filters (Advanced Settings)

Control which tabs participate in grouping:

- **Exclude pinned tabs**: Keep pinned tabs out of automatic grouping
- **Exclude already grouped tabs**: Don't regroup tabs that are already organized
- **Current window only**: Only group tabs in the active window
- **Exclude frozen tabs**: Skip discarded/suspended tabs

### Custom Instructions

Provide additional context to the AI for better grouping results:

```
Example: Always group GitHub tabs together. Separate work docs from tutorials.
```

## Privacy

- All API requests go directly to your chosen provider
- API keys are stored locally in Chrome's sync storage
- Embedding cache is stored locally
- No data is sent to any third-party servers

## Permissions

- `tabs`: Access tab information for grouping and search
- `tabGroups`: Create and manage tab groups
- `storage`: Save settings and embedding cache
- `scripting`: Inject search overlay on keyboard shortcut
- `<all_urls>`: Required for content script injection

## Feedback and Support

If you encounter any issues or have suggestions for improving SmarTab, please create an issue on our [GitHub repository](https://github.com/tang-hi/smarTab) or contact us through the Chrome Web Store.

## License

MIT
