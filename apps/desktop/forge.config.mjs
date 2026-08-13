import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { TsdownPlugin } from '@oh-awesome-novel/forge-plugin-tsdown';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

/**
 *
 * @import("@electron-forge/shared-types").ForgeConfig
 */
const config = {
  packagerConfig: {
    asar: true,
    extraResource: ['THIRD_PARTY_NOTICES.md'],
    // Fuses mutate the Electron binary during packageAfterCopy. Signing at the
    // packager's final step keeps the finished macOS bundle internally valid.
    osxSign: { identity: '-', identityValidation: false },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new TsdownPlugin({
      build: [
        {
          entry: 'src/main.ts',
          target: 'main',
          config: {
            deps: {
              alwaysBundle: [
                /^@oh-awesome-novel\//,
                /^ai(?:\/|$)/,
                /^bash-tool(?:\/|$)/,
                /^diff(?:\/|$)/,
                /^just-bash(?:\/|$)/,
                /^yaml(?:\/|$)/,
              ],
              onlyBundle: false,
            },
          },
        },
        {
          entry: 'src/preload.ts',
          target: 'preload',
        },
      ],
      renderer: {
        dir: '../desktop-ui',
        dist: '../desktop-ui/dist',
      },
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
