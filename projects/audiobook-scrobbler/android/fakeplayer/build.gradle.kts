// Test fixture: a scripted "audiobook player" that publishes a real
// MediaSession so the scrobbler's listener can be exercised on an emulator
// without Audible/Libby installed. Driven entirely by adb intents; see
// ../tools/e2e.py.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.curijoes.fakeplayer"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.curijoes.fakeplayer"
        minSdk = 34
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
    }

    buildTypes {
        debug { isMinifyEnabled = false }
        release { isMinifyEnabled = false }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
}
