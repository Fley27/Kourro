// Web build global declarations. The shared mobile source references
// `process.env.EXPO_PUBLIC_*` (inlined by Vite `define`) and platform leaves
// that the browser build swaps for local shims (see vite.config.ts aliases).

declare const process: { env: Record<string, string | undefined> };

// react-native-web ships no bundled TypeScript types. The shared app is
// typechecked against the real react-native types; this module only exists as
// the runtime substitution target, so `any` is the right shape here.
// @ts-ignore -- shorthand ambient module
declare module "react-native-web";

declare module "*.wasm?url" {
  const url: string;
  export default url;
}

declare module "wa-sqlite/dist/wa-sqlite-async.mjs" {
  export type SQLiteModuleFactoryOptions = {
    locateFile?: (path: string) => string;
    wasmBinary?: ArrayBuffer;
    print?: (message: string) => void;
    printErr?: (message: string) => void;
  };
  export default function SQLiteESMFactory(options?: SQLiteModuleFactoryOptions): Promise<any>;
}

declare module "wa-sqlite/src/examples/IDBBatchAtomicVFS.js" {
  export type IDBBatchAtomicVFSOptions = {
    durability?: "default" | "strict" | "relaxed";
    purge?: "deferred" | "manual";
    purgeAtLeast?: number;
  };
  export class IDBBatchAtomicVFS {
    constructor(idbDatabaseName?: string, options?: IDBBatchAtomicVFSOptions);
    name: string;
  }
}
