import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { TsdownPlugin } from '@oh-awesome-novel/forge-plugin-tsdown';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDirectory = fileURLToPath(new URL('.', import.meta.url));
const iconDirectory = path.join(desktopDirectory, 'assets', 'icons');
const pngIcon = path.join(iconDirectory, 'icon-512.png');
const windowsIcon = path.join(iconDirectory, 'icon.ico');

/**
 *
 * @import("@electron-forge/shared-types").ForgeConfig
 */
const config = {
  packagerConfig: {
    name: 'oan',
    executableName: 'oan',
    appBundleId: 'com.oh-awesome-novel.oan',
    // Packager chooses .icns on macOS and .ico on Windows from this base path.
    icon: path.join(iconDirectory, 'icon'),
    asar: true,
    extraResource: [path.join(desktopDirectory, 'THIRD_PARTY_NOTICES.md'), iconDirectory],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ name: 'oan', setupIcon: windowsIcon }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({ options: { name: 'oan', bin: 'oan', icon: pngIcon } }),
    new MakerDeb({ options: { name: 'oan', bin: 'oan', icon: pngIcon } }),
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
                /^electron-squirrel-startup(?:\/|$)/,
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
    // while packaging the application.
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
