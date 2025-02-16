# Chrome Extension App

This project is a Chrome extension that retrieves the current open tab, sends the title and URL to a large language model for reorganization, and groups the tabs based on the model's response.

## Project Structure

- **manifest.json**: Configuration file for the Chrome extension.
- **popup.html**: User interface for the extension's popup.
- **popup.js**: Logic for the popup, including tab retrieval and grouping.
- **background.js**: Background script for managing events and communication with the language model.
- **README.md**: Documentation for the project.

## Setup Instructions

1. Clone the repository or download the project files.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable "Developer mode" by toggling the switch in the top right corner.
4. Click on "Load unpacked" and select the `chrome-extension-app` directory.
5. The extension should now be loaded and ready to use.

## Usage

- Click on the extension icon in the Chrome toolbar to open the popup.
- The extension will retrieve the current open tab's title and URL.
- It will send this information to a large language model for reorganization.
- Based on the model's response, the extension will group the tabs accordingly.

## Contributing

Feel free to submit issues or pull requests for any improvements or bug fixes.

## License

This project is licensed under the MIT License.