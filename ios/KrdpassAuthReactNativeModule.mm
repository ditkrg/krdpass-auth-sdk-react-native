#import <React/RCTBridgeModule.h>
#import <React/RCTInvalidating.h>
#import <KrdpassAuthReactNativeSpec/KrdpassAuthReactNativeSpec.h>

#import "KrdpassAuthReactNativeModule.h"

// This concrete Objective-C++ facade is the autolinked runtime module. It
// implements Codegen's protocol and owns the Swift implementation, keeping
// the TurboModule on one NSDictionary-based ABI.
@interface KrdpassAuthReactNative : NSObject <NativeKrdpassAuthReactNativeSpec, RCTInvalidating> {
  KrdpassAuthReactNativeModule *_implementation;
}
@end

@implementation KrdpassAuthReactNative

RCT_EXPORT_MODULE(KrdpassAuthReactNative)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

- (instancetype)init
{
  if (self = [super init]) {
    _implementation = [KrdpassAuthReactNativeModule new];
  }
  return self;
}

- (void)invalidate
{
  [_implementation teardown];
}

RCT_REMAP_METHOD(signIn,
                 signIn:(NSDictionary *)config
                 resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject)
{
  [_implementation signIn:config resolve:resolve rejecter:reject];
}

RCT_REMAP_METHOD(authenticate,
                 authenticate:(NSDictionary *)config
                 resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject)
{
  [_implementation authenticate:config resolve:resolve rejecter:reject];
}

RCT_REMAP_METHOD(cancelAuthentication,
                 cancelAuthentication:(NSDictionary *)config
                 resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject)
{
  [_implementation cancelAuthentication:config resolve:resolve rejecter:reject];
}

RCT_REMAP_METHOD(getUserInfo,
                 getUserInfo:(NSDictionary *)config
                 resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject)
{
  [_implementation getUserInfo:config resolve:resolve rejecter:reject];
}

RCT_REMAP_METHOD(refreshTokens,
                 refreshTokens:(NSDictionary *)config
                 resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject)
{
  [_implementation refreshTokens:config resolve:resolve rejecter:reject];
}

RCT_REMAP_METHOD(revokeToken,
                 revokeToken:(NSDictionary *)config
                 resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject)
{
  [_implementation revokeToken:config resolve:resolve rejecter:reject];
}

RCT_REMAP_METHOD(verifyToken,
                 verifyToken:(NSDictionary *)config
                 resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject)
{
  [_implementation verifyToken:config resolve:resolve rejecter:reject];
}

RCT_REMAP_METHOD(generatePkcePair,
                 generatePkcePair:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject)
{
  [_implementation generatePkcePair:resolve rejecter:reject];
}

RCT_EXPORT_METHOD(handleURL:(NSString *)url)
{
  [_implementation handleURL:url];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeKrdpassAuthReactNativeSpecJSI>(params);
}

@end
