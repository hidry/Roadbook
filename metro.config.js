// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite's web build (wa-sqlite) imports a .wasm file — register it as an
// asset so the web bundle resolves it. (Web is only used for the E2E suite; the
// app ships on iOS/Android.)
config.resolver.assetExts.push('wasm');

module.exports = config;
