# TapCub SDK

Client and server SDKs for [TapCub](https://tapcub.com), MIT licensed. Every platform follows the same behavior spec, enforced by shared test vectors: `packages/shared/test-vectors/sdk` for client SDKs, `packages/shared/test-vectors/track` for server SDKs.

> This repository is a read-only mirror. Development happens in the TapCub main repository and is synced here as snapshots, so the commit history is not continuous. Please open an issue for bugs and suggestions.

| Directory | Platform | Install |
| --- | --- | --- |
| `packages/app-sdk` | App core shared by Android / iOS / HarmonyOS (TypeScript) | `npm i @tapcub/app-sdk` |
| `packages/miniprogram` | WeChat / Alipay / Douyin mini programs | `npm i @tapcub/miniprogram` |
| `packages/uni-app` | uni-app bridge | `npm i @tapcub/uni-app` |
| `packages/react-native` | React Native bridge | `npm i @tapcub/react-native` |
| `packages/tapcub_flutter` | Flutter plugin | `flutter pub add tapcub_flutter` |
| `packages/android` | Android (Kotlin) | Maven Central `com.tapcub:android` |
| `packages/harmony` | HarmonyOS HAR (ArkTS) | OHPM `@tapcub/harmony` (coming soon) |
| `packages/sdk-server/node` | Node.js server (18+) | `npm i @tapcub/node` |
| `packages/sdk-server/python` | Python server (3.8+) | `pip install tapcub` |
| `packages/sdk-server/java` | Java server (11+) | Maven Central `com.tapcub:tapcub-java` |

iOS, PHP and Go have their own repositories: [tapcub-ios](https://github.com/tapcub/tapcub-ios) (Swift Package Manager), [tapcub-php](https://github.com/tapcub/tapcub-php) (Packagist `tapcub/tapcub-php`) and [tapcub-go](https://github.com/tapcub/tapcub-go) (`go get github.com/tapcub/tapcub-go`).

## Development

Requires Node.js 22.7+ and pnpm (the version is pinned in `packageManager` in `package.json`; `corepack enable` sets it up).

```bash
pnpm install
pnpm test                                   # tests for every TS package + Android / Flutter API surface checks
pnpm typecheck
cd packages/android && ./gradlew :core:test # the Kotlin core runs the same vectors (JDK 17 + Android SDK)
cd packages/sdk-server/python && python -m unittest discover -s tests -t .
cd packages/sdk-server/java && mvn verify   # JDK 11+
```

`packages/harmony/src/main/core/` is generated from `packages/app-sdk/src/core` by `pnpm sync:harmony`; do not edit it by hand.

## Releases

Releases are triggered by tags pushed from the TapCub main repository (`pnpm sdk:sync -- --push --tag <platform>-v<version>`):

| Tag | Workflow | Published to |
| --- | --- | --- |
| `app-sdk-v*`, `miniprogram-v*`, `uni-app-v*`, `react-native-v*`, `node-v*` | `release-npm.yml` | npm (Trusted Publishing + provenance) |
| `flutter-v*` | `release-pub.yml` | pub.dev (automated publishing) |
| `python-v*` | `release-pypi.yml` | PyPI (Trusted Publisher) |
| `android-v*`, `java-v*` | `release-maven.yml` | Maven Central (Central Portal, GPG-signed) |
| `harmony-v*` | `release-ohpm.yml` | OHPM (placeholder; what is missing is listed at the top of the file) |

npm, pub.dev and PyPI publish through GitHub OIDC, with no long-lived tokens stored; Maven Central uses a user token and a signing key kept in the `maven-central` environment. The one-time setup for each registry is described at the top of its workflow file.

## License

MIT, see [LICENSE](LICENSE).
