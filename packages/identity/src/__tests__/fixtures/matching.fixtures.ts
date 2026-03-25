import type { AliasRecord, MatchInput } from "../../types";

export interface MatchingFixture {
  name: string;
  input: MatchInput;
  aliases: AliasRecord[];
  expectedMatched: boolean;
  expectedMethod: string;
  expectedAppId: string | null;
  expectedAmbiguous: boolean;
}

const baseAliases: AliasRecord[] = [
  {
    appId: "app_iterm",
    appName: "iTerm2",
    aliasType: "bundle_id",
    value: "com.googlecode.iterm2",
    normalizedValue: "com.googlecode.iterm2",
    isExact: true,
    confidenceWeight: 100,
  },
  {
    appId: "app_iterm",
    appName: "iTerm2",
    aliasType: "name",
    value: "iTerm2",
    normalizedValue: "iterm2",
    isExact: false,
    confidenceWeight: 60,
  },
  {
    appId: "app_iterm",
    appName: "iTerm2",
    aliasType: "team_id",
    value: "H7V7XYVQ7D",
    normalizedValue: "h7v7xyvq7d",
    isExact: true,
    confidenceWeight: 100,
  },
  {
    appId: "app_sublime",
    appName: "Sublime Text",
    aliasType: "bundle_id",
    value: "com.sublimetext.4",
    normalizedValue: "com.sublimetext.4",
    isExact: true,
    confidenceWeight: 100,
  },
  {
    appId: "app_sublime",
    appName: "Sublime Text",
    aliasType: "name",
    value: "Sublime Text",
    normalizedValue: "sublime text",
    isExact: false,
    confidenceWeight: 60,
  },
];

export const matchingFixtures: MatchingFixture[] = [
  {
    name: "exact bundle ID match",
    input: { appName: "iTerm", bundleId: "com.googlecode.iterm2" },
    aliases: baseAliases,
    expectedMatched: true,
    expectedMethod: "exact_bundle_id",
    expectedAppId: "app_iterm",
    expectedAmbiguous: false,
  },
  {
    name: "case-insensitive bundle ID",
    input: { appName: "iTerm", bundleId: "COM.GOOGLECODE.ITERM2" },
    aliases: baseAliases,
    expectedMatched: true,
    expectedMethod: "exact_bundle_id",
    expectedAppId: "app_iterm",
    expectedAmbiguous: false,
  },
  {
    name: "team ID + name match",
    input: { appName: "iTerm2", teamId: "H7V7XYVQ7D" },
    aliases: baseAliases,
    expectedMatched: true,
    expectedMethod: "team_id_name",
    expectedAppId: "app_iterm",
    expectedAmbiguous: false,
  },
  {
    name: "name alias fallback",
    input: { appName: "Sublime Text" },
    aliases: baseAliases,
    expectedMatched: true,
    expectedMethod: "alias_name",
    expectedAppId: "app_sublime",
    expectedAmbiguous: false,
  },
  {
    name: "no match for unknown app",
    input: { appName: "Totally Unknown App" },
    aliases: baseAliases,
    expectedMatched: false,
    expectedMethod: "none",
    expectedAppId: null,
    expectedAmbiguous: false,
  },
  {
    name: "ambiguous match with close confidence",
    input: { appName: "Editor" },
    aliases: [
      {
        appId: "app_a",
        appName: "Editor A",
        aliasType: "name",
        value: "Editor",
        normalizedValue: "editor",
        isExact: false,
        confidenceWeight: 60,
      },
      {
        appId: "app_b",
        appName: "Editor B",
        aliasType: "name",
        value: "Editor",
        normalizedValue: "editor",
        isExact: false,
        confidenceWeight: 55,
      },
    ],
    expectedMatched: true,
    expectedMethod: "alias_name",
    expectedAppId: "app_a",
    expectedAmbiguous: true,
  },
];
