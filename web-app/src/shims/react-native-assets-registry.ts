// @react-native/assets-registry (Flow source) → web stub.
// expo-asset imports only `getAssetByID`, and only for Metro asset IDs —
// on web our font/asset sources are URL strings, so the registry stays empty.
export type PackagerAsset = Record<string, unknown>;

const assets: PackagerAsset[] = [];

export function registerAsset(asset: PackagerAsset): number {
  assets.push(asset);
  return assets.length;
}

export function getAssetByID(assetId: number): PackagerAsset | undefined {
  return assets[assetId - 1];
}

export function setCustomSourceTransformer(): void {
  /* no-op on web */
}

export default { registerAsset, getAssetByID, setCustomSourceTransformer };
