#import <React/RCTBridgeModule.h>
@import TapCub;

/// `NativeModules.TapCubCrash`: hands crashes recorded by the native SDK to the JS core. Capture starts when
/// the module loads; to catch startup crashes call `[TapCubCrash install]` in `didFinishLaunchingWithOptions:`.
@interface TapCubCrashModule : NSObject <RCTBridgeModule>
@end

@implementation TapCubCrashModule

RCT_EXPORT_MODULE(TapCubCrash)

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (instancetype)init {
  if ((self = [super init])) {
    [TapCubCrash install];
  }
  return self;
}

RCT_EXPORT_METHOD(drain:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  resolve([TapCubCrash drain]);
}

@end
