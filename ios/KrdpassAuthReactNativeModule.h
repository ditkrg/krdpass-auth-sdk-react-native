#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

// Swift implementation declaration for the Objective-C++ facade. This avoids
// importing a pod-specific generated Swift header from another source in the
// same target.
@interface KrdpassAuthReactNativeModule : NSObject

- (void)signIn:(NSDictionary *)config
        resolve:(RCTPromiseResolveBlock)resolve
       rejecter:(RCTPromiseRejectBlock)reject;
- (void)getUserInfo:(NSDictionary *)config
            resolve:(RCTPromiseResolveBlock)resolve
           rejecter:(RCTPromiseRejectBlock)reject;
- (void)refreshTokens:(NSDictionary *)config
              resolve:(RCTPromiseResolveBlock)resolve
             rejecter:(RCTPromiseRejectBlock)reject;
- (void)revokeToken:(NSDictionary *)config
            resolve:(RCTPromiseResolveBlock)resolve
           rejecter:(RCTPromiseRejectBlock)reject;
- (void)verifyToken:(NSDictionary *)config
            resolve:(RCTPromiseResolveBlock)resolve
           rejecter:(RCTPromiseRejectBlock)reject;
- (void)generatePkcePair:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject;
- (void)authenticate:(NSDictionary *)config
             resolve:(RCTPromiseResolveBlock)resolve
            rejecter:(RCTPromiseRejectBlock)reject;
- (void)cancelAuthentication:(NSDictionary *)config
                       resolve:(RCTPromiseResolveBlock)resolve
                      rejecter:(RCTPromiseRejectBlock)reject;
- (void)handleURL:(NSString *)url;

@end
