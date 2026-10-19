// @expo-google-fonts/inter → Vite asset URLs.
//
// The real package's font constants are Metro `require()` asset IDs. On web
// we hand expo-font's FontLoader (web) the emitted asset URL strings — its
// `uriFromFontSource` accepts strings directly — and re-export the package's
// real `useFonts` so App.tsx keeps working unchanged.
import Inter_300Light from "@expo-google-fonts/inter/300Light/Inter_300Light.ttf?url";
import Inter_400Regular from "@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf?url";
import Inter_500Medium from "@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf?url";
import Inter_600SemiBold from "@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf?url";
import Inter_700Bold from "@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf?url";

export { useFonts } from "@expo-google-fonts/inter/useFonts";

export {
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
};
