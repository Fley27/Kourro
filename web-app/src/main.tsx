// Web build of the shared app: the React Native tree renders through
// react-native-web. `shims/install-globals` must be imported before the app
// so the web expo-sqlite implementation is in place when src/db/index.ts
// evaluates its `require("expo-sqlite")` fallback chain.
import "./shims/process-shim";
import "./shims/install-globals";
import { AppRegistry } from "react-native-web";
import App from "@app/App";
import { initPwa } from "./pwa/register";
import { installStoragePersistence } from "./pwa/storage";
import { mountPwaUpdatePrompt } from "./pwa/UpdatePrompt";

AppRegistry.registerComponent("Kourro", () => App);
AppRegistry.runApplication("Kourro", {
  rootTag: document.getElementById("root"),
  initialProps: {},
});

installStoragePersistence();
initPwa();
mountPwaUpdatePrompt();
