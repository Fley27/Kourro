import { defineConfig, loadEnv, type Plugin } from "vite";
import { transform as esbuildTransform } from "esbuild";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileSource = path.resolve(__dirname, "../mobile-app");
const shim = (name: string) => path.resolve(__dirname, "src/shims", name);

// Metro `require()` of static assets does not exist in Vite's ESM pipeline.
// The shared source has a handful of `require("../../assets/*.png")` calls
// and @expo/vector-icons' legacy family files require .ttf fonts — rewrite
// all of them to `new URL(..., import.meta.url)` which Vite resolves to
// emitted asset URLs in dev and build alike (no mobile source edits).
const ASSET_REQUIRE = /\brequire\(\s*(["'])([^"']+\.(?:png|jpg|jpeg|gif|webp|svg|ttf|otf|woff2?))\1\s*\)/g;

function rnAssetRequire(): Plugin {
  return {
    name: "rn-asset-require",
    enforce: "pre",
    transform(code, id) {
      // Dev-mode ids carry ?v=hash queries — compare against the clean path.
      const file = id.split("?")[0];
      const isMobileSource = file.startsWith(mobileSource);
      const isVectorIcons = file.includes("@expo/vector-icons");
      if (!isMobileSource && !isVectorIcons) return null;
      if (!code.includes("require(")) return null;
      ASSET_REQUIRE.lastIndex = 0;
      if (!ASSET_REQUIRE.test(code)) return null;
      ASSET_REQUIRE.lastIndex = 0;
      return {
        code: code.replace(
          ASSET_REQUIRE,
          (_match, _quote, assetPath) => `new URL(${JSON.stringify(assetPath)}, import.meta.url).href`
        ),
        map: null,
      };
    },
  };
}

// Several compiled packages ship JSX inside plain .js files (esbuild output
// keeps JSX; tsc emit with "jsx": "preserve"). @vitejs/plugin-react
// blanket-excludes node_modules, so transform the known offenders here so
// Rollup can parse them.
const JSX_PACKAGES = [
  /node_modules\/@expo\/vector-icons\//,
  /node_modules\/expo-blur\//,
  /node_modules\/react-native-safe-area-context\//,
  /node_modules\/react-native-svg\//,
];

function isNodeModulesJsx(id: string): boolean {
  const file = id.split("?")[0];
  if (!file.includes("/node_modules/") || !file.endsWith(".js")) return false;
  return /\.web\.js$/.test(file) || JSX_PACKAGES.some((re) => re.test(file));
}

function vectorIconsJsx(): Plugin {
  return {
    name: "vector-icons-jsx",
    enforce: "pre",
    async transform(code, id) {
      if (!isNodeModulesJsx(id)) return null;
      // One runtime vendor file is CommonJS (`module.exports = { pick, omit }`).
      // Excluded from optimizeDeps, Vite serves it raw and the ESM named
      // import from icon-button.js fails. esbuild cannot synthesize named
      // exports in transform/bundle mode for a CJS entry, so do it directly.
      if (code.includes("module.exports") && !/^\s*(import|export)\s/m.test(code)) {
        const named = code.match(/module\.exports\s*=\s*\{([^}]*)\}/);
        const names = named
          ? named[1]
              .split(",")
              .map((part) => {
                // Support `key` and `key: value` shorthand; alias keys must be
                // exported as `value as key` (e.g. `SyntaxError: peg$SyntaxError`).
                const [key, value] = part.split(":").map((piece) => piece.trim());
                if (!key || !/^[A-Za-z_$][\w$]*$/.test(key)) return null;
                const local = value || key;
                if (!/^[A-Za-z_$][\w$]*$/.test(local)) return null;
                return local === key ? key : `${local} as ${key}`;
              })
              .filter((name): name is string => Boolean(name))
          : [];
        return {
          code:
            code.replace(/module\.exports\s*=/g, "const __cjsExports =") +
            `\nexport default __cjsExports;\nexport { ${names.join(", ")} };`,
          map: null,
        };
      }
      const result = await esbuildTransform(code, {
        loader: "jsx",
        jsx: "automatic",
        sourcefile: id,
      });
      return { code: result.code, map: null };
    },
  };
}

// react-native-gifted-charts loads its gradient dependency through a CJS
// `require('react-native-linear-gradient')` inside try/catch and probes
// `require("react-native/package.json").version` in its utils. Rollup does
// not apply `resolve.alias`/node resolution to CJS requires kept by the
// commonjs plugin, so the browser build would throw `require is not defined`
// / "Gradient package was not found" (dev works: esbuild's prebundling
// resolves both). Patch the two known call sites with build-safe values.
function giftedChartsFixes(): Plugin {
  const GRADIENT = "/react-native-gifted-charts/dist/Components/common/LinearGradient.js";
  const UTILS = "/react-native-gifted-charts/dist/utils/index.js";
  return {
    name: "gifted-charts-fixes",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0];
      if (file.endsWith(GRADIENT)) {
        return {
          code: 'import LinearGradient from "react-native-linear-gradient";\nexport default LinearGradient;\n',
          map: null,
        };
      }
      if (file.endsWith(UTILS) && code.includes("react-native/package.json")) {
        return {
          // RNW 0.19 tracks RN 0.72; the value only feeds feature branches.
          code: code.replace(
            /require\((['"])react-native\/package\.json\1\)/g,
            '({ version: "0.72.0" })'
          ),
          map: null,
        };
      }
      return null;
    },
  };
}

// The PWA mounts the mobile/tablet app source directly (react-native-web).
// Every platform leaf that cannot run in a browser is remapped to a shim —
// this is the ONLY place the web build differs from the native build.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const define: Record<string, string> = {
    "process.env.NODE_ENV": JSON.stringify(mode),
    "process.env.EXPO_PUBLIC_SUPABASE_URL": JSON.stringify(env.EXPO_PUBLIC_SUPABASE_URL ?? "http://localhost:54321"),
    "process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "anon-key"),
    "process.env.EXPO_PUBLIC_MIDDLEWARE_URL": JSON.stringify(env.EXPO_PUBLIC_MIDDLEWARE_URL ?? "http://localhost:4000"),
    "process.env.EXPO_PUBLIC_FORCE_LIVE_AUTH": JSON.stringify(env.EXPO_PUBLIC_FORCE_LIVE_AUTH ?? ""),
    __DEV__: JSON.stringify(mode !== "production"),
  };

  return {
    plugins: [
      rnAssetRequire(),
      vectorIconsJsx(),
      giftedChartsFixes(),
      react(),
      VitePWA({
        registerType: "prompt",
        injectRegister: null,
        includeAssets: ["icons/favicon.svg", "icons/favicon-32.png", "icons/apple-touch-icon.png"],
        manifest: {
          name: "Kourro",
          short_name: "Kourro",
          description: "Bati yon biznis ki ap siviv ou — POS offline-first pou magazen Ayisyen.",
          lang: "ht",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "any",
          theme_color: "#000000",
          background_color: "#000000",
          categories: ["business", "finance", "productivity"],
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2,ttf,wasm}"],
          navigateFallback: "index.html",
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          // API traffic (Supabase + middleware) is cross-origin and must never be cached.
          runtimeCaching: [],
          cleanupOutdatedCaches: true,
        },
        devOptions: { enabled: false },
      }),
    ],
    define,
    resolve: {
      // Metro-style platform resolution: .web.* variants of packages (react-native-svg,
      // expo-blur, safe-area-context, expo-font, …) win over their native files.
      extensions: [".web.tsx", ".web.ts", ".web.jsx", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
      alias: [
        { find: /^react-native$/, replacement: shim("react-native.tsx") },
        { find: /^react-native-linear-gradient$/, replacement: shim("react-native-linear-gradient.tsx") },
        { find: /^expo-linear-gradient$/, replacement: shim("react-native-linear-gradient.tsx") },
        { find: /^@react-native\/assets-registry(\/registry)?$/, replacement: shim("react-native-assets-registry.ts") },
        { find: /^expo-sqlite$/, replacement: shim("expo-sqlite.ts") },
        { find: /^expo-secure-store$/, replacement: shim("expo-secure-store.ts") },
        { find: /^expo-crypto$/, replacement: shim("expo-crypto.ts") },
        { find: /^expo-notifications$/, replacement: shim("expo-notifications.ts") },
        { find: /^expo-print$/, replacement: shim("expo-print.ts") },
        { find: /^expo-sharing$/, replacement: shim("expo-sharing.ts") },
        { find: /^expo-contacts$/, replacement: shim("expo-contacts.ts") },
        { find: /^@expo-google-fonts\/inter$/, replacement: shim("expo-google-fonts-inter.ts") },
        { find: "@app", replacement: mobileSource },
      ],
      dedupe: ["react", "react-dom", "react-native-web"],
    },
    optimizeDeps: {
      // wa-sqlite ships its own ESM loader for the wasm module — keep it
      // untouched. The RN packages below carry JSX/Flow in source files that
      // esbuild pre-bundling cannot parse; serve them as source instead (our
      // vector-icons-jsx plugin transforms the JSX files).
      // Force prebundling of these up front: they are discovered at runtime
      // through excluded packages (expo-font), and a raw source serve would
      // expose their deep CJS imports (`invariant/browser.js`) to ESM.
      include: ["expo-modules-core", "fontfaceobserver"],
      exclude: [
        "wa-sqlite",
        "@expo/vector-icons",
        "expo-blur",
        // Metro-style platform files (`./FontLoader` → `FontLoader.web.js`)
        // are NOT honored by the dep optimizer's esbuild resolution, which
        // would bundle the native variants (requireNativeModule → throw).
        // Serving these as source goes through Vite's `resolve.extensions`.
        "expo-font",
        "expo-asset",
        "expo-constants",
        "react-native-svg",
        "react-native-safe-area-context",
        "@react-native/assets-registry",
      ],
    },
    server: {
      port: 5173,
      host: true,
      fs: {
        // The app source lives outside the Vite root (../mobile-app).
        allow: [path.resolve(__dirname, "..")],
      },
    },
    build: {
      target: "es2022",
      sourcemap: false,
      chunkSizeWarningLimit: 4096,
    },
  };
});
