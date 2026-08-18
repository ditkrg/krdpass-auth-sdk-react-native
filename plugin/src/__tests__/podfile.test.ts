import * as pluginEntry from "../index";
import { ensureKrdpassAuthPodSource } from "../podfile";

const pod =
  "pod 'KrdpassAuth', :git => 'https://github.com/ditkrg/krdpass-auth-sdk-ios.git', :tag => 'v1.6.0'";

const expoPodfile = `platform :ios, '15.1'

target 'Example' do
  use_expo_modules!
end
`;

describe("ensureKrdpassAuthPodSource", () => {
  it("adds a marked pod declaration after use_expo_modules!", () => {
    expect(ensureKrdpassAuthPodSource(expoPodfile)).toBe(`platform :ios, '15.1'

target 'Example' do
  use_expo_modules!

  # @generated begin krdpass-auth-react-native - expo prebuild (DO NOT MODIFY)
  ${pod}
  # @generated end krdpass-auth-react-native

end
`);
  });

  it("is idempotent", () => {
    const once = ensureKrdpassAuthPodSource(expoPodfile);
    expect(ensureKrdpassAuthPodSource(once)).toBe(once);
  });

  it("rewrites a hand-written git declaration instead of duplicating it", () => {
    const handWritten = expoPodfile.replace(
      "  use_expo_modules!",
      "  use_expo_modules!\n  pod 'KrdpassAuth', :git => 'https://github.com/ditkrg/krdpass-auth-sdk-ios.git', :tag => 'v1.0.0'",
    );

    expect(ensureKrdpassAuthPodSource(handWritten)).toContain(`  ${pod}`);
    expect(ensureKrdpassAuthPodSource(handWritten)).not.toContain("v1.0.0");
  });

  it("preserves a host-managed local path override", () => {
    const localOverride = expoPodfile.replace(
      "  use_expo_modules!",
      "  use_expo_modules!\n  pod 'KrdpassAuth', :path => '../krdpass-auth-sdk-ios'",
    );

    expect(ensureKrdpassAuthPodSource(localOverride)).toBe(localOverride);
  });

  it("preserves CRLF line endings", () => {
    const crlfPodfile = expoPodfile.replace(/\n/g, "\r\n");
    expect(ensureKrdpassAuthPodSource(crlfPodfile)).toContain(`\r\n  ${pod}\r\n`);
  });

  it("fails clearly when used with a non-Expo Podfile", () => {
    expect(() => ensureKrdpassAuthPodSource("target 'Example' do\nend\n")).toThrow(
      /use_expo_modules!/,
    );
  });
});

// app.plugin.js re-exports the plugin entry, so every named export there is public API from
// day one. Adding a named export back to the entry fails here.
describe("plugin entry surface", () => {
  it("exports only the config plugin itself", () => {
    expect(Object.keys(pluginEntry).sort()).toEqual(["default"]);
  });
});
