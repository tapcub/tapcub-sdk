# Public API stays; internals may be shrunk and obfuscated.
-keep class com.tapcub.TapCub { public *; }
-keep class com.tapcub.TapCubScreen { *; }
-keep interface com.tapcub.ConsentListener { *; }
-keep interface com.tapcub.SessionListener { *; }
-keep interface com.tapcub.ErrorListener { *; }
-keep class com.tapcub.core.** { public *; }
-keepattributes RuntimeVisibleAnnotations
