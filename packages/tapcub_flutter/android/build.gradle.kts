// 按 Flutter 3.47 插件模板（flutter create --template=plugin）：内置 Kotlin，不再 apply kotlin-android；
// buildscript 里的 AGP / KGP 只在单独构建本插件时用，宿主 App 用它自己的版本。
group = "com.tapcub.flutter"
version = "0.2.0"

buildscript {
    val kotlinVersion = "2.4.0"
    repositories {
        google()
        mavenCentral()
    }

    dependencies {
        classpath("com.android.tools.build:gradle:9.1.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlinVersion")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

plugins {
    id("com.android.library")
}

android {
    namespace = "com.tapcub.flutter"

    compileSdk = 36

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets {
        getByName("main") {
            java.srcDirs("src/main/kotlin")
        }
    }

    defaultConfig {
        // The TapCub Android SDK supports Android 5.0+
        minSdk = 21
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    implementation("com.tapcub:android:0.1.1")
}
