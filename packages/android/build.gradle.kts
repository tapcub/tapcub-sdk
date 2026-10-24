plugins {
    id("com.android.library") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.jvm") version "2.0.21" apply false
    // Maven Central（Central Portal）发布：签名、POM、sources / javadoc jar（release-maven.yml）
    id("com.vanniktech.maven.publish") version "0.30.0" apply false
}

allprojects {
    group = "com.tapcub"
    version = "0.1.0"
}

