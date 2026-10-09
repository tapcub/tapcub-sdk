// Autolinking: the native module is optional. Hosts that only want JS can leave both platforms null.
module.exports = {
  dependency: {
    platforms: {
      android: { sourceDir: 'android', packageImportPath: 'import com.tapcub.rn.TapCubCrashPackage;' },
      ios: {},
    },
  },
};
