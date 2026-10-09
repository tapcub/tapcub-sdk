pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "tapcub-android"

include(":core")
// The Android module needs the Android SDK; `-Ptapcub.coreOnly=true` runs the core vectors without it.
if (providers.gradleProperty("tapcub.coreOnly").orNull != "true") include(":sdk")
