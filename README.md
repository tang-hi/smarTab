# SmarTab - AI-Powered Tab Management

![SmarTab Logo](images/128.png)

SmarTab is a browser extension that uses AI to intelligently organize your browser tabs into meaningful groups, helping you stay organized and reduce tab clutter.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/ffddpdidlmbeleejbllbimfhlmahkkln?label=Chrome%20Web%20Store&logo=google-chrome&logoColor=white)](https://chromewebstore.google.com/detail/smarttab/ffddpdidlmbeleejbllbimfhlmahkkln)

## Features

### Smart Tab Grouping
SmarTab uses AI to analyze your open tabs and organize them into logical groups based on content similarity. The extension automatically:
- Creates meaningful group names with emojis for better visual recognition
- Assigns appropriate colors to each group based on content type
- Handles large numbers of tabs efficiently

### Auto Tab Management
- **Auto-collapse other groups**: Automatically collapse other tab groups when switching between them, keeping your browser tidy
- **Auto-group new tabs**: Automatically organize new tabs after 10 seconds, either adding them to an existing relevant group or creating a new group

### Customization Options
- **Custom API Key**: Use your own Gemini API key for faster responses (optional)
- **Maximum tabs per group**: Control the maximum number of tabs in each group
- **Custom grouping instructions**: Add specific instructions for how you want your tabs to be grouped
- **Advanced grouping mode**: Enable a more accurate (but slower) grouping algorithm for complex tab collections

### Tab Selection Controls
- **Current window only**: Choose to group tabs from only the current window or all windows
- **Include/exclude options**:
  - Group only the active tab
  - Include already grouped tabs in the grouping process
  - Include frozen/discarded tabs

## How to Use

1. Click the SmarTab icon in your browser toolbar
2. Review the count of tabs to be grouped
3. Click "Group Tabs" to organize your tabs
4. Tabs will be intelligently grouped with descriptive names and colors

## Settings

Access the settings page by clicking the gear icon in the popup to customize:

- API configuration
- Auto-grouping behaviors
- Tab selection preferences
- Grouping algorithm preferences
- Custom grouping instructions

## Privacy

SmarTab processes your tab information to provide grouping suggestions. When using our shared API service, only tab titles and URLs are sent to the service. For maximum privacy, you can use your own Gemini API key in the settings.

## Feedback and Support

If you encounter any issues or have suggestions for improving SmarTab, please create an issue on our [GitHub repository](https://github.com/tang-hi/smarTab) or contact us through the Chrome Web Store.

---

Made with ❤️ using Google's Gemini API
