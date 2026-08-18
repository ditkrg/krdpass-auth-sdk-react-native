#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

// Swift implementation declaration for the Objective-C++ facade, avoiding a
// pod-specific generated Swift header. Every selector below is hand-copied from
// an @objc(...) attribute in KrdpassAuthReactNativeModule.swift; change them
// together (wire-codes.test.ts checks the two files against each other).
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
- (void)teardown;

@end
