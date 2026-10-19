// Install web globals the shared app source expects BEFORE it is imported.
// expo-sqlite is resolved through this global on web (see src/db/index.ts:
// `(globalThis as any).__JESYON_SQLITE__ ?? require("expo-sqlite")`), keeping
// the native path (Metro `require`) untouched.
//
// expo-modules-core's NativeModule.js reads `globalThis.expo.NativeModule`
// unguarded at module scope; Expo's web runtime installs that global via
// CoreModule.js, which our app must import explicitly (no Expo entrypoint).
import "expo-modules-core/build/web/CoreModule";
import * as SQLiteShim from "./expo-sqlite";

(globalThis as any).__JESYON_SQLITE__ = SQLiteShim;
